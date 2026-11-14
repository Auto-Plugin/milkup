import {
  createIsolatedPluginModule,
  createRpcPluginIsolationHost,
  createTrustedPluginRenderEndpoint,
  type PluginIsolationRpcMessageListener,
  type PluginManifest,
  type PluginRenderControl,
  type RpcPluginIsolationHost,
} from '@milkup/plugin'

import type {
  DesktopDomPluginModuleCapabilities,
  DesktopLoadedPluginModule,
  DesktopPreparedDomPluginModule,
} from './desktop-plugin-manager'

export const DESKTOP_PLUGIN_DOM_EVENT = 'milkup-plugin-dom-message'
const retryLocalCleanup = new WeakMap<object, () => void>()

export type DesktopPluginDomInvoke = <T>(command: string, args?: unknown) => Promise<T>
export type DesktopPluginDomListen = (
  event: typeof DESKTOP_PLUGIN_DOM_EVENT,
  handler: (event: { readonly payload: DesktopPluginDomMessageEvent }) => void,
) => Promise<() => void>

export interface DesktopPluginDomMessageEvent {
  readonly pluginId: string
  readonly instanceId: string
  readonly kind: 'message' | 'document-render-timeout' | 'error'
  readonly message?: unknown
  readonly requestId?: string
  readonly error?: string
}

export interface DesktopPluginDomTransport {
  readonly invoke?: DesktopPluginDomInvoke
  readonly listen?: DesktopPluginDomListen
}

/** Native owns package resolution and snapshots. No browser source read or URL is involved. */
export async function prepareDesktopPluginDomModule(
  manifest: PluginManifest,
  nativeRuntime: boolean,
  invoke: DesktopPluginDomInvoke = loadTauriInvoke,
): Promise<DesktopPreparedDomPluginModule> {
  if (!nativeRuntime) throw new Error('DOM plugins require the native desktop runtime')
  if (manifest.host !== 'dom') throw new Error('DOM preparation requires a DOM plugin manifest')
  const prepared = await invoke<{ readonly leaseId: string }>('prepare_plugin_dom_module', {
    pluginId: manifest.id,
    expectedManifest: manifest,
  })
  if (!prepared || !validIdentity(prepared.leaseId))
    throw new Error('Native DOM preparation did not supply a lease identity')
  let release: Promise<void> | undefined
  let latestRelease: Promise<void> | undefined
  let releaseFailed = false
  let releasing = false
  function releaseExactLease(): Promise<void> {
    releasing = true
    latestRelease = invoke<boolean>('release_plugin_dom_module', {
      pluginId: manifest.id,
      leaseId: prepared.leaseId,
    })
      .then((result) => {
        if (result !== true) throw new Error('Native DOM lease release was not confirmed')
        releaseFailed = false
      })
      .catch((error) => {
        releaseFailed = true
        throw error
      })
      .finally(() => {
        releasing = false
      })
    void latestRelease.catch(() => undefined)
    return latestRelease
  }
  function dispose(): Promise<void> {
    return (release ??= releaseExactLease())
  }
  return Object.freeze({
    kind: 'dom' as const,
    leaseId: prepared.leaseId,
    dispose,
    retryDispose(): Promise<void> {
      if (!release) return dispose()
      return releasing || !releaseFailed ? latestRelease! : releaseExactLease()
    },
  })
}

/** A fresh endpoint belongs to exactly one native instance; it is never rebound. */
export async function startDesktopPluginDomEndpoint(
  pluginId: string,
  leaseId: string,
  transport: DesktopPluginDomTransport = {},
) {
  const invoke = transport.invoke ?? loadTauriInvoke
  const endpoint = new DesktopPluginDomEndpoint(
    pluginId,
    invoke,
    transport.listen ?? loadTauriListen,
  )
  try {
    await endpoint.attach()
    const started = await invoke<{ readonly instanceId: string }>('start_plugin_dom_process', {
      pluginId,
      leaseId,
    })
    if (!started || !validIdentity(started.instanceId))
      throw new Error('Native DOM host did not supply an instance identity')
    endpoint.bindInstance(started.instanceId)
    const trusted = createTrustedPluginRenderEndpoint(endpoint, (listener) =>
      endpoint.subscribe(listener),
    )
    retryLocalCleanup.set(trusted, () => endpoint.retryLocalCleanup())
    return trusted
  } catch (error) {
    try {
      await endpoint.close()
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], 'DOM startup and cleanup failed')
    }
    // The loader releases the exact lease on failure. Native release also stops
    // an instance started from that lease if the invoke reply was lost/malformed.
    // Never stop by plugin ID: it could kill a replacement activation.
    throw error
  }
}

export async function loadDesktopPluginDomModule(
  manifest: PluginManifest,
  prepared: DesktopPreparedDomPluginModule,
  capabilities: DesktopDomPluginModuleCapabilities,
  transport: DesktopPluginDomTransport = {},
): Promise<DesktopLoadedPluginModule> {
  let endpoint: Awaited<ReturnType<typeof startDesktopPluginDomEndpoint>>
  try {
    endpoint = await startDesktopPluginDomEndpoint(manifest.id, prepared.leaseId, transport)
  } catch (error) {
    try {
      await prepared.dispose?.()
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], 'DOM startup and lease cleanup failed')
    }
    throw error
  }
  let host: RpcPluginIsolationHost | undefined
  let disposed = false
  let disposal: Promise<void> | undefined
  let retrying: Promise<void> | undefined
  function dispose(): Promise<void> {
    if (disposal) return disposal
    disposed = true
    // Synchronously revoke all JS endpoints before awaiting exact native stop.
    const errors: unknown[] = []
    let stopping: void | Promise<void> = undefined
    try {
      stopping = endpoint.close?.()
    } catch (error) {
      errors.push(error)
    }
    try {
      host?.dispose()
    } catch (error) {
      errors.push(error)
    }
    disposal = (async () => {
      try {
        await stopping
      } catch (error) {
        errors.push(error)
      }
      // Release the exact lease even when stop failed; native retains ownership on failure.
      try {
        await prepared.dispose?.()
      } catch (error) {
        errors.push(error)
      }
      if (errors.length) throw new AggregateError(errors, 'DOM module cleanup failed')
    })()
    void disposal.catch(() => undefined)
    return disposal
  }
  function retryDispose(): Promise<void> {
    if (!disposal) return dispose()
    if (retrying) return retrying
    retrying = (async () => {
      // The first failure remains available on disposal. Only exact owner cleanup
      // is retried; no lifecycle RPC or activation can be reopened.
      await disposal!.catch(() => undefined)
      const errors: unknown[] = []
      try {
        host?.dispose()
      } catch (error) {
        errors.push(error)
      }
      try {
        retryLocalCleanup.get(endpoint)?.()
      } catch (error) {
        errors.push(error)
      }
      try {
        if (!prepared.dispose) throw new Error('DOM lease cleanup authority is unavailable')
        if (prepared.retryDispose) await prepared.retryDispose()
        else await prepared.dispose()
      } catch (error) {
        errors.push(error)
      }
      // Successful exact issued lease release confirms native stop/reap, even
      // when the earlier stop reply failed; native retains the lease on failure.
      if (errors.length) throw new AggregateError(errors, 'DOM cleanup retry failed')
    })()
    const current = retrying
    void current.then(
      () => {
        retrying = undefined
      },
      () => {
        retrying = undefined
      },
    )
    return current
  }
  try {
    host = createRpcPluginIsolationHost(endpoint, {
      timeoutMs: 10_000,
      onDocumentRenderTimeout: () => {
        void dispose()
        capabilities.onDocumentRenderTimeout()
      },
      onIsolationError: (error) => {
        void dispose()
        capabilities.onIsolationError(error)
      },
    })
    const module = createIsolatedPluginModule({ manifest, host })
    return Object.freeze({
      module: Object.freeze({
        runtimeHost: 'isolated' as const,
        activate: async (context: Parameters<NonNullable<typeof module.activate>>[0]) => {
          try {
            // The DOM profile has no host brokers, even if the runtime context
            // grows capabilities in future. Only lifecycle and render RPC cross.
            const activation = await module.activate?.({ ...context, host: {} })
            // The read-only DOM profile has no host-side initialization writes.
            // Retiring its exact native process is the authoritative cleanup; do
            // not wait for an untrusted dispose RPC before starting native stop.
            return Object.freeze({ ...activation, dispose })
          } catch (error) {
            try {
              await dispose()
            } catch (cleanupError) {
              throw new AggregateError(
                [error, cleanupError],
                `DOM activation and cleanup failed: ${error instanceof Error ? error.message : String(error)}`,
              )
            }
            throw error
          }
        },
        deactivate: async () => {
          try {
            if (!disposed) await module.deactivate?.()
          } finally {
            await dispose()
          }
        },
      }),
      dispose,
      retryDispose,
    })
  } catch (error) {
    try {
      await dispose()
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], 'DOM load and cleanup failed')
    }
    throw error
  }
}

class DesktopPluginDomEndpoint {
  private readonly listeners = new Set<PluginIsolationRpcMessageListener>()
  private readonly controls = new Set<(event: PluginRenderControl) => void>()
  private unlisten: (() => void) | undefined
  private nativeInstanceId = ''
  private closed = false
  private completion: Promise<void> | undefined
  private terminalControl: PluginRenderControl | undefined
  private readonly startupErrors = new Set<string>()
  private startupOverflow = false

  constructor(
    private readonly pluginId: string,
    private readonly invoke: DesktopPluginDomInvoke,
    private readonly listen: DesktopPluginDomListen,
  ) {}

  get instanceId(): string {
    return this.nativeInstanceId
  }

  async attach(): Promise<void> {
    this.unlisten = await this.listen(DESKTOP_PLUGIN_DOM_EVENT, ({ payload }) => {
      if (this.closed || !payload || payload.pluginId !== this.pluginId) return
      if (!this.nativeInstanceId) {
        // The native helper waits for frontend activate/render RPC. Therefore no
        // legitimate RPC response precedes binding; only startup failure can.
        // Keep multiple identities so a delayed old error cannot overwrite ours.
        if (payload.kind === 'error' && validIdentity(payload.instanceId)) {
          if (this.startupErrors.size < 64) this.startupErrors.add(payload.instanceId)
          else this.startupOverflow = true
        }
        return
      }
      if (payload.instanceId !== this.nativeInstanceId) return
      if (payload.kind === 'error') this.finish({ type: 'error' })
      else if (payload.kind === 'document-render-timeout' && typeof payload.requestId === 'string')
        this.finish({ type: 'timeout', id: payload.requestId })
      else if (payload.kind === 'message')
        for (const listener of [...this.listeners]) listener({ data: payload.message })
    })
  }

  bindInstance(instanceId: string): void {
    this.nativeInstanceId = instanceId
    const failed = this.startupOverflow || this.startupErrors.has(instanceId)
    this.startupErrors.clear()
    if (failed) this.finish({ type: 'error' })
  }

  subscribe(listener: (event: PluginRenderControl) => void): () => void {
    this.controls.add(listener)
    const terminal = this.terminalControl
    if (terminal)
      queueMicrotask(() => {
        if (this.controls.has(listener)) {
          try {
            listener(terminal)
          } catch {
            // Native teardown preceded this retained terminal notification.
          }
        }
      })
    return () => this.controls.delete(listener)
  }

  postMessage(message: unknown): void {
    if (this.closed || !this.nativeInstanceId) throw new Error('DOM endpoint is closed')
    void this.invoke<boolean>('send_plugin_dom_message', {
      pluginId: this.pluginId,
      instanceId: this.nativeInstanceId,
      message,
    }).then(
      (sent) => {
        if (!sent) this.finish({ type: 'error' })
      },
      () => {
        void this.finish({ type: 'error' })
      },
    )
  }

  addEventListener(_type: 'message', listener: PluginIsolationRpcMessageListener): void {
    this.listeners.add(listener)
  }

  removeEventListener(_type: 'message', listener: PluginIsolationRpcMessageListener): void {
    this.listeners.delete(listener)
  }

  retryLocalCleanup(): void {
    if (!this.closed) throw new Error('DOM endpoint is not retired')
    this.unlisten?.()
    this.unlisten = undefined
  }

  close(): Promise<void> {
    return this.finish({ type: 'disposed' })
  }

  private finish(control: PluginRenderControl): Promise<void> {
    if (this.completion) return this.completion
    this.closed = true
    this.terminalControl = control
    const errors: unknown[] = []
    try {
      this.unlisten?.()
    } catch (error) {
      errors.push(error)
    }
    if (!errors.length) this.unlisten = undefined
    this.startupErrors.clear()
    this.listeners.clear()
    let stopping: Promise<boolean> = Promise.resolve(true)
    if (this.nativeInstanceId) {
      try {
        stopping = this.invoke<boolean>('stop_plugin_dom_process', {
          pluginId: this.pluginId,
          instanceId: this.nativeInstanceId,
        })
      } catch (error) {
        errors.push(error)
      }
    }
    this.completion = (async () => {
      try {
        if ((await stopping) !== true)
          throw new Error('Native DOM stop did not confirm the exact instance was reaped')
      } catch (error) {
        errors.push(error)
      }
      if (errors.length) throw new AggregateError(errors, 'DOM endpoint cleanup failed')
    })()
    void this.completion.catch(() => undefined)
    // Revoke pending RPC immediately, independently of native join completion.
    for (const listener of [...this.controls]) {
      try {
        listener(control)
      } catch {
        // Observer failures cannot prevent revocation of other pending RPCs.
      }
    }
    this.controls.clear()
    return this.completion
  }
}

function validIdentity(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value)
}

async function loadTauriInvoke<T>(command: string, args?: unknown): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<T>(command, args as never)
}

async function loadTauriListen(
  event: typeof DESKTOP_PLUGIN_DOM_EVENT,
  handler: (event: { readonly payload: DesktopPluginDomMessageEvent }) => void,
): Promise<() => void> {
  const { listen } = await import('@tauri-apps/api/event')
  return listen<DesktopPluginDomMessageEvent>(event, handler)
}

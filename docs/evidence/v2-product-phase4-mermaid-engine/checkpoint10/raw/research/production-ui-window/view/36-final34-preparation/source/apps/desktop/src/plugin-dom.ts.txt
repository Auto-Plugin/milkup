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
  let released = false
  return Object.freeze({
    kind: 'dom' as const,
    leaseId: prepared.leaseId,
    dispose() {
      if (released) return
      released = true
      void invoke<boolean>('release_plugin_dom_module', {
        pluginId: manifest.id,
        leaseId: prepared.leaseId,
      }).catch(() => undefined)
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
    return createTrustedPluginRenderEndpoint(endpoint, (listener) => endpoint.subscribe(listener))
  } catch (error) {
    endpoint.close()
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
    prepared.dispose?.()
    throw error
  }
  let host: RpcPluginIsolationHost | undefined
  let disposed = false
  function dispose(): void {
    if (disposed) return
    disposed = true
    // Stop first: pending cancellation/disposal RPC must not delay native teardown.
    endpoint.close?.()
    host?.dispose()
    prepared.dispose?.()
  }
  try {
    host = createRpcPluginIsolationHost(endpoint, {
      timeoutMs: 10_000,
      onDocumentRenderTimeout: () => {
        dispose()
        capabilities.onDocumentRenderTimeout()
      },
      onIsolationError: (error) => {
        dispose()
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
            return await module.activate?.({ ...context, host: {} })
          } catch (error) {
            dispose()
            throw error
          }
        },
        deactivate: async () => {
          try {
            if (!disposed) await module.deactivate?.()
          } finally {
            dispose()
          }
        },
      }),
      dispose,
    })
  } catch (error) {
    dispose()
    throw error
  }
}

class DesktopPluginDomEndpoint {
  private readonly listeners = new Set<PluginIsolationRpcMessageListener>()
  private readonly controls = new Set<(event: PluginRenderControl) => void>()
  private unlisten: (() => void) | undefined
  private nativeInstanceId = ''
  private closed = false
  private stopped = false
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
      () => this.finish({ type: 'error' }),
    )
  }

  addEventListener(_type: 'message', listener: PluginIsolationRpcMessageListener): void {
    this.listeners.add(listener)
  }

  removeEventListener(_type: 'message', listener: PluginIsolationRpcMessageListener): void {
    this.listeners.delete(listener)
  }

  close(): void {
    this.finish({ type: 'disposed' })
  }

  private finish(control: PluginRenderControl): void {
    if (this.closed) return
    this.closed = true
    this.terminalControl = control
    this.unlisten?.()
    this.unlisten = undefined
    this.startupErrors.clear()
    this.listeners.clear()
    if (this.nativeInstanceId && !this.stopped) {
      this.stopped = true
      void this.invoke<boolean>('stop_plugin_dom_process', {
        pluginId: this.pluginId,
        instanceId: this.nativeInstanceId,
      }).catch(() => undefined)
    }
    // One observer must not prevent the remaining pending RPCs being revoked.
    for (const listener of [...this.controls]) {
      try {
        listener(control)
      } catch {
        // Cleanup is already complete, including the native stop request.
      }
    }
    this.controls.clear()
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

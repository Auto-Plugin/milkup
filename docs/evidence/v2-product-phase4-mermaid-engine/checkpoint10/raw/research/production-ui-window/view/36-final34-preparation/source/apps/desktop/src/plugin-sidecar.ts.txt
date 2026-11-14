import { createTrustedPluginRenderEndpoint, type PluginRenderControl } from '@milkup/plugin'

import type {
  PluginIsolationRpcMessageListener,
  PluginSidecarEndpoint,
  PluginSidecarProcess,
  PluginSidecarStartRequest,
  PluginSidecarStopRequest,
} from '@milkup/plugin'

export const DESKTOP_PLUGIN_SIDECAR_EVENT = 'milkup-plugin-sidecar-message'

export interface DesktopPluginSidecarProcessConfig {
  readonly executable: string
  readonly args?: readonly string[]
  readonly invoke?: DesktopPluginSidecarInvoke
  readonly listen?: DesktopPluginSidecarListen
}

export type DesktopPluginSidecarInvoke = <T>(command: string, args?: unknown) => Promise<T>

export type DesktopPluginSidecarListen = (
  event: typeof DESKTOP_PLUGIN_SIDECAR_EVENT,
  handler: (event: { readonly payload: DesktopPluginSidecarMessageEvent }) => void,
) => Promise<() => void>

export interface DesktopPluginSidecarMessageEvent {
  readonly pluginId: string
  readonly instanceId: string
  readonly kind: 'message' | 'document-render-timeout' | 'error'
  readonly message?: unknown
  readonly requestId?: string
  readonly error?: string
}

export function createDesktopPluginSidecarProcess(
  config: DesktopPluginSidecarProcessConfig,
): PluginSidecarProcess {
  const invoke = config.invoke ?? loadTauriInvoke
  const listen = config.listen ?? loadTauriListen
  const endpoints = new Map<string, DesktopPluginSidecarEndpoint>()

  return Object.freeze({
    start: async (request: PluginSidecarStartRequest): Promise<PluginSidecarEndpoint> => {
      const endpoint = new DesktopPluginSidecarEndpoint(request.pluginId, invoke, listen)

      try {
        await endpoint.attach()
        const started = await invoke<{ readonly instanceId: string }>(
          'start_plugin_sidecar_process',
          {
            pluginId: request.pluginId,
            executable: config.executable,
            args: config.args ?? [],
            ...(request.moduleSpecifier ? { moduleSpecifier: request.moduleSpecifier } : {}),
          },
        )
        if (!started || typeof started.instanceId !== 'string' || !started.instanceId)
          throw new Error('Native sidecar did not supply an instance identity')
        endpoint.bindInstance(started.instanceId)
        endpoints.get(request.pluginId)?.close()
        endpoints.set(request.pluginId, endpoint)
        return createTrustedPluginRenderEndpoint(endpoint, (listener) =>
          endpoint.subscribe(listener),
        )
      } catch (error) {
        endpoint.close()
        throw error
      }
    },
    stop: async (request: PluginSidecarStopRequest): Promise<void> => {
      const endpoint = endpoints.get(request.pluginId)
      const instanceId = request.instanceId ?? endpoint?.instanceId
      if (!instanceId) return
      if (endpoint?.instanceId === instanceId) {
        endpoint.close()
        endpoints.delete(request.pluginId)
      }
      await invoke<boolean>('stop_plugin_sidecar_process', {
        pluginId: request.pluginId,
        instanceId,
      })
    },
  })
}

class DesktopPluginSidecarEndpoint implements PluginSidecarEndpoint {
  private readonly listeners = new Set<PluginIsolationRpcMessageListener>()
  private unlisten: (() => void) | undefined
  private attached = false
  private closed = false
  private nativeInstanceId = ''
  private readonly controls = new Set<(event: PluginRenderControl) => void>()
  private terminalControl: PluginRenderControl | undefined
  private startupError: DesktopPluginSidecarMessageEvent | undefined

  get instanceId(): string {
    return this.nativeInstanceId
  }

  bindInstance(instanceId: string): void {
    this.nativeInstanceId = instanceId
    if (this.startupError?.instanceId === instanceId) this.finish({ type: 'error' })
    this.startupError = undefined
  }

  subscribe(listener: (event: PluginRenderControl) => void): () => void {
    this.controls.add(listener)
    const terminal = this.terminalControl
    if (terminal)
      queueMicrotask(() => {
        if (this.controls.has(listener)) listener(terminal)
      })
    return () => this.controls.delete(listener)
  }

  constructor(
    private readonly pluginId: string,
    private readonly invoke: DesktopPluginSidecarInvoke,
    private readonly listen: DesktopPluginSidecarListen,
  ) {}

  async attach(): Promise<void> {
    if (this.attached) {
      return
    }

    this.unlisten = await this.listen(DESKTOP_PLUGIN_SIDECAR_EVENT, (event) => {
      const payload = event.payload
      if (
        !this.nativeInstanceId &&
        payload.pluginId === this.pluginId &&
        payload.kind === 'error'
      ) {
        this.startupError = payload
        return
      }
      if (
        this.closed ||
        !this.nativeInstanceId ||
        payload.pluginId !== this.pluginId ||
        payload.instanceId !== this.nativeInstanceId
      )
        return
      if (payload.kind === 'document-render-timeout' && typeof payload.requestId === 'string') {
        this.finish({ type: 'timeout', id: payload.requestId })
      } else if (payload.kind === 'error') {
        this.finish({ type: 'error' })
      } else if (payload.kind === 'message') {
        for (const listener of this.listeners) listener({ data: payload.message })
      }
    })
    this.attached = true
  }

  postMessage(message: unknown): void {
    if (this.closed || !this.nativeInstanceId) throw new Error('Sidecar endpoint is closed')
    void this.invoke<boolean>('send_plugin_sidecar_message', {
      pluginId: this.pluginId,
      instanceId: this.nativeInstanceId,
      message,
    }).catch(() => this.finish({ type: 'error' }))
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
    this.attached = false
    this.listeners.clear()
    for (const listener of [...this.controls]) listener(control)
    this.controls.clear()
  }
}

async function loadTauriInvoke<T>(command: string, args?: unknown): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<T>(command, args as never)
}

async function loadTauriListen(
  event: typeof DESKTOP_PLUGIN_SIDECAR_EVENT,
  handler: (event: { readonly payload: DesktopPluginSidecarMessageEvent }) => void,
): Promise<() => void> {
  const { listen } = await import('@tauri-apps/api/event')
  return listen<DesktopPluginSidecarMessageEvent>(event, handler)
}

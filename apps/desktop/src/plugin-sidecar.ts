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
  readonly message: unknown
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

      await endpoint.attach()
      await invoke<boolean>('start_plugin_sidecar_process', {
        pluginId: request.pluginId,
        executable: config.executable,
        args: config.args ?? [],
        ...(request.moduleSpecifier ? { moduleSpecifier: request.moduleSpecifier } : {}),
      })
      endpoints.set(request.pluginId, endpoint)
      return endpoint
    },
    stop: async (request: PluginSidecarStopRequest): Promise<void> => {
      endpoints.get(request.pluginId)?.close?.()
      endpoints.delete(request.pluginId)
      await invoke<boolean>('stop_plugin_sidecar_process', { pluginId: request.pluginId })
    },
  })
}

class DesktopPluginSidecarEndpoint implements PluginSidecarEndpoint {
  private readonly listeners = new Set<PluginIsolationRpcMessageListener>()
  private unlisten: (() => void) | undefined
  private attached = false

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
      if (event.payload.pluginId !== this.pluginId) {
        return
      }

      for (const listener of this.listeners) {
        listener({ data: event.payload.message })
      }
    })
    this.attached = true
  }

  postMessage(message: unknown): void {
    void this.invoke<boolean>('send_plugin_sidecar_message', {
      pluginId: this.pluginId,
      message,
    })
  }

  addEventListener(_type: 'message', listener: PluginIsolationRpcMessageListener): void {
    this.listeners.add(listener)
  }

  removeEventListener(_type: 'message', listener: PluginIsolationRpcMessageListener): void {
    this.listeners.delete(listener)
  }

  close(): void {
    this.unlisten?.()
    this.unlisten = undefined
    this.attached = false
    this.listeners.clear()
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

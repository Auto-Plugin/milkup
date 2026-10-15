import { consumePluginCommandGesture } from './workspace-gesture'
export interface PluginUiNotice {
  readonly kind: 'info' | 'error'
  readonly message: string
}
export interface PluginUiBroker {
  dispose?(): void
  requestUpdate(viewId?: string): Promise<void>
  revealLine(line: number): Promise<void>
  open?(viewId: string, gesture?: string): Promise<void>
  notify?(notice: PluginUiNotice): Promise<void>
}
export interface PluginUiHost extends Pick<PluginUiBroker, 'requestUpdate' | 'revealLine'> {
  open(viewId: string): Promise<void>
  notify(notice: PluginUiNotice): Promise<void>
}
export interface PluginUiBrokerConfig {
  readonly pluginId: string
  readonly viewIds: readonly string[]
  readonly modalViewIds?: readonly string[]
  readonly update: (pluginId: string, viewId?: string) => void | Promise<void>
  readonly revealLine?: (line: number) => void | Promise<void>
  readonly open?: (pluginId: string, viewId: string) => void | Promise<void>
  readonly notify?: (pluginId: string, notice: PluginUiNotice) => void | Promise<void>
  readonly isActive?: () => boolean
  readonly consumeGesture?: (proof: string | undefined, pluginId: string) => boolean
}
export function assertPluginUiNotice(value: unknown): asserts value is PluginUiNotice {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new Error('Invalid plugin notice')
  const n = value as Record<string, unknown>
  if (
    Object.keys(n).length !== 2 ||
    !['info', 'error'].includes(n.kind as string) ||
    typeof n.message !== 'string' ||
    !n.message.trim() ||
    n.message.length > 1000 ||
    /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(n.message)
  )
    throw new Error('Invalid plugin notice')
}
export function createPluginUiBroker(config: PluginUiBrokerConfig): PluginUiBroker {
  const ids = new Set(config.viewIds),
    modals = new Set(config.modalViewIds ?? [])
  let revoked = false,
    lastNotice = -Infinity
  const active = () => {
    if (config.isActive?.() === false) revoked = true
    if (revoked) throw new Error('Plugin UI capability was revoked')
  }
  return Object.freeze({
    dispose: () => {
      revoked = true
    },
    requestUpdate: async (viewId?: string) => {
      active()
      if (viewId !== undefined && !ids.has(viewId))
        throw new Error('Plugin UI view is not declared')
      await config.update(config.pluginId, viewId)
    },
    revealLine: async (line: number) => {
      active()
      if (!Number.isInteger(line) || line < 1 || !config.revealLine)
        throw new Error('Plugin UI navigation unavailable')
      await config.revealLine(line)
    },
    open: async (viewId: string, gesture?: string) => {
      active()
      if (!modals.has(viewId) || !config.open) throw new Error('Plugin modal is unavailable')
      if (!(config.consumeGesture ?? consumePluginCommandGesture)(gesture, config.pluginId))
        throw new Error('Plugin UI requires a trusted command')
      await config.open(config.pluginId, viewId)
    },
    notify: async (notice: PluginUiNotice) => {
      active()
      assertPluginUiNotice(notice)
      if (!config.notify) throw new Error('Plugin notices are unavailable')
      const now = Date.now()
      if (now - lastNotice < 500) throw new Error('Plugin notices are rate limited')
      lastNotice = now
      await config.notify(config.pluginId, Object.freeze({ ...notice }))
    },
  })
}
export function createPluginUiHostCapabilities(
  broker: PluginUiBroker,
  isActive: () => boolean = () => true,
  gesture?: string,
): PluginUiHost {
  const active = () => {
    if (!isActive()) throw new Error('Plugin UI capability was revoked')
  }
  return Object.freeze({
    requestUpdate: async (viewId?: string) => {
      active()
      await broker.requestUpdate(viewId)
    },
    revealLine: async (line: number) => {
      active()
      await broker.revealLine(line)
    },
    open: async (viewId: string) => {
      active()
      if (!broker.open) throw new Error('Plugin modal is unavailable')
      await broker.open(viewId, gesture)
    },
    notify: async (notice: PluginUiNotice) => {
      active()
      assertPluginUiNotice(notice)
      if (!broker.notify) throw new Error('Plugin notices are unavailable')
      await broker.notify(notice)
    },
  })
}

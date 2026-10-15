import { consumePluginCommandGesture } from './workspace-gesture'
export interface PluginUiRevealLocationRequest {
  readonly documentId: string
  readonly version: number
  readonly from: number
  readonly to?: number
}
export interface PluginUiOperationOptions {
  readonly signal?: AbortSignal
  /** Internal same-realm lifetime guard; never serialized over RPC. */
  readonly assertActive?: () => void
}
export interface PluginUiOperationContext {
  readonly signal: AbortSignal
  readonly assertActive: () => void
}
export interface PluginUiNotice {
  readonly kind: 'info' | 'error'
  readonly message: string
}
export interface PluginUiBroker {
  dispose?(): void
  requestUpdate(viewId?: string): Promise<void>
  revealLine(line: number): Promise<void>
  revealLocation?(
    request: PluginUiRevealLocationRequest,
    options?: PluginUiOperationOptions,
  ): Promise<void>
  open?(viewId: string, gesture?: string): Promise<void>
  notify?(notice: PluginUiNotice): Promise<void>
}
export interface PluginUiHost extends Pick<PluginUiBroker, 'requestUpdate' | 'revealLine'> {
  revealLocation(
    request: PluginUiRevealLocationRequest,
    options?: PluginUiOperationOptions,
  ): Promise<void>
  open(viewId: string): Promise<void>
  notify(notice: PluginUiNotice): Promise<void>
}
export interface PluginUiBrokerConfig {
  readonly pluginId: string
  readonly viewIds: readonly string[]
  readonly modalViewIds?: readonly string[]
  readonly update: (pluginId: string, viewId?: string) => void | Promise<void>
  readonly revealLine?: (line: number) => void | Promise<void>
  readonly revealLocation?: (
    request: PluginUiRevealLocationRequest,
    context: PluginUiOperationContext,
  ) => void | Promise<void>
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
  const navigations = new Set<AbortController>()
  const active = () => {
    if (config.isActive?.() === false) revoked = true
    if (revoked) throw new Error('Plugin UI capability was revoked')
  }
  return Object.freeze({
    dispose: () => {
      revoked = true
      for (const controller of navigations) controller.abort()
      navigations.clear()
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
    revealLocation: async (
      request: PluginUiRevealLocationRequest,
      options: PluginUiOperationOptions = {},
    ) => {
      active()
      assertPluginUiLocation(request)
      if (!config.revealLocation) throw new Error('Plugin UI navigation unavailable')
      if (navigations.size >= 8) throw new Error('Plugin UI navigation limit reached')
      const controller = new AbortController()
      const abort = () => controller.abort()
      if (options.signal?.aborted) controller.abort()
      options.signal?.addEventListener('abort', abort, { once: true })
      navigations.add(controller)
      const assertActive = () => {
        active()
        options.assertActive?.()
        if (controller.signal.aborted) throw new Error('Plugin UI navigation aborted')
      }
      try {
        assertActive()
        const value = Object.freeze({
          documentId: request.documentId,
          version: request.version,
          from: request.from,
          ...(request.to === undefined ? {} : { to: request.to }),
        })
        await new Promise<void>((resolve, reject) => {
          const cancelled = () => reject(new Error('Plugin UI navigation aborted'))
          controller.signal.addEventListener('abort', cancelled, { once: true })
          Promise.resolve()
            .then(() => {
              assertActive()
              return config.revealLocation!(value, { signal: controller.signal, assertActive })
            })
            .then(resolve, reject)
            .finally(() => controller.signal.removeEventListener('abort', cancelled))
        })
        assertActive()
      } finally {
        options.signal?.removeEventListener('abort', abort)
        navigations.delete(controller)
      }
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
    revealLocation: async (
      request: PluginUiRevealLocationRequest,
      options: PluginUiOperationOptions = {},
    ) => {
      active()
      if (!broker.revealLocation) throw new Error('Plugin UI navigation unavailable')
      await broker.revealLocation(request, {
        ...options,
        assertActive: () => {
          active()
          options.assertActive?.()
        },
      })
      active()
    },
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

export function assertPluginUiLocation(
  value: unknown,
): asserts value is PluginUiRevealLocationRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid plugin location')
  const request = value as Record<string, unknown>
  if (
    Object.keys(request).some((key) => !['documentId', 'version', 'from', 'to'].includes(key)) ||
    typeof request.documentId !== 'string' ||
    !request.documentId.length ||
    request.documentId.length > 512 ||
    !Number.isSafeInteger(request.version) ||
    (request.version as number) < 0 ||
    !Number.isSafeInteger(request.from) ||
    (request.from as number) < 0 ||
    (request.to !== undefined &&
      (!Number.isSafeInteger(request.to) || (request.to as number) < (request.from as number)))
  )
    throw new Error('Invalid plugin location')
}

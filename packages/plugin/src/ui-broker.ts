export interface PluginUiBroker {
  requestUpdate(viewId?: string): Promise<void>
  revealLine(line: number): Promise<void>
}

export interface PluginUiHost {
  requestUpdate(viewId?: string): Promise<void>
  revealLine(line: number): Promise<void>
}

export interface PluginUiBrokerConfig {
  readonly pluginId: string
  readonly viewIds: readonly string[]
  readonly update: (pluginId: string, viewId?: string) => void | Promise<void>
  readonly revealLine?: (line: number) => void | Promise<void>
}

export function createPluginUiBroker(config: PluginUiBrokerConfig): PluginUiBroker {
  const viewIds = new Set(config.viewIds)

  return Object.freeze({
    requestUpdate: async (viewId?: string): Promise<void> => {
      if (viewId !== undefined && !viewIds.has(viewId)) {
        throw new Error(`Plugin UI view is not declared: ${viewId}`)
      }
      await config.update(config.pluginId, viewId)
    },
    revealLine: async (line: number): Promise<void> => {
      if (!Number.isInteger(line) || line < 1) {
        throw new Error('Plugin UI line must be a positive integer')
      }
      if (!config.revealLine) {
        throw new Error('Plugin UI line navigation is unavailable')
      }
      await config.revealLine(line)
    },
  })
}

export function createPluginUiHostCapabilities(broker: PluginUiBroker): PluginUiHost {
  return Object.freeze({
    requestUpdate: (viewId?: string) => broker.requestUpdate(viewId),
    revealLine: (line: number) => broker.revealLine(line),
  })
}

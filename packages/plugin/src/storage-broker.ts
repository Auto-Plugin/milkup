export type PluginStorageOperation = 'get' | 'set' | 'remove'

export interface PluginStorageBroker {
  getItem(key: string): Promise<string | null>
  setItem(key: string, value: string): Promise<void>
  removeItem(key: string): Promise<void>
}

export interface PluginStorageAdapter {
  getItem(key: string): string | null | Promise<string | null>
  setItem(key: string, value: string): void | Promise<void>
  removeItem(key: string): void | Promise<void>
}

export interface PluginStorageAuditRecord {
  readonly pluginId: string
  readonly operation: PluginStorageOperation
  readonly key: string
  readonly ok: boolean
  readonly reason?: string
}

export interface PluginStorageBrokerConfig {
  readonly pluginId: string
  readonly adapter: PluginStorageAdapter
  readonly audit?: (record: PluginStorageAuditRecord) => void
}

export function createPluginStorageBroker(config: PluginStorageBrokerConfig): PluginStorageBroker {
  const prefix = `milkup.plugin.storage.${config.pluginId}.`

  async function run<T>(
    operation: PluginStorageOperation,
    key: string,
    action: (scopedKey: string) => T | Promise<T>,
  ): Promise<T> {
    try {
      assertStorageKey(key)
      const value = await action(prefix + key)
      config.audit?.({ pluginId: config.pluginId, operation, key, ok: true })
      return value
    } catch (error) {
      config.audit?.({
        pluginId: config.pluginId,
        operation,
        key,
        ok: false,
        reason: error instanceof Error ? error.message : String(error),
      })
      throw error
    }
  }

  return Object.freeze({
    getItem: (key: string) => run('get', key, (scopedKey) => config.adapter.getItem(scopedKey)),
    setItem: (key: string, value: string) => {
      if (typeof value !== 'string') {
        return Promise.reject(new Error('Plugin storage values must be strings'))
      }
      return run('set', key, (scopedKey) => config.adapter.setItem(scopedKey, value))
    },
    removeItem: (key: string) =>
      run('remove', key, (scopedKey) => config.adapter.removeItem(scopedKey)),
  })
}

function assertStorageKey(key: string): void {
  if (!/^[A-Za-z0-9._-]{1,128}$/.test(key)) {
    throw new Error('Plugin storage key must be 1-128 safe characters')
  }
}

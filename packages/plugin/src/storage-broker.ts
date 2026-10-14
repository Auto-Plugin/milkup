export type PluginStorageOperation = 'get' | 'set' | 'remove'

export interface PluginStorageBroker {
  getItem(key: string): Promise<string | null>
  setItem(key: string, value: string): Promise<void>
  removeItem(key: string): Promise<void>
  createTemporaryStore?(): Promise<PluginTemporaryStore>
}

export const TEMPORARY_STORAGE_MAX_BATCH = 32
export const TEMPORARY_STORAGE_MAX_BYTES = 256 * 1024

export interface PluginTemporaryStore {
  get(key: string): Promise<string | null>
  set(key: string, value: string): Promise<void>
  getMany(keys: readonly string[]): Promise<readonly (string | null)[]>
  setMany(entries: readonly { readonly key: string; readonly value: string }[]): Promise<void>
  dispose(): Promise<void>
}

export interface ManagedPluginStorageBroker extends PluginStorageBroker {
  dispose(): Promise<void>
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
  readonly createTemporaryStore?: () => Promise<PluginTemporaryStore>
}

export function createPluginStorageBroker(
  config: PluginStorageBrokerConfig,
): ManagedPluginStorageBroker {
  const prefix = `milkup.plugin.storage.${config.pluginId}.`
  const stores = new Set<PluginTemporaryStore>()
  const creating = new Set<Promise<PluginTemporaryStore>>()
  let disposed = false
  let disposal: Promise<void> | undefined

  async function run<T>(
    operation: PluginStorageOperation,
    key: string,
    action: (scopedKey: string) => T | Promise<T>,
  ): Promise<T> {
    try {
      if (disposed) throw new Error('Plugin storage broker is disposed')
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
    ...(config.createTemporaryStore
      ? {
          createTemporaryStore: (): Promise<PluginTemporaryStore> => {
            if (disposed) return Promise.reject(new Error('Plugin storage broker is disposed'))
            if (stores.size + creating.size >= 4)
              return Promise.reject(
                new Error('Temporary store quota exceeded: 4 stores per plugin activation'),
              )
            const pending = config.createTemporaryStore!()
              .then(async (store) => {
                if (disposed) {
                  await store.dispose()
                  throw new Error('Plugin storage broker is disposed')
                }
                let closed = false
                let closing: Promise<void> | undefined
                const assertOpen = () => {
                  if (closed || disposed) throw new Error('Temporary store is disposed')
                }
                const getMany = async (keys: readonly string[]) => {
                  assertOpen()
                  assertTemporaryKeys(keys)
                  const values = await store.getMany(keys)
                  assertOpen()
                  assertTemporaryValues(values)
                  return values
                }
                const setMany = async (
                  entries: readonly { readonly key: string; readonly value: string }[],
                ) => {
                  assertOpen()
                  assertTemporaryEntries(entries)
                  await store.setMany(entries)
                  assertOpen()
                }
                const managed: PluginTemporaryStore = Object.freeze({
                  get: async (key: string) => (await getMany([key]))[0] ?? null,
                  set: async (key: string, value: string) => setMany([{ key, value }]),
                  getMany,
                  setMany,
                  dispose: () => {
                    closed = true
                    return (closing ??= store.dispose().then(() => {
                      stores.delete(managed)
                    }))
                  },
                })
                stores.add(managed)
                return managed
              })
              .finally(() => {
                creating.delete(pending)
              })
            creating.add(pending)
            return pending
          },
        }
      : {}),
    dispose: () => {
      disposed = true
      return (disposal ??= (async () => {
        await Promise.allSettled([...creating])
        await Promise.all([...stores].map((store) => store.dispose()))
      })())
    },
  })
}

export function assertTemporaryKeys(keys: readonly string[]): void {
  if (!Array.isArray(keys) || keys.length < 1 || keys.length > TEMPORARY_STORAGE_MAX_BATCH) {
    throw new Error('Temporary storage batch must contain 1-32 keys')
  }
  for (const key of keys) assertStorageKey(key)
  if (new Set(keys).size !== keys.length)
    throw new Error('Temporary storage batch has duplicate keys')
}

export function assertTemporaryEntries(
  entries: readonly { readonly key: string; readonly value: string }[],
): void {
  if (
    !Array.isArray(entries) ||
    entries.length < 1 ||
    entries.length > TEMPORARY_STORAGE_MAX_BATCH
  ) {
    throw new Error('Temporary storage batch must contain 1-32 entries')
  }
  assertTemporaryKeys(entries.map((entry) => entry.key))
  if (entries.some((entry) => typeof entry.value !== 'string'))
    throw new Error('Temporary storage values must be strings')
  assertTemporaryValues(entries.map((entry) => entry.value))
}

export function assertTemporaryValues(values: readonly (string | null)[]): number {
  let bytes = 0
  for (const value of values) {
    if (value === null) continue
    if (typeof value !== 'string' || value.length > TEMPORARY_STORAGE_MAX_BYTES) {
      throw new Error('Temporary storage values must be strings within the 256 KiB batch budget')
    }
    bytes += new TextEncoder().encode(value).length
    if (bytes > TEMPORARY_STORAGE_MAX_BYTES)
      throw new Error('Temporary storage batch exceeds 256 KiB')
  }
  return bytes
}

function assertStorageKey(key: string): void {
  if (typeof key !== 'string' || !/^[A-Za-z0-9._-]{1,128}$/.test(key)) {
    throw new Error('Plugin storage key must be 1-128 safe characters')
  }
}

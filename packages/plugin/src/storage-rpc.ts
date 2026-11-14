import type { PluginIsolationRpcEndpoint, PluginIsolationRpcMessageListener } from './isolation-rpc'
import {
  assertTemporaryKeys,
  assertTemporaryEntries,
  assertTemporaryValues,
  type PluginStorageBroker,
  type PluginTemporaryStore,
} from './storage-broker'

type StorageMethod =
  | 'getItem'
  | 'setItem'
  | 'removeItem'
  | 'temporaryCreate'
  | 'temporaryGet'
  | 'temporarySet'
  | 'temporaryDispose'
interface StoragePayload {
  readonly key?: string
  readonly value?: string
  readonly storeId?: string
  readonly keys?: readonly string[]
  readonly entries?: readonly { readonly key: string; readonly value: string }[]
}
interface StorageMessage {
  readonly protocol: 'milkup.plugin.storage.rpc.v1'
  readonly type: 'request' | 'response'
  readonly id: string
  readonly method?: StorageMethod
  readonly payload?: StoragePayload
  readonly ok?: boolean
  readonly value?: unknown
  readonly error?: { readonly message: string }
}

export interface RpcPluginStorageBroker extends PluginStorageBroker {
  dispose(): void
}

export function createRpcPluginStorageBroker(
  endpoint: PluginIsolationRpcEndpoint,
  timeoutMs = 5_000,
): RpcPluginStorageBroker {
  let nextId = 0
  let disposed = false
  const pending = new Map<
    string,
    {
      resolve(value: unknown): void
      reject(error: Error): void
      timer: ReturnType<typeof setTimeout>
    }
  >()
  const remove = addListener(endpoint, (value) => {
    const message = readMessage(value)
    if (!message || message.type !== 'response') return
    const request = pending.get(message.id)
    if (!request) return
    pending.delete(message.id)
    clearTimeout(request.timer)
    if (message.ok) request.resolve(message.value)
    else request.reject(new Error(message.error?.message ?? 'Plugin storage RPC failed'))
  })
  function call(method: StorageMethod, payload: StoragePayload): Promise<unknown> {
    if (disposed) return Promise.reject(new Error('Plugin storage RPC broker is disposed'))
    if (pending.size >= 16)
      return Promise.reject(new Error('Plugin storage RPC concurrency quota exceeded'))
    const id = `${Date.now().toString(36)}-${nextId++}`
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id)
        reject(new Error(`Plugin storage RPC timed out: ${method}`))
      }, timeoutMs)
      pending.set(id, { resolve, reject, timer })
      try {
        endpoint.postMessage({
          protocol: 'milkup.plugin.storage.rpc.v1',
          type: 'request',
          id,
          method,
          payload,
        } satisfies StorageMessage)
      } catch (error) {
        pending.delete(id)
        clearTimeout(timer)
        reject(error)
      }
    })
  }
  return Object.freeze({
    getItem: (key: string) => call('getItem', { key }) as Promise<string | null>,
    setItem: async (key: string, value: string) => {
      await call('setItem', { key, value })
    },
    removeItem: async (key: string) => {
      await call('removeItem', { key })
    },
    createTemporaryStore: async (): Promise<PluginTemporaryStore> => {
      const storeId = (await call('temporaryCreate', {})) as string
      let closed = false
      let disposal: Promise<void> | undefined
      const assertOpen = () => {
        if (closed) throw new Error('Temporary store is disposed')
      }
      const getMany = async (keys: readonly string[]) => {
        assertOpen()
        assertTemporaryKeys(keys)
        const values = (await call('temporaryGet', { storeId, keys })) as readonly (string | null)[]
        assertOpen()
        assertTemporaryValues(values)
        return values
      }
      const setMany = async (
        entries: readonly { readonly key: string; readonly value: string }[],
      ) => {
        assertOpen()
        assertTemporaryEntries(entries)
        await call('temporarySet', { storeId, entries })
        assertOpen()
      }
      return Object.freeze({
        get: async (key: string) => (await getMany([key]))[0] ?? null,
        set: (key: string, value: string) => setMany([{ key, value }]),
        getMany,
        setMany,
        dispose: () => {
          closed = true
          return (disposal ??= call('temporaryDispose', { storeId }).then(() => undefined))
        },
      })
    },
    dispose: () => {
      disposed = true
      remove()
      for (const request of pending.values()) {
        clearTimeout(request.timer)
        request.reject(new Error('Plugin storage RPC broker is disposed'))
      }
      pending.clear()
    },
  })
}

export function createPluginStorageRpcServer(
  endpoint: PluginIsolationRpcEndpoint,
  broker: PluginStorageBroker,
): { dispose(): void } {
  const stores = new Map<string, PluginTemporaryStore>()
  let nextStore = 0
  let disposed = false
  let inFlight = 0
  async function runRequest(method: StorageMethod, payload: StoragePayload): Promise<unknown> {
    if (method === 'getItem') return broker.getItem(payload.key ?? '')
    if (method === 'removeItem') return broker.removeItem(payload.key ?? '')
    if (method === 'setItem') {
      if (payload.value === undefined) throw new Error('Storage value is required')
      return broker.setItem(payload.key ?? '', payload.value)
    }
    if (method === 'temporaryCreate') {
      if (!broker.createTemporaryStore) throw new Error('Temporary plugin storage is unavailable')
      const store = await broker.createTemporaryStore()
      if (disposed) {
        await store.dispose()
        throw new Error('Storage RPC server is disposed')
      }
      const id = `temporary-${nextStore++}`
      stores.set(id, store)
      return id
    }
    const store = stores.get(payload.storeId ?? '')
    if (!store) {
      if (method === 'temporaryDispose') return
      throw new Error('Unknown temporary store')
    }
    if (method === 'temporaryDispose') {
      stores.delete(payload.storeId!)
      await store.dispose()
      return
    }
    if (method === 'temporaryGet') return store.getMany(payload.keys ?? [])
    if (method === 'temporarySet') return store.setMany(payload.entries ?? [])
    throw new Error('Unknown storage method')
  }
  const remove = addListener(endpoint, async (value) => {
    const message = readMessage(value)
    if (disposed || !message || message.type !== 'request' || !message.method || !message.payload)
      return
    const reply = (result: Partial<StorageMessage>) => {
      if (!disposed)
        endpoint.postMessage({
          protocol: 'milkup.plugin.storage.rpc.v1',
          type: 'response',
          id: message.id,
          ...result,
        } satisfies StorageMessage)
    }
    if (inFlight >= 16) {
      reply({ ok: false, error: { message: 'Plugin storage RPC concurrency quota exceeded' } })
      return
    }
    inFlight++
    try {
      reply({ ok: true, value: await runRequest(message.method, message.payload) })
    } catch (error) {
      reply({
        ok: false,
        error: { message: error instanceof Error ? error.message : String(error) },
      })
    } finally {
      inFlight--
    }
  })
  return Object.freeze({
    dispose: () => {
      disposed = true
      remove()
      for (const store of stores.values()) void store.dispose().catch(() => undefined)
      stores.clear()
    },
  })
}

function addListener(
  endpoint: PluginIsolationRpcEndpoint,
  listener: (message: unknown) => void,
): () => void {
  if (endpoint.addEventListener) {
    const wrapped: PluginIsolationRpcMessageListener = (event) => listener(event.data)
    endpoint.addEventListener('message', wrapped)
    return () => endpoint.removeEventListener?.('message', wrapped)
  }
  if (endpoint.on) {
    endpoint.on('message', listener)
    return () => endpoint.off?.('message', listener)
  }
  throw new Error('Plugin storage RPC endpoint does not support message listeners')
}
function readMessage(value: unknown): StorageMessage | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const message = value as Partial<StorageMessage>
  return message.protocol === 'milkup.plugin.storage.rpc.v1' && typeof message.id === 'string'
    ? (message as StorageMessage)
    : undefined
}

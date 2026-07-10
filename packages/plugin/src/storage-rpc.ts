import type { PluginIsolationRpcEndpoint, PluginIsolationRpcMessageListener } from './isolation-rpc'
import type { PluginStorageBroker } from './storage-broker'

type StorageMethod = 'getItem' | 'setItem' | 'removeItem'
interface StorageMessage {
  readonly protocol: 'milkup.plugin.storage.rpc.v1'
  readonly type: 'request' | 'response'
  readonly id: string
  readonly method?: StorageMethod
  readonly payload?: { readonly key: string; readonly value?: string }
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

  function call(
    method: StorageMethod,
    payload: NonNullable<StorageMessage['payload']>,
  ): Promise<unknown> {
    const id = `${Date.now().toString(36)}-${nextId++}`
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id)
        reject(new Error(`Plugin storage RPC timed out: ${method}`))
      }, timeoutMs)
      pending.set(id, { resolve, reject, timer })
      endpoint.postMessage({
        protocol: 'milkup.plugin.storage.rpc.v1',
        type: 'request',
        id,
        method,
        payload,
      } satisfies StorageMessage)
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
    dispose: () => {
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
  return Object.freeze({
    dispose: addListener(endpoint, async (value) => {
      const message = readMessage(value)
      if (!message || message.type !== 'request' || !message.method || !message.payload) return

      try {
        const result = await runRequest(broker, message.method, message.payload)
        endpoint.postMessage({
          protocol: 'milkup.plugin.storage.rpc.v1',
          type: 'response',
          id: message.id,
          ok: true,
          value: result,
        } satisfies StorageMessage)
      } catch (error) {
        endpoint.postMessage({
          protocol: 'milkup.plugin.storage.rpc.v1',
          type: 'response',
          id: message.id,
          ok: false,
          error: { message: error instanceof Error ? error.message : String(error) },
        } satisfies StorageMessage)
      }
    }),
  })
}

function runRequest(
  broker: PluginStorageBroker,
  method: StorageMethod,
  payload: { readonly key: string; readonly value?: string },
): Promise<unknown> {
  if (method === 'getItem') return broker.getItem(payload.key)
  if (method === 'removeItem') return broker.removeItem(payload.key)
  if (payload.value === undefined) return Promise.reject(new Error('Storage value is required'))
  return broker.setItem(payload.key, payload.value)
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

import type { PluginIsolationRpcEndpoint, PluginIsolationRpcMessageListener } from './isolation-rpc'
import type { PluginNetworkBroker, PluginNetworkFetchRequest } from './network-broker'

export interface PluginNetworkRpcBrokerOptions {
  readonly timeoutMs?: number
}

export interface RpcPluginNetworkBroker extends PluginNetworkBroker {
  dispose(): void
}

export interface PluginNetworkRpcServer {
  dispose(): void
}

type NetworkRpcMethod = 'fetch'

interface NetworkRpcRequestMessage {
  readonly protocol: typeof NETWORK_RPC_PROTOCOL
  readonly type: 'request'
  readonly id: string
  readonly method: NetworkRpcMethod
  readonly payload: unknown
}

interface NetworkRpcResponseMessage {
  readonly protocol: typeof NETWORK_RPC_PROTOCOL
  readonly type: 'response'
  readonly id: string
  readonly ok: boolean
  readonly value?: unknown
  readonly error?: {
    readonly message: string
  }
}

type NetworkRpcMessage = NetworkRpcRequestMessage | NetworkRpcResponseMessage

const NETWORK_RPC_PROTOCOL = 'milkup.plugin.network.rpc.v1'
const DEFAULT_TIMEOUT_MS = 5_000

export function createRpcPluginNetworkBroker(
  endpoint: PluginIsolationRpcEndpoint,
  options: PluginNetworkRpcBrokerOptions = {},
): RpcPluginNetworkBroker {
  let nextId = 0
  let disposed = false
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const pending = new Map<
    string,
    {
      resolve(value: unknown): void
      reject(error: Error): void
      timer: ReturnType<typeof setTimeout>
    }
  >()
  const removeListener = addMessageListener(endpoint, (message) => {
    const response = readNetworkRpcMessage(message)

    if (!response || response.type !== 'response') {
      return
    }

    const request = pending.get(response.id)

    if (!request) {
      return
    }

    pending.delete(response.id)
    clearTimeout(request.timer)

    if (response.ok) {
      request.resolve(response.value)
    } else {
      request.reject(new Error(response.error?.message ?? 'Plugin network RPC failed'))
    }
  })

  function call(method: NetworkRpcMethod, payload: unknown): Promise<unknown> {
    if (disposed) {
      return Promise.reject(new Error('Plugin network RPC broker is disposed'))
    }

    const id = `${Date.now().toString(36)}-${nextId.toString(36)}`
    nextId += 1

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id)
        reject(new Error(`Plugin network RPC timed out: ${method}`))
      }, timeoutMs)

      pending.set(id, { resolve, reject, timer })
      endpoint.postMessage({
        protocol: NETWORK_RPC_PROTOCOL,
        type: 'request',
        id,
        method,
        payload,
      } satisfies NetworkRpcRequestMessage)
    })
  }

  return Object.freeze({
    fetch: (request: PluginNetworkFetchRequest) => call('fetch', request),
    dispose: () => {
      disposed = true
      removeListener()

      for (const [id, request] of pending) {
        pending.delete(id)
        clearTimeout(request.timer)
        request.reject(new Error('Plugin network RPC broker is disposed'))
      }
    },
  })
}

export function createPluginNetworkRpcServer(
  endpoint: PluginIsolationRpcEndpoint,
  broker: PluginNetworkBroker,
): PluginNetworkRpcServer {
  const removeListener = addMessageListener(endpoint, async (message) => {
    const request = readNetworkRpcMessage(message)

    if (!request || request.type !== 'request') {
      return
    }

    try {
      const value = await runNetworkRpcRequest(broker, request)

      endpoint.postMessage({
        protocol: NETWORK_RPC_PROTOCOL,
        type: 'response',
        id: request.id,
        ok: true,
        value,
      } satisfies NetworkRpcResponseMessage)
    } catch (error) {
      endpoint.postMessage({
        protocol: NETWORK_RPC_PROTOCOL,
        type: 'response',
        id: request.id,
        ok: false,
        error: {
          message: error instanceof Error ? error.message : String(error),
        },
      } satisfies NetworkRpcResponseMessage)
    }
  })

  return Object.freeze({
    dispose: removeListener,
  })
}

async function runNetworkRpcRequest(
  broker: PluginNetworkBroker,
  request: NetworkRpcRequestMessage,
): Promise<unknown> {
  return broker.fetch(request.payload as PluginNetworkFetchRequest)
}

function addMessageListener(
  endpoint: PluginIsolationRpcEndpoint,
  listener: (message: unknown) => void,
): () => void {
  if (endpoint.addEventListener) {
    const eventListener: PluginIsolationRpcMessageListener = (event) => listener(event.data)

    endpoint.addEventListener('message', eventListener)
    return () => endpoint.removeEventListener?.('message', eventListener)
  }

  if (endpoint.on) {
    endpoint.on('message', listener)
    return () => endpoint.off?.('message', listener)
  }

  throw new Error('Plugin network RPC endpoint does not support message listeners')
}

function readNetworkRpcMessage(message: unknown): NetworkRpcMessage | undefined {
  if (!isRecord(message)) {
    return undefined
  }

  if (message.protocol !== NETWORK_RPC_PROTOCOL) {
    return undefined
  }

  if (message.type !== 'request' && message.type !== 'response') {
    return undefined
  }

  if (typeof message.id !== 'string') {
    return undefined
  }

  return message as unknown as NetworkRpcMessage
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

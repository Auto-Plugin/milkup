import type {
  PluginFileBroker,
  PluginFileBrokerResult,
  PluginFileDeleteRequest,
  PluginFileReadRequest,
  PluginFileWriteRequest,
} from './filesystem-broker'
import type { PluginIsolationRpcEndpoint, PluginIsolationRpcMessageListener } from './isolation-rpc'

export interface PluginFileRpcBrokerOptions {
  readonly timeoutMs?: number
}

export interface RpcPluginFileBroker extends PluginFileBroker {
  dispose(): void
}

export interface PluginFileRpcServer {
  dispose(): void
}

type FileRpcMethod = 'readText' | 'writeText' | 'deleteFile'

interface FileRpcRequestMessage {
  readonly protocol: typeof FILE_RPC_PROTOCOL
  readonly type: 'request'
  readonly id: string
  readonly method: FileRpcMethod
  readonly payload: unknown
}

interface FileRpcResponseMessage {
  readonly protocol: typeof FILE_RPC_PROTOCOL
  readonly type: 'response'
  readonly id: string
  readonly ok: boolean
  readonly value?: unknown
  readonly error?: {
    readonly message: string
  }
}

type FileRpcMessage = FileRpcRequestMessage | FileRpcResponseMessage

const FILE_RPC_PROTOCOL = 'milkup.plugin.filesystem.rpc.v1'
const DEFAULT_TIMEOUT_MS = 5_000

export function createRpcPluginFileBroker(
  endpoint: PluginIsolationRpcEndpoint,
  options: PluginFileRpcBrokerOptions = {},
): RpcPluginFileBroker {
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
    const response = readFileRpcMessage(message)

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
      request.reject(new Error(response.error?.message ?? 'Plugin file RPC failed'))
    }
  })

  function call(method: FileRpcMethod, payload: unknown): Promise<unknown> {
    if (disposed) {
      return Promise.reject(new Error('Plugin file RPC broker is disposed'))
    }

    const id = `${Date.now().toString(36)}-${nextId.toString(36)}`
    nextId += 1

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id)
        reject(new Error(`Plugin file RPC timed out: ${method}`))
      }, timeoutMs)

      pending.set(id, { resolve, reject, timer })
      endpoint.postMessage({
        protocol: FILE_RPC_PROTOCOL,
        type: 'request',
        id,
        method,
        payload,
      } satisfies FileRpcRequestMessage)
    })
  }

  return Object.freeze({
    readText: (request: PluginFileReadRequest) => call('readText', request) as Promise<string>,
    writeText: (request: PluginFileWriteRequest) =>
      call('writeText', request) as Promise<PluginFileBrokerResult>,
    deleteFile: (request: PluginFileDeleteRequest) =>
      call('deleteFile', request) as Promise<PluginFileBrokerResult>,
    dispose: () => {
      disposed = true
      removeListener()

      for (const [id, request] of pending) {
        pending.delete(id)
        clearTimeout(request.timer)
        request.reject(new Error('Plugin file RPC broker is disposed'))
      }
    },
  })
}

export function createPluginFileRpcServer(
  endpoint: PluginIsolationRpcEndpoint,
  broker: PluginFileBroker,
): PluginFileRpcServer {
  const removeListener = addMessageListener(endpoint, async (message) => {
    const request = readFileRpcMessage(message)

    if (!request || request.type !== 'request') {
      return
    }

    try {
      const value = await runFileRpcRequest(broker, request)

      endpoint.postMessage({
        protocol: FILE_RPC_PROTOCOL,
        type: 'response',
        id: request.id,
        ok: true,
        value,
      } satisfies FileRpcResponseMessage)
    } catch (error) {
      endpoint.postMessage({
        protocol: FILE_RPC_PROTOCOL,
        type: 'response',
        id: request.id,
        ok: false,
        error: {
          message: error instanceof Error ? error.message : String(error),
        },
      } satisfies FileRpcResponseMessage)
    }
  })

  return Object.freeze({
    dispose: removeListener,
  })
}

async function runFileRpcRequest(
  broker: PluginFileBroker,
  request: FileRpcRequestMessage,
): Promise<unknown> {
  if (request.method === 'readText') {
    return broker.readText(request.payload as PluginFileReadRequest)
  }

  if (request.method === 'writeText') {
    return broker.writeText(request.payload as PluginFileWriteRequest)
  }

  return broker.deleteFile(request.payload as PluginFileDeleteRequest)
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

  throw new Error('Plugin file RPC endpoint does not support message listeners')
}

function readFileRpcMessage(message: unknown): FileRpcMessage | undefined {
  if (!isRecord(message)) {
    return undefined
  }

  if (message.protocol !== FILE_RPC_PROTOCOL) {
    return undefined
  }

  if (message.type !== 'request' && message.type !== 'response') {
    return undefined
  }

  if (typeof message.id !== 'string') {
    return undefined
  }

  return message as unknown as FileRpcMessage
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

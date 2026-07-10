import type {
  PluginDocumentBroker,
  PluginDocumentScanEvent,
  PluginDocumentScanRequest,
  PluginDocumentScanStartResult,
} from './document-broker'
import type { PluginIsolationRpcEndpoint, PluginIsolationRpcMessageListener } from './isolation-rpc'

export interface PluginDocumentRpcBrokerOptions {
  readonly timeoutMs?: number
}

export interface RpcPluginDocumentBroker extends PluginDocumentBroker {
  dispose(): void
}

export interface PluginDocumentRpcServer {
  dispose(): void
}

type DocumentRpcMethod = 'start' | 'next' | 'cancel'

interface DocumentRpcRequestMessage {
  readonly protocol: typeof DOCUMENT_RPC_PROTOCOL
  readonly type: 'request'
  readonly id: string
  readonly method: DocumentRpcMethod
  readonly payload: unknown
}

interface DocumentRpcResponseMessage {
  readonly protocol: typeof DOCUMENT_RPC_PROTOCOL
  readonly type: 'response'
  readonly id: string
  readonly ok: boolean
  readonly value?: unknown
  readonly error?: { readonly message: string }
}

type DocumentRpcMessage = DocumentRpcRequestMessage | DocumentRpcResponseMessage

const DOCUMENT_RPC_PROTOCOL = 'milkup.plugin.document.rpc.v1'
const DEFAULT_TIMEOUT_MS = 30_000

export function createRpcPluginDocumentBroker(
  endpoint: PluginIsolationRpcEndpoint,
  options: PluginDocumentRpcBrokerOptions = {},
): RpcPluginDocumentBroker {
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
    const response = readDocumentRpcMessage(message)

    if (!response || response.type !== 'response') return
    const request = pending.get(response.id)
    if (!request) return
    pending.delete(response.id)
    clearTimeout(request.timer)
    if (response.ok) request.resolve(response.value)
    else request.reject(new Error(response.error?.message ?? 'Plugin document RPC failed'))
  })

  function call(method: DocumentRpcMethod, payload: unknown): Promise<unknown> {
    if (disposed) {
      return Promise.reject(new Error('Plugin document RPC broker is disposed'))
    }

    const id = `${Date.now().toString(36)}-${(nextId++).toString(36)}`
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id)
        reject(new Error(`Plugin document RPC timed out: ${method}`))
      }, timeoutMs)
      pending.set(id, { resolve, reject, timer })
      endpoint.postMessage({
        protocol: DOCUMENT_RPC_PROTOCOL,
        type: 'request',
        id,
        method,
        payload,
      } satisfies DocumentRpcRequestMessage)
    })
  }

  return Object.freeze({
    start: (request: PluginDocumentScanRequest) =>
      call('start', request) as Promise<PluginDocumentScanStartResult>,
    next: (scanId: string) => call('next', { scanId }) as Promise<PluginDocumentScanEvent>,
    cancel: async (scanId: string): Promise<void> => {
      await call('cancel', { scanId })
    },
    dispose: () => {
      disposed = true
      removeListener()
      for (const request of pending.values()) {
        clearTimeout(request.timer)
        request.reject(new Error('Plugin document RPC broker is disposed'))
      }
      pending.clear()
    },
  })
}

export function createPluginDocumentRpcServer(
  endpoint: PluginIsolationRpcEndpoint,
  broker: PluginDocumentBroker,
): PluginDocumentRpcServer {
  const removeListener = addMessageListener(endpoint, async (message) => {
    const request = readDocumentRpcMessage(message)

    if (!request || request.type !== 'request') return

    try {
      const value = await runDocumentRpcRequest(broker, request)
      endpoint.postMessage({
        protocol: DOCUMENT_RPC_PROTOCOL,
        type: 'response',
        id: request.id,
        ok: true,
        value,
      } satisfies DocumentRpcResponseMessage)
    } catch (error) {
      endpoint.postMessage({
        protocol: DOCUMENT_RPC_PROTOCOL,
        type: 'response',
        id: request.id,
        ok: false,
        error: { message: error instanceof Error ? error.message : String(error) },
      } satisfies DocumentRpcResponseMessage)
    }
  })

  return Object.freeze({ dispose: removeListener })
}

function runDocumentRpcRequest(
  broker: PluginDocumentBroker,
  request: DocumentRpcRequestMessage,
): Promise<unknown> {
  if (request.method === 'start') {
    return broker.start(request.payload as PluginDocumentScanRequest)
  }

  const scanId = readScanId(request.payload)
  return request.method === 'next' ? broker.next(scanId) : broker.cancel(scanId)
}

function readScanId(payload: unknown): string {
  if (!isRecord(payload) || typeof payload.scanId !== 'string') {
    throw new Error('Document scan id is required')
  }
  return payload.scanId
}

function addMessageListener(
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
  throw new Error('Plugin document RPC endpoint does not support message listeners')
}

function readDocumentRpcMessage(value: unknown): DocumentRpcMessage | undefined {
  if (!isRecord(value)) return undefined
  if (value.protocol !== DOCUMENT_RPC_PROTOCOL || typeof value.id !== 'string') return undefined
  if (value.type !== 'request' && value.type !== 'response') return undefined
  return value as unknown as DocumentRpcMessage
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

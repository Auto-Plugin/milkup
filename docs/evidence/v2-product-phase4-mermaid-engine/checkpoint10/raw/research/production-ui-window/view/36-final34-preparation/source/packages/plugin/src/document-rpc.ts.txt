import type {
  PluginDocumentBroker,
  PluginDocumentScanEvent,
  PluginDocumentScanRequest,
  PluginDocumentScanStartResult,
  PluginDocumentReadWindowRequest,
  PluginDocumentReadWindowResult,
  PluginDocumentReadOptions,
  PluginDocumentInvalidatePresentationRequest,
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

type DocumentRpcMethod = 'start' | 'next' | 'cancel' | 'readWindow' | 'invalidatePresentation'

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

interface DocumentRpcCancelMessage {
  readonly protocol: typeof DOCUMENT_RPC_PROTOCOL
  readonly type: 'cancelRequest'
  readonly id: string
}
type DocumentRpcMessage =
  DocumentRpcRequestMessage | DocumentRpcResponseMessage | DocumentRpcCancelMessage

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
      cleanup(): void
    }
  >()
  const removeListener = addMessageListener(endpoint, (message) => {
    const response = readDocumentRpcMessage(message)

    if (!response || response.type !== 'response') return
    const request = pending.get(response.id)
    if (!request) return
    pending.delete(response.id)
    clearTimeout(request.timer)
    request.cleanup()
    if (response.ok) request.resolve(response.value)
    else request.reject(new Error(response.error?.message ?? 'Plugin document RPC failed'))
  })

  function call(
    method: DocumentRpcMethod,
    payload: unknown,
    signal?: AbortSignal,
  ): Promise<unknown> {
    if (disposed) {
      return Promise.reject(new Error('Plugin document RPC broker is disposed'))
    }
    if (signal?.aborted) return Promise.reject(new Error('Plugin document RPC aborted'))
    if (pending.size >= 32)
      return Promise.reject(new Error('Plugin document RPC request limit reached'))

    const id = `${Date.now().toString(36)}-${(nextId++).toString(36)}`
    return new Promise((resolve, reject) => {
      const cancel = () => {
        try {
          endpoint.postMessage({
            protocol: DOCUMENT_RPC_PROTOCOL,
            type: 'cancelRequest',
            id,
          } satisfies DocumentRpcCancelMessage)
        } catch {
          /* Transport already gone. */
        }
      }
      const abort = () => {
        const entry = pending.get(id)
        if (!entry) return
        pending.delete(id)
        clearTimeout(entry.timer)
        entry.cleanup()
        cancel()
        reject(new Error('Plugin document RPC aborted'))
      }
      const timer = setTimeout(() => {
        pending.delete(id)
        signal?.removeEventListener('abort', abort)
        cancel()
        reject(new Error(`Plugin document RPC timed out: ${method}`))
      }, timeoutMs)
      pending.set(id, {
        resolve,
        reject,
        timer,
        cleanup: () => signal?.removeEventListener('abort', abort),
      })
      signal?.addEventListener('abort', abort, { once: true })
      try {
        endpoint.postMessage({
          protocol: DOCUMENT_RPC_PROTOCOL,
          type: 'request',
          id,
          method,
          payload,
        } satisfies DocumentRpcRequestMessage)
      } catch (error) {
        pending.delete(id)
        clearTimeout(timer)
        signal?.removeEventListener('abort', abort)
        reject(error)
      }
    })
  }

  return Object.freeze({
    readWindow: (request: PluginDocumentReadWindowRequest, options?: PluginDocumentReadOptions) =>
      call('readWindow', request, options?.signal) as Promise<PluginDocumentReadWindowResult>,
    invalidatePresentation: async (request: PluginDocumentInvalidatePresentationRequest) => {
      await call('invalidatePresentation', request)
    },
    start: (request: PluginDocumentScanRequest) =>
      call('start', request) as Promise<PluginDocumentScanStartResult>,
    next: (scanId: string) => call('next', { scanId }) as Promise<PluginDocumentScanEvent>,
    cancel: async (scanId: string): Promise<void> => {
      await call('cancel', { scanId })
    },
    dispose: () => {
      disposed = true
      removeListener()
      for (const [id, request] of pending) {
        clearTimeout(request.timer)
        request.cleanup()
        try {
          endpoint.postMessage({
            protocol: DOCUMENT_RPC_PROTOCOL,
            type: 'cancelRequest',
            id,
          } satisfies DocumentRpcCancelMessage)
        } catch {
          /* Transport already gone. */
        }
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
  let disposed = false
  const operations = new Map<string, AbortController>()
  const removeListener = addMessageListener(endpoint, async (message) => {
    const request = readDocumentRpcMessage(message)
    if (disposed || !request) return
    if (request.type === 'cancelRequest') {
      operations.get(request.id)?.abort()
      return
    }
    if (!request || request.type !== 'request') return
    if (operations.has(request.id) || operations.size >= 32) return
    const controller = new AbortController()
    operations.set(request.id, controller)
    try {
      const value = await runDocumentRpcRequest(broker, request, controller.signal)
      if (disposed || controller.signal.aborted) return
      endpoint.postMessage({
        protocol: DOCUMENT_RPC_PROTOCOL,
        type: 'response',
        id: request.id,
        ok: true,
        value,
      } satisfies DocumentRpcResponseMessage)
    } catch (error) {
      if (disposed || controller.signal.aborted) return
      endpoint.postMessage({
        protocol: DOCUMENT_RPC_PROTOCOL,
        type: 'response',
        id: request.id,
        ok: false,
        error: { message: error instanceof Error ? error.message : String(error) },
      } satisfies DocumentRpcResponseMessage)
    } finally {
      operations.delete(request.id)
    }
  })

  return Object.freeze({
    dispose: () => {
      if (disposed) return
      disposed = true
      removeListener()
      for (const operation of operations.values()) operation.abort()
      operations.clear()
      broker.dispose?.()
    },
  })
}

function runDocumentRpcRequest(
  broker: PluginDocumentBroker,
  request: DocumentRpcRequestMessage,
  signal: AbortSignal,
): Promise<unknown> {
  if (request.method === 'readWindow') {
    if (!broker.readWindow)
      return Promise.reject(new Error('Plugin document windows are unavailable'))
    return broker.readWindow(request.payload as PluginDocumentReadWindowRequest, { signal })
  }
  if (request.method === 'invalidatePresentation') {
    if (!broker.invalidatePresentation)
      return Promise.reject(new Error('Plugin presentation invalidation is unavailable'))
    return broker.invalidatePresentation(
      request.payload as PluginDocumentInvalidatePresentationRequest,
      { signal },
    )
  }
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
  if (
    value.protocol !== DOCUMENT_RPC_PROTOCOL ||
    typeof value.id !== 'string' ||
    value.id.length > 128
  )
    return undefined
  if (value.type !== 'request' && value.type !== 'response' && value.type !== 'cancelRequest')
    return undefined
  if (
    value.type === 'request' &&
    !['start', 'next', 'cancel', 'readWindow', 'invalidatePresentation'].includes(
      value.method as string,
    )
  )
    return undefined
  return value as unknown as DocumentRpcMessage
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

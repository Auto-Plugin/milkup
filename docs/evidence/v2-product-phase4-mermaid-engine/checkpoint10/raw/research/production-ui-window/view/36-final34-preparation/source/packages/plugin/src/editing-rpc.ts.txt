import type { PluginIsolationRpcEndpoint, PluginIsolationRpcMessageListener } from './isolation-rpc'
import type { PluginEditingBroker } from './editing-broker'
import {
  PluginEditingError,
  PLUGIN_EDITING_ERROR_CODES as CODES,
  editingRecord as record,
  editingKeys as keys,
  assertPluginEditingId,
  copyPluginEditingCaptureRequest,
  copyPluginEditingSnapshot,
  copyPluginEditingApplyRequest,
  copyPluginEditingTableRequest,
  copyPluginEditingApplyResult,
  type PluginEditingErrorCode,
  type PluginEditingCaptureRequest,
  type PluginEditingSnapshot,
  type PluginEditingApplyRequest,
  type PluginEditingTableRequest,
  type PluginEditingApplyResult,
  type PluginEditingOperationOptions,
} from './editing-schema'
const PROTOCOL = 'milkup.plugin.editing.rpc.v1'
const METHODS = ['capture', 'apply', 'table', 'release'] as const
type Method = (typeof METHODS)[number]
export interface RpcPluginEditingBroker extends PluginEditingBroker {
  dispose(): void
}
export interface PluginEditingRpcServer {
  dispose(): void
}
function validatePayload(
  method: Method,
  payload: unknown,
): asserts payload is Record<string, unknown> {
  if (!record(payload) || !keys(payload, method === 'release' ? ['id'] : ['request']))
    throw new PluginEditingError('invalid-input')
  if (method === 'capture') copyPluginEditingCaptureRequest(payload.request)
  else if (method === 'apply') copyPluginEditingApplyRequest(payload.request)
  else if (method === 'table') copyPluginEditingTableRequest(payload.request)
  else assertPluginEditingId(payload.id)
}
function validateResponse(method: Method, value: unknown): void {
  if (method === 'capture') copyPluginEditingSnapshot(value)
  else if (method === 'release') {
    if (value !== undefined) throw new PluginEditingError('unavailable')
  } else copyPluginEditingApplyResult(value)
}
export function createRpcPluginEditingBroker(
  endpoint: PluginIsolationRpcEndpoint,
  timeoutMs = 30_000,
): RpcPluginEditingBroker {
  let disposed = false
  let nextId = 0
  const pending = new Map<
    string,
    {
      method: Method
      resolve: (value: unknown) => void
      reject: (error: Error) => void
      cleanup: () => void
    }
  >()
  const cancel = (id: string) => {
    try {
      endpoint.postMessage({ protocol: PROTOCOL, type: 'cancel', id })
    } catch {
      /* Endpoint is already gone. */
    }
  }
  const dispose = () => {
    if (disposed) return
    disposed = true
    remove()
    for (const [id, request] of pending) {
      cancel(id)
      request.cleanup()
      request.reject(new PluginEditingError('revoked'))
    }
    pending.clear()
    try {
      endpoint.postMessage({ protocol: PROTOCOL, type: 'close' })
    } catch {
      /* Gone. */
    }
  }
  const remove = listen(endpoint, (message) => {
    if (!record(message) || message.protocol !== PROTOCOL) return
    if (message.type === 'revoked' && keys(message, ['protocol', 'type'])) {
      dispose()
      return
    }
    if (message.type !== 'response' || typeof message.id !== 'string') return
    const request = pending.get(message.id)
    if (!request) return
    pending.delete(message.id)
    request.cleanup()
    try {
      if (message.ok === true && keys(message, ['protocol', 'type', 'id', 'ok', 'value'])) {
        validateResponse(request.method, message.value)
        request.resolve(message.value)
      } else if (
        message.ok === false &&
        keys(message, ['protocol', 'type', 'id', 'ok', 'error']) &&
        record(message.error) &&
        keys(message.error, ['code']) &&
        CODES.includes(message.error.code as PluginEditingErrorCode)
      ) {
        request.reject(new PluginEditingError(message.error.code as PluginEditingErrorCode))
      } else throw new PluginEditingError('unavailable')
    } catch {
      cancel(message.id)
      request.reject(new PluginEditingError('unavailable'))
    }
  })
  const call = (
    method: Method,
    payload: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<unknown> => {
    if (disposed) return Promise.reject(new PluginEditingError('revoked'))
    if (signal?.aborted) return Promise.reject(new PluginEditingError('aborted'))
    if (pending.size >= 16) return Promise.reject(new PluginEditingError('busy'))
    try {
      validatePayload(method, payload)
    } catch (error) {
      return Promise.reject(error)
    }
    const id = `editing-${nextId++}`
    return new Promise((resolve, reject) => {
      const stop = (code: PluginEditingErrorCode) => {
        const current = pending.get(id)
        if (!current) return
        pending.delete(id)
        current.cleanup()
        cancel(id)
        reject(new PluginEditingError(code))
      }
      const abort = () => stop('aborted')
      const timer = setTimeout(() => stop('aborted'), timeoutMs)
      pending.set(id, {
        method,
        resolve,
        reject,
        cleanup: () => {
          clearTimeout(timer)
          signal?.removeEventListener('abort', abort)
        },
      })
      signal?.addEventListener('abort', abort, { once: true })
      try {
        endpoint.postMessage({ protocol: PROTOCOL, type: 'request', id, method, payload })
      } catch {
        stop('unavailable')
      }
    })
  }
  return Object.freeze({
    capture: (request: PluginEditingCaptureRequest, options?: PluginEditingOperationOptions) =>
      call('capture', { request }, options?.signal) as Promise<PluginEditingSnapshot>,
    apply: (request: PluginEditingApplyRequest, options?: PluginEditingOperationOptions) =>
      call('apply', { request }, options?.signal) as Promise<PluginEditingApplyResult>,
    table: (request: PluginEditingTableRequest, options?: PluginEditingOperationOptions) =>
      call('table', { request }, options?.signal) as Promise<PluginEditingApplyResult>,
    release: async (id: string, options?: PluginEditingOperationOptions) => {
      await call('release', { id }, options?.signal)
    },
    dispose,
  })
}

export function createPluginEditingRpcServer(
  endpoint: PluginIsolationRpcEndpoint,
  broker: PluginEditingBroker,
): PluginEditingRpcServer {
  let disposed = false
  const active = new Map<string, AbortController>()
  const transactions = new Set<string>()
  const dispose = () => {
    if (disposed) return
    disposed = true
    remove()
    for (const controller of active.values()) controller.abort()
    active.clear()
    for (const id of transactions) void broker.release(id).catch(() => undefined)
    transactions.clear()
    try {
      endpoint.postMessage({ protocol: PROTOCOL, type: 'revoked' })
    } catch {
      /* Gone. */
    }
  }
  const remove = listen(endpoint, async (message) => {
    if (
      record(message) &&
      message.protocol === PROTOCOL &&
      message.type === 'close' &&
      keys(message, ['protocol', 'type'])
    ) {
      dispose()
      return
    }
    if (
      disposed ||
      !record(message) ||
      message.protocol !== PROTOCOL ||
      typeof message.id !== 'string' ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(message.id)
    )
      return
    if (message.type === 'cancel' && keys(message, ['protocol', 'type', 'id'])) {
      active.get(message.id)?.abort()
      return
    }
    if (message.type !== 'request' || active.has(message.id)) return
    const reply = (data: Record<string, unknown>) => {
      if (!disposed)
        endpoint.postMessage({ protocol: PROTOCOL, type: 'response', id: message.id, ...data })
    }
    if (active.size >= 16) {
      reply({ ok: false, error: { code: 'busy' } })
      return
    }
    const controller = new AbortController()
    active.set(message.id, controller)
    try {
      if (
        !keys(message, ['protocol', 'type', 'id', 'method', 'payload']) ||
        !METHODS.includes(message.method as Method)
      )
        throw new PluginEditingError('invalid-input')
      const method = message.method as Method
      validatePayload(method, message.payload)
      const payload = message.payload
      const options = { signal: controller.signal }
      let value: unknown
      if (method === 'capture') {
        value = await broker.capture(
          payload.request as unknown as PluginEditingCaptureRequest,
          options,
        )
        const id = (value as PluginEditingSnapshot).id
        if (controller.signal.aborted || disposed) await broker.release(id).catch(() => undefined)
        else transactions.add(id)
      } else if (method === 'apply') {
        value = await broker.apply(payload.request as unknown as PluginEditingApplyRequest, options)
        transactions.delete((payload.request as PluginEditingApplyRequest).snapshotId)
      } else if (method === 'table') {
        value = await broker.table(payload.request as unknown as PluginEditingTableRequest, options)
        transactions.delete((payload.request as PluginEditingTableRequest).snapshotId)
      } else {
        value = await broker.release(payload.id as string, options)
        transactions.delete(payload.id as string)
      }
      if (!controller.signal.aborted) {
        validateResponse(method, value)
        reply({ ok: true, value })
      }
    } catch (error) {
      if (!controller.signal.aborted)
        reply({
          ok: false,
          error: { code: error instanceof PluginEditingError ? error.code : 'unavailable' },
        })
    } finally {
      active.delete(message.id)
    }
  })
  return Object.freeze({ dispose })
}

function listen(
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
  throw new Error('Editing endpoint does not support listeners')
}

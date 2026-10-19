import type { PluginIsolationRpcEndpoint, PluginIsolationRpcMessageListener } from './isolation-rpc'
import type { PluginOutputBroker } from './output-broker'
import {
  PluginOutputError,
  PLUGIN_OUTPUT_ERROR_CODES as CODES,
  assertPluginOutputId,
  copyPluginOutputCaptureRequest,
  copyPluginOutputSnapshot,
  copyPluginOutputChooseTargetRequest,
  copyPluginOutputTargetResult,
  copyPluginOutputWriteResult,
  copyPluginOutputPrintResult,
  type PluginOutputErrorCode,
  type PluginOutputCaptureRequest,
  type PluginOutputSnapshot,
  type PluginOutputChooseTargetRequest,
  type PluginOutputTargetResult,
  type PluginOutputWriteResult,
  type PluginOutputPrintResult,
  type PluginOutputOperationOptions,
} from './output-schema'
import { editingRecord as record, editingKeys as keys } from './editing-schema'
import type { PluginOutputGestureOptions } from './output-broker'
const PROTOCOL = 'milkup.plugin.output.rpc.v1'
const METHODS = ['capture', 'chooseTarget', 'write', 'print', 'release'] as const
type Method = (typeof METHODS)[number]
export interface RpcPluginOutputBroker extends PluginOutputBroker {
  dispose(): void
}
export interface PluginOutputRpcServer {
  dispose(): void
}
function validatePayload(
  method: Method,
  payload: unknown,
): asserts payload is Record<string, unknown> {
  if (
    !record(payload) ||
    !keys(
      payload,
      method === 'capture' || method === 'chooseTarget' ? ['request'] : ['id'],
      method === 'capture' ? ['gesture'] : [],
    )
  )
    throw new PluginOutputError('invalid-input')
  if (method === 'capture') {
    copyPluginOutputCaptureRequest(payload.request)
    if (payload.gesture !== undefined) assertPluginOutputId(payload.gesture)
  } else if (method === 'chooseTarget') copyPluginOutputChooseTargetRequest(payload.request)
  else assertPluginOutputId(payload.id)
}
function validateResponse(method: Method, value: unknown): unknown {
  if (method === 'capture') return copyPluginOutputSnapshot(value)
  if (method === 'chooseTarget') return copyPluginOutputTargetResult(value)
  if (method === 'write') return copyPluginOutputWriteResult(value)
  if (method === 'print') return copyPluginOutputPrintResult(value)
  if (value !== undefined) throw new PluginOutputError('unavailable')
}
function commits(method: Method) {
  return method === 'write' || method === 'print'
}
export function createRpcPluginOutputBroker(
  endpoint: PluginIsolationRpcEndpoint,
  timeoutMs = 300_000,
): RpcPluginOutputBroker {
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
      request.reject(new PluginOutputError('revoked'))
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
        request.resolve(validateResponse(request.method, message.value))
      } else if (
        message.ok === false &&
        keys(message, ['protocol', 'type', 'id', 'ok', 'error']) &&
        record(message.error) &&
        keys(message.error, ['code']) &&
        CODES.includes(message.error.code as PluginOutputErrorCode)
      ) {
        request.reject(new PluginOutputError(message.error.code as PluginOutputErrorCode))
      } else throw new PluginOutputError('unavailable')
    } catch {
      cancel(message.id)
      request.reject(new PluginOutputError('unavailable'))
    }
  })
  const call = (
    method: Method,
    payload: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<unknown> => {
    if (disposed) return Promise.reject(new PluginOutputError('revoked'))
    if (signal?.aborted) return Promise.reject(new PluginOutputError('aborted'))
    if (pending.size >= 16) return Promise.reject(new PluginOutputError('busy'))
    try {
      validatePayload(method, payload)
    } catch (error) {
      return Promise.reject(error)
    }
    const id = `output-${nextId++}`
    return new Promise((resolve, reject) => {
      const stop = (code: PluginOutputErrorCode) => {
        const current = pending.get(id)
        if (!current) return
        pending.delete(id)
        current.cleanup()
        cancel(id)
        reject(new PluginOutputError(code))
      }
      // A commit may already have happened. Ask the host to cancel and wait for
      // its terminal acknowledgement instead of manufacturing a false failure.
      const abort = () => (commits(method) ? cancel(id) : stop('aborted'))
      const timer = setTimeout(abort, timeoutMs)
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
    capture: (request: PluginOutputCaptureRequest, options?: PluginOutputGestureOptions) =>
      call(
        'capture',
        { request, ...(options?.gesture ? { gesture: options.gesture } : {}) },
        options?.signal,
      ) as Promise<PluginOutputSnapshot>,
    chooseTarget: (
      request: PluginOutputChooseTargetRequest,
      options?: PluginOutputOperationOptions,
    ) => call('chooseTarget', { request }, options?.signal) as Promise<PluginOutputTargetResult>,
    write: (id: string, options?: PluginOutputOperationOptions) =>
      call('write', { id }, options?.signal) as Promise<PluginOutputWriteResult>,
    print: (id: string, options?: PluginOutputOperationOptions) =>
      call('print', { id }, options?.signal) as Promise<PluginOutputPrintResult>,
    release: async (id: string, options?: PluginOutputOperationOptions) => {
      await call('release', { id }, options?.signal)
    },
    dispose,
  })
}

export function createPluginOutputRpcServer(
  endpoint: PluginIsolationRpcEndpoint,
  broker: PluginOutputBroker,
): PluginOutputRpcServer {
  let disposed = false
  const active = new Map<string, AbortController>()
  const transactions = new Set<string>()
  // A cancellation can arrive after the host sent a lease but before the client
  // received it. Retain the request-to-lease mapping to reclaim that lost reply.
  const delivered = new Map<string, string>()
  const dispose = () => {
    if (disposed) return
    disposed = true
    remove()
    for (const controller of active.values()) controller.abort()
    active.clear()
    for (const id of transactions) void broker.release(id).catch(() => undefined)
    transactions.clear()
    delivered.clear()
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
      const id = delivered.get(message.id)
      if (id) {
        delivered.delete(message.id)
        transactions.delete(id)
        void broker.release(id).catch(() => undefined)
      }
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
        throw new PluginOutputError('invalid-input')
      const method = message.method as Method
      validatePayload(method, message.payload)
      const payload = message.payload
      const options = { signal: controller.signal }
      let value: unknown
      if (method === 'capture')
        value = await broker.capture(payload.request as unknown as PluginOutputCaptureRequest, {
          ...options,
          ...(payload.gesture ? { gesture: payload.gesture as string } : {}),
        })
      else if (method === 'chooseTarget')
        value = await broker.chooseTarget(
          payload.request as unknown as PluginOutputChooseTargetRequest,
          options,
        )
      else if (method === 'write') value = await broker.write(payload.id as string, options)
      else if (method === 'print') value = await broker.print(payload.id as string, options)
      else {
        value = await broker.release(payload.id as string, options)
        transactions.delete(payload.id as string)
      }
      if (
        (method === 'capture' || method === 'chooseTarget') &&
        record(value) &&
        typeof value.id === 'string'
      ) {
        if (controller.signal.aborted || disposed)
          await broker.release(value.id).catch(() => undefined)
        else {
          transactions.add(value.id)
          delivered.set(message.id, value.id)
          if (delivered.size > 128) delivered.delete(delivered.keys().next().value!)
          if (transactions.size > 128) {
            const oldest = transactions.values().next().value!
            transactions.delete(oldest)
            void broker.release(oldest).catch(() => undefined)
          }
        }
      }
      if (!controller.signal.aborted || commits(method)) {
        const safe = validateResponse(method, value)
        reply({ ok: true, value: safe })
      }
    } catch (error) {
      if (!controller.signal.aborted || commits(message.method as Method))
        reply({
          ok: false,
          error: { code: error instanceof PluginOutputError ? error.code : 'unavailable' },
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
  throw new Error('Output endpoint does not support listeners')
}

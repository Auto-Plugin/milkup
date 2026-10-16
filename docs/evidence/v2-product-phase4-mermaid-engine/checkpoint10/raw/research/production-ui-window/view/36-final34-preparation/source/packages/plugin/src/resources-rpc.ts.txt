import type { PluginIsolationRpcEndpoint, PluginIsolationRpcMessageListener } from './isolation-rpc'
import type { PluginResourcesBroker } from './resources-broker'
import {
  PluginResourcesError,
  PLUGIN_RESOURCES_ERROR_CODES as CODES,
  assertPluginResourcesId,
  copyPluginResourcesPrepareRequest,
  copyPluginResourcesPrepareResult,
  copyPluginResourcesSource,
  copyPluginResourcesStageRequest,
  copyPluginResourcesAsset,
  type PluginResourcesErrorCode,
  type PluginResourcesPrepareRequest,
  type PluginResourcesPrepareResult,
  type PluginResourcesSource,
  type PluginResourcesStageRequest,
  type PluginResourcesAsset,
  type PluginResourcesOperationOptions,
} from './resources-schema'
import { editingRecord as record, editingKeys as keys } from './editing-schema'
import type { PluginResourcesGestureOptions } from './resources-broker'
const PROTOCOL = 'milkup.plugin.resources.rpc.v1'
const METHODS = ['prepareDocument', 'choose', 'stage', 'abort'] as const
type Method = (typeof METHODS)[number]
export interface RpcPluginResourcesBroker extends PluginResourcesBroker {
  dispose(): void
}
export interface PluginResourcesRpcServer {
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
      method === 'prepareDocument' ? ['request'] : method === 'stage' ? ['request'] : ['id'],
      method === 'prepareDocument' ? ['gesture'] : [],
    )
  )
    throw new PluginResourcesError('invalid-input')
  if (method === 'prepareDocument') {
    copyPluginResourcesPrepareRequest(payload.request)
    if (payload.gesture !== undefined) assertPluginResourcesId(payload.gesture)
  } else if (method === 'stage') copyPluginResourcesStageRequest(payload.request)
  else assertPluginResourcesId(payload.id)
}
function validateResponse(method: Method, value: unknown): void {
  if (method === 'prepareDocument') copyPluginResourcesPrepareResult(value)
  else if (method === 'choose') copyPluginResourcesSource(value)
  else if (method === 'stage') copyPluginResourcesAsset(value)
  else if (value !== undefined) throw new PluginResourcesError('unavailable')
}
export function createRpcPluginResourcesBroker(
  endpoint: PluginIsolationRpcEndpoint,
  timeoutMs = 300_000,
): RpcPluginResourcesBroker {
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
      request.reject(new PluginResourcesError('revoked'))
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
        CODES.includes(message.error.code as PluginResourcesErrorCode)
      ) {
        request.reject(new PluginResourcesError(message.error.code as PluginResourcesErrorCode))
      } else throw new PluginResourcesError('unavailable')
    } catch {
      cancel(message.id)
      request.reject(new PluginResourcesError('unavailable'))
    }
  })
  const call = (
    method: Method,
    payload: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<unknown> => {
    if (disposed) return Promise.reject(new PluginResourcesError('revoked'))
    if (signal?.aborted) return Promise.reject(new PluginResourcesError('aborted'))
    if (pending.size >= 16) return Promise.reject(new PluginResourcesError('busy'))
    try {
      validatePayload(method, payload)
    } catch (error) {
      return Promise.reject(error)
    }
    const id = `resources-${nextId++}`
    return new Promise((resolve, reject) => {
      const stop = (code: PluginResourcesErrorCode) => {
        const current = pending.get(id)
        if (!current) return
        pending.delete(id)
        current.cleanup()
        cancel(id)
        reject(new PluginResourcesError(code))
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
    prepareDocument: (
      request?: PluginResourcesPrepareRequest,
      options?: PluginResourcesGestureOptions,
    ) =>
      call(
        'prepareDocument',
        { request: request ?? {}, ...(options?.gesture ? { gesture: options.gesture } : {}) },
        options?.signal,
      ) as Promise<PluginResourcesPrepareResult>,
    choose: (id: string, options?: PluginResourcesOperationOptions) =>
      call('choose', { id }, options?.signal) as Promise<PluginResourcesSource | null>,
    stage: (request: PluginResourcesStageRequest, options?: PluginResourcesOperationOptions) =>
      call('stage', { request }, options?.signal) as Promise<PluginResourcesAsset>,
    abort: async (id: string, options?: PluginResourcesOperationOptions) => {
      await call('abort', { id }, options?.signal)
    },
    dispose,
  })
}

export function createPluginResourcesRpcServer(
  endpoint: PluginIsolationRpcEndpoint,
  broker: PluginResourcesBroker,
): PluginResourcesRpcServer {
  let disposed = false
  const active = new Map<string, AbortController>()
  const transactions = new Set<string>()
  const dispose = () => {
    if (disposed) return
    disposed = true
    remove()
    for (const controller of active.values()) controller.abort()
    active.clear()
    for (const id of transactions) void broker.abort(id).catch(() => undefined)
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
        throw new PluginResourcesError('invalid-input')
      const method = message.method as Method
      validatePayload(method, message.payload)
      const payload = message.payload
      const options = { signal: controller.signal }
      let value: unknown
      if (method === 'prepareDocument')
        value = await broker.prepareDocument(payload.request as PluginResourcesPrepareRequest, {
          ...options,
          ...(payload.gesture ? { gesture: payload.gesture as string } : {}),
        })
      else if (method === 'choose') value = await broker.choose(payload.id as string, options)
      else if (method === 'stage')
        value = await broker.stage(
          payload.request as unknown as PluginResourcesStageRequest,
          options,
        )
      else {
        value = await broker.abort(payload.id as string, options)
        transactions.delete(payload.id as string)
      }
      if (method !== 'abort' && record(value) && typeof value.id === 'string') {
        if (controller.signal.aborted || disposed)
          await broker.abort(value.id).catch(() => undefined)
        else {
          transactions.add(value.id)
          if (transactions.size > 128) {
            const oldest = transactions.values().next().value!
            transactions.delete(oldest)
            void broker.abort(oldest).catch(() => undefined)
          }
        }
      }
      if (!controller.signal.aborted) {
        validateResponse(method, value)
        reply({ ok: true, value })
      }
    } catch (error) {
      if (!controller.signal.aborted)
        reply({
          ok: false,
          error: { code: error instanceof PluginResourcesError ? error.code : 'unavailable' },
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
  throw new Error('Resources endpoint does not support listeners')
}

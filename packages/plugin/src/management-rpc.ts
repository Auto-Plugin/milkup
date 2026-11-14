import type { PluginIsolationRpcEndpoint, PluginIsolationRpcMessageListener } from './isolation-rpc'
import type { PluginManagementBroker, PluginManagementGestureOptions } from './management-broker'
import {
  PluginManagementError,
  PLUGIN_MANAGEMENT_ERROR_CODES,
  PLUGIN_MANAGEMENT_LIMITS,
  managementRecord as record,
  managementKeys as keys,
  copyPluginManagementIdentity,
  copyPluginManagementHostViewRequest,
  copyPluginManagementSnapshot,
  copyPluginManagementDetails,
  copyPluginManagementHostViewResult,
  type PluginManagementErrorCode,
  type PluginManagementSnapshot,
  type PluginManagementDetails,
  type PluginManagementHostViewResult,
} from './management-schema'
const protocol = 'milkup.plugin.management.rpc.v1'
const methods = ['snapshot', 'describe', 'requestHostView'] as const
type Method = (typeof methods)[number]
function payload(method: Method, value: unknown): Record<string, unknown> {
  if (method === 'snapshot') {
    if (!record(value) || !keys(value, [])) throw new PluginManagementError('invalid-input')
    return {}
  }
  if (method === 'describe') return { ...copyPluginManagementIdentity(value) }
  if (
    !record(value) ||
    !keys(value, ['input'], ['gesture']) ||
    (value.gesture !== undefined &&
      (typeof value.gesture !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value.gesture)))
  )
    throw new PluginManagementError('invalid-input')
  return {
    input: copyPluginManagementHostViewRequest(value.input),
    ...(value.gesture ? { gesture: value.gesture } : {}),
  }
}
function result(method: Method, value: unknown) {
  return method === 'snapshot'
    ? copyPluginManagementSnapshot(value)
    : method === 'describe'
      ? copyPluginManagementDetails(value)
      : copyPluginManagementHostViewResult(value)
}
export interface RpcPluginManagementBroker extends PluginManagementBroker {
  dispose(): void
}
export interface PluginManagementRpcServer {
  dispose(): void
}
export function createRpcPluginManagementBroker(
  endpoint: PluginIsolationRpcEndpoint,
  timeoutMs = 30_000,
): RpcPluginManagementBroker {
  let disposed = false,
    sequence = 0
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
      endpoint.postMessage({ protocol, type: 'cancel', id })
    } catch {}
  }
  const dispose = () => {
    if (disposed) return
    disposed = true
    remove()
    for (const [id, item] of pending) {
      cancel(id)
      item.cleanup()
      item.reject(new PluginManagementError('revoked'))
    }
    pending.clear()
    try {
      endpoint.postMessage({ protocol, type: 'close' })
    } catch {}
  }
  const remove = listen(endpoint, (message) => {
    if (!record(message) || message.protocol !== protocol) return
    if (message.type === 'revoked' && keys(message, ['protocol', 'type'])) {
      dispose()
      return
    }
    if (message.type !== 'response' || typeof message.id !== 'string') return
    const item = pending.get(message.id)
    if (!item) return
    pending.delete(message.id)
    item.cleanup()
    try {
      if (message.ok === true && keys(message, ['protocol', 'type', 'id', 'ok', 'value']))
        item.resolve(result(item.method, message.value))
      else if (
        message.ok === false &&
        keys(message, ['protocol', 'type', 'id', 'ok', 'error']) &&
        record(message.error) &&
        keys(message.error, ['code']) &&
        PLUGIN_MANAGEMENT_ERROR_CODES.includes(message.error.code as PluginManagementErrorCode)
      )
        item.reject(new PluginManagementError(message.error.code as PluginManagementErrorCode))
      else throw new PluginManagementError('unavailable')
    } catch {
      cancel(message.id)
      item.reject(new PluginManagementError('unavailable'))
    }
  })
  const call = (method: Method, input: unknown, signal?: AbortSignal): Promise<unknown> => {
    if (disposed) return Promise.reject(new PluginManagementError('revoked'))
    if (signal?.aborted) return Promise.reject(new PluginManagementError('aborted'))
    if (pending.size >= PLUGIN_MANAGEMENT_LIMITS.operations)
      return Promise.reject(new PluginManagementError('busy'))
    let data: Record<string, unknown>
    try {
      data = payload(method, input)
    } catch (error) {
      return Promise.reject(error)
    }
    const id = `management-${sequence++}`
    return new Promise((resolve, reject) => {
      const stop = (code: PluginManagementErrorCode) => {
        const item = pending.get(id)
        if (!item) return
        pending.delete(id)
        item.cleanup()
        cancel(id)
        reject(new PluginManagementError(code))
      }
      const abort = () => stop('aborted'),
        timer = setTimeout(() => stop('aborted'), timeoutMs)
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
        endpoint.postMessage({ protocol, type: 'request', id, method, payload: data })
      } catch {
        stop('unavailable')
      }
    })
  }
  return Object.freeze({
    snapshot: (options) =>
      call('snapshot', {}, options?.signal) as Promise<PluginManagementSnapshot>,
    describe: (input, options) =>
      call('describe', input, options?.signal) as Promise<PluginManagementDetails>,
    requestHostView: (input, options) =>
      call(
        'requestHostView',
        { input, ...(options?.gesture ? { gesture: options.gesture } : {}) },
        options?.signal,
      ) as Promise<PluginManagementHostViewResult>,
    dispose,
  } satisfies RpcPluginManagementBroker)
}
export function createPluginManagementRpcServer(
  endpoint: PluginIsolationRpcEndpoint,
  broker: PluginManagementBroker,
): PluginManagementRpcServer {
  let disposed = false
  const active = new Map<string, AbortController>()
  const dispose = () => {
    if (disposed) return
    disposed = true
    remove()
    for (const controller of active.values()) controller.abort()
    active.clear()
    try {
      endpoint.postMessage({ protocol, type: 'revoked' })
    } catch {}
  }
  const remove = listen(endpoint, async (message) => {
    if (!record(message) || message.protocol !== protocol) return
    if (message.type === 'close' && keys(message, ['protocol', 'type'])) {
      dispose()
      return
    }
    if (disposed || typeof message.id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(message.id))
      return
    if (message.type === 'cancel' && keys(message, ['protocol', 'type', 'id'])) {
      active.get(message.id)?.abort()
      return
    }
    if (message.type !== 'request' || active.has(message.id)) return
    const reply = (data: Record<string, unknown>) => {
      if (!disposed)
        try {
          endpoint.postMessage({ protocol, type: 'response', id: message.id, ...data })
        } catch {
          dispose()
        }
    }
    if (active.size >= PLUGIN_MANAGEMENT_LIMITS.operations) {
      reply({ ok: false, error: { code: 'busy' } })
      return
    }
    const controller = new AbortController()
    active.set(message.id, controller)
    try {
      if (
        !keys(message, ['protocol', 'type', 'id', 'method', 'payload']) ||
        !methods.includes(message.method as Method)
      )
        throw new PluginManagementError('invalid-input')
      const method = message.method as Method,
        data = payload(method, message.payload)
      let value: unknown
      if (method === 'snapshot') value = await broker.snapshot({ signal: controller.signal })
      else if (method === 'describe')
        value = await broker.describe(copyPluginManagementIdentity(data), {
          signal: controller.signal,
        })
      else {
        const options: PluginManagementGestureOptions = {
          signal: controller.signal,
          ...(data.gesture ? { gesture: data.gesture as string } : {}),
        }
        value = await broker.requestHostView(
          copyPluginManagementHostViewRequest(data.input),
          options,
        )
      }
      if (!controller.signal.aborted) reply({ ok: true, value: result(method, value) })
    } catch (error) {
      if (!controller.signal.aborted)
        reply({
          ok: false,
          error: { code: error instanceof PluginManagementError ? error.code : 'unavailable' },
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
  throw new Error('Management endpoint does not support listeners')
}

import type { PluginIsolationRpcEndpoint, PluginIsolationRpcMessageListener } from './isolation-rpc'
import {
  PluginKeymapError,
  PLUGIN_KEYMAP_ERROR_CODES as CODES,
  keymapRecord as record,
  keymapKeys as keys,
  copyKeymapInput,
  copyKeymapSnapshot,
  type PluginKeymapBroker,
  type PluginKeymapErrorCode,
  type PluginKeymapOperationOptions,
  type PluginKeymapSnapshot,
  type PluginKeymapUpdate,
} from './keymap-broker'
const PROTOCOL = 'milkup.plugin.keymap.rpc.v1'
const METHODS = ['snapshot', 'update', 'reset'] as const
type Method = (typeof METHODS)[number]
export interface RpcPluginKeymapBroker extends PluginKeymapBroker {
  dispose(): void
}
export interface PluginKeymapRpcServer {
  dispose(): void
}
function validatePayload(
  method: Method,
  payload: unknown,
): asserts payload is Record<string, unknown> {
  if (method === 'snapshot') {
    if (!record(payload) || !keys(payload, [])) throw new PluginKeymapError('invalid-input')
  } else copyKeymapInput(payload, method === 'reset')
}
function validateResponse(_method: Method, value: unknown): void {
  copyKeymapSnapshot(value)
}
export function createRpcPluginKeymapBroker(
  endpoint: PluginIsolationRpcEndpoint,
  timeoutMs = 30_000,
): RpcPluginKeymapBroker {
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
      request.reject(new PluginKeymapError('revoked'))
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
        CODES.includes(message.error.code as PluginKeymapErrorCode)
      ) {
        request.reject(new PluginKeymapError(message.error.code as PluginKeymapErrorCode))
      } else throw new PluginKeymapError('unavailable')
    } catch {
      cancel(message.id)
      request.reject(new PluginKeymapError('unavailable'))
    }
  })
  const call = (
    method: Method,
    payload: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<unknown> => {
    if (disposed) return Promise.reject(new PluginKeymapError('revoked'))
    if (signal?.aborted) return Promise.reject(new PluginKeymapError('aborted'))
    if (pending.size >= 16) return Promise.reject(new PluginKeymapError('busy'))
    try {
      validatePayload(method, payload)
    } catch (error) {
      return Promise.reject(error)
    }
    const id = `keymap-${nextId++}`
    return new Promise((resolve, reject) => {
      const stop = (code: PluginKeymapErrorCode) => {
        const current = pending.get(id)
        if (!current) return
        pending.delete(id)
        current.cleanup()
        cancel(id)
        reject(new PluginKeymapError(code))
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
  return Object.freeze<RpcPluginKeymapBroker>({
    snapshot: (options?: PluginKeymapOperationOptions) =>
      call('snapshot', {}, options?.signal) as Promise<PluginKeymapSnapshot>,
    update: (input: PluginKeymapUpdate, options?: PluginKeymapOperationOptions) =>
      call(
        'update',
        input as unknown as Record<string, unknown>,
        options?.signal,
      ) as Promise<PluginKeymapSnapshot>,
    reset: (input: { readonly revision: number }, options?: PluginKeymapOperationOptions) =>
      call('reset', input, options?.signal) as Promise<PluginKeymapSnapshot>,
    dispose,
  })
}

export function createPluginKeymapRpcServer(
  endpoint: PluginIsolationRpcEndpoint,
  broker: PluginKeymapBroker,
): PluginKeymapRpcServer {
  let disposed = false
  const active = new Map<string, AbortController>()
  const dispose = () => {
    if (disposed) return
    disposed = true
    remove()
    for (const controller of active.values()) controller.abort()
    active.clear()
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
      if (!disposed) {
        try {
          endpoint.postMessage({ protocol: PROTOCOL, type: 'response', id: message.id, ...data })
        } catch {
          dispose()
        }
      }
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
        throw new PluginKeymapError('invalid-input')
      const method = message.method as Method
      validatePayload(method, message.payload)
      const payload = message.payload
      const options = { signal: controller.signal }
      let value: PluginKeymapSnapshot
      if (method === 'snapshot') value = await broker.snapshot(options)
      else if (method === 'update') value = await broker.update(copyKeymapInput(payload), options)
      else
        value = await broker.reset({ revision: copyKeymapInput(payload, true).revision }, options)
      if (!controller.signal.aborted) {
        validateResponse(method, value)
        reply({ ok: true, value })
      }
    } catch (error) {
      if (!controller.signal.aborted)
        reply({
          ok: false,
          error: { code: error instanceof PluginKeymapError ? error.code : 'unavailable' },
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
  throw new Error('Keymap endpoint does not support listeners')
}

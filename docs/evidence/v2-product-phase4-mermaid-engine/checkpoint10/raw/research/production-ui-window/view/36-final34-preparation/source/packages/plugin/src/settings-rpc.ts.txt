import type { PluginIsolationRpcEndpoint, PluginIsolationRpcMessageListener } from './isolation-rpc'
import type { PluginSettingsBroker } from './settings-broker'
import {
  PluginSettingsError,
  PLUGIN_SETTINGS_ERROR_CODES as CODES,
  settingsRecord as record,
  settingsKeys as keys,
  assertPluginSettingsScope,
  assertPluginSettingsId,
  copyPluginSettingsValues,
  copyPluginSettingsDescriptor,
  copyPluginSettingsSnapshot,
  type PluginSettingsErrorCode,
  type PluginSettingsScope,
  type PluginSettingsOperationOptions,
  type PluginSettingsValues,
  type PluginSettingsDescriptor,
  type PluginSettingsSnapshot,
  type PluginSettingsTransaction,
} from './settings-schema'
const PROTOCOL = 'milkup.plugin.settings.rpc.v1'
const METHODS = ['describe', 'get', 'begin', 'preview', 'commit', 'cancel'] as const
type Method = (typeof METHODS)[number]
export interface RpcPluginSettingsBroker extends PluginSettingsBroker {
  dispose(): void
}
export interface PluginSettingsRpcServer {
  dispose(): void
}
function validatePayload(
  method: Method,
  payload: unknown,
): asserts payload is Record<string, unknown> {
  if (!record(payload)) throw new PluginSettingsError('invalid-input')
  const scoped = ['describe', 'get', 'begin'].includes(method)
  if (!keys(payload, scoped ? ['scope'] : method === 'preview' ? ['id', 'patch'] : ['id']))
    throw new PluginSettingsError('invalid-input')
  if (scoped) assertPluginSettingsScope(payload.scope)
  else assertPluginSettingsId(payload.id)
  if (method === 'preview') copyPluginSettingsValues(payload.patch, undefined, true)
}
function validateResponse(method: Method, value: unknown): void {
  if (method === 'describe') copyPluginSettingsDescriptor(value)
  else if (method === 'begin') {
    if (!record(value) || !keys(value, ['id', 'snapshot']))
      throw new PluginSettingsError('unavailable')
    assertPluginSettingsId(value.id)
    copyPluginSettingsSnapshot(value.snapshot)
  } else if (method === 'cancel') {
    if (value !== undefined) throw new PluginSettingsError('unavailable')
  } else copyPluginSettingsSnapshot(value)
}
export function createRpcPluginSettingsBroker(
  endpoint: PluginIsolationRpcEndpoint,
  timeoutMs = 30_000,
): RpcPluginSettingsBroker {
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
      request.reject(new PluginSettingsError('revoked'))
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
        CODES.includes(message.error.code as PluginSettingsErrorCode)
      ) {
        request.reject(new PluginSettingsError(message.error.code as PluginSettingsErrorCode))
      } else throw new PluginSettingsError('unavailable')
    } catch {
      cancel(message.id)
      request.reject(new PluginSettingsError('unavailable'))
    }
  })
  const call = (
    method: Method,
    payload: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<unknown> => {
    if (disposed) return Promise.reject(new PluginSettingsError('revoked'))
    if (signal?.aborted) return Promise.reject(new PluginSettingsError('aborted'))
    if (pending.size >= 16) return Promise.reject(new PluginSettingsError('busy'))
    try {
      validatePayload(method, payload)
    } catch (error) {
      return Promise.reject(error)
    }
    const id = `settings-${nextId++}`
    return new Promise((resolve, reject) => {
      const stop = (code: PluginSettingsErrorCode) => {
        const current = pending.get(id)
        if (!current) return
        pending.delete(id)
        current.cleanup()
        cancel(id)
        reject(new PluginSettingsError(code))
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
    describe: (scope: PluginSettingsScope, options?: PluginSettingsOperationOptions) =>
      call('describe', { scope }, options?.signal) as Promise<PluginSettingsDescriptor>,
    get: (scope: PluginSettingsScope, options?: PluginSettingsOperationOptions) =>
      call('get', { scope }, options?.signal) as Promise<PluginSettingsSnapshot>,
    begin: (scope: PluginSettingsScope, options?: PluginSettingsOperationOptions) =>
      call('begin', { scope }, options?.signal) as Promise<PluginSettingsTransaction>,
    preview: (id: string, patch: PluginSettingsValues, options?: PluginSettingsOperationOptions) =>
      call('preview', { id, patch }, options?.signal) as Promise<PluginSettingsSnapshot>,
    commit: (id: string, options?: PluginSettingsOperationOptions) =>
      call('commit', { id }, options?.signal) as Promise<PluginSettingsSnapshot>,
    cancel: async (id: string, options?: PluginSettingsOperationOptions) => {
      await call('cancel', { id }, options?.signal)
    },
    dispose,
  })
}

export function createPluginSettingsRpcServer(
  endpoint: PluginIsolationRpcEndpoint,
  broker: PluginSettingsBroker,
): PluginSettingsRpcServer {
  let disposed = false
  const active = new Map<string, AbortController>()
  const transactions = new Set<string>()
  const dispose = () => {
    if (disposed) return
    disposed = true
    remove()
    for (const controller of active.values()) controller.abort()
    active.clear()
    for (const id of transactions) void broker.cancel(id).catch(() => undefined)
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
        throw new PluginSettingsError('invalid-input')
      const method = message.method as Method
      validatePayload(method, message.payload)
      const payload = message.payload
      const options = { signal: controller.signal }
      let value: unknown
      if (method === 'describe')
        value = await broker.describe(payload.scope as PluginSettingsScope, options)
      else if (method === 'get')
        value = await broker.get(payload.scope as PluginSettingsScope, options)
      else if (method === 'begin') {
        value = await broker.begin(payload.scope as PluginSettingsScope, options)
        const id = (value as PluginSettingsTransaction).id
        if (controller.signal.aborted || disposed) await broker.cancel(id).catch(() => undefined)
        else transactions.add(id)
      } else if (method === 'preview')
        value = await broker.preview(
          payload.id as string,
          payload.patch as PluginSettingsValues,
          options,
        )
      else if (method === 'commit') {
        value = await broker.commit(payload.id as string, options)
        transactions.delete(payload.id as string)
      } else {
        value = await broker.cancel(payload.id as string, options)
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
          error: { code: error instanceof PluginSettingsError ? error.code : 'unavailable' },
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
  throw new Error('Settings endpoint does not support listeners')
}

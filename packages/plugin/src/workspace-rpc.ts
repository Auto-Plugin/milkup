import type { PluginIsolationRpcEndpoint, PluginIsolationRpcMessageListener } from './isolation-rpc'
import {
  assertWorkspaceId,
  assertWorkspaceLimit,
  assertWorkspaceRelativePath,
  PluginWorkspaceError,
  type PluginWorkspaceBroker,
  type PluginWorkspaceErrorCode,
  type PluginWorkspaceGestureOptions,
  type PluginWorkspaceOperationOptions,
  type PluginWorkspaceListOptions,
  type PluginWorkspaceRoot,
  type PluginWorkspacePage,
  type PluginWorkspaceEntry,
} from './workspace-broker'
const PROTOCOL = 'milkup.plugin.workspace.rpc.v1'
const METHODS = [
  'chooseRoot',
  'restoreRoot',
  'listChildren',
  'resolveEntry',
  'refreshRoot',
  'requestOpen',
  'releaseRoot',
] as const
type Method = (typeof METHODS)[number]
const CODES: readonly PluginWorkspaceErrorCode[] = [
  'revoked',
  'invalid-token',
  'invalid-path',
  'invalidated',
  'gesture-required',
  'quota',
  'busy',
  'aborted',
  'unavailable',
]
export interface RpcPluginWorkspaceBroker extends PluginWorkspaceBroker {
  dispose(): void
}
export interface PluginWorkspaceRpcServer {
  dispose(): void
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
function keys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  return (
    required.every((key) => Object.hasOwn(value, key)) &&
    Object.keys(value).every((key) => required.includes(key) || optional.includes(key))
  )
}
function validatePayload(
  method: Method,
  payload: unknown,
): asserts payload is Record<string, unknown> {
  if (!record(payload)) throw new PluginWorkspaceError('invalid-token')
  const required =
    method === 'chooseRoot' || method === 'restoreRoot'
      ? []
      : method === 'requestOpen'
        ? ['fileId']
        : method === 'resolveEntry'
          ? ['rootId', 'relativePath']
          : ['rootId']
  const optional =
    method === 'chooseRoot' || method === 'requestOpen'
      ? ['gesture']
      : method === 'listChildren'
        ? ['directoryId', 'cursor', 'limit']
        : []
  if (!keys(payload, required, optional)) throw new PluginWorkspaceError('invalid-token')
  for (const key of ['rootId', 'fileId', 'directoryId', 'cursor', 'gesture'])
    if (key in payload) assertWorkspaceId(payload[key])
  if ('relativePath' in payload) assertWorkspaceRelativePath(payload.relativePath)
  if ('limit' in payload) assertWorkspaceLimit(payload.limit)
}
function validateResponse(method: Method, value: unknown): void {
  const root = (item: unknown) => {
    if (
      !record(item) ||
      !keys(item, ['id', 'key', 'label']) ||
      typeof item.label !== 'string' ||
      item.label.length > 1024
    )
      throw new PluginWorkspaceError('unavailable')
    assertWorkspaceId(item.id)
    assertWorkspaceId(item.key)
  }
  const entry = (item: unknown) => {
    if (
      !record(item) ||
      !keys(item, ['id', 'name', 'kind', 'relativePath']) ||
      typeof item.name !== 'string' ||
      item.name.length === 0 ||
      item.name.length > 1024 ||
      !['file', 'directory'].includes(item.kind as string)
    )
      throw new PluginWorkspaceError('unavailable')
    assertWorkspaceId(item.id)
    assertWorkspaceRelativePath(item.relativePath)
  }
  if (method === 'chooseRoot' || method === 'restoreRoot') {
    if (value !== null) root(value)
  } else if (method === 'refreshRoot') root(value)
  else if (method === 'resolveEntry') {
    if (value !== null) entry(value)
  } else if (method === 'listChildren') {
    if (
      !record(value) ||
      !keys(value, ['entries', 'nextCursor']) ||
      !Array.isArray(value.entries) ||
      value.entries.length > 200
    )
      throw new PluginWorkspaceError('unavailable')
    value.entries.forEach(entry)
    if (value.nextCursor !== null) assertWorkspaceId(value.nextCursor)
  } else if (method === 'requestOpen') {
    if (
      !record(value) ||
      !keys(value, ['status']) ||
      !['opened', 'cancelled'].includes(value.status as string)
    )
      throw new PluginWorkspaceError('unavailable')
  } else if (value !== undefined) throw new PluginWorkspaceError('unavailable')
}
export function createRpcPluginWorkspaceBroker(
  endpoint: PluginIsolationRpcEndpoint,
  timeoutMs = 30_000,
): RpcPluginWorkspaceBroker {
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
      request.reject(new PluginWorkspaceError('revoked'))
    }
    pending.clear()
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
        CODES.includes(message.error.code as PluginWorkspaceErrorCode)
      ) {
        request.reject(new PluginWorkspaceError(message.error.code as PluginWorkspaceErrorCode))
      } else throw new PluginWorkspaceError('unavailable')
    } catch {
      cancel(message.id)
      request.reject(new PluginWorkspaceError('unavailable'))
    }
  })
  const call = (
    method: Method,
    payload: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<unknown> => {
    if (disposed) return Promise.reject(new PluginWorkspaceError('revoked'))
    if (signal?.aborted) return Promise.reject(new PluginWorkspaceError('aborted'))
    if (pending.size >= 16) return Promise.reject(new PluginWorkspaceError('quota'))
    try {
      validatePayload(method, payload)
    } catch (error) {
      return Promise.reject(error)
    }
    const id = `workspace-${nextId++}`
    return new Promise((resolve, reject) => {
      const stop = (code: PluginWorkspaceErrorCode) => {
        const current = pending.get(id)
        if (!current) return
        pending.delete(id)
        current.cleanup()
        cancel(id)
        reject(new PluginWorkspaceError(code))
      }
      const abort = () => stop('aborted')
      const timer = setTimeout(
        () => stop('aborted'),
        method === 'chooseRoot' || method === 'requestOpen' ? 10 * 60_000 : timeoutMs,
      )
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
  const operation = (rootId: string) => ({ rootId })
  return Object.freeze({
    restoreRoot: (options?: PluginWorkspaceOperationOptions) =>
      call('restoreRoot', {}, options?.signal) as Promise<PluginWorkspaceRoot | null>,
    chooseRoot: (options?: PluginWorkspaceGestureOptions) =>
      call(
        'chooseRoot',
        options?.gesture ? { gesture: options.gesture } : {},
        options?.signal,
      ) as Promise<PluginWorkspaceRoot | null>,
    listChildren: (rootId: string, options: PluginWorkspaceListOptions = {}) =>
      call(
        'listChildren',
        {
          rootId,
          ...(options.directoryId !== undefined ? { directoryId: options.directoryId } : {}),
          ...(options.cursor !== undefined ? { cursor: options.cursor } : {}),
          ...(options.limit !== undefined ? { limit: options.limit } : {}),
        },
        options.signal,
      ) as Promise<PluginWorkspacePage>,
    resolveEntry: (
      rootId: string,
      relativePath: string,
      options?: PluginWorkspaceOperationOptions,
    ) =>
      call(
        'resolveEntry',
        { rootId, relativePath },
        options?.signal,
      ) as Promise<PluginWorkspaceEntry | null>,
    refreshRoot: (rootId: string, options?: PluginWorkspaceOperationOptions) =>
      call('refreshRoot', operation(rootId), options?.signal) as Promise<PluginWorkspaceRoot>,
    requestOpen: (fileId: string, options?: PluginWorkspaceGestureOptions) =>
      call(
        'requestOpen',
        { fileId, ...(options?.gesture ? { gesture: options.gesture } : {}) },
        options?.signal,
      ) as Promise<{ status: 'opened' | 'cancelled' }>,
    releaseRoot: async (rootId: string) => {
      await call('releaseRoot', operation(rootId))
    },
    dispose,
  })
}
export function createPluginWorkspaceRpcServer(
  endpoint: PluginIsolationRpcEndpoint,
  broker: PluginWorkspaceBroker,
): PluginWorkspaceRpcServer {
  let disposed = false
  const active = new Map<string, AbortController>()
  const remove = listen(endpoint, async (message) => {
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
      reply({ ok: false, error: { code: 'quota' } })
      return
    }
    const controller = new AbortController()
    active.set(message.id, controller)
    try {
      if (
        !keys(message, ['protocol', 'type', 'id', 'method', 'payload']) ||
        !METHODS.includes(message.method as Method)
      )
        throw new PluginWorkspaceError('invalid-token')
      const method = message.method as Method
      validatePayload(method, message.payload)
      const payload = message.payload
      const options = { signal: controller.signal }
      let value: unknown
      if (method === 'chooseRoot')
        value = await broker.chooseRoot({
          ...options,
          ...(payload.gesture !== undefined ? { gesture: payload.gesture as string } : {}),
        })
      else if (method === 'restoreRoot') value = (await broker.restoreRoot?.(options)) ?? null
      else if (method === 'listChildren')
        value = await broker.listChildren(payload.rootId as string, {
          ...options,
          ...(payload.directoryId !== undefined
            ? { directoryId: payload.directoryId as string }
            : {}),
          ...(payload.cursor !== undefined ? { cursor: payload.cursor as string } : {}),
          ...(payload.limit !== undefined ? { limit: payload.limit as number } : {}),
        })
      else if (method === 'resolveEntry')
        value = await broker.resolveEntry(
          payload.rootId as string,
          payload.relativePath as string,
          options,
        )
      else if (method === 'refreshRoot')
        value = await broker.refreshRoot(payload.rootId as string, options)
      else if (method === 'requestOpen')
        value = await broker.requestOpen(payload.fileId as string, {
          ...options,
          ...(payload.gesture !== undefined ? { gesture: payload.gesture as string } : {}),
        })
      else value = await broker.releaseRoot(payload.rootId as string)
      if (!controller.signal.aborted) {
        validateResponse(method, value)
        reply({ ok: true, value })
      }
    } catch (error) {
      if (!controller.signal.aborted)
        reply({
          ok: false,
          error: { code: error instanceof PluginWorkspaceError ? error.code : 'unavailable' },
        })
    } finally {
      active.delete(message.id)
    }
  })
  return Object.freeze({
    dispose: () => {
      if (disposed) return
      disposed = true
      remove()
      for (const controller of active.values()) controller.abort()
      active.clear()
      endpoint.postMessage({ protocol: PROTOCOL, type: 'revoked' })
    },
  })
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
  throw new Error('Workspace endpoint does not support listeners')
}

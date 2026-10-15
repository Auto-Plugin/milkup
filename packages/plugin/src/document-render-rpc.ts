import {
  copyDocumentPresentationRequest,
  DocumentPresentationError,
  DOCUMENT_PRESENTATION_LIMITS,
  type DocumentPresentationResult,
} from '@milkup/core'
import type { IsolatedPluginDocumentRenderRequest, PluginIsolationHost } from './isolation'
import type { PluginIsolationRpcEndpoint } from './isolation-rpc'
const protocol = 'milkup.plugin.document-render.v1'
const errors = [
  'invalid-input',
  'invalid-output',
  'revoked',
  'aborted',
  'busy',
  'timeout',
  'unavailable',
] as const
function failure(error: unknown): DocumentPresentationError {
  return error instanceof DocumentPresentationError
    ? error
    : new DocumentPresentationError('unavailable')
}
function record(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return (
    !!value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).every((k) => keys.includes(k))
  )
}
function id(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(value)
}
function listen(endpoint: PluginIsolationRpcEndpoint, fn: (value: unknown) => void): () => void {
  if (endpoint.addEventListener) {
    const f = (event: { readonly data: unknown }) => fn(event.data)
    endpoint.addEventListener('message', f)
    return () => endpoint.removeEventListener?.('message', f)
  }
  if (endpoint.on) {
    endpoint.on('message', fn)
    return () => endpoint.off?.('message', fn)
  }
  throw new Error('Endpoint has no message listener')
}
export interface DocumentRenderRpcClient {
  render(
    request: IsolatedPluginDocumentRenderRequest,
    options?: { readonly signal?: AbortSignal },
  ): Promise<DocumentPresentationResult>
  dispose(): void
}
/** onTimeout MUST stop the owned Worker/process, not just reject its Promise. */
export function createDocumentRenderRpcClient(
  endpoint: PluginIsolationRpcEndpoint,
  onTimeout: () => void,
): DocumentRenderRpcClient {
  let disposed = false,
    sequence = 0
  type Job = {
    id: string
    request: IsolatedPluginDocumentRenderRequest
    resolve: (r: DocumentPresentationResult) => void
    reject: (e: Error) => void
    settled: boolean
    removeAbort: () => void
    timer?: ReturnType<typeof setTimeout>
  }
  let active: Job | undefined
  const queue: Job[] = []
  function reject(job: Job, error: Error) {
    if (!job.settled) {
      job.settled = true
      job.reject(error)
    }
    job.removeAbort()
  }
  function pump() {
    if (disposed || active) return
    const job = queue.shift()
    if (!job) return
    active = job
    job.timer = setTimeout(() => {
      if (active !== job || disposed) return
      reject(job, new DocumentPresentationError('timeout'))
      try {
        onTimeout()
      } catch {
        // Revocation and owned-process cleanup still complete if the observer fails.
      } finally {
        dispose()
      }
    }, DOCUMENT_PRESENTATION_LIMITS.timeoutMs)
    try {
      endpoint.postMessage({ protocol, type: 'render', id: job.id, payload: job.request })
    } catch {
      reject(job, new DocumentPresentationError('unavailable'))
      clearTimeout(job.timer)
      active = undefined
      pump()
    }
  }
  const remove = listen(endpoint, (message) => {
    if (
      !record(message, ['protocol', 'type', 'id', 'ok', 'value', 'error']) ||
      message.protocol !== protocol ||
      message.type !== 'result' ||
      !id(message.id) ||
      typeof message.ok !== 'boolean'
    )
      return
    if (message.ok ? Object.hasOwn(message, 'error') : Object.hasOwn(message, 'value')) return
    const job = active
    if (!job || job.id !== message.id) return
    if (
      message.ok === false &&
      (typeof message.error !== 'string' ||
        !errors.includes(message.error as (typeof errors)[number]))
    )
      return
    clearTimeout(job.timer)
    job.removeAbort()
    active = undefined
    if (!job.settled) {
      job.settled = true
      if (message.ok) job.resolve(message.value as DocumentPresentationResult)
      else job.reject(new DocumentPresentationError(message.error as (typeof errors)[number]))
    }
    pump()
  })
  function dispose() {
    if (disposed) return
    disposed = true
    remove()
    if (active) {
      clearTimeout(active.timer)
      try {
        endpoint.postMessage({ protocol, type: 'cancel', id: active.id })
      } catch {}
      reject(active, new DocumentPresentationError('revoked'))
      active = undefined
    }
    for (const job of queue.splice(0)) reject(job, new DocumentPresentationError('revoked'))
  }
  return Object.freeze({
    dispose,
    render: (
      input: IsolatedPluginDocumentRenderRequest,
      options: { readonly signal?: AbortSignal } = {},
    ) => {
      if (disposed) return Promise.reject(new DocumentPresentationError('revoked'))
      if (options.signal?.aborted) return Promise.reject(new DocumentPresentationError('aborted'))
      if (queue.length >= DOCUMENT_PRESENTATION_LIMITS.queue)
        return Promise.reject(new DocumentPresentationError('busy'))
      let request: IsolatedPluginDocumentRenderRequest
      try {
        request = {
          pluginId: input.pluginId,
          rendererId: input.rendererId,
          request: copyDocumentPresentationRequest(input.request),
        }
      } catch (error) {
        return Promise.reject(error)
      }
      return new Promise<DocumentPresentationResult>((resolve, rejectPromise) => {
        const job: Job = {
          id: `render_${++sequence}`,
          request,
          resolve,
          reject: rejectPromise,
          settled: false,
          removeAbort: () => {},
        }
        const abort = () => {
          reject(job, new DocumentPresentationError('aborted'))
          if (active === job) {
            try {
              endpoint.postMessage({ protocol, type: 'cancel', id: job.id })
            } catch {}
          } else {
            const index = queue.indexOf(job)
            if (index >= 0) queue.splice(index, 1)
          }
        }
        options.signal?.addEventListener('abort', abort, { once: true })
        job.removeAbort = () => options.signal?.removeEventListener('abort', abort)
        queue.push(job)
        if (options.signal?.aborted) abort()
        pump()
      })
    },
  })
}
export function createDocumentRenderRpcServer(
  endpoint: PluginIsolationRpcEndpoint,
  host: PluginIsolationHost,
): { dispose(): void } {
  let disposed = false
  const pending = new Map<string, AbortController>()
  function send(id: string, ok: boolean, value?: unknown, error?: unknown) {
    if (disposed) return
    endpoint.postMessage({
      protocol,
      type: 'result',
      id,
      ok,
      ...(ok ? { value } : { error: failure(error).code }),
    })
  }
  const remove = listen(endpoint, (message) => {
    if (
      !record(message, ['protocol', 'type', 'id', 'payload']) ||
      message.protocol !== protocol ||
      !id(message.id)
    )
      return
    const jobId = message.id
    if (message.type === 'cancel') {
      if (Object.hasOwn(message, 'payload')) return
      pending.get(jobId)?.abort()
      return
    }
    if (message.type !== 'render' || pending.has(jobId)) return
    let request: IsolatedPluginDocumentRenderRequest
    try {
      const p = message.payload
      if (
        !record(p, ['pluginId', 'rendererId', 'request']) ||
        typeof p.pluginId !== 'string' ||
        p.pluginId.length > 128 ||
        typeof p.rendererId !== 'string' ||
        p.rendererId.length > 128
      )
        throw new DocumentPresentationError('invalid-input')
      request = {
        pluginId: p.pluginId,
        rendererId: p.rendererId,
        request: copyDocumentPresentationRequest(p.request),
      }
      if (pending.size) throw new DocumentPresentationError('busy')
      if (!host.renderDocument) throw new DocumentPresentationError('unavailable')
    } catch (error) {
      send(jobId, false, undefined, error)
      return
    }
    const controller = new AbortController()
    pending.set(jobId, controller)
    void Promise.resolve()
      .then(() => host.renderDocument!(request, { signal: controller.signal }))
      .then((value) => {
        if (controller.signal.aborted) throw new DocumentPresentationError('aborted')
        pending.delete(jobId)
        send(jobId, true, value)
      })
      .catch((error) => {
        pending.delete(jobId)
        send(jobId, false, undefined, error)
      })
  })
  return Object.freeze({
    dispose() {
      if (disposed) return
      disposed = true
      remove()
      for (const controller of pending.values()) controller.abort()
      pending.clear()
    },
  })
}

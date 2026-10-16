import { DOCUMENT_PRESENTATION_LIMITS } from '@milkup/core'
import type { PluginIsolationRpcEndpoint } from './isolation-rpc'
import type { PluginWorkerEndpoint } from './isolation-worker'
import { registerPluginRenderAuthority, type PluginRenderControl } from './render-arbitration'
import { readDocumentRenderResult } from './document-render-wire'

const protocol = 'milkup.plugin.worker-supervisor.v1'
const renderProtocol = 'milkup.plugin.document-render.v1'
type Failure = PluginRenderControl

type ErrorEndpoint = PluginWorkerEndpoint & {
  addEventListener?(
    type: 'message' | 'error' | 'messageerror',
    listener: (event: any) => void,
  ): void
  removeEventListener?(
    type: 'message' | 'error' | 'messageerror',
    listener: (event: any) => void,
  ): void
}
function listen(endpoint: PluginIsolationRpcEndpoint, listener: (message: unknown) => void) {
  if (endpoint.addEventListener) {
    const handler = (event: { readonly data: unknown }) => listener(event.data)
    endpoint.addEventListener('message', handler)
    return () => endpoint.removeEventListener?.('message', handler)
  }
  if (endpoint.on) {
    endpoint.on('message', listener)
    return () => endpoint.off?.('message', listener)
  }
  throw new Error('Worker supervisor endpoint has no message listener')
}
function record(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return (
    !!value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).every((key) => keys.includes(key))
  )
}
function renderId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(value)
}

/** Host-only factory. `worker` must run the trusted supervisor entry, never a plugin module. */
export function createSupervisedPluginWorkerEndpoint(worker: ErrorEndpoint): PluginWorkerEndpoint {
  if (!worker.terminate) throw new Error('Worker supervisor requires termination')
  const listeners = new Set<(event: { readonly data: unknown }) => void>()
  const failures = new Set<(event: Failure) => void>()
  let closed = false,
    stopped = false
  let stopTimer: ReturnType<typeof setTimeout> | undefined
  const emit = (event: Failure) => {
    for (const listener of [...failures]) listener(event)
  }
  const remove = listen(worker, (value) => {
    if (
      !record(value, ['protocol', 'type', 'message', 'event', 'id']) ||
      value.protocol !== protocol
    )
      return
    if (value.type === 'control' && !Object.hasOwn(value, 'message')) {
      if (value.event === 'disposed' && !Object.hasOwn(value, 'id')) {
        stop()
        return
      }
      if (closed) return
      if (value.event === 'timeout' && renderId(value.id)) {
        try {
          emit({ type: 'timeout', id: value.id })
        } finally {
          retire()
        }
      } else if (value.event === 'error' && !Object.hasOwn(value, 'id')) {
        try {
          emit({ type: 'error' })
        } finally {
          retire()
        }
      }
      return
    }
    // Child data is unwrapped exactly once. An apparent control frame sent by
    // the child remains ordinary child data, never supervisor authority.
    if (
      closed ||
      value.type !== 'child' ||
      !Object.hasOwn(value, 'message') ||
      Object.hasOwn(value, 'event') ||
      Object.hasOwn(value, 'id')
    )
      return
    for (const listener of [...listeners]) listener({ data: value.message })
  })
  const onError = () => {
    if (closed) return
    try {
      emit({ type: 'error' })
    } finally {
      retire()
      stop()
    }
  }
  worker.addEventListener?.('error', onError)
  worker.addEventListener?.('messageerror', onError)
  function stop() {
    if (stopped) return
    stopped = true
    clearTimeout(stopTimer)
    remove()
    worker.removeEventListener?.('error', onError)
    worker.removeEventListener?.('messageerror', onError)
    worker.terminate!()
  }
  function retire() {
    if (closed) return
    closed = true
    try {
      emit({ type: 'disposed' })
    } finally {
      listeners.clear()
      failures.clear()
      // The supervisor owns explicit child teardown. Keep its listener alive
      // until its ACK; terminate the parent as a bounded fallback as well.
      stopTimer = setTimeout(stop, 1000)
      try {
        worker.postMessage({ protocol, type: 'dispose' })
      } catch {
        stop()
      }
    }
  }
  const endpoint: PluginWorkerEndpoint = Object.freeze({
    postMessage(message: unknown) {
      if (closed) throw new Error('Worker supervisor endpoint is disposed')
      worker.postMessage({ protocol, type: 'forward', message })
    },
    addEventListener(_type: 'message', listener: (event: { readonly data: unknown }) => void) {
      listeners.add(listener)
    },
    removeEventListener(_type: 'message', listener: (event: { readonly data: unknown }) => void) {
      listeners.delete(listener)
    },
    terminate: retire,
  })
  registerPluginRenderAuthority(endpoint, {
    subscribe(listener) {
      if (closed) listener({ type: 'disposed' })
      else failures.add(listener)
      return () => failures.delete(listener)
    },
  })
  return endpoint
}

/** Runs only in the trusted supervisor realm. It never imports plugin code. */
export function initializePluginWorkerSupervisor(
  scope: PluginIsolationRpcEndpoint,
  createChild: () => ErrorEndpoint,
): { dispose(): void } {
  let closed = false
  let active: { id: string; deadline: number; timer: ReturnType<typeof setTimeout> } | undefined
  let child: ErrorEndpoint | undefined
  let removeChild: (() => void) | undefined
  const send = (value: unknown) => scope.postMessage(value)
  const sendChild = (message: unknown) => send({ protocol, type: 'child', message })
  function teardown() {
    if (closed) return
    closed = true
    clearTimeout(active?.timer)
    active = undefined
    removeChild?.()
    child?.removeEventListener?.('error', fail)
    child?.removeEventListener?.('messageerror', fail)
    child?.terminate?.()
  }
  function fail() {
    if (closed) return
    teardown()
    send({ protocol, type: 'control', event: 'error' })
  }
  function expire(id: string) {
    if (closed || active?.id !== id) return
    // Stop execution before informing a possibly blocked page. No untrusted
    // timestamp participates in this decision.
    teardown()
    send({ protocol, type: 'control', event: 'timeout', id })
  }
  const remove = listen(scope, (value) => {
    if (!record(value, ['protocol', 'type', 'message']) || value.protocol !== protocol) return
    if (value.type === 'dispose' && !Object.hasOwn(value, 'message')) {
      teardown()
      send({ protocol, type: 'control', event: 'disposed' })
      remove()
      return
    }
    if (closed || value.type !== 'forward' || !Object.hasOwn(value, 'message')) return
    try {
      if (!child) {
        child = createChild()
        if (!child.terminate) throw new Error('Child Worker requires termination')
        child.addEventListener?.('error', fail)
        child.addEventListener?.('messageerror', fail)
        removeChild = listen(child, (message) => {
          if (closed) return
          const job = active
          const response = readDocumentRenderResult(message)
          if (job && response?.id === job.id) {
            if (performance.now() >= job.deadline) {
              expire(job.id)
              return
            }
            clearTimeout(job.timer)
            active = undefined
          }
          sendChild(message)
        })
      }
      const message = value.message
      if (
        record(message, ['protocol', 'type', 'id', 'payload']) &&
        message.protocol === renderProtocol &&
        message.type === 'render' &&
        renderId(message.id)
      ) {
        if (active) {
          sendChild({
            protocol: renderProtocol,
            type: 'result',
            id: message.id,
            ok: false,
            error: 'busy',
          })
          return
        }
        const id = message.id
        active = {
          id,
          deadline: performance.now() + DOCUMENT_PRESENTATION_LIMITS.timeoutMs,
          timer: setTimeout(() => expire(id), DOCUMENT_PRESENTATION_LIMITS.timeoutMs),
        }
      }
      // Cancellation is forwarded, but never disarms or renews the deadline.
      child.postMessage(message)
    } catch {
      fail()
    }
  })
  return Object.freeze({
    dispose() {
      teardown()
      remove()
    },
  })
}

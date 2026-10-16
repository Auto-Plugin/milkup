import type { PluginIsolationRpcEndpoint, PluginIsolationRpcMessageListener } from './isolation-rpc'
import {
  assertPluginReleaseId,
  type PluginReleaseCheckResult,
  type PluginReleaseInstallResult,
  type PluginReleaseStatus,
  type PluginReleasesBroker,
} from './releases-broker'

const PROTOCOL = 'milkup.plugin.releases.rpc.v1'
const METHODS = ['check', 'stage', 'status', 'cancel', 'requestInstall'] as const
type Method = (typeof METHODS)[number]
export interface RpcPluginReleasesBroker extends PluginReleasesBroker {
  dispose(): void
}
export interface PluginReleasesRpcServer {
  dispose(): void
}

export function createRpcPluginReleasesBroker(
  endpoint: PluginIsolationRpcEndpoint,
  timeoutMs = 30_000,
): RpcPluginReleasesBroker {
  let disposed = false
  let nextId = 0
  const pending = new Map<
    string,
    {
      resolve(value: unknown): void
      reject(error: Error): void
      timer: ReturnType<typeof setTimeout>
    }
  >()
  const dispose = () => {
    if (disposed) return
    disposed = true
    remove()
    for (const request of pending.values()) {
      clearTimeout(request.timer)
      request.reject(new Error('Plugin releases RPC broker is revoked or disposed'))
    }
    pending.clear()
  }
  const remove = addListener(endpoint, (value) => {
    if (!isRecord(value) || value.protocol !== PROTOCOL) return
    if (value.type === 'revoked' && hasKeys(value, ['protocol', 'type'])) {
      dispose()
      return
    }
    if (value.type !== 'response' || typeof value.id !== 'string' || typeof value.ok !== 'boolean')
      return
    if (
      value.ok
        ? !hasKeys(value, ['protocol', 'type', 'id', 'ok', 'value'])
        : !hasKeys(value, ['protocol', 'type', 'id', 'ok', 'error']) ||
          !isRecord(value.error) ||
          !hasKeys(value.error, ['message']) ||
          typeof value.error.message !== 'string'
    )
      return
    const request = pending.get(value.id)
    if (!request) return
    pending.delete(value.id)
    clearTimeout(request.timer)
    if (value.ok) request.resolve(value.value)
    else request.reject(new Error((value.error as { message: string }).message))
  })
  function call(method: Method, releaseId?: string): Promise<unknown> {
    if (disposed)
      return Promise.reject(new Error('Plugin releases RPC broker is revoked or disposed'))
    if (pending.size >= 16)
      return Promise.reject(new Error('Plugin releases RPC concurrency quota exceeded'))
    const id = `release-${nextId++}`
    return new Promise((resolve, reject) => {
      if (method !== 'check') {
        try {
          assertPluginReleaseId(releaseId)
        } catch (error) {
          reject(error)
          return
        }
      }
      const timer = setTimeout(
        () => {
          pending.delete(id)
          reject(new Error(`Plugin releases RPC timed out: ${method}`))
        },
        method === 'requestInstall' ? 10 * 60_000 : timeoutMs,
      )
      pending.set(id, { resolve, reject, timer })
      try {
        endpoint.postMessage({
          protocol: PROTOCOL,
          type: 'request',
          id,
          method,
          payload: method === 'check' ? {} : { releaseId },
        })
      } catch (error) {
        pending.delete(id)
        clearTimeout(timer)
        reject(error)
      }
    })
  }
  return Object.freeze({
    check: () => call('check') as Promise<PluginReleaseCheckResult>,
    stage: async (id: string) => {
      await call('stage', id)
    },
    status: (id: string) => call('status', id) as Promise<PluginReleaseStatus>,
    cancel: async (id: string) => {
      await call('cancel', id)
    },
    requestInstall: (id: string) =>
      call('requestInstall', id) as Promise<PluginReleaseInstallResult>,
    dispose,
  })
}

export function createPluginReleasesRpcServer(
  endpoint: PluginIsolationRpcEndpoint,
  broker: PluginReleasesBroker,
): PluginReleasesRpcServer {
  let disposed = false
  const active = new Set<string>()
  const remove = addListener(endpoint, async (message) => {
    if (
      disposed ||
      !isRecord(message) ||
      message.protocol !== PROTOCOL ||
      message.type !== 'request' ||
      typeof message.id !== 'string' ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(message.id)
    )
      return
    const reply = (result: Record<string, unknown>) => {
      if (!disposed)
        endpoint.postMessage({ protocol: PROTOCOL, type: 'response', id: message.id, ...result })
    }
    // A duplicate in-flight ID never dispatches a second side effect.
    if (active.has(message.id)) return
    if (active.size >= 16) {
      reply({ ok: false, error: { message: 'Plugin releases RPC concurrency quota exceeded' } })
      return
    }
    active.add(message.id)
    try {
      if (
        !hasKeys(message, ['protocol', 'type', 'id', 'method', 'payload']) ||
        !METHODS.includes(message.method as Method) ||
        !isRecord(message.payload)
      )
        throw new Error('Invalid plugin releases RPC request')
      const method = message.method as Method
      const payload = message.payload
      if (!hasKeys(payload, method === 'check' ? [] : ['releaseId']))
        throw new Error('Invalid plugin releases RPC payload')
      if (method !== 'check') assertPluginReleaseId(payload.releaseId)
      // Explicit dispatch, never broker[untrustedMethod](...untrustedArgs).
      let result: unknown
      if (method === 'check') result = await broker.check()
      else if (method === 'stage') result = await broker.stage(payload.releaseId as string)
      else if (method === 'status') result = await broker.status(payload.releaseId as string)
      else if (method === 'cancel') result = await broker.cancel(payload.releaseId as string)
      else result = await broker.requestInstall(payload.releaseId as string)
      reply({ ok: true, value: result })
    } catch (error) {
      reply({
        ok: false,
        error: { message: error instanceof Error ? error.message : String(error) },
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
      active.clear()
      endpoint.postMessage({ protocol: PROTOCOL, type: 'revoked' })
    },
  })
}

function addListener(
  endpoint: PluginIsolationRpcEndpoint,
  listener: (value: unknown) => void,
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
  throw new Error('Plugin releases RPC endpoint does not support message listeners')
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
function hasKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key))
}

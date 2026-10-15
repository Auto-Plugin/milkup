import type { PluginIsolationRpcEndpoint, PluginIsolationRpcMessageListener } from './isolation-rpc'
import {
  assertPluginUiNotice,
  assertPluginUiLocation,
  type PluginUiNotice,
  type PluginUiBroker,
  type PluginUiRevealLocationRequest,
  type PluginUiOperationOptions,
} from './ui-broker'

interface UiRpcMessage {
  readonly protocol: typeof UI_RPC_PROTOCOL
  readonly type: 'request' | 'response' | 'cancelRequest'
  readonly id: string
  readonly method?: 'requestUpdate' | 'revealLine' | 'revealLocation' | 'open' | 'notify'
  readonly location?: PluginUiRevealLocationRequest
  readonly viewId?: string
  readonly line?: number
  readonly gesture?: string
  readonly notice?: PluginUiNotice
  readonly ok?: boolean
  readonly error?: { readonly message: string }
}

export interface RpcPluginUiBroker extends PluginUiBroker {
  dispose(): void
}

const UI_RPC_PROTOCOL = 'milkup.plugin.ui.rpc.v1'

export function createRpcPluginUiBroker(
  endpoint: PluginIsolationRpcEndpoint,
  timeoutMs = 5_000,
): RpcPluginUiBroker {
  let nextId = 0
  let disposed = false
  const pending = new Map<
    string,
    {
      resolve(): void
      reject(error: Error): void
      timer: ReturnType<typeof setTimeout>
      cleanup(): void
    }
  >()
  const remove = addListener(endpoint, (value) => {
    const message = readMessage(value)
    if (!message || message.type !== 'response') return
    const request = pending.get(message.id)
    if (!request) return
    pending.delete(message.id)
    clearTimeout(request.timer)
    request.cleanup()
    if (message.ok) request.resolve()
    else request.reject(new Error(message.error?.message ?? 'Plugin UI RPC failed'))
  })

  return Object.freeze({
    requestUpdate: (viewId?: string) =>
      request('requestUpdate', viewId === undefined ? {} : { viewId }),
    revealLine: (line: number) => request('revealLine', { line }),
    revealLocation: (location: PluginUiRevealLocationRequest, options?: PluginUiOperationOptions) =>
      request('revealLocation', { location }, options?.signal),
    open: (viewId: string, gesture?: string) =>
      request('open', { viewId, ...(gesture ? { gesture } : {}) }),
    notify: (notice: PluginUiNotice) => request('notify', { notice }),
    dispose: () => {
      disposed = true
      remove()
      for (const [id, request] of pending) {
        clearTimeout(request.timer)
        request.cleanup()
        cancelRequest(id)
        request.reject(new Error('Plugin UI RPC broker is disposed'))
      }
      pending.clear()
    },
  })

  function request(
    method: NonNullable<UiRpcMessage['method']>,
    input: Pick<UiRpcMessage, 'viewId' | 'line' | 'gesture' | 'notice' | 'location'>,
    signal?: AbortSignal,
  ): Promise<void> {
    if (disposed) return Promise.reject(new Error('Plugin UI RPC broker is disposed'))
    if (signal?.aborted) return Promise.reject(new Error('Plugin UI RPC aborted'))
    if (pending.size >= 32) return Promise.reject(new Error('Plugin UI RPC request limit reached'))
    const id = `${Date.now().toString(36)}-${(nextId++).toString(36)}`
    return new Promise<void>((resolve, reject) => {
      const abort = () => {
        const entry = pending.get(id)
        if (!entry) return
        pending.delete(id)
        clearTimeout(entry.timer)
        entry.cleanup()
        cancelRequest(id)
        reject(new Error('Plugin UI RPC aborted'))
      }
      const timer = setTimeout(() => {
        pending.delete(id)
        signal?.removeEventListener('abort', abort)
        cancelRequest(id)
        reject(new Error(`Plugin UI RPC timed out: ${method}`))
      }, timeoutMs)
      pending.set(id, {
        resolve,
        reject,
        timer,
        cleanup: () => signal?.removeEventListener('abort', abort),
      })
      signal?.addEventListener('abort', abort, { once: true })
      try {
        endpoint.postMessage({
          protocol: UI_RPC_PROTOCOL,
          type: 'request',
          id,
          method,
          ...input,
        } satisfies UiRpcMessage)
      } catch (error) {
        pending.delete(id)
        clearTimeout(timer)
        signal?.removeEventListener('abort', abort)
        reject(error)
      }
    })
  }
  function cancelRequest(id: string): void {
    try {
      endpoint.postMessage({
        protocol: UI_RPC_PROTOCOL,
        type: 'cancelRequest',
        id,
      } satisfies UiRpcMessage)
    } catch {
      /* Transport already gone. */
    }
  }
}

export function createPluginUiRpcServer(
  endpoint: PluginIsolationRpcEndpoint,
  broker: PluginUiBroker,
): { dispose(): void } {
  let disposed = false
  const operations = new Map<string, AbortController>()
  const remove = addListener(endpoint, async (value) => {
    const message = readMessage(value)
    if (disposed || !message) return
    if (message.type === 'cancelRequest') {
      operations.get(message.id)?.abort()
      return
    }
    if (!message || message.type !== 'request') return
    if (operations.has(message.id) || operations.size >= 32) return
    const controller = new AbortController()
    operations.set(message.id, controller)
    try {
      if (message.method === 'revealLocation') {
        assertPluginUiLocation(message.location)
        if (!broker.revealLocation) throw new Error('Plugin UI navigation unavailable')
        await broker.revealLocation(message.location, { signal: controller.signal })
      } else if (message.method === 'revealLine') {
        await broker.revealLine(Number(message.line))
      } else if (message.method === 'open') {
        if (!broker.open) throw new Error('Plugin modal is unavailable')
        await broker.open(message.viewId!, message.gesture)
      } else if (message.method === 'notify') {
        assertPluginUiNotice(message.notice)
        if (!broker.notify) throw new Error('Plugin notices unavailable')
        await broker.notify(message.notice)
      } else {
        await broker.requestUpdate(message.viewId)
      }
      if (disposed || controller.signal.aborted) return
      endpoint.postMessage({
        protocol: UI_RPC_PROTOCOL,
        type: 'response',
        id: message.id,
        ok: true,
      } satisfies UiRpcMessage)
    } catch (error) {
      if (disposed || controller.signal.aborted) return
      endpoint.postMessage({
        protocol: UI_RPC_PROTOCOL,
        type: 'response',
        id: message.id,
        ok: false,
        error: { message: error instanceof Error ? error.message : String(error) },
      } satisfies UiRpcMessage)
    } finally {
      operations.delete(message.id)
    }
  })
  return Object.freeze({
    dispose: () => {
      if (disposed) return
      disposed = true
      remove()
      for (const operation of operations.values()) operation.abort()
      operations.clear()
      broker.dispose?.()
    },
  })
}

function addListener(
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
  throw new Error('Plugin UI RPC endpoint does not support message listeners')
}

function readMessage(value: unknown): UiRpcMessage | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const message = value as Partial<UiRpcMessage>
  if (
    message.protocol !== UI_RPC_PROTOCOL ||
    typeof message.id !== 'string' ||
    message.id.length > 128
  )
    return undefined
  if (message.type === 'cancelRequest') return message as UiRpcMessage
  if (message.type === 'request') {
    const keys =
      message.method === 'requestUpdate'
        ? ['viewId']
        : message.method === 'revealLine'
          ? ['line']
          : message.method === 'revealLocation'
            ? ['location']
            : message.method === 'open'
              ? ['viewId', 'gesture']
              : message.method === 'notify'
                ? ['notice']
                : undefined
    if (
      !keys ||
      Object.keys(message).some((k) => !['protocol', 'type', 'id', 'method', ...keys].includes(k))
    )
      return undefined
    if (
      message.viewId !== undefined &&
      (typeof message.viewId !== 'string' || message.viewId.length > 128)
    )
      return undefined
    if (
      message.method === 'open' &&
      (typeof message.viewId !== 'string' ||
        (message.gesture !== undefined && typeof message.gesture !== 'string'))
    )
      return undefined
    if (
      message.method === 'revealLine' &&
      (!Number.isSafeInteger(message.line) || message.line! < 1)
    )
      return undefined
    return message as UiRpcMessage
  }
  return message.type === 'response' ? (message as UiRpcMessage) : undefined
}

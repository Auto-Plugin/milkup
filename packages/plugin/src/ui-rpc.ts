import type { PluginIsolationRpcEndpoint, PluginIsolationRpcMessageListener } from './isolation-rpc'
import type { PluginUiBroker } from './ui-broker'

interface UiRpcMessage {
  readonly protocol: typeof UI_RPC_PROTOCOL
  readonly type: 'request' | 'response'
  readonly id: string
  readonly method?: 'requestUpdate' | 'revealLine'
  readonly viewId?: string
  readonly line?: number
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
    { resolve(): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }
  >()
  const remove = addListener(endpoint, (value) => {
    const message = readMessage(value)
    if (!message || message.type !== 'response') return
    const request = pending.get(message.id)
    if (!request) return
    pending.delete(message.id)
    clearTimeout(request.timer)
    if (message.ok) request.resolve()
    else request.reject(new Error(message.error?.message ?? 'Plugin UI RPC failed'))
  })

  return Object.freeze({
    requestUpdate: (viewId?: string) =>
      request('requestUpdate', viewId === undefined ? {} : { viewId }),
    revealLine: (line: number) => request('revealLine', { line }),
    dispose: () => {
      disposed = true
      remove()
      for (const request of pending.values()) {
        clearTimeout(request.timer)
        request.reject(new Error('Plugin UI RPC broker is disposed'))
      }
      pending.clear()
    },
  })

  function request(
    method: NonNullable<UiRpcMessage['method']>,
    input: Pick<UiRpcMessage, 'viewId' | 'line'>,
  ): Promise<void> {
    if (disposed) return Promise.reject(new Error('Plugin UI RPC broker is disposed'))
    const id = `${Date.now().toString(36)}-${(nextId++).toString(36)}`
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id)
        reject(new Error(`Plugin UI RPC timed out: ${method}`))
      }, timeoutMs)
      pending.set(id, { resolve, reject, timer })
      endpoint.postMessage({
        protocol: UI_RPC_PROTOCOL,
        type: 'request',
        id,
        method,
        ...input,
      } satisfies UiRpcMessage)
    })
  }
}

export function createPluginUiRpcServer(
  endpoint: PluginIsolationRpcEndpoint,
  broker: PluginUiBroker,
): { dispose(): void } {
  return Object.freeze({
    dispose: addListener(endpoint, async (value) => {
      const message = readMessage(value)
      if (!message || message.type !== 'request') return
      try {
        if (message.method === 'revealLine') {
          await broker.revealLine(Number(message.line))
        } else {
          await broker.requestUpdate(message.viewId)
        }
        endpoint.postMessage({
          protocol: UI_RPC_PROTOCOL,
          type: 'response',
          id: message.id,
          ok: true,
        } satisfies UiRpcMessage)
      } catch (error) {
        endpoint.postMessage({
          protocol: UI_RPC_PROTOCOL,
          type: 'response',
          id: message.id,
          ok: false,
          error: { message: error instanceof Error ? error.message : String(error) },
        } satisfies UiRpcMessage)
      }
    }),
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
  return message.protocol === UI_RPC_PROTOCOL &&
    typeof message.id === 'string' &&
    (message.type === 'request' || message.type === 'response')
    ? (message as UiRpcMessage)
    : undefined
}

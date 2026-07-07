import type {
  IsolatedPluginActivateRequest,
  IsolatedPluginActivateResult,
  IsolatedPluginCommandRequest,
  IsolatedPluginCommandResult,
  IsolatedPluginDeactivateRequest,
  IsolatedPluginRenderRequest,
  PluginIsolationHost,
} from './isolation'

export interface PluginIsolationRpcEndpoint {
  postMessage(message: unknown): void
  addEventListener?(type: 'message', listener: PluginIsolationRpcMessageListener): void
  removeEventListener?(type: 'message', listener: PluginIsolationRpcMessageListener): void
  on?(type: 'message', listener: (message: unknown) => void): void
  off?(type: 'message', listener: (message: unknown) => void): void
}

export type PluginIsolationRpcMessageListener = (event: { readonly data: unknown }) => void

export interface PluginIsolationRpcHostOptions {
  readonly timeoutMs?: number
}

export interface PluginIsolationRpcServer {
  dispose(): void
}

export interface RpcPluginIsolationHost extends PluginIsolationHost {
  deactivate(request: IsolatedPluginDeactivateRequest): Promise<void>
  dispose(): void
  dispose(request: IsolatedPluginDeactivateRequest): Promise<void>
}

type RpcMethod = 'activate' | 'deactivate' | 'runCommand' | 'render' | 'dispose'

interface RpcRequestMessage {
  readonly protocol: typeof RPC_PROTOCOL
  readonly type: 'request'
  readonly id: string
  readonly method: RpcMethod
  readonly payload: unknown
}

interface RpcResponseMessage {
  readonly protocol: typeof RPC_PROTOCOL
  readonly type: 'response'
  readonly id: string
  readonly ok: boolean
  readonly value?: unknown
  readonly error?: {
    readonly message: string
  }
}

type RpcMessage = RpcRequestMessage | RpcResponseMessage

const RPC_PROTOCOL = 'milkup.plugin.isolation.rpc.v1'
const DEFAULT_TIMEOUT_MS = 5_000

export function createRpcPluginIsolationHost(
  endpoint: PluginIsolationRpcEndpoint,
  options: PluginIsolationRpcHostOptions = {},
): RpcPluginIsolationHost {
  let nextId = 0
  let disposed = false
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const pending = new Map<
    string,
    {
      resolve(value: unknown): void
      reject(error: Error): void
      timer: ReturnType<typeof setTimeout>
    }
  >()
  const removeListener = addMessageListener(endpoint, (message) => {
    const response = readRpcMessage(message)

    if (!response || response.type !== 'response') {
      return
    }

    const request = pending.get(response.id)

    if (!request) {
      return
    }

    pending.delete(response.id)
    clearTimeout(request.timer)

    if (response.ok) {
      request.resolve(response.value)
    } else {
      request.reject(new Error(response.error?.message ?? 'Plugin isolation RPC failed'))
    }
  })

  function call(method: RpcMethod, payload: unknown): Promise<unknown> {
    if (disposed) {
      return Promise.reject(new Error('Plugin isolation RPC host is disposed'))
    }

    const id = `${Date.now().toString(36)}-${nextId.toString(36)}`
    nextId += 1

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id)
        reject(new Error(`Plugin isolation RPC timed out: ${method}`))
      }, timeoutMs)

      pending.set(id, { resolve, reject, timer })
      endpoint.postMessage({
        protocol: RPC_PROTOCOL,
        type: 'request',
        id,
        method,
        payload,
      } satisfies RpcRequestMessage)
    })
  }

  function disposeRpcHost(): void {
    disposed = true
    removeListener()

    for (const [id, request] of pending) {
      pending.delete(id)
      clearTimeout(request.timer)
      request.reject(new Error('Plugin isolation RPC host is disposed'))
    }
  }

  const dispose: RpcPluginIsolationHost['dispose'] = ((
    request?: IsolatedPluginDeactivateRequest,
  ) => {
    if (!request) {
      disposeRpcHost()
      return undefined
    }

    return call('dispose', request).then(() => undefined)
  }) as RpcPluginIsolationHost['dispose']

  return Object.freeze({
    activate: (request: IsolatedPluginActivateRequest) =>
      call('activate', request) as Promise<IsolatedPluginActivateResult>,
    deactivate: async (request: IsolatedPluginDeactivateRequest) => {
      await call('deactivate', request)
    },
    runCommand: (request: IsolatedPluginCommandRequest) =>
      call('runCommand', request) as Promise<IsolatedPluginCommandResult>,
    render: (request: IsolatedPluginRenderRequest) => call('render', request),
    dispose,
  })
}

export function createPluginIsolationRpcServer(
  endpoint: PluginIsolationRpcEndpoint,
  host: PluginIsolationHost,
): PluginIsolationRpcServer {
  const removeListener = addMessageListener(endpoint, async (message) => {
    const request = readRpcMessage(message)

    if (!request || request.type !== 'request') {
      return
    }

    try {
      const value = await runRpcRequest(host, request)
      endpoint.postMessage({
        protocol: RPC_PROTOCOL,
        type: 'response',
        id: request.id,
        ok: true,
        value,
      } satisfies RpcResponseMessage)
    } catch (error) {
      endpoint.postMessage({
        protocol: RPC_PROTOCOL,
        type: 'response',
        id: request.id,
        ok: false,
        error: {
          message: error instanceof Error ? error.message : String(error),
        },
      } satisfies RpcResponseMessage)
    }
  })

  return Object.freeze({
    dispose: removeListener,
  })
}

async function runRpcRequest(
  host: PluginIsolationHost,
  request: RpcRequestMessage,
): Promise<unknown> {
  if (request.method === 'activate') {
    return host.activate(request.payload as IsolatedPluginActivateRequest)
  }

  if (request.method === 'deactivate') {
    return host.deactivate(request.payload as IsolatedPluginDeactivateRequest)
  }

  if (request.method === 'runCommand') {
    return host.runCommand(request.payload as IsolatedPluginCommandRequest)
  }

  if (request.method === 'render') {
    return host.render(request.payload as IsolatedPluginRenderRequest)
  }

  return host.dispose?.(request.payload as IsolatedPluginDeactivateRequest)
}

function addMessageListener(
  endpoint: PluginIsolationRpcEndpoint,
  listener: (message: unknown) => void,
): () => void {
  if (endpoint.addEventListener) {
    const eventListener: PluginIsolationRpcMessageListener = (event) => listener(event.data)

    endpoint.addEventListener('message', eventListener)
    return () => endpoint.removeEventListener?.('message', eventListener)
  }

  if (endpoint.on) {
    endpoint.on('message', listener)
    return () => endpoint.off?.('message', listener)
  }

  throw new Error('Plugin isolation RPC endpoint does not support message listeners')
}

function readRpcMessage(message: unknown): RpcMessage | undefined {
  if (!isRecord(message)) {
    return undefined
  }

  if (message.protocol !== RPC_PROTOCOL) {
    return undefined
  }

  if (message.type !== 'request' && message.type !== 'response') {
    return undefined
  }

  if (typeof message.id !== 'string') {
    return undefined
  }

  return message as unknown as RpcMessage
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

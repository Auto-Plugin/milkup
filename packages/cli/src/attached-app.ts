export interface AttachedJsonRpcRequest {
  readonly jsonrpc: '2.0'
  readonly id: number
  readonly method: string
  readonly params?: unknown
}

export interface AttachedJsonRpcSuccess {
  readonly jsonrpc: '2.0'
  readonly id: number
  readonly result: unknown
}

export interface AttachedJsonRpcFailure {
  readonly jsonrpc: '2.0'
  readonly id: number
  readonly error: {
    readonly code: number
    readonly message: string
  }
}

export type AttachedJsonRpcResponse = AttachedJsonRpcSuccess | AttachedJsonRpcFailure

export async function callAttachedApp(
  url: string,
  method: string,
  params?: unknown,
): Promise<unknown> {
  if (typeof globalThis.fetch !== 'function') {
    throw new Error('Attached app mode requires a runtime with global fetch')
  }

  const request: AttachedJsonRpcRequest = {
    jsonrpc: '2.0',
    id: 1,
    method,
    ...(params === undefined ? {} : { params }),
  }
  const response = await globalThis.fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(request),
  })

  if (!response.ok) {
    throw new Error(`Attached app request failed with HTTP ${response.status}`)
  }

  const message = (await response.json()) as AttachedJsonRpcResponse

  if ('error' in message) {
    throw new Error(message.error.message)
  }

  return message.result
}

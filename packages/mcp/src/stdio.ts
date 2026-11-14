import { createInterface } from 'node:readline/promises'
import type { Readable, Writable } from 'node:stream'

import {
  createDefaultMcpServerContext,
  handleMcpJsonRpcRequest,
  type JsonRpcRequest,
  type McpServerContext,
} from './server'

export interface StdioMcpServerOptions {
  readonly input?: Readable
  readonly output?: Writable
  readonly context?: McpServerContext
}

export async function runStdioMcpServer(options: StdioMcpServerOptions = {}): Promise<void> {
  const input = options.input ?? process.stdin
  const output = options.output ?? process.stdout
  const context = options.context ?? createDefaultMcpServerContext()
  const lines = createInterface({ input })

  for await (const line of lines) {
    if (line.trim().length === 0) {
      continue
    }

    const response = await handleMcpJsonRpcRequest(parseRequest(line), context)

    if (response) {
      output.write(`${JSON.stringify(response)}\n`)
    }
  }
}

function parseRequest(line: string): JsonRpcRequest {
  const parsed = JSON.parse(line) as unknown

  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('Invalid JSON-RPC request')
  }

  return parsed as JsonRpcRequest
}

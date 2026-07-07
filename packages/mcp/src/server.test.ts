import { describe, expect, it } from 'vitest'

import {
  ActionRegistry,
  BasicEditor,
  createBuiltinActions,
  EditorState,
  MemoryTextDocument,
  Selection,
} from '@milkup/core'
import { Readable, Writable } from 'node:stream'

import { handleMcpJsonRpcRequest } from './server'
import { runStdioMcpServer } from './stdio'

describe('MCP JSON-RPC server', () => {
  it('responds to initialize with tool and resource capabilities', async () => {
    await expect(
      handleMcpJsonRpcRequest({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
      }),
    ).resolves.toMatchObject({
      jsonrpc: '2.0',
      id: 1,
      result: {
        serverInfo: { name: 'milkup-mcp' },
        capabilities: {
          tools: {},
          resources: {},
        },
      },
    })
  })

  it('lists tools through MCP using Action Registry permissions', async () => {
    const response = await handleMcpJsonRpcRequest(
      {
        jsonrpc: '2.0',
        id: 'tools',
        method: 'tools/list',
      },
      {
        registry: new ActionRegistry(createBuiltinActions()),
        permissions: ['document:read', 'view:write'],
      },
    )

    expect(response).toMatchObject({
      jsonrpc: '2.0',
      id: 'tools',
      result: {
        tools: [
          expect.objectContaining({
            name: 'milkup_action_document__setSelection',
            annotations: expect.objectContaining({ actionId: 'document.setSelection' }),
          }),
          expect.objectContaining({
            name: 'milkup_action_view__setMode',
            annotations: expect.objectContaining({ actionId: 'view.setMode' }),
          }),
        ],
      },
    })
    expect(JSON.stringify(response)).not.toContain('document.replaceSelection')
  })

  it('calls a tool and dispatches through the shared action implementation', async () => {
    const editor = new BasicEditor(
      new EditorState({
        doc: new MemoryTextDocument('hello world'),
        selection: Selection.range(6, 11),
      }),
    )

    const response = await handleMcpJsonRpcRequest(
      {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: {
          name: 'milkup_action_document__replaceSelection',
          arguments: { text: 'milkup' },
        },
      },
      {
        registry: new ActionRegistry(createBuiltinActions()),
        permissions: ['document:write'],
        allowlist: ['document.replaceSelection'],
        actionContext: {
          editor,
          permissions: ['document:write'],
        },
      },
    )

    expect(response).toMatchObject({
      jsonrpc: '2.0',
      id: 2,
      result: {
        content: [{ type: 'text', text: '{\n  "changed": true\n}' }],
      },
    })
    expect(editor.state.doc.text).toBe('hello milkup')
    expect(editor.state.history.canUndo).toBe(true)
  })

  it('lists and reads resources', async () => {
    const context = {
      currentDocument: { documentId: 'doc', text: '# Title' },
      currentSelection: { anchor: 0, head: 3 },
      workspaceFiles: ['z.md', 'a.md'],
    }
    const listResponse = await handleMcpJsonRpcRequest(
      { jsonrpc: '2.0', id: 3, method: 'resources/list' },
      context,
    )
    const readResponse = await handleMcpJsonRpcRequest(
      {
        jsonrpc: '2.0',
        id: 4,
        method: 'resources/read',
        params: { uri: 'milkup://documents/doc/source' },
      },
      context,
    )

    expect(listResponse).toMatchObject({
      result: {
        resources: [
          { uri: 'milkup://documents/doc/source', mimeType: 'text/markdown' },
          { uri: 'milkup://selection/current', mimeType: 'application/json' },
          { uri: 'milkup://workspace/files', mimeType: 'application/json' },
        ],
      },
    })
    expect(readResponse).toMatchObject({
      result: {
        contents: [{ uri: 'milkup://documents/doc/source', text: '# Title' }],
      },
    })
  })

  it('returns JSON-RPC errors for unsupported methods', async () => {
    await expect(
      handleMcpJsonRpcRequest({
        jsonrpc: '2.0',
        id: 'bad',
        method: 'unknown/method',
      }),
    ).resolves.toMatchObject({
      jsonrpc: '2.0',
      id: 'bad',
      error: {
        code: -32000,
        message: 'Unsupported MCP method: unknown/method',
      },
    })
  })
})

describe('MCP stdio transport', () => {
  it('writes one JSON-RPC response per input line', async () => {
    const input = Readable.from([
      JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' }),
      '\n',
      JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }),
      '\n',
    ])
    const output = new StringWritable()

    await runStdioMcpServer({
      input,
      output,
      context: {
        registry: new ActionRegistry(createBuiltinActions()),
        permissions: ['document:read'],
      },
    })

    const responses = output.value
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { id: number; result: unknown })

    expect(responses.map((response) => response.id)).toEqual([1, 2])
    expect(responses[1]?.result).toMatchObject({
      tools: [
        expect.objectContaining({
          name: 'milkup_action_document__setSelection',
        }),
      ],
    })
  })
})

class StringWritable extends Writable {
  value = ''

  override _write(
    chunk: string | Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    this.value += chunk.toString()
    callback()
  }
}

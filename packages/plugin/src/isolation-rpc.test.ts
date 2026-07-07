import { describe, expect, it, vi } from 'vitest'

import {
  ActionRegistry,
  BasicEditor,
  EditorState,
  MemoryTextDocument,
  Selection,
} from '@milkup/core'

import { createIsolatedPluginModule } from './isolation'
import { createPluginIsolationRpcServer, createRpcPluginIsolationHost } from './isolation-rpc'
import type { PluginManifest } from './manifest'
import { PluginRuntime } from './runtime'

describe('plugin isolation RPC', () => {
  it('runs isolated plugin commands over a message endpoint', async () => {
    const { main, worker } = createEndpointPair()
    const remoteHost = createRemoteHost()
    const server = createPluginIsolationRpcServer(worker, remoteHost)
    const rpcHost = createRpcPluginIsolationHost(main)
    const registry = new ActionRegistry()
    const runtime = new PluginRuntime({
      actionRegistry: registry,
      allowedPermissions: ['document:write'],
    })
    const editor = createEditor('hello', Selection.cursor(5))

    runtime.loadPlugin({
      manifest: commandManifest(),
      module: createIsolatedPluginModule({
        manifest: commandManifest(),
        host: rpcHost,
      }),
    })
    await runtime.enablePlugin('rpc-tools')
    await expect(
      registry.run(
        'rpc.insertText',
        {
          editor,
          permissions: ['document:write'],
        },
        { text: ' worker' },
      ),
    ).resolves.toEqual({
      ok: true,
      value: { inserted: ' worker' },
    })

    expect(remoteHost.activate).toHaveBeenCalledWith(
      expect.objectContaining({
        pluginId: 'rpc-tools',
      }),
    )
    expect(remoteHost.runCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        pluginId: 'rpc-tools',
        input: { text: ' worker' },
        selection: { anchor: 5 },
      }),
    )
    expect(editor.state.doc.text).toBe('hello worker')
    expect(editor.state.history.canUndo).toBe(true)

    await runtime.disablePlugin('rpc-tools')
    expect(remoteHost.dispose).toHaveBeenCalledWith({ pluginId: 'rpc-tools' })
    expect(remoteHost.deactivate).toHaveBeenCalledWith({ pluginId: 'rpc-tools' })
    rpcHost.dispose()
    server.dispose()
  })

  it('routes renderer calls and propagates remote renderer errors', async () => {
    const { main, worker } = createEndpointPair()
    const remoteHost = createRemoteHost()
    const server = createPluginIsolationRpcServer(worker, remoteHost)
    const rpcHost = createRpcPluginIsolationHost(main)
    const runtime = new PluginRuntime()

    runtime.loadPlugin({
      manifest: rendererManifest(),
      module: createIsolatedPluginModule({
        manifest: rendererManifest(),
        host: rpcHost,
      }),
    })
    await runtime.enablePlugin('rpc-renderers')

    await expect(
      runtime.render('rpc-renderers', 'rpc-renderer', {
        nodeType: 'callout',
        source: 'ok',
      }),
    ).resolves.toEqual({
      ok: true,
      value: '<section>ok</section>',
    })

    remoteHost.render.mockRejectedValueOnce(new Error('remote renderer boom'))

    await expect(
      runtime.render('rpc-renderers', 'rpc-renderer', {
        nodeType: 'callout',
        source: 'bad',
      }),
    ).resolves.toMatchObject({
      ok: false,
      fallback: true,
      error: {
        message: 'remote renderer boom',
      },
    })

    rpcHost.dispose()
    server.dispose()
  })

  it('rejects pending requests when the remote side returns an error', async () => {
    const { main, worker } = createEndpointPair()
    const remoteHost = createRemoteHost()
    const server = createPluginIsolationRpcServer(worker, remoteHost)
    const rpcHost = createRpcPluginIsolationHost(main)

    remoteHost.runCommand.mockRejectedValueOnce(new Error('remote command boom'))

    await expect(
      rpcHost.runCommand({
        pluginId: 'rpc-tools',
        command: commandManifest().contributes?.commands?.[0] ?? {
          id: 'rpc.insertText',
          title: 'Insert Text',
          action: 'rpc.insertText',
        },
        input: {},
        permissions: [],
        hostCapabilities: [],
      }),
    ).rejects.toThrow('remote command boom')

    rpcHost.dispose()
    server.dispose()
  })

  it('times out unanswered requests', async () => {
    const { main } = createEndpointPair()
    const rpcHost = createRpcPluginIsolationHost(main, { timeoutMs: 5 })

    await expect(
      rpcHost.activate({
        pluginId: 'timeout-plugin',
        manifest: commandManifest(),
        permissions: [],
        hostCapabilities: [],
      }),
    ).rejects.toThrow('timed out: activate')

    rpcHost.dispose()
  })

  it('rejects new and pending calls after dispose', async () => {
    const { main } = createEndpointPair()
    const rpcHost = createRpcPluginIsolationHost(main, { timeoutMs: 100 })
    const pending = rpcHost.activate({
      pluginId: 'dispose-plugin',
      manifest: commandManifest(),
      permissions: [],
      hostCapabilities: [],
    })

    rpcHost.dispose()

    await expect(pending).rejects.toThrow('RPC host is disposed')
    await expect(
      rpcHost.activate({
        pluginId: 'dispose-plugin',
        manifest: commandManifest(),
        permissions: [],
        hostCapabilities: [],
      }),
    ).rejects.toThrow('RPC host is disposed')
  })
})

function createRemoteHost() {
  return {
    activate: vi.fn(() => ({
      commands: ['rpc.insertText'],
      renderers: ['rpc-renderer'],
    })),
    deactivate: vi.fn(),
    dispose: vi.fn(),
    runCommand: vi.fn((request: { input: unknown; selection?: { anchor: number } }) => {
      const input = request.input as { text?: string }
      const text = input.text ?? ''
      const position = request.selection?.anchor ?? 0

      return {
        value: { inserted: text },
        transactions: [
          {
            changes: [{ from: position, to: position, insert: text }],
            selection: { anchor: position + text.length },
          },
        ],
      }
    }),
    render: vi.fn((request: { context: { source?: string } }) => {
      return `<section>${request.context.source ?? ''}</section>`
    }),
  }
}

function createEndpointPair() {
  const main = new MemoryEndpoint()
  const worker = new MemoryEndpoint()

  main.peer = worker
  worker.peer = main

  return { main, worker }
}

class MemoryEndpoint {
  peer: MemoryEndpoint | undefined
  private readonly listeners = new Set<(event: { readonly data: unknown }) => void>()

  postMessage(message: unknown): void {
    queueMicrotask(() => {
      for (const listener of this.peer?.listeners ?? []) {
        listener({ data: message })
      }
    })
  }

  addEventListener(_type: 'message', listener: (event: { readonly data: unknown }) => void): void {
    this.listeners.add(listener)
  }

  removeEventListener(
    _type: 'message',
    listener: (event: { readonly data: unknown }) => void,
  ): void {
    this.listeners.delete(listener)
  }
}

function commandManifest(): PluginManifest {
  return {
    id: 'rpc-tools',
    name: 'RPC Tools',
    version: '1.0.0',
    permissions: ['document:write'],
    contributes: {
      commands: [
        {
          id: 'rpc.insertText',
          title: 'Insert Text',
          action: 'rpc.insertText',
        },
      ],
    },
  }
}

function rendererManifest(): PluginManifest {
  return {
    id: 'rpc-renderers',
    name: 'RPC Renderers',
    version: '1.0.0',
    contributes: {
      renderers: [
        {
          id: 'rpc-renderer',
          nodeType: 'callout',
          module: './renderer.js',
        },
      ],
    },
  }
}

function createEditor(text: string, selection = Selection.cursor(text.length)): BasicEditor {
  return new BasicEditor(
    new EditorState({
      doc: new MemoryTextDocument(text),
      selection,
    }),
  )
}

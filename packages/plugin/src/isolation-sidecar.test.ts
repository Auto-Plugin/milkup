import { describe, expect, it, vi } from 'vitest'

import {
  ActionRegistry,
  BasicEditor,
  EditorState,
  MemoryTextDocument,
  Selection,
} from '@milkup/core'

import { createPluginIsolationRpcServer } from './isolation-rpc'
import { createSidecarPluginModule, type PluginSidecarEndpoint } from './isolation-sidecar'
import type { PluginManifest } from './manifest'
import { PluginRuntime } from './runtime'

describe('sidecar plugin module adapter', () => {
  it('starts a sidecar endpoint and runs commands over the isolation RPC protocol', async () => {
    const endpoints = createEndpointPair()
    const remoteHost = createRemoteHost()
    const server = createPluginIsolationRpcServer(endpoints.sidecar, remoteHost)
    const start = vi.fn(() => endpoints.main)
    const stop = vi.fn()
    const registry = new ActionRegistry()
    const runtime = new PluginRuntime({
      actionRegistry: registry,
      allowedHosts: ['sidecar'],
      allowedPermissions: ['document:write'],
    })
    const manifest = sidecarCommandManifest()
    const editor = createEditor('hello', Selection.cursor(5))

    runtime.loadPlugin({
      manifest,
      module: createSidecarPluginModule({
        manifest,
        moduleSpecifier: './sidecar.js',
        process: { start, stop },
      }),
    })
    await runtime.enablePlugin('sidecar-tools')

    expect(start).toHaveBeenCalledWith({
      pluginId: 'sidecar-tools',
      manifest,
      moduleSpecifier: './sidecar.js',
    })
    expect(remoteHost.activate).toHaveBeenCalledWith(
      expect.objectContaining({
        pluginId: 'sidecar-tools',
        manifest,
        permissions: ['document:write'],
      }),
    )

    await expect(
      registry.run(
        'sidecar.insertText',
        {
          editor,
          permissions: ['document:write'],
        },
        { text: ' sidecar' },
      ),
    ).resolves.toEqual({
      ok: true,
      value: { inserted: ' sidecar' },
    })
    expect(remoteHost.runCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        pluginId: 'sidecar-tools',
        input: { text: ' sidecar' },
        selection: { anchor: 5 },
      }),
    )
    expect(editor.state.doc.text).toBe('hello sidecar')
    expect(editor.state.history.canUndo).toBe(true)

    await runtime.disablePlugin('sidecar-tools')

    expect(remoteHost.dispose).toHaveBeenCalledWith({ pluginId: 'sidecar-tools' })
    expect(remoteHost.deactivate).toHaveBeenCalledWith({ pluginId: 'sidecar-tools' })
    expect(endpoints.main.close).toHaveBeenCalledTimes(1)
    expect(stop).toHaveBeenCalledWith({ pluginId: 'sidecar-tools' })

    server.dispose()
  })

  it('does not start sidecars unless the runtime explicitly allows the sidecar host tier', async () => {
    const endpoints = createEndpointPair()
    const start = vi.fn(() => endpoints.main)
    const runtime = new PluginRuntime()
    const manifest = sidecarCommandManifest()

    runtime.loadPlugin({
      manifest,
      module: createSidecarPluginModule({
        manifest,
        process: { start },
      }),
    })

    await expect(runtime.enablePlugin('sidecar-tools')).rejects.toThrow(
      'Plugin host is not allowed: sidecar',
    )
    expect(start).not.toHaveBeenCalled()
  })

  it('stops the sidecar process even when remote deactivate fails', async () => {
    const endpoints = createEndpointPair()
    const remoteHost = createRemoteHost()
    const server = createPluginIsolationRpcServer(endpoints.sidecar, remoteHost)
    const stop = vi.fn()
    const runtime = new PluginRuntime({
      allowedHosts: ['sidecar'],
      allowedPermissions: ['document:write'],
    })
    const manifest = sidecarCommandManifest()

    remoteHost.deactivate.mockRejectedValueOnce(new Error('remote deactivate failed'))
    runtime.loadPlugin({
      manifest,
      module: createSidecarPluginModule({
        manifest,
        process: {
          start: () => endpoints.main,
          stop,
        },
      }),
    })
    await runtime.enablePlugin('sidecar-tools')
    await runtime.disablePlugin('sidecar-tools')

    expect(runtime.getPlugin('sidecar-tools')?.errors).toMatchObject([
      {
        pluginId: 'sidecar-tools',
        phase: 'disable',
        message: 'remote deactivate failed',
      },
    ])
    expect(endpoints.main.close).toHaveBeenCalledTimes(1)
    expect(stop).toHaveBeenCalledWith({ pluginId: 'sidecar-tools' })

    server.dispose()
  })
})

function createRemoteHost() {
  return {
    activate: vi.fn(() => ({
      commands: ['sidecar.insertText'],
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
    render: vi.fn(),
  }
}

function createEndpointPair(): {
  readonly main: MemoryEndpoint
  readonly sidecar: MemoryEndpoint
} {
  const main = new MemoryEndpoint()
  const sidecar = new MemoryEndpoint()

  main.peer = sidecar
  sidecar.peer = main

  return { main, sidecar }
}

class MemoryEndpoint implements PluginSidecarEndpoint {
  peer: MemoryEndpoint | undefined
  readonly close = vi.fn()
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

function sidecarCommandManifest(): PluginManifest {
  return {
    id: 'sidecar-tools',
    name: 'Sidecar Tools',
    version: '1.0.0',
    host: 'sidecar',
    permissions: ['document:write'],
    contributes: {
      commands: [
        {
          id: 'sidecar.insertText',
          title: 'Insert Text',
          action: 'sidecar.insertText',
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

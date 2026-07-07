import { describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'

import {
  ActionRegistry,
  BasicEditor,
  EditorState,
  MemoryTextDocument,
  Selection,
} from '@milkup/core'
import { dispatchInsert, type SdkPluginCommandContext } from '@milkup/plugin-sdk'

import { createPluginFileBroker, type PluginFileBrokerAdapter } from './filesystem-broker'
import { createPluginNetworkBroker, type PluginNetworkBrokerAdapter } from './network-broker'
import { createIsolatedPluginModule } from './isolation'
import { createPluginModuleIsolationHost } from './isolation-module-host'
import { createPluginIsolationRpcServer, createRpcPluginIsolationHost } from './isolation-rpc'
import type { PluginManifest } from './manifest'
import { PluginRuntime, type PluginModule } from './runtime'

describe('PluginModuleIsolationHost', () => {
  it('executes a plugin module behind the RPC boundary using the plugin SDK', async () => {
    const { main, worker } = createEndpointPair()
    const manifest = commandManifest()
    const module: PluginModule = {
      commands: {
        'realm.insertText': (context, input) => {
          const text = readTextInput(input)

          dispatchInsert(context as unknown as SdkPluginCommandContext, text, {
            commandId: 'realm.insertText',
          })
          return { inserted: text }
        },
      },
    }
    const remoteHost = createPluginModuleIsolationHost({ manifest, module })
    const server = createPluginIsolationRpcServer(worker, remoteHost)
    const rpcHost = createRpcPluginIsolationHost(main)
    const registry = new ActionRegistry()
    const runtime = new PluginRuntime({
      actionRegistry: registry,
      allowedPermissions: ['document:write'],
    })
    const editor = createEditor('hello', Selection.cursor(5))

    runtime.loadPlugin({
      manifest,
      module: createIsolatedPluginModule({ manifest, host: rpcHost }),
    })
    await runtime.enablePlugin('realm-tools')

    await expect(
      registry.run(
        'realm.insertText',
        {
          editor,
          permissions: ['document:write'],
        },
        { text: ' realm' },
      ),
    ).resolves.toEqual({
      ok: true,
      value: { inserted: ' realm' },
    })
    expect(editor.state.doc.text).toBe('hello realm')
    expect(editor.state.selection.main.head).toBe('hello realm'.length)
    expect(editor.state.history.canUndo).toBe(true)

    rpcHost.dispose()
    server.dispose()
  })

  it('runs activation-returned commands and renderer handlers in the isolated module host', async () => {
    const manifest = fullManifest()
    const dispose = vi.fn()
    const deactivate = vi.fn()
    const module: PluginModule = {
      activate: () => ({
        commands: {
          'realm.insertText': (context, input) => {
            dispatchInsert(context as unknown as SdkPluginCommandContext, readTextInput(input), {
              commandId: 'realm.insertText',
            })
            return 'activated-command'
          },
        },
        renderers: {
          'realm-renderer': (context) => `<mark>${context.source ?? ''}</mark>`,
        },
        dispose,
      }),
      deactivate,
    }
    const host = createPluginModuleIsolationHost({ manifest, module })

    await expect(
      host.activate({
        pluginId: manifest.id,
        manifest,
        permissions: ['document:write'],
        hostCapabilities: [],
      }),
    ).resolves.toEqual({
      commands: ['realm.insertText'],
      renderers: ['realm-renderer'],
    })
    await expect(
      host.runCommand({
        pluginId: manifest.id,
        command: manifest.contributes?.commands?.[0] ?? {
          id: 'realm.insertText',
          title: 'Insert Text',
          action: 'realm.insertText',
        },
        input: { text: 'x' },
        selection: { anchor: 0 },
        permissions: ['document:write'],
        hostCapabilities: [],
      }),
    ).resolves.toMatchObject({
      value: 'activated-command',
      transactions: [
        {
          changes: [{ from: 0, to: 0, insert: 'x' }],
          selection: { anchor: 1 },
        },
      ],
    })
    await expect(
      host.render({
        pluginId: manifest.id,
        renderer: manifest.contributes?.renderers?.[0] ?? {
          id: 'realm-renderer',
          nodeType: 'mark',
          module: './renderer.js',
        },
        context: {
          nodeType: 'mark',
          source: 'hi',
        },
      }),
    ).resolves.toBe('<mark>hi</mark>')

    await host.dispose?.({ pluginId: manifest.id })
    await host.deactivate({ pluginId: manifest.id })

    expect(dispose).toHaveBeenCalledTimes(1)
    expect(deactivate).toHaveBeenCalledTimes(1)
  })

  it('exposes only explicitly allowed host capabilities inside the isolated realm', async () => {
    const readText = vi.fn(() => 'secret')
    const writeText = vi.fn()
    const fetch = vi.fn(() => 'network')
    const module: PluginModule = {
      activate: (context) => {
        expect(context.host.readText).toBe(readText)
        expect(context.host.writeText).toBeUndefined()
        expect(context.host.fetch).toBeUndefined()
      },
    }
    const host = createPluginModuleIsolationHost({
      manifest: capabilityManifest(),
      module,
      host: {
        readText,
        writeText,
        fetch,
      },
    })

    await host.activate({
      pluginId: 'realm-capabilities',
      manifest: capabilityManifest(),
      permissions: ['file:read'],
      hostCapabilities: ['file:read'],
    })
  })

  it('routes isolated file capabilities through the filesystem broker', async () => {
    const adapter = createMemoryFileAdapter({
      '/workspace/doc.md': 'broker',
    })
    const rawReadText = vi.fn(() => 'raw')
    const module: PluginModule = {
      commands: {
        'realm.readFile': async (context) =>
          context.host.readText ? context.host.readText('/workspace/doc.md') : 'missing',
      },
    }
    const host = createPluginModuleIsolationHost({
      manifest: capabilityManifest(),
      module,
      host: {
        readText: rawReadText,
      },
      fileBroker: createPluginFileBroker({
        manifest: capabilityManifest(),
        roots: [{ id: 'workspace', path: '/workspace' }],
        adapter,
      }),
    })
    const command = {
      id: 'realm.readFile',
      title: 'Read File',
      action: 'realm.readFile',
    }

    await expect(
      host.runCommand({
        pluginId: 'realm-capabilities',
        command,
        input: {},
        permissions: ['file:read'],
        hostCapabilities: ['file:read'],
      }),
    ).resolves.toMatchObject({
      value: 'broker',
    })
    await expect(
      host.runCommand({
        pluginId: 'realm-capabilities',
        command,
        input: {},
        permissions: ['file:read'],
        hostCapabilities: [],
      }),
    ).resolves.toMatchObject({
      value: 'missing',
    })
    expect(adapter.readText).toHaveBeenCalledTimes(1)
    expect(rawReadText).not.toHaveBeenCalled()
  })

  it('routes isolated network capabilities through the network broker only when exposed', async () => {
    const manifest = networkCapabilityManifest()
    const adapter = createMemoryNetworkAdapter('broker')
    const rawFetch = vi.fn(() => 'raw')
    const module: PluginModule = {
      commands: {
        'realm.fetch': async (context) =>
          context.host.fetch ? context.host.fetch('https://api.example.test/data') : 'missing',
      },
    }
    const host = createPluginModuleIsolationHost({
      manifest,
      module,
      host: {
        fetch: rawFetch,
      },
      networkBroker: createPluginNetworkBroker({
        manifest,
        adapter,
        allowedOrigins: ['https://api.example.test'],
      }),
    })
    const command = {
      id: 'realm.fetch',
      title: 'Fetch',
      action: 'realm.fetch',
    }

    await expect(
      host.runCommand({
        pluginId: manifest.id,
        command,
        input: {},
        permissions: ['network:access'],
        hostCapabilities: ['network:access'],
      }),
    ).resolves.toMatchObject({
      value: 'broker',
    })
    await expect(
      host.runCommand({
        pluginId: manifest.id,
        command,
        input: {},
        permissions: ['network:access'],
        hostCapabilities: [],
      }),
    ).resolves.toMatchObject({
      value: 'missing',
    })
    expect(adapter.fetch).toHaveBeenCalledWith('https://api.example.test/data', undefined)
    expect(rawFetch).not.toHaveBeenCalled()
  })

  it('rejects plugin id mismatches before executing module code', async () => {
    const handler = vi.fn()
    const host = createPluginModuleIsolationHost({
      manifest: commandManifest(),
      module: {
        commands: {
          'realm.insertText': handler,
        },
      },
    })

    await expect(
      host.runCommand({
        pluginId: 'wrong-plugin',
        command: commandManifest().contributes?.commands?.[0] ?? {
          id: 'realm.insertText',
          title: 'Insert Text',
          action: 'realm.insertText',
        },
        input: {},
        permissions: [],
        hostCapabilities: [],
      }),
    ).rejects.toThrow('Isolated plugin id mismatch')
    expect(handler).not.toHaveBeenCalled()
  })
})

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
    id: 'realm-tools',
    name: 'Realm Tools',
    version: '1.0.0',
    permissions: ['document:write'],
    contributes: {
      commands: [
        {
          id: 'realm.insertText',
          title: 'Insert Text',
          action: 'realm.insertText',
        },
      ],
    },
  }
}

function fullManifest(): PluginManifest {
  const commands = commandManifest().contributes?.commands ?? []

  return {
    ...commandManifest(),
    contributes: {
      commands,
      renderers: [
        {
          id: 'realm-renderer',
          nodeType: 'mark',
          module: './renderer.js',
        },
      ],
    },
  }
}

function capabilityManifest(): PluginManifest {
  return {
    id: 'realm-capabilities',
    name: 'Realm Capabilities',
    version: '1.0.0',
    permissions: ['file:read'],
  }
}

function networkCapabilityManifest(): PluginManifest {
  return {
    id: 'realm-network-capabilities',
    name: 'Realm Network Capabilities',
    version: '1.0.0',
    permissions: ['network:access'],
  }
}

function createMemoryFileAdapter(
  files: Readonly<Record<string, string>>,
): PluginFileBrokerAdapter & {
  readonly readText: Mock<(path: string) => string>
  readonly writeText: Mock<(path: string, text: string) => void>
  readonly deleteFile: Mock<(path: string) => void>
} {
  const store = new Map(Object.entries(files))

  return {
    resolvePath: (path: string) => path.replaceAll('\\', '/').replace(/\/+/g, '/'),
    readText: vi.fn((path: string) => store.get(path) ?? ''),
    writeText: vi.fn((path: string, text: string) => {
      store.set(path, text)
    }),
    deleteFile: vi.fn((path: string) => {
      store.delete(path)
    }),
  }
}

function createMemoryNetworkAdapter(value: unknown): PluginNetworkBrokerAdapter & {
  readonly fetch: Mock<(url: string, init?: unknown) => unknown>
} {
  return {
    fetch: vi.fn((_url: string, _init?: unknown) => value),
  }
}

function readTextInput(input: unknown): string {
  return typeof input === 'object' &&
    input !== null &&
    'text' in input &&
    typeof input.text === 'string'
    ? input.text
    : ''
}

function createEditor(text: string, selection = Selection.cursor(text.length)): BasicEditor {
  return new BasicEditor(
    new EditorState({
      doc: new MemoryTextDocument(text),
      selection,
    }),
  )
}

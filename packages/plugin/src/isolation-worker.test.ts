import { describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'

import {
  ActionRegistry,
  BasicEditor,
  EditorState,
  MemoryDocumentSource,
  MemoryTextDocument,
  Selection,
} from '@milkup/core'
import { dispatchInsert } from '@milkup/plugin-sdk'

import { createPluginDocumentBroker } from './document-broker'
import { createPluginUiBroker } from './ui-broker'
import {
  createPluginFileBroker,
  type PluginFileAuditRecord,
  type PluginFileBrokerAdapter,
} from './filesystem-broker'
import {
  createPluginNetworkBroker,
  type PluginNetworkAuditRecord,
  type PluginNetworkBrokerAdapter,
} from './network-broker'
import { createIsolatedPluginModule } from './isolation'
import {
  createBrowserWorkerPluginHost,
  initializePluginWorkerRealm,
  installNetworkGuards,
} from './isolation-worker'
import type { PluginManifest } from './manifest'
import { PluginRuntime, type PluginModule } from './runtime'

describe('browser worker plugin isolation', () => {
  it('streams document scan results into an isolated plugin', async () => {
    const { main, worker } = createEndpointPair()
    const manifest: PluginManifest = {
      id: 'outline-worker',
      name: 'Outline Worker',
      version: '1.0.0',
      main: './outline.js',
      permissions: ['document:read'],
      contributes: {
        ui: [
          {
            id: 'outline',
            title: 'Outline',
            slot: 'sidebar-panel',
            scope: 'document',
          },
        ],
      },
    }
    const source = new MemoryDocumentSource({
      documentId: 'outline-doc',
      text: ['# One', '## Two'].join('\n'),
      version: 3,
    })
    const documentBroker = createPluginDocumentBroker({
      pluginId: manifest.id,
      source: () => source,
    })
    const headings: string[] = []
    const uiUpdates: string[] = []
    const revealedLines: number[] = []
    const uiBroker = createPluginUiBroker({
      pluginId: manifest.id,
      viewIds: ['outline'],
      update: (pluginId, viewId) => {
        uiUpdates.push(`${pluginId}:${viewId}`)
      },
      revealLine: (line) => {
        revealedLines.push(line)
      },
    })
    const module: PluginModule = {
      activate: async (context) => {
        const scanner = context.host.document?.scan({
          query: { kind: 'markdownHeadings' },
          windowSizeLines: 1,
        })

        if (!scanner) throw new Error('Document scan host is unavailable')
        for await (const event of scanner) {
          if (event.type === 'batch') {
            headings.push(
              ...event.items.filter((item) => item.kind === 'heading').map((item) => item.label),
            )
            await context.host.ui?.requestUpdate('outline')
          }
        }
        await context.host.ui?.revealLine(2)
      },
    }
    const realm = initializePluginWorkerRealm(worker, {
      importModule: async () => ({ default: module }),
    })
    const workerHost = createBrowserWorkerPluginHost({
      worker: main,
      manifest,
      moduleSpecifier: './outline.js',
      documentBroker,
      uiBroker,
    })
    const runtime = new PluginRuntime({
      allowedPermissions: ['document:read'],
      documentBroker,
      uiBroker,
    })

    await workerHost.ready
    runtime.loadPlugin({
      manifest,
      module: createIsolatedPluginModule({ manifest, host: workerHost.host }),
    })
    await runtime.enablePlugin(manifest.id)

    expect(headings).toEqual(['One', 'Two'])
    expect(uiUpdates).toEqual(['outline-worker:outline', 'outline-worker:outline'])
    expect(revealedLines).toEqual([2])
    workerHost.dispose()
    realm.dispose()
  })

  it('loads and executes a plugin module inside a worker-style realm', async () => {
    const { main, worker } = createEndpointPair()
    const manifest = commandManifest()
    const module: PluginModule = {
      commands: {
        'worker.insertText': (context, input) => {
          const text = readTextInput(input)

          dispatchInsert(context as unknown as Parameters<typeof dispatchInsert>[0], text, {
            commandId: 'worker.insertText',
          })
          return { inserted: text }
        },
      },
    }
    const realm = initializePluginWorkerRealm(worker, {
      importModule: async (specifier) => {
        expect(specifier).toBe('./worker-plugin.js')
        return { default: module }
      },
    })
    const workerHost = createBrowserWorkerPluginHost({
      worker: main,
      manifest,
      moduleSpecifier: './worker-plugin.js',
    })
    const registry = new ActionRegistry()
    const runtime = new PluginRuntime({
      actionRegistry: registry,
      allowedPermissions: ['document:write'],
    })
    const editor = createEditor('hello', Selection.cursor(5))

    await workerHost.ready
    runtime.loadPlugin({
      manifest,
      module: createIsolatedPluginModule({
        manifest,
        host: workerHost.host,
      }),
    })
    await runtime.enablePlugin('worker-tools')

    await expect(
      registry.run(
        'worker.insertText',
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
    expect(editor.state.doc.text).toBe('hello worker')
    expect(editor.state.history.canUndo).toBe(true)

    workerHost.dispose()
    realm.dispose()
  })

  it('reports worker module import failures during initialization', async () => {
    const { main, worker } = createEndpointPair()
    const realm = initializePluginWorkerRealm(worker, {
      importModule: async () => {
        throw new Error('missing plugin module')
      },
    })
    const workerHost = createBrowserWorkerPluginHost({
      worker: main,
      manifest: commandManifest(),
      moduleSpecifier: './missing.js',
    })

    await expect(workerHost.ready).rejects.toThrow('missing plugin module')

    workerHost.dispose()
    realm.dispose()
  })

  it('installs network guards before importing plugins without network permission', async () => {
    const { main, worker } = createEndpointPair()
    const realm = initializePluginWorkerRealm(worker, {
      importModule: async () => {
        expect(() => worker.fetch('https://example.test')).toThrow('network access is not allowed')
        expect(() => worker.eval('1 + 1')).toThrow('code loading is not allowed')
        expect(() => new worker.Function('return 1')).toThrow('code loading is not allowed')
        expect(() => worker.importScripts('https://example.test/plugin.js')).toThrow(
          'code loading is not allowed',
        )
        expect(() => new worker.Worker('https://example.test/child.js')).toThrow(
          'code loading is not allowed',
        )
        return {
          commands: {},
        }
      },
    })
    const workerHost = createBrowserWorkerPluginHost({
      worker: main,
      manifest: commandManifest(),
      moduleSpecifier: './no-network.js',
    })

    await expect(workerHost.ready).resolves.toBeUndefined()

    workerHost.dispose()
    realm.dispose()
  })

  it('blocks worker importScripts even when network access is brokered', async () => {
    const { main, worker } = createEndpointPair()
    const manifest = networkCommandManifest()
    const adapter = createMemoryNetworkAdapter({ ok: 'network' })
    const networkBroker = createPluginNetworkBroker({
      manifest,
      adapter,
      allowedOrigins: ['https://api.example.test'],
    })
    const realm = initializePluginWorkerRealm(worker, {
      importModule: async () => {
        expect(() => worker.importScripts('https://api.example.test/plugin.js')).toThrow(
          'code loading is not allowed',
        )
        await expect(worker.fetch('https://api.example.test/data')).resolves.toEqual({
          ok: 'network',
        })
        return {
          commands: {},
        }
      },
    })
    const workerHost = createBrowserWorkerPluginHost({
      worker: main,
      manifest,
      moduleSpecifier: './network-with-code-loading.js',
      networkBroker,
    })

    await expect(workerHost.ready).resolves.toBeUndefined()
    expect(adapter.fetch).toHaveBeenCalledWith('https://api.example.test/data', undefined)

    workerHost.dispose()
    realm.dispose()
  })

  it('blocks dynamic code execution even when network access is brokered', async () => {
    const { main, worker } = createEndpointPair()
    const manifest = networkCommandManifest()
    const adapter = createMemoryNetworkAdapter({ ok: 'network' })
    const networkBroker = createPluginNetworkBroker({
      manifest,
      adapter,
      allowedOrigins: ['https://api.example.test'],
    })
    const realm = initializePluginWorkerRealm(worker, {
      importModule: async () => {
        expect(() => worker.eval('1 + 1')).toThrow('code loading is not allowed')
        expect(() => new worker.Function('return 1')).toThrow('code loading is not allowed')
        await expect(worker.fetch('https://api.example.test/data')).resolves.toEqual({
          ok: 'network',
        })
        return {
          commands: {},
        }
      },
    })
    const workerHost = createBrowserWorkerPluginHost({
      worker: main,
      manifest,
      moduleSpecifier: './network-with-dynamic-code.js',
      networkBroker,
    })

    await expect(workerHost.ready).resolves.toBeUndefined()
    expect(adapter.fetch).toHaveBeenCalledWith('https://api.example.test/data', undefined)

    workerHost.dispose()
    realm.dispose()
  })

  it('blocks child worker creation even when network access is brokered', async () => {
    const { main, worker } = createEndpointPair()
    const manifest = networkCommandManifest()
    const adapter = createMemoryNetworkAdapter({ ok: 'network' })
    const networkBroker = createPluginNetworkBroker({
      manifest,
      adapter,
      allowedOrigins: ['https://api.example.test'],
    })
    const realm = initializePluginWorkerRealm(worker, {
      importModule: async () => {
        expect(() => new worker.Worker('https://api.example.test/child.js')).toThrow(
          'code loading is not allowed',
        )
        expect(() => new worker.SharedWorker('https://api.example.test/shared.js')).toThrow(
          'code loading is not allowed',
        )
        await expect(worker.fetch('https://api.example.test/data')).resolves.toEqual({
          ok: 'network',
        })
        return {
          commands: {},
        }
      },
    })
    const workerHost = createBrowserWorkerPluginHost({
      worker: main,
      manifest,
      moduleSpecifier: './network-with-child-workers.js',
      networkBroker,
    })

    await expect(workerHost.ready).resolves.toBeUndefined()
    expect(adapter.fetch).toHaveBeenCalledWith('https://api.example.test/data', undefined)

    workerHost.dispose()
    realm.dispose()
  })

  it('routes ambient worker fetch through the main-thread network broker before import', async () => {
    const { main, worker } = createEndpointPair()
    const manifest = networkCommandManifest()
    const adapter = createMemoryNetworkAdapter({ ok: 'import' })
    const networkBroker = createPluginNetworkBroker({
      manifest,
      adapter,
      allowedOrigins: ['https://api.example.test'],
    })
    const realm = initializePluginWorkerRealm(worker, {
      importModule: async () => {
        await expect(worker.fetch('https://api.example.test/import')).resolves.toEqual({
          ok: 'import',
        })
        return {
          commands: {},
        }
      },
    })
    const workerHost = createBrowserWorkerPluginHost({
      worker: main,
      manifest,
      moduleSpecifier: './network-before-import.js',
      networkBroker,
    })

    await expect(workerHost.ready).resolves.toBeUndefined()
    expect(adapter.fetch).toHaveBeenCalledWith('https://api.example.test/import', undefined)

    workerHost.dispose()
    realm.dispose()
  })

  it('routes worker file capabilities through the main-thread filesystem broker', async () => {
    const { main, worker } = createEndpointPair()
    const manifest = fileCommandManifest()
    const adapter = createMemoryFileAdapter({
      '/workspace/doc.md': 'hello',
    })
    const fileBroker = createPluginFileBroker({
      manifest,
      roots: [{ id: 'workspace', path: '/workspace' }],
      adapter,
    })
    const module: PluginModule = {
      commands: {
        'worker.updateFile': async (context) => {
          const text = await context.host.readText?.('/workspace/doc.md')

          await context.host.writeText?.('/workspace/doc.md', `${text} worker`)
          return { text }
        },
      },
    }
    const realm = initializePluginWorkerRealm(worker, {
      importModule: async () => ({ default: module }),
    })
    const workerHost = createBrowserWorkerPluginHost({
      worker: main,
      manifest,
      moduleSpecifier: './worker-file-plugin.js',
      fileBroker,
    })
    const registry = new ActionRegistry()
    const runtime = new PluginRuntime({
      actionRegistry: registry,
      allowedPermissions: ['file:read', 'file:write'],
      fileBroker,
    })

    await workerHost.ready
    runtime.loadPlugin({
      manifest,
      module: createIsolatedPluginModule({
        manifest,
        host: workerHost.host,
      }),
    })
    await runtime.enablePlugin('worker-file-tools')

    await expect(
      registry.run('worker.updateFile', {
        permissions: ['file:read', 'file:write'],
      }),
    ).resolves.toEqual({
      ok: true,
      value: { text: 'hello' },
    })
    expect(adapter.readText).toHaveBeenCalledWith('/workspace/doc.md')
    expect(adapter.writeText).toHaveBeenCalledWith('/workspace/doc.md', 'hello worker')

    workerHost.dispose()
    realm.dispose()
  })

  it('propagates filesystem broker denials from the main thread to worker commands', async () => {
    const { main, worker } = createEndpointPair()
    const manifest = fileCommandManifest()
    const adapter = createMemoryFileAdapter()
    const fileBroker = createPluginFileBroker({
      manifest,
      roots: [{ id: 'workspace', path: '/workspace' }],
      adapter,
    })
    const module: PluginModule = {
      commands: {
        'worker.updateFile': async (context) => context.host.readText?.('/private/secret.md'),
      },
    }
    const realm = initializePluginWorkerRealm(worker, {
      importModule: async () => ({ default: module }),
    })
    const workerHost = createBrowserWorkerPluginHost({
      worker: main,
      manifest,
      moduleSpecifier: './worker-file-plugin.js',
      fileBroker,
    })
    const registry = new ActionRegistry()
    const runtime = new PluginRuntime({
      actionRegistry: registry,
      allowedPermissions: ['file:read', 'file:write'],
      fileBroker,
    })

    await workerHost.ready
    runtime.loadPlugin({
      manifest,
      module: createIsolatedPluginModule({
        manifest,
        host: workerHost.host,
      }),
    })
    await runtime.enablePlugin('worker-file-tools')

    await expect(
      registry.run('worker.updateFile', {
        permissions: ['file:read', 'file:write'],
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: {
        phase: 'command',
        message: 'Plugin file path is outside allowed roots: /private/secret.md',
      },
    })
    expect(adapter.readText).not.toHaveBeenCalled()

    workerHost.dispose()
    realm.dispose()
  })

  it('records main-thread filesystem audit entries for worker broker access', async () => {
    const { main, worker } = createEndpointPair()
    const manifest = fileCommandManifest()
    const audit = vi.fn<(record: PluginFileAuditRecord) => void>()
    const adapter = createMemoryFileAdapter({
      '/workspace/doc.md': 'hello',
    })
    const fileBroker = createPluginFileBroker({
      manifest,
      roots: [{ id: 'workspace', path: '/workspace' }],
      adapter,
      audit,
    })
    const module: PluginModule = {
      commands: {
        'worker.updateFile': async (context, input) => {
          const path =
            typeof input === 'object' &&
            input !== null &&
            'path' in input &&
            typeof input.path === 'string'
              ? input.path
              : '/workspace/doc.md'

          return context.host.readText?.(path)
        },
      },
    }
    const realm = initializePluginWorkerRealm(worker, {
      importModule: async () => ({ default: module }),
    })
    const workerHost = createBrowserWorkerPluginHost({
      worker: main,
      manifest,
      moduleSpecifier: './worker-file-plugin.js',
      fileBroker,
    })
    const registry = new ActionRegistry()
    const runtime = new PluginRuntime({
      actionRegistry: registry,
      allowedPermissions: ['file:read', 'file:write'],
      fileBroker,
    })

    await workerHost.ready
    runtime.loadPlugin({
      manifest,
      module: createIsolatedPluginModule({
        manifest,
        host: workerHost.host,
      }),
    })
    await runtime.enablePlugin('worker-file-tools')

    await expect(
      registry.run(
        'worker.updateFile',
        {
          permissions: ['file:read', 'file:write'],
        },
        { path: '/workspace/doc.md' },
      ),
    ).resolves.toMatchObject({
      ok: true,
      value: 'hello',
    })
    await expect(
      registry.run(
        'worker.updateFile',
        {
          permissions: ['file:read', 'file:write'],
        },
        { path: '/private/secret.md' },
      ),
    ).resolves.toMatchObject({
      ok: false,
      error: {
        message: 'Plugin file path is outside allowed roots: /private/secret.md',
      },
    })

    expect(audit).toHaveBeenCalledWith({
      pluginId: 'worker-file-tools',
      operation: 'read',
      requestedPath: '/workspace/doc.md',
      resolvedPath: '/workspace/doc.md',
      rootId: 'workspace',
      ok: true,
    })
    expect(audit).toHaveBeenCalledWith({
      pluginId: 'worker-file-tools',
      operation: 'read',
      requestedPath: '/private/secret.md',
      ok: false,
      reason: 'Plugin file path is outside allowed roots: /private/secret.md',
    })

    workerHost.dispose()
    realm.dispose()
  })

  it('routes worker network capabilities through the main-thread network broker', async () => {
    const { main, worker } = createEndpointPair()
    const manifest = networkCommandManifest()
    const adapter = createMemoryNetworkAdapter({ ok: true })
    const networkBroker = createPluginNetworkBroker({
      manifest,
      adapter,
      allowedOrigins: ['https://api.example.test'],
    })
    const module: PluginModule = {
      commands: {
        'worker.fetch': async (context) =>
          context.host.fetch?.('https://api.example.test/data', {
            method: 'GET',
          }),
      },
    }
    const realm = initializePluginWorkerRealm(worker, {
      importModule: async () => ({ default: module }),
    })
    const workerHost = createBrowserWorkerPluginHost({
      worker: main,
      manifest,
      moduleSpecifier: './worker-network-plugin.js',
      networkBroker,
    })
    const registry = new ActionRegistry()
    const runtime = new PluginRuntime({
      actionRegistry: registry,
      allowedPermissions: ['network:access'],
      networkBroker,
    })

    await workerHost.ready
    runtime.loadPlugin({
      manifest,
      module: createIsolatedPluginModule({
        manifest,
        host: workerHost.host,
      }),
    })
    await runtime.enablePlugin('worker-network-tools')

    await expect(
      registry.run('worker.fetch', {
        permissions: ['network:access'],
      }),
    ).resolves.toEqual({
      ok: true,
      value: { ok: true },
    })
    expect(adapter.fetch).toHaveBeenCalledWith('https://api.example.test/data', {
      method: 'GET',
    })

    workerHost.dispose()
    realm.dispose()
  })

  it('propagates network broker denials from the main thread to worker commands', async () => {
    const { main, worker } = createEndpointPair()
    const manifest = networkCommandManifest()
    const adapter = createMemoryNetworkAdapter({ ok: true })
    const networkBroker = createPluginNetworkBroker({
      manifest,
      adapter,
      allowedOrigins: ['https://api.example.test'],
    })
    const module: PluginModule = {
      commands: {
        'worker.fetch': async (context) =>
          context.host.fetch?.('https://blocked.example.test/data'),
      },
    }
    const realm = initializePluginWorkerRealm(worker, {
      importModule: async () => ({ default: module }),
    })
    const workerHost = createBrowserWorkerPluginHost({
      worker: main,
      manifest,
      moduleSpecifier: './worker-network-plugin.js',
      networkBroker,
    })
    const registry = new ActionRegistry()
    const runtime = new PluginRuntime({
      actionRegistry: registry,
      allowedPermissions: ['network:access'],
      networkBroker,
    })

    await workerHost.ready
    runtime.loadPlugin({
      manifest,
      module: createIsolatedPluginModule({
        manifest,
        host: workerHost.host,
      }),
    })
    await runtime.enablePlugin('worker-network-tools')

    await expect(
      registry.run('worker.fetch', {
        permissions: ['network:access'],
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: {
        phase: 'command',
        message: 'Plugin network origin is not allowed: https://blocked.example.test',
      },
    })
    expect(adapter.fetch).not.toHaveBeenCalled()

    workerHost.dispose()
    realm.dispose()
  })

  it('records main-thread network audit entries for worker broker access', async () => {
    const { main, worker } = createEndpointPair()
    const manifest = networkCommandManifest()
    const audit = vi.fn<(record: PluginNetworkAuditRecord) => void>()
    const adapter = createMemoryNetworkAdapter({ ok: true })
    const networkBroker = createPluginNetworkBroker({
      manifest,
      adapter,
      allowedOrigins: ['https://api.example.test'],
      audit,
    })
    const module: PluginModule = {
      commands: {
        'worker.fetch': async (context, input) => {
          const url =
            typeof input === 'object' &&
            input !== null &&
            'url' in input &&
            typeof input.url === 'string'
              ? input.url
              : 'https://api.example.test/data'

          return context.host.fetch?.(url)
        },
      },
    }
    const realm = initializePluginWorkerRealm(worker, {
      importModule: async () => ({ default: module }),
    })
    const workerHost = createBrowserWorkerPluginHost({
      worker: main,
      manifest,
      moduleSpecifier: './worker-network-plugin.js',
      networkBroker,
    })
    const registry = new ActionRegistry()
    const runtime = new PluginRuntime({
      actionRegistry: registry,
      allowedPermissions: ['network:access'],
      networkBroker,
    })

    await workerHost.ready
    runtime.loadPlugin({
      manifest,
      module: createIsolatedPluginModule({
        manifest,
        host: workerHost.host,
      }),
    })
    await runtime.enablePlugin('worker-network-tools')

    await expect(
      registry.run(
        'worker.fetch',
        {
          permissions: ['network:access'],
        },
        { url: 'https://api.example.test/data' },
      ),
    ).resolves.toMatchObject({
      ok: true,
      value: { ok: true },
    })
    await expect(
      registry.run(
        'worker.fetch',
        {
          permissions: ['network:access'],
        },
        { url: 'https://blocked.example.test/data' },
      ),
    ).resolves.toMatchObject({
      ok: false,
      error: {
        message: 'Plugin network origin is not allowed: https://blocked.example.test',
      },
    })

    expect(audit).toHaveBeenCalledWith({
      pluginId: 'worker-network-tools',
      url: 'https://api.example.test/data',
      origin: 'https://api.example.test',
      ok: true,
    })
    expect(audit).toHaveBeenCalledWith({
      pluginId: 'worker-network-tools',
      url: 'https://blocked.example.test/data',
      ok: false,
      reason: 'Plugin network origin is not allowed: https://blocked.example.test',
    })

    workerHost.dispose()
    realm.dispose()
  })

  it('routes allowed ambient fetch through a broker and blocks unbrokered network globals', async () => {
    const rawFetch = vi.fn((_url: string) => 'raw')
    const adapter = createMemoryNetworkAdapter('broker')
    const manifest: PluginManifest = {
      ...commandManifest(),
      permissions: ['document:write', 'network:access'],
    }
    const broker = createPluginNetworkBroker({
      manifest,
      adapter,
      allowedOrigins: ['https://api.example.test'],
    })
    const scope = {
      fetch: rawFetch,
      WebSocket: vi.fn(),
    }

    installNetworkGuards(scope, manifest, broker)

    await expect(scope.fetch('https://api.example.test/data')).resolves.toBe('broker')
    expect(adapter.fetch).toHaveBeenCalledWith('https://api.example.test/data', undefined)
    expect(rawFetch).not.toHaveBeenCalled()
    expect(() => scope.WebSocket('wss://api.example.test')).toThrow('not brokered')
  })

  it('terminates the worker endpoint when the browser worker host is disposed', async () => {
    const { main, worker } = createEndpointPair()
    const terminate = vi.fn()
    const realm = initializePluginWorkerRealm(worker, {
      importModule: async () => ({ commands: {} }),
    })
    main.onTerminate = terminate
    const workerHost = createBrowserWorkerPluginHost({
      worker: main,
      manifest: commandManifest(),
      moduleSpecifier: './worker-plugin.js',
    })

    await workerHost.ready
    workerHost.dispose()

    expect(terminate).toHaveBeenCalledTimes(1)
    realm.dispose()
  })
})

function createEndpointPair() {
  const main = new MemoryWorkerEndpoint()
  const worker = new MemoryWorkerEndpoint()

  main.peer = worker
  worker.peer = main

  return { main, worker }
}

class MemoryWorkerEndpoint {
  peer: MemoryWorkerEndpoint | undefined
  onTerminate: (() => void) | undefined
  fetch: (url: string) => unknown = (_url: string) => 'network'
  eval: (source: string) => unknown = (_source: string) => 'eval'
  Function: new (source: string) => unknown = class {
    constructor(_source: string) {}
  }
  importScripts: (url: string) => unknown = (_url: string) => 'script'
  Worker: new (url: string) => unknown = class {
    constructor(_url: string) {}
  }
  SharedWorker: new (url: string) => unknown = class {
    constructor(_url: string) {}
  }
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

  terminate(): void {
    this.onTerminate?.()
  }
}

function commandManifest(): PluginManifest {
  return {
    id: 'worker-tools',
    name: 'Worker Tools',
    version: '1.0.0',
    permissions: ['document:write'],
    contributes: {
      commands: [
        {
          id: 'worker.insertText',
          title: 'Insert Text',
          action: 'worker.insertText',
        },
      ],
    },
  }
}

function fileCommandManifest(): PluginManifest {
  return {
    id: 'worker-file-tools',
    name: 'Worker File Tools',
    version: '1.0.0',
    permissions: ['file:read', 'file:write'],
    contributes: {
      commands: [
        {
          id: 'worker.updateFile',
          title: 'Update File',
          action: 'worker.updateFile',
        },
      ],
    },
  }
}

function networkCommandManifest(): PluginManifest {
  return {
    id: 'worker-network-tools',
    name: 'Worker Network Tools',
    version: '1.0.0',
    permissions: ['network:access'],
    contributes: {
      commands: [
        {
          id: 'worker.fetch',
          title: 'Fetch',
          action: 'worker.fetch',
        },
      ],
    },
  }
}

function createMemoryFileAdapter(
  files: Readonly<Record<string, string>> = {},
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

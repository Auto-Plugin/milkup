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
    const terminate = vi.fn()
    main.onTerminate = terminate
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
    expect(main.listenerCount).toBe(0)
    expect(worker.listenerCount).toBe(0)
    expect(terminate).toHaveBeenCalledTimes(1)

    workerHost.dispose()
    expect(terminate).toHaveBeenCalledTimes(1)
    realm.dispose()
  })

  it('times out silent startup and releases host and broker listeners exactly once', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      const { main, worker } = createEndpointPair()
      const terminate = vi.fn()
      main.onTerminate = terminate
      const workerHost = createBrowserWorkerPluginHost({
        worker: main,
        manifest: commandManifest(),
        moduleSpecifier: './silent.js',
        timeoutMs: 25,
        documentBroker: createPluginDocumentBroker({
          pluginId: 'worker-tools',
          source: () => undefined,
        }),
        uiBroker: createPluginUiBroker({
          pluginId: 'worker-tools',
          viewIds: [],
          update: () => undefined,
        }),
      })
      expect(main.listenerCount).toBeGreaterThan(2)
      const failed = expect(workerHost.ready).rejects.toThrow(
        'Plugin worker initialization timed out: worker-tools',
      )
      await vi.advanceTimersByTimeAsync(25)
      await failed
      expect(main.listenerCount).toBe(0)
      expect(terminate).toHaveBeenCalledTimes(1)
      await expect(workerHost.host.render({} as never)).rejects.toThrow('host is disposed')
      worker.postMessage({ protocol: 'milkup.plugin.worker.init.v1', type: 'ready' })
      workerHost.dispose()
      workerHost.dispose()
      expect(terminate).toHaveBeenCalledTimes(1)
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('uses a bounded default startup timeout', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      const { main } = createEndpointPair()
      const workerHost = createBrowserWorkerPluginHost({
        worker: main,
        manifest: commandManifest(),
        moduleSpecifier: './silent.js',
      })
      const failed = expect(workerHost.ready).rejects.toThrow('initialization timed out')
      await vi.advanceTimersByTimeAsync(5_000)
      await failed
      expect(main.listenerCount).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('rejects early disposal even when startup is awaited later', async () => {
    const { main } = createEndpointPair()
    const terminate = vi.fn()
    main.onTerminate = terminate
    const workerHost = createBrowserWorkerPluginHost({
      worker: main,
      manifest: commandManifest(),
      moduleSpecifier: './pending.js',
    })
    workerHost.dispose()
    workerHost.dispose()
    // A later task may observe ready; disposal must not produce an unhandled rejection.
    await new Promise((resolve) => setTimeout(resolve, 0))
    await expect(workerHost.ready).rejects.toThrow('disposed before initialization')
    expect(main.listenerCount).toBe(0)
    expect(terminate).toHaveBeenCalledTimes(1)
  })

  it('cleans listeners and terminates when posting initialization fails', async () => {
    const { main } = createEndpointPair()
    const terminate = vi.fn()
    main.onTerminate = terminate
    vi.spyOn(main, 'postMessage').mockImplementation(() => {
      throw new Error('worker transport closed')
    })
    const workerHost = createBrowserWorkerPluginHost({
      worker: main,
      manifest: commandManifest(),
      moduleSpecifier: './unavailable.js',
    })
    await expect(workerHost.ready).rejects.toThrow('worker transport closed')
    expect(main.listenerCount).toBe(0)
    expect(terminate).toHaveBeenCalledTimes(1)
  })

  it('does not recreate realm RPC listeners after disposal during module import', async () => {
    const { main, worker } = createEndpointPair()
    let finishImport!: (module: unknown) => void
    const importing = new Promise((resolve) => {
      finishImport = resolve
    })
    const realm = initializePluginWorkerRealm(worker, { importModule: () => importing })
    const messages = vi.spyOn(worker, 'postMessage')
    const workerHost = createBrowserWorkerPluginHost({
      worker: main,
      manifest: commandManifest(),
      moduleSpecifier: './pending-import.js',
    })
    await Promise.resolve()
    expect(worker.listenerCount).toBeGreaterThan(0)
    realm.dispose()
    finishImport({ commands: {} })
    await Promise.resolve()
    expect(worker.listenerCount).toBe(0)
    expect(messages).not.toHaveBeenCalled()
    workerHost.dispose()
    await expect(workerHost.ready).rejects.toThrow('disposed before initialization')
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

  it('clears the startup timeout on success and disposes a ready host only once', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
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
      expect(vi.getTimerCount()).toBe(0)
      await vi.advanceTimersByTimeAsync(5_001)
      expect(terminate).not.toHaveBeenCalled()
      workerHost.dispose()
      workerHost.dispose()
      await expect(workerHost.ready).resolves.toBeUndefined()
      expect(main.listenerCount).toBe(0)
      expect(terminate).toHaveBeenCalledTimes(1)
      realm.dispose()
    } finally {
      vi.useRealTimers()
    }
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

  get listenerCount(): number {
    return this.listeners.size
  }

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

describe('worker transaction boundaries', () => {
  it.each(['error', 'messageerror'])(
    'revokes a ready ordinary worker on %s and rejects pending RPC',
    async (type) => {
      class OrdinaryWorker extends EventTarget {
        postMessage = vi.fn()
        terminate = vi.fn()
      }
      const worker = new OrdinaryWorker(),
        onIsolationError = vi.fn()
      const owner = createBrowserWorkerPluginHost({
        worker,
        manifest: commandManifest(),
        moduleSpecifier: './test.js',
        onIsolationError,
      })
      worker.dispatchEvent(
        new MessageEvent('message', {
          data: { protocol: 'milkup.plugin.worker.init.v1', type: 'ready' },
        }),
      )
      await owner.ready
      const pending = owner.host.activate({
        pluginId: 'worker-tools',
        manifest: commandManifest(),
        permissions: [],
        hostCapabilities: [],
      })
      worker.dispatchEvent(new Event(type))
      await expect(pending).rejects.toThrow('disposed')
      expect(onIsolationError).toHaveBeenCalledOnce()
      expect(worker.terminate).toHaveBeenCalledOnce()
      worker.dispatchEvent(new Event(type))
      expect(onIsolationError).toHaveBeenCalledOnce()
      await expect(
        owner.host.activate({
          pluginId: 'worker-tools',
          manifest: commandManifest(),
          permissions: [],
          hostCapabilities: [],
        }),
      ).rejects.toThrow('disposed')
    },
  )

  it('blocks persistent/raw worker capabilities before module top-level execution', async () => {
    const { main, worker } = createEndpointPair()
    const raw = worker as unknown as Record<string, any>
    raw.indexedDB = { open: vi.fn() }
    raw.caches = { open: vi.fn() }
    raw.navigator = { storage: { getDirectory: vi.fn() }, locks: {} }
    const check = vi.fn(() => {
      expect(() => raw.indexedDB).toThrow('not brokered')
      expect(() => raw.caches).toThrow('not brokered')
      expect(() => raw.navigator.storage).toThrow('not brokered')
      expect(() => new raw.BroadcastChannel('escape')).toThrow('not brokered')
      expect(() => Object.defineProperty(raw, 'Worker', { value: class {} })).toThrow()
      return { default: {} }
    })
    const realm = initializePluginWorkerRealm(worker, { importModule: check })
    const owner = createBrowserWorkerPluginHost({
      worker: main,
      manifest: commandManifest(),
      moduleSpecifier: './test.js',
    })
    try {
      await owner.ready
      expect(check).toHaveBeenCalledOnce()
    } finally {
      owner.dispose()
      realm.dispose()
    }
  })

  it('keeps a rejected top-level fetch violation sticky across an attempted host commit', async () => {
    const { main, worker } = createEndpointPair()
    let committed = false
    const fetch = vi.fn(async () => ({ ok: true }))
    const realm = initializePluginWorkerRealm(worker, {
      importModule: async () => {
        await expect(
          (worker as unknown as { fetch: (url: string) => Promise<unknown> }).fetch(
            'https://api.example.test/data',
          ),
        ).rejects.toThrow('not committed')
        return { default: {} }
      },
    })
    const owner = createBrowserWorkerPluginHost({
      worker: main,
      manifest: networkCommandManifest(),
      moduleSpecifier: './test.js',
      restrictedActivation: true,
      isActivationCommitted: () => committed,
      networkBroker: { fetch },
    })
    try {
      await owner.ready
      expect(fetch).not.toHaveBeenCalled()
      committed = true
      await expect(
        (worker as unknown as { fetch: (url: string) => Promise<unknown> }).fetch(
          'https://api.example.test/data',
        ),
      ).rejects.toThrow('not committed')
      expect(fetch).not.toHaveBeenCalled()
    } finally {
      owner.dispose()
      realm.dispose()
    }
  })
})

it('permits candidate settings/data reads but rejects persistent initialization writes and remembers them', async () => {
  const { main, worker } = createEndpointPair()
  const manifest: PluginManifest = {
    id: 'readonly-trial',
    name: 'Trial',
    version: '1.0.0',
    permissions: ['settings:write'],
  }
  let captured!: import('./runtime').RestrictedPluginHost
  const violation = vi.fn(),
    write = vi.fn(async () => {}),
    begin = vi.fn()
  let committed = false
  const realm = initializePluginWorkerRealm(worker, {
    importModule: () => ({
      activate: ({ host }: { host: typeof captured }) => {
        captured = host
      },
    }),
  })
  const owner = createBrowserWorkerPluginHost({
    worker: main,
    manifest,
    moduleSpecifier: './trial.js',
    restrictedActivation: true,
    isActivationCommitted: () => committed,
    onActivationViolation: violation,
    storageBroker: { getItem: async () => 'original bytes', setItem: write, removeItem: write },
    settingsBroker: {
      describe: async () => ({
        schema: { enabled: { type: 'boolean' as const } },
        defaults: { enabled: true },
      }),
      get: async () => ({
        revision: 0,
        schema: { enabled: { type: 'boolean' as const } },
        defaults: { enabled: true },
        values: { enabled: true },
      }),
      begin,
      preview: vi.fn(),
      commit: vi.fn(),
      cancel: vi.fn(async () => {}),
    },
  })
  try {
    await owner.ready
    await owner.host.activate({
      pluginId: manifest.id,
      manifest,
      permissions: manifest.permissions!,
      hostCapabilities: ['storage', 'settings:write'],
    })
    expect(await captured.storage!.getItem('key')).toBe('original bytes')
    expect(await captured.settings!.get('plugin')).toMatchObject({
      revision: 0,
      values: { enabled: true },
    })
    await expect(captured.storage!.setItem('key', 'changed')).rejects.toThrow('not committed')
    await expect(captured.settings!.begin('plugin')).rejects.toBeDefined()
    committed = true
    await expect(captured.storage!.removeItem('key')).rejects.toThrow('not committed')
    expect(write).not.toHaveBeenCalled()
    expect(begin).not.toHaveBeenCalled()
    expect(violation).toHaveBeenCalledOnce()
  } finally {
    owner.dispose()
    realm.dispose()
  }
})

it('seals native prototype entry points before top-level plugin evaluation', async () => {
  const { main, worker } = createEndpointPair()
  const prototype = Object.create(Object.getPrototypeOf(worker))
  const nativeFetch = vi.fn()
  Object.defineProperty(prototype, 'fetch', { configurable: true, value: nativeFetch })
  Object.defineProperty(prototype, 'indexedDB', {
    configurable: true,
    get: () => ({ open: vi.fn() }),
  })
  Object.setPrototypeOf(worker, prototype)
  const realm = initializePluginWorkerRealm(worker, {
    importModule: () => {
      expect(() => prototype.fetch()).toThrow('not allowed')
      expect(() => prototype.indexedDB).toThrow('not brokered')
      expect(() => Object.defineProperty(prototype, 'fetch', { value: nativeFetch })).toThrow()
      return {}
    },
  })
  const owner = createBrowserWorkerPluginHost({
    worker: main,
    manifest: commandManifest(),
    moduleSpecifier: './trial.js',
  })
  try {
    await owner.ready
    expect(nativeFetch).not.toHaveBeenCalled()
  } finally {
    owner.dispose()
    realm.dispose()
  }
})

it('retires via one trusted owner instead of racing remote dispose RPC against transport close', async () => {
  const { main, worker } = createEndpointPair()
  const terminate = vi.spyOn(main, 'terminate')
  const manifest = commandManifest()
  const realm = initializePluginWorkerRealm(worker, { importModule: () => ({}) })
  const owner = createBrowserWorkerPluginHost({
    worker: main,
    manifest,
    moduleSpecifier: './plugin.js',
  })
  await owner.ready
  const runtime = new PluginRuntime({ allowedPermissions: ['document:write'] })
  runtime.loadPlugin({
    manifest,
    module: createIsolatedPluginModule({
      manifest,
      host: owner.host,
      disposeIsolation: () => owner.dispose(),
    }),
  })
  await runtime.enablePlugin(manifest.id)
  const [disabled] = await Promise.all([runtime.disablePlugin(manifest.id), owner.dispose()])
  expect(disabled.errors.filter((error) => error.phase === 'disable')).toEqual([])
  expect(terminate).toHaveBeenCalledOnce()
  realm.dispose()
})

it('retries only failed owner termination without enabling the retired RPC again', async () => {
  const { main, worker } = createEndpointPair()
  const terminate = vi.spyOn(main, 'terminate').mockImplementationOnce(() => {
    throw new Error('terminate failed')
  })
  const realm = initializePluginWorkerRealm(worker, { importModule: () => ({}) })
  const owner = createBrowserWorkerPluginHost({
    worker: main,
    manifest: commandManifest(),
    moduleSpecifier: './plugin.js',
  })
  await owner.ready
  const first = owner.dispose()
  await expect(first).rejects.toThrow('cleanup failed')
  await owner.retryDispose()
  await expect(first).rejects.toThrow('cleanup failed')
  expect(terminate).toHaveBeenCalledTimes(2)
  await expect(
    owner.host.activate({
      pluginId: 'worker-tools',
      manifest: commandManifest(),
      permissions: [],
      hostCapabilities: [],
    }),
  ).rejects.toThrow('disposed')
  realm.dispose()
})

it('permits candidate broker file reads without widening roots or allowing file writes', async () => {
  const { main, worker } = createEndpointPair()
  const manifest: PluginManifest = {
    ...fileCommandManifest(),
    permissions: ['file:read', 'file:write', 'file:delete'],
  }
  const adapter = createMemoryFileAdapter({ '/data/current.txt': 'existing data' })
  let captured!: import('./runtime').RestrictedPluginHost
  let committed = false
  const violation = vi.fn()
  const realm = initializePluginWorkerRealm(worker, {
    importModule: () => ({
      activate: ({ host }: { host: typeof captured }) => {
        captured = host
      },
    }),
  })
  const owner = createBrowserWorkerPluginHost({
    worker: main,
    manifest,
    moduleSpecifier: './trial.js',
    restrictedActivation: true,
    isActivationCommitted: () => committed,
    onActivationViolation: violation,
    fileBroker: createPluginFileBroker({
      manifest,
      roots: [{ id: 'data', path: '/data' }],
      adapter,
    }),
  })
  try {
    await owner.ready
    await owner.host.activate({
      pluginId: manifest.id,
      manifest,
      permissions: manifest.permissions!,
      hostCapabilities: ['file:read', 'file:write', 'file:delete'],
    })
    expect(await captured.readText!('/data/current.txt')).toBe('existing data')
    await expect(captured.readText!('/private/secret.txt')).rejects.toThrow()
    expect(violation).not.toHaveBeenCalled()
    await expect(captured.writeText!('/data/current.txt', 'bad')).rejects.toThrow('not committed')
    committed = true
    await expect(captured.deleteFile!('/data/current.txt')).rejects.toThrow('not committed')
    expect(adapter.readText).toHaveBeenCalledExactlyOnceWith('/data/current.txt')
    expect(adapter.writeText).not.toHaveBeenCalled()
    expect(adapter.deleteFile).not.toHaveBeenCalled()
    expect(violation).toHaveBeenCalledOnce()
  } finally {
    await owner.dispose()
    realm.dispose()
  }
})

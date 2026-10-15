import { ActionRegistry, MemoryDocumentSource } from '@milkup/core'
import { parsePluginPackageArchive } from '@milkup/plugin'
import type { PluginManifest, PluginModule } from '@milkup/plugin'
import { describe, expect, it, vi } from 'vitest'
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import {
  createDesktopTemporaryStorage,
  type DesktopTemporaryStorage,
} from './plugin-temporary-storage'
import type { PluginStorageBroker, PluginTemporaryStore } from '@milkup/plugin'

import {
  createDesktopPluginActions,
  DesktopPluginManager,
  renderDesktopPluginManager,
  resolvePluginEntryPath,
  type DesktopLoadedPluginModule,
  type DesktopPluginModuleCapabilities,
} from './desktop-plugin-manager'

describe('DesktopPluginManager', () => {
  it('rejects a temporary-store plugin on SDK 0.1.0 before executing its module', async () => {
    const loadModule = vi.fn(async () => fakeLoadedModule())
    const manager = createManager({
      registry: new ActionRegistry(),
      storage: createMemoryStorage(),
      loadModule,
      readManifestText: async () =>
        JSON.stringify({ ...pluginManifest(), engines: { pluginSdk: '^0.1.1' } }),
    })
    const record = await manager.installManifestPath('D:/plugins/new/plugin.json')
    expect(record.errors.join(' ')).toContain('0.1.1')
    await manager.enable(record.manifest.id)
    expect(loadModule).not.toHaveBeenCalled()
  })

  it('cleans temporary stores on disable and close, and permits a fresh activation after close fails', async () => {
    const adapter = createDesktopTemporaryStorage({
      indexedDB: new IDBFactory(),
      keyRange: IDBKeyRange,
    })
    const storeCreate = vi.fn(adapter.create)
    let storage: PluginStorageBroker | undefined
    let page: PluginTemporaryStore | undefined
    const manager = createManager({
      registry: new ActionRegistry(),
      storage: createMemoryStorage(),
      temporaryStorage: { create: storeCreate },
      loadModule: async () => ({
        module: {
          runtimeHost: 'isolated',
          activate: async (context) => {
            storage = context.host.storage
            page = await storage!.createTemporaryStore!()
            await page.set('p', 'index')
            return { commands: { 'example.insert': () => undefined } }
          },
        },
        dispose: () => undefined,
      }),
    })
    await manager.installManifestPath('D:/plugins/example/plugin.json')
    await manager.enable('example-tools')
    const first = page!
    await manager.disable('example-tools')
    await expect(first.get('p')).rejects.toThrow('disposed')
    await manager.enable('example-tools')
    const second = page!
    await manager.disposeTemporaryStorage()
    await expect(second.get('p')).rejects.toThrow('disposed')
    await expect(storage!.createTemporaryStore!()).rejects.toThrow('disposed')
    await manager.enable('example-tools')
    await expect(page!.get('p')).resolves.toBe('index')
    expect(storeCreate).toHaveBeenCalledTimes(3)
    await manager.remove('example-tools')
    await expect(page!.get('p')).rejects.toThrow('disposed')
  })

  it('loads a relative entry from the plugin root and cleans runtime resources on disable', async () => {
    const registry = new ActionRegistry()
    const storage = createMemoryStorage()
    const loadedSpecifiers: string[] = []
    let disposed = 0
    const manager = createManager({
      registry,
      storage,
      loadModule: async (_manifest, specifier) => {
        loadedSpecifiers.push(specifier)
        return fakeLoadedModule(() => {
          disposed += 1
        })
      },
    })
    registerManagerActions(registry, manager)

    await manager.installManifestPath('D:/plugins/example/plugin.json')
    await manager.enable('example-tools')

    expect(loadedSpecifiers).toEqual(['D:/plugins/example/dist/plugin.js'])
    expect(registry.get('example.insert')).toBeDefined()
    expect(manager.state().contributions.commands.map((command) => command.id)).toEqual([
      'example.insert',
    ])

    await manager.disable('example-tools')

    expect(disposed).toBe(1)
    expect(registry.get('example.insert')).toBeUndefined()
    expect(manager.state().contributions.keymaps).toEqual([])
  })

  it.each(['error', 'silent', 'transport'] as const)(
    'reports %s Worker startup failure and releases the Worker',
    async (failure) => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      const listeners = new Set<(event: { data: unknown }) => void>()
      const terminate = vi.fn()
      vi.stubGlobal(
        'Worker',
        class {
          terminate = terminate
          addEventListener(_type: string, listener: (event: { data: unknown }) => void) {
            listeners.add(listener)
          }
          removeEventListener(_type: string, listener: (event: { data: unknown }) => void) {
            listeners.delete(listener)
          }
          postMessage() {
            if (failure === 'transport') throw new Error('worker transport closed')
            if (failure !== 'error') return
            queueMicrotask(() => {
              for (const listener of listeners) {
                listener({
                  data: {
                    protocol: 'milkup.plugin.worker.init.v1',
                    type: 'error',
                    error: { message: 'plugin module failed to import' },
                  },
                })
              }
            })
          }
        },
      )
      try {
        const manager = new DesktopPluginManager({
          actionRegistry: new ActionRegistry(),
          manifestHost: {
            selectManifestPath: async () => undefined,
            readManifestText: async () => JSON.stringify(pluginManifest()),
          },
          permissions: ['document:write'],
          milkupVersion: '0.1.0',
          pluginSdkVersion: '0.1.0',
          storage: createMemoryStorage(),
        })
        await manager.installManifestPath('/plugins/example/plugin.json')
        const enabling = manager.enable('example-tools')
        await vi.advanceTimersByTimeAsync(10_000)
        await enabling
        const errorMessage =
          failure === 'silent'
            ? 'initialization timed out'
            : failure === 'error'
              ? 'failed to import'
              : 'transport closed'
        expect(manager.state().records[0]).toMatchObject({ state: 'failed', enabled: false })
        expect(manager.state().records[0]?.errors.join(' ')).toContain(errorMessage)
        expect(terminate).toHaveBeenCalledTimes(1)
        expect(listeners.size).toBe(0)
        expect(vi.getTimerCount()).toBe(0)
      } finally {
        vi.unstubAllGlobals()
        vi.useRealTimers()
      }
    },
  )

  it('reactivates persisted enabled plugins during startup', async () => {
    const storage = createMemoryStorage()
    const firstRegistry = new ActionRegistry()
    const first = createManager({ registry: firstRegistry, storage })
    registerManagerActions(firstRegistry, first)
    await first.installManifestPath('D:/plugins/example/plugin.json')
    await first.enable('example-tools')

    const restoredRegistry = new ActionRegistry()
    const restored = createManager({ registry: restoredRegistry, storage })
    registerManagerActions(restoredRegistry, restored)
    await restored.ready

    expect(restored.state().records[0]).toMatchObject({ enabled: true, state: 'enabled' })
    expect(restoredRegistry.get('example.insert')).toBeDefined()
  })

  it('exports a validated local development package with its entry and resources', async () => {
    const registry = new ActionRegistry()
    const manifest: PluginManifest = {
      ...pluginManifest(),
      resources: ['assets/template.md'],
    }
    let exported = ''
    const manager = new DesktopPluginManager({
      actionRegistry: registry,
      manifestHost: {
        selectManifestPath: async () => undefined,
        readManifestText: async (path) => {
          if (path.endsWith('plugin.json')) return JSON.stringify(manifest)
          if (path.endsWith('dist/plugin.js')) return 'export const commands = {}'
          return '# Template'
        },
        selectPackageExportPath: async () => 'D:/exports/example.milkup-plugin',
        writeText: async (_path, text) => {
          exported = text
        },
      },
      permissions: ['document:write'],
      milkupVersion: '0.1.0',
      pluginSdkVersion: '0.1.0',
      storage: createMemoryStorage(),
      loadModule: async () => fakeLoadedModule(),
    })
    registerManagerActions(registry, manager)
    await manager.installManifestPath('D:/plugins/example/plugin.json')

    await expect(manager.exportLocalPackage('example-tools')).resolves.toBe(
      'D:/exports/example.milkup-plugin',
    )
    const archive = parsePluginPackageArchive(JSON.parse(exported))
    expect(archive.files.map((file) => file.path)).toEqual(['dist/plugin.js', 'assets/template.md'])
  })

  it('exports installed PNG icons as base64 and preserves them when reinstalling the archive', async () => {
    const icon = Uint8Array.from(
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZZkAAAAASUVORK5CYII=',
        'base64',
      ),
    )
    const manifest: PluginManifest = {
      ...pluginManifest(),
      icon: 'assets/logo.png',
      resources: ['assets/logo.png'],
    }
    let exported = ''
    const readPackageIcon = vi.fn(async () => icon)
    const manager = new DesktopPluginManager({
      actionRegistry: new ActionRegistry(),
      manifestHost: {
        selectManifestPath: async () => undefined,
        readManifestText: async (path) => {
          if (path.endsWith('plugin.json')) return JSON.stringify(manifest)
          if (path.endsWith('plugin.js')) return 'export default {}'
          throw new Error('Binary icons must not be read as UTF-8')
        },
        readPackageIcon,
        selectPackageExportPath: async () => '/exports/icon.milkup-plugin',
        writeText: async (_path, text) => {
          exported = text
        },
      },
      permissions: ['document:write'],
      milkupVersion: '0.1.0',
      pluginSdkVersion: '0.1.0',
      storage: createMemoryStorage(),
      loadModule: async () => fakeLoadedModule(),
    })
    await manager.installManifestPath('/installed/example/plugin.json')
    await manager.exportLocalPackage('example-tools')
    expect(readPackageIcon).toHaveBeenCalledWith('example-tools')
    const archive = parsePluginPackageArchive(JSON.parse(exported))
    const exportedIcon = archive.files.find((file) => file.path === manifest.icon)!
    expect(exportedIcon.encoding).toBe('base64')
    expect(Uint8Array.from(Buffer.from(exportedIcon.content, 'base64'))).toEqual(icon)
    const installPackage = vi.fn(async () => ({
      manifestPath: '/reinstalled/plugin.json',
      rootPath: '/reinstalled',
      dataRoot: '/data',
      storageRoot: '/storage',
    }))
    const reinstalled = new DesktopPluginManager({
      actionRegistry: new ActionRegistry(),
      manifestHost: {
        selectManifestPath: async () => undefined,
        readManifestText: async () => exported,
        installPackage,
      },
      permissions: ['document:write'],
      milkupVersion: '0.1.0',
      pluginSdkVersion: '0.1.0',
      storage: createMemoryStorage(),
      loadModule: async () => fakeLoadedModule(),
    })
    const record = await reinstalled.installManifestPath('/exports/icon.milkup-plugin')
    expect(record.manifest.icon).toBe('assets/logo.png')
    expect(installPackage).toHaveBeenCalledWith(archive)
  })

  it('keeps invalid manifests visible as install failures without damaging installed records', async () => {
    const registry = new ActionRegistry()
    const storage = createMemoryStorage()
    const manager = createManager({
      registry,
      storage,
      readManifestText: async (path) =>
        path.includes('broken') ? '{not-json' : JSON.stringify(pluginManifest()),
    })
    registerManagerActions(registry, manager)
    await manager.installManifestPath('D:/plugins/example/plugin.json')

    await expect(manager.installManifestPath('D:/plugins/broken/plugin.json')).rejects.toThrow(
      'Invalid plugin manifest JSON',
    )

    expect(manager.state().records).toHaveLength(1)
    expect(manager.state().installFailures).toMatchObject([
      { sourcePath: 'D:/plugins/broken/plugin.json' },
    ])
    expect(renderDesktopPluginManager(manager.state())).toContain('安装失败')
  })

  it('honors keymap when contexts and exposes conflicts in manager markup', async () => {
    const registry = new ActionRegistry()
    const manager = createManager({ registry, storage: createMemoryStorage() })
    registerManagerActions(registry, manager)
    await manager.installManifestPath('D:/plugins/example/plugin.json')
    await manager.enable('example-tools')
    const event = {
      key: 'T',
      ctrlKey: true,
      metaKey: false,
      altKey: true,
      shiftKey: false,
      isComposing: false,
    } as KeyboardEvent

    expect(
      manager.findKeymapAction(event, {
        editorFocus: false,
        documentOpen: true,
        sourceMode: false,
        liveMode: true,
      }),
    ).toBeUndefined()
    expect(
      manager.findKeymapAction(event, {
        editorFocus: true,
        documentOpen: true,
        sourceMode: false,
        liveMode: true,
      }),
    ).toBe('example.insert')
    expect(
      renderDesktopPluginManager(manager.state(), { selectedPluginId: 'example-tools' }),
    ).toContain('Mod+Alt+T')
  })

  it('runs ChatGPT-style importers and returns generated Markdown without a source file identity', async () => {
    const registry = new ActionRegistry()
    const manifest: PluginManifest = {
      id: 'chatgpt-importer',
      name: 'ChatGPT Importer',
      version: '1.0.0',
      main: './dist/plugin.js',
      contributes: {
        importers: [
          {
            id: 'chatgpt-export',
            title: 'ChatGPT Conversation',
            extensions: ['json'],
            target: 'markdown',
          },
        ],
      },
    }
    const manager = new DesktopPluginManager({
      actionRegistry: registry,
      manifestHost: {
        selectManifestPath: async () => undefined,
        readManifestText: async () => JSON.stringify(manifest),
      },
      permissions: [],
      milkupVersion: '0.1.0',
      pluginSdkVersion: '0.1.0',
      storage: createMemoryStorage(),
      loadModule: async () => ({
        module: {
          runtimeHost: 'isolated',
          activate: () => ({
            renderers: {
              'chatgpt-export': (context) => {
                const parsed = JSON.parse(context.source ?? '{}') as { title?: string }
                return { markdown: `# ${parsed.title ?? 'Conversation'}\n` }
              },
            },
          }),
        },
        dispose: () => undefined,
      }),
    })
    registerManagerActions(registry, manager)
    await manager.installManifestPath('D:/plugins/chatgpt/plugin.json')
    await manager.enable('chatgpt-importer')

    await expect(
      manager.openPluginDocument('D:/exports/conversation.json', '{"title":"Example"}'),
    ).resolves.toMatchObject({
      kind: 'generated-markdown',
      markdown: '# Example\n',
      sourcePath: 'D:/exports/conversation.json',
      pluginId: 'chatgpt-importer',
    })
  })

  it('requires explicit approval for file capabilities and revokes enabled resources', async () => {
    const registry = new ActionRegistry()
    const manifest: PluginManifest = {
      ...pluginManifest(),
      permissions: ['document:write', 'file:read'],
      contributes: {
        commands: [
          {
            id: 'example.insert',
            title: 'Insert example',
            action: 'example.insert',
            permissions: ['document:write'],
          },
        ],
      },
    }
    let disposed = 0
    const manager = new DesktopPluginManager({
      actionRegistry: registry,
      manifestHost: {
        selectManifestPath: async () => undefined,
        readManifestText: async () => JSON.stringify(manifest),
      },
      permissions: ['document:write', 'file:read'],
      milkupVersion: '0.1.0',
      pluginSdkVersion: '0.1.0',
      storage: createMemoryStorage(),
      loadModule: async () =>
        fakeLoadedModule(() => {
          disposed += 1
        }),
    })
    registerManagerActions(registry, manager)
    await manager.installManifestPath('D:/plugins/example/plugin.json')

    await manager.enable('example-tools')
    expect(manager.state().records[0]).toMatchObject({ state: 'failed', enabled: false })
    expect(manager.state().records[0]?.errors[0]).toContain('require approval')

    manager.approve('example-tools')
    await manager.enable('example-tools')
    expect(manager.state().records[0]).toMatchObject({ state: 'enabled', enabled: true })

    await manager.revokeApproval('example-tools')
    expect(disposed).toBe(1)
    expect(manager.state().records[0]).toMatchObject({ state: 'disabled', enabled: false })
  })

  it('keeps sidecar plugins disabled until their host is explicitly approved', async () => {
    const registry = new ActionRegistry()
    const manifest: PluginManifest = {
      id: 'native-tools',
      name: 'Native Tools',
      version: '1.0.0',
      host: 'sidecar',
      main: 'D:/plugins/native/native-tools.exe',
    }
    const loaded: string[] = []
    const manager = new DesktopPluginManager({
      actionRegistry: registry,
      manifestHost: {
        selectManifestPath: async () => undefined,
        readManifestText: async () => JSON.stringify(manifest),
      },
      permissions: [],
      milkupVersion: '0.1.0',
      pluginSdkVersion: '0.1.0',
      storage: createMemoryStorage(),
      loadSidecarModule: async (_plugin, executable) => {
        loaded.push(executable)
        return { module: { runtimeHost: 'isolated' }, dispose: () => undefined }
      },
    })
    registerManagerActions(registry, manager)
    await manager.installManifestPath('D:/plugins/native/plugin.json')

    await manager.enable('native-tools')
    expect(loaded).toEqual([])
    expect(manager.state().records[0]?.errors[0]).toContain('host:sidecar')

    manager.approve('native-tools')
    await manager.enable('native-tools')
    expect(loaded).toEqual(['D:/plugins/native/native-tools.exe'])
    expect(manager.state().records[0]).toMatchObject({ state: 'enabled', enabled: true })
  })

  it('provides document scan capabilities to plugins with document read permission', async () => {
    const registry = new ActionRegistry()
    const manifest: PluginManifest = {
      id: 'outline-tools',
      name: 'Outline Tools',
      version: '1.0.0',
      main: './dist/plugin.js',
      permissions: ['document:read'],
    }
    let documentBroker: DesktopPluginModuleCapabilities['documentBroker']
    const manager = new DesktopPluginManager({
      actionRegistry: registry,
      manifestHost: {
        selectManifestPath: async () => undefined,
        readManifestText: async () => JSON.stringify(manifest),
      },
      permissions: ['document:read'],
      milkupVersion: '0.1.0',
      pluginSdkVersion: '0.1.0',
      documentSource: () =>
        new MemoryDocumentSource({ documentId: 'active-doc', text: '# Outline', version: 2 }),
      loadModule: async (_plugin, _specifier, capabilities) => {
        documentBroker = capabilities?.documentBroker
        return { module: { runtimeHost: 'isolated' }, dispose: () => undefined }
      },
    })
    await manager.installManifestPath('D:/plugins/outline/plugin.json')
    await manager.enable(manifest.id)

    const started = await documentBroker!.start({ query: { kind: 'markdownHeadings' } })
    await expect(documentBroker!.next(started.scanId)).resolves.toMatchObject({
      type: 'batch',
      items: [{ kind: 'heading', label: 'Outline' }],
    })

    await manager.disable(manifest.id)
    await expect(documentBroker!.next(started.scanId)).rejects.toThrow('Unknown document scan')
  })
})

describe('resolvePluginEntryPath', () => {
  it('resolves package entries and rejects paths outside the package', () => {
    expect(resolvePluginEntryPath('D:/plugins/example/plugin.json', './dist/plugin.js')).toBe(
      'D:/plugins/example/dist/plugin.js',
    )
    expect(() => resolvePluginEntryPath('D:/plugins/example/plugin.json', '../plugin.js')).toThrow(
      'inside the plugin package root',
    )
  })
})

function createManager(options: {
  registry: ActionRegistry
  storage: Storage
  temporaryStorage?: DesktopTemporaryStorage
  readManifestText?: (path: string) => Promise<string>
  loadModule?: (manifest: PluginManifest, specifier: string) => Promise<DesktopLoadedPluginModule>
}): DesktopPluginManager {
  return new DesktopPluginManager({
    actionRegistry: options.registry,
    manifestHost: {
      selectManifestPath: async () => undefined,
      readManifestText: options.readManifestText ?? (async () => JSON.stringify(pluginManifest())),
    },
    permissions: ['document:write'],
    milkupVersion: '0.1.0',
    pluginSdkVersion: '0.1.0',
    storage: options.storage,
    ...(options.temporaryStorage ? { temporaryStorage: options.temporaryStorage } : {}),
    loadModule: options.loadModule ?? (async () => fakeLoadedModule()),
    now: () => 10,
  })
}

function registerManagerActions(registry: ActionRegistry, manager: DesktopPluginManager): void {
  for (const action of createDesktopPluginActions(manager)) {
    registry.register(action)
  }
}

function fakeLoadedModule(dispose: () => void = () => undefined): DesktopLoadedPluginModule {
  const module: PluginModule = {
    runtimeHost: 'isolated',
    activate: () => ({
      commands: {
        'example.insert': () => 'inserted',
      },
    }),
  }

  return { module, dispose }
}

function pluginManifest(): PluginManifest {
  return {
    id: 'example-tools',
    name: 'Example Tools',
    version: '1.0.0',
    main: './dist/plugin.js',
    permissions: ['document:write'],
    contributes: {
      commands: [
        {
          id: 'example.insert',
          title: 'Insert example',
          action: 'example.insert',
          permissions: ['document:write'],
        },
      ],
      keymaps: [{ command: 'example.insert', key: 'Mod+Alt+T', when: 'editorFocus' }],
    },
  }
}

function createMemoryStorage(): Storage {
  const values = new Map<string, string>()

  return {
    get length() {
      return values.size
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => {
      values.delete(key)
    },
    setItem: (key, value) => {
      values.set(key, value)
    },
  }
}

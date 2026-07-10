import { ActionRegistry, MemoryDocumentSource } from '@milkup/core'
import { parsePluginPackageArchive } from '@milkup/plugin'
import type { PluginManifest, PluginModule } from '@milkup/plugin'
import { describe, expect, it } from 'vitest'

import {
  createDesktopPluginActions,
  DesktopPluginManager,
  renderDesktopPluginManager,
  resolvePluginEntryPath,
  type DesktopLoadedPluginModule,
  type DesktopPluginModuleCapabilities,
} from './desktop-plugin-manager'

describe('DesktopPluginManager', () => {
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
    expect(renderDesktopPluginManager(manager.state())).toContain('Mod+Alt+T')
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

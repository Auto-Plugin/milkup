import { describe, expect, it } from 'vitest'

import {
  createPluginContributionIndex,
  createPluginScopedStorage,
  parsePluginRegistrySnapshot,
  PluginRegistry,
  serializePluginRegistry,
} from './registry'

describe('plugin registry', () => {
  it('installs local plugins, persists enable state, and restores records', () => {
    const registry = new PluginRegistry({
      now: () => 10,
      compatibility: { milkupVersion: '0.1.2', pluginSdkVersion: '0.1.0' },
    })

    registry.installLocalPlugin({
      manifest: pluginManifest(),
      manifestPath: 'D:/plugins/example/plugin.json',
    })
    const enabled = registry.markEnabled('example-tools')

    expect(enabled).toMatchObject({
      enabled: true,
      state: 'enabled',
      rootPath: 'D:/plugins/example',
      dataRoot: 'milkup://plugin-data/example-tools',
      storageRoot: 'milkup://plugin-storage/example-tools',
    })

    const restored = new PluginRegistry()
    restored.restore(parsePluginRegistrySnapshot(serializePluginRegistry(registry)))

    expect(restored.get('example-tools')).toMatchObject({
      enabled: true,
      state: 'enabled',
      manifestPath: 'D:/plugins/example/plugin.json',
    })
    expect(restored.auditLog().map((record) => record.operation)).toEqual(['install', 'enable'])
  })

  it('marks incompatible plugins as failed and keeps sidecar approval explicit', () => {
    const registry = new PluginRegistry({
      compatibility: { milkupVersion: '0.1.0', pluginSdkVersion: '0.1.0' },
    })

    const record = registry.installLocalPlugin({
      manifest: {
        ...pluginManifest(),
        host: 'sidecar',
        engines: { milkup: '^9.0.0' },
      },
      manifestPath: 'D:/plugins/example/plugin.json',
    })

    expect(record.state).toBe('failed')
    expect(record.errors).toEqual(['Requires Milkup ^9.0.0'])
    expect(record.approvals.hosts).toEqual([])
  })

  it('indexes enabled contributions and makes keymap priority deterministic', () => {
    const registry = new PluginRegistry()
    registry.installLocalPlugin({
      manifest: pluginManifest(),
      manifestPath: 'D:/plugins/example/plugin.json',
    })
    registry.installLocalPlugin({
      manifest: {
        ...pluginManifest(),
        id: 'other-tools',
        name: 'Other Tools',
        contributes: {
          commands: [
            {
              id: 'other.insert',
              title: 'Other Insert',
              action: 'other.insert',
            },
          ],
          keymaps: [{ command: 'other.insert', key: 'Ctrl+Alt+T' }],
        },
      },
      manifestPath: 'D:/plugins/other/plugin.json',
    })
    registry.markEnabled('example-tools')
    registry.markEnabled('other-tools')

    const index = createPluginContributionIndex(registry.list(), [
      {
        id: 'example.insert',
        title: 'Insert',
        category: 'plugin',
        run: () => undefined,
      },
      {
        id: 'other.insert',
        title: 'Other Insert',
        category: 'plugin',
        run: () => undefined,
      },
    ])

    expect(index.keymaps).toEqual([
      {
        pluginId: 'example-tools',
        command: 'example.insert',
        key: 'Mod+Alt+T',
        status: 'active',
      },
      {
        pluginId: 'other-tools',
        command: 'other.insert',
        key: 'Mod+Alt+T',
        status: 'shadowed',
        conflictWith: 'example.insert',
      },
    ])
    expect(index.ui).toHaveLength(1)
    expect(index.importers).toHaveLength(1)
  })

  it('isolates plugin storage keys', () => {
    const values = new Map<string, string>()
    const first = createPluginScopedStorage('first', {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
      removeItem: (key) => {
        values.delete(key)
      },
    })
    const second = createPluginScopedStorage('second', {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
      removeItem: (key) => {
        values.delete(key)
      },
    })

    first.setItem('setting', 'a')
    second.setItem('setting', 'b')

    expect(first.getItem('setting')).toBe('a')
    expect(second.getItem('setting')).toBe('b')
  })
})

function pluginManifest() {
  return {
    id: 'example-tools',
    name: 'Example Tools',
    version: '1.0.0',
    main: 'http://127.0.0.1:5173/example-plugin.js',
    engines: { milkup: '^0.1.0', pluginSdk: '^0.1.0' },
    permissions: ['document:write'],
    contributes: {
      commands: [
        {
          id: 'example.insert',
          title: 'Insert',
          action: 'example.insert',
          permissions: ['document:write'],
        },
      ],
      keymaps: [{ command: 'example.insert', key: 'Mod+Alt+T' }],
      renderers: [{ id: 'callout', nodeType: 'callout', module: './renderer.js' }],
      markdownSyntax: [{ id: 'callout', nodeType: 'callout', pattern: '^:::callout', block: true }],
      ui: [{ id: 'example-panel', slot: 'sidebar-panel', title: 'Example' }],
      importers: [
        {
          id: 'chatgpt-export',
          title: 'ChatGPT Export',
          extensions: ['json', 'html'],
          target: 'markdown',
        },
      ],
      documentTypes: [{ id: 'conversation', title: 'Conversation', extensions: ['json'] }],
    },
  }
}

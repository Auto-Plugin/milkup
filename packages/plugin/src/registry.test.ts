import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parsePluginManifest, validatePluginCompatibility } from './index'

import {
  createPluginContributionIndex,
  createPluginScopedStorage,
  parsePluginRegistrySnapshot,
  PluginRegistry,
  serializePluginRegistry,
} from './registry'

describe('plugin registry', () => {
  it.each(['0.3.2', '0.3.7', '0.3.8'])(
    'enforces the current workspace 1.0.1 restoration contract on SDK %s',
    (pluginSdkVersion) => {
      const manifest = parsePluginManifest(
        JSON.parse(
          readFileSync(new URL('../../../plugins/workspace/plugin.json', import.meta.url), 'utf8'),
        ),
      )
      expect(manifest.version).toBe('1.0.1')
      expect(manifest.engines?.pluginSdk).toBe('^0.3.8')
      expect(
        validatePluginCompatibility(manifest, { milkupVersion: '2.0.0-beta.3', pluginSdkVersion }),
      ).toEqual(pluginSdkVersion === '0.3.8' ? [] : ['Requires plugin SDK ^0.3.8'])
    },
  )

  it.each(['outline', 'updates', 'workspace', 'preferences', 'shortcuts'])(
    'restores installed %s under SDK 0.3.2 without altering range, approvals or enable state',
    (name) => {
      const currentManifest = JSON.parse(
        readFileSync(new URL(`../../../plugins/${name}/plugin.json`, import.meta.url), 'utf8'),
      )
      // This upgrade fixture describes the installed 1.0.0 workspace, before
      // host-owned restoration raised its minimum SDK to 0.3.8 in version 1.0.1.
      const manifest =
        name === 'workspace'
          ? {
              ...currentManifest,
              version: '1.0.0',
              engines: { ...currentManifest.engines, pluginSdk: '^0.3.0' },
            }
          : currentManifest
      const expectedRange =
        name === 'preferences'
          ? '^0.3.1'
          : name === 'shortcuts'
            ? '>=0.3.1 <0.4.0'
            : name === 'workspace'
              ? '^0.3.0'
              : '>=0.2.0 <0.4.0'
      expect(manifest.engines.pluginSdk).toBe(expectedRange)
      for (const mode of ['unapproved', 'disabled', 'enabled']) {
        const old = new PluginRegistry({
          compatibility: { milkupVersion: '2.0.0-beta.1', pluginSdkVersion: '0.3.1' },
          now: () => 123,
        })
        old.installLocalPlugin({ manifest, manifestPath: `/plugins/${name}/plugin.json` })
        if (mode !== 'unapproved') old.approve(manifest.id)
        if (mode === 'enabled') old.markEnabled(manifest.id)
        const before = parsePluginRegistrySnapshot(serializePluginRegistry(old))
        const upgraded = new PluginRegistry({
          compatibility: { milkupVersion: '2.0.0-beta.1', pluginSdkVersion: '0.3.2' },
          now: () => 456,
        })
        upgraded.restore(before)
        const restored = upgraded.get(manifest.id)!
        expect(restored.manifest.engines?.pluginSdk).toBe(expectedRange)
        expect(restored.approvals).toEqual(before.records[0]!.approvals)
        expect(restored.enabled).toBe(before.records[0]!.enabled)
        expect(restored.state).toBe(before.records[0]!.state)
        expect(restored.manifest.permissions).toEqual(before.records[0]!.manifest.permissions)
        expect(restored.errors).toEqual(before.records[0]!.errors)
      }
    },
  )

  it('revalidates restored enabled plugins against the upgraded application before loading', () => {
    const old = new PluginRegistry({
      compatibility: { milkupVersion: '0.1.0', pluginSdkVersion: '0.1.1' },
    })
    old.installLocalPlugin({ manifest: pluginManifest(), manifestPath: '/plugins/old/plugin.json' })
    old.markEnabled('example-tools')
    const snapshot = old.snapshot()
    const upgraded = new PluginRegistry({
      compatibility: { milkupVersion: '2.0.0-beta.1', pluginSdkVersion: '0.1.1' },
    })
    upgraded.restore(snapshot)
    expect(upgraded.get('example-tools')).toMatchObject({
      enabled: false,
      state: 'failed',
      errors: ['Requires Milkup ^0.1.0'],
    })
    expect(snapshot.records[0]!.enabled).toBe(true)
    expect(upgraded.get('example-tools')!.approvals).toEqual(snapshot.records[0]!.approvals)
  })
  it.each([
    ['>=0.2.0 <0.4.0', '0.2.0', true],
    ['>=0.2.0 <0.4.0', '0.3.0', true],
    ['>=0.2.0 <0.4.0', '0.4.0', false],
    ['>=0.2.0 <0.4.0', '0.1.9', false],
    ['>=0.2.0 <0.4.0', '0.3.0-beta.1', false],
    ['>=0.3.0-beta.1 <0.4.0', '0.3.0-beta.2', true],
    ['>=0.2 <0.4.0', '0.3.0', false],
    ['>=0.2.0 <0.4', '0.3.0', false],
    ['>=0.2.0 <garbage', '0.3.0', false],
    ['>=0.2.0 <0.4.*', '0.3.0', false],
    ['>=0.2.0 || <0.4.0', '0.3.0', false],
    ['>=0.2.0 <0.4.0 || *', '0.4.0', false],
    ['^0.1.1', '0.1.0', false],
    ['^0.1.1', '0.1.1', true],
    ['^0.1.1', '0.1.9', true],
    ['^0.1.1', '0.2.0', false],
    ['^0.0.2', '0.0.1', false],
    ['^0.0.2', '0.0.2', true],
    ['^0.0.2', '0.0.3', false],
    ['^1.2.3', '1.2.2', false],
    ['^1.2.3', '1.9.0', true],
    ['^1.2.3', '2.0.0', false],
    ['^0.1.0', '0.1.1', true],
    ['>=0.1.1', '0.1.0', false],
    ['>=0.1.1', '0.2.0', true],
    ['^0.1.1', '0.1.1-beta', false],
    ['^garbage', '0.1.1', false],
    ['^0.1', '0.1.1', false],
    ['^0.1.1', '0.1.1+build.2', true],
    ['^2.0.0-0', '2.0.0-beta.1', true],
    ['^2.0.0-0', '2.0.0', true],
    ['^2.0.0-0', '2.4.0', true],
    ['^2.0.0-0', '2.1.0-beta.1', false],
    ['^2.0.0-0', '3.0.0', false],
    ['^2.0.0', '2.0.0-beta.1', false],
    ['>=2.0.0-beta.2', '2.0.0-beta.10', true],
    ['>=2.0.0-beta.2', '2.0.0-beta.1', false],
  ])('enforces SDK range %s against %s', (range, version, compatible) => {
    const registry = new PluginRegistry({
      compatibility: { milkupVersion: '0.1.0', pluginSdkVersion: version },
    })
    const record = registry.installLocalPlugin({
      manifest: { ...pluginManifest(), engines: { pluginSdk: range } },
      manifestPath: '/plugins/example/plugin.json',
    })
    expect(record.errors.length === 0).toBe(compatible)
    expect(
      validatePluginCompatibility(record.manifest, {
        milkupVersion: '0.1.0',
        pluginSdkVersion: version,
      }),
    ).toEqual(record.errors)
  })

  it('exposes pure host preflight without changing manifest, registry or approval state', () => {
    const manifest = parsePluginManifest({
      ...pluginManifest(),
      engines: { milkup: '^9.0.0', pluginSdk: '>=0.4.0' },
    })
    const compatibility = { milkupVersion: '2.0.0-beta.1', pluginSdkVersion: '0.3.6' }
    const registry = new PluginRegistry({ compatibility })
    const before = registry.snapshot()
    const serialized = JSON.stringify(manifest)
    const errors = validatePluginCompatibility(manifest, compatibility)
    expect(errors).toEqual(['Requires Milkup ^9.0.0', 'Requires plugin SDK >=0.4.0'])
    expect(registry.snapshot()).toEqual(before)
    expect(JSON.stringify(manifest)).toBe(serialized)
    errors.push('caller-owned array')
    expect(validatePluginCompatibility(manifest, compatibility)).toEqual([
      'Requires Milkup ^9.0.0',
      'Requires plugin SDK >=0.4.0',
    ])
  })

  it('preserves preflight behavior when target or engines are omitted', () => {
    const manifest = parsePluginManifest(pluginManifest())
    expect(validatePluginCompatibility(manifest, undefined)).toEqual([])
    const { engines: _engines, ...withoutEngines } = manifest
    expect(
      validatePluginCompatibility(withoutEngines, {
        milkupVersion: '2.0.0-beta.1',
        pluginSdkVersion: '0.3.6',
      }),
    ).toEqual([])
  })

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

describe('P6 strict registry recovery', () => {
  const valid = () => {
    const registry = new PluginRegistry()
    registry.installLocalPlugin({
      manifest: {
        id: 'test.recovery',
        name: 'Recovery',
        version: '1.0.0',
        host: 'worker',
        permissions: [],
      },
      manifestPath: '/package/plugin.json',
    })
    return registry.snapshot()
  }
  it('rejects duplicate IDs before replacing any existing records', () => {
    const registry = new PluginRegistry()
    const original = valid()
    registry.restore(original)
    expect(() =>
      registry.restore({ ...original, records: [...original.records, ...original.records] }),
    ).toThrow(/duplicate/i)
    expect(registry.snapshot().records).toEqual(original.records)
  })
  it.each([
    (r: any) => ({ ...r, enabled: 'yes' }),
    (r: any) => ({ ...r, state: 'unknown' }),
    (r: any) => ({ ...r, approvals: { hosts: ['worker'], permissions: ['network:access'] } }),
    (r: any) => ({ ...r, approvals: { hosts: ['dom'], permissions: [] } }),
    (r: any) => ({ ...r, installedAt: NaN }),
  ])('rejects malformed or expanded approved scope', (change) => {
    const snapshot = valid()
    expect(() =>
      parsePluginRegistrySnapshot(
        JSON.stringify({ ...snapshot, records: snapshot.records.map(change) }),
      ),
    ).toThrow()
  })
})

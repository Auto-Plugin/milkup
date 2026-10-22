import { describe, expect, it } from 'vitest'
import type { PluginRegistryRecord } from '@milkup/plugin'
import {
  renderDesktopPluginManager,
  type DesktopPluginManagerState,
} from './desktop-plugin-manager'
import type { PluginCatalogEntry } from './plugin-catalog-contract'

const record: PluginRegistryRecord = {
  manifest: {
    id: 'test.cards',
    name: 'Card tools',
    version: '1.0.0',
    main: './plugin.js',
    permissions: ['network:access'],
    networkOrigins: ['https://example.test'],
    contributes: { commands: [{ id: 'cards.run', title: 'Run tool', action: 'cards.run' }] },
  },
  manifestPath: '/plugins/cards/plugin.json',
  rootPath: '/plugins/cards',
  sourcePath: '/cards.milkup-plugin',
  state: 'installed',
  enabled: false,
  installedAt: 1,
  updatedAt: 1,
  trust: 'development',
  dataRoot: '/data',
  storageRoot: '/storage',
  approvals: { hosts: [], permissions: [] },
  errors: [],
}
function state(enabled = false): DesktopPluginManagerState {
  return {
    records: [{ ...record, enabled }],
    contributions: {
      commands: [
        { id: 'cards.run', title: 'Run tool', category: 'plugin', run() {} },
        { id: 'other.run', title: 'Other tool', category: 'plugin', run() {} },
      ],
      ui: [
        { pluginId: 'test.cards', id: 'settings', title: 'Control panel', slot: 'modal' },
        { pluginId: 'other', id: 'settings', title: 'Other panel', slot: 'modal' },
      ],
      keymaps: [],
      renderers: [],
      markdownSyntax: [],
      importers: [],
      documentTypes: [],
    },
    auditCount: 0,
    auditRecords: [],
    installFailures: [],
  }
}
const toggle = (html: string) => html.match(/<button[^>]*role="switch"[^>]*>/)![0]
const forbidden =
  /data-plugin-action="(?:approve|reject-candidate|revoke-approval|enable|disable)"|待审批|已批准|批准能力|审批/
describe('plugin cards and information details', () => {
  it('allows a disabled unapproved plugin to use the only lifecycle switch', () => {
    const html = renderDesktopPluginManager(state())
    expect(toggle(html)).not.toMatch(/\sdisabled(?:\s|>)/)
    expect(html).not.toMatch(/审阅|批准|审批/)
  })
  it('blocks unavailable disabled plugins but lets an enabled plugin turn off', () => {
    expect(
      toggle(
        renderDesktopPluginManager({
          ...state(),
          executionUnavailableReasons: { 'test.cards': 'Unsupported host' },
        }),
      ),
    ).toMatch(/\sdisabled(?:\s|>)/)
    expect(
      toggle(
        renderDesktopPluginManager({
          ...state(true),
          executionUnavailableReasons: { 'test.cards': 'Unsupported host' },
        }),
      ),
    ).not.toMatch(/\sdisabled(?:\s|>)/)
  })
  it('puts only this plugin live control panels and commands on its card, once', () => {
    const enabled = state(true)
    const html = renderDesktopPluginManager({
      ...enabled,
      contributions: {
        ...enabled.contributions,
        ui: [...enabled.contributions.ui, enabled.contributions.ui[0]!],
      },
    })
    expect(html.match(/data-plugin-ui-id="settings"/g)).toHaveLength(1)
    expect(html).toContain('data-plugin-command="cards.run"')
    expect(html).not.toContain('Other panel')
    expect(html).not.toContain('other.run')
    expect(html).toContain('data-plugin-card-more="test.cards"')
    expect(html).toContain('<svg')
  })
  it('does not expose inactive contributions or reload on a disabled card', () => {
    const html = renderDesktopPluginManager(state())
    expect(html).not.toContain('data-plugin-action="open-ui"')
    expect(html).not.toContain('data-plugin-action="command"')
    expect(html).not.toContain('data-plugin-action="reload"')
    expect(renderDesktopPluginManager(state(true))).toContain('data-plugin-action="reload"')
  })
  it.each([false, true])(
    'keeps enabled=%s details free of lifecycle and approval UI',
    (enabled) => {
      const html = renderDesktopPluginManager(state(enabled), { selectedPluginId: 'test.cards' })
      expect(html).not.toMatch(forbidden)
      expect(html).toContain('network:access')
      expect(html).toContain('data-plugin-action="export"')
      expect(html.includes('data-plugin-action="reload"')).toBe(enabled)
    },
  )
  it('explains pending upgrades without a second approval or enable flow', () => {
    const s = state(true)
    const generation = {
      id: 'g2',
      manifest: { ...record.manifest, version: '2.0.0' },
      capabilityFingerprint: 'f2',
      approvedFingerprint: null,
      verified: false,
      sourcePath: '/v2',
      packageRoot: '/v2',
      manifestSha256: 'a',
      contentSha256: 'b',
    }
    const entry: PluginCatalogEntry = {
      id: record.manifest.id,
      revision: 2,
      active: { ...generation, id: 'g1', manifest: record.manifest, capabilityFingerprint: 'f1' },
      previous: null,
      pending: { transactionId: 't2', phase: 'prepared', restoreEnabled: true, generation },
      enabled: true,
      diagnostics: [],
      tombstone: false,
      startAttempt: null,
      dataRoot: '/data',
      storageRoot: '/storage',
    }
    const html = renderDesktopPluginManager(
      { ...s, catalogEntries: [entry] },
      { selectedPluginId: record.manifest.id },
    )
    expect(html).toContain('2.0.0')
    expect(html).toContain('下次开启')
    expect(html).not.toMatch(forbidden)
  })
})

it('shows a trusted bundled Worker upgrade without blocking on the installed DOM host', () => {
  const s = state()
  const installed = { ...record, manifest: { ...record.manifest, host: 'dom' as const } }
  const offer = {
    ...record.manifest,
    version: '2.0.0',
    host: 'worker' as const,
    description: '受限的静态文档呈现',
  }
  const upgradeState = { ...s, records: [installed], bundledUpgradeOffers: { 'test.cards': offer } }
  const card = renderDesktopPluginManager(upgradeState)
  expect(toggle(card)).not.toMatch(/\sdisabled(?:\s|>)/)
  expect(card).toContain('2.0.0')
  expect(card).toContain('Worker')
  expect(card).toContain('下次开启')
  expect(card).toContain('受限的静态文档呈现')
  const detail = renderDesktopPluginManager(upgradeState, { selectedPluginId: 'test.cards' })
  expect(detail).toContain('随应用提供的新版')
  expect(detail).not.toMatch(forbidden)
})

it.each([
  {
    name: 'a bundled upgrade superseding an older pending version',
    pending: true,
    bundled: true,
    label: '随应用新版 1.0.1 · Worker · 下次开启时应用',
  },
  {
    name: 'only a pending version',
    pending: true,
    bundled: false,
    label: '1.0.0 · 下次开启时应用',
  },
  {
    name: 'only a bundled upgrade',
    pending: false,
    bundled: true,
    label: '随应用新版 1.0.1 · Worker · 下次开启时应用',
  },
])('shows the next enabled version on the card with $name', ({ pending, bundled, label }) => {
  const generation = {
    id: 'g1',
    manifest: record.manifest,
    capabilityFingerprint: 'f1',
    approvedFingerprint: null,
    verified: false,
    sourcePath: '/bundled-1.0.0',
    packageRoot: '/g1',
    manifestSha256: 'a',
    contentSha256: 'b',
  }
  const entry: PluginCatalogEntry = {
    id: record.manifest.id,
    revision: 1,
    active: pending ? null : generation,
    previous: null,
    pending: pending
      ? { transactionId: 't1', phase: 'prepared', restoreEnabled: false, generation }
      : null,
    enabled: false,
    diagnostics: [],
    tombstone: false,
    startAttempt: null,
    dataRoot: '/data',
    storageRoot: '/storage',
  }
  const upgradeState: DesktopPluginManagerState = {
    ...state(),
    catalogEntries: [entry],
    bundledUpgradeOffers: bundled
      ? { [record.manifest.id]: { ...record.manifest, version: '1.0.1', host: 'worker' } }
      : {},
  }
  const card = renderDesktopPluginManager(upgradeState)
  expect(card.match(/<span class="plugin-card-update">([^<]+)<\/span>/)?.[1]).toBe(label)
  if (pending && bundled) {
    const details = renderDesktopPluginManager(upgradeState, {
      selectedPluginId: record.manifest.id,
    })
    expect(details).toContain('<h4>可用版本 1.0.0</h4>')
    expect(details).toContain('<h4>随应用提供的新版 1.0.1</h4>')
  }
})

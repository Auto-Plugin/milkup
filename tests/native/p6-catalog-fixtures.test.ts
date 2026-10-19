import { describe, expect, it } from 'vitest'
import { parsePluginPackageArchive } from '../../packages/plugin/src/package'
import { validateClosedWorkerBundle } from '../../apps/desktop/src/closed-worker-bundle'
import { catalogFixtureArchive } from '../helpers/p6-catalog-fixtures.mjs'
import { inspectLegacyPluginRegistry } from '../../apps/desktop/src/desktop-plugin-catalog'

describe('P6 native lifecycle fixture contracts', () => {
  it.each(['base', 'failure', 'hang', 'raw', 'dynamic'])(
    'packages %s using the public archive shape',
    (kind) => {
      const archive = parsePluginPackageArchive(catalogFixtureArchive(kind))
      expect(archive.manifest.id).toBe('example.catalog-lifecycle')
      expect(archive.manifest.host).toBe('worker')
      expect(archive.files).toHaveLength(1)
    },
  )
  it.each(['base', 'failure', 'hang', 'raw'])('admits %s as a closed Worker bundle', (kind) => {
    const source = catalogFixtureArchive(kind).files[0].content
    expect(validateClosedWorkerBundle(source)).toBe(source)
  })
  it('hang candidate has a real synchronous CPU loop and a version newer than the base', () => {
    const candidate = catalogFixtureArchive('hang')
    expect(candidate.manifest.version).toBe('1.0.2')
    expect(candidate.files[0].content).toBe('export default { activate() { for (;;) {} } }')
    expect(candidate.files[0].content).not.toMatch(/Promise|setTimeout/)
    expect(catalogFixtureArchive('base').files[0].content).toContain('P6_BASE_ALIVE:')
  })
  it('base declares the public UI view required for actual notify capabilities', () => {
    const base = parsePluginPackageArchive(catalogFixtureArchive('base'))
    expect(base.manifest.contributes?.ui).toEqual([
      { id: 'catalog-probe', slot: 'modal', title: 'P6 lifecycle probe', scope: 'app' },
    ])
    expect(base.files[0]!.content).toContain("'catalog-probe': () =>")
    expect(base.files[0]!.content).toContain('host.ui.notify')
  })
  it('delayed command acknowledges actual execution before waiting and stale publication', () => {
    const source = catalogFixtureArchive('base').files[0].content
    const started = source.indexOf(
      "await oldHost.ui.notify({ kind: 'info', message: 'P6_DELAYED_COMMAND_STARTED' })",
    )
    const wait = source.indexOf('await new Promise(resolve => setTimeout(resolve, 2000))')
    const stale = source.indexOf('P6_STALE_COMMAND_MUST_NOT_APPEAR')
    expect(started).toBeGreaterThan(0)
    expect(wait).toBeGreaterThan(started)
    expect(stale).toBeGreaterThan(wait)
  })
  it('legacy history shape retains exactly the valid package hint and quarantines both bad neighbors', () => {
    const records = [
      'example.catalog-lifecycle',
      'example.catalog-invalidmanifest',
      'example.catalog-invalidrecord',
    ].map((id, index) => {
      const manifest = catalogFixtureArchive('base', id).manifest
      if (index === 1) delete manifest.name
      const root = '/tmp/p6-fixture/' + id
      return {
        manifest,
        manifestPath: root + '/package/plugin.json',
        rootPath: root + '/package',
        sourcePath: '/tmp/fixture.milkup-plugin',
        dataRoot: root + '/data',
        storageRoot: root + '/storage',
        installedAt: 1700000000000,
        updatedAt: 1700000000001,
        trust: 'development',
        enabled: true,
        state: 'enabled',
        errors: [],
        approvals:
          index === 2
            ? { permissions: 'not-an-array', hosts: ['worker'] }
            : { permissions: [], hosts: ['worker'] },
      }
    })
    const raw =
      JSON.stringify(
        { version: 1, records, auditRecords: [], fixtureNote: '完整原文备份 中文 😀' },
        null,
        2,
      ) + '\n'
    const inspection = inspectLegacyPluginRegistry(raw)
    expect(inspection.raw).toBe(raw)
    expect(inspection.validatedRecords.map((record) => record.index)).toEqual([0])
    expect(inspection.records[0]?.enabled).toBe(false)
    expect(inspection.records[0]?.approvals.hosts).toEqual([])
    expect(inspection.diagnostics.join('\n')).toMatch(/Legacy record 1 quarantined/)
    expect(inspection.diagnostics.join('\n')).toMatch(/Legacy record 2 quarantined/)
  })
  it('rejects the deliberate dynamic import before Worker publication', () => {
    expect(() =>
      validateClosedWorkerBundle(catalogFixtureArchive('dynamic').files[0].content),
    ).toThrow(/single closed bundle/)
  })
  it('probes raw fetch with a successful local data URL, not a DNS failure mistaken for a guard', () => {
    const source = catalogFixtureArchive('raw').files[0].content
    expect(source).toContain("fetch('data:text/plain,P6-raw-fetch-must-be-blocked')")
    expect(source).toContain("'intrinsic Function CSP'")
    expect(source).toContain('P6_RAW_CAPABILITY_ESCAPED')
  })
})

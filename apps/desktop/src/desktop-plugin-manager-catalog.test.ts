import { describe, it, expect, vi } from 'vitest'
const fileWrites = vi.hoisted(() => vi.fn())
vi.mock('./plugin-file-broker', async () => {
  const { createPluginFileBroker } = await import('@milkup/plugin')
  return {
    createDesktopPluginFileBroker: (config: any) =>
      createPluginFileBroker({
        ...config,
        adapter: {
          resolvePath: (p: string) => p,
          readText: () => 'sealed',
          writeText: fileWrites,
          deleteFile: fileWrites,
        },
      }),
  }
})
import { ActionRegistry } from '@milkup/core'
import { copyPluginManagementSnapshot } from '@milkup/plugin'
import type { PluginManifest, PluginPackageArchive } from '@milkup/plugin'
import {
  DesktopPluginManager,
  createDesktopPluginActions,
  renderDesktopPluginManager,
} from './desktop-plugin-manager'
import { readFileSync } from 'node:fs'
import type {
  DesktopPluginCatalog,
  PluginCatalogSnapshot,
  PluginCatalogEntry,
  PluginCatalogAction,
} from './plugin-catalog-contract'

const manifest = (
  version = '1.0.0',
  permissions: PluginManifest['permissions'] = [],
): PluginManifest => ({
  id: 'test.lifecycle',
  name: 'Lifecycle',
  version,
  host: 'worker',
  main: './dist/plugin.js',
  permissions,
})
const archive = (
  version = '1.0.0',
  permissions: PluginManifest['permissions'] = [],
): PluginPackageArchive => ({
  format: 'milkup-plugin',
  version: 1,
  manifest: manifest(version, permissions),
  files: [{ path: 'dist/plugin.js', encoding: 'utf8', content: 'export default {}' }],
})
class Catalog implements DesktopPluginCatalog {
  snapshot: PluginCatalogSnapshot = {
    version: 1,
    revision: 0,
    entries: [],
    diagnostics: [],
    migrationReceipt: 'fresh',
  }
  events: string[] = []
  sequence = 0
  failCommit = false
  async read() {
    return structuredClone(this.snapshot)
  }
  async migrateLegacy(): Promise<PluginCatalogSnapshot> {
    throw Error('unexpected legacy migration')
  }
  async prepare({
    archive: pkg,
    sourcePath,
    expectedRevision,
  }: Parameters<DesktopPluginCatalog['prepare']>[0]) {
    const before = this.snapshot.entries.find((x) => x.id === pkg.manifest.id)
    expect(expectedRevision).toBe(before?.revision ?? null)
    const n = ++this.sequence
    const entry: PluginCatalogEntry = {
      id: pkg.manifest.id,
      revision: (before?.revision ?? 0) + 1,
      active: before?.active ?? null,
      previous: before?.previous ?? null,
      pending: {
        transactionId: 't' + n,
        phase: 'prepared',
        restoreEnabled: before?.enabled ?? false,
        generation: {
          id: 'g' + n,
          manifest: pkg.manifest,
          manifestSha256: 'a'.repeat(64),
          contentSha256: String(n).repeat(64),
          capabilityFingerprint: 'b'.repeat(64),
          approvedFingerprint: null,
          verified: false,
          sourcePath,
          packageRoot: '/plugins/test.lifecycle/generations/g' + n,
        },
      },
      enabled: before?.enabled ?? false,
      tombstone: false,
      startAttempt: null,
      diagnostics: [],
      dataRoot: '/data/test.lifecycle',
      storageRoot: '/storage/test.lifecycle',
    }
    this.events.push('prepare:' + n)
    this.set(entry)
    return this.read()
  }
  private set(entry: PluginCatalogEntry) {
    this.snapshot = {
      ...this.snapshot,
      revision: this.snapshot.revision + 1,
      entries: [...this.snapshot.entries.filter((x) => x.id !== entry.id), entry],
    }
  }
  async transition(id: string, revision: number, action: PluginCatalogAction) {
    let e = structuredClone(this.snapshot.entries.find((x) => x.id === id)!) as any
    expect(e.revision).toBe(revision)
    this.events.push(action.type)
    if ('transactionId' in action) {
      expect(e.pending.transactionId).toBe(action.transactionId)
      expect(e.pending.generation.capabilityFingerprint).toBe(action.fingerprint)
    }
    if (action.type === 'approve') e.pending.generation.approvedFingerprint = action.fingerprint
    if (action.type === 'beginTrial') e.pending.phase = 'trial'
    if (action.type === 'commit') {
      if (this.failCommit) throw Error('commit disk failure')
      e.previous = e.active
      e.active = { ...e.pending.generation, verified: true }
      e.pending = null
      e.enabled = action.enabled
    }
    if (action.type === 'abort') {
      e.enabled = e.pending.restoreEnabled
      e.pending = null
    }
    if (action.type === 'startupBegin') {
      e.startAttempt = 'attempt' + ++this.sequence
      e.enabled = true
    }
    if (action.type === 'startupComplete') {
      expect(e.startAttempt).toBe(action.attemptId)
      e.startAttempt = null
    }
    if (action.type === 'disable') {
      e.enabled = false
      e.startAttempt = null
    }
    if (action.type === 'markFailed') {
      e.enabled = false
      e.startAttempt = null
      e.diagnostics.push(action.message)
    }
    if (action.type === 'remove') {
      e.tombstone = true
      e.enabled = false
      e.pending = null
      e.startAttempt = null
      if (e.active) e.active.approvedFingerprint = null
    }
    if (action.type === 'revokeApproval') {
      e.enabled = false
      e.pending = null
      e.startAttempt = null
      e.active.approvedFingerprint = null
    }
    if (action.type === 'approveActive') e.active.approvedFingerprint = action.fingerprint
    if (action.type === 'rollback') {
      e.active = e.previous
      e.previous = null
      e.enabled = false
      e.pending = null
    }
    e.revision++
    this.set(e)
    return this.read()
  }
}
function setup(
  options: { activate?: (version: string, context: any) => unknown; storage?: Storage } = {},
) {
  const catalog = new Catalog(),
    events: string[] = [],
    actions = new ActionRegistry()
  let pkg = archive()
  const manager = new DesktopPluginManager({
    catalog,
    actionRegistry: actions,
    permissions: ['document:read', 'document:write', 'file:read', 'file:write', 'file:delete'],
    milkupVersion: '2.0.0',
    pluginSdkVersion: '0.3.7',
    ...(options.storage ? { storage: options.storage } : {}),
    manifestHost: {
      selectManifestPath: async () => undefined,
      readManifestText: async () => JSON.stringify(pkg),
    },
    loadModule: async (manifest) => ({
      module: {
        runtimeHost: 'isolated',
        activate: async (context) => {
          events.push('activate:' + manifest.version)
          await options.activate?.(manifest.version, context)
          return {}
        },
      },
      dispose: () => {
        events.push('dispose:' + manifest.version)
      },
    }),
  })
  const approve = async () => {
    const e = catalog.snapshot.entries[0]!
    return manager.approve(
      e.id,
      e.pending?.generation.capabilityFingerprint ?? e.active!.capabilityFingerprint,
      e.revision,
    )
  }
  const install = async (version = '1.0.0', permissions: PluginManifest['permissions'] = []) => {
    pkg = archive(version, permissions)
    return manager.installManifestPath('/candidate.milkup-plugin')
  }
  return { catalog, manager, events, actions, approve, install }
}
describe('P6 authoritative catalog transactions', () => {
  it('stages without running or replacing old active approval; exact review is required', async () => {
    const s = setup()
    await s.manager.ready
    await s.install()
    expect(s.events).toEqual([])
    expect(s.manager.state().records[0]?.enabled).toBe(false)
    const stale = s.catalog.snapshot.entries[0]!.revision
    await s.install('2.0.0')
    await expect(s.manager.approve('test.lifecycle', 'b'.repeat(64), stale)).rejects.toThrow(
      'stale',
    )
    expect(s.catalog.snapshot.entries[0]!.pending!.generation.approvedFingerprint).toBeNull()
    await s.approve()
    await s.manager.enable('test.lifecycle')
    expect(s.manager.state().records[0]?.manifest.version).toBe('2.0.0')
    await s.install('3.0.0', ['document:write'])
    expect(s.manager.state().records[0]?.manifest.version).toBe('2.0.0')
    expect(s.manager.state().records[0]?.enabled).toBe(true)
    expect(s.manager.state().records[0]?.approvals.permissions).toEqual([])
  })
  it('tears old epoch down before trial, commits before publish, and recovers old version with new epoch on failure', async () => {
    const s = setup({
      activate: (version) => {
        if (version === '2.0.0') throw Error('bad activation')
      },
    })
    await s.manager.ready
    await s.install()
    await s.approve()
    await s.manager.enable('test.lifecycle')
    const epoch = s.manager.documentRendererGeneration('test.lifecycle')
    await s.install('2.0.0')
    await s.approve()
    await expect(s.manager.enable('test.lifecycle')).rejects.toThrow('bad activation')
    expect(s.events.indexOf('dispose:1.0.0')).toBeLessThan(s.events.indexOf('activate:2.0.0'))
    expect(s.events.filter((x) => x === 'activate:1.0.0')).toHaveLength(2)
    expect(s.manager.documentRendererGeneration('test.lifecycle')).toBeGreaterThan(epoch)
    expect(s.manager.state().records[0]).toMatchObject({
      enabled: true,
      manifest: { version: '1.0.0' },
    })
  })
  it('cannot grant candidate capabilities via pending approval or side effects during activate', async () => {
    const s = setup({
      activate: (_version, context) => {
        context.host.ui?.update('not-a-view')
      },
    })
    await s.manager.ready
    await s.install()
    await s.approve()
    await s.manager.enable('test.lifecycle')
    // Sidecar and DOM cannot silently bypass a restricted activation unsupported by the host.
    const entry = s.catalog.snapshot.entries[0]!
    s.catalog.snapshot = {
      ...s.catalog.snapshot,
      entries: [
        {
          ...entry,
          active: { ...entry.active!, manifest: { ...entry.active!.manifest, host: 'sidecar' } },
        },
      ],
    }
    const restarted = new DesktopPluginManager({
      catalog: s.catalog,
      actionRegistry: new ActionRegistry(),
      permissions: [],
      milkupVersion: '2.0.0',
      pluginSdkVersion: '0.3.7',
      manifestHost: { selectManifestPath: async () => undefined, readManifestText: async () => '' },
    })
    await restarted.ready
    expect(restarted.state().records[0]?.enabled).toBe(false)
  })
  it('serializes queued approval and remove; tombstone keeps data/settings and never revives from mirror', async () => {
    const values = new Map<string, string>([['milkup.plugin.storage.test.lifecycle.keep', 'KEEP']])
    const storage = {
      getItem: (k: string) => values.get(k) ?? null,
      setItem: (k: string, v: string) => {
        values.set(k, v)
      },
      removeItem: (k: string) => {
        values.delete(k)
      },
      clear: () => {},
      key: () => null,
      length: 1,
    } as Storage
    const s = setup({ storage })
    await s.manager.ready
    await s.install()
    const approval = s.approve()
    const removal = s.manager.remove('test.lifecycle')
    await Promise.all([approval, removal])
    expect(s.catalog.events.slice(-2)).toEqual(['approve', 'remove'])
    expect(s.catalog.snapshot.entries[0]!.tombstone).toBe(true)
    expect(values.get('milkup.plugin.storage.test.lifecycle.keep')).toBe('KEEP')
    expect(s.manager.state().records).toEqual([])
  })
  it('recovers a committed generation when contribution publication fails', async () => {
    const s = setup()
    await s.manager.ready
    await s.install()
    await s.approve()
    await s.manager.enable('test.lifecycle')
    await s.install('2.0.0')
    await s.approve()
    const runtime = (s.manager as any).runtime
    vi.spyOn(runtime, 'publishPlugin').mockImplementationOnce(() => {
      throw Error('publish failed')
    })
    await expect(s.manager.enable('test.lifecycle')).rejects.toThrow('publish failed')
    expect(s.catalog.events).toContain('rollback')
    expect(s.manager.state().records[0]).toMatchObject({
      enabled: true,
      manifest: { version: '1.0.0' },
    })
  })
})

describe('P6 candidate failure injection', () => {
  it('denies a swallowed initialization write and restores unchanged data', async () => {
    const values = new Map<string, string>([
      ['milkup.plugin.storage.test.lifecycle.existing', 'OLD'],
    ])
    const storage = {
      getItem: (k: string) => values.get(k) ?? null,
      setItem: (k: string, v: string) => {
        values.set(k, v)
      },
      removeItem: (k: string) => {
        values.delete(k)
      },
      clear: () => {},
      key: () => null,
      length: 1,
    } as Storage
    const s = setup({
      storage,
      activate: async (version, context) => {
        if (version === '2.0.0')
          try {
            await context.host.storage.setItem('existing', 'BAD')
          } catch {
            /* malicious swallow */
          }
      },
    })
    await s.manager.ready
    await s.install()
    await s.approve()
    await s.manager.enable('test.lifecycle')
    await s.install('2.0.0')
    await s.approve()
    await expect(s.manager.enable('test.lifecycle')).rejects.toThrow()
    expect(values.get('milkup.plugin.storage.test.lifecycle.existing')).toBe('OLD')
    expect(s.manager.state().records[0]).toMatchObject({
      enabled: true,
      manifest: { version: '1.0.0' },
    })
  })
  it('recovers old active after native commit rejects without publishing the candidate', async () => {
    const s = setup()
    await s.manager.ready
    await s.install()
    await s.approve()
    await s.manager.enable('test.lifecycle')
    await s.install('2.0.0')
    await s.approve()
    s.catalog.failCommit = true
    await expect(s.manager.enable('test.lifecycle')).rejects.toThrow('commit disk failure')
    expect(s.catalog.snapshot.entries[0]!.pending).toBeNull()
    expect(s.manager.state().records[0]).toMatchObject({
      enabled: true,
      manifest: { version: '1.0.0' },
    })
  })
  it('caps hanging candidate activation and attempts new-epoch recovery', async () => {
    vi.useFakeTimers()
    try {
      const s = setup()
      await s.manager.ready
      await s.install()
      await s.approve()
      await s.manager.enable('test.lifecycle')
      await s.install('2.0.0')
      await s.approve()
      const original = (s.manager as any).loadModule
      const loader = vi
        .spyOn(s.manager as any, 'loadModule')
        .mockImplementation(async (m: any, ...args: any[]) =>
          m.version === '2.0.0'
            ? {
                module: { runtimeHost: 'isolated', activate: () => new Promise(() => {}) },
                dispose: () => {},
              }
            : original(m, ...args),
        )
      const pending = s.manager.enable('test.lifecycle')
      const assertion = expect(pending).rejects.toThrow('timed out')
      await vi.advanceTimersByTimeAsync(10001)
      loader.mockRestore()
      await assertion
      expect(s.catalog.snapshot.entries[0]!.pending).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })
  it('does not trust a poisoned mirror and quarantines an interrupted startup instead of retrying forever', async () => {
    const s = setup()
    await s.manager.ready
    await s.install()
    await s.approve()
    await s.manager.enable('test.lifecycle')
    const e = s.catalog.snapshot.entries[0]!
    s.catalog.snapshot = {
      ...s.catalog.snapshot,
      entries: [{ ...e, startAttempt: 'interrupted', enabled: true }],
    }
    const load = vi.fn()
    const storage = {
      getItem: () => {
        throw Error('blocked storage')
      },
      setItem: () => {
        throw Error('quota')
      },
      removeItem: vi.fn(),
      length: 0,
      key: () => null,
      clear: () => {},
    } as Storage
    const next = new DesktopPluginManager({
      catalog: s.catalog,
      storage,
      actionRegistry: new ActionRegistry(),
      permissions: [],
      milkupVersion: '2.0.0',
      pluginSdkVersion: '0.3.7',
      manifestHost: { selectManifestPath: async () => undefined, readManifestText: async () => '' },
      loadModule: load,
    })
    await next.ready
    expect(load).not.toHaveBeenCalled()
    expect(next.state().records[0]).toMatchObject({ enabled: false, state: 'failed' })
    expect(s.catalog.events).toContain('markFailed')
  })
})

describe('P6 retirement and public diagnostic boundaries', () => {
  it('retains a rejected isolation owner and retries before any new activation', async () => {
    const s = setup()
    await s.manager.ready
    await s.install()
    await s.approve()
    await s.manager.enable('test.lifecycle')
    const owner = (s.manager as any).loadedModules.get('test.lifecycle')
    let confirmed = false
    const stop = vi.fn(async () => {
      if (!confirmed) throw Error('stop not confirmed')
    })
    owner.dispose = vi.fn(async () => {
      throw Error('initial stop not confirmed')
    })
    owner.retryDispose = stop
    await expect(s.manager.disable('test.lifecycle')).rejects.toThrow('cleanup')
    await expect(s.manager.enable('test.lifecycle')).rejects.toThrow('cleanup')
    expect(s.events.filter((x) => x === 'activate:1.0.0')).toHaveLength(1)
    confirmed = true
    await s.manager.enable('test.lifecycle')
    expect(owner.dispose).toHaveBeenCalledTimes(1)
    expect(stop.mock.calls.length).toBeGreaterThanOrEqual(2)
    expect(s.events.filter((x) => x === 'activate:1.0.0')).toHaveLength(2)
  })
  it('keeps callback errors diagnostic when the trusted owner confirms termination', async () => {
    const s = setup()
    await s.manager.ready
    await s.install()
    await s.approve()
    await s.manager.enable('test.lifecycle')
    const runtime = (s.manager as any).runtime
    const original = runtime.disablePlugin.bind(runtime)
    vi.spyOn(runtime, 'disablePlugin').mockImplementation(async (id: any) => {
      const result = await original(id)
      return {
        ...result,
        errors: [...result.errors, { phase: 'disable', message: 'plugin callback rejected' }],
      }
    })
    await s.manager.disable('test.lifecycle')
    expect(s.manager.state().diagnostics?.join(' ')).toContain('plugin callback rejected')
    await s.manager.enable('test.lifecycle')
    expect(s.manager.state().records[0]?.enabled).toBe(true)
  })
  it('never exposes native or activation paths through the public management adapter', async () => {
    const s = setup()
    await s.manager.ready
    await s.install()
    await s.approve()
    await s.manager.enable('test.lifecycle')
    const entry = s.catalog.snapshot.entries[0]!
    s.catalog.snapshot = {
      ...s.catalog.snapshot,
      entries: [
        {
          ...entry,
          diagnostics: [
            'Activation failed: /private/home/secret/plugin.js:1',
            'Native cleanup failed at C:\\Users\\private\\plugin',
          ],
        },
      ],
    }
    ;(s.manager as any).applyCatalog(await s.catalog.read())
    const detail = s.manager.managementDescribe({
      pluginId: entry.id,
      revision: s.catalog.snapshot.revision,
    })
    expect(detail.diagnostics).toHaveLength(2)
    expect(JSON.stringify(detail.diagnostics)).not.toMatch(/private|secret|Users|plugin\.js/)
    expect(detail.diagnostics[0]?.message).toContain('host details')
  })
})

describe('P6 sealed generations', () => {
  it('permits package reads, refuses package writes/deletes, and gives data a distinct writable scope', async () => {
    const s = setup()
    await s.manager.ready
    await s.install('1.0.0', ['file:read', 'file:write', 'file:delete'])
    await s.approve()
    await s.manager.enable('test.lifecycle')
    const record = s.manager.state().records[0]!,
      broker = (s.manager as any).createFileBroker(record.manifest)
    fileWrites.mockClear()
    expect(await broker.readText({ path: record.rootPath + '/dist/plugin.js' })).toBe('sealed')
    await expect(
      broker.writeText({ path: record.rootPath + '/dist/plugin.js', text: 'BAD' }),
    ).rejects.toThrow('outside allowed roots')
    await expect(broker.deleteFile({ path: record.rootPath + '/plugin.json' })).rejects.toThrow(
      'outside allowed roots',
    )
    expect(fileWrites).not.toHaveBeenCalled()
    expect(
      await broker.writeText({ path: record.dataRoot + '/result.txt', text: 'OK' }),
    ).toMatchObject({ rootId: 'plugin-data' })
  })
  it('disables a newly committed first installation if publication fails with no previous generation', async () => {
    const s = setup()
    await s.manager.ready
    await s.install()
    await s.approve()
    vi.spyOn((s.manager as any).runtime, 'publishPlugin').mockImplementationOnce(() => {
      throw Error('publication failed')
    })
    await expect(s.manager.enable('test.lifecycle')).rejects.toThrow('publication failed')
    expect(s.catalog.snapshot.entries[0]).toMatchObject({
      enabled: false,
      startAttempt: null,
      pending: null,
    })
    expect(s.catalog.events).toContain('markFailed')
  })
})

describe('P6 compatibility at execution boundary', () => {
  it('quarantines incompatible native active intent after a host/SDK change without loading code', async () => {
    const s = setup()
    await s.manager.ready
    await s.install()
    await s.approve()
    await s.manager.enable('test.lifecycle')
    const e = s.catalog.snapshot.entries[0]!
    s.catalog.snapshot = {
      ...s.catalog.snapshot,
      entries: [
        {
          ...e,
          active: {
            ...e.active!,
            manifest: { ...e.active!.manifest, engines: { pluginSdk: '^9.0.0' } },
          },
        },
      ],
    }
    const load = vi.fn()
    const next = new DesktopPluginManager({
      catalog: s.catalog,
      actionRegistry: new ActionRegistry(),
      permissions: [],
      milkupVersion: '2.0.0',
      pluginSdkVersion: '0.3.7',
      manifestHost: { selectManifestPath: async () => undefined, readManifestText: async () => '' },
      loadModule: load,
    })
    await next.ready
    expect(load).not.toHaveBeenCalled()
    expect(s.catalog.snapshot.entries[0]?.enabled).toBe(false)
    expect(next.state().diagnostics?.join(' ')).toContain('9.0.0')
  })
  it('does not run an incompatible native pending candidate or retire the old active instance', async () => {
    const s = setup()
    await s.manager.ready
    await s.install()
    await s.approve()
    await s.manager.enable('test.lifecycle')
    await s.install('2.0.0')
    await s.approve()
    const e = s.catalog.snapshot.entries[0]!
    s.catalog.snapshot = {
      ...s.catalog.snapshot,
      entries: [
        {
          ...e,
          pending: {
            ...e.pending!,
            generation: {
              ...e.pending!.generation,
              manifest: { ...e.pending!.generation.manifest, engines: { milkup: '^9.0.0' } },
            },
          },
        },
      ],
    }
    ;(s.manager as any).applyCatalog(await s.catalog.read())
    await expect(s.manager.enable('test.lifecycle')).rejects.toThrow('9.0.0')
    expect(s.events).not.toContain('activate:2.0.0')
    expect(s.events).not.toContain('dispose:1.0.0')
    expect(s.manager.state().records[0]?.enabled).toBe(true)
  })
  it('blocks candidate data writes before publication even when approval includes file write', async () => {
    const s = setup({
      activate: async (version, context) => {
        if (version === '2.0.0')
          try {
            await context.host.writeText('/data/test.lifecycle/result.txt', 'BAD')
          } catch {}
      },
    })
    await s.manager.ready
    await s.install()
    await s.approve()
    await s.manager.enable('test.lifecycle')
    await s.install('2.0.0', ['file:write'])
    await s.approve()
    fileWrites.mockClear()
    await expect(s.manager.enable('test.lifecycle')).rejects.toThrow()
    expect(fileWrites).not.toHaveBeenCalled()
    expect(s.manager.state().records[0]?.enabled).toBe(true)
  })
})

describe('P6 native read-only renderer profile', () => {
  it('permits only the sealed read-only DOM renderer and awaits its retirement before replacement', async () => {
    const s = setup()
    await s.manager.ready
    await s.install()
    await s.approve()
    await s.manager.enable('test.lifecycle')
    await s.install('2.0.0')
    await s.approve()
    const e = s.catalog.snapshot.entries[0]!,
      dom = {
        ...e.pending!.generation.manifest,
        host: 'dom' as const,
        permissions: ['document:read'] as const,
        contributes: {
          documentRenderers: [
            { id: 'diagram', contexts: ['fence'] as const, fenceLanguages: ['mermaid'] },
          ],
        },
      }
    s.catalog.snapshot = {
      ...s.catalog.snapshot,
      entries: [
        {
          ...e,
          pending: { ...e.pending!, generation: { ...e.pending!.generation, manifest: dom } },
        },
      ],
    }
    ;(s.manager as any).applyCatalog(await s.catalog.read())
    ;(s.manager as any).manifestHost.prepareModule = async () => ({
      kind: 'dom',
      leaseId: 'opaque-test-lease',
    })
    const stop = vi.fn(async () => {})
    ;(s.manager as any).loadDomModule = vi.fn(async () => ({
      module: { runtimeHost: 'isolated', activate: () => ({}) },
      dispose: stop,
    }))
    await s.manager.enable('test.lifecycle')
    expect(s.manager.state().records[0]).toMatchObject({ enabled: true, manifest: { host: 'dom' } })
    await s.manager.disable('test.lifecycle')
    expect(stop).toHaveBeenCalledOnce()
  })
})

describe('P6 bounded management metadata', () => {
  it('lists all 512 valid native entries with long Unicode metadata and keeps differences exact', async () => {
    const s = setup()
    await s.manager.ready
    await s.install()
    await s.approve()
    await s.manager.enable('test.lifecycle')
    const original = s.catalog.snapshot.entries[0]!
    const entries = Array.from({ length: 512 }, (_, i) => {
      const id = 'test.plugin' + i
      const m = {
        ...original.active!.manifest,
        id,
        name: '图表👩🏽‍💻'.repeat(200),
        description: '描述👩🏽‍💻'.repeat(1000),
      }
      return { ...original, id, active: { ...original.active!, manifest: m }, enabled: false }
    })
    s.catalog.snapshot = { ...s.catalog.snapshot, entries }
    ;(s.manager as any).applyCatalog(await s.catalog.read())
    const snapshot = s.manager.managementSnapshot()
    expect(copyPluginManagementSnapshot(snapshot).items).toHaveLength(512)
    expect(new TextEncoder().encode(JSON.stringify(snapshot)).length).toBeLessThan(512 * 1024)
    const details = s.manager.managementDescribe({
      pluginId: entries[0]!.id,
      revision: snapshot.revision,
    })
    expect(details.title).toBe(snapshot.items[0]!.title)
    expect(details.permissions).toEqual({ declared: [], approved: [], added: [], removed: [] })
    expect(details.title.endsWith('…')).toBe(true)
  })
})

describe('P6 mounted UI retirement', () => {
  async function mountedUi(stopFailure = false) {
    const catalog = new Catalog(),
      render = vi.fn(() => ({ type: 'text', text: 'outline' })),
      activationDispose = vi.fn(),
      ownerDispose = vi.fn(async () => {
        if (stopFailure) throw Error('owner stop not confirmed')
      })
    const pkg = {
      ...archive(),
      manifest: {
        ...manifest(),
        permissions: ['document:read'],
        contributes: {
          ui: [{ id: 'outline-panel', slot: 'sidebar-panel', title: 'Outline', scope: 'document' }],
        },
      },
    }
    const manager = new DesktopPluginManager({
      catalog,
      actionRegistry: new ActionRegistry(),
      permissions: ['document:read'],
      milkupVersion: '2.0.0',
      pluginSdkVersion: '0.3.7',
      manifestHost: {
        selectManifestPath: async () => undefined,
        readManifestText: async () => JSON.stringify(pkg),
      },
      loadModule: async () => ({
        module: {
          runtimeHost: 'isolated',
          activate: () => ({ dispose: activationDispose }),
          renderers: { 'outline-panel': render },
        },
        dispose: ownerDispose,
      }),
    })
    await manager.ready
    await manager.installManifestPath('/outline.milkup-plugin')
    const entry = catalog.snapshot.entries[0]!
    await manager.approve(entry.id, entry.pending!.generation.capabilityFingerprint, entry.revision)
    await manager.enable(entry.id)
    await manager.renderUi(entry.id, 'outline-panel', 'mount')
    return { manager, catalog, render, activationDispose, ownerDispose, id: entry.id }
  }
  it('retires mounted UI without dispatching renderer RPC after epoch revocation', async () => {
    const s = await mountedUi()
    await s.manager.renderUi(s.id, 'outline-panel', 'dispose')
    await s.manager.renderUi(s.id, 'outline-panel', 'mount')
    const renderCount = s.render.mock.calls.length
    await expect(s.manager.disable(s.id)).resolves.toBeDefined()
    await expect(s.manager.renderUi(s.id, 'outline-panel', 'dispose')).resolves.toBeUndefined()
    expect(s.render).toHaveBeenCalledTimes(renderCount)
    expect(s.activationDispose).toHaveBeenCalledOnce()
    expect(s.ownerDispose).toHaveBeenCalledOnce()
    expect(s.manager.state().records[0]).toMatchObject({ enabled: false, state: 'disabled' })
    expect(s.manager.state().diagnostics?.join(' ')).not.toContain('Renderer is not available')
  })
  it('still rejects real owner stop failure when a UI was mounted', async () => {
    const s = await mountedUi(true)
    await expect(s.manager.disable(s.id)).rejects.toThrow('Plugin cleanup did not fully complete')
    expect(s.ownerDispose).toHaveBeenCalledOnce()
    expect(s.activationDispose).toHaveBeenCalledOnce()
    expect(s.manager.state().diagnostics?.join(' ')).toContain('owner stop not confirmed')
  })
})

describe('P6 trusted manager action wiring', () => {
  it('rejects a candidate through ActionRegistry without changing old active approval or execution', async () => {
    const s = setup()
    await s.manager.ready
    await s.install()
    await s.approve()
    await s.manager.enable('test.lifecycle')
    const old = structuredClone(s.catalog.snapshot.entries[0]!.active),
      epoch = s.manager.documentRendererGeneration('test.lifecycle')
    await s.install('2.0.0', ['document:write'])
    const entry = s.catalog.snapshot.entries[0]!
    for (const action of createDesktopPluginActions(s.manager)) s.actions.register(action)
    await s.actions.run(
      'plugin.rejectCandidate',
      { permissions: ['app:control'] },
      {
        pluginId: entry.id,
        fingerprint: entry.pending!.generation.capabilityFingerprint,
        reviewedRevision: entry.revision,
      },
    )
    expect(s.catalog.snapshot.entries[0]!.pending).toBeNull()
    expect(s.catalog.snapshot.entries[0]!.active).toEqual(old)
    expect(s.catalog.snapshot.entries[0]!.enabled).toBe(true)
    expect(s.manager.state().records[0]).toMatchObject({
      enabled: true,
      manifest: { version: '1.0.0' },
    })
    expect(s.manager.documentRendererGeneration(entry.id)).toBe(epoch)
    expect(s.events).not.toContain('dispose:1.0.0')
  })
  it('requires control permission and exact well-formed reviewed identity before rejection', async () => {
    const s = setup()
    await s.manager.ready
    await s.install()
    for (const action of createDesktopPluginActions(s.manager)) s.actions.register(action)
    const entry = s.catalog.snapshot.entries[0]!,
      input = {
        pluginId: entry.id,
        fingerprint: entry.pending!.generation.capabilityFingerprint,
        reviewedRevision: entry.revision,
      }
    const definition = s.actions.get('plugin.rejectCandidate')
    expect(definition).toMatchObject({
      permissions: ['app:control'],
      risk: 'write',
      inputSchema: {
        properties: { fingerprint: { required: true }, reviewedRevision: { required: true } },
      },
    })
    await expect(
      s.actions.run('plugin.rejectCandidate', { permissions: [] }, input),
    ).rejects.toThrow('not allowed')
    for (const bad of [
      { pluginId: entry.id },
      { ...input, fingerprint: '' },
      { ...input, fingerprint: 'x'.repeat(129) },
      { ...input, reviewedRevision: NaN },
      { ...input, reviewedRevision: 1.5 },
      { ...input, reviewedRevision: entry.revision - 1 },
    ])
      await expect(
        s.actions.run('plugin.rejectCandidate', { permissions: ['app:control'] }, bad),
      ).rejects.toThrow()
    expect(s.catalog.snapshot.entries[0]!.pending).not.toBeNull()
  })
  it('registers every fixed plugin action dispatched by the shipped manager click handler', async () => {
    const s = setup()
    await s.manager.ready
    for (const action of createDesktopPluginActions(s.manager)) s.actions.register(action)
    const source = readFileSync(new URL('./main.ts', import.meta.url), 'utf8'),
      handler = source.slice(
        source.indexOf(
          "appRoot.querySelector<HTMLElement>('[data-plugin-manager]')?.addEventListener",
        ),
        source.indexOf('function cancelDocumentTransition'),
      )
    const dispatched = [...handler.matchAll(/runDesktopAction\('(plugin\.[^']+)'/g)].map(
      (match) => match[1]!,
    )
    expect(dispatched.length).toBeGreaterThanOrEqual(9)
    for (const id of dispatched) expect(s.actions.get(id), id + ' must be registered').toBeDefined()
  })
})

describe('P6 catalog activation error presentation', () => {
  it('surfaces a readable Error through the real action while retaining the typed runtime cause and restored old instance', async () => {
    const s = setup({
      activate: (version) => {
        if (version === '2.0.0') throw Error('P6_MANAGEMENT_EXPECTED_FAILURE')
      },
    })
    await s.manager.ready
    await s.install()
    await s.approve()
    await s.manager.enable('test.lifecycle')
    await s.install('2.0.0')
    await s.approve()
    for (const action of createDesktopPluginActions(s.manager)) s.actions.register(action)
    const failure = await s.actions
      .run('plugin.enable', { permissions: ['app:control'] }, { pluginId: 'test.lifecycle' })
      .catch((error) => error)
    expect(failure).toBeInstanceOf(Error)
    if (!(failure instanceof Error)) throw new Error('Expected an activation Error')
    expect(failure.message).toContain('P6_MANAGEMENT_EXPECTED_FAILURE')
    expect(failure.cause).toMatchObject({
      pluginId: 'test.lifecycle',
      phase: 'enable',
      message: 'P6_MANAGEMENT_EXPECTED_FAILURE',
    })
    expect(s.manager.state().records[0]).toMatchObject({
      enabled: true,
      manifest: { version: '1.0.0' },
    })
    expect(s.catalog.snapshot.entries[0]!.pending).toBeNull()
    expect(s.manager.state().diagnostics?.join(' ')).not.toContain('[object Object]')
  })
})

describe('P6 activation error identity boundary', () => {
  it('preserves existing Error and unknown values without reading diagnostic accessors', async () => {
    const messageGetter = vi.fn(() => {
      throw Error('must not read arbitrary message getter')
    })
    const accessor = Object.defineProperty(
      { pluginId: 'test.lifecycle', phase: 'enable' },
      'message',
      { get: messageGetter },
    )
    for (const original of [
      new Error('ordinary loader failure'),
      { pluginId: 'another.plugin', phase: 'enable', message: 'wrong owner' },
      { pluginId: 'test.lifecycle', phase: 'renderer', message: 'wrong phase' },
      accessor,
    ]) {
      const s = setup()
      await s.manager.ready
      await s.install()
      await s.approve()
      vi.spyOn(s.manager as any, 'loadModule').mockRejectedValueOnce(original)
      for (const action of createDesktopPluginActions(s.manager)) s.actions.register(action)
      const failure = await s.actions
        .run('plugin.enable', { permissions: ['app:control'] }, { pluginId: 'test.lifecycle' })
        .catch((error) => error)
      expect(failure).toBe(original)
    }
    expect(messageGetter).not.toHaveBeenCalled()
  })
})

describe('P6 trusted host complete catalog diagnostics', () => {
  it('shows repeated native diagnostics after old-version recovery without leaking them into the public projection or list', async () => {
    const s = setup()
    await s.manager.ready
    await s.install()
    await s.approve()
    await s.manager.enable('test.lifecycle')
    const e = s.catalog.snapshot.entries[0]!,
      message =
        'Candidate aborted; old installation retained: /private/plugin <script>unsafe</script>'
    s.catalog.snapshot = {
      ...s.catalog.snapshot,
      entries: [{ ...e, diagnostics: [message, message] }],
    }
    ;(s.manager as any).applyCatalog(await s.catalog.read())
    const before = structuredClone(s.catalog.snapshot),
      state = s.manager.state()
    expect(state.records[0]!.errors).toEqual([])
    expect(state.records[0]!.enabled).toBe(true)
    const html = renderDesktopPluginManager(state, { selectedPluginId: e.id }),
      escaped =
        'Candidate aborted; old installation retained: /private/plugin &lt;script&gt;unsafe&lt;/script&gt;'
    expect(html.split(escaped).length - 1).toBe(2)
    expect(html).not.toContain('<script>unsafe</script>')
    expect(html).toContain('class="plugin-errors"')
    expect(renderDesktopPluginManager(state)).not.toContain(escaped)
    const publicDetail = s.manager.managementDescribe({ pluginId: e.id, revision: before.revision })
    expect(publicDetail.diagnostics).toHaveLength(2)
    expect(JSON.stringify(publicDetail.diagnostics)).not.toContain('/private/plugin')
    const mirrored = { ...state, records: [{ ...state.records[0]!, errors: [message, message] }] }
    expect(
      renderDesktopPluginManager(mirrored, { selectedPluginId: e.id }).split(escaped).length - 1,
    ).toBe(2)
    expect(s.catalog.snapshot).toEqual(before)
    expect(s.manager.state().records[0]!.enabled).toBe(true)
  })
})

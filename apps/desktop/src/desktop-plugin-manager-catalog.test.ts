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
import { copyPluginManagementSnapshot, parsePluginPackageArchive } from '@milkup/plugin'
import type { PluginManifest, PluginPackageArchive, PluginRenderer } from '@milkup/plugin'
import {
  DesktopPluginManager,
  ReservedPluginMigrationError,
  createDesktopPluginActions,
  renderDesktopPluginManager,
  type DesktopPluginModuleCapabilities,
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
    replacePending,
  }: Parameters<DesktopPluginCatalog['prepare']>[0]) {
    const before = this.snapshot.entries.find((x) => x.id === pkg.manifest.id)
    expect(expectedRevision).toBe(before?.revision ?? null)
    if (replacePending) {
      expect(before?.pending?.phase).toBe('prepared')
      expect(before?.pending?.transactionId).toBe(replacePending.transactionId)
      expect(before?.pending?.generation.id).toBe(replacePending.generationId)
      expect(before?.pending?.generation.sourcePath).toBe(replacePending.sourcePath)
      expect(before?.pending?.generation.capabilityFingerprint).toBe(replacePending.fingerprint)
    }
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
    if (action.type === 'beginTrial') {
      e.pending.phase = 'trial'
      e.pending.restoreEnabled = e.enabled
      e.enabled = false
    }
    if (action.type === 'commit') {
      if (this.failCommit) throw Error('commit disk failure')
      e.previous = e.active
      e.active = { ...e.pending.generation, verified: true }
      e.pending = null
      e.enabled = action.enabled
    }
    if (action.type === 'abort') {
      e.enabled = e.pending.restoreEnabled && !!e.active
      e.pending = null
      e.tombstone = !e.active
    }
    if (action.type === 'failCandidate') {
      e.pending.phase = 'prepared'
      e.enabled = false
      e.startAttempt = null
      e.diagnostics.push(action.message)
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
      if (e.pending) e.pending.restoreEnabled = false
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
      e.startAttempt = null
      if (e.pending) {
        e.pending.generation.approvedFingerprint = null
        e.pending.restoreEnabled = false
        if (e.pending.phase === 'trial') e.pending = null
      }
      if (e.active) e.active.approvedFingerprint = null
      if (e.previous) e.previous.approvedFingerprint = null
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
  it('keeps pending and active cards in one stable order through first activation and failure', async () => {
    const catalog = new Catalog()
    let pkg = archive()
    let fail = false
    const manager = new DesktopPluginManager({
      catalog,
      actionRegistry: new ActionRegistry(),
      permissions: [],
      milkupVersion: '2.0.0',
      pluginSdkVersion: '0.3.7',
      manifestHost: {
        selectManifestPath: async () => undefined,
        readManifestText: async () => JSON.stringify(pkg),
      },
      loadModule: async () => ({
        module: {
          runtimeHost: 'isolated',
          activate: () => {
            if (fail) throw new Error('activation failed')
            return {}
          },
        },
        dispose: () => undefined,
      }),
    })
    await manager.ready
    for (const id of ['cards.alpha', 'cards.beta']) {
      pkg = { ...archive(), manifest: { ...manifest(), id } }
      await manager.installManifestPath(`/${id}.milkup-plugin`)
    }
    const ids = () => manager.state().records.map((record) => record.manifest.id)
    const initial = ids()
    expect(initial).toEqual(['cards.alpha', 'cards.beta'])
    const beta = catalog.snapshot.entries.find((entry) => entry.id === 'cards.beta')!
    await manager.approve(beta.id, beta.pending!.generation.capabilityFingerprint, beta.revision)
    await manager.enable(beta.id)
    expect(ids()).toEqual(initial)
    await manager.disable(beta.id)
    expect(ids()).toEqual(initial)
    fail = true
    await manager.enable(beta.id).catch(() => undefined)
    expect(ids()).toEqual(initial)
    expect(new Set(ids()).size).toBe(2)
  })
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
    expect(s.catalog.snapshot.entries[0]!.pending?.phase).toBe('prepared')
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
      expect(s.catalog.snapshot.entries[0]!.pending?.phase).toBe('prepared')
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
      render = vi.fn<PluginRenderer>(() => ({ type: 'text', text: 'outline' })),
      capabilities: DesktopPluginModuleCapabilities[] = [],
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
      loadModule: async (_manifest, _specifier, instance) => {
        capabilities.push(instance!)
        return {
          module: {
            runtimeHost: 'isolated',
            activate: () => ({ dispose: activationDispose }),
            renderers: { 'outline-panel': render },
          },
          dispose: ownerDispose,
        }
      },
    })
    await manager.ready
    await manager.installManifestPath('/outline.milkup-plugin')
    const entry = catalog.snapshot.entries[0]!
    await manager.approve(entry.id, entry.pending!.generation.capabilityFingerprint, entry.revision)
    await manager.enable(entry.id)
    await manager.renderUi(entry.id, 'outline-panel', 'mount')
    return { manager, catalog, render, capabilities, activationDispose, ownerDispose, id: entry.id }
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

  describe.each(['disable', 'remove', 're-enable'] as const)(
    'late UI response after %s',
    (retire) => {
      it.each(['mount', 'update'] as const)('rejects the retired %s result', async (phase) => {
        const s = await mountedUi()
        const oldGeneration = s.manager.documentRendererGeneration(s.id)
        const retired = s.capabilities[0]!
        let finish!: (value: unknown) => void
        s.render.mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              finish = resolve
            }),
        )
        const result = s.manager.renderUi(s.id, 'outline-panel', phase)
        const rejected = expect(result).rejects.toThrow('Plugin UI activation was revoked')

        if (retire === 'remove') await s.manager.remove(s.id)
        else await s.manager.disable(s.id)
        expect(s.manager.state().contributions.ui).toEqual([])
        expect(s.activationDispose).toHaveBeenCalledOnce()
        expect(s.ownerDispose).toHaveBeenCalledOnce()
        if (retire === 're-enable') {
          await s.manager.enable(s.id)
          await expect(s.manager.renderUi(s.id, 'outline-panel', 'mount')).resolves.toEqual({
            type: 'text',
            text: 'outline',
          })
        }
        const nextGeneration = s.manager.documentRendererGeneration(s.id)
        expect(nextGeneration).toBeGreaterThan(oldGeneration)

        finish('obsolete UI output')
        await rejected
        retired.onDocumentRenderTimeout?.()
        retired.onIsolationError?.(new Error('late retired isolation failure'))
        expect(s.manager.documentRendererGeneration(s.id)).toBe(nextGeneration)
        if (retire === 're-enable') {
          expect(s.manager.state().records[0]).toMatchObject({ enabled: true, state: 'enabled' })
          await expect(s.manager.renderUi(s.id, 'outline-panel', 'update')).resolves.toEqual({
            type: 'text',
            text: 'outline',
          })
          await s.manager.disable(s.id)
        } else expect(s.manager.state().contributions.ui).toEqual([])
      })
    },
  )

  it('ignores a retired dispose rejection after the replacement UI has mounted', async () => {
    const s = await mountedUi()
    let fail!: (error: Error) => void
    s.render.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          fail = reject
        }),
    )
    const retiredDispose = s.manager.renderUi(s.id, 'outline-panel', 'dispose')
    await s.manager.disable(s.id)
    await s.manager.enable(s.id)
    await s.manager.renderUi(s.id, 'outline-panel', 'mount')
    const generation = s.manager.documentRendererGeneration(s.id)

    fail(new Error('late old disposal failure'))
    await expect(retiredDispose).resolves.toBeUndefined()
    expect(s.manager.documentRendererGeneration(s.id)).toBe(generation)
    expect(s.manager.state().records[0]).toMatchObject({ enabled: true, state: 'enabled' })
    await expect(s.manager.renderUi(s.id, 'outline-panel', 'update')).resolves.toEqual({
      type: 'text',
      text: 'outline',
    })
    expect(s.manager.state().diagnostics?.join(' ')).not.toContain('late old disposal failure')
    await s.manager.disable(s.id)
  })

  it.each(['startupComplete', 'commit'] as const)(
    'does not publish a revoked activation after delayed %s persistence',
    async (persistedPhase) => {
      const s = await mountedUi()
      await s.manager.disable(s.id)
      if (persistedPhase === 'commit') {
        await s.manager.installManifestPath('/outline.milkup-plugin')
        const entry = s.catalog.snapshot.entries[0]!
        await s.manager.approve(
          s.id,
          entry.pending!.generation.capabilityFingerprint,
          entry.revision,
        )
      }
      const transition = s.catalog.transition.bind(s.catalog)
      let release!: () => void
      let started!: () => void
      const waiting = new Promise<void>((resolve) => {
        started = resolve
      })
      const persisted = new Promise<void>((resolve) => {
        release = resolve
      })
      vi.spyOn(s.catalog, 'transition').mockImplementation(async (id, revision, action) => {
        const snapshot = await transition(id, revision, action)
        if (action.type === persistedPhase) {
          started()
          await persisted
        }
        return snapshot
      })
      const enabling = s.manager.enable(s.id)
      await waiting
      s.capabilities.at(-1)!.onIsolationError!(new Error('isolation failed during persistence'))
      expect(s.manager.state().contributions.ui).toEqual([])
      release()
      await expect(enabling).rejects.toThrow(/execution host failed|revoked/)
      expect(s.manager.state().contributions.ui).toEqual([])
    },
  )
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
    expect(dispatched).toEqual([
      'plugin.installLocal',
      'plugin.reload',
      'plugin.remove',
      'plugin.export',
    ])
    const toggle = source.slice(
      source.indexOf('async function toggleDesktopPlugin('),
      source.indexOf(
        "appRoot.querySelector<HTMLElement>('[data-plugin-manager]')?.addEventListener",
      ),
    )
    expect(toggle).toContain('await desktopPluginManager.enableFromUserIntent(pluginId)')
    expect(toggle).toContain('await desktopPluginManager.disable(pluginId)')
    expect(toggle).not.toContain('desktopPluginManager.approve(')
    expect(handler).not.toMatch(
      /runDesktopAction\('plugin\.(?:approve|rejectCandidate|enable|disable)'/,
    )
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
    expect(s.catalog.snapshot.entries[0]!.pending?.phase).toBe('prepared')
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

describe('P6 trusted host execution support explanation', () => {
  it('explains sidecar and strict DOM limits in details and candidate review without making platform verification claims', async () => {
    const s = setup()
    await s.manager.ready
    await s.install()
    await s.approve()
    await s.manager.enable('test.lifecycle')
    const state = s.manager.state(),
      record = state.records[0]!,
      entry = state.catalogEntries![0]!
    const detail = (m: PluginManifest) =>
      renderDesktopPluginManager(
        {
          ...state,
          records: [{ ...record, manifest: m }],
          catalogEntries: [{ ...entry, active: { ...entry.active!, manifest: m } }],
        },
        { selectedPluginId: record.manifest.id },
      )
    const sidecar = { ...record.manifest, host: 'sidecar' as const }
    expect(detail(sidecar)).toMatch(/当前插件目录不支持(?:启用|运行) sidecar 插件/)
    const dom = {
      ...record.manifest,
      host: 'dom' as const,
      permissions: ['document:read'] as const,
      contributes: {
        documentRenderers: [
          { id: 'diagram', contexts: ['fence'] as const, fenceLanguages: ['mermaid'] },
        ],
      },
    }
    expect(detail(dom)).toContain('仅支持只读文档呈现')
    expect(detail(dom)).toContain('当前系统提供 DOM 执行环境')
    expect(detail({ ...dom, permissions: ['document:read', 'document:write'] })).toContain(
      '此 DOM 声明不符合上述范围，无法启用',
    )
    expect(detail(record.manifest)).toContain('仍须通过当前系统的隔离启动验证')
    expect(detail(record.manifest)).not.toMatch(/Windows 已验证|macOS 已验证|所有平台均可用/)
    const pending = {
      transactionId: 'candidate-review',
      phase: 'prepared' as const,
      restoreEnabled: true,
      generation: { ...entry.active!, manifest: sidecar },
    }
    const candidateHtml = renderDesktopPluginManager(
      { ...state, catalogEntries: [{ ...entry, pending }] },
      { selectedPluginId: record.manifest.id },
    )
    expect(candidateHtml.slice(candidateHtml.indexOf('plugin-candidate'))).toMatch(
      /当前插件目录不支持(?:启用|运行) sidecar 插件/,
    )
    expect(
      renderDesktopPluginManager({ ...state, records: [{ ...record, manifest: sidecar }] }),
    ).not.toContain('执行支持')
    expect(s.manager.state().records[0]!.enabled).toBe(true)
  })
})

describe('beta3 failed candidate recovery', () => {
  it('keeps a first-install activation failure visible with diagnostics and permits explicit retry', async () => {
    let fails = true
    const s = setup({
      activate: () => {
        if (fails) throw Error('FIRST_INSTALL_FAILURE')
      },
    })
    await s.manager.ready
    await s.install()
    await s.approve()
    await expect(s.manager.enable('test.lifecycle')).rejects.toThrow('FIRST_INSTALL_FAILURE')
    expect(s.manager.state().records).toHaveLength(1)
    expect(s.manager.state().records[0]).toMatchObject({ enabled: false, state: 'failed' })
    expect(s.manager.state().records[0]!.errors.join(' ')).toContain('FIRST_INSTALL_FAILURE')
    expect(s.catalog.snapshot.entries[0]!.pending?.phase).toBe('prepared')
    fails = false
    await s.manager.enableFromUserIntent('test.lifecycle')
    expect(s.manager.state().records[0]).toMatchObject({ enabled: true })
  })
})

describe('beta3 restart and platform execution boundaries', () => {
  function reopen(
    catalog: Catalog,
    options: Partial<ConstructorParameters<typeof DesktopPluginManager>[0]> = {},
  ) {
    return new DesktopPluginManager({
      catalog,
      actionRegistry: new ActionRegistry(),
      permissions: [],
      milkupVersion: '2.0.0',
      pluginSdkVersion: '0.3.7',
      manifestHost: {
        selectManifestPath: async () => undefined,
        readManifestText: async () => JSON.stringify(archive()),
      },
      loadModule: async () => ({
        module: { runtimeHost: 'isolated', activate: () => ({}) },
        dispose: () => {},
      }),
      ...options,
    })
  }
  it('retains failure details on manager reopen and explicitly retries the same sealed candidate', async () => {
    const s = setup({
      activate: () => {
        throw Error('PERSISTED_FAILURE')
      },
    })
    await s.manager.ready
    await s.install()
    await s.approve()
    await expect(s.manager.enable('test.lifecycle')).rejects.toThrow('PERSISTED_FAILURE')
    const candidate = s.catalog.snapshot.entries[0]!.pending!
    const load = vi.fn(async () => ({
      module: { runtimeHost: 'isolated' as const, activate: () => ({}) },
      dispose: () => {},
    }))
    const reopened = reopen(s.catalog, {
      loadModule: load,
      bundledPackagePaths: async () => ['/bundled.milkup-plugin'],
    })
    await reopened.ready
    expect(load).not.toHaveBeenCalled()
    expect(reopened.state().records[0]?.errors.join(' ')).toContain('PERSISTED_FAILURE')
    expect(s.catalog.snapshot.entries[0]!.pending).toEqual(candidate)
    await reopened.enable('test.lifecycle')
    expect(s.catalog.snapshot.entries[0]!.active?.id).toBe(candidate.generation.id)
    expect(reopened.state().records[0]?.enabled).toBe(true)
  })
  it('repairs legacy empty receipts from bundled packages while preserving explicit rejection tombstones', async () => {
    const s = setup()
    await s.manager.ready
    await s.install()
    const entry = s.catalog.snapshot.entries[0]!
    s.catalog.snapshot = {
      ...s.catalog.snapshot,
      entries: [
        { ...entry, pending: null, diagnostics: ['Candidate aborted; old installation retained'] },
      ],
    }
    const repaired = reopen(s.catalog, {
      bundledPackagePaths: async () => ['/bundled.milkup-plugin'],
    })
    await repaired.ready
    expect(repaired.state().records).toHaveLength(1)
    const candidate = s.catalog.snapshot.entries[0]!
    await repaired.rejectCandidate(
      candidate.id,
      candidate.pending!.generation.capabilityFingerprint,
      candidate.revision,
    )
    const rejected = structuredClone(s.catalog.snapshot)
    const next = reopen(s.catalog, { bundledPackagePaths: async () => ['/bundled.milkup-plugin'] })
    await next.ready
    expect(s.catalog.snapshot).toEqual(rejected)
    expect(next.state().records).toHaveLength(0)
  })
  it('checks trusted platform support before trial or old-instance retirement and exposes the reason', async () => {
    const s = setup()
    await s.manager.ready
    await s.install()
    await s.approve()
    await s.manager.enable('test.lifecycle')
    await s.install('2.0.0')
    await s.approve()
    const load = vi.fn(async () => ({
      module: { runtimeHost: 'isolated' as const, activate: () => ({}) },
      dispose: () => {},
    }))
    const manager = reopen(s.catalog, {
      loadModule: load,
      executionUnavailableReason: (m) =>
        m.version === '2.0.0' ? 'PLATFORM_DOM_UNAVAILABLE' : undefined,
    })
    await manager.ready
    const before = structuredClone(s.catalog.snapshot)
    const count = s.catalog.events.filter((x) => x === 'beginTrial').length
    await expect(manager.enable('test.lifecycle')).rejects.toThrow('PLATFORM_DOM_UNAVAILABLE')
    expect(s.catalog.snapshot).toEqual(before)
    expect(s.catalog.events.filter((x) => x === 'beginTrial')).toHaveLength(count)
    expect(load).toHaveBeenCalledOnce()
    expect(manager.state().records[0]?.enabled).toBe(true)
    expect(manager.state().executionUnavailableReasons?.['test.lifecycle']).toBe(
      'PLATFORM_DOM_UNAVAILABLE',
    )
  })
})

describe('beta4 explicit card enable intent', () => {
  const intent = (manager: DesktopPluginManager) => manager.enableFromUserIntent('test.lifecycle')

  it('approves and activates a newly staged candidate from one explicit intent', async () => {
    const s = setup()
    await s.manager.ready
    await s.install('1.0.0', ['document:write'])
    await intent(s.manager)
    expect(s.catalog.events.slice(-3)).toEqual(['approve', 'beginTrial', 'commit'])
    expect(s.manager.state().records[0]).toMatchObject({ enabled: true })
  })
  it('retries a failed first install without a separate approval or reload action', async () => {
    let fails = true
    const s = setup({
      activate: () => {
        if (fails) throw Error('TRY_AGAIN')
      },
    })
    await s.manager.ready
    await s.install()
    await expect(intent(s.manager)).rejects.toThrow('TRY_AGAIN')
    expect(s.manager.state().records[0]).toMatchObject({ enabled: false, state: 'failed' })
    fails = false
    await intent(s.manager)
    expect(s.manager.state().records[0]?.enabled).toBe(true)
  })
  it('keeps ordinary enable and public app-control action from implicitly approving a candidate', async () => {
    const s = setup()
    await s.manager.ready
    await s.install()
    for (const action of createDesktopPluginActions(s.manager)) s.actions.register(action)
    await expect(s.manager.enable('test.lifecycle')).rejects.toThrow('require approval')
    await expect(
      s.actions.run(
        'plugin.enable',
        { permissions: ['app:control'] },
        { pluginId: 'test.lifecycle' },
      ),
    ).rejects.toThrow('require approval')
    expect(s.catalog.snapshot.entries[0]!.pending!.generation.approvedFingerprint).toBeNull()
  })
  it('rejects reload while disabled without granting approval or changing catalog state', async () => {
    const s = setup()
    await s.manager.ready
    await s.install()
    await s.approve()
    const before = structuredClone(s.catalog.snapshot)
    await expect(s.manager.reload('test.lifecycle')).rejects.toThrow('enabled')
    expect(s.catalog.snapshot).toEqual(before)
    expect(s.events).toEqual([])
  })
})

describe('beta4 enable intent authority and lifecycle', () => {
  it('leaves preinstalled bundles dormant until the same explicit card intent approves and starts them', async () => {
    const catalog = new Catalog(),
      load = vi.fn(async () => ({
        module: { runtimeHost: 'isolated' as const, activate: () => ({}) },
        dispose: () => {},
      }))
    const manager = new DesktopPluginManager({
      catalog,
      actionRegistry: new ActionRegistry(),
      permissions: ['document:write'],
      milkupVersion: '2.0.0',
      pluginSdkVersion: '0.3.7',
      manifestHost: {
        selectManifestPath: async () => undefined,
        readManifestText: async () => JSON.stringify(archive('1.0.0', ['document:write'])),
      },
      bundledPackagePaths: async () => ['/bundled.milkup-plugin'],
      loadModule: load,
    })
    await manager.ready
    expect(manager.state().records[0]?.enabled).toBe(false)
    expect(catalog.snapshot.entries[0]!.pending!.generation.approvedFingerprint).toBeNull()
    expect(load).not.toHaveBeenCalled()
    await manager.enableFromUserIntent('test.lifecycle')
    expect(load).toHaveBeenCalledOnce()
    expect(manager.state().records[0]?.enabled).toBe(true)
  })

  it('coalesces rapid explicit enables and is idempotent after successful publication', async () => {
    let finish!: () => void
    const activation = new Promise<void>((resolve) => {
      finish = resolve
    })
    const s = setup({ activate: () => activation })
    await s.manager.ready
    await s.install()
    const first = s.manager.enableFromUserIntent('test.lifecycle')
    const second = s.manager.enableFromUserIntent('test.lifecycle')
    expect(second).toBe(first)
    await vi.waitFor(() => expect(s.events).toContain('activate:1.0.0'))
    finish()
    await Promise.all([first, second])
    await s.manager.enableFromUserIntent('test.lifecycle')
    expect(s.events).toEqual(['activate:1.0.0'])
    expect(s.catalog.events.filter((x) => x === 'approve')).toHaveLength(1)
    expect(s.catalog.events.filter((x) => x === 'commit')).toHaveLength(1)
  })
  it('keeps pending upgrades untouched by reload; off then on explicitly promotes the candidate', async () => {
    const s = setup()
    await s.manager.ready
    await s.install()
    await s.manager.enableFromUserIntent('test.lifecycle')
    await s.install('2.0.0', ['document:write'])
    const pending = structuredClone(s.catalog.snapshot.entries[0]!.pending)
    await s.manager.reload('test.lifecycle')
    expect(s.catalog.snapshot.entries[0]!.pending).toEqual(pending)
    expect(s.manager.state().records[0]?.manifest.version).toBe('1.0.0')
    await s.manager.disable('test.lifecycle')
    expect(s.catalog.snapshot.entries[0]!.pending).toEqual({ ...pending, restoreEnabled: false })
    await s.manager.enableFromUserIntent('test.lifecycle')
    expect(s.manager.state().records[0]).toMatchObject({
      enabled: true,
      manifest: { version: '2.0.0' },
    })
  })
  it('restores the published old active when an explicitly requested candidate fails', async () => {
    const s = setup({
      activate: (version) => {
        if (version === '2.0.0') throw Error('BAD_UPGRADE')
      },
    })
    await s.manager.ready
    await s.install()
    await s.manager.enableFromUserIntent('test.lifecycle')
    const old = structuredClone(s.catalog.snapshot.entries[0]!.active)
    await s.install('2.0.0', ['document:write'])
    await expect(s.manager.enableFromUserIntent('test.lifecycle')).rejects.toThrow('BAD_UPGRADE')
    expect(s.catalog.snapshot.entries[0]!.active).toEqual(old)
    expect(s.catalog.snapshot.entries[0]!.pending?.phase).toBe('prepared')
    expect(s.manager.state().records[0]).toMatchObject({
      enabled: true,
      manifest: { version: '1.0.0' },
    })
  })
  it('uses active approval CAS when a disabled retained active has revoked approval', async () => {
    const s = setup()
    await s.manager.ready
    await s.install()
    await s.manager.enableFromUserIntent('test.lifecycle')
    await s.manager.revokeApproval('test.lifecycle')
    await s.manager.enableFromUserIntent('test.lifecycle')
    expect(s.catalog.events.slice(-3)).toEqual(['approveActive', 'startupBegin', 'startupComplete'])
    expect(s.manager.state().records[0]?.enabled).toBe(true)
  })
  it('rejects a candidate replacement queued ahead of the captured user intent', async () => {
    const s = setup()
    await s.manager.ready
    await s.install()
    let release!: () => void
    const barrier = new Promise<void>((resolve) => {
      release = resolve
    })
    const queued = (s.manager as any).runPluginLifecycle('test.lifecycle', async () => {
      await barrier
      const e = s.catalog.snapshot.entries[0]!
      await s.catalog.prepare({
        archive: archive('2.0.0'),
        sourcePath: 'other',
        expectedRevision: e.revision,
      })
      ;(s.manager as any).applyCatalog(await s.catalog.read())
    })
    const enable = s.manager.enableFromUserIntent('test.lifecycle')
    await Promise.resolve()
    const failure = expect(enable).rejects.toThrow('changed before enable intent')
    release()
    await queued
    await failure
    expect(s.catalog.snapshot.entries[0]!.pending!.generation.approvedFingerprint).toBeNull()
    expect(s.events).toEqual([])
  })
  it('does not activate a replaced candidate returned after the approval await', async () => {
    const s = setup()
    await s.manager.ready
    await s.install()
    const transition = s.catalog.transition.bind(s.catalog)
    vi.spyOn(s.catalog, 'transition').mockImplementation(async (...args) => {
      await transition(...args)
      if (args[2].type === 'approve') {
        const e = s.catalog.snapshot.entries[0]!
        await s.catalog.prepare({
          archive: archive('2.0.0'),
          sourcePath: 'other',
          expectedRevision: e.revision,
        })
      }
      return s.catalog.read()
    })
    await expect(s.manager.enableFromUserIntent('test.lifecycle')).rejects.toThrow(
      'changed during enable intent',
    )
    expect(s.catalog.snapshot.entries[0]!.pending!.generation.approvedFingerprint).toBeNull()
    expect(s.catalog.events).not.toContain('beginTrial')
    expect(s.events).toEqual([])
  })
  it('retains native rejection of corrupted package approval and never starts code', async () => {
    const s = setup()
    await s.manager.ready
    await s.install()
    vi.spyOn(s.catalog, 'transition').mockRejectedValueOnce(
      Error('[plugin-catalog:corrupt] generation bytes changed'),
    )
    await expect(s.manager.enableFromUserIntent('test.lifecycle')).rejects.toThrow(
      'generation bytes changed',
    )
    expect(s.catalog.snapshot.entries[0]!.pending!.generation.approvedFingerprint).toBeNull()
    expect(s.events).toEqual([])
  })
  it.each(['sidecar', 'permission', 'platform', 'compatibility'])(
    'rejects unsupported %s before granting candidate approval',
    async (kind) => {
      const s = setup()
      await s.manager.ready
      await s.install()
      const e = s.catalog.snapshot.entries[0]!,
        p = e.pending!
      const m = {
        ...p.generation.manifest,
        ...(kind === 'sidecar' ? { host: 'sidecar' as const } : {}),
        ...(kind === 'permission' ? { permissions: ['workspace:read'] as const } : {}),
        ...(kind === 'compatibility' ? { engines: { milkup: '^99.0.0' } } : {}),
      }
      s.catalog.snapshot = {
        ...s.catalog.snapshot,
        entries: [{ ...e, pending: { ...p, generation: { ...p.generation, manifest: m } } }],
      }
      ;(s.manager as any).applyCatalog(await s.catalog.read())
      if (kind === 'platform')
        (s.manager as any).executionUnavailableReason = () => 'PLATFORM_UNAVAILABLE'
      await expect(s.manager.enableFromUserIntent('test.lifecycle')).rejects.toThrow()
      expect(s.catalog.events).not.toContain('approve')
      expect(s.catalog.events).not.toContain('beginTrial')
      expect(s.events).toEqual([])
    },
  )
  it('keeps restricted initialization writes blocked even with explicit user approval', async () => {
    const s = setup({
      activate: async (_version, context) => {
        try {
          await context.host.writeText('/data/test.lifecycle/result.txt', 'BAD')
        } catch {}
      },
    })
    await s.manager.ready
    await s.install('1.0.0', ['file:write'])
    fileWrites.mockClear()
    await expect(s.manager.enableFromUserIntent('test.lifecycle')).rejects.toThrow()
    expect(fileWrites).not.toHaveBeenCalled()
    expect(s.manager.state().records[0]?.enabled).toBe(false)
    expect(s.catalog.snapshot.entries[0]!.pending?.phase).toBe('prepared')
  })
})

describe('beta4 host reserved plugin migration', () => {
  function reservedManager(catalog: Catalog, load = vi.fn()) {
    return new DesktopPluginManager({
      catalog,
      reservedPluginIds: ['test.lifecycle'],
      actionRegistry: new ActionRegistry(),
      permissions: [],
      milkupVersion: '2.0.0',
      pluginSdkVersion: '0.3.7',
      manifestHost: {
        selectManifestPath: async () => undefined,
        readManifestText: async () => JSON.stringify(archive()),
      },
      bundledPackagePaths: async () => ['/bundled.milkup-plugin'],
      loadModule: load,
    })
  }
  it('revokes old active before startup, hides it, rejects imports, and preserves retained native records', async () => {
    const s = setup()
    await s.manager.ready
    await s.install()
    await s.manager.enableFromUserIntent('test.lifecycle')
    const active = s.catalog.snapshot.entries[0]!.active!
    const load = vi.fn(),
      next = reservedManager(s.catalog, load)
    await next.ready
    expect(load).not.toHaveBeenCalled()
    expect(s.catalog.snapshot.entries[0]).toMatchObject({
      enabled: false,
      tombstone: false,
      active: { id: active.id, approvedFingerprint: null },
    })
    expect(next.state().records).toEqual([])
    expect(next.state().catalogEntries).toEqual([])
    expect(next.managementSnapshot().items).toEqual([])
    await expect(next.enableFromUserIntent('test.lifecycle')).rejects.toThrow('reserved')
    await expect(next.enable('test.lifecycle')).rejects.toThrow('reserved')
    await expect(next.installManifestPath('/reserved.milkup-plugin')).rejects.toThrow('reserved')
    const before = structuredClone(s.catalog.snapshot)
    await reservedManager(s.catalog).ready
    expect(s.catalog.snapshot).toEqual(before)
    expect(s.catalog.events).not.toContain('remove')
  })
  it('rejects ready on migration failure, starts no plugins, and retries safely on the next launch', async () => {
    const s = setup()
    await s.manager.ready
    await s.install()
    await s.approve()
    const original = s.catalog.transition.bind(s.catalog)
    vi.spyOn(s.catalog, 'transition').mockRejectedValueOnce(Error('disk failed'))
    const load = vi.fn()
    await expect(reservedManager(s.catalog, load).ready).rejects.toBeInstanceOf(
      ReservedPluginMigrationError,
    )
    expect(load).not.toHaveBeenCalled()
    vi.mocked(s.catalog.transition).mockImplementation(original)
    await reservedManager(s.catalog, load).ready
    expect(load).not.toHaveBeenCalled()
    expect(s.catalog.snapshot.entries[0]!.pending?.generation.approvedFingerprint).toBeNull()
    expect(s.catalog.snapshot.entries[0]!.pending?.generation.manifest.id).toBe('test.lifecycle')
  })
})

describe('beta4 explicit trusted bundled upgrade', () => {
  const source = 'bundled:fixture.milkup-plugin'
  async function setupBundled(
    options: {
      active?: boolean
      source?: string
      oldVersion?: string
      nextVersion?: string
      tombstone?: boolean
      paths?: string[]
      historicalSources?: string[]
    } = {},
  ) {
    const catalog = new Catalog()
    const oldPackage = {
      ...archive(options.oldVersion ?? '1.1.1', ['document:read']),
      manifest: {
        ...manifest(options.oldVersion ?? '1.1.1', ['document:read']),
        host: 'dom' as const,
        contributes: {
          documentRenderers: [
            { id: 'diagram', contexts: ['fence'] as const, fenceLanguages: ['mermaid'] },
          ],
        },
      },
    }
    await catalog.prepare({
      archive: oldPackage,
      sourcePath: options.source ?? source,
      expectedRevision: null,
    })
    if (options.active) {
      for (const type of ['approve', 'beginTrial', 'commit'] as const) {
        const e = catalog.snapshot.entries[0]!,
          p = e.pending!
        await catalog.transition(
          e.id,
          e.revision,
          type === 'commit'
            ? {
                type,
                transactionId: p.transactionId,
                fingerprint: p.generation.capabilityFingerprint,
                enabled: false,
              }
            : {
                type,
                transactionId: p.transactionId,
                fingerprint: p.generation.capabilityFingerprint,
              },
        )
      }
    }
    if (options.tombstone) {
      const e = catalog.snapshot.entries[0]!
      await catalog.transition(e.id, e.revision, { type: 'remove' })
    }
    const initial = structuredClone(catalog.snapshot)
    const nextPackage = archive(options.nextVersion ?? '1.2.0')
    const load = vi.fn(async () => ({
      module: { runtimeHost: 'isolated' as const, activate: () => ({}) },
      dispose: () => {},
    }))
    const manager = new DesktopPluginManager({
      catalog,
      actionRegistry: new ActionRegistry(),
      permissions: ['document:read'],
      milkupVersion: '2.0.0',
      pluginSdkVersion: '0.3.7',
      manifestHost: {
        selectManifestPath: async () => undefined,
        readManifestText: async () => JSON.stringify(nextPackage),
      },
      bundledPackagePaths: async () => options.paths ?? [source],
      bundledUpgradeSources: { 'test.lifecycle': options.historicalSources ?? [] },
      executionUnavailableReason: (m) => (m.host === 'dom' ? 'WINDOWS_DOM_UNAVAILABLE' : undefined),
      loadModule: load,
    })
    await manager.ready
    return { manager, catalog, initial, load, nextPackage }
  }
  it.each([false, true])(
    'offers newer bundled Worker without startup mutation, then applies it on one gesture (active=%s)',
    async (active) => {
      const s = await setupBundled({ active })
      expect(s.catalog.snapshot).toEqual(s.initial)
      expect(s.load).not.toHaveBeenCalled()
      expect(s.manager.state().bundledUpgradeOffers?.['test.lifecycle']).toMatchObject({
        version: '1.2.0',
        host: 'worker',
      })
      expect(s.manager.state().executionUnavailableReasons?.['test.lifecycle']).toBeUndefined()
      const prepare = vi.spyOn(s.catalog, 'prepare')
      await s.manager.enableFromUserIntent('test.lifecycle')
      expect(prepare).toHaveBeenCalledOnce()
      const request = prepare.mock.calls[0]![0]
      expect(request.archive).toEqual(parsePluginPackageArchive(s.nextPackage))
      expect(request.archive.files).toEqual(s.nextPackage.files)
      expect(request.sourcePath).toBe(source)
      expect(request.expectedRevision).toBe(s.initial.entries[0]!.revision)
      if (active) expect(request.replacePending).toBeUndefined()
      else
        expect(request.replacePending).toEqual({
          transactionId: s.initial.entries[0]!.pending!.transactionId,
          generationId: s.initial.entries[0]!.pending!.generation.id,
          sourcePath: source,
          fingerprint: s.initial.entries[0]!.pending!.generation.capabilityFingerprint,
        })
      expect(s.manager.state().records[0]).toMatchObject({
        enabled: true,
        manifest: { version: '1.2.0', host: 'worker' },
      })
      expect(s.load).toHaveBeenCalledOnce()
      expect(s.manager.state().bundledUpgradeOffers?.['test.lifecycle']).toBeUndefined()
    },
  )
  it.each([
    { source: '/picked/user-package.milkup-plugin' },
    { source: 'bundled:different-receipt.milkup-plugin' },
    { tombstone: true },
    { nextVersion: '1.1.1' },
    { nextVersion: '1.0.0' },
    { nextVersion: '1.1.1+new-build' },
    { nextVersion: '1.1.1-beta.9' },
    { nextVersion: '01.2.0' },
    { paths: [source, 'bundled:duplicate.milkup-plugin'] },
  ])(
    'does not replace user receipts, removals, ambiguous bundles, or non-newer versions: %j',
    async (options) => {
      const s = await setupBundled(options)
      expect(s.catalog.snapshot).toEqual(s.initial)
      expect(s.manager.state().bundledUpgradeOffers?.['test.lifecycle']).toBeUndefined()
      const prepare = vi.spyOn(s.catalog, 'prepare')
      await expect(s.manager.enableFromUserIntent('test.lifecycle')).rejects.toThrow()
      expect(prepare).not.toHaveBeenCalled()
      expect(s.catalog.snapshot).toEqual(s.initial)
      expect(s.load).not.toHaveBeenCalled()
    },
  )
  it.each([
    { oldVersion: '1.9.0', nextVersion: '1.10.0' },
    { oldVersion: '1.2.0-beta.2', nextVersion: '1.2.0-beta.11' },
    { oldVersion: '1.2.0-beta.11', nextVersion: '1.2.0' },
  ])('uses semver precedence for bundled offers: %j', async (options) => {
    const s = await setupBundled(options)
    expect(s.manager.state().bundledUpgradeOffers?.['test.lifecycle']?.version).toBe(
      options.nextVersion,
    )
  })
  it.each([false, true])(
    'binds a host-listed historical filename while recording the actual new bundle source (active=%s)',
    async (active) => {
      const oldSource = 'bundled:test.lifecycle-1.1.1.milkup-plugin'
      const s = await setupBundled({ active, source: oldSource, historicalSources: [oldSource] })
      expect(s.manager.state().bundledUpgradeOffers?.['test.lifecycle']).toBeDefined()
      const prepare = vi.spyOn(s.catalog, 'prepare')
      await s.manager.enableFromUserIntent('test.lifecycle')
      expect(prepare.mock.calls[0]![0].sourcePath).toBe(source)
      if (!active) expect(prepare.mock.calls[0]![0].replacePending?.sourcePath).toBe(oldSource)
      expect(s.catalog.snapshot.entries[0]!.active?.sourcePath).toBe(source)
    },
  )
  it('uses a user-imported Worker candidate platform support over the retained old DOM active', async () => {
    const s = await setupBundled({ active: true, paths: [] })
    await s.manager.installManifestPath('/picked/new-worker.milkup-plugin')
    expect(s.manager.state().bundledUpgradeOffers?.['test.lifecycle']).toBeUndefined()
    expect(s.manager.state().executionUnavailableReasons?.['test.lifecycle']).toBeUndefined()
    const prepare = vi.spyOn(s.catalog, 'prepare')
    await s.manager.enableFromUserIntent('test.lifecycle')
    expect(prepare).not.toHaveBeenCalled()
    expect(s.manager.state().records[0]).toMatchObject({
      enabled: true,
      manifest: { host: 'worker', version: '1.2.0' },
    })
  })
  it('retains the exact old candidate on a failed native replacement and remains retryable', async () => {
    const s = await setupBundled()
    vi.spyOn(s.catalog, 'prepare').mockRejectedValueOnce(Error('replacement disk full'))
    await expect(s.manager.enableFromUserIntent('test.lifecycle')).rejects.toThrow('disk full')
    expect(s.catalog.snapshot).toEqual(s.initial)
    expect(s.load).not.toHaveBeenCalled()
    expect(s.manager.state().records).toHaveLength(1)
    await s.manager.enableFromUserIntent('test.lifecycle')
    expect(s.manager.state().records[0]?.enabled).toBe(true)
  })
  it('rereads an uncertain durable replacement and does not approve until another explicit gesture', async () => {
    const s = await setupBundled(),
      prepare = s.catalog.prepare.bind(s.catalog)
    vi.spyOn(s.catalog, 'prepare').mockImplementationOnce(async (request) => {
      await prepare(request)
      throw Error('reply lost after durable replacement')
    })
    const events = s.catalog.events.length
    await expect(s.manager.enableFromUserIntent('test.lifecycle')).rejects.toThrow('reply lost')
    expect(s.catalog.snapshot.entries[0]!.pending?.generation.manifest.version).toBe('1.2.0')
    expect(s.catalog.snapshot.entries[0]!.pending?.generation.approvedFingerprint).toBeNull()
    expect(s.catalog.events.slice(events)).not.toContain('approve')
    expect(s.load).not.toHaveBeenCalled()
    await s.manager.enableFromUserIntent('test.lifecycle')
    expect(s.manager.state().records[0]?.enabled).toBe(true)
  })
})

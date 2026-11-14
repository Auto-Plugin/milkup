import { describe, expect, it, vi } from 'vitest'
import { parsePluginCatalogSnapshot } from './plugin-catalog-contract'
import {
  createDesktopPluginCatalog,
  catalogEntryToRegistryRecord,
  inspectLegacyPluginRegistry,
} from './desktop-plugin-catalog'

const manifest = {
  id: 'test.catalog',
  name: 'Catalog',
  version: '1.0.0',
  main: 'index.js',
  permissions: ['document:read'],
}
const fingerprint = 'a'.repeat(64)
function generation() {
  return {
    id: 'gen-123',
    manifest,
    manifestSha256: fingerprint,
    contentSha256: fingerprint,
    capabilityFingerprint: fingerprint,
    approvedFingerprint: fingerprint,
    verified: true,
    sourcePath: '/picked/package.json',
    packageRoot: '/data/packages/test.catalog/generations/gen-123',
  }
}
function entry() {
  return {
    id: manifest.id,
    revision: 1,
    active: generation(),
    previous: null,
    pending: null,
    enabled: true,
    tombstone: false,
    startAttempt: null,
    diagnostics: [],
    dataRoot: '/data/plugins/test.catalog',
    storageRoot: '/data/storage/test.catalog',
  }
}
function snapshot() {
  return { version: 1, revision: 1, entries: [entry()], diagnostics: [], migrationReceipt: null }
}

describe('native catalog wire authority', () => {
  it('copies and freezes a verified native snapshot', () => {
    const input = snapshot()
    const result = parsePluginCatalogSnapshot(input)
    input.entries[0]!.enabled = false
    expect(result.entries[0]!.enabled).toBe(true)
    expect(Object.isFrozen(result.entries)).toBe(true)
  })
  it.each([
    (s: any) => {
      s.entries.push(s.entries[0])
    },
    (s: any) => {
      s.entries[0].active.manifest.id = 'wrong.id'
    },
    (s: any) => {
      s.entries[0].active.approvedFingerprint = 'b'.repeat(64)
    },
    (s: any) => {
      s.entries[0].active.id = '../escape'
    },
    (s: any) => {
      s.entries[0].revision = 1.5
    },
    (s: any) => {
      s.entries[0].tombstone = true
    },
    (s: any) => {
      s.entries[0].active.verified = false
    },
    (s: any) => {
      s.entries[0].active = null
    },
  ])('rejects an inconsistent native snapshot', (mutate) => {
    const input = structuredClone(snapshot())
    mutate(input)
    expect(() => parsePluginCatalogSnapshot(input)).toThrow()
  })
  it('does not project a tombstone into a resurrectable UI record', () => {
    const input = entry()
    input.enabled = false
    input.tombstone = true
    expect(
      catalogEntryToRegistryRecord(
        parsePluginCatalogSnapshot({ ...snapshot(), entries: [input] }).entries[0]!,
      ),
    ).toBeUndefined()
  })
  it('projects active approvals only, never pending candidate capabilities', () => {
    const input: any = entry()
    input.pending = {
      transactionId: 'txn-123',
      phase: 'prepared',
      restoreEnabled: true,
      generation: {
        ...generation(),
        id: 'gen-456',
        manifest: { ...manifest, permissions: ['document:write'] },
        approvedFingerprint: null,
        verified: false,
      },
    }
    const record = catalogEntryToRegistryRecord(
      parsePluginCatalogSnapshot({ ...snapshot(), entries: [input] }).entries[0]!,
    )!
    expect(record.approvals.permissions).toEqual(['document:read'])
    expect(record.manifest.permissions).toEqual(['document:read'])
  })
  it('never falls back to local storage after native failure', async () => {
    const invoke = vi.fn().mockRejectedValue(new Error('catalog corrupt'))
    const catalog = createDesktopPluginCatalog(invoke)
    await expect(catalog.read()).rejects.toThrow('catalog corrupt')
    expect(invoke).toHaveBeenCalledExactlyOnceWith('plugin_catalog_read')
  })
  it('passes complete malformed legacy bytes to native for recoverable backup', async () => {
    const invoke = vi.fn().mockResolvedValue({ ...snapshot(), entries: [] })
    const catalog = createDesktopPluginCatalog(invoke)
    await catalog.migrateLegacy('{broken JSON')
    expect(invoke).toHaveBeenCalledExactlyOnceWith('plugin_catalog_migrate', {
      legacyRaw: '{broken JSON',
      validation: {
        version: 1,
        rawSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        records: [],
        diagnostics: expect.arrayContaining([expect.stringContaining('quarantined')]),
      },
    })
  })
  it('rejects malformed native replies without publishing partial entries', async () => {
    const invoke = vi.fn().mockResolvedValue({ ...snapshot(), entries: [entry(), { id: 'bad' }] })
    await expect(createDesktopPluginCatalog(invoke).read()).rejects.toThrow()
  })
})

describe('legacy migration inspection', () => {
  it('binds complete validation hints to exact raw bytes and original record index/manifest', async () => {
    const old = structuredClone(
      catalogEntryToRegistryRecord(parsePluginCatalogSnapshot(snapshot()).entries[0]!)!,
    )
    const rawManifest = {
      ...old.manifest,
      host: 'worker',
      permissions: ['document:read'],
      customMetadata: { keep: true },
    }
    const valid = { ...old, manifest: rawManifest }
    const invalid = { ...old, manifest: { ...old.manifest, id: 'test.invalid', name: undefined } }
    const raw = JSON.stringify({ version: 1, records: [invalid, valid] }, null, 2)
    const invoke = vi.fn().mockResolvedValue({ ...snapshot(), entries: [] })
    await createDesktopPluginCatalog(invoke).migrateLegacy(raw)
    const args = invoke.mock.calls[0]![1]!
    const sha = [
      ...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw))),
    ]
      .map((value) => value.toString(16).padStart(2, '0'))
      .join('')
    expect(args).toMatchObject({
      legacyRaw: raw,
      validation: { version: 1, rawSha256: sha, records: [{ index: 1, manifest: rawManifest }] },
    })
    expect(args.validation.diagnostics.join(' ')).toMatch(/record 0 quarantined/)
  })
  it('retains original bytes and quarantines corrupt JSON', () => {
    const result = inspectLegacyPluginRegistry('{broken')
    expect(result.raw).toBe('{broken')
    expect(result.records).toEqual([])
    expect(result.diagnostics.length).toBeGreaterThan(0)
  })
  it('quarantines every instance of duplicate IDs', () => {
    const old = {
      ...catalogEntryToRegistryRecord(parsePluginCatalogSnapshot(snapshot()).entries[0]!),
    }
    const result = inspectLegacyPluginRegistry(JSON.stringify({ version: 1, records: [old, old] }))
    expect(result.records).toEqual([])
    expect(result.diagnostics.join(' ')).toMatch(/duplicate/i)
  })
  it('never treats legacy approval arrays as scoped approval evidence', () => {
    const old = catalogEntryToRegistryRecord(parsePluginCatalogSnapshot(snapshot()).entries[0]!)!
    const result = inspectLegacyPluginRegistry(JSON.stringify({ version: 1, records: [old] }))
    expect(result.records).toHaveLength(1)
    expect(result.records[0]!.enabled).toBe(false)
    expect(result.records[0]!.approvals.permissions).toEqual([])
    expect(result.records[0]!.approvals.hosts).toEqual([])
  })
  it.each([
    (old: any) => {
      old.approvals = true
    },
    (old: any) => {
      old.rootPath = '/data/plugins/../escape'
    },
    (old: any) => {
      old.enabled = true
      old.state = 'disabled'
    },
    (old: any) => {
      old.approvals.hosts = ['sidecar']
    },
    (old: any) => {
      old.approvals.permissions = ['network:access']
    },
    (old: any) => {
      old.updatedAt = -1
    },
  ])('quarantines invalid legacy state without dropping the original bytes', (mutate) => {
    const old = structuredClone(
      catalogEntryToRegistryRecord(parsePluginCatalogSnapshot(snapshot()).entries[0]!)!,
    )
    mutate(old)
    const raw = JSON.stringify({ version: 1, records: [old] })
    const result = inspectLegacyPluginRegistry(raw)
    expect(result.records).toEqual([])
    expect(result.raw).toBe(raw)
    expect(result.diagnostics.join(' ')).toMatch(/quarantined/)
  })
})

describe('beta4 host-only prepared replacement wire', () => {
  it('forwards explicit manual import identity without changing the existing native command', async () => {
    const invoke = vi.fn(async () => snapshot())
    const catalog = createDesktopPluginCatalog(invoke)
    const request = {
      archive: { format: 'milkup-plugin', version: 1, manifest, files: [] } as any,
      sourcePath: '/picked/new.milkup-plugin',
      expectedRevision: 7,
      replacePending: {
        mode: 'manualImport' as const,
        transactionId: 'txn-7',
        generationId: 'gen-7',
        sourcePath: 'bundled:old-fixture.milkup-plugin',
        fingerprint,
      },
    }
    await catalog.prepare(request)
    expect(invoke).toHaveBeenCalledWith('plugin_catalog_prepare', request)
  })
  it('passes exact replacement CAS identity through prepare without introducing a public plugin action', async () => {
    const invoke = vi.fn(async () => snapshot())
    const catalog = createDesktopPluginCatalog(invoke)
    const request = {
      archive: { format: 'milkup-plugin', version: 1, manifest, files: [] } as any,
      sourcePath: 'bundled:fixture.milkup-plugin',
      expectedRevision: 7,
      replacePending: {
        transactionId: 'txn-7',
        generationId: 'gen-7',
        sourcePath: 'bundled:old-fixture.milkup-plugin',
        fingerprint,
      },
    }
    await catalog.prepare(request)
    expect(invoke).toHaveBeenCalledWith('plugin_catalog_prepare', request)
  })
})

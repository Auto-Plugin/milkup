import { parsePluginManifest, type PluginManifest, type PluginPackageArchive } from '@milkup/plugin'

/** Single wire contract shared with plugin_catalog.rs. Native owns all identifiers and paths. */
export interface PluginCatalogGeneration {
  readonly id: string
  readonly manifest: PluginManifest
  readonly manifestSha256: string
  readonly contentSha256: string
  readonly capabilityFingerprint: string
  readonly approvedFingerprint: string | null
  readonly verified: boolean
  readonly sourcePath: string
  readonly packageRoot: string
}

export interface PluginCatalogCandidate {
  readonly transactionId: string
  readonly generation: PluginCatalogGeneration
  readonly phase: 'prepared' | 'trial'
  readonly restoreEnabled: boolean
}

export interface PluginCatalogEntry {
  readonly id: string
  readonly revision: number
  readonly active: PluginCatalogGeneration | null
  readonly previous: PluginCatalogGeneration | null
  readonly pending: PluginCatalogCandidate | null
  readonly enabled: boolean
  readonly tombstone: boolean
  readonly startAttempt: string | null
  readonly diagnostics: readonly string[]
  readonly dataRoot: string
  readonly storageRoot: string
}

export interface PluginCatalogSnapshot {
  readonly version: 1
  readonly revision: number
  readonly entries: readonly PluginCatalogEntry[]
  readonly diagnostics: readonly string[]
  readonly migrationReceipt: string | null
}

interface CandidateIdentity {
  readonly transactionId: string
  readonly fingerprint: string
}

export type PluginCatalogAction =
  | (CandidateIdentity & { readonly type: 'approve' | 'beginTrial' | 'abort' })
  | (CandidateIdentity & { readonly type: 'commit'; readonly enabled: boolean })
  | { readonly type: 'startupBegin'; readonly generationId: string }
  | { readonly type: 'startupComplete'; readonly attemptId: string }
  | { readonly type: 'approveActive'; readonly generationId: string; readonly fingerprint: string }
  | { readonly type: 'markFailed'; readonly generationId: string; readonly message: string }
  | { readonly type: 'disable' | 'revokeApproval' | 'rollback' | 'remove' }

export interface PluginCatalogPrepareRequest {
  readonly archive: PluginPackageArchive
  readonly sourcePath: string
  readonly expectedRevision: number | null
}

export interface PluginCatalogMigrationRecord {
  /** Original raw registry index; never a reindexed filtered position. */
  readonly index: number
  /** Original JSON object, after full shared manifest/record validation. */
  readonly manifest: Readonly<Record<string, unknown>>
}

/** Trusted host validation evidence, not an approval or replacement for native disk checks. */
export interface PluginCatalogMigrationValidation {
  readonly version: 1
  readonly rawSha256: string
  readonly records: readonly PluginCatalogMigrationRecord[]
  readonly diagnostics: readonly string[]
}

export interface DesktopPluginCatalog {
  read(): Promise<PluginCatalogSnapshot>
  prepare(request: PluginCatalogPrepareRequest): Promise<PluginCatalogSnapshot>
  transition(
    pluginId: string,
    expectedRevision: number,
    action: PluginCatalogAction,
  ): Promise<PluginCatalogSnapshot>
  migrateLegacy(legacyRaw: string): Promise<PluginCatalogSnapshot>
}

const opaquePattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/
const pluginIdPattern = /^[a-z][a-z0-9]*(?:[.-][a-z][a-z0-9]*)*$/
const hashPattern = /^[a-f0-9]{64}$/

function fail(path: string): never {
  throw new Error(`Invalid native plugin catalog: ${path}`)
}
function object(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail(path)
  return value as Record<string, unknown>
}
function string(value: unknown, path: string, max = 4096): string {
  if (typeof value !== 'string' || !value || value.length > max || /[\u0000-\u001f]/.test(value))
    return fail(path)
  return value
}
function opaque(value: unknown, path: string): string {
  const result = string(value, path, 128)
  if (!opaquePattern.test(result)) return fail(path)
  return result
}
function hash(value: unknown, path: string): string {
  const result = string(value, path, 64)
  if (!hashPattern.test(result)) return fail(path)
  return result
}
function integer(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) return fail(path)
  return value
}
function boolean(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') return fail(path)
  return value
}
function diagnostics(value: unknown, path: string): readonly string[] {
  if (!Array.isArray(value) || value.length > 2048) return fail(path)
  return Object.freeze(
    value.map((item, index) => {
      if (typeof item !== 'string' || item.length > 65536) return fail(`${path}[${index}]`)
      return item
    }),
  )
}
function nativePath(value: unknown, path: string): string {
  const result = string(value, path)
  const normalized = result.replace(/\\/g, '/')
  if (
    !/^(?:\/|[A-Za-z]:\/)/.test(normalized) ||
    normalized.split('/').includes('..') ||
    normalized.split('/').includes('.')
  )
    return fail(path)
  return result
}
function generation(value: unknown, id: string, path: string): PluginCatalogGeneration {
  const input = object(value, path)
  const manifest = parsePluginManifest(input.manifest)
  if (manifest.id !== id) return fail(`${path}.manifest.id`)
  const capabilityFingerprint = hash(input.capabilityFingerprint, `${path}.capabilityFingerprint`)
  const approvedFingerprint =
    input.approvedFingerprint === null
      ? null
      : hash(input.approvedFingerprint, `${path}.approvedFingerprint`)
  if (approvedFingerprint !== null && approvedFingerprint !== capabilityFingerprint)
    return fail(`${path}.approvedFingerprint`)
  return Object.freeze({
    id: opaque(input.id, `${path}.id`),
    manifest,
    manifestSha256: hash(input.manifestSha256, `${path}.manifestSha256`),
    contentSha256: hash(input.contentSha256, `${path}.contentSha256`),
    capabilityFingerprint,
    approvedFingerprint,
    verified: boolean(input.verified, `${path}.verified`),
    sourcePath: string(input.sourcePath, `${path}.sourcePath`),
    packageRoot: nativePath(input.packageRoot, `${path}.packageRoot`),
  })
}
function entry(value: unknown, path: string): PluginCatalogEntry {
  const input = object(value, path)
  const id = string(input.id, `${path}.id`, 255)
  if (!pluginIdPattern.test(id)) return fail(`${path}.id`)
  const active = input.active === null ? null : generation(input.active, id, `${path}.active`)
  const previous =
    input.previous === null ? null : generation(input.previous, id, `${path}.previous`)
  let pending: PluginCatalogCandidate | null = null
  if (input.pending !== null) {
    const candidate = object(input.pending, `${path}.pending`)
    if (candidate.phase !== 'prepared' && candidate.phase !== 'trial')
      return fail(`${path}.pending.phase`)
    pending = Object.freeze({
      transactionId: opaque(candidate.transactionId, `${path}.pending.transactionId`),
      generation: generation(candidate.generation, id, `${path}.pending.generation`),
      phase: candidate.phase,
      restoreEnabled: boolean(candidate.restoreEnabled, `${path}.pending.restoreEnabled`),
    })
  }
  const enabled = boolean(input.enabled, `${path}.enabled`)
  const tombstone = boolean(input.tombstone, `${path}.tombstone`)
  const startAttempt =
    input.startAttempt === null ? null : opaque(input.startAttempt, `${path}.startAttempt`)
  if ((active && !active.verified) || (previous && !previous.verified))
    return fail(`${path}.verified`)
  if (enabled && (!active || tombstone || active.approvedFingerprint === null))
    return fail(`${path}.enabled`)
  if (tombstone && (pending !== null || startAttempt !== null)) return fail(`${path}.tombstone`)
  if (startAttempt !== null && (!active || !enabled)) return fail(`${path}.startAttempt`)
  const ids = [active?.id, previous?.id, pending?.generation.id].filter(
    (item) => item !== undefined,
  )
  if (new Set(ids).size !== ids.length) return fail(`${path}.duplicateGeneration`)
  return Object.freeze({
    id,
    revision: integer(input.revision, `${path}.revision`),
    active,
    previous,
    pending,
    enabled,
    tombstone,
    startAttempt,
    diagnostics: diagnostics(input.diagnostics, `${path}.diagnostics`),
    dataRoot: nativePath(input.dataRoot, `${path}.dataRoot`),
    storageRoot: nativePath(input.storageRoot, `${path}.storageRoot`),
  })
}

/** Fail closed as a whole: never publish the valid prefix of a malformed native response. */
export function parsePluginCatalogSnapshot(value: unknown): PluginCatalogSnapshot {
  const input = object(value, '$')
  if (input.version !== 1 || !Array.isArray(input.entries) || input.entries.length > 512)
    return fail('$.version/entries')
  const entries = input.entries.map((item, index) => entry(item, `$.entries[${index}]`))
  if (new Set(entries.map((item) => item.id)).size !== entries.length) return fail('$.duplicateIds')
  return Object.freeze({
    version: 1,
    revision: integer(input.revision, '$.revision'),
    entries: Object.freeze(entries),
    diagnostics: diagnostics(input.diagnostics, '$.diagnostics'),
    migrationReceipt:
      input.migrationReceipt === null ? null : string(input.migrationReceipt, '$.migrationReceipt'),
  })
}

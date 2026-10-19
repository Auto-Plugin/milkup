import {
  parsePluginManifest,
  type PluginHostKind,
  type PluginRegistryRecord,
  type PluginRegistrySnapshot,
} from '@milkup/plugin'
import {
  parsePluginCatalogSnapshot,
  type DesktopPluginCatalog,
  type PluginCatalogEntry,
  type PluginCatalogMigrationRecord,
  type PluginCatalogMigrationValidation,
  type PluginCatalogSnapshot,
} from './plugin-catalog-contract'

export type PluginCatalogInvoke = (
  command: string,
  args?: Record<string, unknown>,
) => Promise<unknown>

/** Only native results authorize state; legacy bytes are backup/migration input, never fallback. */
export function createDesktopPluginCatalog(invoke: PluginCatalogInvoke): DesktopPluginCatalog {
  return Object.freeze({
    async read() {
      return parsePluginCatalogSnapshot(await invoke('plugin_catalog_read'))
    },
    async prepare(request) {
      return parsePluginCatalogSnapshot(
        await invoke('plugin_catalog_prepare', {
          archive: request.archive,
          sourcePath: request.sourcePath,
          expectedRevision: request.expectedRevision,
        }),
      )
    },
    async transition(pluginId, expectedRevision, action) {
      return parsePluginCatalogSnapshot(
        await invoke('plugin_catalog_transition', { pluginId, expectedRevision, action }),
      )
    },
    async migrateLegacy(legacyRaw) {
      // Do not normalize, discard invalid rows, or overwrite legacy storage before native backup.
      const inspected = inspectLegacyPluginRegistry(legacyRaw)
      const digest = new Uint8Array(
        await crypto.subtle.digest('SHA-256', new TextEncoder().encode(legacyRaw)),
      )
      const validation: PluginCatalogMigrationValidation = Object.freeze({
        version: 1,
        rawSha256: [...digest].map((value) => value.toString(16).padStart(2, '0')).join(''),
        records: inspected.validatedRecords,
        diagnostics: Object.freeze(
          inspected.diagnostics
            .slice(0, 128)
            .map((message) => [...message].slice(0, 1024).join('')),
        ),
      })
      return parsePluginCatalogSnapshot(
        await invoke('plugin_catalog_migrate', { legacyRaw, validation }),
      )
    },
  } satisfies DesktopPluginCatalog)
}

/** Pending manifests must be displayed separately; they never inherit active approval. */
export function catalogEntryToRegistryRecord(
  entry: PluginCatalogEntry,
): PluginRegistryRecord | undefined {
  if (entry.tombstone || !entry.active) return undefined
  const active = entry.active
  const approved = active.approvedFingerprint === active.capabilityFingerprint
  return Object.freeze({
    manifest: active.manifest,
    manifestPath: `${active.packageRoot.replace(/[\\/]$/, '')}/plugin.json`,
    rootPath: active.packageRoot,
    sourcePath: active.sourcePath,
    // Native intent is not proof that a runtime has been published. The manager marks its
    // live in-memory record enabled only after startupComplete/commit and publication.
    enabled: false,
    state: entry.diagnostics.length ? 'failed' : 'disabled',
    installedAt: 0,
    updatedAt: entry.revision,
    trust: 'untrusted',
    dataRoot: entry.dataRoot,
    storageRoot: entry.storageRoot,
    approvals: Object.freeze({
      permissions: Object.freeze(approved ? [...(active.manifest.permissions ?? [])] : []),
      hosts: Object.freeze(
        approved ? [active.manifest.host ?? 'worker'] : [],
      ) as readonly PluginHostKind[],
      networkOrigins: Object.freeze(approved ? [...(active.manifest.networkOrigins ?? [])] : []),
    }),
    errors: Object.freeze([...entry.diagnostics]),
  })
}

export function catalogToRegistrySnapshot(snapshot: PluginCatalogSnapshot): PluginRegistrySnapshot {
  return Object.freeze({
    version: 1,
    records: Object.freeze(
      snapshot.entries.flatMap((entry) => {
        const record = catalogEntryToRegistryRecord(entry)
        return record ? [record] : []
      }),
    ),
  })
}

export interface LegacyPluginRegistryInspection {
  /** Exact original text, including malformed/unknown content, for native recoverable backup. */
  readonly raw: string
  /** Structurally valid hints only. No historical approval is carried forward. */
  readonly records: readonly PluginRegistryRecord[]
  readonly validatedRecords: readonly PluginCatalogMigrationRecord[]
  readonly diagnostics: readonly string[]
}

/** Inspection assists diagnostics; native independently validates files and performs one commit. */
export function inspectLegacyPluginRegistry(raw: string): LegacyPluginRegistryInspection {
  const messages: string[] = []
  const validatedRecords: PluginCatalogMigrationRecord[] = []
  const finish = (records: readonly PluginRegistryRecord[]): LegacyPluginRegistryInspection =>
    Object.freeze({
      raw,
      records: Object.freeze([...records]),
      validatedRecords: Object.freeze([...validatedRecords]),
      diagnostics: Object.freeze(messages),
    })
  let root: Record<string, unknown>
  try {
    if (new TextEncoder().encode(raw).byteLength > 16 * 1024 * 1024)
      throw new Error('legacy registry exceeds 16 MiB')
    root = record(JSON.parse(raw))
    if (root.version !== 1 || !Array.isArray(root.records) || root.records.length > 512)
      throw new Error('invalid legacy version or records')
    if (root.auditRecords !== undefined && !Array.isArray(root.auditRecords))
      throw new Error('invalid legacy audit records')
  } catch (error) {
    messages.push(`Legacy registry quarantined: ${message(error)}`)
    return finish([])
  }
  const items = root.records as unknown[]
  const idCounts = new Map<string, number>()
  // Count even invalid duplicate rows, so a malformed row cannot authorize its valid sibling.
  for (const item of items) {
    const id = peekId(item)
    if (id) idCounts.set(id, (idCounts.get(id) ?? 0) + 1)
  }
  const records: PluginRegistryRecord[] = []
  for (let index = 0; index < items.length; index++) {
    try {
      const value = record(items[index])
      const manifest = parsePluginManifest(value.manifest)
      if (idCounts.get(manifest.id) !== 1) throw new Error(`duplicate plugin ID ${manifest.id}`)
      const manifestPath = path(value.manifestPath)
      const rootPath = path(value.rootPath)
      const sourcePath = text(value.sourcePath)
      const dataRoot = path(value.dataRoot)
      const storageRoot = path(value.storageRoot)
      const installedAt = timestamp(value.installedAt)
      const updatedAt = timestamp(value.updatedAt)
      if (
        !['installed', 'enabled', 'disabled', 'failed'].includes(String(value.state)) ||
        typeof value.enabled !== 'boolean'
      )
        throw new Error('invalid install state')
      if (!['development', 'trusted', 'untrusted'].includes(String(value.trust)))
        throw new Error('invalid trust state')
      if (value.enabled !== (value.state === 'enabled'))
        throw new Error('inconsistent enabled state')
      const errors = strings(value.errors)
      const approvals = record(value.approvals)
      const approvedPermissions = strings(approvals.permissions)
      const hosts = strings(approvals.hosts)
      const origins =
        approvals.networkOrigins === undefined ? [] : strings(approvals.networkOrigins)
      if (
        new Set(approvedPermissions).size !== approvedPermissions.length ||
        new Set(hosts).size !== hosts.length ||
        approvedPermissions.some(
          (permission) => !manifest.permissions?.includes(permission as never),
        ) ||
        hosts.some((host) => host !== (manifest.host ?? 'worker')) ||
        new Set(origins).size !== origins.length ||
        origins.some((origin) => !manifest.networkOrigins?.includes(origin))
      )
        throw new Error('invalid legacy approval scope')
      if (value.runtimeFailure !== undefined) {
        const failure = record(value.runtimeFailure)
        if (failure.kind !== 'renderer-timeout' && failure.kind !== 'execution-host')
          throw new Error('invalid runtime failure')
        text(failure.message)
      }
      // Old approvals omit network origin scope and a verified content fingerprint. Even
      // syntactically valid approval arrays cannot grant a migrated generation authority.
      records.push(
        Object.freeze({
          manifest,
          manifestPath,
          rootPath,
          sourcePath,
          dataRoot,
          storageRoot,
          installedAt,
          updatedAt,
          trust: 'untrusted',
          enabled: false,
          state: 'disabled',
          approvals: Object.freeze({
            permissions: Object.freeze([]),
            hosts: Object.freeze([]),
            networkOrigins: Object.freeze([]),
          }),
          errors: Object.freeze(errors),
        }),
      )
      // The parser normalizes optional fields. Native binds the hint to the raw
      // JSON and installed manifest, so retain the validated original object.
      validatedRecords.push(
        Object.freeze({ index, manifest: Object.freeze(record(value.manifest)) }),
      )
      messages.push(
        `Legacy plugin ${manifest.id}: native content validation and scoped approval required`,
      )
    } catch (error) {
      messages.push(`Legacy record ${index} quarantined: ${message(error)}`)
    }
  }
  return finish(records)
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('expected object')
  return value as Record<string, unknown>
}
function text(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > 65536 || value.includes('\0'))
    throw new Error('invalid string')
  return value
}
function path(value: unknown): string {
  const result = text(value)
  const normalized = result.replace(/\\/g, '/')
  if (
    !/^(?:\/|[A-Za-z]:\/)/.test(normalized) ||
    normalized.split('/').some((part) => part === '.' || part === '..') ||
    /[\u0000-\u001f]/.test(normalized)
  )
    throw new Error('invalid absolute path')
  return result
}
function timestamp(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
    throw new Error('invalid timestamp')
  return value
}
function strings(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 2048) throw new Error('invalid string array')
  return value.map(text)
}
function peekId(value: unknown): string | undefined {
  try {
    const id = record(record(value).manifest).id
    return typeof id === 'string' ? id : undefined
  } catch {
    return undefined
  }
}
function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

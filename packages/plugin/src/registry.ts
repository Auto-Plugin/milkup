import type { ActionDefinition } from '@milkup/core'

import {
  parsePluginManifest,
  type PluginHostKind,
  type PluginKeymapContribution,
  type PluginManifest,
  type PluginMarkdownSyntaxContribution,
  type PluginPermission,
  type PluginRendererContribution,
  type PluginUiContribution,
} from './manifest'

export type PluginInstallState = 'installed' | 'enabled' | 'disabled' | 'failed'
export type PluginTrustState = 'development' | 'trusted' | 'untrusted'
export type PluginAuditOperation =
  | 'install'
  | 'enable'
  | 'disable'
  | 'reload'
  | 'remove'
  | 'file'
  | 'network'
  | 'storage'
  | 'sidecar'
  | 'approval'

export interface PluginPackageDescriptor {
  readonly manifest: unknown
  readonly manifestPath: string
  readonly rootPath?: string
  readonly sourcePath?: string
  readonly installedAt?: number
  readonly trust?: PluginTrustState
}

export interface PluginRegistryRecord {
  readonly manifest: PluginManifest
  readonly manifestPath: string
  readonly rootPath: string
  readonly sourcePath: string
  readonly state: PluginInstallState
  readonly enabled: boolean
  readonly installedAt: number
  readonly updatedAt: number
  readonly trust: PluginTrustState
  readonly dataRoot: string
  readonly storageRoot: string
  readonly approvals: PluginApprovalState
  readonly errors: readonly string[]
}

export interface PluginApprovalState {
  readonly permissions: readonly string[]
  readonly hosts: readonly PluginHostKind[]
}

export interface PluginRegistrySnapshot {
  readonly version: 1
  readonly records: readonly PluginRegistryRecord[]
  readonly auditRecords?: readonly PluginAuditRecord[]
}

export interface PluginCompatibilityTarget {
  readonly milkupVersion: string
  readonly pluginSdkVersion: string
}

export interface PluginRegistryOptions {
  readonly now?: () => number
  readonly dataRoot?: string
  readonly storageRoot?: string
  readonly allowedHosts?: readonly PluginHostKind[]
  readonly compatibility?: PluginCompatibilityTarget
}

export interface PluginAuditRecord {
  readonly pluginId: string
  readonly operation: PluginAuditOperation
  readonly at: number
  readonly detail?: string
  readonly denied?: boolean
}

export interface PluginStorageHost {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export interface PluginScopedStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export interface PluginKeymapBinding {
  readonly pluginId: string
  readonly command: string
  readonly key: string
  readonly when?: string
  readonly status: 'active' | 'shadowed' | 'invalid'
  readonly conflictWith?: string
}

export interface PluginContributionIndex {
  readonly commands: readonly ActionDefinition[]
  readonly keymaps: readonly PluginKeymapBinding[]
  readonly renderers: readonly PluginRendererBinding[]
  readonly markdownSyntax: readonly PluginSyntaxBinding[]
  readonly ui: readonly PluginUiBinding[]
  readonly importers: readonly PluginImporterBinding[]
  readonly documentTypes: readonly PluginDocumentTypeBinding[]
}

export interface PluginRendererBinding extends PluginRendererContribution {
  readonly pluginId: string
}

export interface PluginSyntaxBinding extends PluginMarkdownSyntaxContribution {
  readonly pluginId: string
}

export interface PluginUiBinding extends PluginUiContribution {
  readonly pluginId: string
}

export interface PluginImporterBinding {
  readonly pluginId: string
  readonly id: string
  readonly title: string
  readonly extensions: readonly string[]
  readonly mimeTypes?: readonly string[]
  readonly target: 'markdown' | 'custom-view'
}

export interface PluginDocumentTypeBinding {
  readonly pluginId: string
  readonly id: string
  readonly title: string
  readonly extensions: readonly string[]
  readonly readonly?: boolean
}

const defaultNow = () => Date.now()
const snapshotVersion = 1

export class PluginRegistry {
  private readonly records = new Map<string, PluginRegistryRecord>()
  private readonly auditRecords: PluginAuditRecord[] = []
  private readonly now: () => number
  private readonly dataRoot: string
  private readonly storageRoot: string
  private readonly allowedHosts: readonly PluginHostKind[]
  private readonly compatibility: PluginCompatibilityTarget | undefined

  constructor(options: PluginRegistryOptions = {}) {
    this.now = options.now ?? defaultNow
    this.dataRoot = normalizeRoot(options.dataRoot ?? 'milkup://plugin-data')
    this.storageRoot = normalizeRoot(options.storageRoot ?? 'milkup://plugin-storage')
    this.allowedHosts = Object.freeze([...(options.allowedHosts ?? ['worker'])])
    this.compatibility = options.compatibility
  }

  installLocalPlugin(descriptor: PluginPackageDescriptor): PluginRegistryRecord {
    const manifest = parsePluginManifest(descriptor.manifest)
    const rootPath = descriptor.rootPath ?? directoryOf(descriptor.manifestPath)
    const sourcePath = descriptor.sourcePath ?? descriptor.manifestPath
    const installedAt = descriptor.installedAt ?? this.now()
    const existing = this.records.get(manifest.id)
    const errors = validateCompatibility(manifest, this.compatibility)
    const host = manifest.host ?? 'worker'

    const record = freezeRecord({
      manifest,
      manifestPath: descriptor.manifestPath,
      rootPath,
      sourcePath,
      state:
        existing?.enabled && errors.length === 0
          ? 'enabled'
          : errors.length
            ? 'failed'
            : 'disabled',
      enabled: existing?.enabled === true && errors.length === 0,
      installedAt: existing?.installedAt ?? installedAt,
      updatedAt: this.now(),
      trust: descriptor.trust ?? existing?.trust ?? 'development',
      dataRoot: pluginScopedPath(this.dataRoot, manifest.id),
      storageRoot: pluginScopedPath(this.storageRoot, manifest.id),
      approvals: Object.freeze({
        permissions: Object.freeze(
          (existing?.approvals.permissions ?? []).filter((permission) =>
            manifest.permissions?.includes(permission as PluginPermission),
          ),
        ),
        hosts: Object.freeze(
          host === 'worker' || existing?.approvals.hosts.includes(host) ? [host] : [],
        ),
      }),
      errors: Object.freeze(errors),
    })

    this.records.set(manifest.id, record)
    this.recordAudit(manifest.id, 'install', errors.join('; ') || undefined, errors.length > 0)
    return record
  }

  restore(snapshot: PluginRegistrySnapshot): void {
    this.records.clear()
    this.auditRecords.length = 0

    if (snapshot.version !== snapshotVersion) {
      throw new Error(`Unsupported plugin registry snapshot: ${snapshot.version}`)
    }

    for (const record of snapshot.records) {
      const manifest = parsePluginManifest(record.manifest)
      this.records.set(
        manifest.id,
        freezeRecord({
          ...record,
          manifest,
          enabled: record.enabled && record.state === 'enabled',
        }),
      )
    }

    for (const audit of snapshot.auditRecords ?? []) {
      this.auditRecords.push(Object.freeze({ ...audit }))
    }
  }

  snapshot(): PluginRegistrySnapshot {
    return Object.freeze({
      version: snapshotVersion,
      records: Object.freeze([...this.records.values()].map(cloneRecord)),
      auditRecords: Object.freeze(this.auditRecords.map((record) => Object.freeze({ ...record }))),
    })
  }

  list(): readonly PluginRegistryRecord[] {
    return Object.freeze([...this.records.values()].map(cloneRecord))
  }

  get(pluginId: string): PluginRegistryRecord | undefined {
    const record = this.records.get(pluginId)
    return record ? cloneRecord(record) : undefined
  }

  markEnabled(pluginId: string): PluginRegistryRecord {
    const record = this.require(pluginId)
    const next = freezeRecord({
      ...record,
      enabled: true,
      state: 'enabled',
      updatedAt: this.now(),
      errors: Object.freeze([]),
    })
    this.records.set(pluginId, next)
    this.recordAudit(pluginId, 'enable')
    return next
  }

  markDisabled(pluginId: string): PluginRegistryRecord {
    const record = this.require(pluginId)
    const next = freezeRecord({
      ...record,
      enabled: false,
      state: 'disabled',
      updatedAt: this.now(),
    })
    this.records.set(pluginId, next)
    this.recordAudit(pluginId, 'disable')
    return next
  }

  markFailed(pluginId: string, error: unknown): PluginRegistryRecord {
    const record = this.require(pluginId)
    const message = error instanceof Error ? error.message : String(error)
    const next = freezeRecord({
      ...record,
      enabled: false,
      state: 'failed',
      updatedAt: this.now(),
      errors: Object.freeze([...record.errors, message]),
    })
    this.records.set(pluginId, next)
    this.recordAudit(pluginId, 'enable', message, true)
    return next
  }

  approve(pluginId: string): PluginRegistryRecord {
    const record = this.require(pluginId)
    const host = record.manifest.host ?? 'worker'
    const next = freezeRecord({
      ...record,
      approvals: Object.freeze({
        permissions: Object.freeze([...(record.manifest.permissions ?? [])]),
        hosts: Object.freeze([host]),
      }),
      enabled: false,
      state: 'disabled',
      errors: Object.freeze(
        record.errors.filter((error) => !error.startsWith('Plugin capabilities require approval:')),
      ),
      updatedAt: this.now(),
    })
    this.records.set(pluginId, next)
    this.recordAudit(pluginId, 'approval', 'approved')
    return next
  }

  revokeApproval(pluginId: string): PluginRegistryRecord {
    const record = this.require(pluginId)
    const host = record.manifest.host ?? 'worker'
    const next = freezeRecord({
      ...record,
      enabled: false,
      state: 'disabled',
      approvals: Object.freeze({
        permissions: Object.freeze([]),
        hosts: Object.freeze(host === 'worker' ? (['worker'] as const) : []),
      }),
      updatedAt: this.now(),
    })
    this.records.set(pluginId, next)
    this.recordAudit(pluginId, 'approval', 'revoked')
    return next
  }

  setRoots(
    pluginId: string,
    roots: { readonly rootPath?: string; readonly dataRoot: string; readonly storageRoot: string },
  ): PluginRegistryRecord {
    const record = this.require(pluginId)
    const next = freezeRecord({
      ...record,
      ...(roots.rootPath ? { rootPath: roots.rootPath } : {}),
      dataRoot: roots.dataRoot,
      storageRoot: roots.storageRoot,
      updatedAt: this.now(),
    })
    this.records.set(pluginId, next)
    return next
  }

  remove(pluginId: string): PluginRegistryRecord | undefined {
    const record = this.records.get(pluginId)
    this.records.delete(pluginId)

    if (record) {
      this.recordAudit(pluginId, 'remove')
      return cloneRecord(record)
    }

    return undefined
  }

  recordAudit(
    pluginId: string,
    operation: PluginAuditOperation,
    detail?: string,
    denied = false,
  ): void {
    this.auditRecords.push(
      Object.freeze({
        pluginId,
        operation,
        at: this.now(),
        ...(detail ? { detail } : {}),
        ...(denied ? { denied: true } : {}),
      }),
    )
  }

  auditLog(): readonly PluginAuditRecord[] {
    return Object.freeze([...this.auditRecords])
  }

  private require(pluginId: string): PluginRegistryRecord {
    const record = this.records.get(pluginId)

    if (!record) {
      throw new Error(`Unknown plugin registry record: ${pluginId}`)
    }

    return record
  }
}

export function createPluginScopedStorage(
  pluginId: string,
  host: PluginStorageHost,
): PluginScopedStorage {
  const prefix = `milkup.plugin.storage.${pluginId}.`

  return Object.freeze({
    getItem: (key: string) => host.getItem(prefix + key),
    setItem: (key: string, value: string) => {
      host.setItem(prefix + key, value)
    },
    removeItem: (key: string) => {
      host.removeItem(prefix + key)
    },
  })
}

export function createPluginContributionIndex(
  records: readonly PluginRegistryRecord[],
  actions: readonly ActionDefinition[] = [],
): PluginContributionIndex {
  const enabled = records.filter((record) => record.enabled && record.state === 'enabled')
  const pluginCommandIds = new Set(
    enabled.flatMap((record) =>
      (record.manifest.contributes?.commands ?? []).map((command) => command.action),
    ),
  )

  return Object.freeze({
    commands: Object.freeze(actions.filter((action) => pluginCommandIds.has(action.id))),
    keymaps: Object.freeze(resolvePluginKeymaps(enabled, actions)),
    renderers: Object.freeze(
      enabled.flatMap((record) =>
        (record.manifest.contributes?.renderers ?? []).map((renderer) =>
          Object.freeze({ ...renderer, pluginId: record.manifest.id }),
        ),
      ),
    ),
    markdownSyntax: Object.freeze(
      enabled.flatMap((record) =>
        (record.manifest.contributes?.markdownSyntax ?? []).map((syntax) =>
          Object.freeze({ ...syntax, pluginId: record.manifest.id }),
        ),
      ),
    ),
    ui: Object.freeze(
      enabled.flatMap((record) =>
        (record.manifest.contributes?.ui ?? []).map((ui) =>
          Object.freeze({ ...ui, pluginId: record.manifest.id }),
        ),
      ),
    ),
    importers: Object.freeze(
      enabled.flatMap((record) =>
        (record.manifest.contributes?.importers ?? []).map((importer) =>
          Object.freeze({ ...importer, pluginId: record.manifest.id }),
        ),
      ),
    ),
    documentTypes: Object.freeze(
      enabled.flatMap((record) =>
        (record.manifest.contributes?.documentTypes ?? []).map((documentType) =>
          Object.freeze({ ...documentType, pluginId: record.manifest.id }),
        ),
      ),
    ),
  })
}

export function serializePluginRegistry(registry: PluginRegistry): string {
  return JSON.stringify(registry.snapshot())
}

export function parsePluginRegistrySnapshot(text: string): PluginRegistrySnapshot {
  const value = JSON.parse(text) as PluginRegistrySnapshot

  if (value.version !== snapshotVersion || !Array.isArray(value.records)) {
    throw new Error('Invalid plugin registry snapshot')
  }

  return value
}

function resolvePluginKeymaps(
  records: readonly PluginRegistryRecord[],
  actions: readonly ActionDefinition[],
): readonly PluginKeymapBinding[] {
  const actionsById = new Set(actions.map((action) => action.id))
  const claimed = new Map<string, string>()
  const bindings: PluginKeymapBinding[] = []

  for (const record of records) {
    for (const keymap of record.manifest.contributes?.keymaps ?? []) {
      bindings.push(resolvePluginKeymap(record.manifest.id, keymap, actionsById, claimed))
    }
  }

  return bindings
}

function resolvePluginKeymap(
  pluginId: string,
  keymap: PluginKeymapContribution,
  actionsById: ReadonlySet<string>,
  claimed: Map<string, string>,
): PluginKeymapBinding {
  const normalizedKey = normalizeKeymap(keymap.key)
  const conflictKey = `${normalizedKey}|${keymap.when ?? ''}`
  const conflictWith = claimed.get(conflictKey)

  if (!actionsById.has(keymap.command)) {
    return Object.freeze({
      pluginId,
      command: keymap.command,
      key: normalizedKey,
      ...(keymap.when ? { when: keymap.when } : {}),
      status: 'invalid',
    })
  }

  if (conflictWith) {
    return Object.freeze({
      pluginId,
      command: keymap.command,
      key: normalizedKey,
      ...(keymap.when ? { when: keymap.when } : {}),
      status: 'shadowed',
      conflictWith,
    })
  }

  claimed.set(conflictKey, keymap.command)
  return Object.freeze({
    pluginId,
    command: keymap.command,
    key: normalizedKey,
    ...(keymap.when ? { when: keymap.when } : {}),
    status: 'active',
  })
}

function validateCompatibility(
  manifest: PluginManifest,
  compatibility: PluginCompatibilityTarget | undefined,
): string[] {
  if (!compatibility || !manifest.engines) {
    return []
  }

  const errors: string[] = []

  if (
    manifest.engines.milkup &&
    !isCompatibleVersionRange(manifest.engines.milkup, compatibility.milkupVersion)
  ) {
    errors.push(`Requires Milkup ${manifest.engines.milkup}`)
  }

  if (
    manifest.engines.pluginSdk &&
    !isCompatibleVersionRange(manifest.engines.pluginSdk, compatibility.pluginSdkVersion)
  ) {
    errors.push(`Requires plugin SDK ${manifest.engines.pluginSdk}`)
  }

  return errors
}

function isCompatibleVersionRange(range: string, version: string): boolean {
  if (range === '*' || range === version) {
    return true
  }

  if (range.startsWith('^')) {
    return majorOf(range.slice(1)) === majorOf(version)
  }

  if (range.startsWith('>=')) {
    return compareVersions(version, range.slice(2)) >= 0
  }

  return false
}

function compareVersions(left: string, right: string): number {
  const leftParts = versionParts(left)
  const rightParts = versionParts(right)

  for (let index = 0; index < 3; index += 1) {
    const delta = (leftParts[index] ?? 0) - (rightParts[index] ?? 0)

    if (delta !== 0) {
      return delta
    }
  }

  return 0
}

function versionParts(version: string): readonly [number, number, number] {
  const stableVersion = version.split(/[+-]/, 1)[0] ?? ''
  const [major = '0', minor = '0', patch = '0'] = stableVersion.split('.')
  return [Number(major) || 0, Number(minor) || 0, Number(patch) || 0]
}

function majorOf(version: string): number {
  return versionParts(version)[0]
}

function normalizeKeymap(key: string): string {
  return key
    .split('+')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const lower = part.toLowerCase()

      if (lower === 'cmd' || lower === 'command' || lower === 'ctrl' || lower === 'control') {
        return 'Mod'
      }

      if (lower === 'shift') {
        return 'Shift'
      }

      if (lower === 'alt' || lower === 'option') {
        return 'Alt'
      }

      return part.length === 1 ? part.toUpperCase() : part
    })
    .join('+')
}

function directoryOf(path: string): string {
  const normalized = path.replace(/\\/g, '/')
  const index = normalized.lastIndexOf('/')
  return index >= 0 ? normalized.slice(0, index) : '.'
}

function normalizeRoot(path: string): string {
  return path.endsWith('/') ? path.slice(0, -1) : path
}

function pluginScopedPath(root: string, pluginId: string): string {
  return `${normalizeRoot(root)}/${encodeURIComponent(pluginId)}`
}

function cloneRecord(record: PluginRegistryRecord): PluginRegistryRecord {
  return freezeRecord({
    ...record,
    approvals: Object.freeze({
      permissions: Object.freeze([...record.approvals.permissions]),
      hosts: Object.freeze([...record.approvals.hosts]),
    }),
    errors: Object.freeze([...record.errors]),
  })
}

function freezeRecord(record: PluginRegistryRecord): PluginRegistryRecord {
  return Object.freeze({
    ...record,
    approvals: Object.freeze(record.approvals),
    errors: Object.freeze([...record.errors]),
  })
}

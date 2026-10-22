import {
  ArrowLeft,
  Download,
  Ellipsis,
  Info,
  PackagePlus,
  RotateCw,
  Settings2,
  Terminal,
  Trash2,
} from 'lucide'
import { iconSvg } from './icons'
import type {
  ActionContext,
  ActionDefinition,
  ActionInputSchema,
  ActionPermission,
  ActionRegistry,
  DocumentPresentationRequest,
  DocumentPresentationResult,
} from '@milkup/core'
import {
  createBrowserWorkerPluginHost,
  createPluginManagementBroker,
  projectPluginManagementMetadata,
  copyPluginManagementDetails,
  PluginManagementError,
  type PluginManagementSnapshot,
  type PluginManagementIdentity,
  type PluginManagementDetails,
  type PluginManagementHostViewRequest,
  type PluginManagementHostViewResult,
  type PluginManagementOperationContext,
  type RevocablePluginManagementBroker,
  createSupervisedPluginWorkerEndpoint,
  createPluginDocumentBroker,
  createIsolatedPluginModule,
  createPluginUiBroker,
  createPluginReleasesBroker,
  createPluginWorkspaceBroker,
  createPluginSettingsBroker,
  createPluginKeymapBroker,
  createPluginEditingBroker,
  createPluginResourcesBroker,
  createPluginOutputBroker,
  type PluginOutputBrokerAdapter,
  type RevocablePluginOutputBroker,
  type PluginEditingBrokerAdapter,
  type PluginResourcesBrokerAdapter,
  type RevocablePluginEditingBroker,
  type RevocablePluginResourcesBroker,
  type PluginUiNotice,
  type PluginKeymapHost,
  type PluginSettingsBrokerAdapter,
  type RevocablePluginSettingsBroker,
  type PluginWorkspaceBrokerAdapter,
  type RevocablePluginWorkspaceBroker,
  type PluginReleasesBrokerAdapter,
  type RevocablePluginReleasesBroker,
  createPluginNetworkBroker,
  createPluginStorageBroker,
  createPluginPackageArchive,
  createPluginContributionIndex,
  isPluginPackageArchive,
  normalizePackagePath,
  parsePluginManifest,
  parsePluginPackageArchive,
  parsePluginRegistrySnapshot,
  PluginRegistry,
  PluginRuntime,
  serializePluginPackageArchive,
  serializePluginRegistry,
  validatePluginCompatibility,
  type PluginCompatibilityTarget,
  type PluginContributionIndex,
  type ManagedPluginDocumentBroker,
  type ManagedPluginStorageBroker,
  type PluginManifest,
  type PluginModule,
  type PluginPackageArchive,
  type PluginPackageFile,
  type PluginRegistryRecord,
  type PluginDocumentScanSource,
  type PluginUiBroker,
  type PluginUiRevealLocationRequest,
  type PluginUiOperationContext,
} from '@milkup/plugin'

import { catalogEntryToRegistryRecord, catalogToRegistrySnapshot } from './desktop-plugin-catalog'
import type {
  DesktopPluginCatalog,
  PluginCatalogEntry,
  PluginCatalogGeneration,
  PluginCatalogSnapshot,
  PluginCatalogAction,
} from './plugin-catalog-contract'

import { createDesktopPluginWorker } from './plugin-worker-factory'
import { createDesktopPluginFileBroker } from './plugin-file-broker'
import {
  createDesktopTemporaryStorage,
  type DesktopTemporaryStorage,
} from './plugin-temporary-storage'

export interface DesktopPluginManifestHost {
  selectManifestPath(): Promise<string | undefined>
  readManifestText(path: string): Promise<string>
  /** Read only the installed, declared and bounded PNG icon for this plugin. */
  readPackageIcon?(pluginId: string): Promise<Uint8Array>
  prepareModule?(
    manifest: PluginManifest,
    manifestPath: string,
    main: string,
    generation?: { readonly generationId: string; readonly packageRoot: string },
  ): Promise<DesktopPreparedPluginModule>
  selectPackageExportPath?(suggestedName: string): Promise<string | undefined>
  writeText?(path: string, text: string): Promise<void>
  installPackage?(archive: PluginPackageArchive): Promise<DesktopInstalledPluginPackage>
  ensureDataDirectories?(pluginId: string): Promise<DesktopPluginDirectories>
  removeInstalledPackage?(pluginId: string): Promise<void>
}

export interface DesktopPluginDirectories {
  readonly dataRoot: string
  readonly storageRoot: string
  readonly packageRoot?: string
}

export interface DesktopInstalledPluginPackage extends DesktopPluginDirectories {
  readonly manifestPath: string
  readonly rootPath: string
}

export interface DesktopPreparedEntryPluginModule {
  readonly kind?: 'module'
  readonly specifier: string
  dispose?(): void | Promise<void>
  retryDispose?(): void | Promise<void>
}

export interface DesktopPreparedDomPluginModule {
  readonly kind: 'dom'
  /** Opaque native-issued lease; never a path, source string or URL. */
  readonly leaseId: string
  dispose?(): void | Promise<void>
  retryDispose?(): void | Promise<void>
}

export type DesktopPreparedPluginModule =
  DesktopPreparedEntryPluginModule | DesktopPreparedDomPluginModule

export interface DesktopLoadedPluginModule {
  readonly module: PluginModule
  dispose(): void | Promise<void>
  retryDispose?(): void | Promise<void>
}

export interface DesktopPluginModuleCapabilities {
  readonly restrictedActivation?: boolean
  readonly isActivationCommitted?: () => boolean
  readonly onActivationViolation?: (error: Error) => void
  readonly onDocumentRenderTimeout?: () => void
  readonly onIsolationError?: (error: Error) => void
  readonly editingBroker?: RevocablePluginEditingBroker
  readonly resourcesBroker?: RevocablePluginResourcesBroker
  readonly outputBroker?: RevocablePluginOutputBroker
  readonly documentBroker?: ManagedPluginDocumentBroker
  readonly keymapBroker?: ReturnType<typeof createPluginKeymapBroker>
  readonly settingsBroker?: RevocablePluginSettingsBroker
  readonly workspaceBroker?: RevocablePluginWorkspaceBroker
  readonly managementBroker?: RevocablePluginManagementBroker
  readonly releasesBroker?: RevocablePluginReleasesBroker
  readonly uiBroker?: PluginUiBroker
}

export type DesktopPluginModuleLoader = (
  manifest: PluginManifest,
  moduleSpecifier: string,
  capabilities?: DesktopPluginModuleCapabilities,
) => Promise<DesktopLoadedPluginModule>

export interface DesktopDomPluginModuleCapabilities {
  readonly onDocumentRenderTimeout: () => void
  readonly onIsolationError: (error: Error) => void
}

export type DesktopDomPluginModuleLoader = (
  manifest: PluginManifest,
  prepared: DesktopPreparedDomPluginModule,
  capabilities: DesktopDomPluginModuleCapabilities,
) => Promise<DesktopLoadedPluginModule>

export type DesktopPluginUiPhase = 'mount' | 'update' | 'focus' | 'blur' | 'dispose'

export type DesktopPluginDocumentResult =
  | {
      readonly kind: 'generated-markdown'
      readonly markdown: string
      readonly sourcePath: string
      readonly title: string
      readonly pluginId: string
      readonly contributionId: string
    }
  | {
      readonly kind: 'custom-view'
      readonly output: unknown
      readonly sourcePath: string
      readonly title: string
      readonly readonly: true
      readonly pluginId: string
      readonly contributionId: string
    }

export interface DesktopPluginInstallFailure {
  readonly sourcePath: string
  readonly message: string
  readonly at: number
}

export interface DesktopPluginKeymapContext {
  readonly editorFocus: boolean
  readonly documentOpen: boolean
  readonly sourceMode: boolean
  readonly liveMode: boolean
}

export interface DesktopPluginManagerOptions {
  readonly catalog?: DesktopPluginCatalog
  /** Host-owned built-ins cannot also run as plugins; retained catalog/data are never removed. */
  readonly reservedPluginIds?: readonly string[]
  /** Trusted platform capability check; undefined means the existing activation gates apply. */
  readonly executionUnavailableReason?: (manifest: PluginManifest) => string | undefined
  readonly requestManagementHostView?: (
    input: PluginManagementHostViewRequest,
    context: PluginManagementOperationContext,
  ) => Promise<PluginManagementHostViewResult>
  readonly actionRegistry: ActionRegistry
  readonly manifestHost: DesktopPluginManifestHost
  readonly permissions: readonly ActionPermission[]
  readonly milkupVersion: string
  readonly pluginSdkVersion: string
  readonly storage?: Storage
  readonly temporaryStorage?: DesktopTemporaryStorage
  readonly documentSource?: () => PluginDocumentScanSource | undefined
  readonly invalidateUi?: (pluginId: string, viewId?: string) => void | Promise<void>
  readonly revealLine?: (line: number) => void | Promise<void>
  readonly revealLocation?: (
    request: PluginUiRevealLocationRequest,
    context: PluginUiOperationContext,
  ) => void | Promise<void>
  readonly invalidatePresentation?: () => void
  readonly onDocumentRenderFailure?: (
    pluginId: string,
    kind?: 'renderer-timeout' | 'execution-host',
  ) => void
  readonly loadModule?: DesktopPluginModuleLoader
  readonly loadSidecarModule?: DesktopPluginModuleLoader
  readonly loadDomModule?: DesktopDomPluginModuleLoader
  readonly now?: () => number
  /** Distribution-provided packages; upgrades require an explicit card enable intent. */
  readonly bundledPackagePaths?: () => Promise<readonly string[]>
  /** Host-maintained exact receipts of prior distributions; never supplied by plugins. */
  readonly bundledUpgradeSources?: Readonly<Record<string, readonly string[]>>
  readonly editingAdapter?: (manifest: PluginManifest) => {
    adapter: PluginEditingBrokerAdapter
    dispose(): void | Promise<void>
  }
  readonly resourcesAdapter?: (manifest: PluginManifest) => {
    adapter: PluginResourcesBrokerAdapter
    dispose(): void | Promise<void>
  }
  readonly outputAdapter?: (manifest: PluginManifest) => {
    adapter: PluginOutputBrokerAdapter
    dispose(): void | Promise<void>
  }
  readonly openUi?: (pluginId: string, viewId: string) => void | Promise<void>
  readonly notifyUi?: (pluginId: string, notice: PluginUiNotice) => void | Promise<void>
  readonly keymapAdapter?: (manifest: PluginManifest) => PluginKeymapHost
  readonly settingsAdapter?: (manifest: PluginManifest) => {
    adapter: PluginSettingsBrokerAdapter
    dispose(): Promise<void>
  }
  readonly workspaceAdapter?: (pluginId: string) => {
    adapter: PluginWorkspaceBrokerAdapter
    dispose(): void
  }
  readonly releasesAdapter?: (pluginId: string) => {
    adapter: PluginReleasesBrokerAdapter
    dispose(): void
  }
}

export interface DesktopPluginManagerState {
  readonly catalogRevision?: number
  readonly executionUnavailableReasons?: Readonly<Record<string, string>>
  readonly bundledUpgradeOffers?: Readonly<Record<string, PluginManifest>>
  readonly catalogEntries?: readonly PluginCatalogEntry[]
  readonly diagnostics?: readonly string[]
  readonly records: readonly PluginRegistryRecord[]
  readonly contributions: PluginContributionIndex
  readonly auditCount: number
  readonly auditRecords: readonly import('@milkup/plugin').PluginAuditRecord[]
  readonly installFailures: readonly DesktopPluginInstallFailure[]
}

const registryStorageKey = 'milkup.desktop.plugins.registry.v1'
const failuresStorageKey = 'milkup.desktop.plugins.failures.v1'
const bundledStorageKey = 'milkup.desktop.plugins.bundled.v1'
const allowedHosts = Object.freeze(['worker', 'sidecar', 'dom'] as const)
const documentRendererTimeoutMessage =
  'Document renderer exceeded its execution deadline; manually enable to retry'
const executionHostFailureMessage = 'Plugin execution host failed; manually enable to retry'
const sensitivePermissions = new Set([
  'file:read',
  'file:write',
  'file:delete',
  'network:access',
  'app:control',
  'app:updates',
  'app:plugins',
  'workspace:read',
  'settings:write',
  'app:keymap',
  'images:import',
  'document:output',
])

/** Semver precedence, ignoring build metadata; invalid inputs never offer an update. */
function isNewerBundledVersion(next: string, prior: string): boolean {
  const parse = (value: string) => {
    const match =
      /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.exec(
        value,
      )
    if (!match) return undefined
    const pre = match[4]?.split('.')
    if (pre?.some((part) => /^\d+$/.test(part) && part.length > 1 && part[0] === '0'))
      return undefined
    return { core: match.slice(1, 4).map((value) => BigInt(value!)), pre }
  }
  const a = parse(next),
    b = parse(prior)
  if (!a || !b) return false
  for (let i = 0; i < 3; i++) {
    if (a.core[i] !== b.core[i]) return a.core[i]! > b.core[i]!
  }
  if (!a.pre || !b.pre) return !a.pre && !!b.pre
  for (let i = 0; i < Math.max(a.pre.length, b.pre.length); i++) {
    const left = a.pre[i],
      right = b.pre[i]
    if (left === right) continue
    if (left === undefined || right === undefined) return right === undefined
    const leftNumeric = /^\d+$/.test(left),
      rightNumeric = /^\d+$/.test(right)
    if (leftNumeric && rightNumeric) return BigInt(left) > BigInt(right)
    if (leftNumeric !== rightNumeric) return !leftNumeric
    return left > right
  }
  return false
}

export class ReservedPluginMigrationError extends Error {
  constructor(cause: unknown) {
    super('Built-in plugin migration did not complete; restart the application to retry', { cause })
    this.name = 'ReservedPluginMigrationError'
  }
}

export class DesktopPluginManager {
  private readonly catalog: DesktopPluginCatalog | undefined
  private readonly reservedPluginIds: ReadonlySet<string>
  private readonly hostPermissions: ReadonlySet<string>
  private readonly userEnableTasks = new Map<string, Promise<PluginRegistryRecord>>()
  private readonly bundledUpgradeIndex = new Map<
    string,
    { path: string; archive: PluginPackageArchive }
  >()
  private readonly ambiguousBundledIds = new Set<string>()
  private readonly bundledUpgradeSources: ReadonlyMap<string, ReadonlySet<string>>
  private readonly executionUnavailableReason: DesktopPluginManagerOptions['executionUnavailableReason']
  private catalogSnapshot: PluginCatalogSnapshot | undefined
  private readonly publishedGenerations = new Map<string, string>()
  private readonly executingRecords = new Map<string, PluginRegistryRecord>()
  private readonly activationGates = new Map<
    string,
    { readonly epoch: number; committed: boolean; violation?: Error }
  >()
  private readonly managerDiagnostics: string[] = []
  private readonly pendingRuntimeCleanup = new Map<
    string,
    { promise: Promise<import('@milkup/plugin').PluginRuntimeInfo>; before: number }
  >()
  private readonly revocationErrors = new Map<string, unknown[]>()
  private readonly retiringOperations = new Map<string, Array<() => unknown>>()
  private readonly managementBrokers = new Map<string, RevocablePluginManagementBroker>()
  private readonly requestManagementHostView: DesktopPluginManagerOptions['requestManagementHostView']
  private readonly registry: PluginRegistry
  private readonly compatibility: PluginCompatibilityTarget
  private readonly runtime: PluginRuntime
  private readonly manifestHost: DesktopPluginManifestHost
  private readonly storage: Storage | undefined
  private readonly documentSource: (() => PluginDocumentScanSource | undefined) | undefined
  private readonly invalidateUi:
    ((pluginId: string, viewId?: string) => void | Promise<void>) | undefined
  private readonly revealLine: ((line: number) => void | Promise<void>) | undefined
  private readonly revealLocation: DesktopPluginManagerOptions['revealLocation']
  private readonly invalidatePresentation: DesktopPluginManagerOptions['invalidatePresentation']
  private readonly onDocumentRenderFailure: DesktopPluginManagerOptions['onDocumentRenderFailure']
  private readonly loadModule: DesktopPluginModuleLoader
  private readonly loadSidecarModule: DesktopPluginModuleLoader
  private readonly loadDomModule: DesktopDomPluginModuleLoader
  private readonly loadedModules = new Map<string, DesktopLoadedPluginModule>()
  private readonly lifecycleTasks = new Map<string, Promise<void>>()
  private readonly activationEpochs = new Map<string, number>()
  private readonly uiBrokers = new Map<string, PluginUiBroker>()
  private readonly editingBrokers = new Map<string, RevocablePluginEditingBroker>()
  private readonly resourcesBrokers = new Map<string, RevocablePluginResourcesBroker>()
  private readonly outputBrokers = new Map<string, RevocablePluginOutputBroker>()
  private readonly outputServices = new Map<
    string,
    ReturnType<NonNullable<DesktopPluginManagerOptions['outputAdapter']>>
  >()
  private readonly outputAdapter: DesktopPluginManagerOptions['outputAdapter']
  private readonly editingServices = new Map<
    string,
    ReturnType<NonNullable<DesktopPluginManagerOptions['editingAdapter']>>
  >()
  private readonly resourcesServices = new Map<
    string,
    ReturnType<NonNullable<DesktopPluginManagerOptions['resourcesAdapter']>>
  >()
  private readonly editingAdapter: DesktopPluginManagerOptions['editingAdapter']
  private readonly resourcesAdapter: DesktopPluginManagerOptions['resourcesAdapter']
  private readonly openUi: DesktopPluginManagerOptions['openUi']
  private readonly notifyUi: DesktopPluginManagerOptions['notifyUi']
  private readonly keymapBrokers = new Map<string, ReturnType<typeof createPluginKeymapBroker>>()
  private readonly keymapAdapter: DesktopPluginManagerOptions['keymapAdapter']
  private readonly settingsBrokers = new Map<string, RevocablePluginSettingsBroker>()
  private readonly settingsServices = new Map<
    string,
    ReturnType<NonNullable<DesktopPluginManagerOptions['settingsAdapter']>>
  >()
  private readonly settingsAdapter: DesktopPluginManagerOptions['settingsAdapter']
  private readonly workspaceBrokers = new Map<string, RevocablePluginWorkspaceBroker>()
  private readonly workspaceAdapter: DesktopPluginManagerOptions['workspaceAdapter']
  private readonly releasesBrokers = new Map<string, RevocablePluginReleasesBroker>()
  private readonly releasesAdapter: DesktopPluginManagerOptions['releasesAdapter']
  private readonly documentBrokers = new Map<string, ManagedPluginDocumentBroker>()
  private readonly storageBrokers = new Map<string, ManagedPluginStorageBroker>()
  private readonly temporaryStorage: DesktopTemporaryStorage
  private temporaryStorageStopped = false
  private readonly preparedModules = new Map<string, DesktopPreparedPluginModule>()
  private readonly installFailures: DesktopPluginInstallFailure[] = []
  private readonly activeUi = new Map<string, Set<string>>()
  private readonly now: () => number
  readonly ready: Promise<void>

  constructor(options: DesktopPluginManagerOptions) {
    this.catalog = options.catalog
    this.reservedPluginIds = new Set(options.reservedPluginIds ?? [])
    this.bundledUpgradeSources = new Map(
      Object.entries(options.bundledUpgradeSources ?? {}).map(([id, sources]) => [
        id,
        new Set(sources),
      ]),
    )
    this.hostPermissions = new Set(options.permissions)
    this.executionUnavailableReason = options.executionUnavailableReason
    this.requestManagementHostView = options.requestManagementHostView
    this.editingAdapter = options.editingAdapter
    this.resourcesAdapter = options.resourcesAdapter
    this.outputAdapter = options.outputAdapter
    this.openUi = options.openUi
    this.notifyUi = options.notifyUi
    this.keymapAdapter = options.keymapAdapter
    this.settingsAdapter = options.settingsAdapter
    this.workspaceAdapter = options.workspaceAdapter
    this.releasesAdapter = options.releasesAdapter
    this.manifestHost = options.manifestHost
    this.storage = options.storage
    this.temporaryStorage = options.temporaryStorage ?? createDesktopTemporaryStorage()
    this.documentSource = options.documentSource
    this.invalidateUi = options.invalidateUi
    this.revealLine = options.revealLine
    this.revealLocation = options.revealLocation
    this.invalidatePresentation = options.invalidatePresentation
    this.onDocumentRenderFailure = options.onDocumentRenderFailure
    this.now = options.now ?? (() => Date.now())
    this.loadModule =
      options.loadModule ??
      ((manifest, specifier, capabilities) =>
        this.createWorkerModule(manifest, specifier, capabilities))
    this.loadSidecarModule =
      options.loadSidecarModule ??
      (async () => {
        throw new Error('Sidecar plugins are not available in this host')
      })
    this.loadDomModule =
      options.loadDomModule ??
      (async () => {
        throw new Error('DOM plugins are not available in this host')
      })
    this.compatibility = Object.freeze({
      milkupVersion: options.milkupVersion,
      pluginSdkVersion: options.pluginSdkVersion,
    })
    this.registry = new PluginRegistry({ allowedHosts, compatibility: this.compatibility })
    this.runtime = new PluginRuntime({
      actionRegistry: options.actionRegistry,
      allowedHosts,
      allowedPermissions: options.permissions,
      fileBroker: (manifest) =>
        manifest.host === 'dom' ? undefined : this.createFileBroker(manifest),
      documentBroker: (manifest) =>
        manifest.host === 'dom' ? undefined : this.getDocumentBroker(manifest),
      uiBroker: (manifest) => (manifest.host === 'dom' ? undefined : this.createUiBroker(manifest)),
      managementBroker: (manifest) => this.getManagementBroker(manifest),
      releasesBroker: (manifest) =>
        manifest.host === 'dom' ? undefined : this.getReleasesBroker(manifest),
      workspaceBroker: (manifest) =>
        manifest.host === 'dom' ? undefined : this.getWorkspaceBroker(manifest),
      settingsBroker: (manifest) =>
        manifest.host === 'dom' ? undefined : this.getSettingsBroker(manifest),
      editingBroker: (manifest) =>
        manifest.host === 'dom' ? undefined : this.getEditingBroker(manifest),
      resourcesBroker: (manifest) =>
        manifest.host === 'dom' ? undefined : this.getResourcesBroker(manifest),
      outputBroker: (manifest) =>
        manifest.host === 'dom' ? undefined : this.getOutputBroker(manifest),
      keymapBroker: (manifest) =>
        manifest.host === 'dom' ? undefined : this.getKeymapBroker(manifest),
      networkBroker: (manifest) =>
        manifest.host === 'dom' ? undefined : this.createNetworkBroker(manifest),
      storageBroker: (manifest) =>
        manifest.host === 'dom' ? undefined : this.createStorageBroker(manifest),
    })
    this.restoreFailures()
    if (this.catalog) this.ready = this.initializeCatalog(options.bundledPackagePaths)
    else {
      this.restore()
      this.ready = this.restoreEnabledPlugins().then(() =>
        this.installBundledPackages(options.bundledPackagePaths),
      )
    }
  }

  private capabilityRecord(pluginId: string): PluginRegistryRecord | undefined {
    return this.executingRecords.get(pluginId) ?? this.registry.get(pluginId)
  }
  private catalogEntry(pluginId: string): PluginCatalogEntry | undefined {
    return this.catalogSnapshot?.entries.find((e) => e.id === pluginId)
  }
  private requireCatalogEntry(pluginId: string): PluginCatalogEntry {
    const entry = this.catalogEntry(pluginId)
    if (!entry) throw new Error('Unknown native catalog plugin: ' + pluginId)
    return entry
  }
  private generationRecord(
    entry: PluginCatalogEntry,
    generation: PluginCatalogGeneration,
  ): PluginRegistryRecord {
    // Private candidate execution/readonly display projection; never installs pending as active.
    const projected = catalogEntryToRegistryRecord({
      ...entry,
      active: { ...generation, verified: true },
      tombstone: false,
      diagnostics: [],
    })
    if (!projected) throw new Error('Candidate projection unavailable')
    return projected
  }
  private requireDisplayRecord(pluginId: string): PluginRegistryRecord {
    const active = this.registry.get(pluginId)
    if (active) return active
    const entry = this.requireCatalogEntry(pluginId)
    if (entry.pending) return this.generationRecord(entry, entry.pending.generation)
    throw new Error('Plugin has no active or pending installation: ' + pluginId)
  }
  private applyCatalog(snapshot: PluginCatalogSnapshot): void {
    if (this.catalogSnapshot && snapshot.revision < this.catalogSnapshot.revision) return
    this.catalogSnapshot = snapshot
    const projected = catalogToRegistrySnapshot(snapshot)
    const records = projected.records
      .filter((record) => !this.reservedPluginIds.has(record.manifest.id))
      .map((record) => {
        const entry = snapshot.entries.find((e) => e.id === record.manifest.id)!
        const published =
          entry.enabled && entry.active?.id === this.publishedGenerations.get(entry.id)
        return published
          ? { ...record, state: 'enabled' as const, enabled: true, errors: [] }
          : record
      })
    this.registry.restore({ ...projected, records })
    this.persist()
  }
  private async catalogTransition(
    pluginId: string,
    action: PluginCatalogAction,
  ): Promise<PluginCatalogEntry> {
    if (!this.catalog) throw new Error('Native catalog unavailable')
    const entry = this.requireCatalogEntry(pluginId)
    this.applyCatalog(await this.catalog.transition(pluginId, entry.revision, action))
    return this.requireCatalogEntry(pluginId)
  }
  private async initializeCatalog(
    listPaths: DesktopPluginManagerOptions['bundledPackagePaths'],
  ): Promise<void> {
    let reservedMigrationComplete = this.reservedPluginIds.size === 0
    try {
      let snapshot = await this.catalog!.read()
      let legacy: string | null = null
      try {
        legacy = this.storage?.getItem(registryStorageKey) ?? null
      } catch (error) {
        this.managerDiagnostics.push('Legacy mirror unreadable: ' + String(error))
      }
      if (!snapshot.migrationReceipt && snapshot.entries.length === 0 && legacy)
        snapshot = await this.catalog!.migrateLegacy(legacy)
      this.applyCatalog(snapshot)
      // Complete host-owned migration before restoring any plugin execution epoch.
      for (const entry of snapshot.entries) {
        if (!this.reservedPluginIds.has(entry.id)) continue
        if (
          entry.enabled ||
          entry.startAttempt ||
          entry.pending?.phase === 'trial' ||
          [entry.active, entry.previous, entry.pending?.generation].some(
            (g) => g?.approvedFingerprint,
          )
        ) {
          await this.catalogTransition(entry.id, { type: 'revokeApproval' })
        }
      }
      reservedMigrationComplete = true
      for (const entry of snapshot.entries) {
        if (this.reservedPluginIds.has(entry.id)) continue
        if (entry.pending?.phase === 'trial') {
          await this.catalogTransition(entry.id, {
            type: 'failCandidate',
            message: 'Previous candidate trial did not complete; review before retry',
            transactionId: entry.pending.transactionId,
            fingerprint: entry.pending.generation.capabilityFingerprint,
          })
        }
        const current = this.requireCatalogEntry(entry.id)
        if (current.startAttempt && current.active) {
          await this.catalogTransition(entry.id, {
            type: 'markFailed',
            generationId: current.active.id,
            message: 'Previous plugin startup did not complete; review before retry',
          })
        } else if (current.enabled && current.active && !current.tombstone) {
          try {
            await this.runPluginLifecycle(entry.id, () =>
              this.enableCatalogInstance(entry.id, false),
            )
          } catch (error) {
            this.managerDiagnostics.push(String(error))
          }
        }
      }
      // Native entries/tombstones are the durable receipt, not a localStorage list.
      for (const path of (await listPaths?.()) ?? []) {
        try {
          const archive = parsePluginPackageArchive(
            parseManifestJson(await this.manifestHost.readManifestText(path), path),
          )
          if (this.reservedPluginIds.has(archive.manifest.id)) continue
          // Only the host's closed bundled list contributes offers; a sourcePath string
          // on an installed generation is an eligibility receipt, not package authentication.
          if (/^bundled:[A-Za-z0-9][A-Za-z0-9._-]*\.milkup-plugin$/.test(path)) {
            if (this.bundledUpgradeIndex.has(archive.manifest.id)) {
              this.ambiguousBundledIds.add(archive.manifest.id)
              this.bundledUpgradeIndex.delete(archive.manifest.id)
            } else if (!this.ambiguousBundledIds.has(archive.manifest.id)) {
              this.bundledUpgradeIndex.set(archive.manifest.id, { path, archive })
            }
          }
          const existing = this.catalogEntry(archive.manifest.id)
          // Repair pre-beta3 empty failed receipts; preserve installations and explicit removals.
          if (existing && (existing.active || existing.pending || existing.tombstone)) continue
          await this.installManifestPath(path)
        } catch (error) {
          this.recordInstallFailure(path, error)
        }
      }
    } catch (error) {
      this.managerDiagnostics.push('Native plugin catalog unavailable: ' + String(error))
      if (!reservedMigrationComplete) throw new ReservedPluginMigrationError(error)
    }
  }
  private publishCatalogInstance(
    pluginId: string,
    generation: PluginCatalogGeneration,
  ): PluginRegistryRecord {
    const gate = this.activationGates.get(pluginId)
    if (!gate) throw new Error('Activation epoch unavailable')
    // Native commit/startup persistence can outlive the isolated instance.
    // Never reopen a gate revoked while that response was in flight.
    if (gate.epoch !== this.activationEpochs.get(pluginId))
      throw new Error('Plugin activation was revoked')
    gate.committed = true
    try {
      this.runtime.publishPlugin(pluginId)
    } catch (error) {
      gate.committed = false
      throw error
    }
    this.executingRecords.delete(pluginId)
    this.publishedGenerations.set(pluginId, generation.id)
    const record = this.registry.markEnabled(pluginId)
    this.persist()
    return record
  }
  private async enableCatalogInstance(
    pluginId: string,
    allowCandidate = true,
  ): Promise<PluginRegistryRecord> {
    const entry = this.requireCatalogEntry(pluginId)
    if (entry.tombstone) throw new Error('Plugin is removed; reinstall explicitly')
    if (allowCandidate && entry.pending) return this.trialCandidate(pluginId)
    const active = entry.active
    if (!active || active.approvedFingerprint !== active.capabilityFingerprint)
      throw new Error('Exact active capabilities require approval')
    const compatibilityErrors = validatePluginCompatibility(active.manifest, this.compatibility)
    if (compatibilityErrors.length) {
      const error = new Error(compatibilityErrors.join('; '))
      await this.catalogTransition(pluginId, {
        type: 'markFailed',
        generationId: active.id,
        message: error.message,
      })
      throw error
    }
    const unavailable = this.executionUnavailableReason?.(active.manifest)
    if (unavailable) throw new Error(unavailable)
    // Only Worker and the native sealed, strictly read-only renderer profile support trial.
    if (!supportsRestrictedActivation(active.manifest))
      throw new Error('Restricted activation is not supported for this execution host')
    await this.unloadRuntimePlugin(pluginId)
    const starting = await this.catalogTransition(pluginId, {
      type: 'startupBegin',
      generationId: active.id,
    })
    try {
      await this.enablePluginInstance(pluginId, this.generationRecord(starting, active))
      if (!starting.startAttempt) throw new Error('Native startup attempt missing')
      await this.catalogTransition(pluginId, {
        type: 'startupComplete',
        attemptId: starting.startAttempt,
      })
      return this.publishCatalogInstance(pluginId, active)
    } catch (error) {
      try {
        await this.unloadRuntimePlugin(pluginId)
      } catch (cleanup) {
        this.managerDiagnostics.push(String(cleanup))
      }
      await this.catalogTransition(pluginId, {
        type: 'markFailed',
        generationId: active.id,
        message: String(error),
      })
      throw error
    }
  }
  private async trialCandidate(pluginId: string): Promise<PluginRegistryRecord> {
    const entry = this.requireCatalogEntry(pluginId),
      candidate = entry.pending
    if (!candidate) throw new Error('No candidate to validate')
    const generation = candidate.generation
    const compatibilityErrors = validatePluginCompatibility(generation.manifest, this.compatibility)
    if (compatibilityErrors.length) throw new Error(compatibilityErrors.join('; '))
    if (generation.approvedFingerprint !== generation.capabilityFingerprint)
      throw new Error('Exact candidate capabilities require approval')
    const unavailable = this.executionUnavailableReason?.(generation.manifest)
    if (unavailable) throw new Error(unavailable)
    if (!supportsRestrictedActivation(generation.manifest))
      throw new Error('Restricted activation is not supported for this execution host')
    const identity = {
      transactionId: candidate.transactionId,
      fingerprint: generation.capabilityFingerprint,
    }
    let oldFullyStopped = false
    try {
      await this.catalogTransition(pluginId, { type: 'beginTrial', ...identity })
      await this.unloadRuntimePlugin(pluginId)
      oldFullyStopped = true
      await this.enablePluginInstance(pluginId, this.generationRecord(entry, generation))
      await this.catalogTransition(pluginId, { type: 'commit', ...identity, enabled: true })
      return this.publishCatalogInstance(pluginId, generation)
    } catch (error) {
      let cleanupOk = true
      try {
        await this.unloadRuntimePlugin(pluginId)
      } catch (cleanup) {
        cleanupOk = false
        this.managerDiagnostics.push(String(cleanup))
      }
      // A rejected IPC may follow a durable commit. Read the authority before choosing recovery.
      try {
        this.applyCatalog(await this.catalog!.read())
        const current = this.requireCatalogEntry(pluginId)
        if (current.active?.id === generation.id) {
          if (current.previous) await this.catalogTransition(pluginId, { type: 'rollback' })
          else
            await this.catalogTransition(pluginId, {
              type: 'markFailed',
              generationId: generation.id,
              message: 'Committed plugin could not be published; manual recovery required',
            })
        } else if (current.pending?.transactionId === candidate.transactionId)
          await this.catalogTransition(pluginId, {
            type: 'failCandidate',
            ...identity,
            message: String(error),
          })
        if ((!oldFullyStopped || !cleanupOk) && this.catalogEntry(pluginId)?.active)
          await this.catalogTransition(pluginId, {
            type: 'markFailed',
            generationId: this.requireCatalogEntry(pluginId).active!.id,
            message: 'Isolation cleanup incomplete; manual recovery required',
          })
        if (
          oldFullyStopped &&
          cleanupOk &&
          candidate.restoreEnabled &&
          entry.active &&
          this.catalogEntry(pluginId)?.active?.id === entry.active.id
        )
          await this.enableCatalogInstance(pluginId, false)
      } catch (recovery) {
        this.managerDiagnostics.push('Candidate recovery failed: ' + String(recovery))
      }
      this.managerDiagnostics.push('Candidate failed: ' + String(error))
      throw error
    }
  }

  private async installBundledPackages(
    listPaths: DesktopPluginManagerOptions['bundledPackagePaths'],
  ): Promise<void> {
    if (!listPaths || !this.storage) return
    let paths: readonly string[]
    let considered: Set<string>
    try {
      paths = await listPaths()
      if (paths.length === 0) return
      const value: unknown = JSON.parse(this.storage.getItem(bundledStorageKey) ?? '[]')
      if (!Array.isArray(value) || !value.every((id) => typeof id === 'string')) {
        throw new Error('Invalid bundled plugin receipt')
      }
      considered = new Set(value)
    } catch (error) {
      this.recordBundledFailure('bundled-plugins', error)
      return
    }
    for (const path of paths) {
      try {
        const archive = parsePluginPackageArchive(
          parseManifestJson(await this.manifestHost.readManifestText(path), path),
        )
        const { id } = archive.manifest
        if (this.reservedPluginIds.has(id) || considered.has(id)) continue
        // Persist before installing: a crash or subsequent uninstall must not cause
        // an automatic reinstall. A failed attempt remains visible and can be
        // retried manually through the ordinary package picker.
        considered.add(id)
        this.storage.setItem(bundledStorageKey, JSON.stringify([...considered]))
        if (this.registry.list().some((record) => record.manifest.id === id)) continue
        if (archive.manifest.host !== 'worker' && archive.manifest.host !== 'dom') {
          throw new Error('Bundled installation supports only Worker or read-only DOM packages')
        }
        const record = await this.installManifestPath(path)
        if (record.errors.length > 0) throw new Error(record.errors.join('; '))
        // Privileged distribution packages are discoverable but never automatically approved or run.
        if (
          (archive.manifest.permissions ?? []).some((permission) => permission !== 'document:read')
        )
          continue
        this.registry.approve(id)
        this.persist()
        await this.enableRestoredPlugin(id)
      } catch (error) {
        this.recordBundledFailure(path, error)
      }
    }
  }

  private recordBundledFailure(path: string, error: unknown): void {
    try {
      this.recordInstallFailure(path, error)
    } catch {
      // The in-memory failure is already visible. Full local storage must not
      // turn an optional distribution default into an editor startup failure.
    }
  }

  state(): DesktopPluginManagerState {
    return Object.freeze({
      records: Object.freeze(
        [
          ...this.registry
            .list()
            .filter((record) => !this.reservedPluginIds.has(record.manifest.id)),
          ...(this.catalogSnapshot?.entries.flatMap((entry) =>
            this.reservedPluginIds.has(entry.id)
              ? []
              : entry.tombstone && entry.active && entry.diagnostics.length
                ? [
                    {
                      ...this.generationRecord(entry, entry.active),
                      state: 'failed' as const,
                      errors: entry.diagnostics,
                    },
                  ]
                : !entry.active && entry.pending && !entry.tombstone
                  ? [
                      {
                        ...this.generationRecord(entry, entry.pending.generation),
                        state: entry.diagnostics.length
                          ? ('failed' as const)
                          : ('disabled' as const),
                        errors: entry.diagnostics,
                      },
                    ]
                  : [],
          ) ?? []),
        ].sort((left, right) => {
          // Native active and pending-only records share one identity order. A first
          // activation must not move its card from the pending tail to the active head.
          if (!this.catalogSnapshot) return 0
          return left.manifest.id < right.manifest.id
            ? -1
            : left.manifest.id > right.manifest.id
              ? 1
              : 0
        }),
      ),
      ...(this.catalogSnapshot
        ? {
            catalogRevision: this.catalogSnapshot.revision,
            catalogEntries: this.catalogSnapshot.entries.filter(
              (entry) => !this.reservedPluginIds.has(entry.id),
            ),
            bundledUpgradeOffers: Object.freeze(
              Object.fromEntries(
                this.catalogSnapshot.entries.flatMap((entry) => {
                  const offer = this.bundledUpgrade(entry)
                  return offer ? [[entry.id, offer.archive.manifest]] : []
                }),
              ),
            ),
            executionUnavailableReasons: Object.freeze(
              Object.fromEntries(
                this.catalogSnapshot.entries.flatMap((entry) => {
                  if (this.reservedPluginIds.has(entry.id)) return []
                  const manifest =
                    this.bundledUpgrade(entry)?.archive.manifest ??
                    entry.pending?.generation.manifest ??
                    entry.active?.manifest
                  const reason = manifest && this.executionUnavailableReason?.(manifest)
                  return reason ? [[entry.id, reason]] : []
                }),
              ),
            ),
          }
        : {}),
      diagnostics: Object.freeze([
        ...this.managerDiagnostics,
        ...(this.catalogSnapshot?.diagnostics ?? []),
      ]),
      contributions: createPluginContributionIndex(
        this.registry.list().filter((record) => !this.reservedPluginIds.has(record.manifest.id)),
        this.runtime.getActionRegistry().list(),
      ),
      auditCount: this.registry.auditLog().length,
      auditRecords: this.registry.auditLog(),
      installFailures: Object.freeze([...this.installFailures]),
    })
  }

  async installFromPicker(): Promise<PluginRegistryRecord | undefined> {
    await this.ready
    const path = await this.manifestHost.selectManifestPath()

    if (!path) {
      return undefined
    }

    return this.installManifestPath(path)
  }

  async installManifestPath(path: string): Promise<PluginRegistryRecord> {
    try {
      const text = await this.manifestHost.readManifestText(path)
      const value = parseManifestJson(text, path)
      const archive = isPluginPackageArchive(value) ? parsePluginPackageArchive(value) : undefined
      const manifest = archive?.manifest ?? parsePluginManifest(value)
      this.assertPluginNotReserved(manifest.id)
      if (!allowedHosts.includes(manifest.host ?? 'worker'))
        throw new Error(`Plugin host is not allowed: ${manifest.host}`)
      const errors = validatePluginCompatibility(manifest, this.compatibility)
      if (errors.length) throw new Error(errors.join('; '))
      return await this.runPluginLifecycle(manifest.id, async () => {
        if (this.catalog) {
          if (!archive)
            throw new Error('Catalog installation requires a complete sealed plugin package')
          this.applyCatalog(
            await this.catalog.prepare({
              archive,
              sourcePath: path,
              expectedRevision: this.catalogEntry(manifest.id)?.revision ?? null,
            }),
          )
          this.clearInstallFailure(path)
          return this.requireDisplayRecord(manifest.id)
        }
        const installed = archive ? await this.manifestHost.installPackage?.(archive) : undefined
        let record = this.registry.installLocalPlugin({
          manifest,
          manifestPath: installed?.manifestPath ?? path,
          rootPath: installed?.rootPath ?? directoryOf(path),
          sourcePath: path,
          trust: 'development',
        })
        const directories =
          installed ?? (await this.manifestHost.ensureDataDirectories?.(record.manifest.id))

        if (directories) {
          record = this.registry.setRoots(record.manifest.id, {
            ...(installed ? { rootPath: installed.rootPath } : {}),
            dataRoot: directories.dataRoot,
            storageRoot: directories.storageRoot,
          })
        }
        this.clearInstallFailure(path)
        this.persist()
        return record
      })
    } catch (error) {
      this.recordInstallFailure(path, error)
      throw error
    }
  }

  async exportLocalPackage(pluginId: string): Promise<string | undefined> {
    await this.ready
    const record = this.require(pluginId)

    if (!this.manifestHost.selectPackageExportPath || !this.manifestHost.writeText) {
      throw new Error('Plugin package export is not available in this host')
    }

    const target = await this.manifestHost.selectPackageExportPath(
      `${record.manifest.id}-${record.manifest.version}.milkup-plugin`,
    )

    if (!target) {
      return undefined
    }

    const archive = await this.createPackageArchive(record)
    await this.manifestHost.writeText(target, serializePluginPackageArchive(archive))
    return target
  }

  /** Called only by the trusted host's explicit card gesture, never by plugin RPC/actions. */
  enableFromUserIntent(pluginId: string): Promise<PluginRegistryRecord> {
    const pending = this.userEnableTasks.get(pluginId)
    if (pending) return pending
    const result = this.ready.then(() => {
      this.assertPluginNotReserved(pluginId)
      const intentEntry = this.catalog ? this.requireCatalogEntry(pluginId) : undefined
      const intentRecord = this.catalog ? undefined : this.require(pluginId)
      return this.runPluginLifecycle(pluginId, async () => {
        if (intentEntry) {
          let current = this.requireCatalogEntry(pluginId)
          const selectedIntent = intentEntry.pending?.generation ?? intentEntry.active
          let generation = current.pending?.generation ?? current.active
          if (
            current.revision !== intentEntry.revision ||
            current.tombstone ||
            current.pending?.transactionId !== intentEntry.pending?.transactionId ||
            generation?.id !== selectedIntent?.id ||
            generation?.capabilityFingerprint !== selectedIntent?.capabilityFingerprint
          )
            throw new Error('Plugin changed before enable intent; click the switch again')
          const offer = this.bundledUpgrade(current)
          if (offer) {
            this.assertUserExecutionSupported(offer.archive.manifest)
            current = await this.stageBundledUpgrade(current, offer)
            generation = current.pending?.generation ?? current.active
          }
          if (!generation) throw new Error('Plugin has no installation to enable')
          this.assertUserExecutionSupported(generation.manifest)
          if (
            !current.pending &&
            current.enabled &&
            this.publishedGenerations.get(pluginId) === generation.id
          )
            return this.require(pluginId)
          const transactionId = current.pending?.transactionId
          if (generation.approvedFingerprint !== generation.capabilityFingerprint) {
            const approved = await this.catalogTransition(
              pluginId,
              transactionId
                ? { type: 'approve', transactionId, fingerprint: generation.capabilityFingerprint }
                : {
                    type: 'approveActive',
                    generationId: generation.id,
                    fingerprint: generation.capabilityFingerprint,
                  },
            )
            const selected = approved.pending?.generation ?? approved.active
            if (
              approved.revision !== current.revision + 1 ||
              approved.tombstone ||
              approved.pending?.transactionId !== transactionId ||
              selected?.id !== generation.id ||
              selected.capabilityFingerprint !== generation.capabilityFingerprint
            )
              throw new Error('Plugin changed during enable intent; click the switch again')
          }
          return this.enableCatalogInstance(pluginId)
        }
        const record = this.require(pluginId)
        if (JSON.stringify(record) !== JSON.stringify(intentRecord))
          throw new Error('Plugin changed before enable intent; click the switch again')
        this.assertUserExecutionSupported(record.manifest)
        if (record.enabled) return record
        this.registry.approve(pluginId)
        this.persist()
        // Compatibility, host permissions and runtime isolation are revalidated; historical
        // activation diagnostics do not prevent a deliberate retry of the same installation.
        return this.enablePluginInstance(pluginId, undefined, true)
      })
    })
    this.userEnableTasks.set(pluginId, result)
    const clear = () => {
      if (this.userEnableTasks.get(pluginId) === result) this.userEnableTasks.delete(pluginId)
    }
    void result.then(clear, clear)
    return result
  }

  private bundledUpgrade(
    entry: PluginCatalogEntry,
  ): { path: string; archive: PluginPackageArchive } | undefined {
    if (
      entry.tombstone ||
      entry.startAttempt ||
      entry.pending?.phase === 'trial' ||
      this.reservedPluginIds.has(entry.id)
    )
      return undefined
    const offer = this.bundledUpgradeIndex.get(entry.id)
    const selected = entry.pending?.generation ?? entry.active
    const receiptAllowed = (path: string) =>
      path === offer?.path || this.bundledUpgradeSources.get(entry.id)?.has(path) === true
    if (
      !offer ||
      !selected ||
      !receiptAllowed(selected.sourcePath) ||
      !isNewerBundledVersion(offer.archive.manifest.version, selected.manifest.version)
    )
      return undefined
    if (
      entry.active &&
      (!receiptAllowed(entry.active.sourcePath) ||
        !isNewerBundledVersion(offer.archive.manifest.version, entry.active.manifest.version))
    )
      return undefined
    return offer
  }

  private async stageBundledUpgrade(
    entry: PluginCatalogEntry,
    offer: { path: string; archive: PluginPackageArchive },
  ): Promise<PluginCatalogEntry> {
    const pending = entry.pending
    try {
      this.applyCatalog(
        await this.catalog!.prepare({
          archive: offer.archive,
          sourcePath: offer.path,
          expectedRevision: entry.revision,
          ...(pending
            ? {
                replacePending: {
                  transactionId: pending.transactionId,
                  generationId: pending.generation.id,
                  sourcePath: pending.generation.sourcePath,
                  fingerprint: pending.generation.capabilityFingerprint,
                },
              }
            : {}),
        }),
      )
      const staged = this.requireCatalogEntry(entry.id),
        candidate = staged.pending
      if (
        staged.revision !== entry.revision + 1 ||
        staged.tombstone ||
        !candidate ||
        candidate.phase !== 'prepared' ||
        candidate.transactionId === pending?.transactionId ||
        candidate.generation.sourcePath !== offer.path ||
        candidate.generation.manifest.version !== offer.archive.manifest.version ||
        candidate.generation.manifest.host !== offer.archive.manifest.host
      )
        throw new Error('Bundled candidate changed during enable intent; click the switch again')
      return staged
    } catch (error) {
      // A rejected IPC may follow a durable write. Refresh authority, but do not approve
      // or activate on this failed gesture; the next explicit gesture captures fresh identity.
      try {
        this.applyCatalog(await this.catalog!.read())
      } catch (recovery) {
        this.managerDiagnostics.push('Bundled candidate recovery failed: ' + String(recovery))
      }
      throw error
    }
  }

  private assertPluginNotReserved(pluginId: string): void {
    if (this.reservedPluginIds.has(pluginId))
      throw new Error('This plugin ID is reserved for a built-in feature: ' + pluginId)
  }

  private assertUserExecutionSupported(manifest: PluginManifest): void {
    const errors = validatePluginCompatibility(manifest, this.compatibility)
    if (errors.length) throw new Error(errors.join('; '))
    const denied = (manifest.permissions ?? []).filter(
      (permission) => !this.hostPermissions.has(permission),
    )
    if (denied.length) throw new Error('Plugin permissions are not allowed: ' + denied.join(', '))
    const unavailable = this.executionUnavailableReason?.(manifest)
    if (unavailable) throw new Error(unavailable)
    if (!supportsRestrictedActivation(manifest))
      throw new Error('Restricted activation is not supported for this execution host')
  }

  async enable(pluginId: string): Promise<PluginRegistryRecord> {
    await this.ready
    return this.enableRestoredPlugin(pluginId)
  }

  private async enableRestoredPlugin(pluginId: string): Promise<PluginRegistryRecord> {
    return this.runPluginLifecycle(pluginId, () =>
      this.catalog ? this.enableCatalogInstance(pluginId) : this.enablePluginInstance(pluginId),
    )
  }

  private async enablePluginInstance(
    pluginId: string,
    candidate?: PluginRegistryRecord,
    explicitRetry = false,
  ): Promise<PluginRegistryRecord> {
    const record = candidate ?? this.require(pluginId)

    try {
      const runtimeFailure = record.runtimeFailure
      const retryableFailure =
        runtimeFailure?.kind === 'execution-host' &&
        runtimeFailure.message === executionHostFailureMessage
          ? runtimeFailure.message
          : undefined
      const blockingErrors = record.errors.filter(
        (error) => error !== documentRendererTimeoutMessage && error !== retryableFailure,
      )
      if (!explicitRetry && blockingErrors.length > 0) {
        throw new Error(blockingErrors.join('; '))
      }

      this.assertApproved(record)

      await this.unloadRuntimePlugin(pluginId)
      if (candidate) this.executingRecords.set(pluginId, candidate)
      const epoch = this.activationEpochs.get(pluginId) ?? 0
      const gate: { readonly epoch: number; committed: boolean; violation?: Error } = {
        epoch,
        committed: !this.catalog,
      }
      this.activationGates.set(pluginId, gate)
      this.temporaryStorageStopped = false
      const main = record.manifest.main

      if (!main) {
        throw new Error('Plugin manifest must declare main before it can be enabled')
      }

      const prepared = await this.prepareModule(record.manifest, record.manifestPath, main)
      this.preparedModules.set(pluginId, prepared)
      const lifecycle = Object.freeze({
        onDocumentRenderTimeout: () => this.failDocumentRenderer(pluginId, epoch),
        onIsolationError: (_error: Error) =>
          this.failDocumentRenderer(pluginId, epoch, 'execution-host'),
      })
      let loaded: DesktopLoadedPluginModule
      if (record.manifest.host === 'dom') {
        if (prepared.kind !== 'dom')
          throw new Error('DOM plugins require an installed native prepared lease')
        loaded = await this.loadDomModule(record.manifest, prepared, lifecycle)
      } else {
        if (prepared.kind === 'dom')
          throw new Error('DOM prepared lease cannot be used by another plugin host')
        const documentBroker = this.getDocumentBroker(record.manifest)
        const editingBroker = this.getEditingBroker(record.manifest)
        const resourcesBroker = this.getResourcesBroker(record.manifest)
        const outputBroker = this.getOutputBroker(record.manifest)
        const keymapBroker = this.getKeymapBroker(record.manifest)
        const settingsBroker = this.getSettingsBroker(record.manifest)
        const workspaceBroker = this.getWorkspaceBroker(record.manifest)
        const releasesBroker = this.getReleasesBroker(record.manifest)
        const managementBroker = this.getManagementBroker(record.manifest)
        const uiBroker = this.createUiBroker(record.manifest)
        const capabilities = Object.freeze({
          ...lifecycle,
          restrictedActivation: !!this.catalog,
          isActivationCommitted: () => gate.committed,
          onActivationViolation: (error: Error) => {
            gate.violation = error
          },
          ...(settingsBroker ? { settingsBroker } : {}),
          ...(keymapBroker ? { keymapBroker } : {}),
          ...(editingBroker ? { editingBroker } : {}),
          ...(resourcesBroker ? { resourcesBroker } : {}),
          ...(outputBroker ? { outputBroker } : {}),
          ...(workspaceBroker ? { workspaceBroker } : {}),
          ...(releasesBroker ? { releasesBroker } : {}),
          ...(managementBroker ? { managementBroker } : {}),
          ...(documentBroker ? { documentBroker } : {}),
          ...(uiBroker ? { uiBroker } : {}),
        })
        loaded = await (record.manifest.host === 'sidecar'
          ? this.loadSidecarModule(record.manifest, prepared.specifier, capabilities)
          : this.loadModule(record.manifest, prepared.specifier, capabilities))
      }
      this.loadedModules.set(pluginId, loaded)
      if (this.activationEpochs.get(pluginId) !== epoch) {
        throw new Error(
          this.registry.get(pluginId)?.runtimeFailure?.message ?? documentRendererTimeoutMessage,
        )
      }
      if (record.manifest.host === 'sidecar') {
        this.recordAuditAndPersist(pluginId, 'sidecar', 'started', false)
      }
      this.runtime.loadPlugin({
        manifest: record.manifest,
        module: loaded.module,
      })
      if (this.catalog) {
        let timer: ReturnType<typeof setTimeout> | undefined
        try {
          await Promise.race([
            this.runtime.preparePlugin(pluginId, {
              restrictedActivation: true,
              isActivationCommitted: () => gate.committed,
              onActivationViolation: (error: Error) => {
                gate.violation = error
              },
            }),
            new Promise<never>((_, reject) => {
              timer = setTimeout(
                () => reject(new Error('Restricted plugin activation timed out')),
                10000,
              )
            }),
          ])
        } finally {
          if (timer) clearTimeout(timer)
        }
      } else await this.runtime.enablePlugin(pluginId)
      if (this.activationEpochs.get(pluginId) !== epoch)
        throw new Error(
          this.registry.get(pluginId)?.runtimeFailure?.message ?? documentRendererTimeoutMessage,
        )
      if (gate.violation) throw gate.violation
      if (this.catalog) return record
      const next = this.registry.markEnabled(pluginId)
      this.persist()
      return next
    } catch (error) {
      try {
        await this.unloadRuntimePlugin(pluginId)
      } catch (cleanup) {
        this.managerDiagnostics.push(String(cleanup))
      }
      const activationError = pluginActivationError(pluginId, error)
      if (this.catalog) throw activationError
      const prior = this.registry.get(pluginId)?.runtimeFailure
      const failed = this.registry.markFailed(
        pluginId,
        activationError,
        prior?.message ===
          (activationError instanceof Error ? activationError.message : String(activationError))
          ? prior.kind
          : undefined,
      )
      this.persist()
      return failed
    }
  }

  async disable(pluginId: string): Promise<PluginRegistryRecord> {
    await this.ready
    return this.runPluginLifecycle(pluginId, async () => {
      this.revokeExecutionEpoch(pluginId)
      try {
        if (this.catalog) await this.catalogTransition(pluginId, { type: 'disable' })
      } finally {
        try {
          await this.unloadRuntimePlugin(pluginId)
        } finally {
          this.persist()
        }
      }
      return this.requireDisplayRecord(pluginId)
    })
  }
  async reload(pluginId: string): Promise<PluginRegistryRecord> {
    await this.ready
    return this.runPluginLifecycle(pluginId, async () => {
      const record = this.requireDisplayRecord(pluginId)
      if (!record.enabled) throw new Error('Only an enabled plugin can be reloaded')
      if (this.catalog) return this.enableCatalogInstance(pluginId, false)
      await this.unloadRuntimePlugin(pluginId)
      this.registry.markDisabled(pluginId)
      // A reload of the sealed installed version does not recursively enter its own queue.
      this.registry.recordAudit(pluginId, 'reload')
      this.persist()
      return this.enablePluginInstance(pluginId)
    })
  }
  async remove(pluginId: string): Promise<void> {
    await this.ready
    return this.runPluginLifecycle(pluginId, async () => {
      this.revokeExecutionEpoch(pluginId)
      let failure: unknown
      try {
        if (this.catalog) await this.catalogTransition(pluginId, { type: 'remove' })
        else this.registry.remove(pluginId)
      } catch (error) {
        failure = error
      }
      try {
        await this.unloadRuntimePlugin(pluginId)
      } catch (error) {
        failure ??= error
      }
      // Native tombstone owns retryable package cleanup. Never delete user settings/data.
      if (!this.catalog)
        try {
          await this.manifestHost.removeInstalledPackage?.(pluginId)
        } catch (error) {
          failure ??= error
        }
      this.persist()
      if (failure) throw failure
    })
  }
  async approve(
    pluginId: string,
    fingerprint?: string,
    reviewedRevision?: number,
  ): Promise<PluginRegistryRecord> {
    await this.ready
    return this.runPluginLifecycle(pluginId, async () => {
      if (this.catalog) {
        const e = this.requireCatalogEntry(pluginId),
          g = e.pending?.generation ?? e.active
        if (e.revision !== reviewedRevision)
          throw new Error('Approval view is stale; review this candidate again')
        if (!g || !fingerprint || g.capabilityFingerprint !== fingerprint)
          throw new Error('Approval requires the exact reviewed candidate fingerprint')
        await this.catalogTransition(
          pluginId,
          e.pending
            ? { type: 'approve', transactionId: e.pending.transactionId, fingerprint }
            : { type: 'approveActive', generationId: g.id, fingerprint },
        )
        return this.requireDisplayRecord(pluginId)
      }
      const record = this.registry.approve(pluginId)
      this.persist()
      return record
    })
  }
  async rejectCandidate(
    pluginId: string,
    fingerprint: string,
    reviewedRevision: number,
  ): Promise<PluginRegistryRecord | undefined> {
    await this.ready
    return this.runPluginLifecycle(pluginId, async () => {
      const entry = this.requireCatalogEntry(pluginId)
      if (entry.revision !== reviewedRevision)
        throw new Error('Candidate view is stale; review again')
      const c = entry.pending
      if (!c || c.generation.capabilityFingerprint !== fingerprint)
        throw new Error('Candidate changed; review again')
      await this.catalogTransition(pluginId, {
        type: 'abort',
        transactionId: c.transactionId,
        fingerprint,
      })
      return this.registry.get(pluginId)
    })
  }
  async revokeApproval(pluginId: string): Promise<PluginRegistryRecord> {
    await this.ready
    return this.runPluginLifecycle(pluginId, async () => {
      this.revokeExecutionEpoch(pluginId)
      try {
        if (this.catalog) await this.catalogTransition(pluginId, { type: 'revokeApproval' })
        else this.registry.revokeApproval(pluginId)
      } finally {
        try {
          await this.unloadRuntimePlugin(pluginId)
        } finally {
          this.persist()
        }
      }
      return this.requireDisplayRecord(pluginId)
    })
  }

  findKeymapAction(
    event: KeyboardEvent,
    context: DesktopPluginKeymapContext = {
      editorFocus: true,
      documentOpen: true,
      sourceMode: false,
      liveMode: true,
    },
  ): string | undefined {
    const key = eventToKeymap(event)

    if (!key) {
      return undefined
    }

    return this.state().contributions.keymaps.find(
      (binding) =>
        binding.status === 'active' &&
        binding.key === key &&
        keymapWhenMatches(binding.when, context),
    )?.command
  }

  async render(
    pluginId: string,
    rendererId: string,
    context: { readonly nodeType: string; readonly source?: string; readonly node?: unknown },
  ): Promise<unknown> {
    const result = await this.runtime.render(pluginId, rendererId, context)

    if (result.ok) {
      return result.value
    }

    throw new Error(result.error.message)
  }

  async renderDocument(
    pluginId: string,
    rendererId: string,
    request: DocumentPresentationRequest,
    options: { readonly signal?: AbortSignal } = {},
  ): Promise<DocumentPresentationResult> {
    return this.runtime.renderDocument(pluginId, rendererId, request, options)
  }

  /** Host-only instance identity for bounded presentation preparation. */
  documentRendererGeneration(pluginId: string): number {
    return this.activationEpochs.get(pluginId) ?? 0
  }

  async renderUi(
    pluginId: string,
    viewId: string,
    phase: DesktopPluginUiPhase,
    state: Readonly<Record<string, unknown>> = {},
  ): Promise<unknown> {
    // A retiring isolated owner releases plugin resources. A host view close arriving
    // after revocation must not dispatch a new renderer RPC into that retired realm.
    const epoch = this.activationEpochs.get(pluginId)
    if (phase === 'dispose' && this.runtime.getPlugin(pluginId)?.state !== 'enabled') {
      return undefined
    }
    const contribution = this.state().contributions.ui.find(
      (view) => view.pluginId === pluginId && view.id === viewId,
    )
    if (!contribution && phase !== 'dispose') {
      throw new Error(`Plugin UI contribution is not available: ${pluginId}:${viewId}`)
    }
    const result = await this.runtime.render(pluginId, viewId, {
      nodeType: contribution ? `ui:${contribution.slot}` : 'ui:disposed',
      node: Object.freeze({ phase, ...state }),
    })
    if (this.activationEpochs.get(pluginId) !== epoch) {
      if (phase === 'dispose') return undefined
      throw new Error('Plugin UI activation was revoked')
    }
    if (!result.ok) throw new Error(result.error.message)
    if (phase === 'mount') {
      const active = this.activeUi.get(pluginId) ?? new Set<string>()
      active.add(viewId)
      this.activeUi.set(pluginId, active)
    } else if (phase === 'dispose') {
      this.activeUi.get(pluginId)?.delete(viewId)
    }
    return result.value
  }

  supportedDocumentExtensions(): readonly string[] {
    return Object.freeze(
      [...this.state().contributions.importers, ...this.state().contributions.documentTypes]
        .flatMap((contribution) => contribution.extensions)
        .map(normalizeExtension)
        .filter(
          (extension, index, all) => extension.length > 0 && all.indexOf(extension) === index,
        ),
    )
  }

  async openPluginDocument(
    path: string,
    source: string,
  ): Promise<DesktopPluginDocumentResult | undefined> {
    await this.ready
    const extension = normalizeExtension(path.slice(path.lastIndexOf('.') + 1))
    const contributions = this.state().contributions
    const importer = contributions.importers.find((candidate) =>
      candidate.extensions.some((item) => normalizeExtension(item) === extension),
    )

    if (importer) {
      const value = await this.runDocumentProvider(
        importer.pluginId,
        importer.id,
        'document:importer',
        path,
        source,
      )

      if (importer.target === 'markdown') {
        return Object.freeze({
          kind: 'generated-markdown',
          markdown: readMarkdownProviderResult(value, importer.id),
          sourcePath: path,
          title: importer.title,
          pluginId: importer.pluginId,
          contributionId: importer.id,
        })
      }

      return createCustomDocumentResult(value, path, importer.title, importer.pluginId, importer.id)
    }

    const documentType = contributions.documentTypes.find((candidate) =>
      candidate.extensions.some((item) => normalizeExtension(item) === extension),
    )

    if (!documentType) {
      return undefined
    }

    const value = await this.runDocumentProvider(
      documentType.pluginId,
      documentType.id,
      'document:type',
      path,
      source,
    )

    if (typeof value === 'string' || isMarkdownProviderResult(value)) {
      return Object.freeze({
        kind: 'generated-markdown',
        markdown: readMarkdownProviderResult(value, documentType.id),
        sourcePath: path,
        title: documentType.title,
        pluginId: documentType.pluginId,
        contributionId: documentType.id,
      })
    }

    return createCustomDocumentResult(
      value,
      path,
      documentType.title,
      documentType.pluginId,
      documentType.id,
    )
  }

  private async runDocumentProvider(
    pluginId: string,
    contributionId: string,
    nodeType: string,
    path: string,
    source: string,
  ): Promise<unknown> {
    const result = await this.runtime.render(pluginId, contributionId, {
      nodeType,
      source,
      node: Object.freeze({ path }),
    })

    if (!result.ok) {
      throw new Error(result.error.message)
    }

    return result.value
  }

  resolveRendererCommand(rendererId: string, command: string): string | undefined {
    const separator = rendererId.indexOf(':')
    const pluginId = separator >= 0 ? rendererId.slice(0, separator) : ''
    const contributions = this.state().contributions
    const ownsRenderer = [...contributions.renderers, ...contributions.ui].some(
      (renderer) => `${renderer.pluginId}:${renderer.id}` === rendererId,
    )
    const ownsCommand = (this.registry.get(pluginId)?.manifest.contributes?.commands ?? []).some(
      (contribution) => contribution.action === command,
    )

    return ownsRenderer && ownsCommand ? command : undefined
  }

  private async createWorkerModule(
    manifest: PluginManifest,
    moduleSpecifier: string,
    capabilities?: DesktopPluginModuleCapabilities,
  ): Promise<DesktopLoadedPluginModule> {
    const worker = manifest.contributes?.documentRenderers?.length
      ? createSupervisedPluginWorkerEndpoint(createDesktopPluginWorker(manifest.id, true))
      : createDesktopPluginWorker(manifest.id, false)
    let workerHost: ReturnType<typeof createBrowserWorkerPluginHost> | undefined
    try {
      const fileBroker = this.createFileBroker(manifest)
      const networkBroker = this.createNetworkBroker(manifest)
      const storageBroker = this.createStorageBroker(manifest)
      workerHost = createBrowserWorkerPluginHost({
        worker,
        manifest,
        moduleSpecifier,
        ...(capabilities?.restrictedActivation !== undefined
          ? { restrictedActivation: capabilities.restrictedActivation }
          : {}),
        ...(capabilities?.isActivationCommitted
          ? { isActivationCommitted: capabilities.isActivationCommitted }
          : {}),
        ...(capabilities?.onActivationViolation
          ? { onActivationViolation: capabilities.onActivationViolation }
          : {}),
        ...(capabilities?.documentBroker ? { documentBroker: capabilities.documentBroker } : {}),
        ...(capabilities?.uiBroker ? { uiBroker: capabilities.uiBroker } : {}),
        ...(capabilities?.releasesBroker ? { releasesBroker: capabilities.releasesBroker } : {}),
        ...(capabilities?.managementBroker
          ? { managementBroker: capabilities.managementBroker }
          : {}),
        ...(capabilities?.workspaceBroker ? { workspaceBroker: capabilities.workspaceBroker } : {}),
        ...(capabilities?.settingsBroker ? { settingsBroker: capabilities.settingsBroker } : {}),
        ...(capabilities?.keymapBroker ? { keymapBroker: capabilities.keymapBroker } : {}),
        ...(capabilities?.editingBroker ? { editingBroker: capabilities.editingBroker } : {}),
        ...(capabilities?.resourcesBroker ? { resourcesBroker: capabilities.resourcesBroker } : {}),
        ...(capabilities?.outputBroker ? { outputBroker: capabilities.outputBroker } : {}),
        ...(fileBroker ? { fileBroker } : {}),
        ...(networkBroker ? { networkBroker } : {}),
        ...(storageBroker ? { storageBroker } : {}),
        ...(capabilities?.onDocumentRenderTimeout
          ? { onDocumentRenderTimeout: capabilities.onDocumentRenderTimeout }
          : {}),
        ...(capabilities?.onIsolationError
          ? { onIsolationError: capabilities.onIsolationError }
          : {}),
        timeoutMs: 10_000,
      })

      await workerHost.ready
      const initializedHost = workerHost
      return Object.freeze({
        module: createIsolatedPluginModule({
          manifest,
          host: initializedHost.host,
          disposeIsolation: () => initializedHost.dispose(),
        }),
        dispose: () => initializedHost.dispose(),
        retryDispose: () => initializedHost.retryDispose(),
      })
    } catch (error) {
      try {
        if (workerHost) await workerHost.dispose()
        else await worker.terminate?.()
      } catch (cleanup) {
        const owner = workerHost
        const retirement = this.retiringOperations.get(manifest.id) ?? []
        retirement.push(() => (owner ? owner.retryDispose() : worker.terminate?.()))
        this.retiringOperations.set(manifest.id, retirement)
        throw new AggregateError([error, cleanup], 'Worker initialization and cleanup failed')
      }
      throw error
    }
  }

  private createFileBroker(manifest: PluginManifest) {
    const record = this.capabilityRecord(manifest.id)

    if (
      !record ||
      !manifest.permissions?.some((permission) => permission.startsWith('file:')) ||
      !manifest.permissions
        .filter((permission) => permission.startsWith('file:'))
        .every((permission) => record.approvals.permissions.includes(permission))
    ) {
      return undefined
    }

    return createDesktopPluginFileBroker({
      manifest,
      roots: this.catalog
        ? [
            { id: 'plugin-root', path: record.rootPath, operations: ['read'] },
            { id: 'plugin-data', path: record.dataRoot, operations: ['read', 'write', 'delete'] },
          ]
        : [{ id: 'plugin-root', path: record.rootPath }],
      audit: (auditRecord) =>
        this.recordAuditAndPersist(
          manifest.id,
          'file',
          `${auditRecord.operation}:${auditRecord.requestedPath}`,
          auditRecord.ok === false,
        ),
    })
  }

  private getDocumentBroker(manifest: PluginManifest): ManagedPluginDocumentBroker | undefined {
    if (!manifest.permissions?.includes('document:read') || !this.documentSource) {
      return undefined
    }

    const existing = this.documentBrokers.get(manifest.id)
    if (existing) return existing

    const broker = createPluginDocumentBroker({
      pluginId: manifest.id,
      source: this.documentSource,
      rendererIds: (manifest.contributes?.documentRenderers ?? []).map((renderer) => renderer.id),
      invalidatePresentation: (_request, context) => {
        context.assertActive()
        this.invalidatePresentation?.()
      },
    })
    this.documentBrokers.set(manifest.id, broker)
    return broker
  }

  resolveImagePasteHandler(): { readonly pluginId: string; readonly command: string } | undefined {
    const handler = this.state().contributions.pasteHandlers?.find(
      (value) => value.status === 'active',
    )
    return handler
      ? Object.freeze({ pluginId: handler.pluginId, command: handler.command })
      : undefined
  }
  grantImagePaste(pluginId: string, grantId: string): void {
    const record = this.registry.get(pluginId)
    if (!record?.enabled || record.state !== 'enabled')
      throw new Error('Image paste handler is unavailable')
    const broker = this.getResourcesBroker(record.manifest)
    if (!broker) throw new Error('Image import permission is unavailable')
    broker.grantPaste(grantId)
  }
  private getEditingBroker(manifest: PluginManifest): RevocablePluginEditingBroker | undefined {
    const allowed = () => {
      const record = this.capabilityRecord(manifest.id)
      if (
        !record ||
        !['document:read', 'document:write'].every((permission) =>
          manifest.permissions?.includes(permission as ActionPermission),
        )
      )
        return false
      // Ordinary document capabilities are authorized by enable. Only the
      // manager's sensitive permissions and execution host need separate approval.
      // Activation creates brokers before markEnabled, so do not gate on enabled.
      try {
        this.assertApproved(record)
        return true
      } catch {
        return false
      }
    }
    if (!this.editingAdapter || !allowed()) return undefined
    const existing = this.editingBrokers.get(manifest.id)
    if (existing) return existing
    const service = this.editingAdapter(manifest)
    this.editingServices.set(manifest.id, service)
    const broker = createPluginEditingBroker({
      manifest,
      adapter: service.adapter,
      isActive: allowed,
      validateAssets: (ids, snapshotId) => {
        const resources = this.resourcesBrokers.get(manifest.id)
        if (!resources) throw new Error('Image grants unavailable')
        resources.assertAssets(ids, snapshotId)
      },
      acceptAssets: (ids, snapshotId) =>
        this.resourcesBrokers.get(manifest.id)?.acceptAssets(ids, snapshotId),
    })
    this.editingBrokers.set(manifest.id, broker)
    return broker
  }
  private getResourcesBroker(manifest: PluginManifest): RevocablePluginResourcesBroker | undefined {
    const allowed = () =>
      manifest.permissions?.includes('images:import') === true &&
      this.capabilityRecord(manifest.id)?.approvals.permissions.includes('images:import') === true
    if (!this.resourcesAdapter || !allowed()) return undefined
    const existing = this.resourcesBrokers.get(manifest.id)
    if (existing) return existing
    const editing = this.getEditingBroker(manifest)
    if (!editing) return undefined
    const service = this.resourcesAdapter(manifest)
    this.resourcesServices.set(manifest.id, service)
    const broker = createPluginResourcesBroker({
      manifest,
      adapter: service.adapter,
      isActive: allowed,
      getSnapshot: (id) => editing.getSnapshot(id),
    })
    this.resourcesBrokers.set(manifest.id, broker)
    return broker
  }
  private getOutputBroker(manifest: PluginManifest): RevocablePluginOutputBroker | undefined {
    const allowed = () => {
      const record = this.capabilityRecord(manifest.id)
      if (
        !record ||
        !manifest.permissions?.includes('document:read') ||
        !manifest.permissions.includes('document:output') ||
        !record.approvals.permissions.includes('document:output')
      )
        return false
      try {
        this.assertApproved(record)
        return true
      } catch {
        return false
      }
    }
    if (!this.outputAdapter || !allowed()) return undefined
    const existing = this.outputBrokers.get(manifest.id)
    if (existing) return existing
    const service = this.outputAdapter(manifest)
    this.outputServices.set(manifest.id, service)
    const broker = createPluginOutputBroker({
      manifest,
      adapter: service.adapter,
      isActive: allowed,
    })
    this.outputBrokers.set(manifest.id, broker)
    return broker
  }
  private getKeymapBroker(
    manifest: PluginManifest,
  ): ReturnType<typeof createPluginKeymapBroker> | undefined {
    const record = this.capabilityRecord(manifest.id)
    if (
      !this.keymapAdapter ||
      !manifest.permissions?.includes('app:keymap') ||
      !record?.approvals.permissions.includes('app:keymap')
    )
      return undefined
    const existing = this.keymapBrokers.get(manifest.id)
    if (existing) return existing
    const broker = createPluginKeymapBroker({
      manifest,
      adapter: this.keymapAdapter(manifest),
      isActive: () =>
        this.capabilityRecord(manifest.id)?.approvals.permissions.includes('app:keymap') === true,
    })
    this.keymapBrokers.set(manifest.id, broker)
    return broker
  }

  private getSettingsBroker(manifest: PluginManifest): RevocablePluginSettingsBroker | undefined {
    const record = this.capabilityRecord(manifest.id)
    if (
      !this.settingsAdapter ||
      !manifest.permissions?.includes('settings:write') ||
      !record?.approvals.permissions.includes('settings:write')
    )
      return undefined
    const existing = this.settingsBrokers.get(manifest.id)
    if (existing) return existing
    const service = this.settingsAdapter(manifest)
    this.settingsServices.set(manifest.id, service)
    const broker = createPluginSettingsBroker({
      manifest,
      adapter: service.adapter,
      isActive: () =>
        this.capabilityRecord(manifest.id)?.approvals.permissions.includes('settings:write') ===
        true,
    })
    this.settingsBrokers.set(manifest.id, broker)
    return broker
  }

  private getWorkspaceBroker(manifest: PluginManifest): RevocablePluginWorkspaceBroker | undefined {
    const record = this.capabilityRecord(manifest.id)
    if (
      !this.workspaceAdapter ||
      !manifest.permissions?.includes('workspace:read') ||
      !record?.approvals.permissions.includes('workspace:read')
    )
      return undefined
    const existing = this.workspaceBrokers.get(manifest.id)
    if (existing) return existing
    const service = this.workspaceAdapter(manifest.id)
    const broker = createPluginWorkspaceBroker({
      manifest,
      adapter: service.adapter,
      isActive: () =>
        this.capabilityRecord(manifest.id)?.approvals.permissions.includes('workspace:read') ===
        true,
      onDispose: () => service.dispose(),
    })
    this.workspaceBrokers.set(manifest.id, broker)
    return broker
  }

  managementSnapshot(): PluginManagementSnapshot {
    if (!this.catalogSnapshot) throw new PluginManagementError('unavailable')
    return Object.freeze({
      revision: this.catalogSnapshot.revision,
      items: Object.freeze(
        this.catalogSnapshot.entries
          .filter(
            (e) =>
              !this.reservedPluginIds.has(e.id) &&
              (!e.tombstone || e.diagnostics.length > 0) &&
              (e.active || e.pending),
          )
          .map((e) => {
            const manifest = e.active?.manifest ?? e.pending!.generation.manifest
            return Object.freeze({ id: e.id, ...projectPluginManagementMetadata(manifest) })
          }),
      ),
    })
  }
  managementDescribe(input: PluginManagementIdentity): PluginManagementDetails {
    if (!this.catalogSnapshot) throw new PluginManagementError('unavailable')
    if (input.revision !== this.catalogSnapshot.revision) throw new PluginManagementError('stale')
    const entry = this.catalogEntry(input.pluginId),
      generation = entry?.pending?.generation ?? entry?.active
    if (this.reservedPluginIds.has(input.pluginId) || !entry || !generation)
      throw new PluginManagementError('not-found')
    const manifest = generation.manifest,
      active = entry.active
    const approved =
      active?.approvedFingerprint === active?.capabilityFingerprint ? active : undefined
    const compatibility = validatePluginCompatibility(manifest, this.compatibility)
    const details = {
      pluginId: entry.id,
      revision: this.catalogSnapshot.revision,
      entryRevision: entry.revision,
      ...(entry.pending
        ? {
            candidate: {
              fingerprint: entry.pending.generation.capabilityFingerprint,
              version: entry.pending.generation.manifest.version,
            },
          }
        : {}),
      ...projectPluginManagementMetadata(manifest),
      version: manifest.version,
      host: manifest.host ?? 'worker',
      ...(approved ? { approvedHost: approved.manifest.host ?? 'worker' } : {}),
      state: entry.tombstone
        ? 'removed'
        : entry.pending
          ? 'pending'
          : this.publishedGenerations.has(entry.id)
            ? 'enabled'
            : entry.diagnostics.length
              ? 'failed'
              : 'disabled',
      compatibility: {
        compatible: compatibility.length === 0,
        hostVersion: this.compatibility.milkupVersion,
        sdkVersion: this.compatibility.pluginSdkVersion,
        ...(manifest.engines?.milkup ? { requiredHost: manifest.engines.milkup } : {}),
        ...(manifest.engines?.pluginSdk ? { requiredSdk: manifest.engines.pluginSdk } : {}),
      },
      permissions: pluginCapabilityDifference(
        manifest.permissions ?? [],
        approved?.manifest.permissions ?? [],
      ),
      networkOrigins: pluginCapabilityDifference(
        manifest.networkOrigins ?? [],
        approved?.manifest.networkOrigins ?? [],
      ),
      diagnostics: Object.freeze([
        ...entry.diagnostics.map((message) => ({
          code: /cleanup|isolation/i.test(message)
            ? 'cleanup-failed'
            : /activat|start/i.test(message)
              ? 'activation-failed'
              : 'catalog-diagnostic',
          message: 'Plugin lifecycle needs attention. Open host details for the full diagnostic.',
          severity: 'error' as const,
        })),
        ...compatibility.map(() => ({
          code: 'incompatible',
          message:
            'This plugin is incompatible with the current host or SDK version. Open host details for requirements.',
          severity: 'error' as const,
        })),
      ]),
      ...(manifest.settings ? { settings: manifest.settings } : {}),
    }
    try {
      return copyPluginManagementDetails(details)
    } catch {
      throw new PluginManagementError('unavailable')
    }
  }
  private getManagementBroker(
    manifest: PluginManifest,
  ): RevocablePluginManagementBroker | undefined {
    const record = this.capabilityRecord(manifest.id)
    if (
      !manifest.permissions?.includes('app:plugins') ||
      !record?.approvals.permissions.includes('app:plugins')
    )
      return undefined
    const existing = this.managementBrokers.get(manifest.id)
    if (existing) return existing
    const epoch = this.activationEpochs.get(manifest.id)
    const broker = createPluginManagementBroker({
      manifest,
      isActive: () =>
        this.activationEpochs.get(manifest.id) === epoch &&
        this.capabilityRecord(manifest.id)?.approvals.permissions.includes('app:plugins') === true,
      adapter: {
        snapshot: async (context) => {
          context.assertActive()
          return this.managementSnapshot()
        },
        describe: async (input, context) => {
          context.assertActive()
          return this.managementDescribe(input)
        },
        requestHostView: async (input, context) => {
          context.assertActive()
          this.managementDescribe(input)
          if (!this.requestManagementHostView) throw new PluginManagementError('unavailable')
          context.assertActive()
          return this.requestManagementHostView(input, context)
        },
      },
    })
    this.managementBrokers.set(manifest.id, broker)
    return broker
  }

  private getReleasesBroker(manifest: PluginManifest): RevocablePluginReleasesBroker | undefined {
    const record = this.capabilityRecord(manifest.id)
    if (
      !this.releasesAdapter ||
      !manifest.permissions?.includes('app:updates') ||
      !record?.approvals.permissions.includes('app:updates')
    )
      return undefined
    const existing = this.releasesBrokers.get(manifest.id)
    if (existing) return existing
    const service = this.releasesAdapter(manifest.id)
    const broker = createPluginReleasesBroker({
      manifest,
      adapter: service.adapter,
      isActive: () =>
        this.capabilityRecord(manifest.id)?.approvals.permissions.includes('app:updates') === true,
      onDispose: () => service.dispose(),
    })
    this.releasesBrokers.set(manifest.id, broker)
    return broker
  }

  private createUiBroker(manifest: PluginManifest): PluginUiBroker | undefined {
    const existing = this.uiBrokers.get(manifest.id)
    if (existing) return existing
    const viewIds = (manifest.contributes?.ui ?? []).map((view) => view.id)

    if (
      (viewIds.length === 0 && !manifest.contributes?.documentRenderers?.length) ||
      !this.invalidateUi
    )
      return undefined
    const broker = createPluginUiBroker({
      pluginId: manifest.id,
      viewIds,
      modalViewIds: (manifest.contributes?.ui ?? [])
        .filter((v) => v.slot === 'modal')
        .map((v) => v.id),
      ...(this.openUi ? { open: this.openUi } : {}),
      ...(this.notifyUi ? { notify: this.notifyUi } : {}),
      update: this.invalidateUi,
      ...(this.revealLine ? { revealLine: this.revealLine } : {}),
      ...(this.revealLocation && manifest.permissions?.includes('document:read')
        ? { revealLocation: this.revealLocation }
        : {}),
    })
    this.uiBrokers.set(manifest.id, broker)
    return broker
  }

  private createNetworkBroker(manifest: PluginManifest) {
    const record = this.capabilityRecord(manifest.id)

    if (
      !record ||
      !manifest.permissions?.includes('network:access') ||
      !record.approvals.permissions.includes('network:access') ||
      !(manifest.networkOrigins ?? []).every((origin) =>
        record.approvals.networkOrigins?.includes(origin),
      )
    ) {
      return undefined
    }

    return createPluginNetworkBroker({
      manifest,
      allowedOrigins: manifest.networkOrigins ?? [],
      adapter: {
        fetch: async (url, init) => {
          const response = await globalThis.fetch(url, init as RequestInit)
          const headers: Record<string, string> = {}
          response.headers.forEach((value, key) => {
            headers[key] = value
          })
          return Object.freeze({
            status: response.status,
            statusText: response.statusText,
            headers: Object.freeze(headers),
            body: await response.text(),
          })
        },
      },
      audit: (auditRecord) =>
        this.recordAuditAndPersist(
          manifest.id,
          'network',
          `${auditRecord.ok ? 'fetch' : 'denied'}:${auditRecord.url}`,
          auditRecord.ok === false,
        ),
    })
  }

  async disposeTemporaryStorage(): Promise<void> {
    this.temporaryStorageStopped = true
    await Promise.all([...this.storageBrokers.values()].map((broker) => broker.dispose()))
    this.storageBrokers.clear()
  }

  private createStorageBroker(manifest: PluginManifest) {
    if (!this.storage) {
      return undefined
    }

    const existing = this.storageBrokers.get(manifest.id)
    if (existing) return existing
    const broker = createPluginStorageBroker({
      pluginId: manifest.id,
      adapter: this.storage,
      createTemporaryStore: async () => {
        if (this.temporaryStorageStopped) throw new Error('Temporary plugin storage is closing')
        return this.temporaryStorage.create(manifest.id)
      },
      audit: (auditRecord) =>
        this.recordAuditAndPersist(
          manifest.id,
          'storage',
          `${auditRecord.operation}:${auditRecord.key}`,
          auditRecord.ok === false,
        ),
    })
    this.storageBrokers.set(manifest.id, broker)
    return broker
  }

  private assertApproved(record: PluginRegistryRecord): void {
    const requested = (record.manifest.permissions ?? []).filter((permission) =>
      sensitivePermissions.has(permission),
    )
    const missing = requested.filter(
      (permission) => !record.approvals.permissions.includes(permission),
    )
    const host = record.manifest.host ?? 'worker'

    if (!record.approvals.hosts.includes(host)) {
      missing.push(`host:${host}` as never)
    }

    if (missing.length > 0) {
      throw new Error(`Plugin capabilities require approval: ${missing.join(', ')}`)
    }
  }

  private recordAuditAndPersist(
    pluginId: string,
    operation: 'file' | 'network' | 'storage' | 'sidecar',
    detail: string,
    denied: boolean,
  ): void {
    this.registry.recordAudit(pluginId, operation, detail, denied)
    this.persist()
  }

  private runPluginLifecycle<T>(pluginId: string, operation: () => Promise<T>): Promise<T> {
    this.assertPluginNotReserved(pluginId)
    const pending = this.lifecycleTasks.get(pluginId) ?? Promise.resolve()
    const result = pending.then(operation)
    const completed = result.then(
      () => undefined,
      () => undefined,
    )
    this.lifecycleTasks.set(pluginId, completed)
    void completed.then(() => {
      if (this.lifecycleTasks.get(pluginId) === completed) this.lifecycleTasks.delete(pluginId)
    })
    return result
  }

  private failDocumentRenderer(
    pluginId: string,
    epoch: number,
    kind: 'renderer-timeout' | 'execution-host' = 'renderer-timeout',
  ): void {
    if (this.activationEpochs.get(pluginId) !== epoch) return
    this.activationEpochs.set(pluginId, epoch + 1)
    const published = this.publishedGenerations.get(pluginId)
    this.publishedGenerations.delete(pluginId)
    const gate = this.activationGates.get(pluginId)
    if (gate) gate.committed = false
    for (const brokers of [
      this.documentBrokers,
      this.uiBrokers,
      this.editingBrokers,
      this.resourcesBrokers,
      this.outputBrokers,
      this.keymapBrokers,
      this.settingsBrokers,
      this.workspaceBrokers,
      this.releasesBrokers,
      this.managementBrokers,
    ])
      try {
        brokers.get(pluginId)?.dispose?.()
      } catch (error) {
        this.managerDiagnostics.push('Immediate revocation failed: ' + String(error))
      }
    const message =
      kind === 'renderer-timeout' ? documentRendererTimeoutMessage : executionHostFailureMessage
    if (this.registry.get(pluginId)) this.registry.markFailed(pluginId, new Error(message), kind)
    this.persist()
    try {
      this.invalidatePresentation?.()
    } catch (error) {
      this.managerDiagnostics.push(String(error))
    }
    try {
      this.onDocumentRenderFailure?.(pluginId, kind)
    } catch (error) {
      this.managerDiagnostics.push(String(error))
    }
    void this.runPluginLifecycle(pluginId, async () => {
      // A newer activation performed its own cleanup/recovery; late faults cannot revoke it.
      if (this.activationEpochs.get(pluginId) !== epoch + 1) return
      try {
        if (this.catalog && published && this.catalogEntry(pluginId)?.active?.id === published)
          await this.catalogTransition(pluginId, {
            type: 'markFailed',
            generationId: published,
            message,
          })
      } finally {
        await this.unloadRuntimePlugin(pluginId)
      }
    }).catch((error) => {
      this.managerDiagnostics.push('Fault cleanup: ' + String(error))
    })
  }

  private revokeExecutionEpoch(pluginId: string): void {
    this.activationEpochs.set(pluginId, (this.activationEpochs.get(pluginId) ?? 0) + 1)
    const gate = this.activationGates.get(pluginId)
    if (gate) gate.committed = false
    this.publishedGenerations.delete(pluginId)
    if (this.registry.get(pluginId)) this.registry.markDisabled(pluginId)
    // Contributions disappear with the revoked epoch; owner disposal owns realm cleanup.
    this.activeUi.delete(pluginId)
    const errors = this.revocationErrors.get(pluginId) ?? []
    for (const brokers of [
      this.documentBrokers,
      this.uiBrokers,
      this.editingBrokers,
      this.resourcesBrokers,
      this.outputBrokers,
      this.keymapBrokers,
      this.settingsBrokers,
      this.workspaceBrokers,
      this.releasesBrokers,
      this.managementBrokers,
    ])
      try {
        brokers.get(pluginId)?.dispose?.()
      } catch (error) {
        errors.push(error)
      }
    this.revocationErrors.set(pluginId, errors)
    const info = this.runtime.getPlugin(pluginId)
    if (info && !this.pendingRuntimeCleanup.has(pluginId)) {
      const promise = this.runtime.disablePlugin(pluginId)
      void promise.catch(() => undefined)
      this.pendingRuntimeCleanup.set(pluginId, { promise, before: info.errors.length })
    }
  }
  private async unloadRuntimePlugin(pluginId: string): Promise<void> {
    this.revokeExecutionEpoch(pluginId)
    this.activationGates.delete(pluginId)
    const errors = this.revocationErrors.get(pluginId) ?? []
    this.revocationErrors.delete(pluginId)
    const cleanup: (() => unknown)[] = this.retiringOperations.get(pluginId) ?? []
    this.retiringOperations.delete(pluginId)
    for (const services of [
      this.outputServices,
      this.editingServices,
      this.resourcesServices,
      this.settingsServices,
    ]) {
      const service = services.get(pluginId)
      services.delete(pluginId)
      if (service) cleanup.push(() => service.dispose())
    }
    const runtimeCleanup = this.pendingRuntimeCleanup.get(pluginId)
    this.pendingRuntimeCleanup.delete(pluginId)
    if (runtimeCleanup)
      cleanup.push(async () => {
        const info = await runtimeCleanup.promise
        await this.runtime.unloadPlugin(pluginId)
        const failures = info.errors
          .slice(runtimeCleanup.before)
          .filter((error) => error.phase === 'disable')
        if (failures.length)
          this.managerDiagnostics.push(
            'Plugin cleanup callback rejected: ' +
              failures.map((error) => error.message).join('; '),
          )
      })
    const loaded = this.loadedModules.get(pluginId)
    this.loadedModules.delete(pluginId)
    if (loaded) {
      let attempted = false
      cleanup.push(() => {
        const retry = attempted
        attempted = true
        return retry && loaded.retryDispose ? loaded.retryDispose() : loaded.dispose()
      })
    }
    const storage = this.storageBrokers.get(pluginId)
    this.storageBrokers.delete(pluginId)
    if (storage) cleanup.push(() => storage.dispose())
    const document = this.documentBrokers.get(pluginId)
    if (document) cleanup.push(() => document.cancelAll())
    const prepared = this.preparedModules.get(pluginId)
    this.preparedModules.delete(pluginId)
    if (prepared) {
      let attempted = false
      cleanup.push(() => {
        const retry = attempted
        attempted = true
        return retry && prepared.retryDispose ? prepared.retryDispose() : prepared.dispose?.()
      })
    }
    for (const brokers of [
      this.documentBrokers,
      this.uiBrokers,
      this.editingBrokers,
      this.resourcesBrokers,
      this.outputBrokers,
      this.keymapBrokers,
      this.settingsBrokers,
      this.workspaceBrokers,
      this.releasesBrokers,
      this.managementBrokers,
    ])
      brokers.delete(pluginId)
    const results = await Promise.allSettled(
      cleanup.map((operation) => Promise.resolve().then(operation)),
    )
    const retry: Array<() => unknown> = []
    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        errors.push(result.reason)
        retry.push(cleanup[index]!)
      }
    })
    if (retry.length) this.retiringOperations.set(pluginId, retry)
    this.executingRecords.delete(pluginId)
    if (errors.length) {
      const failure = new AggregateError(errors, 'Plugin cleanup did not fully complete')
      this.managerDiagnostics.push(failure.message + ': ' + errors.map(String).join('; '))
      if (this.registry.get(pluginId)) this.registry.markFailed(pluginId, failure)
      this.persist()
      throw failure
    }
  }

  private async prepareModule(
    manifest: PluginManifest,
    manifestPath: string,
    main: string,
  ): Promise<DesktopPreparedPluginModule> {
    if (this.manifestHost.prepareModule) {
      const entry = this.catalogEntry(manifest.id)
      const generation = [entry?.active, entry?.pending?.generation].find(
        (g) => g && `${g.packageRoot.replace(/[\\/]$/, '')}/plugin.json` === manifestPath,
      )
      if (this.catalog && !generation)
        throw new Error('Module must belong to an active or pending native generation')
      return this.manifestHost.prepareModule(
        manifest,
        manifestPath,
        main,
        generation
          ? { generationId: generation.id, packageRoot: generation.packageRoot }
          : undefined,
      )
    }

    if (manifest.host === 'dom')
      throw new Error('DOM plugins require an installed native prepared lease')

    if (manifest.host === 'sidecar' && /^(?:[A-Za-z]:[\\/]|\/)/.test(main)) {
      return Object.freeze({ specifier: main.replace(/\\/g, '/') })
    }

    return Object.freeze({ specifier: resolvePluginEntryPath(manifestPath, main) })
  }

  private async restoreEnabledPlugins(): Promise<void> {
    for (const record of this.registry.list()) {
      if (this.reservedPluginIds.has(record.manifest.id)) continue
      const directories = await this.manifestHost
        .ensureDataDirectories?.(record.manifest.id)
        .catch(() => undefined)
      if (directories) {
        this.registry.setRoots(record.manifest.id, {
          dataRoot: directories.dataRoot,
          storageRoot: directories.storageRoot,
        })
      }
    }
    const pluginIds = this.registry
      .list()
      .filter(
        (record) =>
          !this.reservedPluginIds.has(record.manifest.id) &&
          record.enabled &&
          record.state === 'enabled',
      )
      .map((record) => record.manifest.id)

    for (const pluginId of pluginIds) {
      await this.enableRestoredPlugin(pluginId)
    }
  }

  private async createPackageArchive(record: PluginRegistryRecord): Promise<PluginPackageArchive> {
    const sourceText = await this.manifestHost.readManifestText(record.manifestPath)
    const sourceValue = parseManifestJson(sourceText, record.manifestPath)

    if (isPluginPackageArchive(sourceValue)) {
      return parsePluginPackageArchive(sourceValue)
    }

    const paths = [record.manifest.main, ...(record.manifest.resources ?? [])].filter(
      (path): path is string => Boolean(path),
    )
    const files: PluginPackageFile[] = []

    for (const path of paths) {
      if (/^[a-zA-Z][a-zA-Z\d+.-]*:/.test(path) || /^(?:\/|\\|[a-zA-Z]:)/.test(path)) {
        throw new Error(`Only files inside the plugin root can be exported: ${path}`)
      }

      if (path === record.manifest.icon) {
        if (!this.manifestHost.readPackageIcon) {
          throw new Error('Installed package icon export is unavailable in this host')
        }
        const bytes = await this.manifestHost.readPackageIcon(record.manifest.id)
        if (bytes.byteLength > 256 * 1024) throw new Error('Plugin icon exceeds 256 KiB')
        files.push(
          Object.freeze({
            path: normalizePackagePath(path),
            encoding: 'base64',
            content: btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join('')),
          }),
        )
        continue
      }

      files.push(
        Object.freeze({
          path: normalizePackagePath(path),
          encoding: 'utf8',
          content: await this.manifestHost.readManifestText(
            resolvePluginEntryPath(record.manifestPath, path),
          ),
        }),
      )
    }

    return createPluginPackageArchive(record.manifest, files)
  }

  private require(pluginId: string): PluginRegistryRecord {
    const record = this.registry.get(pluginId)

    if (!record) {
      throw new Error(`Unknown plugin: ${pluginId}`)
    }

    return record
  }

  private readMirror(key: string): string | null {
    try {
      return this.storage?.getItem(key) ?? null
    } catch (error) {
      this.managerDiagnostics.push('Local mirror unreadable: ' + String(error))
      return null
    }
  }
  private restore(): void {
    const text = this.readMirror(registryStorageKey)

    if (!text) {
      return
    }

    try {
      this.registry.restore(parsePluginRegistrySnapshot(text))
      let migrated = false
      for (const record of this.registry.list()) {
        if (!this.reservedPluginIds.has(record.manifest.id)) continue
        this.registry.revokeApproval(record.manifest.id)
        migrated = true
      }
      if (migrated) this.persist()
    } catch {
      this.managerDiagnostics.push(
        'Legacy registry is corrupt; original bytes retained for native migration',
      )
    }
  }

  private restoreFailures(): void {
    const text = this.readMirror(failuresStorageKey)

    if (!text) {
      return
    }

    try {
      const value = JSON.parse(text) as unknown

      if (!Array.isArray(value)) {
        throw new Error('Invalid plugin failure snapshot')
      }

      for (const failure of value) {
        if (
          typeof failure === 'object' &&
          failure !== null &&
          typeof (failure as DesktopPluginInstallFailure).sourcePath === 'string' &&
          typeof (failure as DesktopPluginInstallFailure).message === 'string' &&
          typeof (failure as DesktopPluginInstallFailure).at === 'number'
        ) {
          this.installFailures.push(Object.freeze({ ...(failure as DesktopPluginInstallFailure) }))
        }
      }
    } catch {
      this.managerDiagnostics.push('Invalid install failure mirror retained')
    }
  }

  private recordInstallFailure(path: string, error: unknown): void {
    this.clearInstallFailure(path, false)
    this.installFailures.push(
      Object.freeze({
        sourcePath: path,
        message: error instanceof Error ? error.message : String(error),
        at: this.now(),
      }),
    )
    this.persistFailures()
  }

  private clearInstallFailure(path: string, persist = true): void {
    const index = this.installFailures.findIndex((failure) => failure.sourcePath === path)

    if (index >= 0) {
      this.installFailures.splice(index, 1)
    }

    if (persist) {
      this.persistFailures()
    }
  }

  private persist(): void {
    try {
      this.storage?.setItem(registryStorageKey, serializePluginRegistry(this.registry))
    } catch (error) {
      this.managerDiagnostics.push('Registry mirror unavailable: ' + String(error))
    }
  }

  private persistFailures(): void {
    try {
      this.storage?.setItem(failuresStorageKey, JSON.stringify(this.installFailures))
    } catch (error) {
      this.managerDiagnostics.push('Failure mirror unavailable: ' + String(error))
    }
  }

  private clearPluginStorage(pluginId: string): void {
    if (!this.storage) return
    const prefix = `milkup.plugin.storage.${pluginId}.`
    const keys = Array.from({ length: this.storage.length }, (_, index) => this.storage?.key(index))

    for (const key of keys) {
      if (key?.startsWith(prefix)) {
        this.storage.removeItem(key)
      }
    }
  }
}

export function createDesktopPluginActions(
  manager: DesktopPluginManager,
): readonly ActionDefinition[] {
  const actions: ActionDefinition[] = [
    {
      id: 'plugin.installLocal',
      title: 'Install Local Plugin',
      category: 'plugin',
      permissions: ['app:control'],
      risk: 'write',
      run: () => manager.installFromPicker(),
    },
    {
      id: 'plugin.enable',
      title: 'Enable Plugin',
      category: 'plugin',
      permissions: ['app:control'],
      risk: 'write',
      inputSchema: pluginIdInputSchema(),
      run: (_context: ActionContext, input: unknown) => manager.enable(readPluginIdInput(input)),
    },
    {
      id: 'plugin.disable',
      title: 'Disable Plugin',
      category: 'plugin',
      permissions: ['app:control'],
      risk: 'write',
      inputSchema: pluginIdInputSchema(),
      run: (_context: ActionContext, input: unknown) => manager.disable(readPluginIdInput(input)),
    },
    {
      id: 'plugin.reload',
      title: 'Reload Plugin',
      category: 'plugin',
      permissions: ['app:control'],
      risk: 'write',
      inputSchema: pluginIdInputSchema(),
      run: (_context: ActionContext, input: unknown) => manager.reload(readPluginIdInput(input)),
    },
    {
      id: 'plugin.remove',
      title: 'Remove Plugin',
      category: 'plugin',
      permissions: ['app:control'],
      risk: 'destructive',
      inputSchema: pluginIdInputSchema(),
      run: (_context: ActionContext, input: unknown) => manager.remove(readPluginIdInput(input)),
    },
    {
      id: 'plugin.export',
      title: 'Export Plugin Package',
      category: 'plugin',
      permissions: ['app:control', 'file:write'],
      risk: 'write',
      inputSchema: pluginIdInputSchema(),
      run: (_context: ActionContext, input: unknown) =>
        manager.exportLocalPackage(readPluginIdInput(input)),
    },
    {
      id: 'plugin.approve',
      title: 'Approve Plugin Capabilities',
      category: 'plugin',
      permissions: ['app:control'],
      risk: 'write',
      inputSchema: pluginIdInputSchema(),
      run: (_context: ActionContext, input: unknown) =>
        manager.approve(
          readPluginIdInput(input),
          (input as { fingerprint?: string }).fingerprint,
          (input as { reviewedRevision?: number }).reviewedRevision,
        ),
    },
    {
      id: 'plugin.rejectCandidate',
      title: 'Reject Plugin Candidate',
      category: 'plugin',
      permissions: ['app:control'],
      risk: 'write',
      inputSchema: {
        type: 'object',
        properties: {
          pluginId: { type: 'string', required: true },
          fingerprint: { type: 'string', required: true },
          reviewedRevision: { type: 'number', required: true },
        },
      },
      run: (_context: ActionContext, input: unknown) => {
        const pluginId = readPluginIdInput(input)
        const { fingerprint, reviewedRevision } = input as {
          fingerprint: unknown
          reviewedRevision: unknown
        }
        if (typeof fingerprint !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(fingerprint))
          throw new Error('Candidate rejection requires a valid reviewed fingerprint')
        if (
          typeof reviewedRevision !== 'number' ||
          !Number.isSafeInteger(reviewedRevision) ||
          reviewedRevision < 0
        )
          throw new Error('Candidate rejection requires a valid reviewed revision')
        return manager.rejectCandidate(pluginId, fingerprint, reviewedRevision)
      },
    },
    {
      id: 'plugin.revokeApproval',
      title: 'Revoke Plugin Capabilities',
      category: 'plugin',
      permissions: ['app:control'],
      risk: 'destructive',
      inputSchema: pluginIdInputSchema(),
      run: (_context: ActionContext, input: unknown) =>
        manager.revokeApproval(readPluginIdInput(input)),
    },
  ]

  return Object.freeze(actions)
}

export interface DesktopPluginManagerView {
  readonly selectedPluginId?: string
  readonly selectedFailurePath?: string
  readonly icons?: ReadonlyMap<string, string>
}

export function renderDesktopPluginManager(
  state: DesktopPluginManagerState,
  view: DesktopPluginManagerView = {},
): string {
  const selected = state.records.find((record) => record.manifest.id === view.selectedPluginId)
  const failure = state.installFailures.find((item) => item.sourcePath === view.selectedFailurePath)
  const entry = state.catalogEntries?.find((item) => item.id === selected?.manifest.id)
  const content = failure
    ? `<article class="plugin-card plugin-detail"><h4 id="plugin-detail-title" tabindex="-1">安装未完成</h4>${renderInstallFailure(failure)}<p>现有插件保持不变。请选择修正后的完整插件包重试。</p><button type="button" class="dialog-button" data-plugin-action="install">${iconSvg(PackagePlus)}选择插件包</button></article>`
    : selected
      ? renderPluginRecord(
          selected,
          view.icons?.get(selected.manifest.id),
          entry,
          state.bundledUpgradeOffers?.[selected.manifest.id],
        ) +
        renderCandidate(entry) +
        renderBundledUpgrade(state.bundledUpgradeOffers?.[selected.manifest.id]) +
        renderPluginDetails(state, selected)
      : `<div class="plugin-list">${state.records
          .map((record) =>
            renderPluginCard(
              record,
              view.icons?.get(record.manifest.id),
              state.catalogEntries?.find((entry) => entry.id === record.manifest.id),
              state.executionUnavailableReasons?.[record.manifest.id],
              state.contributions,
              state.bundledUpgradeOffers?.[record.manifest.id],
            ),
          )
          .join(
            '',
          )}${state.installFailures.map((item) => `<button type="button" class="plugin-card plugin-summary-card" data-plugin-action="failure-details" data-plugin-source="${escapeHtml(item.sourcePath)}">${renderPluginLogo('安装项目')}<span class="plugin-card-copy"><span class="plugin-card-title">${escapeHtml(item.sourcePath.split(/[\\/]/).pop() || '安装项目')}</span><span class="plugin-card-description">查看此安装项目的详情</span></span></button>`).join('')}</div>`
  return [
    '<div class="plugin-manager"><div class="plugin-manager-toolbar">',
    selected || failure
      ? `<button type="button" class="dialog-button" data-plugin-action="back">${iconSvg(ArrowLeft)}返回插件列表</button>`
      : `<button type="button" class="dialog-button primary" data-plugin-action="install">${iconSvg(PackagePlus)}安装本地插件</button>`,
    '</div>',
    content,
    state.diagnostics?.length
      ? `<details><summary>插件目录诊断</summary>${state.diagnostics.map((x) => `<p>${escapeHtml(x)}</p>`).join('')}</details>`
      : '',
    '</div>',
  ].join('')
}

export function pluginCapabilityDifference(
  declared: readonly string[],
  approved: readonly string[],
) {
  return Object.freeze({
    declared: Object.freeze([...declared]),
    approved: Object.freeze([...approved]),
    added: Object.freeze(declared.filter((x) => !approved.includes(x))),
    removed: Object.freeze(approved.filter((x) => !declared.includes(x))),
  })
}
function renderCandidate(entry: PluginCatalogEntry | undefined): string {
  const pending = entry?.pending
  if (!entry || !pending) return ''
  const generation = pending.generation
  const current = entry.active
  const scope = (label: string, next: readonly string[], previous: readonly string[]) => {
    const difference = pluginCapabilityDifference(next, previous)
    return `<div><dt>${label}</dt><dd>新版本：${escapeHtml(next.join(', ') || '无')}<br>当前版本：${escapeHtml(previous.join(', ') || '无')}${difference.added.length ? `<br>新增：${escapeHtml(difference.added.join(', '))}` : ''}${difference.removed.length ? `<br>移除：${escapeHtml(difference.removed.join(', '))}` : ''}</dd></div>`
  }
  return `<section class="plugin-detail-section plugin-candidate"><h4>可用版本 ${escapeHtml(generation.manifest.version)}</h4><p>${current ? '下次开启卡片开关时应用新版本；当前已开启时，先关闭再开启。' : '在插件卡片开启开关即可使用。'}启动验证成功后才会替换当前版本。</p><dl class="plugin-meta"><div><dt>执行环境</dt><dd>${escapeHtml(current?.manifest.host ?? '无')} → ${escapeHtml(generation.manifest.host ?? 'worker')}</dd></div>${scope('权限', generation.manifest.permissions ?? [], current?.manifest.permissions ?? [])}${scope('网络范围', generation.manifest.networkOrigins ?? [], current?.manifest.networkOrigins ?? [])}</dl>${renderExecutionSupport(generation.manifest)}</section>`
}

function upgradeHostLabel(manifest: PluginManifest): string {
  return manifest.host === 'worker' || !manifest.host
    ? 'Worker'
    : manifest.host === 'dom'
      ? 'DOM'
      : 'Sidecar'
}
function renderBundledUpgrade(offer: PluginManifest | undefined): string {
  if (!offer) return ''
  return `<section class="plugin-detail-section plugin-candidate"><h4>随应用提供的新版 ${escapeHtml(offer.version)}</h4><p>下次开启卡片开关时应用；当前已开启时，先关闭再开启。运行方式：${upgradeHostLabel(offer)}。</p>${offer.description ? `<p>${escapeHtml(offer.description)}</p>` : ''}${renderExecutionSupport(offer)}</section>`
}

function renderPluginLogo(name: string, icon?: string): string {
  const image =
    icon && /^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(icon)
      ? `<img src="${icon}" alt="" data-plugin-icon />`
      : ''
  return `<span class="plugin-logo" aria-hidden="true"><span>${escapeHtml(Array.from(name)[0] || '◇')}</span>${image}</span>`
}

function renderPluginCard(
  record: PluginRegistryRecord,
  icon: string | undefined,
  entry: PluginCatalogEntry | undefined,
  unavailable: string | undefined,
  contributions: PluginContributionIndex,
  bundledUpgrade?: PluginManifest,
): string {
  const manifest = record.manifest
  const id = escapeHtml(manifest.id)
  const blocked = !record.enabled && (!!unavailable || !!entry?.tombstone)
  const status = entry?.tombstone
    ? '已移除，等待清理'
    : unavailable || (record.enabled ? '已启用' : '未启用')
  const errors = [...new Set([...record.errors, ...(entry?.diagnostics ?? [])])]
  const views = record.enabled
    ? [
        ...new Map(
          contributions.ui
            .filter(
              (view) =>
                view.pluginId === manifest.id &&
                (view.slot === 'modal' || view.slot === 'menu-page'),
            )
            .map((view) => [view.id, view]),
        ).values(),
      ]
    : []
  const commandIds = new Set(manifest.contributes?.commands?.map((command) => command.id))
  const commands = record.enabled
    ? [
        ...new Map(
          contributions.commands
            .filter((command) => commandIds.has(command.id))
            .map((command) => [command.id, command]),
        ).values(),
      ]
    : []
  const panelButtons = views
    .map(
      (view) =>
        `<button type="button" class="dialog-button plugin-panel-action" data-plugin-action="open-ui" data-plugin-id="${id}" data-plugin-ui-id="${escapeHtml(view.id)}" title="打开 ${escapeHtml(view.title)}">${iconSvg(Settings2)}<span>${escapeHtml(view.title)}</span></button>`,
    )
    .join('')
  const more = `<details class="plugin-card-more" data-plugin-card-more="${id}"><summary class="dialog-button" data-plugin-card-more-trigger="${id}" aria-label="${escapeHtml(manifest.name)} 更多操作" title="更多操作">${iconSvg(Ellipsis)}<span>更多</span></summary><div class="plugin-card-menu" aria-label="${escapeHtml(manifest.name)} 操作">${record.enabled ? `<button type="button" class="dialog-button" data-plugin-action="reload" data-plugin-id="${id}">${iconSvg(RotateCw)}重新加载</button>` : ''}<button type="button" class="dialog-button" data-plugin-action="export" data-plugin-id="${id}">${iconSvg(Download)}导出插件</button>${commands.map((command) => `<button type="button" class="dialog-button" data-plugin-action="command" data-plugin-command="${escapeHtml(command.id)}" data-plugin-id="${id}">${iconSvg(Terminal)}<span>${escapeHtml(command.title)}</span></button>`).join('')}<button type="button" class="dialog-button warning" data-plugin-action="remove" data-plugin-id="${id}">${iconSvg(Trash2)}${entry?.tombstone ? '重试清理' : '移除插件'}</button></div></details>`
  return `<article class="plugin-card plugin-summary-card" data-plugin-id="${id}">${renderPluginLogo(manifest.name, icon)}<div class="plugin-card-copy"><span class="plugin-card-title">${escapeHtml(manifest.name)}</span><span class="plugin-card-description">${escapeHtml(manifest.description || '暂无描述')}</span><span class="plugin-card-status" data-enabled="${record.enabled}">${escapeHtml(status)}</span>${bundledUpgrade ? `<span class="plugin-card-update">随应用新版 ${escapeHtml(bundledUpgrade.version)} · ${upgradeHostLabel(bundledUpgrade)} · 下次开启时应用</span>${bundledUpgrade.description ? `<span class="plugin-card-description">${escapeHtml(bundledUpgrade.description)}</span>` : ''}` : entry?.pending ? `<span class="plugin-card-update">${escapeHtml(entry.pending.generation.manifest.version)} · 下次开启时应用</span>` : ''}${errors.length ? `<span class="plugin-card-error" role="status">操作未完成，请查看详情中的诊断</span>` : ''}</div><button type="button" class="plugin-enable-switch" role="switch" aria-checked="${record.enabled}" aria-label="${escapeHtml(manifest.name)} 启用" data-plugin-action="toggle" data-plugin-id="${id}" ${blocked ? 'disabled' : ''} title="${escapeHtml(blocked ? status : record.enabled ? '关闭插件' : '开启插件')}"><span aria-hidden="true"></span></button><div class="plugin-card-actions">${panelButtons}<button type="button" class="dialog-button" data-plugin-action="details" data-plugin-id="${id}" aria-label="${escapeHtml(manifest.name)} 详情">${iconSvg(Info)}详情</button>${more}</div></article>`
}

function renderPluginDetails(
  state: DesktopPluginManagerState,
  record: PluginRegistryRecord,
): string {
  const id = record.manifest.id
  const commandIds = new Set(record.manifest.contributes?.commands?.map((command) => command.id))
  const contributions: PluginContributionIndex = {
    ...state.contributions,
    commands: state.contributions.commands.filter((command) => commandIds.has(command.id)),
    keymaps: state.contributions.keymaps.filter((binding) => binding.pluginId === id),
    ui: state.contributions.ui.filter((view) => view.pluginId === id),
  }
  return (
    '<section class="plugin-contribution-summary">' +
    renderPluginKeymaps(contributions) +
    renderPluginAudit(state.auditRecords.filter((entry) => entry.pluginId === id)) +
    '</section>'
  )
}

function renderInstallFailure(failure: DesktopPluginInstallFailure): string {
  return `<div class="plugin-errors"><strong>安装失败</strong><br />${escapeHtml(failure.sourcePath)}<br />${escapeHtml(failure.message)}</div>`
}

function renderPluginKeymaps(contributions: PluginContributionIndex): string {
  if (contributions.keymaps.length === 0) {
    return ''
  }

  return [
    '<section class="plugin-detail-section"><h4>快捷键</h4><dl class="plugin-detail-list">',
    ...contributions.keymaps.map(
      (binding) =>
        `<div><dt>${escapeHtml(binding.key)}</dt><dd>${escapeHtml(binding.command)} · ${keymapStatusLabel(binding)}</dd></div>`,
    ),
    '</dl></section>',
  ].join('')
}

function renderPluginAudit(records: DesktopPluginManagerState['auditRecords']): string {
  if (records.length === 0) {
    return ''
  }

  return [
    '<details class="plugin-detail-section"><summary>审计日志</summary><dl class="plugin-detail-list">',
    ...records
      .slice(-20)
      .reverse()
      .map(
        (record) =>
          `<div><dt>${escapeHtml(record.pluginId)} · ${escapeHtml(record.operation)}</dt><dd>${record.denied ? '已拒绝' : '已允许'}${record.detail ? ` · ${escapeHtml(record.detail)}` : ''}</dd></div>`,
      ),
    '</dl></details>',
  ].join('')
}

function renderPluginRecord(
  record: PluginRegistryRecord,
  icon?: string,
  entry?: PluginCatalogEntry,
  bundledUpgrade?: PluginManifest,
): string {
  if (entry?.tombstone)
    return `<article class="plugin-card plugin-detail"><h4 id="plugin-detail-title" tabindex="-1">${escapeHtml(record.manifest.name)}</h4><p>已卸载，权限与启动已撤销。用户数据保留。</p><div class="plugin-errors">${entry.diagnostics.map(escapeHtml).join('<br>')}</div><button type="button" class="dialog-button" data-plugin-action="remove" data-plugin-id="${escapeHtml(entry.id)}">${iconSvg(Trash2)}重试清理安装文件</button></article>`
  const manifest = record.manifest
  const host = manifest.host ?? 'worker'
  const permissions = manifest.permissions?.join(', ') || '无'
  const outputPermission = manifest.permissions?.includes('document:output')
    ? '<p class="plugin-permission-description">导出与打印当前文档：读取当前文档或选区，在你触发命令并选择目标后导出文件，或打开系统打印。仅授权本次输出所需的文档与资源。</p>'
    : ''
  // Runtime publication clears mirror errors, not the native recovery history.
  // Preserve every native event (including identical repeated failures), while
  // excluding copies already present in the rebuildable registry mirror.
  const nativeDiagnostics = entry?.diagnostics ?? []
  const detailErrors = [
    ...record.errors.filter((message) => !nativeDiagnostics.includes(message)),
    ...nativeDiagnostics,
  ]
  const errors = detailErrors.length
    ? `<div class="plugin-errors">${detailErrors.map(escapeHtml).join('<br />')}</div>`
    : ''

  return [
    '<article class="plugin-card plugin-detail" aria-labelledby="plugin-detail-title">',
    '<header>',
    renderPluginLogo(manifest.name, icon),
    '<div class="plugin-detail-heading">',
    `<h4 id="plugin-detail-title" tabindex="-1">${escapeHtml(manifest.name)}</h4>`,
    `<p>${escapeHtml(manifest.id)} · v${escapeHtml(manifest.version)}</p>`,
    '</div>',
    `<span class="plugin-state" data-state="${record.state}">${stateLabel(record.state)}</span>`,
    '</header>',
    `<p>${escapeHtml(manifest.description || '暂无描述')}</p>`,
    '<dl class="plugin-meta">',
    `<div><dt>Milkup 兼容要求</dt><dd>${escapeHtml(manifest.engines?.milkup || '未声明')}</dd></div>`,
    `<div><dt>SDK 兼容要求</dt><dd>${escapeHtml(manifest.engines?.pluginSdk || '未声明')}</dd></div>`,
    `<div><dt>Host</dt><dd>${escapeHtml(host)}</dd></div>`,
    `<div><dt>权限</dt><dd>${escapeHtml(permissions)}</dd></div>`,
    `<div><dt>来源</dt><dd title="${escapeHtml(record.sourcePath)}">${escapeHtml(record.sourcePath)}</dd></div>`,
    `<div><dt>数据</dt><dd>${escapeHtml(record.dataRoot)}</dd></div>`,
    '</dl>',
    outputPermission,
    entry && !bundledUpgrade ? renderExecutionSupport(manifest) : '',
    errors,
    '<footer>',
    record.enabled
      ? `<button type="button" class="dialog-button" data-plugin-action="reload" data-plugin-id="${escapeHtml(manifest.id)}">${iconSvg(RotateCw)}重新加载</button>`
      : '',
    `<button type="button" class="dialog-button" data-plugin-action="export" data-plugin-id="${escapeHtml(manifest.id)}">${iconSvg(Download)}导出插件</button>`,
    `<button type="button" class="dialog-button warning" data-plugin-action="remove" data-plugin-id="${escapeHtml(manifest.id)}">${iconSvg(Trash2)}移除插件</button>`,
    '</footer>',
    record.manifest.settings
      ? `<section data-plugin-settings-schema><h4>设置结构（只读）</h4><pre>${escapeHtml(JSON.stringify(record.manifest.settings, null, 2))}</pre></section>`
      : '',
    '</article>',
  ].join('')
}

function requiresApproval(record: PluginRegistryRecord): boolean {
  const host = record.manifest.host ?? 'worker'
  return (
    !record.approvals.hosts.includes(host) ||
    (record.manifest.permissions ?? [])
      .filter((permission) => sensitivePermissions.has(permission))
      .some((permission) => !record.approvals.permissions.includes(permission))
  )
}

function pluginIdInputSchema(): ActionInputSchema {
  const schema: ActionInputSchema = {
    type: 'object',
    properties: {
      pluginId: { type: 'string', required: true },
      fingerprint: { type: 'string' },
      reviewedRevision: { type: 'number' },
    },
  }

  return Object.freeze(schema)
}

function readPluginIdInput(input: unknown): string {
  const pluginId = (input as { readonly pluginId?: unknown }).pluginId

  if (typeof pluginId !== 'string' || pluginId.trim().length === 0) {
    throw new Error('Plugin action requires pluginId')
  }

  return pluginId
}

function parseManifestJson(text: string, path: string): unknown {
  try {
    return JSON.parse(text) as unknown
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Invalid plugin manifest JSON at ${path}: ${message}`)
  }
}

function directoryOf(path: string): string {
  const normalized = path.replace(/\\/g, '/')
  const index = normalized.lastIndexOf('/')
  return index >= 0 ? normalized.slice(0, index) : '.'
}

export function resolvePluginEntryPath(manifestPath: string, main: string): string {
  if (/^(?:https?|data|blob|milkup):/i.test(main)) {
    return main
  }

  const root = directoryOf(manifestPath).replace(/\\/g, '/').replace(/\/$/, '')
  const parts = main.replace(/\\/g, '/').split('/')
  const resolved: string[] = []

  for (const part of parts) {
    if (!part || part === '.') {
      continue
    }

    if (part === '..') {
      if (resolved.length === 0) {
        throw new Error('Plugin entry must stay inside the plugin package root')
      }
      resolved.pop()
      continue
    }

    resolved.push(part)
  }

  if (resolved.length === 0) {
    throw new Error('Plugin entry path must name a module')
  }

  return `${root}/${resolved.join('/')}`
}

function keymapStatusLabel(binding: PluginContributionIndex['keymaps'][number]): string {
  switch (binding.status) {
    case 'active':
      return '生效'
    case 'shadowed':
      return `冲突，被 ${binding.conflictWith ?? '其他命令'} 覆盖`
    case 'invalid':
      return '不可用'
  }
}

function keymapWhenMatches(
  expression: string | undefined,
  context: DesktopPluginKeymapContext,
): boolean {
  if (!expression) {
    return true
  }

  return expression.split('||').some((alternative) =>
    alternative.split('&&').every((rawTerm) => {
      const term = rawTerm.trim()
      const negated = term.startsWith('!')
      const key = (negated ? term.slice(1) : term) as keyof DesktopPluginKeymapContext

      if (!(key in context)) {
        return false
      }

      return negated ? !context[key] : context[key]
    }),
  )
}

function normalizeExtension(extension: string): string {
  return extension.trim().replace(/^\./, '').toLowerCase()
}

function isMarkdownProviderResult(value: unknown): value is { readonly markdown: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { readonly markdown?: unknown }).markdown === 'string'
  )
}

function readMarkdownProviderResult(value: unknown, contributionId: string): string {
  if (typeof value === 'string') {
    return value
  }

  if (isMarkdownProviderResult(value)) {
    return value.markdown
  }

  throw new Error(`Plugin importer must return Markdown text: ${contributionId}`)
}

function createCustomDocumentResult(
  value: unknown,
  sourcePath: string,
  title: string,
  pluginId: string,
  contributionId: string,
): DesktopPluginDocumentResult {
  const output =
    typeof value === 'object' && value !== null && 'output' in value
      ? (value as { readonly output: unknown }).output
      : value

  if (output === undefined || output === null) {
    throw new Error(`Plugin custom document provider returned no output: ${contributionId}`)
  }

  return Object.freeze({
    kind: 'custom-view',
    output,
    sourcePath,
    title,
    readonly: true as const,
    pluginId,
    contributionId,
  })
}

function eventToKeymap(event: KeyboardEvent): string | undefined {
  if (event.isComposing || (event.altKey && event.ctrlKey && event.metaKey)) {
    return undefined
  }

  const parts: string[] = []

  if (event.ctrlKey || event.metaKey) {
    parts.push('Mod')
  }

  if (event.altKey) {
    parts.push('Alt')
  }

  if (event.shiftKey) {
    parts.push('Shift')
  }

  const key = event.key.length === 1 ? event.key.toUpperCase() : event.key

  if (!key || key === 'Control' || key === 'Meta' || key === 'Alt' || key === 'Shift') {
    return undefined
  }

  parts.push(key)
  return parts.join('+')
}

function stateLabel(state: PluginRegistryRecord['state']): string {
  switch (state) {
    case 'enabled':
      return '已启用'
    case 'disabled':
      return '已禁用'
    case 'failed':
      return '失败'
    case 'installed':
      return '已安装'
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function renderExecutionSupport(manifest: PluginManifest): string {
  const host = manifest.host ?? 'worker'
  const message =
    host === 'sidecar'
      ? '当前插件目录不支持启用 sidecar 插件。'
      : host === 'dom'
        ? '仅支持只读文档呈现：document:read 权限与 documentRenderers 贡献，不允许设置、网络来源或其他贡献。' +
          (supportsRestrictedActivation(manifest)
            ? '还需当前系统提供 DOM 执行环境。'
            : '此 DOM 声明不符合上述范围，无法启用。')
        : 'Worker 仍须通过当前系统的隔离启动验证；满足版本要求不代表当前平台已提供所需执行环境。'
  return `<p class="plugin-execution-support"><strong>执行支持：</strong>${escapeHtml(message)}</p>`
}

function supportsRestrictedActivation(manifest: PluginManifest): boolean {
  if (!manifest.host || manifest.host === 'worker') return true
  return (
    manifest.host === 'dom' &&
    manifest.permissions?.length === 1 &&
    manifest.permissions[0] === 'document:read' &&
    !manifest.settings &&
    !manifest.networkOrigins?.length &&
    !!manifest.contributes?.documentRenderers?.length &&
    Object.keys(manifest.contributes).every((key) => key === 'documentRenderers')
  )
}

/** Preserve typed runtime activation failures at the trusted manager boundary. */
function pluginActivationError(pluginId: string, error: unknown): unknown {
  if (error instanceof Error || typeof error !== 'object' || error === null) return error
  // Read only own data fields; an unknown object's accessors are not a diagnostic contract.
  try {
    const fields = Object.getOwnPropertyDescriptors(error)
    if (
      fields.pluginId?.value === pluginId &&
      fields.phase?.value === 'enable' &&
      typeof fields.message?.value === 'string'
    ) {
      return new Error(`Plugin activation failed: ${fields.message.value}`, { cause: error })
    }
  } catch {
    // Unknown error values retain their original identity and existing handling.
  }
  return error
}

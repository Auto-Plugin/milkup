import type {
  ActionContext,
  ActionDefinition,
  ActionInputSchema,
  ActionPermission,
  ActionRegistry,
} from '@milkup/core'
import {
  createBrowserWorkerPluginHost,
  createPluginDocumentBroker,
  createIsolatedPluginModule,
  createPluginUiBroker,
  createPluginNetworkBroker,
  createPluginStorageBroker,
  createPluginPackageArchive,
  createPluginContributionIndex,
  isPluginPackageArchive,
  normalizePackagePath,
  parsePluginPackageArchive,
  parsePluginRegistrySnapshot,
  PluginRegistry,
  PluginRuntime,
  serializePluginPackageArchive,
  serializePluginRegistry,
  type PluginContributionIndex,
  type ManagedPluginDocumentBroker,
  type PluginManifest,
  type PluginModule,
  type PluginPackageArchive,
  type PluginPackageFile,
  type PluginRegistryRecord,
  type PluginDocumentScanSource,
  type PluginUiBroker,
} from '@milkup/plugin'

import { createDesktopPluginFileBroker } from './plugin-file-broker'

export interface DesktopPluginManifestHost {
  selectManifestPath(): Promise<string | undefined>
  readManifestText(path: string): Promise<string>
  prepareModule?(
    manifest: PluginManifest,
    manifestPath: string,
    main: string,
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

export interface DesktopPreparedPluginModule {
  readonly specifier: string
  dispose?(): void
}

export interface DesktopLoadedPluginModule {
  readonly module: PluginModule
  dispose(): void
}

export interface DesktopPluginModuleCapabilities {
  readonly documentBroker?: ManagedPluginDocumentBroker
  readonly uiBroker?: PluginUiBroker
}

export type DesktopPluginModuleLoader = (
  manifest: PluginManifest,
  moduleSpecifier: string,
  capabilities?: DesktopPluginModuleCapabilities,
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
  readonly actionRegistry: ActionRegistry
  readonly manifestHost: DesktopPluginManifestHost
  readonly permissions: readonly ActionPermission[]
  readonly milkupVersion: string
  readonly pluginSdkVersion: string
  readonly storage?: Storage
  readonly documentSource?: () => PluginDocumentScanSource | undefined
  readonly invalidateUi?: (pluginId: string, viewId?: string) => void | Promise<void>
  readonly revealLine?: (line: number) => void | Promise<void>
  readonly loadModule?: DesktopPluginModuleLoader
  readonly loadSidecarModule?: DesktopPluginModuleLoader
  readonly now?: () => number
}

export interface DesktopPluginManagerState {
  readonly records: readonly PluginRegistryRecord[]
  readonly contributions: PluginContributionIndex
  readonly auditCount: number
  readonly auditRecords: readonly import('@milkup/plugin').PluginAuditRecord[]
  readonly installFailures: readonly DesktopPluginInstallFailure[]
}

const registryStorageKey = 'milkup.desktop.plugins.registry.v1'
const failuresStorageKey = 'milkup.desktop.plugins.failures.v1'
const allowedHosts = Object.freeze(['worker', 'sidecar'] as const)
const sensitivePermissions = new Set([
  'file:read',
  'file:write',
  'file:delete',
  'network:access',
  'app:control',
])

export class DesktopPluginManager {
  private readonly registry: PluginRegistry
  private readonly runtime: PluginRuntime
  private readonly manifestHost: DesktopPluginManifestHost
  private readonly storage: Storage | undefined
  private readonly documentSource: (() => PluginDocumentScanSource | undefined) | undefined
  private readonly invalidateUi:
    ((pluginId: string, viewId?: string) => void | Promise<void>) | undefined
  private readonly revealLine: ((line: number) => void | Promise<void>) | undefined
  private readonly loadModule: DesktopPluginModuleLoader
  private readonly loadSidecarModule: DesktopPluginModuleLoader
  private readonly loadedModules = new Map<string, DesktopLoadedPluginModule>()
  private readonly documentBrokers = new Map<string, ManagedPluginDocumentBroker>()
  private readonly preparedModules = new Map<string, DesktopPreparedPluginModule>()
  private readonly installFailures: DesktopPluginInstallFailure[] = []
  private readonly activeUi = new Map<string, Set<string>>()
  private readonly now: () => number
  readonly ready: Promise<void>

  constructor(options: DesktopPluginManagerOptions) {
    this.manifestHost = options.manifestHost
    this.storage = options.storage
    this.documentSource = options.documentSource
    this.invalidateUi = options.invalidateUi
    this.revealLine = options.revealLine
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
    this.registry = new PluginRegistry({
      allowedHosts,
      compatibility: {
        milkupVersion: options.milkupVersion,
        pluginSdkVersion: options.pluginSdkVersion,
      },
    })
    this.runtime = new PluginRuntime({
      actionRegistry: options.actionRegistry,
      allowedHosts,
      allowedPermissions: options.permissions,
      fileBroker: (manifest) => this.createFileBroker(manifest),
      documentBroker: (manifest) => this.getDocumentBroker(manifest),
      uiBroker: (manifest) => this.createUiBroker(manifest),
      networkBroker: (manifest) => this.createNetworkBroker(manifest),
      storageBroker: (manifest) => this.createStorageBroker(manifest),
    })
    this.restore()
    this.restoreFailures()
    this.ready = this.restoreEnabledPlugins()
  }

  state(): DesktopPluginManagerState {
    return Object.freeze({
      records: this.registry.list(),
      contributions: createPluginContributionIndex(
        this.registry.list(),
        this.runtime.getActionRegistry().list(),
      ),
      auditCount: this.registry.auditLog().length,
      auditRecords: this.registry.auditLog(),
      installFailures: Object.freeze([...this.installFailures]),
    })
  }

  async installFromPicker(): Promise<PluginRegistryRecord | undefined> {
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
      const installed = archive ? await this.manifestHost.installPackage?.(archive) : undefined
      const manifest = archive?.manifest ?? value
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

  async enable(pluginId: string): Promise<PluginRegistryRecord> {
    await this.ready
    return this.enableRestoredPlugin(pluginId)
  }

  private async enableRestoredPlugin(pluginId: string): Promise<PluginRegistryRecord> {
    const record = this.require(pluginId)

    try {
      if (record.errors.length > 0) {
        throw new Error(record.errors.join('; '))
      }

      this.assertApproved(record)

      await this.unloadRuntimePlugin(pluginId)
      const main = record.manifest.main

      if (!main) {
        throw new Error('Plugin manifest must declare main before it can be enabled')
      }

      const prepared = await this.prepareModule(record.manifest, record.manifestPath, main)
      this.preparedModules.set(pluginId, prepared)
      const documentBroker = this.getDocumentBroker(record.manifest)
      const uiBroker = this.createUiBroker(record.manifest)
      const capabilities = Object.freeze({
        ...(documentBroker ? { documentBroker } : {}),
        ...(uiBroker ? { uiBroker } : {}),
      })
      const loaded = await (record.manifest.host === 'sidecar'
        ? this.loadSidecarModule(record.manifest, prepared.specifier, capabilities)
        : this.loadModule(record.manifest, prepared.specifier, capabilities))
      this.loadedModules.set(pluginId, loaded)
      if (record.manifest.host === 'sidecar') {
        this.recordAuditAndPersist(pluginId, 'sidecar', 'started', false)
      }
      this.runtime.loadPlugin({
        manifest: record.manifest,
        module: loaded.module,
      })
      await this.runtime.enablePlugin(pluginId)
      const next = this.registry.markEnabled(pluginId)
      this.persist()
      return next
    } catch (error) {
      await this.unloadRuntimePlugin(pluginId)
      const failed = this.registry.markFailed(pluginId, error)
      this.persist()
      return failed
    }
  }

  async disable(pluginId: string): Promise<PluginRegistryRecord> {
    await this.ready
    await this.unloadRuntimePlugin(pluginId)
    const record = this.registry.markDisabled(pluginId)
    this.persist()
    return record
  }

  async reload(pluginId: string): Promise<PluginRegistryRecord> {
    await this.ready
    const record = this.require(pluginId)
    const wasEnabled = record.enabled
    await this.disable(pluginId)
    const reinstalled = await this.installManifestPath(record.sourcePath)
    this.registry.recordAudit(pluginId, 'reload')
    this.persist()

    if (wasEnabled && reinstalled.errors.length === 0) {
      return this.enable(pluginId)
    }

    return reinstalled
  }

  async remove(pluginId: string): Promise<void> {
    await this.ready
    await this.unloadRuntimePlugin(pluginId)
    const record = this.registry.remove(pluginId)
    if (record) {
      await this.manifestHost.removeInstalledPackage?.(pluginId)
      this.clearPluginStorage(pluginId)
    }
    this.persist()
  }

  approve(pluginId: string): PluginRegistryRecord {
    const record = this.registry.approve(pluginId)
    this.persist()
    return record
  }

  async revokeApproval(pluginId: string): Promise<PluginRegistryRecord> {
    await this.ready
    await this.unloadRuntimePlugin(pluginId)
    const record = this.registry.revokeApproval(pluginId)
    this.persist()
    return record
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

  async renderUi(
    pluginId: string,
    viewId: string,
    phase: DesktopPluginUiPhase,
    state: Readonly<Record<string, unknown>> = {},
  ): Promise<unknown> {
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

    if (phase === 'mount') {
      const active = this.activeUi.get(pluginId) ?? new Set<string>()
      active.add(viewId)
      this.activeUi.set(pluginId, active)
    } else if (phase === 'dispose') {
      this.activeUi.get(pluginId)?.delete(viewId)
    }

    if (result.ok) {
      return result.value
    }

    throw new Error(result.error.message)
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
    const worker = new Worker(new URL('./plugin-worker.ts', import.meta.url), {
      type: 'module',
      name: `milkup-plugin-${manifest.id}`,
    })
    const fileBroker = this.createFileBroker(manifest)
    const networkBroker = this.createNetworkBroker(manifest)
    const storageBroker = this.createStorageBroker(manifest)
    const workerHost = createBrowserWorkerPluginHost({
      worker,
      manifest,
      moduleSpecifier,
      ...(capabilities?.documentBroker ? { documentBroker: capabilities.documentBroker } : {}),
      ...(capabilities?.uiBroker ? { uiBroker: capabilities.uiBroker } : {}),
      ...(fileBroker ? { fileBroker } : {}),
      ...(networkBroker ? { networkBroker } : {}),
      ...(storageBroker ? { storageBroker } : {}),
      timeoutMs: 10_000,
    })

    await workerHost.ready
    return Object.freeze({
      module: createIsolatedPluginModule({
        manifest,
        host: workerHost.host,
      }),
      dispose: () => workerHost.dispose(),
    })
  }

  private createFileBroker(manifest: PluginManifest) {
    const record = this.registry.get(manifest.id)

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
      roots: [{ id: 'plugin-root', path: record.rootPath }],
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
    })
    this.documentBrokers.set(manifest.id, broker)
    return broker
  }

  private createUiBroker(manifest: PluginManifest): PluginUiBroker | undefined {
    const viewIds = (manifest.contributes?.ui ?? []).map((view) => view.id)

    if (viewIds.length === 0 || !this.invalidateUi) return undefined
    return createPluginUiBroker({
      pluginId: manifest.id,
      viewIds,
      update: this.invalidateUi,
      ...(this.revealLine ? { revealLine: this.revealLine } : {}),
    })
  }

  private createNetworkBroker(manifest: PluginManifest) {
    const record = this.registry.get(manifest.id)

    if (
      !record ||
      !manifest.permissions?.includes('network:access') ||
      !record.approvals.permissions.includes('network:access')
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

  private createStorageBroker(manifest: PluginManifest) {
    if (!this.storage) {
      return undefined
    }

    return createPluginStorageBroker({
      pluginId: manifest.id,
      adapter: this.storage,
      audit: (auditRecord) =>
        this.recordAuditAndPersist(
          manifest.id,
          'storage',
          `${auditRecord.operation}:${auditRecord.key}`,
          auditRecord.ok === false,
        ),
    })
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

  private async unloadRuntimePlugin(pluginId: string): Promise<void> {
    for (const viewId of this.activeUi.get(pluginId) ?? []) {
      await this.renderUi(pluginId, viewId, 'dispose').catch(() => undefined)
    }
    this.activeUi.delete(pluginId)
    await this.runtime.unloadPlugin(pluginId).catch(() => undefined)
    this.loadedModules.get(pluginId)?.dispose()
    this.loadedModules.delete(pluginId)
    await this.documentBrokers.get(pluginId)?.cancelAll()
    this.documentBrokers.delete(pluginId)
    this.preparedModules.get(pluginId)?.dispose?.()
    this.preparedModules.delete(pluginId)
  }

  private async prepareModule(
    manifest: PluginManifest,
    manifestPath: string,
    main: string,
  ): Promise<DesktopPreparedPluginModule> {
    if (this.manifestHost.prepareModule) {
      return this.manifestHost.prepareModule(manifest, manifestPath, main)
    }

    if (manifest.host === 'sidecar' && /^(?:[A-Za-z]:[\\/]|\/)/.test(main)) {
      return Object.freeze({ specifier: main.replace(/\\/g, '/') })
    }

    return Object.freeze({ specifier: resolvePluginEntryPath(manifestPath, main) })
  }

  private async restoreEnabledPlugins(): Promise<void> {
    for (const record of this.registry.list()) {
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
      .filter((record) => record.enabled && record.state === 'enabled')
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

  private restore(): void {
    const text = this.storage?.getItem(registryStorageKey)

    if (!text) {
      return
    }

    try {
      this.registry.restore(parsePluginRegistrySnapshot(text))
    } catch {
      this.storage?.removeItem(registryStorageKey)
    }
  }

  private restoreFailures(): void {
    const text = this.storage?.getItem(failuresStorageKey)

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
      this.storage?.removeItem(failuresStorageKey)
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
    this.storage?.setItem(registryStorageKey, serializePluginRegistry(this.registry))
  }

  private persistFailures(): void {
    this.storage?.setItem(failuresStorageKey, JSON.stringify(this.installFailures))
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
      run: (_context: ActionContext, input: unknown) => manager.approve(readPluginIdInput(input)),
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

export function renderDesktopPluginManager(state: DesktopPluginManagerState): string {
  const records = state.records

  return [
    '<div class="plugin-manager">',
    '<div class="plugin-manager-toolbar">',
    '<button type="button" class="dialog-button primary" data-plugin-action="install">安装本地插件</button>',
    `<span>${records.length} 个已安装 · ${state.auditCount} 条审计</span>`,
    '</div>',
    state.installFailures.length > 0
      ? `<div class="plugin-install-failures">${state.installFailures.map(renderInstallFailure).join('')}</div>`
      : '',
    records.length === 0
      ? '<p class="empty-copy">暂无已安装插件</p>'
      : `<div class="plugin-list">${records.map(renderPluginRecord).join('')}</div>`,
    '<section class="plugin-contribution-summary">',
    '<h4>贡献点</h4>',
    `<p>命令 ${state.contributions.commands.length} · 快捷键 ${state.contributions.keymaps.length} · 渲染器 ${state.contributions.renderers.length} · UI ${state.contributions.ui.length} · 导入器 ${state.contributions.importers.length}</p>`,
    renderPluginCommands(state.contributions),
    renderPluginKeymaps(state.contributions),
    renderPluginUiContributions(state.contributions),
    renderPluginAudit(state.auditRecords),
    '</section>',
    '</div>',
  ].join('')
}

function renderPluginUiContributions(contributions: PluginContributionIndex): string {
  if (contributions.ui.length === 0) {
    return ''
  }

  return [
    '<section class="plugin-detail-section"><h4>界面扩展</h4><div class="plugin-command-list">',
    ...contributions.ui.map((view) =>
      view.slot === 'modal'
        ? `<button type="button" class="dialog-button" data-plugin-action="open-ui" data-plugin-id="${escapeHtml(view.pluginId)}" data-plugin-ui-id="${escapeHtml(view.id)}">打开 ${escapeHtml(view.title)}</button>`
        : `<span class="plugin-ui-contribution-label">${escapeHtml(view.title)} · ${escapeHtml(view.slot)}</span>`,
    ),
    '</div></section>',
  ].join('')
}

function renderInstallFailure(failure: DesktopPluginInstallFailure): string {
  return `<div class="plugin-errors"><strong>安装失败</strong><br />${escapeHtml(failure.sourcePath)}<br />${escapeHtml(failure.message)}</div>`
}

function renderPluginCommands(contributions: PluginContributionIndex): string {
  if (contributions.commands.length === 0) {
    return ''
  }

  return [
    '<section class="plugin-detail-section"><h4>命令</h4><div class="plugin-command-list">',
    ...contributions.commands.map(
      (command) =>
        `<button type="button" class="dialog-button" data-plugin-action="command" data-plugin-command="${escapeHtml(command.id)}">${escapeHtml(command.title)}</button>`,
    ),
    '</div></section>',
  ].join('')
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

function renderPluginRecord(record: PluginRegistryRecord): string {
  const manifest = record.manifest
  const host = manifest.host ?? 'worker'
  const permissions = manifest.permissions?.join(', ') || '无'
  const approvalRequired = requiresApproval(record)
  const errors = record.errors.length
    ? `<div class="plugin-errors">${record.errors.map(escapeHtml).join('<br />')}</div>`
    : ''
  const primaryAction = record.enabled
    ? `<button type="button" class="dialog-button" data-plugin-action="disable" data-plugin-id="${escapeHtml(manifest.id)}">禁用</button>`
    : `<button type="button" class="dialog-button primary" data-plugin-action="enable" data-plugin-id="${escapeHtml(manifest.id)}">启用</button>`

  return [
    '<article class="plugin-card">',
    '<header>',
    '<div>',
    `<h4>${escapeHtml(manifest.name)}</h4>`,
    `<p>${escapeHtml(manifest.id)} · v${escapeHtml(manifest.version)}</p>`,
    '</div>',
    `<span class="plugin-state" data-state="${record.state}">${stateLabel(record.state)}</span>`,
    '</header>',
    '<dl class="plugin-meta">',
    `<div><dt>Host</dt><dd>${escapeHtml(host)}</dd></div>`,
    `<div><dt>权限</dt><dd>${escapeHtml(permissions)}</dd></div>`,
    `<div><dt>审批</dt><dd>${approvalRequired ? '待审批' : '已批准'}</dd></div>`,
    `<div><dt>来源</dt><dd title="${escapeHtml(record.sourcePath)}">${escapeHtml(record.sourcePath)}</dd></div>`,
    `<div><dt>数据</dt><dd>${escapeHtml(record.dataRoot)}</dd></div>`,
    '</dl>',
    errors,
    '<footer>',
    primaryAction,
    approvalRequired
      ? `<button type="button" class="dialog-button" data-plugin-action="approve" data-plugin-id="${escapeHtml(manifest.id)}">批准能力</button>`
      : `<button type="button" class="dialog-button" data-plugin-action="revoke-approval" data-plugin-id="${escapeHtml(manifest.id)}">撤销审批</button>`,
    `<button type="button" class="dialog-button" data-plugin-action="reload" data-plugin-id="${escapeHtml(manifest.id)}">重载</button>`,
    `<button type="button" class="dialog-button" data-plugin-action="export" data-plugin-id="${escapeHtml(manifest.id)}">导出</button>`,
    `<button type="button" class="dialog-button warning" data-plugin-action="remove" data-plugin-id="${escapeHtml(manifest.id)}">移除</button>`,
    '</footer>',
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

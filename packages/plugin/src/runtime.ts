import {
  ActionRegistry,
  BasicEditor,
  type ActionContext,
  type ActionDefinition,
  type ActionPermission,
  type ActionRiskLevel,
  type Command,
  type Editor,
  type Transaction,
} from '@milkup/core'

import { createPluginFileHostCapabilities, type PluginFileBroker } from './filesystem-broker'
import {
  parsePluginManifest,
  type PluginCommandContribution,
  type PluginHostKind,
  type PluginManifest,
  type PluginPermission,
  type PluginRendererContribution,
} from './manifest'
import { createPluginNetworkHostCapabilities, type PluginNetworkBroker } from './network-broker'

export type PluginLifecycleState = 'loaded' | 'enabled' | 'disabled'
export type PluginRuntimePhase =
  'load' | 'enable' | 'disable' | 'unload' | 'reload' | 'command' | 'renderer'

export interface PluginRuntimeOptions {
  readonly actionRegistry?: ActionRegistry
  readonly allowedPermissions?: readonly PluginPermission[]
  readonly allowedHosts?: readonly PluginHostKind[]
  readonly allowInProcessModules?: boolean
  readonly host?: PluginHostCapabilities
  readonly fileBroker?: PluginFileBroker | PluginFileBrokerProvider
  readonly networkBroker?: PluginNetworkBroker | PluginNetworkBrokerProvider
}

export type PluginFileBrokerProvider = (manifest: PluginManifest) => PluginFileBroker | undefined
export type PluginNetworkBrokerProvider = (
  manifest: PluginManifest,
) => PluginNetworkBroker | undefined

export interface PluginLoadConfig {
  readonly manifest: unknown
  readonly module?: PluginModule
}

export interface PluginActivationContext {
  readonly manifest: PluginManifest
  readonly pluginId: string
  readonly permissions: readonly PluginPermission[]
  readonly host: RestrictedPluginHost
}

export interface PluginCommandContext extends ActionContext {
  readonly plugin: PluginRuntimeInfo
  readonly command: PluginCommandContribution
  readonly host: RestrictedPluginHost
}

export type PluginCommandHandler = (
  context: PluginCommandContext,
  input: unknown,
) => unknown | Promise<unknown>

export interface PluginRendererContext {
  readonly nodeType: string
  readonly source?: string
  readonly node?: unknown
}

export type PluginRenderer = (context: PluginRendererContext) => unknown | Promise<unknown>

export interface PluginActivation {
  readonly commands?: Readonly<Record<string, PluginCommandHandler>>
  readonly renderers?: Readonly<Record<string, PluginRenderer>>
  dispose?(): void | Promise<void>
}

export interface PluginModule {
  readonly runtimeHost?: 'isolated'
  readonly commands?: Readonly<Record<string, PluginCommandHandler>>
  readonly renderers?: Readonly<Record<string, PluginRenderer>>
  activate?(
    context: PluginActivationContext,
  ): PluginActivation | void | Promise<PluginActivation | void>
  deactivate?(): void | Promise<void>
}

export interface PluginHostCapabilities {
  readText?(path: string): string | Promise<string>
  writeText?(path: string, text: string): void | Promise<void>
  deleteFile?(path: string): void | Promise<void>
  fetch?(url: string, init?: unknown): unknown | Promise<unknown>
}

export interface RestrictedPluginHost {
  readonly readText?: PluginHostCapabilities['readText']
  readonly writeText?: PluginHostCapabilities['writeText']
  readonly deleteFile?: PluginHostCapabilities['deleteFile']
  readonly fetch?: PluginHostCapabilities['fetch']
}

export interface PluginRuntimeInfo {
  readonly id: string
  readonly manifest: PluginManifest
  readonly state: PluginLifecycleState
  readonly registeredActions: readonly string[]
  readonly errors: readonly PluginRuntimeErrorRecord[]
}

export interface PluginRuntimeErrorRecord {
  readonly pluginId: string
  readonly phase: PluginRuntimePhase
  readonly message: string
  readonly commandId?: string
  readonly rendererId?: string
}

export interface PluginCommandSuccess {
  readonly ok: true
  readonly value: unknown
}

export interface PluginCommandFailure {
  readonly ok: false
  readonly error: PluginRuntimeErrorRecord
}

export type PluginCommandRunResult = PluginCommandSuccess | PluginCommandFailure

export interface PluginRendererSuccess {
  readonly ok: true
  readonly value: unknown
}

export interface PluginRendererFailure {
  readonly ok: false
  readonly fallback: true
  readonly error: PluginRuntimeErrorRecord
}

export type PluginRendererRunResult = PluginRendererSuccess | PluginRendererFailure

const ACTION_PERMISSIONS = new Set<ActionPermission>([
  'document:read',
  'document:write',
  'view:read',
  'view:write',
  'file:read',
  'file:write',
  'file:delete',
  'network:access',
  'app:control',
])

export class PluginRuntime {
  private readonly plugins = new Map<string, LoadedPlugin>()
  private readonly actionRegistry: ActionRegistry
  private readonly allowedPermissions: readonly PluginPermission[]
  private readonly allowedHosts: readonly PluginHostKind[]
  private readonly allowInProcessModules: boolean
  private readonly host: PluginHostCapabilities
  private readonly fileBroker: PluginFileBroker | PluginFileBrokerProvider | undefined
  private readonly networkBroker: PluginNetworkBroker | PluginNetworkBrokerProvider | undefined

  constructor(options: PluginRuntimeOptions = {}) {
    this.actionRegistry = options.actionRegistry ?? new ActionRegistry()
    this.allowedPermissions = Object.freeze([...(options.allowedPermissions ?? [])])
    this.allowedHosts = Object.freeze([...(options.allowedHosts ?? ['worker'])])
    this.allowInProcessModules = options.allowInProcessModules ?? false
    this.host = options.host ?? {}
    this.fileBroker = options.fileBroker
    this.networkBroker = options.networkBroker
  }

  loadPlugin(config: PluginLoadConfig): PluginRuntimeInfo {
    const manifest = parsePluginManifest(config.manifest)

    if (this.plugins.has(manifest.id)) {
      throw new Error(`Plugin is already loaded: ${manifest.id}`)
    }

    const plugin: LoadedPlugin = {
      manifest,
      module: config.module,
      state: 'loaded',
      activation: undefined,
      registeredActions: [],
      errors: [],
    }

    this.plugins.set(manifest.id, plugin)
    return toInfo(plugin)
  }

  async enablePlugin(pluginId: string): Promise<PluginRuntimeInfo> {
    const plugin = this.requirePlugin(pluginId)

    if (plugin.state === 'enabled') {
      return toInfo(plugin)
    }

    this.assertHostAllowed(plugin)
    this.assertModuleHostAllowed(plugin)
    this.assertPermissionsAllowed(plugin)

    try {
      const activation = await plugin.module?.activate?.({
        manifest: plugin.manifest,
        pluginId: plugin.manifest.id,
        permissions: Object.freeze([...(plugin.manifest.permissions ?? [])]),
        host: createRestrictedHost(
          plugin.manifest,
          this.host,
          resolvePluginFileBroker(plugin.manifest, this.fileBroker),
          resolvePluginNetworkBroker(plugin.manifest, this.networkBroker),
        ),
      })

      plugin.activation = activation ?? undefined
      this.registerPluginActions(plugin)
      plugin.state = 'enabled'
    } catch (error) {
      this.unregisterPluginActions(plugin)
      throw this.recordError(plugin, 'enable', error)
    }

    return toInfo(plugin)
  }

  async disablePlugin(pluginId: string): Promise<PluginRuntimeInfo> {
    const plugin = this.requirePlugin(pluginId)

    if (plugin.state !== 'enabled') {
      plugin.state = 'disabled'
      return toInfo(plugin)
    }

    this.unregisterPluginActions(plugin)
    plugin.state = 'disabled'

    try {
      await plugin.activation?.dispose?.()
      await plugin.module?.deactivate?.()
      plugin.activation = undefined
    } catch (error) {
      this.recordError(plugin, 'disable', error)
    }

    return toInfo(plugin)
  }

  async unloadPlugin(pluginId: string): Promise<void> {
    const plugin = this.requirePlugin(pluginId)

    await this.disablePlugin(pluginId)
    this.plugins.delete(plugin.manifest.id)
  }

  async reloadPlugin(
    pluginId: string,
    next: Partial<PluginLoadConfig> = {},
  ): Promise<PluginRuntimeInfo> {
    const plugin = this.requirePlugin(pluginId)
    const shouldReenable = plugin.state === 'enabled'
    const nextManifest =
      next.manifest === undefined ? plugin.manifest : parsePluginManifest(next.manifest)

    if (nextManifest.id !== pluginId) {
      throw new Error(`Reloaded plugin id mismatch: expected ${pluginId}, got ${nextManifest.id}`)
    }

    await this.disablePlugin(pluginId)
    plugin.manifest = nextManifest

    if (Object.prototype.hasOwnProperty.call(next, 'module')) {
      plugin.module = next.module
    }

    plugin.errors = []
    plugin.state = 'loaded'

    if (shouldReenable) {
      return this.enablePlugin(pluginId)
    }

    return toInfo(plugin)
  }

  getPlugin(pluginId: string): PluginRuntimeInfo | undefined {
    const plugin = this.plugins.get(pluginId)
    return plugin ? toInfo(plugin) : undefined
  }

  listPlugins(): readonly PluginRuntimeInfo[] {
    return Object.freeze([...this.plugins.values()].map(toInfo))
  }

  getActionRegistry(): ActionRegistry {
    return this.actionRegistry
  }

  async render(
    pluginId: string,
    rendererId: string,
    context: PluginRendererContext,
  ): Promise<PluginRendererRunResult> {
    const plugin = this.requirePlugin(pluginId)
    const renderer = this.findRenderer(plugin, rendererId)

    if (plugin.state !== 'enabled' || !renderer) {
      return {
        ok: false,
        fallback: true,
        error: this.recordError(plugin, 'renderer', `Renderer is not available: ${rendererId}`, {
          rendererId,
        }),
      }
    }

    try {
      return Object.freeze({
        ok: true,
        value: await renderer(context),
      })
    } catch (error) {
      return {
        ok: false,
        fallback: true,
        error: this.recordError(plugin, 'renderer', error, { rendererId }),
      }
    }
  }

  private async runPluginCommand(
    plugin: LoadedPlugin,
    command: PluginCommandContribution,
    context: ActionContext,
    input: unknown,
  ): Promise<PluginCommandRunResult> {
    const handler = this.findCommandHandler(plugin, command.action)

    if (plugin.state !== 'enabled' || !handler) {
      return {
        ok: false,
        error: this.recordError(plugin, 'command', `Command is not available: ${command.action}`, {
          commandId: command.action,
        }),
      }
    }

    const bufferedEditor = context.editor ? new BufferedPluginEditor(context.editor) : undefined
    const commandContext: PluginCommandContext = {
      plugin: toInfo(plugin),
      command,
      host: createRestrictedHost(
        plugin.manifest,
        this.host,
        resolvePluginFileBroker(plugin.manifest, this.fileBroker),
        resolvePluginNetworkBroker(plugin.manifest, this.networkBroker),
        effectiveCommandPermissions(plugin.manifest, command),
      ),
      ...(context.permissions ? { permissions: context.permissions } : {}),
      ...(context.confirm ? { confirm: context.confirm } : {}),
      ...(bufferedEditor ? { editor: bufferedEditor } : {}),
    }

    try {
      const value = await handler(commandContext, input)
      bufferedEditor?.commit()

      return Object.freeze({
        ok: true,
        value,
      })
    } catch (error) {
      return {
        ok: false,
        error: this.recordError(plugin, 'command', error, { commandId: command.action }),
      }
    }
  }

  private registerPluginActions(plugin: LoadedPlugin): void {
    const registered: string[] = []

    try {
      for (const command of plugin.manifest.contributes?.commands ?? []) {
        const action = this.createAction(plugin, command)
        this.actionRegistry.register(action)
        registered.push(action.id)
      }
    } catch (error) {
      for (const actionId of registered) {
        this.actionRegistry.unregister(actionId)
      }

      throw error
    }

    plugin.registeredActions = registered
  }

  private unregisterPluginActions(plugin: LoadedPlugin): void {
    for (const actionId of plugin.registeredActions) {
      this.actionRegistry.unregister(actionId)
    }

    plugin.registeredActions = []
  }

  private createAction(
    plugin: LoadedPlugin,
    command: PluginCommandContribution,
  ): ActionDefinition<unknown, PluginCommandRunResult> {
    const permissions = actionPermissionsFor(plugin.manifest, command)
    const risk = riskForPermissions(permissions)

    return Object.freeze({
      id: command.action,
      title: command.title,
      category: 'plugin',
      description: `${plugin.manifest.name}: ${command.title}`,
      ...(command.inputSchema ? { inputSchema: command.inputSchema } : {}),
      permissions,
      risk,
      ...(risk === 'destructive' ? { requiresConfirmation: true } : {}),
      run: (context: ActionContext, input: unknown) =>
        this.runPluginCommand(plugin, command, context, input),
    })
  }

  private assertPermissionsAllowed(plugin: LoadedPlugin): void {
    const denied = (plugin.manifest.permissions ?? []).filter(
      (permission) => !this.allowedPermissions.includes(permission),
    )

    if (denied.length > 0) {
      throw this.recordError(
        plugin,
        'enable',
        `Plugin permissions are not allowed: ${denied.join(', ')}`,
      )
    }
  }

  private assertHostAllowed(plugin: LoadedPlugin): void {
    const host = effectivePluginHost(plugin.manifest)

    if (!this.allowedHosts.includes(host)) {
      throw this.recordError(
        plugin,
        'enable',
        `Plugin host is not allowed: ${host}. Allowed hosts: ${this.allowedHosts.join(', ')}`,
      )
    }
  }

  private assertModuleHostAllowed(plugin: LoadedPlugin): void {
    if (!plugin.module || plugin.module.runtimeHost === 'isolated' || this.allowInProcessModules) {
      return
    }

    throw this.recordError(
      plugin,
      'enable',
      'In-process plugin modules are not allowed by this runtime',
    )
  }

  private requirePlugin(pluginId: string): LoadedPlugin {
    const plugin = this.plugins.get(pluginId)

    if (!plugin) {
      throw new Error(`Unknown plugin: ${pluginId}`)
    }

    return plugin
  }

  private findCommandHandler(
    plugin: LoadedPlugin,
    actionId: string,
  ): PluginCommandHandler | undefined {
    return plugin.activation?.commands?.[actionId] ?? plugin.module?.commands?.[actionId]
  }

  private findRenderer(plugin: LoadedPlugin, rendererId: string): PluginRenderer | undefined {
    return plugin.activation?.renderers?.[rendererId] ?? plugin.module?.renderers?.[rendererId]
  }

  private recordError(
    plugin: LoadedPlugin,
    phase: PluginRuntimePhase,
    error: unknown,
    detail: ErrorDetail = {},
  ): PluginRuntimeErrorRecord {
    const record = Object.freeze({
      pluginId: plugin.manifest.id,
      phase,
      message: error instanceof Error ? error.message : String(error),
      ...(detail.commandId ? { commandId: detail.commandId } : {}),
      ...(detail.rendererId ? { rendererId: detail.rendererId } : {}),
    })

    plugin.errors.push(record)
    return record
  }
}

interface LoadedPlugin {
  manifest: PluginManifest
  module: PluginModule | undefined
  state: PluginLifecycleState
  activation: PluginActivation | undefined
  registeredActions: string[]
  errors: PluginRuntimeErrorRecord[]
}

interface ErrorDetail {
  readonly commandId?: string
  readonly rendererId?: string
}

class BufferedPluginEditor implements Editor {
  private readonly shadow: BasicEditor
  private readonly transactions: Transaction[] = []

  constructor(private readonly target: Editor) {
    this.shadow = new BasicEditor(target.state)
  }

  get state() {
    return this.shadow.state
  }

  dispatch(transaction: Transaction): void {
    this.transactions.push(transaction)
    this.shadow.dispatch(transaction)
  }

  command(command: Command): boolean {
    return command.run(this)
  }

  undo(): boolean {
    return false
  }

  redo(): boolean {
    return false
  }

  commit(): void {
    for (const transaction of this.transactions) {
      this.target.dispatch(transaction)
    }
  }
}

function toInfo(plugin: LoadedPlugin): PluginRuntimeInfo {
  return Object.freeze({
    id: plugin.manifest.id,
    manifest: plugin.manifest,
    state: plugin.state,
    registeredActions: Object.freeze([...plugin.registeredActions]),
    errors: Object.freeze([...plugin.errors]),
  })
}

function actionPermissionsFor(
  manifest: PluginManifest,
  command: PluginCommandContribution,
): readonly ActionPermission[] {
  return Object.freeze(
    effectiveCommandPermissions(manifest, command).filter(
      (permission): permission is ActionPermission =>
        ACTION_PERMISSIONS.has(permission as ActionPermission),
    ),
  )
}

function effectiveCommandPermissions(
  manifest: PluginManifest,
  command: PluginCommandContribution,
): readonly PluginPermission[] {
  return command.permissions ?? manifest.permissions ?? []
}

function effectivePluginHost(manifest: PluginManifest): PluginHostKind {
  return manifest.host ?? 'worker'
}

function riskForPermissions(permissions: readonly ActionPermission[]): ActionRiskLevel {
  if (permissions.includes('file:delete') || permissions.includes('app:control')) {
    return 'destructive'
  }

  if (
    permissions.includes('document:write') ||
    permissions.includes('view:write') ||
    permissions.includes('file:write') ||
    permissions.includes('network:access')
  ) {
    return 'write'
  }

  return 'safe'
}

function createRestrictedHost(
  manifest: PluginManifest,
  host: PluginHostCapabilities,
  fileBroker?: PluginFileBroker,
  networkBroker?: PluginNetworkBroker,
  permissions: readonly PluginPermission[] = manifest.permissions ?? [],
): RestrictedPluginHost {
  const fileHost = fileBroker ? createPluginFileHostCapabilities(fileBroker) : host
  const networkHost = networkBroker ? createPluginNetworkHostCapabilities(networkBroker) : host

  return Object.freeze({
    ...(permissions.includes('file:read') && fileHost.readText
      ? { readText: fileHost.readText }
      : {}),
    ...(permissions.includes('file:write') && fileHost.writeText
      ? { writeText: fileHost.writeText }
      : {}),
    ...(permissions.includes('file:delete') && fileHost.deleteFile
      ? { deleteFile: fileHost.deleteFile }
      : {}),
    ...(permissions.includes('network:access') && networkHost.fetch
      ? { fetch: networkHost.fetch }
      : {}),
  })
}

function resolvePluginFileBroker(
  manifest: PluginManifest,
  fileBroker: PluginFileBroker | PluginFileBrokerProvider | undefined,
): PluginFileBroker | undefined {
  return typeof fileBroker === 'function' ? fileBroker(manifest) : fileBroker
}

function resolvePluginNetworkBroker(
  manifest: PluginManifest,
  networkBroker: PluginNetworkBroker | PluginNetworkBrokerProvider | undefined,
): PluginNetworkBroker | undefined {
  return typeof networkBroker === 'function' ? networkBroker(manifest) : networkBroker
}

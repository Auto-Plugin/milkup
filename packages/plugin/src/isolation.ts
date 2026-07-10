import { ChangeSet, Selection, type Transaction } from '@milkup/core'

import type {
  PluginCommandContribution,
  PluginManifest,
  PluginPermission,
  PluginRendererContribution,
} from './manifest'
import type {
  PluginActivation,
  PluginActivationContext,
  PluginCommandContext,
  PluginModule,
  PluginRendererContext,
  RestrictedPluginHost,
} from './runtime'

export interface PluginIsolationHost {
  activate(
    request: IsolatedPluginActivateRequest,
  ): IsolatedPluginActivateResult | Promise<IsolatedPluginActivateResult>
  deactivate(request: IsolatedPluginDeactivateRequest): void | Promise<void>
  runCommand(
    request: IsolatedPluginCommandRequest,
  ): IsolatedPluginCommandResult | Promise<IsolatedPluginCommandResult>
  render(request: IsolatedPluginRenderRequest): unknown | Promise<unknown>
  dispose?(request: IsolatedPluginDeactivateRequest): void | Promise<void>
}

export interface IsolatedPluginModuleConfig {
  readonly manifest: PluginManifest
  readonly host: PluginIsolationHost
}

export interface IsolatedPluginActivateRequest {
  readonly pluginId: string
  readonly manifest: PluginManifest
  readonly permissions: readonly PluginPermission[]
  readonly hostCapabilities: readonly PluginHostCapabilityName[]
}

export interface IsolatedPluginActivateResult {
  readonly commands?: readonly string[]
  readonly renderers?: readonly string[]
}

export interface IsolatedPluginDeactivateRequest {
  readonly pluginId: string
}

export interface IsolatedPluginCommandRequest {
  readonly pluginId: string
  readonly command: PluginCommandContribution
  readonly input: unknown
  readonly selection?: SerializedSelection
  readonly permissions: readonly string[]
  readonly hostCapabilities: readonly PluginHostCapabilityName[]
}

export interface IsolatedPluginCommandResult {
  readonly value?: unknown
  readonly transactions?: readonly SerializedTransaction[]
}

export interface IsolatedPluginRenderRequest {
  readonly pluginId: string
  readonly renderer: PluginRendererContribution
  readonly context: PluginRendererContext
}

export interface SerializedTransaction {
  readonly changes?: readonly SerializedChange[]
  readonly selection?: SerializedSelection
  readonly historyGroup?: 'merge' | 'isolate'
}

export interface SerializedChange {
  readonly from: number
  readonly to: number
  readonly insert: string
}

export interface SerializedSelection {
  readonly anchor: number
  readonly head?: number
}

export type PluginHostCapabilityName =
  | 'document:read'
  | 'ui:update'
  | 'file:read'
  | 'file:write'
  | 'file:delete'
  | 'network:access'
  | 'storage'

export function createIsolatedPluginModule(config: IsolatedPluginModuleConfig): PluginModule {
  const { manifest, host } = config

  return Object.freeze({
    runtimeHost: 'isolated' as const,
    activate: async (context: PluginActivationContext): Promise<PluginActivation> => {
      const activated = await host.activate({
        pluginId: context.pluginId,
        manifest: context.manifest,
        permissions: context.permissions,
        hostCapabilities: listRestrictedHostCapabilities(context.host),
      })
      const allowedCommands = new Set(
        activated.commands ??
          manifest.contributes?.commands?.map((command) => command.action) ??
          [],
      )
      const allowedRenderers = new Set(
        activated.renderers ??
          listRenderableContributions(manifest).map((renderer) => renderer.id) ??
          [],
      )

      return Object.freeze({
        commands: createIsolatedCommandHandlers(manifest, host, allowedCommands),
        renderers: createIsolatedRenderers(manifest, host, allowedRenderers),
        dispose: () => host.dispose?.({ pluginId: manifest.id }),
      })
    },
    deactivate: () => host.deactivate({ pluginId: manifest.id }),
  })
}

function createIsolatedCommandHandlers(
  manifest: PluginManifest,
  host: PluginIsolationHost,
  allowedCommands: ReadonlySet<string>,
) {
  const handlers: Record<
    string,
    (context: PluginCommandContext, input: unknown) => Promise<unknown>
  > = {}

  for (const command of manifest.contributes?.commands ?? []) {
    if (!allowedCommands.has(command.action)) {
      continue
    }

    handlers[command.action] = async (context, input) => {
      const result = await host.runCommand({
        pluginId: manifest.id,
        command,
        input,
        permissions: context.permissions ?? [],
        hostCapabilities: listRestrictedHostCapabilities(context.host),
        ...(context.editor
          ? { selection: serializeSelection(context.editor.state.selection.main) }
          : {}),
      })

      for (const transaction of result.transactions ?? []) {
        context.editor?.dispatch(deserializeTransaction(command.action, transaction))
      }

      return result.value
    }
  }

  return Object.freeze(handlers)
}

function createIsolatedRenderers(
  manifest: PluginManifest,
  host: PluginIsolationHost,
  allowedRenderers: ReadonlySet<string>,
) {
  const renderers: Record<string, (context: PluginRendererContext) => Promise<unknown>> = {}

  for (const renderer of listRenderableContributions(manifest)) {
    if (!allowedRenderers.has(renderer.id)) {
      continue
    }

    renderers[renderer.id] = (context) =>
      Promise.resolve(
        host.render({
          pluginId: manifest.id,
          renderer,
          context,
        }),
      )
  }

  return Object.freeze(renderers)
}

function listRenderableContributions(
  manifest: PluginManifest,
): readonly PluginRendererContribution[] {
  return Object.freeze([
    ...(manifest.contributes?.renderers ?? []),
    ...(manifest.contributes?.ui ?? []).map((view) =>
      Object.freeze({ id: view.id, nodeType: `ui:${view.slot}`, module: '' }),
    ),
    ...(manifest.contributes?.importers ?? []).map((importer) =>
      Object.freeze({ id: importer.id, nodeType: 'document:importer', module: '' }),
    ),
    ...(manifest.contributes?.documentTypes ?? []).map((documentType) =>
      Object.freeze({ id: documentType.id, nodeType: 'document:type', module: '' }),
    ),
  ])
}

function deserializeTransaction(
  commandId: string,
  transaction: SerializedTransaction,
): Transaction {
  return {
    ...(transaction.changes ? { changes: ChangeSet.of(transaction.changes) } : {}),
    ...(transaction.selection ? { selection: deserializeSelection(transaction.selection) } : {}),
    origin: { type: 'command', id: commandId },
    historyGroup: transaction.historyGroup ?? 'isolate',
  }
}

function deserializeSelection(selection: SerializedSelection): Selection {
  return selection.head === undefined
    ? Selection.cursor(selection.anchor)
    : Selection.range(selection.anchor, selection.head)
}

function serializeSelection(selection: {
  readonly anchor: number
  readonly head: number
}): SerializedSelection {
  return selection.anchor === selection.head
    ? Object.freeze({ anchor: selection.anchor })
    : Object.freeze({ anchor: selection.anchor, head: selection.head })
}

function listRestrictedHostCapabilities(
  host: RestrictedPluginHost,
): readonly PluginHostCapabilityName[] {
  const capabilities: PluginHostCapabilityName[] = []

  if (host.document) {
    capabilities.push('document:read')
  }

  if (host.ui) {
    capabilities.push('ui:update')
  }

  if (host.readText) {
    capabilities.push('file:read')
  }

  if (host.writeText) {
    capabilities.push('file:write')
  }

  if (host.deleteFile) {
    capabilities.push('file:delete')
  }

  if (host.fetch) {
    capabilities.push('network:access')
  }

  if (host.storage) {
    capabilities.push('storage')
  }

  return Object.freeze(capabilities)
}

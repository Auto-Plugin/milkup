import type { ActionPermission } from '@milkup/core'

import { createPluginDocumentHostCapabilities, type PluginDocumentBroker } from './document-broker'
import { createPluginFileHostCapabilities, type PluginFileBroker } from './filesystem-broker'
import { createPluginNetworkHostCapabilities, type PluginNetworkBroker } from './network-broker'
import type { PluginStorageBroker } from './storage-broker'
import { createPluginUiHostCapabilities, type PluginUiBroker } from './ui-broker'
import type {
  IsolatedPluginActivateRequest,
  IsolatedPluginActivateResult,
  IsolatedPluginCommandRequest,
  IsolatedPluginCommandResult,
  IsolatedPluginDeactivateRequest,
  IsolatedPluginRenderRequest,
  PluginHostCapabilityName,
  PluginIsolationHost,
  SerializedChange,
  SerializedSelection,
  SerializedTransaction,
} from './isolation'
import type {
  PluginCommandContribution,
  PluginManifest,
  PluginRendererContribution,
} from './manifest'
import type {
  PluginActivation,
  PluginCommandContext,
  PluginModule,
  RestrictedPluginHost,
} from './runtime'

export interface PluginModuleIsolationHostConfig {
  readonly manifest: PluginManifest
  readonly module: PluginModule
  readonly host?: RestrictedPluginHost
  readonly documentBroker?: PluginDocumentBroker
  readonly uiBroker?: PluginUiBroker
  readonly fileBroker?: PluginFileBroker
  readonly networkBroker?: PluginNetworkBroker
  readonly storageBroker?: PluginStorageBroker
}

export function createPluginModuleIsolationHost(
  config: PluginModuleIsolationHostConfig,
): PluginIsolationHost {
  const { manifest, module } = config
  let activation: PluginActivation | undefined

  return Object.freeze({
    activate: async (
      request: IsolatedPluginActivateRequest,
    ): Promise<IsolatedPluginActivateResult> => {
      assertPluginId(manifest, request.pluginId)
      activation =
        (await module.activate?.({
          manifest: request.manifest,
          pluginId: request.pluginId,
          permissions: request.permissions,
          host: restrictHost(
            config.host ?? {},
            request.hostCapabilities,
            config.documentBroker,
            config.uiBroker,
            config.fileBroker,
            config.networkBroker,
            config.storageBroker,
          ),
        })) ?? undefined

      return Object.freeze({
        commands: Object.freeze(listContributedCommands(manifest, activation, module)),
        renderers: Object.freeze(listContributedRenderers(manifest, activation, module)),
      })
    },
    deactivate: async (request: IsolatedPluginDeactivateRequest): Promise<void> => {
      assertPluginId(manifest, request.pluginId)
      await module.deactivate?.()
      activation = undefined
    },
    runCommand: async (
      request: IsolatedPluginCommandRequest,
    ): Promise<IsolatedPluginCommandResult> => {
      assertPluginId(manifest, request.pluginId)
      const handler =
        activation?.commands?.[request.command.action] ?? module.commands?.[request.command.action]

      if (!handler) {
        throw new Error(`Isolated command is not available: ${request.command.action}`)
      }

      const editor = request.selection ? new IsolatedEditorProxy(request.selection) : undefined
      const commandContext = {
        plugin: {
          id: manifest.id,
          manifest,
          state: 'enabled',
          registeredActions: Object.freeze(
            (manifest.contributes?.commands ?? []).map((command) => command.action),
          ),
          errors: Object.freeze([]),
        },
        command: request.command,
        permissions: request.permissions as readonly ActionPermission[],
        host: restrictHost(
          config.host ?? {},
          request.hostCapabilities,
          config.documentBroker,
          config.uiBroker,
          config.fileBroker,
          config.networkBroker,
          config.storageBroker,
        ),
        ...(editor ? { editor } : {}),
      } as unknown as PluginCommandContext
      const value = await handler(commandContext, request.input)

      return Object.freeze({
        value,
        transactions: Object.freeze(editor?.flush() ?? []),
      })
    },
    render: async (request: IsolatedPluginRenderRequest): Promise<unknown> => {
      assertPluginId(manifest, request.pluginId)
      const renderer =
        activation?.renderers?.[request.renderer.id] ?? module.renderers?.[request.renderer.id]

      if (!renderer) {
        throw new Error(`Isolated renderer is not available: ${request.renderer.id}`)
      }

      return renderer(request.context)
    },
    dispose: async (request: IsolatedPluginDeactivateRequest): Promise<void> => {
      assertPluginId(manifest, request.pluginId)
      await activation?.dispose?.()
    },
  })
}

class IsolatedEditorProxy {
  private selection: SelectionShape
  private readonly transactions: SerializedTransaction[] = []

  constructor(selection: SerializedSelection) {
    this.selection = toSelectionShape(selection)
  }

  get state() {
    return Object.freeze({
      selection: this.selection,
    })
  }

  dispatch(transaction: {
    readonly changes?: { readonly changes?: readonly SerializedChange[] }
    readonly selection?: SelectionShape
    readonly historyGroup?: 'merge' | 'isolate'
  }): void {
    const serialized = serializePluginTransaction(transaction)

    this.transactions.push(serialized)

    if (serialized.selection) {
      this.selection = toSelectionShape(serialized.selection)
    } else if (serialized.changes) {
      const head = mapPosition(serialized.changes, this.selection.main.head)
      this.selection = toSelectionShape({ anchor: head })
    }
  }

  command(): boolean {
    return false
  }

  undo(): boolean {
    return false
  }

  redo(): boolean {
    return false
  }

  flush(): readonly SerializedTransaction[] {
    return Object.freeze([...this.transactions])
  }
}

interface SelectionShape {
  readonly ranges: readonly SelectionRangeShape[]
  readonly mainIndex: number
  readonly main: SelectionRangeShape
}

interface SelectionRangeShape {
  readonly anchor: number
  readonly head: number
  readonly from: number
  readonly to: number
  readonly empty: boolean
  readonly affinity: 'none'
}

function serializePluginTransaction(transaction: {
  readonly changes?: { readonly changes?: readonly SerializedChange[] }
  readonly selection?: SelectionShape
  readonly historyGroup?: 'merge' | 'isolate'
}): SerializedTransaction {
  const changes = transaction.changes?.changes
  const selection = transaction.selection ? fromSelectionShape(transaction.selection) : undefined

  return Object.freeze({
    ...(changes ? { changes: Object.freeze(changes.map(freezeChange)) } : {}),
    ...(selection ? { selection } : {}),
    ...(transaction.historyGroup ? { historyGroup: transaction.historyGroup } : {}),
  })
}

function toSelectionShape(selection: SerializedSelection): SelectionShape {
  const head = selection.head ?? selection.anchor
  const range = Object.freeze({
    anchor: selection.anchor,
    head,
    from: Math.min(selection.anchor, head),
    to: Math.max(selection.anchor, head),
    empty: selection.anchor === head,
    affinity: 'none' as const,
  })

  return Object.freeze({
    ranges: Object.freeze([range]),
    mainIndex: 0,
    main: range,
  })
}

function fromSelectionShape(selection: SelectionShape): SerializedSelection {
  return selection.main.anchor === selection.main.head
    ? Object.freeze({ anchor: selection.main.anchor })
    : Object.freeze({ anchor: selection.main.anchor, head: selection.main.head })
}

function mapPosition(changes: readonly SerializedChange[], position: number): number {
  let mapped = position

  for (const change of changes) {
    if (position < change.from) {
      break
    }

    if (position > change.to) {
      mapped += change.insert.length - (change.to - change.from)
      continue
    }

    mapped = change.from + change.insert.length
  }

  return mapped
}

function restrictHost(
  host: RestrictedPluginHost,
  capabilities: readonly PluginHostCapabilityName[],
  documentBroker?: PluginDocumentBroker,
  uiBroker?: PluginUiBroker,
  fileBroker?: PluginFileBroker,
  networkBroker?: PluginNetworkBroker,
  storageBroker?: PluginStorageBroker,
): RestrictedPluginHost {
  const fileHost = fileBroker ? createPluginFileHostCapabilities(fileBroker) : host
  const networkHost = networkBroker ? createPluginNetworkHostCapabilities(networkBroker) : host

  return Object.freeze({
    ...(capabilities.includes('document:read') && documentBroker
      ? { document: createPluginDocumentHostCapabilities(documentBroker) }
      : capabilities.includes('document:read') && host.document
        ? { document: host.document }
        : {}),
    ...(capabilities.includes('ui:update') && uiBroker
      ? { ui: createPluginUiHostCapabilities(uiBroker) }
      : capabilities.includes('ui:update') && host.ui
        ? { ui: host.ui }
        : {}),
    ...(capabilities.includes('file:read') && fileHost.readText
      ? { readText: fileHost.readText }
      : {}),
    ...(capabilities.includes('file:write') && fileHost.writeText
      ? { writeText: fileHost.writeText }
      : {}),
    ...(capabilities.includes('file:delete') && fileHost.deleteFile
      ? { deleteFile: fileHost.deleteFile }
      : {}),
    ...(capabilities.includes('network:access') && networkHost.fetch
      ? { fetch: networkHost.fetch }
      : {}),
    ...(capabilities.includes('storage') && storageBroker ? { storage: storageBroker } : {}),
  })
}

function listContributedCommands(
  manifest: PluginManifest,
  activation: PluginActivation | undefined,
  module: PluginModule,
): readonly string[] {
  const available = new Set([
    ...Object.keys(module.commands ?? {}),
    ...Object.keys(activation?.commands ?? {}),
  ])

  return (manifest.contributes?.commands ?? [])
    .map((command: PluginCommandContribution) => command.action)
    .filter((action) => available.has(action))
}

function listContributedRenderers(
  manifest: PluginManifest,
  activation: PluginActivation | undefined,
  module: PluginModule,
): readonly string[] {
  const available = new Set([
    ...Object.keys(module.renderers ?? {}),
    ...Object.keys(activation?.renderers ?? {}),
  ])

  return [
    ...(manifest.contributes?.renderers ?? []),
    ...(manifest.contributes?.ui ?? []),
    ...(manifest.contributes?.importers ?? []),
    ...(manifest.contributes?.documentTypes ?? []),
  ]
    .map((renderer) => renderer.id)
    .filter((id) => available.has(id))
}

function assertPluginId(manifest: PluginManifest, pluginId: string): void {
  if (manifest.id !== pluginId) {
    throw new Error(`Isolated plugin id mismatch: expected ${manifest.id}, got ${pluginId}`)
  }
}

function freezeChange(change: SerializedChange): SerializedChange {
  return Object.freeze({
    from: change.from,
    to: change.to,
    insert: change.insert,
  })
}

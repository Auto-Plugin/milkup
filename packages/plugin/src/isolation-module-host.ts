import { createPluginKeymapHostCapabilities, type PluginKeymapBroker } from './keymap-broker'
import { createPluginEditingHostCapabilities, type PluginEditingBroker } from './editing-broker'
import {
  createPluginResourcesHostCapabilities,
  type PluginResourcesBroker,
} from './resources-broker'
import { createPluginSettingsHostCapabilities, type PluginSettingsBroker } from './settings-broker'
import {
  createPluginWorkspaceHostCapabilities,
  type PluginWorkspaceBroker,
} from './workspace-broker'
import type { ActionPermission } from '@milkup/core'

import { createPluginDocumentHostCapabilities, type PluginDocumentBroker } from './document-broker'
import { createPluginFileHostCapabilities, type PluginFileBroker } from './filesystem-broker'
import { createPluginNetworkHostCapabilities, type PluginNetworkBroker } from './network-broker'
import { createPluginReleasesHostCapabilities, type PluginReleasesBroker } from './releases-broker'
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
  readonly isActive?: () => boolean
  readonly host?: RestrictedPluginHost
  readonly documentBroker?: PluginDocumentBroker
  readonly uiBroker?: PluginUiBroker
  readonly fileBroker?: PluginFileBroker
  readonly networkBroker?: PluginNetworkBroker
  readonly keymapBroker?: PluginKeymapBroker
  readonly editingBroker?: PluginEditingBroker
  readonly resourcesBroker?: PluginResourcesBroker
  readonly settingsBroker?: PluginSettingsBroker
  readonly workspaceBroker?: PluginWorkspaceBroker
  readonly releasesBroker?: PluginReleasesBroker
  readonly storageBroker?: PluginStorageBroker
}

export function createPluginModuleIsolationHost(
  config: PluginModuleIsolationHostConfig,
): PluginIsolationHost {
  const { manifest, module } = config
  let activation: PluginActivation | undefined
  let generation = 0
  let active = false

  return Object.freeze({
    activate: async (
      request: IsolatedPluginActivateRequest,
    ): Promise<IsolatedPluginActivateResult> => {
      assertPluginId(manifest, request.pluginId)
      const current = ++generation
      active = true
      try {
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
              manifest.permissions?.includes('app:updates') ? config.releasesBroker : undefined,
              manifest.permissions?.includes('workspace:read') ? config.workspaceBroker : undefined,
              manifest.permissions?.includes('settings:write') ? config.settingsBroker : undefined,
              manifest.permissions?.includes('app:keymap') ? config.keymapBroker : undefined,
              manifest.permissions?.includes('document:write') ? config.editingBroker : undefined,
              manifest.permissions?.includes('images:import') ? config.resourcesBroker : undefined,
              () => active && generation === current && config.isActive?.() !== false,
            ),
          })) ?? undefined
      } catch (error) {
        if (generation === current) {
          active = false
          generation++
        }
        throw error
      }

      return Object.freeze({
        commands: Object.freeze(listContributedCommands(manifest, activation, module)),
        renderers: Object.freeze(listContributedRenderers(manifest, activation, module)),
      })
    },
    deactivate: async (request: IsolatedPluginDeactivateRequest): Promise<void> => {
      assertPluginId(manifest, request.pluginId)
      active = false
      generation++
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

      if (!active || config.isActive?.() === false)
        throw new Error('Plugin command capability was revoked')
      const current = generation
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
          manifest.permissions?.includes('app:updates') ? config.releasesBroker : undefined,
          manifest.permissions?.includes('workspace:read') ? config.workspaceBroker : undefined,
          manifest.permissions?.includes('settings:write') ? config.settingsBroker : undefined,
          manifest.permissions?.includes('app:keymap') ? config.keymapBroker : undefined,
          manifest.permissions?.includes('document:write') ? config.editingBroker : undefined,
          manifest.permissions?.includes('images:import') ? config.resourcesBroker : undefined,
          () => active && generation === current && config.isActive?.() !== false,
          true,
          request.workspaceGesture,
        ),
        ...(editor ? { editor } : {}),
      } as unknown as PluginCommandContext
      const value = await handler(commandContext, request.input)
      if (!active || generation !== current || config.isActive?.() === false)
        throw new Error('Plugin command capability was revoked')

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
      active = false
      generation++
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
  let mapped = position,
    offset = 0
  for (const change of changes) {
    if (position < change.from) break
    const delta = change.insert.length - (change.to - change.from)
    if (position > change.to) {
      offset += delta
      mapped = position + offset
      continue
    }
    mapped = change.from + offset + change.insert.length
    offset += delta
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
  releasesBroker?: PluginReleasesBroker,
  workspaceBroker?: PluginWorkspaceBroker,
  settingsBroker?: PluginSettingsBroker,
  keymapBroker?: PluginKeymapBroker,
  editingBroker?: PluginEditingBroker,
  resourcesBroker?: PluginResourcesBroker,
  isActive?: () => boolean,
  command = false,
  workspaceGesture?: string,
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
      ? {
          ui: createPluginUiHostCapabilities(
            uiBroker,
            isActive,
            command ? workspaceGesture : undefined,
          ),
        }
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
    ...(capabilities.includes('workspace:read') && workspaceBroker
      ? {
          workspace: createPluginWorkspaceHostCapabilities(
            workspaceBroker,
            isActive,
            command,
            workspaceGesture,
          ),
        }
      : {}),
    ...(capabilities.includes('app:keymap') && keymapBroker
      ? { keymap: createPluginKeymapHostCapabilities(keymapBroker, isActive) }
      : {}),
    ...(capabilities.includes('document:write') && editingBroker
      ? { editing: createPluginEditingHostCapabilities(editingBroker, isActive) }
      : {}),
    ...(capabilities.includes('images:import') && resourcesBroker
      ? {
          resources: createPluginResourcesHostCapabilities(
            resourcesBroker,
            isActive,
            workspaceGesture,
          ),
        }
      : {}),
    ...(capabilities.includes('settings:write') && settingsBroker
      ? { settings: createPluginSettingsHostCapabilities(settingsBroker, isActive) }
      : {}),
    ...(capabilities.includes('app:updates') && releasesBroker
      ? { releases: createPluginReleasesHostCapabilities(releasesBroker, isActive) }
      : {}),
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

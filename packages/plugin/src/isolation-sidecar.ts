import type { PluginManagementBroker } from './management-broker'
import { createPluginManagementRpcServer, type PluginManagementRpcServer } from './management-rpc'
import type { PluginKeymapBroker } from './keymap-broker'
import type { PluginEditingBroker } from './editing-broker'
import type { PluginResourcesBroker } from './resources-broker'
import type { PluginOutputBroker } from './output-broker'
import { createPluginOutputRpcServer, type PluginOutputRpcServer } from './output-rpc'
import { createPluginKeymapRpcServer, type PluginKeymapRpcServer } from './keymap-rpc'
import { createPluginEditingRpcServer, type PluginEditingRpcServer } from './editing-rpc'
import { createPluginResourcesRpcServer, type PluginResourcesRpcServer } from './resources-rpc'
import type { PluginSettingsBroker } from './settings-broker'
import { createPluginSettingsRpcServer, type PluginSettingsRpcServer } from './settings-rpc'
import type { PluginWorkspaceBroker } from './workspace-broker'
import { createPluginWorkspaceRpcServer, type PluginWorkspaceRpcServer } from './workspace-rpc'
import type { PluginManifest } from './manifest'
import type { PluginDocumentBroker } from './document-broker'
import { createPluginDocumentRpcServer, type PluginDocumentRpcServer } from './document-rpc'
import type { PluginUiBroker } from './ui-broker'
import { createPluginUiRpcServer } from './ui-rpc'
import { createIsolatedPluginModule } from './isolation'
import {
  createRpcPluginIsolationHost,
  type PluginIsolationRpcEndpoint,
  type PluginIsolationRpcHostOptions,
  type RpcPluginIsolationHost,
} from './isolation-rpc'
import type { PluginActivation, PluginActivationContext, PluginModule } from './runtime'

export interface PluginSidecarHostConfig extends PluginIsolationRpcHostOptions {
  readonly manifest: PluginManifest
  readonly process: PluginSidecarProcess
  readonly moduleSpecifier?: string
  readonly managementBroker?: PluginManagementBroker
  readonly keymapBroker?: PluginKeymapBroker
  readonly editingBroker?: PluginEditingBroker
  readonly resourcesBroker?: PluginResourcesBroker
  readonly outputBroker?: PluginOutputBroker
  readonly settingsBroker?: PluginSettingsBroker
  readonly workspaceBroker?: PluginWorkspaceBroker
  readonly documentBroker?: PluginDocumentBroker
  readonly uiBroker?: PluginUiBroker
}

export interface PluginSidecarProcess {
  start(request: PluginSidecarStartRequest): PluginSidecarEndpoint | Promise<PluginSidecarEndpoint>
  stop?(request: PluginSidecarStopRequest): void | Promise<void>
}

export interface PluginSidecarEndpoint extends PluginIsolationRpcEndpoint {
  readonly instanceId?: string
  close?(): void
}

export interface PluginSidecarStartRequest {
  readonly pluginId: string
  readonly manifest: PluginManifest
  readonly moduleSpecifier?: string
}

export interface PluginSidecarStopRequest {
  readonly pluginId: string
  readonly instanceId?: string
}

export function createSidecarPluginModule(config: PluginSidecarHostConfig): PluginModule {
  const {
    manifest,
    process,
    moduleSpecifier,
    timeoutMs,
    documentBroker,
    uiBroker,
    workspaceBroker,
    settingsBroker,
    managementBroker,
    keymapBroker,
    editingBroker,
    resourcesBroker,
    outputBroker,
  } = config
  let sidecar: ActiveSidecar | undefined

  async function ensureSidecar(): Promise<ActiveSidecar> {
    if (sidecar) {
      return sidecar
    }

    if (manifest.contributes?.documentRenderers?.length && !process.stop)
      throw new Error('Document renderer process requires stop')
    const endpoint = await process.start({
      pluginId: manifest.id,
      manifest,
      ...(moduleSpecifier ? { moduleSpecifier } : {}),
    })
    const host = createRpcPluginIsolationHost(endpoint, {
      ...(timeoutMs ? { timeoutMs } : {}),
      onDocumentRenderTimeout: () => {
        active.managementRpcServer?.dispose()
        active.keymapRpcServer?.dispose()
        active.editingRpcServer?.dispose()
        active.resourcesRpcServer?.dispose()
        active.outputRpcServer?.dispose()
        active.settingsRpcServer?.dispose()
        active.workspaceRpcServer?.dispose()
        active.documentRpcServer?.dispose()
        active.uiRpcServer?.dispose()
        active.host.dispose()
        active.endpoint.close?.()
        void Promise.resolve(
          process.stop?.({
            pluginId: manifest.id,
            ...(active.endpoint.instanceId ? { instanceId: active.endpoint.instanceId } : {}),
          }),
        ).catch(() => undefined)
        if (sidecar === active) sidecar = undefined
        config.onDocumentRenderTimeout?.()
      },
      onIsolationError: (error) => {
        active.managementRpcServer?.dispose()
        active.keymapRpcServer?.dispose()
        active.editingRpcServer?.dispose()
        active.resourcesRpcServer?.dispose()
        active.outputRpcServer?.dispose()
        active.settingsRpcServer?.dispose()
        active.workspaceRpcServer?.dispose()
        active.documentRpcServer?.dispose()
        active.uiRpcServer?.dispose()
        active.host.dispose()
        active.endpoint.close?.()
        void Promise.resolve(
          process.stop?.({
            pluginId: manifest.id,
            ...(active.endpoint.instanceId ? { instanceId: active.endpoint.instanceId } : {}),
          }),
        ).catch(() => undefined)
        if (sidecar === active) sidecar = undefined
        config.onIsolationError?.(error)
      },
    })
    const managementRpcServer =
      managementBroker && manifest.permissions?.includes('app:plugins')
        ? createPluginManagementRpcServer(endpoint, managementBroker)
        : undefined
    const keymapRpcServer =
      keymapBroker && manifest.permissions?.includes('app:keymap')
        ? createPluginKeymapRpcServer(endpoint, keymapBroker)
        : undefined
    const editingRpcServer =
      editingBroker && manifest.permissions?.includes('document:write')
        ? createPluginEditingRpcServer(endpoint, editingBroker)
        : undefined
    const resourcesRpcServer =
      resourcesBroker && manifest.permissions?.includes('images:import')
        ? createPluginResourcesRpcServer(endpoint, resourcesBroker)
        : undefined
    const outputRpcServer =
      outputBroker &&
      manifest.permissions?.includes('document:output') &&
      manifest.permissions?.includes('document:read')
        ? createPluginOutputRpcServer(endpoint, outputBroker)
        : undefined
    const settingsRpcServer =
      settingsBroker && manifest.permissions?.includes('settings:write')
        ? createPluginSettingsRpcServer(endpoint, settingsBroker)
        : undefined
    const workspaceRpcServer =
      workspaceBroker && manifest.permissions?.includes('workspace:read')
        ? createPluginWorkspaceRpcServer(endpoint, workspaceBroker)
        : undefined
    const documentRpcServer =
      documentBroker && manifest.permissions?.includes('document:read')
        ? createPluginDocumentRpcServer(endpoint, documentBroker)
        : undefined
    const uiRpcServer = uiBroker ? createPluginUiRpcServer(endpoint, uiBroker) : undefined
    const module = createIsolatedPluginModule({ manifest, host })

    const active: ActiveSidecar = {
      endpoint,
      host,
      module,
      ...(documentRpcServer ? { documentRpcServer } : {}),
      ...(managementRpcServer ? { managementRpcServer } : {}),
      ...(keymapRpcServer ? { keymapRpcServer } : {}),
      ...(editingRpcServer ? { editingRpcServer } : {}),
      ...(resourcesRpcServer ? { resourcesRpcServer } : {}),
      ...(outputRpcServer ? { outputRpcServer } : {}),
      ...(settingsRpcServer ? { settingsRpcServer } : {}),
      ...(workspaceRpcServer ? { workspaceRpcServer } : {}),
      ...(uiRpcServer ? { uiRpcServer } : {}),
    }
    sidecar = active
    return active
  }

  return Object.freeze({
    runtimeHost: 'isolated' as const,
    activate: async (context: PluginActivationContext): Promise<PluginActivation | void> => {
      const active = await ensureSidecar()

      return active.module.activate?.(context)
    },
    deactivate: async () => {
      const active = sidecar

      if (!active) {
        return
      }

      try {
        await active.module.deactivate?.()
      } finally {
        active.managementRpcServer?.dispose()
        active.keymapRpcServer?.dispose()
        active.editingRpcServer?.dispose()
        active.resourcesRpcServer?.dispose()
        active.outputRpcServer?.dispose()
        active.settingsRpcServer?.dispose()
        active.workspaceRpcServer?.dispose()
        active.documentRpcServer?.dispose()
        active.uiRpcServer?.dispose()
        active.host.dispose()
        active.endpoint.close?.()
        await process.stop?.({
          pluginId: manifest.id,
          ...(active.endpoint.instanceId ? { instanceId: active.endpoint.instanceId } : {}),
        })
        if (sidecar === active) sidecar = undefined
      }
    },
  })
}

interface ActiveSidecar {
  readonly endpoint: PluginSidecarEndpoint
  readonly host: RpcPluginIsolationHost
  readonly module: PluginModule
  readonly managementRpcServer?: PluginManagementRpcServer
  readonly keymapRpcServer?: PluginKeymapRpcServer
  readonly editingRpcServer?: PluginEditingRpcServer
  readonly resourcesRpcServer?: PluginResourcesRpcServer
  readonly outputRpcServer?: PluginOutputRpcServer
  readonly settingsRpcServer?: PluginSettingsRpcServer
  readonly workspaceRpcServer?: PluginWorkspaceRpcServer
  readonly documentRpcServer?: PluginDocumentRpcServer
  readonly uiRpcServer?: { dispose(): void }
}

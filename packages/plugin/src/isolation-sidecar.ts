import type { PluginKeymapBroker } from './keymap-broker'
import type { PluginEditingBroker } from './editing-broker'
import type { PluginResourcesBroker } from './resources-broker'
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
  readonly keymapBroker?: PluginKeymapBroker
  readonly editingBroker?: PluginEditingBroker
  readonly resourcesBroker?: PluginResourcesBroker
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
  close?(): void
}

export interface PluginSidecarStartRequest {
  readonly pluginId: string
  readonly manifest: PluginManifest
  readonly moduleSpecifier?: string
}

export interface PluginSidecarStopRequest {
  readonly pluginId: string
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
    keymapBroker,
    editingBroker,
    resourcesBroker,
  } = config
  let sidecar: ActiveSidecar | undefined

  async function ensureSidecar(): Promise<ActiveSidecar> {
    if (sidecar) {
      return sidecar
    }

    const endpoint = await process.start({
      pluginId: manifest.id,
      manifest,
      ...(moduleSpecifier ? { moduleSpecifier } : {}),
    })
    const host = createRpcPluginIsolationHost(endpoint, {
      ...(timeoutMs ? { timeoutMs } : {}),
    })
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
    const settingsRpcServer =
      settingsBroker && manifest.permissions?.includes('settings:write')
        ? createPluginSettingsRpcServer(endpoint, settingsBroker)
        : undefined
    const workspaceRpcServer =
      workspaceBroker && manifest.permissions?.includes('workspace:read')
        ? createPluginWorkspaceRpcServer(endpoint, workspaceBroker)
        : undefined
    const documentRpcServer = documentBroker
      ? createPluginDocumentRpcServer(endpoint, documentBroker)
      : undefined
    const uiRpcServer = uiBroker ? createPluginUiRpcServer(endpoint, uiBroker) : undefined
    const module = createIsolatedPluginModule({ manifest, host })

    const active: ActiveSidecar = {
      endpoint,
      host,
      module,
      ...(documentRpcServer ? { documentRpcServer } : {}),
      ...(keymapRpcServer ? { keymapRpcServer } : {}),
      ...(editingRpcServer ? { editingRpcServer } : {}),
      ...(resourcesRpcServer ? { resourcesRpcServer } : {}),
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
        active.keymapRpcServer?.dispose()
        active.editingRpcServer?.dispose()
        active.resourcesRpcServer?.dispose()
        active.settingsRpcServer?.dispose()
        active.workspaceRpcServer?.dispose()
        active.documentRpcServer?.dispose()
        active.uiRpcServer?.dispose()
        active.host.dispose()
        active.endpoint.close?.()
        await process.stop?.({ pluginId: manifest.id })
        sidecar = undefined
      }
    },
  })
}

interface ActiveSidecar {
  readonly endpoint: PluginSidecarEndpoint
  readonly host: RpcPluginIsolationHost
  readonly module: PluginModule
  readonly keymapRpcServer?: PluginKeymapRpcServer
  readonly editingRpcServer?: PluginEditingRpcServer
  readonly resourcesRpcServer?: PluginResourcesRpcServer
  readonly settingsRpcServer?: PluginSettingsRpcServer
  readonly workspaceRpcServer?: PluginWorkspaceRpcServer
  readonly documentRpcServer?: PluginDocumentRpcServer
  readonly uiRpcServer?: { dispose(): void }
}

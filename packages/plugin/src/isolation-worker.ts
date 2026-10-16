import type { PluginKeymapBroker } from './keymap-broker'
import type { PluginEditingBroker } from './editing-broker'
import type { PluginResourcesBroker } from './resources-broker'
import {
  createRpcPluginKeymapBroker,
  createPluginKeymapRpcServer,
  type RpcPluginKeymapBroker,
} from './keymap-rpc'
import {
  createRpcPluginEditingBroker,
  createPluginEditingRpcServer,
  type RpcPluginEditingBroker,
} from './editing-rpc'
import {
  createRpcPluginResourcesBroker,
  createPluginResourcesRpcServer,
  type RpcPluginResourcesBroker,
} from './resources-rpc'
import type { PluginSettingsBroker } from './settings-broker'
import {
  createRpcPluginSettingsBroker,
  createPluginSettingsRpcServer,
  type RpcPluginSettingsBroker,
} from './settings-rpc'
import { type PluginWorkspaceBroker } from './workspace-broker'
import {
  createPluginWorkspaceRpcServer,
  createRpcPluginWorkspaceBroker,
  type RpcPluginWorkspaceBroker,
} from './workspace-rpc'
import { coercePluginModule } from './loader'
import type { PluginDocumentBroker } from './document-broker'
import {
  createPluginDocumentRpcServer,
  createRpcPluginDocumentBroker,
  type PluginDocumentRpcServer,
  type RpcPluginDocumentBroker,
} from './document-rpc'
import type { PluginFileBroker } from './filesystem-broker'
import type { PluginNetworkBroker } from './network-broker'
import {
  createPluginFileRpcServer,
  createRpcPluginFileBroker,
  type PluginFileRpcServer,
  type RpcPluginFileBroker,
} from './filesystem-rpc'
import {
  createPluginNetworkRpcServer,
  createRpcPluginNetworkBroker,
  type PluginNetworkRpcServer,
  type RpcPluginNetworkBroker,
} from './network-rpc'
import type { PluginManifest } from './manifest'
import { createPluginReleasesHostCapabilities, type PluginReleasesBroker } from './releases-broker'
import {
  createPluginReleasesRpcServer,
  createRpcPluginReleasesBroker,
  type RpcPluginReleasesBroker,
} from './releases-rpc'
import type { PluginStorageBroker } from './storage-broker'
import type { PluginUiBroker } from './ui-broker'
import { createPluginUiRpcServer, createRpcPluginUiBroker, type RpcPluginUiBroker } from './ui-rpc'
import {
  createPluginStorageRpcServer,
  createRpcPluginStorageBroker,
  type RpcPluginStorageBroker,
} from './storage-rpc'
import { createPluginModuleIsolationHost } from './isolation-module-host'
import {
  createPluginIsolationRpcServer,
  createRpcPluginIsolationHost,
  type PluginIsolationRpcEndpoint,
  type PluginIsolationRpcHostOptions,
  type PluginIsolationRpcMessageListener,
  type RpcPluginIsolationHost,
} from './isolation-rpc'

export interface BrowserWorkerPluginHostConfig extends PluginIsolationRpcHostOptions {
  readonly worker: PluginWorkerEndpoint
  readonly manifest: PluginManifest
  readonly moduleSpecifier: string
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

export interface BrowserWorkerPluginHost {
  readonly host: RpcPluginIsolationHost
  readonly ready: Promise<void>
  dispose(): void
}

export interface PluginWorkerEndpoint extends PluginIsolationRpcEndpoint {
  terminate?(): void
}

export interface PluginWorkerRealmOptions {
  readonly importModule?: PluginWorkerImportModule
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
  readonly timeoutMs?: number
}

export interface PluginWorkerInitRequest {
  readonly manifest: PluginManifest
  readonly moduleSpecifier: string
}

export type PluginWorkerImportModule = (moduleSpecifier: string) => unknown | Promise<unknown>

interface WorkerInitMessage {
  readonly protocol: typeof WORKER_INIT_PROTOCOL
  readonly type: 'init'
  readonly payload: PluginWorkerInitRequest
}

interface WorkerReadyMessage {
  readonly protocol: typeof WORKER_INIT_PROTOCOL
  readonly type: 'ready'
}

interface WorkerErrorMessage {
  readonly protocol: typeof WORKER_INIT_PROTOCOL
  readonly type: 'error'
  readonly error: {
    readonly message: string
  }
}

type WorkerLifecycleMessage = WorkerInitMessage | WorkerReadyMessage | WorkerErrorMessage

const WORKER_INIT_PROTOCOL = 'milkup.plugin.worker.init.v1'

export function createBrowserWorkerPluginHost(
  config: BrowserWorkerPluginHostConfig,
): BrowserWorkerPluginHost {
  const {
    worker,
    manifest,
    moduleSpecifier,
    timeoutMs,
    documentBroker,
    uiBroker,
    fileBroker,
    networkBroker,
    storageBroker,
    releasesBroker,
    workspaceBroker,
    settingsBroker,
    keymapBroker,
    editingBroker,
    resourcesBroker,
  } = config
  if (manifest.contributes?.documentRenderers?.length && !worker.terminate)
    throw new Error('Document renderer Worker requires termination')
  const host = createRpcPluginIsolationHost(worker, {
    ...(timeoutMs ? { timeoutMs } : {}),
    onDocumentRenderTimeout: () => {
      cleanup()
      config.onDocumentRenderTimeout?.()
    },
    onIsolationError: (error) => {
      fail(error)
      cleanup()
      config.onIsolationError?.(error)
    },
  })
  const fileRpcServer = fileBroker ? createPluginFileRpcServer(worker, fileBroker) : undefined
  const documentRpcServer =
    documentBroker && manifest.permissions?.includes('document:read')
      ? createPluginDocumentRpcServer(worker, documentBroker)
      : undefined
  const uiRpcServer = uiBroker ? createPluginUiRpcServer(worker, uiBroker) : undefined
  const networkRpcServer = networkBroker
    ? createPluginNetworkRpcServer(worker, networkBroker)
    : undefined
  const storageRpcServer = storageBroker
    ? createPluginStorageRpcServer(worker, storageBroker)
    : undefined
  const keymapRpcServer =
    keymapBroker && manifest.permissions?.includes('app:keymap')
      ? createPluginKeymapRpcServer(worker, keymapBroker)
      : undefined
  const editingRpcServer =
    editingBroker && manifest.permissions?.includes('document:write')
      ? createPluginEditingRpcServer(worker, editingBroker)
      : undefined
  const resourcesRpcServer =
    resourcesBroker && manifest.permissions?.includes('images:import')
      ? createPluginResourcesRpcServer(worker, resourcesBroker)
      : undefined
  const settingsRpcServer =
    settingsBroker && manifest.permissions?.includes('settings:write')
      ? createPluginSettingsRpcServer(worker, settingsBroker)
      : undefined
  const workspaceRpcServer =
    workspaceBroker && manifest.permissions?.includes('workspace:read')
      ? createPluginWorkspaceRpcServer(worker, workspaceBroker)
      : undefined
  const releasesRpcServer =
    releasesBroker && manifest.permissions?.includes('app:updates')
      ? createPluginReleasesRpcServer(worker, releasesBroker)
      : undefined
  let settled = false
  let disposed = false
  let removeReadyListener: (() => void) | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let resolveReady!: () => void
  let rejectReady!: (error: Error) => void
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve
    rejectReady = reject
  })
  // Disposal may precede the caller awaiting startup. Keep that cancellation
  // handled while preserving the original rejected promise for ready consumers.
  void ready.catch(() => undefined)

  function stopWaiting(): void {
    clearTimeout(timer)
    removeReadyListener?.()
    removeReadyListener = undefined
  }

  function cleanup(): void {
    if (disposed) return
    disposed = true
    stopWaiting()
    documentRpcServer?.dispose()
    uiRpcServer?.dispose()
    fileRpcServer?.dispose()
    networkRpcServer?.dispose()
    storageRpcServer?.dispose()
    keymapRpcServer?.dispose()
    editingRpcServer?.dispose()
    resourcesRpcServer?.dispose()
    settingsRpcServer?.dispose()
    workspaceRpcServer?.dispose()
    releasesRpcServer?.dispose()
    host.dispose()
    worker.terminate?.()
  }

  function fail(error: Error): void {
    if (settled) return
    settled = true
    rejectReady(error)
    cleanup()
  }

  try {
    removeReadyListener = addWorkerMessageListener(worker, (message) => {
      if (settled) return
      const lifecycle = readWorkerLifecycleMessage(message)

      if (!lifecycle || lifecycle.type === 'init') return
      if (lifecycle.type === 'ready') {
        settled = true
        stopWaiting()
        resolveReady()
      } else {
        fail(new Error(lifecycle.error?.message ?? 'Plugin worker initialization failed'))
      }
    })
    timer = setTimeout(() => {
      fail(new Error(`Plugin worker initialization timed out: ${manifest.id}`))
    }, timeoutMs ?? 5_000)
    worker.postMessage({
      protocol: WORKER_INIT_PROTOCOL,
      type: 'init',
      payload: {
        manifest,
        moduleSpecifier,
      },
    } satisfies WorkerInitMessage)
  } catch (error) {
    fail(error instanceof Error ? error : new Error(String(error)))
  }

  return Object.freeze({
    host,
    ready,
    dispose: () => {
      fail(new Error(`Plugin worker disposed before initialization: ${manifest.id}`))
      cleanup()
    },
  })
}

export function initializePluginWorkerRealm(
  scope: PluginWorkerEndpoint,
  options: PluginWorkerRealmOptions = {},
): { readonly dispose: () => void } {
  let initialized = false
  let disposed = false
  let capabilityActive = true
  let rpcServer: { dispose(): void } | undefined
  let rpcDocumentBroker: RpcPluginDocumentBroker | undefined
  let rpcUiBroker: RpcPluginUiBroker | undefined
  let rpcFileBroker: RpcPluginFileBroker | undefined
  let rpcNetworkBroker: RpcPluginNetworkBroker | undefined
  let rpcStorageBroker: RpcPluginStorageBroker | undefined
  let rpcKeymapBroker: RpcPluginKeymapBroker | undefined
  let rpcEditingBroker: RpcPluginEditingBroker | undefined
  let rpcResourcesBroker: RpcPluginResourcesBroker | undefined
  let rpcSettingsBroker: RpcPluginSettingsBroker | undefined
  let rpcWorkspaceBroker: RpcPluginWorkspaceBroker | undefined
  let rpcReleasesBroker: RpcPluginReleasesBroker | undefined
  const removeInitListener = addWorkerMessageListener(scope, async (message) => {
    const lifecycle = readWorkerLifecycleMessage(message)

    if (disposed || initialized || !lifecycle || lifecycle.type !== 'init') {
      return
    }

    initialized = true
    removeInitListener()
    try {
      rpcDocumentBroker = options.documentBroker
        ? undefined
        : createRpcPluginDocumentBroker(
            scope,
            options.timeoutMs ? { timeoutMs: options.timeoutMs } : {},
          )
      const documentBrokerForHost = options.documentBroker ?? rpcDocumentBroker
      rpcUiBroker = options.uiBroker
        ? undefined
        : createRpcPluginUiBroker(scope, options.timeoutMs ?? 5_000)
      const uiBrokerForHost = options.uiBroker ?? rpcUiBroker
      rpcNetworkBroker = options.networkBroker
        ? undefined
        : createRpcPluginNetworkBroker(
            scope,
            options.timeoutMs ? { timeoutMs: options.timeoutMs } : {},
          )
      const networkBrokerForHost = options.networkBroker ?? rpcNetworkBroker
      rpcStorageBroker = options.storageBroker
        ? undefined
        : createRpcPluginStorageBroker(scope, options.timeoutMs ?? 5_000)
      const storageBrokerForHost = options.storageBroker ?? rpcStorageBroker
      rpcKeymapBroker =
        lifecycle.payload.manifest.permissions?.includes('app:keymap') && !options.keymapBroker
          ? createRpcPluginKeymapBroker(scope, options.timeoutMs ?? 30_000)
          : undefined
      const keymapBrokerForHost = options.keymapBroker ?? rpcKeymapBroker
      rpcSettingsBroker =
        lifecycle.payload.manifest.permissions?.includes('settings:write') &&
        !options.settingsBroker
          ? createRpcPluginSettingsBroker(scope, options.timeoutMs ?? 30_000)
          : undefined
      const settingsBrokerForHost = options.settingsBroker ?? rpcSettingsBroker
      rpcWorkspaceBroker =
        lifecycle.payload.manifest.permissions?.includes('workspace:read') &&
        !options.workspaceBroker
          ? createRpcPluginWorkspaceBroker(scope, options.timeoutMs ?? 30_000)
          : undefined
      const workspaceBrokerForHost = options.workspaceBroker ?? rpcWorkspaceBroker
      rpcReleasesBroker =
        lifecycle.payload.manifest.permissions?.includes('app:updates') && !options.releasesBroker
          ? createRpcPluginReleasesBroker(scope, options.timeoutMs ?? 30_000)
          : undefined
      const releasesBrokerForHost = options.releasesBroker ?? rpcReleasesBroker

      installWorkerCodeLoadingGuards(scope)
      installNetworkGuards(scope, lifecycle.payload.manifest, networkBrokerForHost)
      const imported = await (options.importModule ?? defaultImportModule)(
        lifecycle.payload.moduleSpecifier,
      )
      if (disposed) return
      rpcEditingBroker =
        lifecycle.payload.manifest.permissions?.includes('document:write') && !options.editingBroker
          ? createRpcPluginEditingBroker(scope, options.timeoutMs ?? 30_000)
          : undefined
      rpcResourcesBroker =
        lifecycle.payload.manifest.permissions?.includes('images:import') &&
        !options.resourcesBroker
          ? createRpcPluginResourcesBroker(scope, 300_000)
          : undefined
      const editingBrokerForHost = options.editingBroker ?? rpcEditingBroker
      const resourcesBrokerForHost = options.resourcesBroker ?? rpcResourcesBroker
      const module = coercePluginModule(imported)
      rpcFileBroker = options.fileBroker
        ? undefined
        : createRpcPluginFileBroker(
            scope,
            options.timeoutMs ? { timeoutMs: options.timeoutMs } : {},
          )
      const fileBrokerForHost = options.fileBroker ?? rpcFileBroker
      const host = createPluginModuleIsolationHost({
        isActive: () => capabilityActive,
        manifest: lifecycle.payload.manifest,
        module,
        ...(documentBrokerForHost ? { documentBroker: documentBrokerForHost } : {}),
        ...(uiBrokerForHost ? { uiBroker: uiBrokerForHost } : {}),
        ...(fileBrokerForHost ? { fileBroker: fileBrokerForHost } : {}),
        ...(networkBrokerForHost ? { networkBroker: networkBrokerForHost } : {}),
        ...(storageBrokerForHost ? { storageBroker: storageBrokerForHost } : {}),
        ...(keymapBrokerForHost ? { keymapBroker: keymapBrokerForHost } : {}),
        ...(editingBrokerForHost ? { editingBroker: editingBrokerForHost } : {}),
        ...(resourcesBrokerForHost ? { resourcesBroker: resourcesBrokerForHost } : {}),
        ...(settingsBrokerForHost ? { settingsBroker: settingsBrokerForHost } : {}),
        ...(workspaceBrokerForHost ? { workspaceBroker: workspaceBrokerForHost } : {}),
        ...(releasesBrokerForHost
          ? {
              releasesBroker: createPluginReleasesHostCapabilities(
                releasesBrokerForHost,
                () => capabilityActive,
              ),
            }
          : {}),
      })

      rpcServer = createPluginIsolationRpcServer(scope, host)
      scope.postMessage({
        protocol: WORKER_INIT_PROTOCOL,
        type: 'ready',
      } satisfies WorkerReadyMessage)
    } catch (error) {
      cleanup()
      if (disposed) return
      scope.postMessage({
        protocol: WORKER_INIT_PROTOCOL,
        type: 'error',
        error: {
          message: error instanceof Error ? error.message : String(error),
        },
      } satisfies WorkerErrorMessage)
    }
  })

  function cleanup(): void {
    capabilityActive = false
    rpcServer?.dispose()
    rpcDocumentBroker?.dispose()
    rpcUiBroker?.dispose()
    rpcFileBroker?.dispose()
    rpcNetworkBroker?.dispose()
    rpcStorageBroker?.dispose()
    rpcKeymapBroker?.dispose()
    rpcEditingBroker?.dispose()
    rpcResourcesBroker?.dispose()
    rpcSettingsBroker?.dispose()
    rpcWorkspaceBroker?.dispose()
    rpcReleasesBroker?.dispose()
  }

  return Object.freeze({
    dispose: () => {
      if (disposed) return
      disposed = true
      removeInitListener()
      cleanup()
    },
  })
}

export function installNetworkGuards(
  scope: object,
  manifest: PluginManifest,
  networkBroker?: PluginNetworkBroker,
): void {
  const hasNetworkAccess = manifest.permissions?.includes('network:access') === true

  if (hasNetworkAccess && networkBroker) {
    defineBrokeredGlobalFetch(scope, networkBroker)
    defineUnsupportedNetworkGlobal(scope, 'WebSocket')
    defineUnsupportedNetworkGlobal(scope, 'EventSource')
    defineUnsupportedNetworkGlobal(scope, 'XMLHttpRequest')
    return
  }

  defineBlockedGlobal(scope, 'fetch')
  defineBlockedGlobal(scope, 'WebSocket')
  defineBlockedGlobal(scope, 'EventSource')
  defineBlockedGlobal(scope, 'XMLHttpRequest')
}

function installWorkerCodeLoadingGuards(scope: object): void {
  defineBlockedCodeLoadingGlobal(scope, 'eval')
  defineBlockedCodeLoadingGlobal(scope, 'Function')
  defineBlockedCodeLoadingGlobal(scope, 'importScripts')
  defineBlockedCodeLoadingGlobal(scope, 'Worker')
  defineBlockedCodeLoadingGlobal(scope, 'SharedWorker')
}

async function defaultImportModule(moduleSpecifier: string): Promise<unknown> {
  return import(/* @vite-ignore */ moduleSpecifier)
}

function defineBlockedGlobal(scope: object, key: string): void {
  Object.defineProperty(scope, key, {
    configurable: true,
    writable: true,
    value: () => {
      throw new Error(`Plugin network access is not allowed: ${key}`)
    },
  })
}

function defineUnsupportedNetworkGlobal(scope: object, key: string): void {
  Object.defineProperty(scope, key, {
    configurable: true,
    writable: true,
    value: () => {
      throw new Error(`Plugin network global is not brokered: ${key}`)
    },
  })
}

function defineBlockedCodeLoadingGlobal(scope: object, key: string): void {
  Object.defineProperty(scope, key, {
    configurable: true,
    writable: true,
    value: function blockedPluginWorkerCodeLoading() {
      throw new Error(`Plugin worker code loading is not allowed: ${key}`)
    },
  })
}

function defineBrokeredGlobalFetch(scope: object, networkBroker: PluginNetworkBroker): void {
  Object.defineProperty(scope, 'fetch', {
    configurable: true,
    writable: true,
    value: (url: unknown, init?: unknown) =>
      networkBroker.fetch({
        url: String(url),
        ...(init !== undefined ? { init } : {}),
      }),
  })
}

function addWorkerMessageListener(
  endpoint: PluginWorkerEndpoint,
  listener: (message: unknown) => void,
): () => void {
  if (endpoint.addEventListener) {
    const eventListener: PluginIsolationRpcMessageListener = (event) => listener(event.data)

    endpoint.addEventListener('message', eventListener)
    return () => endpoint.removeEventListener?.('message', eventListener)
  }

  if (endpoint.on) {
    endpoint.on('message', listener)
    return () => endpoint.off?.('message', listener)
  }

  throw new Error('Plugin worker endpoint does not support message listeners')
}

function readWorkerLifecycleMessage(message: unknown): WorkerLifecycleMessage | undefined {
  if (!isRecord(message)) {
    return undefined
  }

  if (message.protocol !== WORKER_INIT_PROTOCOL) {
    return undefined
  }

  if (message.type !== 'init' && message.type !== 'ready' && message.type !== 'error') {
    return undefined
  }

  return message as unknown as WorkerLifecycleMessage
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

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
  } = config
  const host = createRpcPluginIsolationHost(worker, { ...(timeoutMs ? { timeoutMs } : {}) })
  const fileRpcServer = fileBroker ? createPluginFileRpcServer(worker, fileBroker) : undefined
  const documentRpcServer = documentBroker
    ? createPluginDocumentRpcServer(worker, documentBroker)
    : undefined
  const uiRpcServer = uiBroker ? createPluginUiRpcServer(worker, uiBroker) : undefined
  const networkRpcServer = networkBroker
    ? createPluginNetworkRpcServer(worker, networkBroker)
    : undefined
  const storageRpcServer = storageBroker
    ? createPluginStorageRpcServer(worker, storageBroker)
    : undefined
  let settled = false
  let removeReadyListener: (() => void) | undefined

  const ready = new Promise<void>((resolve, reject) => {
    removeReadyListener = addWorkerMessageListener(worker, (message) => {
      const lifecycle = readWorkerLifecycleMessage(message)

      if (!lifecycle || lifecycle.type === 'init') {
        return
      }

      settled = true
      removeReadyListener?.()

      if (lifecycle.type === 'ready') {
        resolve()
      } else {
        reject(new Error(lifecycle.error.message))
      }
    })

    worker.postMessage({
      protocol: WORKER_INIT_PROTOCOL,
      type: 'init',
      payload: {
        manifest,
        moduleSpecifier,
      },
    } satisfies WorkerInitMessage)
  })

  return Object.freeze({
    host,
    ready,
    dispose: () => {
      removeReadyListener?.()
      documentRpcServer?.dispose()
      uiRpcServer?.dispose()
      fileRpcServer?.dispose()
      networkRpcServer?.dispose()
      storageRpcServer?.dispose()
      host.dispose()

      if (!settled) {
        settled = true
      }

      worker.terminate?.()
    },
  })
}

export function initializePluginWorkerRealm(
  scope: PluginWorkerEndpoint,
  options: PluginWorkerRealmOptions = {},
): { readonly dispose: () => void } {
  let rpcServer: { dispose(): void } | undefined
  let rpcDocumentBroker: RpcPluginDocumentBroker | undefined
  let rpcUiBroker: RpcPluginUiBroker | undefined
  let rpcFileBroker: RpcPluginFileBroker | undefined
  let rpcNetworkBroker: RpcPluginNetworkBroker | undefined
  let rpcStorageBroker: RpcPluginStorageBroker | undefined
  const removeInitListener = addWorkerMessageListener(scope, async (message) => {
    const lifecycle = readWorkerLifecycleMessage(message)

    if (!lifecycle || lifecycle.type !== 'init') {
      return
    }

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

      installWorkerCodeLoadingGuards(scope)
      installNetworkGuards(scope, lifecycle.payload.manifest, networkBrokerForHost)
      const imported = await (options.importModule ?? defaultImportModule)(
        lifecycle.payload.moduleSpecifier,
      )
      const module = coercePluginModule(imported)
      rpcFileBroker = options.fileBroker
        ? undefined
        : createRpcPluginFileBroker(
            scope,
            options.timeoutMs ? { timeoutMs: options.timeoutMs } : {},
          )
      const fileBrokerForHost = options.fileBroker ?? rpcFileBroker
      const host = createPluginModuleIsolationHost({
        manifest: lifecycle.payload.manifest,
        module,
        ...(documentBrokerForHost ? { documentBroker: documentBrokerForHost } : {}),
        ...(uiBrokerForHost ? { uiBroker: uiBrokerForHost } : {}),
        ...(fileBrokerForHost ? { fileBroker: fileBrokerForHost } : {}),
        ...(networkBrokerForHost ? { networkBroker: networkBrokerForHost } : {}),
        ...(storageBrokerForHost ? { storageBroker: storageBrokerForHost } : {}),
      })

      rpcServer = createPluginIsolationRpcServer(scope, host)
      scope.postMessage({
        protocol: WORKER_INIT_PROTOCOL,
        type: 'ready',
      } satisfies WorkerReadyMessage)
    } catch (error) {
      scope.postMessage({
        protocol: WORKER_INIT_PROTOCOL,
        type: 'error',
        error: {
          message: error instanceof Error ? error.message : String(error),
        },
      } satisfies WorkerErrorMessage)
    }
  })

  return Object.freeze({
    dispose: () => {
      removeInitListener()
      rpcServer?.dispose()
      rpcDocumentBroker?.dispose()
      rpcUiBroker?.dispose()
      rpcFileBroker?.dispose()
      rpcNetworkBroker?.dispose()
      rpcStorageBroker?.dispose()
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

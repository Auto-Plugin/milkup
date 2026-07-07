import type { PluginManifest } from './manifest'
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
  const { manifest, process, moduleSpecifier, timeoutMs } = config
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
    const module = createIsolatedPluginModule({ manifest, host })

    sidecar = { endpoint, host, module }
    return sidecar
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
}

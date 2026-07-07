import type { PluginManifest } from './manifest'

export interface PluginNetworkBroker {
  fetch(request: PluginNetworkFetchRequest): Promise<unknown>
}

export interface PluginNetworkHostCapabilities {
  fetch(url: string, init?: unknown): Promise<unknown>
}

export interface PluginNetworkBrokerConfig {
  readonly manifest: PluginManifest
  readonly adapter: PluginNetworkBrokerAdapter
  readonly allowedOrigins?: readonly string[]
  readonly audit?: PluginNetworkAuditSink
}

export interface PluginNetworkBrokerAdapter {
  fetch(url: string, init?: unknown): unknown | Promise<unknown>
}

export interface PluginNetworkFetchRequest {
  readonly url: string
  readonly init?: unknown
}

export interface PluginNetworkAuditRecord {
  readonly pluginId: string
  readonly url: string
  readonly origin?: string
  readonly ok: boolean
  readonly reason?: string
}

export type PluginNetworkAuditSink = (record: PluginNetworkAuditRecord) => void

export function createPluginNetworkBroker(config: PluginNetworkBrokerConfig): PluginNetworkBroker {
  return Object.freeze({
    fetch: async (request: PluginNetworkFetchRequest): Promise<unknown> => {
      try {
        assertNetworkPermission(config.manifest)
        const origin = readUrlOrigin(request.url)

        if (!originAllowed(origin, config.allowedOrigins)) {
          throw new Error(`Plugin network origin is not allowed: ${origin}`)
        }

        const value = await config.adapter.fetch(request.url, request.init)

        auditNetworkSuccess(config, request.url, origin)
        return value
      } catch (error) {
        auditNetworkFailure(config, request.url, error)
        throw error
      }
    },
  })
}

export function createPluginNetworkHostCapabilities(
  broker: PluginNetworkBroker,
): PluginNetworkHostCapabilities {
  return Object.freeze({
    fetch: (url: string, init?: unknown) =>
      broker.fetch({
        url,
        ...(init !== undefined ? { init } : {}),
      }),
  })
}

function assertNetworkPermission(manifest: PluginManifest): void {
  if (!manifest.permissions?.includes('network:access')) {
    throw new Error('Plugin permission is required for network access: network:access')
  }
}

function readUrlOrigin(url: string): string {
  try {
    return new URL(url).origin
  } catch {
    throw new Error(`Invalid plugin network URL: ${url}`)
  }
}

function originAllowed(origin: string, allowedOrigins: readonly string[] | undefined): boolean {
  return allowedOrigins === undefined || allowedOrigins.includes(origin)
}

function auditNetworkSuccess(config: PluginNetworkBrokerConfig, url: string, origin: string): void {
  config.audit?.(
    Object.freeze({
      pluginId: config.manifest.id,
      url,
      origin,
      ok: true,
    }),
  )
}

function auditNetworkFailure(config: PluginNetworkBrokerConfig, url: string, error: unknown): void {
  config.audit?.(
    Object.freeze({
      pluginId: config.manifest.id,
      url,
      ok: false,
      reason: error instanceof Error ? error.message : String(error),
    }),
  )
}

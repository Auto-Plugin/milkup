import type { PluginManifest } from './manifest'

export interface PluginReleaseCheckResult {
  readonly configured: boolean
  readonly channel: string
  readonly currentVersion: string
  readonly release?: {
    readonly id: string
    readonly version: string
    readonly notes: string
    readonly date: string | null
  }
}

export interface PluginReleaseStatus {
  readonly phase: 'available' | 'downloading' | 'verifying' | 'ready' | 'error'
  readonly received: number
  readonly total: number | null
  readonly error?: string
}

export interface PluginReleaseInstallResult {
  readonly status: 'cancelled' | 'installing'
}

export interface PluginReleasesHost {
  check(): Promise<PluginReleaseCheckResult>
  stage(releaseId: string): Promise<void>
  status(releaseId: string): Promise<PluginReleaseStatus>
  cancel(releaseId: string): Promise<void>
  requestInstall(releaseId: string): Promise<PluginReleaseInstallResult>
}

export interface PluginReleasesBroker extends PluginReleasesHost {}

export interface RevocablePluginReleasesBroker extends PluginReleasesBroker {
  dispose(): void
}

/** Trusted host implementation: owns configuration, signatures and staging paths.
 * requestInstall MUST confirm in trusted host UI, save dirty documents and recheck
 * authorization before installation. No plugin argument can bypass that gate.
 */
export interface PluginReleasesBrokerAdapter extends PluginReleasesHost {}

export interface PluginReleasesBrokerConfig {
  readonly manifest: PluginManifest
  readonly adapter: PluginReleasesBrokerAdapter
  readonly isActive?: () => boolean
  readonly onDispose?: () => void
}

export function createPluginReleasesBroker(
  config: PluginReleasesBrokerConfig,
): RevocablePluginReleasesBroker {
  let disposed = false
  // Only IDs returned by the trusted host in this activation can cross back.
  const releases = new Set<string>()
  function assertActive(): void {
    if (disposed || config.isActive?.() === false)
      throw new Error('Plugin releases capability is revoked or disposed')
    if (!config.manifest.permissions?.includes('app:updates'))
      throw new Error('Plugin permission is required for releases: app:updates')
  }
  function assertRelease(id: string): void {
    assertActive()
    assertPluginReleaseId(id)
    if (!releases.has(id)) throw new Error('Unknown plugin release ID')
  }
  const host: PluginReleasesHost = {
    check: async () => {
      assertActive()
      const result = await config.adapter.check()
      assertActive()
      if (result.release) {
        assertPluginReleaseId(result.release.id)
        releases.add(result.release.id)
      }
      // Copy only public metadata: adapters must never leak URLs, keys or paths.
      return Object.freeze({
        configured: result.configured,
        channel: result.channel,
        currentVersion: result.currentVersion,
        ...(result.release
          ? {
              release: Object.freeze({
                id: result.release.id,
                version: result.release.version,
                notes: result.release.notes,
                date: result.release.date,
              }),
            }
          : {}),
      })
    },
    stage: async (id) => {
      assertRelease(id)
      await config.adapter.stage(id)
      assertActive()
    },
    status: async (id) => {
      assertRelease(id)
      const result = await config.adapter.status(id)
      assertActive()
      return Object.freeze({
        phase: result.phase,
        received: result.received,
        total: result.total,
        ...(result.error !== undefined ? { error: result.error } : {}),
      })
    },
    cancel: async (id) => {
      assertRelease(id)
      await config.adapter.cancel(id)
      assertActive()
    },
    requestInstall: async (id) => {
      assertRelease(id)
      const result = await config.adapter.requestInstall(id)
      assertActive()
      return Object.freeze({ status: result.status })
    },
  }
  return Object.freeze({
    ...host,
    dispose: () => {
      if (disposed) return
      disposed = true
      releases.clear()
      config.onDispose?.()
    },
  })
}

/** Per-activation guard also seals captured methods across disable/re-enable. */
export function createPluginReleasesHostCapabilities(
  broker: PluginReleasesBroker,
  isActive: () => boolean = () => true,
): PluginReleasesHost {
  const run = async <T>(operation: () => Promise<T>): Promise<T> => {
    if (!isActive()) throw new Error('Plugin releases capability is revoked or disposed')
    const result = await operation()
    if (!isActive()) throw new Error('Plugin releases capability is revoked or disposed')
    return result
  }
  return Object.freeze({
    check: () => run(() => broker.check()),
    stage: (id: string) => run(() => broker.stage(id)),
    status: (id: string) => run(() => broker.status(id)),
    cancel: (id: string) => run(() => broker.cancel(id)),
    requestInstall: (id: string) => run(() => broker.requestInstall(id)),
  })
}

export function assertPluginReleaseId(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value))
    throw new Error('Invalid opaque plugin release ID')
}

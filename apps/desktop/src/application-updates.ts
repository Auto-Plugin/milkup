import type { PluginReleasesHost, PluginReleaseCheckResult } from '@milkup/plugin'

export type ApplicationUpdatePhase =
  | 'idle'
  | 'checking'
  | 'unavailable'
  | 'current'
  | 'available'
  | 'downloading'
  | 'verifying'
  | 'ready'
  | 'cancelling'
  | 'confirming'
  | 'installing'
  | 'error'
export interface ApplicationUpdateState {
  readonly hasUpdate: boolean
  readonly phase: ApplicationUpdatePhase
  readonly channel?: string
  readonly currentVersion?: string
  readonly release?: PluginReleaseCheckResult['release']
  readonly received?: number
  readonly total?: number | null
  readonly error?: string | undefined
  readonly retry?: 'check' | 'download' | 'cancel' | undefined
}

/** One application-lifetime controller. Call start only after legacy plugin retirement.
 * Rendering/opening About never creates a controller or starts network requests.
 * The existing host adapter owns signed metadata, staging and protected installation.
 */
export function createApplicationUpdatesController(options: {
  service: { adapter: PluginReleasesHost; dispose(): void }
  currentVersion: string
  changed: () => void
}) {
  const backend = options.service.adapter
  let state: ApplicationUpdateState = Object.freeze({
    phase: 'idle',
    currentVersion: options.currentVersion,
    hasUpdate: false,
  })
  let started = false
  let alive = true
  let generation = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  let staging: Promise<void> | undefined
  const current = (request: number) => alive && generation === request
  const set = (next: ApplicationUpdateState) => {
    state = Object.freeze(next)
    if (alive) options.changed()
  }
  const stopTimer = () => {
    clearTimeout(timer)
    timer = undefined
  }
  const failure = (error: unknown) => (error instanceof Error ? error.message : String(error))
  const fail = (request: number, error: unknown, retry: ApplicationUpdateState['retry']) => {
    if (current(request))
      set({ ...state, phase: 'error', hasUpdate: false, error: failure(error), retry })
  }
  const busy = () =>
    ['checking', 'downloading', 'verifying', 'cancelling', 'confirming', 'installing'].includes(
      state.phase,
    )
  async function poll(request: number, id: string): Promise<void> {
    try {
      const status = await backend.status(id)
      if (!current(request)) return
      if (status.phase === 'error') {
        fail(request, status.error || '更新包下载或校验失败。', 'download')
        return
      }
      set({
        ...state,
        // Only native verification can restore a badge cleared by a failed
        // download. Progress or cancellation alone does not establish trust.
        hasUpdate: status.phase === 'ready' || state.hasUpdate,
        phase: status.phase,
        received: status.received,
        total: status.total,
      })
      if (status.phase === 'downloading' || status.phase === 'verifying')
        timer = setTimeout(() => {
          timer = undefined
          void poll(request, id)
        }, 500)
    } catch (error) {
      fail(request, error, 'download')
    }
  }
  const controller = {
    get state() {
      return state
    },
    async start() {
      if (!alive || started) return
      started = true
      await controller.check()
    },
    async check() {
      if (
        !alive ||
        busy() ||
        state.phase === 'ready' ||
        (state.phase === 'error' && state.retry === 'cancel')
      )
        return
      started = true
      stopTimer()
      const request = ++generation
      // A new native check revokes the previous token. Its release and badge
      // must disappear immediately, even if the replacement check later fails.
      set({
        hasUpdate: false,
        phase: 'checking',
        ...(state.currentVersion ? { currentVersion: state.currentVersion } : {}),
      })
      try {
        const result = await backend.check()
        if (!current(request)) return
        set({
          hasUpdate: Boolean(result.configured && result.release),
          channel: result.channel,
          currentVersion: result.currentVersion,
          ...(result.configured && result.release
            ? { release: Object.freeze({ ...result.release }) }
            : {}),
          phase: !result.configured ? 'unavailable' : result.release ? 'available' : 'current',
        })
      } catch (error) {
        fail(request, error, 'check')
      }
    },
    async download() {
      if (
        !alive ||
        !state.release ||
        !(state.phase === 'available' || (state.phase === 'error' && state.retry === 'download'))
      )
        return
      const release = state.release
      const retry = state.phase === 'error'
      const request = ++generation
      stopTimer()
      set({
        ...state,
        phase: 'downloading',
        received: 0,
        total: null,
        error: undefined,
        retry: undefined,
      })
      try {
        const host = backend
        if (retry) {
          await host.cancel(release.id)
          if (!current(request)) return
        }
        staging = host.stage(release.id)
        await staging
        if (current(request)) await poll(request, release.id)
      } catch (error) {
        fail(request, error, 'download')
      }
    },
    async cancel() {
      if (
        !alive ||
        !state.release ||
        !(
          ['downloading', 'verifying', 'ready'].includes(state.phase) ||
          (state.phase === 'error' && state.retry === 'cancel')
        )
      )
        return
      const release = state.release
      const request = ++generation
      stopTimer()
      set({ ...state, phase: 'cancelling' })
      try {
        await staging?.catch(() => undefined)
        if (!current(request)) return
        await backend.cancel(release.id)
        if (current(request))
          set({
            ...state,
            phase: 'available',
            received: 0,
            total: null,
            error: undefined,
            retry: undefined,
          })
      } catch (error) {
        fail(request, error, 'cancel')
      }
    },
    async install() {
      if (!alive || state.phase !== 'ready' || !state.release) return
      const request = ++generation
      const release = state.release
      set({ ...state, phase: 'confirming' })
      try {
        const result = await backend.requestInstall(release.id)
        if (current(request))
          set({ ...state, phase: result.status === 'cancelled' ? 'ready' : 'installing' })
      } catch (error) {
        fail(request, error, 'download')
      }
    },
    dispose(): void {
      if (!alive) return
      alive = false
      ++generation
      stopTimer()
      // Revoke immediately, including an in-flight check or confirmation. The
      // service cancels its own native token and releases any late candidate.
      options.service.dispose()
    },
  }
  return controller
}

export type ApplicationUpdatesController = ReturnType<typeof createApplicationUpdatesController>

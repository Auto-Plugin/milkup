import type { SdkPluginReleasesHost, SdkReleaseCheckResult } from '@milkup/plugin-sdk'

export type Phase =
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
export interface State {
  readonly phase: Phase
  readonly channel?: string
  readonly currentVersion?: string
  readonly release?: SdkReleaseCheckResult['release']
  readonly received?: number
  readonly total?: number | null
  readonly error?: string | undefined
  readonly retry?: 'check' | 'download' | 'cancel' | undefined
}

/** The plugin owns presentation and polling; only the host can stage or install. */
export function createController(backend: SdkPluginReleasesHost | undefined, changed: () => void) {
  let state: State = { phase: 'idle' }
  let alive = true
  let generation = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  let staging: Promise<void> | undefined
  let disposal: Promise<void> | undefined
  const current = (request: number) => alive && generation === request
  const set = (next: State) => {
    state = Object.freeze(next)
    if (alive) changed()
  }
  const stopTimer = () => {
    clearTimeout(timer)
    timer = undefined
  }
  const failure = (error: unknown) => (error instanceof Error ? error.message : String(error))
  const requireBackend = () => {
    if (!backend) throw new Error('软件更新权限不可用，请在插件详情中批准 app:updates 权限。')
    return backend
  }
  const fail = (request: number, error: unknown, retry: State['retry']) => {
    if (current(request)) set({ ...state, phase: 'error', error: failure(error), retry })
  }
  const busy = () =>
    ['checking', 'downloading', 'verifying', 'cancelling', 'confirming', 'installing'].includes(
      state.phase,
    )
  async function poll(request: number, id: string): Promise<void> {
    try {
      const status = await requireBackend().status(id)
      if (!current(request)) return
      if (status.phase === 'error') {
        fail(request, status.error || '更新包下载或校验失败。', 'download')
        return
      }
      set({ ...state, phase: status.phase, received: status.received, total: status.total })
      if (status.phase === 'downloading' || status.phase === 'verifying')
        timer = setTimeout(() => {
          timer = undefined
          void poll(request, id)
        }, 500)
    } catch (error) {
      fail(request, error, 'download')
    }
  }
  return {
    get state() {
      return state
    },
    async check() {
      if (
        !alive ||
        busy() ||
        state.phase === 'ready' ||
        (state.phase === 'error' && state.retry !== 'check')
      )
        return
      stopTimer()
      const request = ++generation
      set({
        phase: 'checking',
        ...(state.currentVersion ? { currentVersion: state.currentVersion } : {}),
      })
      try {
        const result = await requireBackend().check()
        if (!current(request)) return
        set({
          channel: result.channel,
          currentVersion: result.currentVersion,
          ...(result.configured && result.release ? { release: result.release } : {}),
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
      set({ ...state, phase: 'downloading', received: 0, total: null })
      try {
        const host = requireBackend()
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
        await requireBackend().cancel(release.id)
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
        const result = await requireBackend().requestInstall(release.id)
        if (current(request))
          set({ ...state, phase: result.status === 'cancelled' ? 'ready' : 'installing' })
      } catch (error) {
        fail(request, error, 'download')
      }
    },
    dispose(): Promise<void> {
      if (disposal) return disposal
      alive = false
      ++generation
      stopTimer()
      const release = state.release
      // Do not await a user confirmation (which can remain pending for minutes).
      disposal = (async () => {
        await staging?.catch(() => undefined)
        if (release && backend) await backend.cancel(release.id).catch(() => undefined)
      })()
      return disposal
    },
  }
}

export interface ApplicationUpdateInfo {
  readonly token: number
  readonly version: string
  readonly notes: string
  readonly date: string | null
}
export interface ApplicationUpdateProgress {
  readonly phase: 'downloading' | 'verifying'
  readonly received: number
  readonly total: number | null
}
export interface ApplicationUpdateBackend {
  check(): Promise<{ configured: boolean; channel: string; update: ApplicationUpdateInfo | null }>
  download(token: number, progress: (event: ApplicationUpdateProgress) => void): Promise<void>
  cancel(): Promise<void>
  install(token: number): Promise<void>
}
export type ApplicationUpdatePhase =
  | 'idle'
  | 'checking'
  | 'unavailable'
  | 'current'
  | 'available'
  | 'downloading'
  | 'verifying'
  | 'cancelling'
  | 'ready'
  | 'confirming'
  | 'installing'
  | 'error'
export interface ApplicationUpdateState {
  readonly phase: ApplicationUpdatePhase
  readonly update?: ApplicationUpdateInfo
  readonly received?: number
  readonly total?: number | null
  readonly error?: string
  readonly retry?: 'check' | 'download'
}

export function createApplicationUpdateController(
  backend: ApplicationUpdateBackend,
  changed: (state: ApplicationUpdateState) => void,
) {
  let state: ApplicationUpdateState = { phase: 'idle' }
  let generation = 0
  let downloadTask: Promise<void> | undefined
  const set = (next: ApplicationUpdateState) => {
    state = Object.freeze(next)
    changed(state)
  }
  const busy = () =>
    ['checking', 'downloading', 'verifying', 'cancelling', 'confirming', 'installing'].includes(
      state.phase,
    )
  const failure = (error: unknown) => (error instanceof Error ? error.message : String(error))

  return {
    get state() {
      return state
    },
    async check() {
      if (busy()) return
      const request = ++generation
      set({ phase: 'checking' })
      try {
        const result = await backend.check()
        if (request !== generation) return
        set(
          !result.configured
            ? { phase: 'unavailable' }
            : result.update
              ? { phase: 'available', update: result.update }
              : { phase: 'current' },
        )
      } catch (error) {
        if (request === generation) set({ phase: 'error', error: failure(error), retry: 'check' })
      }
    },
    async download() {
      if (busy() || !state.update || !['available', 'error'].includes(state.phase)) return
      const update = state.update
      const request = ++generation
      set({ phase: 'downloading', update, received: 0, total: null })
      downloadTask = (async () => {
        try {
          await backend.download(update.token, (event) => {
            if (request !== generation) return
            set({ phase: event.phase, update, received: event.received, total: event.total })
          })
          if (request === generation) set({ phase: 'ready', update })
        } catch (error) {
          if (request === generation)
            set({ phase: 'error', update, error: failure(error), retry: 'download' })
        }
      })()
      await downloadTask
    },
    async cancelDownload() {
      if (!['downloading', 'verifying'].includes(state.phase) || !state.update) return
      const update = state.update
      ++generation
      set({ phase: 'cancelling', update })
      try {
        await backend.cancel()
        await downloadTask
        set({ phase: 'available', update })
      } catch (error) {
        // Wait for the outstanding native operation before allowing another one.
        await downloadTask
        set({ phase: 'error', error: failure(error), retry: 'check' })
      }
    },
    requestInstallation() {
      if (state.phase === 'ready' && state.update)
        set({ phase: 'confirming', update: state.update })
    },
    cancelConfirmation() {
      if (state.phase === 'confirming' && state.update)
        set({ phase: 'ready', update: state.update })
    },
    async installAfterDocumentGuard() {
      if (state.phase !== 'confirming' || !state.update) return
      const update = state.update
      set({ phase: 'installing', update })
      try {
        await backend.install(update.token)
        // Native installation owns process restart. Remain locked until exit;
        // never claim successful restart just because IPC returned.
      } catch (error) {
        set({ phase: 'error', update, error: failure(error), retry: 'download' })
      }
    },
  }
}

export function nativeApplicationUpdateBackend(): ApplicationUpdateBackend {
  return {
    async check() {
      const { invoke } = await import('@tauri-apps/api/core')
      return invoke('check_application_update')
    },
    async download(token, onProgress) {
      const { invoke, Channel } = await import('@tauri-apps/api/core')
      const progress = new Channel<ApplicationUpdateProgress>()
      progress.onmessage = onProgress
      await invoke('download_application_update', { token, progress })
    },
    async cancel() {
      const { invoke } = await import('@tauri-apps/api/core')
      await invoke('cancel_application_update')
    },
    async install(token) {
      const { invoke } = await import('@tauri-apps/api/core')
      await invoke('install_application_update', { token })
    },
  }
}

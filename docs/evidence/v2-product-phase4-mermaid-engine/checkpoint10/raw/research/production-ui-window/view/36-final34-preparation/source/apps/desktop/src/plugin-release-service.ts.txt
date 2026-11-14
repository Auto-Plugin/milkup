import type {
  PluginReleasesBrokerAdapter,
  PluginReleaseInstallResult,
  PluginReleaseStatus,
} from '@milkup/plugin'

export interface ReleaseTransport {
  check(): Promise<{
    configured: boolean
    channel: string
    update: { token: number; version: string; notes: string; date: string | null } | null
  }>
  download(
    token: number,
    progress: (event: {
      phase: 'downloading' | 'verifying'
      received: number
      total: number | null
    }) => void,
  ): Promise<void>
  cancel(token: number): Promise<void>
  install(token: number): Promise<void>
}

/** Host infrastructure only: plugin owns discovery UI, polling, retry and presentation.
 * A scoped opaque ID maps to trusted native metadata; arbitrary paths/URLs never cross.
 */
export function createDesktopReleaseAdapter(options: {
  transport: ReleaseTransport
  currentVersion: string
  confirmInstall: (request: {
    version: string
    signal: AbortSignal
    install: () => Promise<void>
  }) => Promise<PluginReleaseInstallResult>
}) {
  const abort = new AbortController()
  let candidate: { id: string; token: number; version: string } | undefined
  let status: PluginReleaseStatus = { phase: 'available', received: 0, total: null }
  let downloading: Promise<void> | undefined
  let generation = 0
  let checking = false
  let installing = false
  let cancelling = false
  const active = () => {
    if (abort.signal.aborted) throw Error('插件更新能力已撤销')
  }
  const requireCandidate = (id: string) => {
    active()
    if (!candidate || candidate.id !== id) throw Error('版本信息已失效，请重新检查')
    return candidate
  }
  const adapter: PluginReleasesBrokerAdapter = {
    async check() {
      active()
      if (checking || downloading || installing || cancelling) throw Error('发行操作正在进行')
      checking = true
      const request = ++generation
      try {
        if (candidate) await options.transport.cancel(candidate.token)
        candidate = undefined
        active()
        const result = await options.transport.check()
        if (abort.signal.aborted || request !== generation) {
          // The native result can arrive after this capability was disposed. Release
          // only its own token; the transport must not cancel a newer candidate.
          if (result.update) await options.transport.cancel(result.update.token).catch(() => {})
          active()
          throw Error('发行请求已取消')
        }
        status = { phase: 'available', received: 0, total: null }
        const release = result.update
          ? {
              id: crypto.randomUUID(),
              version: result.update.version,
              notes: result.update.notes,
              date: result.update.date,
            }
          : undefined
        if (release && result.update)
          candidate = { id: release.id, token: result.update.token, version: release.version }
        return {
          configured: result.configured,
          channel: result.channel,
          currentVersion: options.currentVersion,
          ...(release ? { release } : {}),
        }
      } finally {
        checking = false
      }
    },
    async stage(id) {
      const current = requireCandidate(id)
      if (checking || downloading || installing || cancelling) throw Error('发行操作正在进行')
      const request = ++generation
      status = { phase: 'downloading', received: 0, total: null }
      let settled = false
      downloading = Promise.resolve()
        .then(() => {
          active()
          if (request !== generation) throw Error('发行请求已取消')
          return options.transport.download(current.token, (event) => {
            if (!settled && !abort.signal.aborted && request === generation) status = { ...event }
          })
        })
        .then(
          () => {
            settled = true
            if (!abort.signal.aborted && request === generation)
              status = { ...status, phase: 'ready' }
          },
          (error) => {
            settled = true
            if (!abort.signal.aborted && request === generation)
              status = {
                ...status,
                phase: 'error',
                error: error instanceof Error ? error.message : String(error),
              }
          },
        )
        .finally(() => {
          downloading = undefined
        })
    },
    async status(id) {
      requireCandidate(id)
      return { ...status }
    },
    async cancel(id) {
      const current = requireCandidate(id)
      if (checking || installing || cancelling) throw Error('发行操作正在进行')
      cancelling = true
      const request = ++generation
      try {
        await options.transport.cancel(current.token)
        await downloading
        active()
        if (request !== generation) throw Error('发行请求已取消')
        status = { phase: 'available', received: 0, total: null }
      } catch (error) {
        if (!abort.signal.aborted && request === generation)
          status = {
            ...status,
            phase: 'error',
            error: error instanceof Error ? error.message : String(error),
          }
        throw error
      } finally {
        cancelling = false
      }
    },
    async requestInstall(id) {
      const current = requireCandidate(id)
      if (status.phase !== 'ready' || checking || downloading || installing || cancelling)
        throw Error('安装包尚未通过校验')
      installing = true
      let confirmationActive = true
      let installInvoked = false
      try {
        return await options.confirmInstall({
          version: current.version,
          signal: abort.signal,
          install: async () => {
            if (!confirmationActive || installInvoked) throw Error('安装确认已失效')
            requireCandidate(id)
            if (status.phase !== 'ready') throw Error('安装包尚未通过校验')
            installInvoked = true
            try {
              await options.transport.install(current.token)
            } catch (error) {
              status = { ...status, phase: 'error', error: String(error) }
              throw error
            }
          },
        })
      } finally {
        confirmationActive = false
        installing = false
      }
    },
  }
  return {
    adapter,
    dispose() {
      if (abort.signal.aborted) return
      abort.abort()
      ++generation
      if (candidate) void options.transport.cancel(candidate.token).catch(() => {})
      candidate = undefined
    },
  }
}

export function nativeReleaseTransport(): ReleaseTransport {
  return {
    async check() {
      const { invoke } = await import('@tauri-apps/api/core')
      return invoke('check_application_update')
    },
    async download(token, onProgress) {
      const { invoke, Channel } = await import('@tauri-apps/api/core')
      const progress = new Channel<{
        phase: 'downloading' | 'verifying'
        received: number
        total: number | null
      }>()
      progress.onmessage = onProgress
      await invoke('download_application_update', { token, progress })
    },
    async cancel(token) {
      const { invoke } = await import('@tauri-apps/api/core')
      await invoke('cancel_application_update', { token })
    },
    async install(token) {
      const { invoke } = await import('@tauri-apps/api/core')
      await invoke('install_application_update', { token })
    },
  }
}

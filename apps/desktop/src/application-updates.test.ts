import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PluginReleaseCheckResult, PluginReleaseStatus } from '@milkup/plugin'
import { createApplicationUpdatesController } from './application-updates'

const release = { id: 'release-1', version: '2.0.1', notes: '<b>plain notes</b>', date: null }
const available: PluginReleaseCheckResult = {
  configured: true,
  channel: 'stable',
  currentVersion: '2.0.0',
  release,
}
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}
function fixture() {
  const adapter = {
    check: vi.fn(async (): Promise<PluginReleaseCheckResult> => available),
    stage: vi.fn(async (_id: string) => {}),
    status: vi.fn(async (_id: string): Promise<PluginReleaseStatus> => ({
      phase: 'ready',
      received: 10,
      total: 10,
    })),
    cancel: vi.fn(async (_id: string) => {}),
    requestInstall: vi.fn(async (_id: string): Promise<{ status: 'cancelled' | 'installing' }> => ({
      status: 'cancelled',
    })),
  }
  const dispose = vi.fn()
  const changed = vi.fn()
  const controller = createApplicationUpdatesController({
    service: { adapter, dispose },
    currentVersion: '2.0.0',
    changed,
  })
  return { controller, adapter, dispose, changed }
}
afterEach(() => vi.useRealTimers())

describe('host application updates controller', () => {
  it('does no work on construction or state reads and starts once after migration', async () => {
    const f = fixture()
    expect(f.controller.state).toMatchObject({
      phase: 'idle',
      hasUpdate: false,
      currentVersion: '2.0.0',
    })
    expect(f.adapter.check).not.toHaveBeenCalled()
    await Promise.all([f.controller.start(), f.controller.start(), f.controller.check()])
    await f.controller.start()
    expect(f.adapter.check).toHaveBeenCalledTimes(1)
    expect(f.controller.state).toMatchObject({ phase: 'available', hasUpdate: true, release })
    expect(f.adapter.stage).not.toHaveBeenCalled()
    f.controller.dispose()
  })

  it('does not duplicate an explicit check when startup is called later', async () => {
    const f = fixture()
    await f.controller.check()
    await f.controller.start()
    expect(f.adapter.check).toHaveBeenCalledTimes(1)
  })

  it.each(['offline', 'signature rejected', 'check timed out'])(
    'never reports current or a red dot on %s',
    async (message) => {
      const f = fixture()
      f.adapter.check.mockRejectedValueOnce(Error(message))
      await f.controller.start()
      expect(f.controller.state).toMatchObject({
        phase: 'error',
        error: message,
        retry: 'check',
        hasUpdate: false,
      })
      await f.controller.check()
      expect(f.controller.state).toMatchObject({ phase: 'available', hasUpdate: true })
    },
  )

  it('clears the badge and revoked release ID when rechecking, including a failed recheck', async () => {
    const f = fixture()
    await f.controller.check()
    const recheck = deferred<PluginReleaseCheckResult>()
    f.adapter.check.mockReturnValueOnce(recheck.promise)
    const pending = f.controller.check()
    expect(f.controller.state).toMatchObject({ phase: 'checking', hasUpdate: false })
    expect(f.controller.state.release).toBeUndefined()
    recheck.reject(Error('offline'))
    await pending
    expect(f.controller.state).toMatchObject({ phase: 'error', hasUpdate: false, retry: 'check' })
    expect(f.controller.state.release).toBeUndefined()
    await f.controller.download()
    expect(f.adapter.stage).not.toHaveBeenCalled()
    f.adapter.check.mockResolvedValueOnce({
      configured: true,
      channel: 'stable',
      currentVersion: '2.0.0',
    })
    await f.controller.check()
    expect(f.controller.state).toMatchObject({ phase: 'current', hasUpdate: false })
  })

  it('distinguishes an unconfigured channel from a successful no-update result', async () => {
    const f = fixture()
    f.adapter.check.mockResolvedValueOnce({ ...available, configured: false })
    await f.controller.check()
    expect(f.controller.state).toMatchObject({ phase: 'unavailable', hasUpdate: false })
    expect(f.controller.state.release).toBeUndefined()
  })

  it('polls one download through verification, then asks the existing trusted install gate', async () => {
    vi.useFakeTimers()
    const f = fixture()
    f.adapter.status
      .mockResolvedValueOnce({ phase: 'downloading', received: 2, total: null })
      .mockResolvedValueOnce({ phase: 'verifying', received: 10, total: 10 })
    await f.controller.check()
    await Promise.all([f.controller.download(), f.controller.download()])
    expect(f.adapter.stage).toHaveBeenCalledTimes(1)
    expect(f.controller.state.phase).toBe('downloading')
    await f.controller.install()
    expect(f.adapter.requestInstall).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(500)
    expect(f.controller.state.phase).toBe('verifying')
    await vi.advanceTimersByTimeAsync(500)
    expect(f.controller.state.phase).toBe('ready')
    expect(vi.getTimerCount()).toBe(0)
    await f.controller.install()
    expect(f.adapter.requestInstall).toHaveBeenCalledWith(release.id)
    expect(f.controller.state.phase).toBe('ready')
    f.adapter.requestInstall.mockResolvedValueOnce({ status: 'installing' })
    await f.controller.install()
    expect(f.controller.state.phase).toBe('installing')
  })

  it('keeps cancellation failures retryable and never starts a new check over them', async () => {
    const f = fixture()
    await f.controller.check()
    await f.controller.download()
    f.adapter.cancel.mockRejectedValueOnce(Error('cancel failed'))
    await f.controller.cancel()
    expect(f.controller.state).toMatchObject({ phase: 'error', retry: 'cancel' })
    await f.controller.check()
    expect(f.adapter.check).toHaveBeenCalledTimes(1)
    await f.controller.cancel()
    expect(f.controller.state).toMatchObject({
      phase: 'available',
      hasUpdate: false,
      error: undefined,
      retry: undefined,
    })
  })

  it('requires a new verified download after download or installation failure', async () => {
    const f = fixture()
    await f.controller.check()
    f.adapter.status.mockResolvedValueOnce({
      phase: 'error',
      received: 10,
      total: 10,
      error: 'signature rejected',
    })
    await f.controller.download()
    expect(f.controller.state).toMatchObject({
      phase: 'error',
      retry: 'download',
      hasUpdate: false,
    })
    await f.controller.install()
    expect(f.adapter.requestInstall).not.toHaveBeenCalled()
    await f.controller.download()
    expect(f.adapter.cancel).toHaveBeenCalledWith(release.id)
    expect(f.controller.state).toMatchObject({
      phase: 'ready',
      hasUpdate: true,
      error: undefined,
      retry: undefined,
    })
    f.adapter.requestInstall.mockRejectedValueOnce(Error('install failed'))
    await f.controller.install()
    expect(f.controller.state).toMatchObject({
      phase: 'error',
      retry: 'download',
      hasUpdate: false,
    })
    await f.controller.install()
    expect(f.adapter.requestInstall).toHaveBeenCalledTimes(1)
  })

  it('restores the badge only after a failed download retry is freshly verified', async () => {
    vi.useFakeTimers()
    const f = fixture()
    await f.controller.check()
    f.adapter.status.mockResolvedValueOnce({
      phase: 'error',
      received: 0,
      total: null,
      error: 'candidate expired',
    })
    await f.controller.download()
    expect(f.controller.state.hasUpdate).toBe(false)
    f.adapter.status
      .mockResolvedValueOnce({ phase: 'downloading', received: 1, total: 10 })
      .mockResolvedValueOnce({ phase: 'verifying', received: 10, total: 10 })
    await f.controller.download()
    expect(f.controller.state).toMatchObject({ phase: 'downloading', hasUpdate: false })
    await vi.advanceTimersByTimeAsync(500)
    expect(f.controller.state).toMatchObject({ phase: 'verifying', hasUpdate: false })
    await vi.advanceTimersByTimeAsync(500)
    expect(f.controller.state).toMatchObject({ phase: 'ready', hasUpdate: true })
  })

  it('ignores a late poll after cancellation and stops polling when disposed', async () => {
    vi.useFakeTimers()
    const f = fixture()
    const status = deferred<PluginReleaseStatus>()
    f.adapter.status.mockReturnValueOnce(status.promise)
    await f.controller.check()
    const downloading = f.controller.download()
    await vi.waitFor(() => expect(f.adapter.status).toHaveBeenCalled())
    await f.controller.cancel()
    status.resolve({ phase: 'ready', received: 10, total: 10 })
    await downloading
    expect(f.controller.state.phase).toBe('available')
    f.adapter.status.mockResolvedValueOnce({ phase: 'downloading', received: 0, total: null })
    await f.controller.download()
    expect(vi.getTimerCount()).toBe(1)
    f.controller.dispose()
    f.controller.dispose()
    expect(vi.getTimerCount()).toBe(0)
    expect(f.dispose).toHaveBeenCalledTimes(1)
  })

  it('disposes the adapter immediately and ignores late checks and pending install confirmations', async () => {
    const f = fixture()
    const check = deferred<PluginReleaseCheckResult>()
    f.adapter.check.mockReturnValueOnce(check.promise)
    const pending = f.controller.start()
    f.controller.dispose()
    const notifications = f.changed.mock.calls.length
    expect(f.dispose).toHaveBeenCalledTimes(1)
    check.resolve(available)
    await pending
    await f.controller.check()
    expect(f.changed).toHaveBeenCalledTimes(notifications)
    expect(f.controller.state.hasUpdate).toBe(false)
    const g = fixture()
    await g.controller.check()
    await g.controller.download()
    const confirmation = deferred<{ status: 'cancelled' | 'installing' }>()
    g.adapter.requestInstall.mockReturnValueOnce(confirmation.promise)
    const installing = g.controller.install()
    g.controller.dispose()
    expect(g.dispose).toHaveBeenCalledTimes(1)
    confirmation.resolve({ status: 'installing' })
    await installing
    expect(g.controller.state.phase).toBe('confirming')
  })
})

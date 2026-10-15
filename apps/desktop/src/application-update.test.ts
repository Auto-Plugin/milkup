import { describe, expect, it, vi } from 'vitest'
import {
  createApplicationUpdateController,
  type ApplicationUpdateBackend,
  type ApplicationUpdateProgress,
} from './application-update'

const update = {
  token: 7,
  version: '2.0.0-beta.2',
  notes: '<script>literal release notes</script>',
  date: null,
}
function deferred() {
  let resolve!: () => void
  let reject!: (error: Error) => void
  const promise = new Promise<void>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}
function fixture() {
  const backend = {
    check: vi.fn(async () => ({ configured: true, channel: 'beta', update })),
    download: vi.fn<ApplicationUpdateBackend['download']>(async () => {}),
    cancel: vi.fn(async () => {}),
    install: vi.fn(async () => {}),
  }
  const changed = vi.fn()
  return { backend, changed, controller: createApplicationUpdateController(backend, changed) }
}

describe('application update lifecycle', () => {
  it('requires download verification and explicit confirmation before installation', async () => {
    const f = fixture()
    await f.controller.installAfterDocumentGuard()
    await f.controller.check()
    f.controller.requestInstallation()
    expect(f.controller.state.phase).toBe('available')
    await f.controller.download()
    expect(f.controller.state.phase).toBe('ready')
    expect(f.backend.install).not.toHaveBeenCalled()
    f.controller.requestInstallation()
    f.controller.cancelConfirmation()
    await f.controller.installAfterDocumentGuard()
    expect(f.backend.install).not.toHaveBeenCalled()
    f.controller.requestInstallation()
    await f.controller.installAfterDocumentGuard()
    await f.controller.installAfterDocumentGuard()
    expect(f.backend.install).toHaveBeenCalledExactlyOnceWith(7)
    expect(f.controller.state.phase).toBe('installing')
  })
  it('does not claim current when a distribution channel is absent', async () => {
    const f = fixture()
    f.backend.check.mockResolvedValue({ configured: false, channel: 'beta', update })
    await f.controller.check()
    expect(f.controller.state).toEqual({ phase: 'unavailable' })
    await f.controller.download()
    expect(f.backend.download).not.toHaveBeenCalled()
  })
  it('retries failed checks without keeping stale release information', async () => {
    const f = fixture()
    await f.controller.check()
    f.backend.check.mockRejectedValueOnce(Error('offline'))
    await f.controller.check()
    expect(f.controller.state).toEqual({ phase: 'error', error: 'offline', retry: 'check' })
    await f.controller.check()
    expect(f.controller.state.phase).toBe('available')
  })
  it('keeps signature failure un-installable and retries the full download', async () => {
    const f = fixture()
    f.backend.download.mockRejectedValueOnce(Error('bad signature'))
    await f.controller.check()
    await f.controller.download()
    f.controller.requestInstallation()
    await f.controller.installAfterDocumentGuard()
    expect(f.backend.install).not.toHaveBeenCalled()
    expect(f.controller.state).toMatchObject({ phase: 'error', retry: 'download' })
    await f.controller.download()
    expect(f.backend.download).toHaveBeenCalledTimes(2)
    expect(f.controller.state.phase).toBe('ready')
  })
  it('shows unknown/known totals and waits past transfer completion for signature verification', async () => {
    const f = fixture(),
      task = deferred()
    let progress!: (event: ApplicationUpdateProgress) => void
    f.backend.download.mockImplementation(async (_token, callback) => {
      progress = callback
      await task.promise
    })
    await f.controller.check()
    const pending = f.controller.download()
    await f.controller.download()
    progress({ phase: 'downloading', received: 3, total: null })
    expect(f.controller.state).toMatchObject({ received: 3, total: null })
    progress({ phase: 'downloading', received: 6, total: 10 })
    progress({ phase: 'verifying', received: 10, total: null })
    f.controller.requestInstallation()
    expect(f.controller.state.phase).toBe('verifying')
    expect(f.backend.download).toHaveBeenCalledTimes(1)
    task.resolve()
    await pending
    expect(f.controller.state.phase).toBe('ready')
  })
  it('cancels an active download and ignores late progress/completion before retrying', async () => {
    const f = fixture(),
      task = deferred()
    let progress!: (event: ApplicationUpdateProgress) => void
    f.backend.download.mockImplementationOnce(async (_token, callback) => {
      progress = callback
      await task.promise
    })
    await f.controller.check()
    const downloading = f.controller.download()
    const cancelling = f.controller.cancelDownload()
    progress({ phase: 'verifying', received: 10, total: null })
    expect(f.controller.state.phase).toBe('cancelling')
    await f.controller.check()
    expect(f.backend.check).toHaveBeenCalledTimes(1)
    task.resolve()
    await downloading
    await cancelling
    expect(f.controller.state.phase).toBe('available')
    await f.controller.download()
    expect(f.controller.state.phase).toBe('ready')
  })
  it('unlocks after installation failure and requires a new verified download', async () => {
    const f = fixture()
    f.backend.install.mockRejectedValueOnce(Error('installer denied'))
    await f.controller.check()
    await f.controller.download()
    f.controller.requestInstallation()
    await f.controller.installAfterDocumentGuard()
    expect(f.controller.state).toMatchObject({ phase: 'error', retry: 'download' })
    f.controller.requestInstallation()
    await f.controller.installAfterDocumentGuard()
    expect(f.backend.install).toHaveBeenCalledTimes(1)
  })
})

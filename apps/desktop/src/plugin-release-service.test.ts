import { describe, expect, it, vi } from 'vitest'
import { createDesktopReleaseAdapter, type ReleaseTransport } from './plugin-release-service'
import { createProtectedInstallGate } from './protected-install'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}
const metadata = {
  configured: true,
  channel: 'stable',
  update: { token: 42, version: '2.0.1', notes: 'notes', date: null },
}
const flush = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve()
}
type Confirmation = Parameters<
  Parameters<typeof createDesktopReleaseAdapter>[0]['confirmInstall']
>[0]
function fixture() {
  const downloads: {
    operation: ReturnType<typeof deferred<void>>
    progress: Parameters<ReleaseTransport['download']>[1]
  }[] = []
  const transport = {
    check: vi.fn(async () => metadata),
    download: vi.fn((_token: number, progress: Parameters<ReleaseTransport['download']>[1]) => {
      const operation = deferred<void>()
      downloads.push({ operation, progress })
      return operation.promise
    }),
    cancel: vi.fn(async (_token: number) => {}),
    install: vi.fn(async (_token: number) => {}),
  }
  const confirmInstall = vi.fn(
    async (_request: Confirmation): Promise<{ status: 'cancelled' | 'installing' }> => ({
      status: 'cancelled',
    }),
  )
  const service = createDesktopReleaseAdapter({
    transport,
    currentVersion: '2.0.0',
    confirmInstall,
  })
  const ready = async () => {
    const result = await service.adapter.check()
    const id = result.release!.id
    await service.adapter.stage(id)
    downloads.at(-1)!.operation.resolve()
    await flush()
    return id
  }
  return { ...service, transport, confirmInstall, downloads, ready }
}

describe('desktop release capability adapter', () => {
  it('maps only its issued opaque release ID to the native token and exposes no URL or token', async () => {
    const f = fixture()
    const result = await f.adapter.check()
    expect(Object.keys(result.release!)).toEqual(['id', 'version', 'notes', 'date'])
    expect(result.release!.id).toMatch(/^[A-Za-z0-9_-]+$/)
    for (const id of ['42', '2.0.1', 'https://example.org/update', '/tmp/update', 'unknown']) {
      await expect(f.adapter.stage(id)).rejects.toThrow()
      await expect(f.adapter.status(id)).rejects.toThrow()
      await expect(f.adapter.cancel(id)).rejects.toThrow()
      await expect(f.adapter.requestInstall(id)).rejects.toThrow()
    }
    expect(f.transport.download).not.toHaveBeenCalled()
    expect(f.transport.install).not.toHaveBeenCalled()
    await f.adapter.stage(result.release!.id)
    expect(f.transport.download).toHaveBeenCalledWith(42, expect.any(Function))
    f.downloads[0]!.operation.resolve()
    await flush()
    f.dispose()
  })

  it('returns from stage before download completes and marks ready only after native verification succeeds', async () => {
    const f = fixture()
    const id = (await f.adapter.check()).release!.id
    await f.adapter.stage(id)
    expect(await f.adapter.status(id)).toMatchObject({ phase: 'downloading' })
    f.downloads[0]!.progress({ phase: 'verifying', received: 10, total: null })
    expect(await f.adapter.status(id)).toMatchObject({ phase: 'verifying' })
    await expect(f.adapter.requestInstall(id)).rejects.toThrow()
    f.downloads[0]!.operation.resolve()
    await flush()
    expect(await f.adapter.status(id)).toEqual({ phase: 'ready', received: 10, total: null })
    expect(f.transport.install).not.toHaveBeenCalled()
    f.dispose()
  })

  it.each(['ready', 'error'] as const)('ignores late progress after terminal %s', async (phase) => {
    const f = fixture()
    const id = (await f.adapter.check()).release!.id
    await f.adapter.stage(id)
    if (phase === 'ready') f.downloads[0]!.operation.resolve()
    else f.downloads[0]!.operation.reject(Error('signature rejected'))
    await flush()
    f.downloads[0]!.progress({ phase: 'downloading', received: 3, total: 10 })
    expect(await f.adapter.status(id)).toMatchObject({ phase })
    f.dispose()
  })

  it('retries failed verification without allowing old progress to affect the retry', async () => {
    const f = fixture()
    const id = (await f.adapter.check()).release!.id
    await f.adapter.stage(id)
    f.downloads[0]!.operation.reject(Error('signature rejected'))
    await flush()
    expect(await f.adapter.status(id)).toMatchObject({
      phase: 'error',
      error: 'signature rejected',
    })
    await expect(f.adapter.requestInstall(id)).rejects.toThrow()
    await f.adapter.stage(id)
    f.downloads[0]!.progress({ phase: 'verifying', received: 99, total: 99 })
    expect(await f.adapter.status(id)).toEqual({ phase: 'downloading', received: 0, total: null })
    f.downloads[1]!.operation.resolve()
    await flush()
    expect(await f.adapter.status(id)).toMatchObject({ phase: 'ready' })
    f.dispose()
  })

  it.each(['stage', 'check', 'requestInstall'] as const)(
    'blocks %s while cancellation is pending',
    async (method) => {
      const f = fixture()
      const id = await f.ready()
      const cancellation = deferred<void>()
      f.transport.cancel.mockReturnValueOnce(cancellation.promise)
      const pending = f.adapter.cancel(id)
      const attempted = method === 'check' ? f.adapter.check() : f.adapter[method](id)
      await expect(attempted).rejects.toThrow()
      expect(f.confirmInstall).not.toHaveBeenCalled()
      cancellation.resolve()
      await pending
      expect(await f.adapter.status(id)).toEqual({ phase: 'available', received: 0, total: null })
      f.dispose()
    },
  )

  it('cancels downloads and ignores old callbacks before a subsequent retry', async () => {
    const f = fixture()
    const id = (await f.adapter.check()).release!.id
    await f.adapter.stage(id)
    const cancellation = f.adapter.cancel(id)
    f.downloads[0]!.progress({ phase: 'verifying', received: 50, total: 50 })
    f.downloads[0]!.operation.reject(Error('aborted'))
    await cancellation
    expect(await f.adapter.status(id)).toMatchObject({ phase: 'available' })
    await f.adapter.stage(id)
    f.downloads[0]!.progress({ phase: 'verifying', received: 99, total: 99 })
    expect(await f.adapter.status(id)).toMatchObject({ phase: 'downloading', received: 0 })
    f.dispose()
    expect(f.transport.cancel).toHaveBeenCalledWith(42)
    f.downloads[1]!.operation.resolve()
    await flush()
    await expect(f.adapter.status(id)).rejects.toThrow('撤销')
  })

  it('releases a native candidate returned after disposal', async () => {
    const f = fixture()
    const check = deferred<typeof metadata>()
    f.transport.check.mockReturnValueOnce(check.promise)
    const pending = f.adapter.check()
    const rejected = expect(pending).rejects.toThrow('撤销')
    f.dispose()
    check.resolve(metadata)
    await rejected
    expect(f.transport.cancel).toHaveBeenCalledWith(42)
  })

  it('does not start another native check after disposal during old-candidate cancellation', async () => {
    const f = fixture()
    await f.adapter.check()
    const cancellation = deferred<void>()
    f.transport.cancel.mockReturnValueOnce(cancellation.promise)
    const pending = f.adapter.check()
    const rejected = expect(pending).rejects.toThrow('撤销')
    f.dispose()
    cancellation.resolve()
    await rejected
    expect(f.transport.check).toHaveBeenCalledTimes(1)
  })

  it('invalidates old release IDs when checking again', async () => {
    const f = fixture()
    const old = (await f.adapter.check()).release!.id
    const next = (await f.adapter.check()).release!.id
    expect(next).not.toBe(old)
    await expect(f.adapter.stage(old)).rejects.toThrow('失效')
    f.dispose()
  })

  it('seals installation callbacks after confirmation cancellation', async () => {
    const f = fixture()
    const id = await f.ready()
    expect(await f.adapter.requestInstall(id)).toEqual({ status: 'cancelled' })
    const stale = f.confirmInstall.mock.calls[0]![0].install
    await expect(stale()).rejects.toThrow()
    expect(f.transport.install).not.toHaveBeenCalled()
    f.dispose()
  })

  it('cancels trusted pending confirmation when the service is disposed', async () => {
    const f = fixture()
    let proceed: (() => Promise<void>) | undefined
    const cancelTransition = vi.fn()
    const gate = createProtectedInstallGate({
      busy: () => false,
      requestTransition: async (action) => {
        proceed = action
      },
      cancelTransition,
      prepareDocument: async () => {},
      setInstalling: vi.fn(),
    })
    f.confirmInstall.mockImplementation((request) => gate.request(request))
    const id = await f.ready()
    const pending = f.adapter.requestInstall(id)
    f.dispose()
    expect(await pending).toEqual({ status: 'cancelled' })
    expect(cancelTransition).toHaveBeenCalledTimes(1)
    await proceed!()
    expect(f.transport.install).not.toHaveBeenCalled()
    expect(f.transport.cancel).toHaveBeenCalledWith(42)
  })

  it('installs once through trusted confirmation and reports native installation failure', async () => {
    const f = fixture()
    const id = await f.ready()
    f.confirmInstall.mockImplementation(async ({ install }) => {
      await install()
      return { status: 'installing' }
    })
    f.transport.install.mockRejectedValueOnce(Error('native failure'))
    await expect(f.adapter.requestInstall(id)).rejects.toThrow('native failure')
    expect(await f.adapter.status(id)).toMatchObject({ phase: 'error' })
    await expect(f.adapter.requestInstall(id)).rejects.toThrow('校验')
    expect(f.transport.install).toHaveBeenCalledTimes(1)
    f.dispose()
  })
})

import { describe, expect, it, vi } from 'vitest'
import { createProtectedInstallGate } from './protected-install'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
function fixture() {
  let proceed!: () => Promise<void>
  const options = {
    busy: vi.fn(() => false),
    requestTransition: vi.fn(async (action: () => Promise<void>) => {
      proceed = action
    }),
    cancelTransition: vi.fn(),
    prepareDocument: vi.fn(async () => {}),
    setInstalling: vi.fn(),
    returnFocus: vi.fn(),
  }
  const gate = createProtectedInstallGate(options)
  const abort = new AbortController()
  const install = vi.fn(async () => {})
  const request = () => gate.request({ version: '2.0.1', signal: abort.signal, install })
  return { gate, options, abort, install, request, proceed: () => proceed() }
}

describe('trusted install gate', () => {
  it('waits for explicit transition confirmation even for an otherwise idle clean document', async () => {
    const f = fixture()
    const pending = f.request()
    expect(f.gate.version).toBe('2.0.1')
    expect(f.options.requestTransition).toHaveBeenCalledTimes(1)
    expect(f.options.prepareDocument).not.toHaveBeenCalled()
    expect(f.install).not.toHaveBeenCalled()
    await f.proceed()
    expect(await pending).toEqual({ status: 'installing' })
    expect(f.options.prepareDocument).toHaveBeenCalledTimes(1)
    expect(f.install).toHaveBeenCalledTimes(1)
    expect(f.gate.version).toBeUndefined()
  })

  it('expires unconfirmed requests after nine minutes, leaving stale confirmation inert', async () => {
    vi.useFakeTimers()
    try {
      const f = fixture()
      const pending = f.request()
      await vi.advanceTimersByTimeAsync(9 * 60_000 - 1)
      expect(f.gate.version).toBe('2.0.1')
      await vi.advanceTimersByTimeAsync(1)
      expect(await pending).toEqual({ status: 'cancelled' })
      expect(f.options.cancelTransition).toHaveBeenCalledTimes(1)
      expect(f.options.returnFocus).toHaveBeenCalledTimes(1)
      await f.proceed()
      expect(f.options.prepareDocument).not.toHaveBeenCalled()
      expect(f.install).not.toHaveBeenCalled()
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it.each(['cancel', 'abort'] as const)(
    'does not install after %s during document preparation',
    async (action) => {
      const f = fixture()
      const preparation = deferred<void>()
      f.options.prepareDocument.mockReturnValueOnce(preparation.promise)
      const pending = f.request()
      const proceed = f.proceed()
      if (action === 'abort') f.abort.abort()
      else f.gate.cancel()
      expect(await pending).toEqual({ status: 'cancelled' })
      preparation.resolve()
      await proceed
      expect(f.install).not.toHaveBeenCalled()
      expect(f.options.setInstalling).toHaveBeenLastCalledWith(false)
      expect(f.gate.version).toBeUndefined()
    },
  )

  it('keeps installation blocked when prepare rejects and allows a new confirmation', async () => {
    const f = fixture()
    f.options.prepareDocument.mockRejectedValueOnce(Error('draft still dirty'))
    const pending = f.request()
    const failed = expect(pending).rejects.toThrow('draft still dirty')
    await f.proceed()
    await failed
    expect(f.install).not.toHaveBeenCalled()
    expect(f.options.setInstalling).toHaveBeenLastCalledWith(false)
    const retry = f.request()
    f.gate.cancel()
    expect(await retry).toEqual({ status: 'cancelled' })
  })

  it('cleans up after synchronous transition failure so another request can be made', async () => {
    const f = fixture()
    f.options.requestTransition.mockImplementationOnce(() => {
      throw Error('transition failed')
    })
    await expect(f.request()).rejects.toThrow('transition failed')
    expect(f.gate.version).toBeUndefined()
    expect(f.options.cancelTransition).toHaveBeenCalledTimes(1)
    const retry = f.request()
    f.gate.cancel()
    expect(await retry).toEqual({ status: 'cancelled' })
  })

  it('executes preparation and installation once if the confirmation callback is replayed', async () => {
    const f = fixture()
    const preparation = deferred<void>()
    f.options.prepareDocument.mockReturnValue(preparation.promise)
    const pending = f.request()
    const first = f.proceed()
    const replay = f.proceed()
    preparation.resolve()
    await Promise.all([first, replay])
    expect(await pending).toEqual({ status: 'installing' })
    expect(f.options.prepareDocument).toHaveBeenCalledTimes(1)
    expect(f.install).toHaveBeenCalledTimes(1)
  })

  it('rejects concurrent/busy requests and honours an already aborted signal', async () => {
    const f = fixture()
    f.options.busy.mockReturnValueOnce(true)
    await expect(f.request()).rejects.toThrow('文档操作')
    const first = f.request()
    await expect(f.request()).rejects.toThrow('文档操作')
    f.abort.abort()
    expect(await first).toEqual({ status: 'cancelled' })
    expect(await f.request()).toEqual({ status: 'cancelled' })
    expect(f.install).not.toHaveBeenCalled()
  })

  it('recovers from a returned install error and requires fresh preparation and confirmation', async () => {
    // The transport rejection is a host-contract fixture. It does not exercise
    // Windows ShellExecuteW or the updater dependency's process exit behavior.
    const f = fixture()
    f.install.mockRejectedValueOnce(Error('installer rejected'))
    const pending = f.request()
    const failed = expect(pending).rejects.toThrow('installer rejected')
    await f.proceed()
    await failed
    expect(f.options.setInstalling).toHaveBeenLastCalledWith(false)
    expect(f.gate.version).toBeUndefined()
    expect(f.options.cancelTransition).toHaveBeenCalledTimes(1)
    expect(f.options.returnFocus).toHaveBeenCalledTimes(1)
    const staleProceed = f.proceed
    await staleProceed()
    expect(f.install).toHaveBeenCalledTimes(1)
    const retry = f.request()
    expect(f.options.requestTransition).toHaveBeenCalledTimes(2)
    expect(f.install).toHaveBeenCalledTimes(1)
    await f.proceed()
    expect(await retry).toEqual({ status: 'installing' })
    expect(f.options.prepareDocument).toHaveBeenCalledTimes(2)
    expect(f.install).toHaveBeenCalledTimes(2)
    expect(f.gate.version).toBeUndefined()
  })
})

import { describe, expect, it, vi } from 'vitest'
import { createController } from './controller'
const snapshot = {
  id: 'snapshot1',
  documentId: 'doc',
  version: 7,
  title: '中文笔记',
  from: 0,
  to: 12,
  lineCount: 3,
  warnings: [{ code: 'resource-omitted', message: '一张图片未包含在输出中。' }],
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((yes) => {
    resolve = yes
  })
  return { promise, resolve }
}
function fixture() {
  const output = {
    capture: vi.fn().mockResolvedValue(snapshot),
    chooseTarget: vi
      .fn()
      .mockResolvedValue({ status: 'ready', id: 'target1', name: '中文笔记.html' }),
    write: vi.fn().mockResolvedValue({ status: 'written', name: '中文笔记.html', bytes: 120 }),
    print: vi.fn().mockResolvedValue({ status: 'printed' }),
    release: vi.fn().mockResolvedValue(undefined),
  }
  const changed = vi.fn(),
    controller = createController(changed)
  return { output, changed, controller, host: { output } }
}
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0))
describe('export and print lifecycle', () => {
  it('captures synchronously, returns immediately, rejects duplicate clicks, and retains version and warnings', async () => {
    const f = fixture(),
      gate = deferred<typeof snapshot>()
    f.output.capture.mockReturnValue(gate.promise)
    expect(f.controller.start(f.host)).toBeUndefined()
    expect(f.output.capture).toHaveBeenCalledTimes(1)
    f.controller.start(f.host)
    expect(f.output.capture).toHaveBeenCalledTimes(1)
    f.controller.change('format', 'pdf')
    gate.resolve(snapshot)
    await f.controller.settled()
    expect(f.output.capture.mock.calls[0]?.[0].format).toBe('html')
    expect(f.controller.state.snapshot?.version).toBe(7)
    expect(f.controller.state.snapshot?.warnings[0]?.message).toContain('图片')
    expect(f.controller.state.phase).toBe('done')
    expect(f.output.release).toHaveBeenCalledWith('snapshot1')
    expect(f.output.release).not.toHaveBeenCalledWith('target1')
  })
  it('releases late capture after cancellation without opening a target dialog', async () => {
    const f = fixture(),
      gate = deferred<typeof snapshot>()
    f.output.capture.mockReturnValue(gate.promise)
    f.controller.start(f.host)
    await f.controller.cancel()
    gate.resolve(snapshot)
    await f.controller.settled()
    expect(f.output.capture.mock.calls[0]?.[1].signal.aborted).toBe(true)
    expect(f.output.chooseTarget).not.toHaveBeenCalled()
    expect(f.output.release).toHaveBeenCalledWith('snapshot1')
    expect(f.controller.state.phase).toBe('cancelled')
  })
  it('handles target cancellation without writing', async () => {
    const f = fixture()
    f.output.chooseTarget.mockResolvedValue({ status: 'cancelled' })
    f.controller.start(f.host)
    await f.controller.settled()
    expect(f.output.write).not.toHaveBeenCalled()
    expect(f.controller.state.phase).toBe('cancelled')
    expect(f.output.release).toHaveBeenCalledWith('snapshot1')
  })
  it('releases targets that arrive after panel close', async () => {
    const f = fixture(),
      gate = deferred<unknown>()
    f.output.chooseTarget.mockReturnValue(gate.promise)
    f.controller.start(f.host)
    await tick()
    await f.controller.close()
    gate.resolve({ status: 'ready', id: 'target1', name: '笔记.html' })
    await f.controller.settled()
    expect(f.output.write).not.toHaveBeenCalled()
    expect(f.output.release).toHaveBeenCalledWith('target1')
  })
  it.each(['chooseTarget', 'write'] as const)(
    'reports %s errors and allows a fresh captured retry',
    async (method) => {
      const f = fixture()
      f.output[method].mockRejectedValueOnce({ code: 'unavailable' })
      f.controller.start(f.host)
      await f.controller.settled()
      expect(f.controller.state.phase).toBe('error')
      expect(f.controller.state.error).toBeTruthy()
      expect(f.output.release).toHaveBeenCalledWith('snapshot1')
      if (method === 'write') expect(f.output.release).toHaveBeenCalledWith('target1')
      f.controller.start(f.host)
      await f.controller.settled()
      expect(f.output.capture).toHaveBeenCalledTimes(2)
      expect(f.controller.state.phase).toBe('done')
    },
  )
  it('aborts on disable/dispose and releases late results without further UI updates', async () => {
    const f = fixture(),
      gate = deferred<typeof snapshot>()
    f.output.capture.mockReturnValue(gate.promise)
    f.controller.start(f.host)
    await f.controller.dispose()
    const count = f.changed.mock.calls.length
    gate.resolve(snapshot)
    await f.controller.settled()
    f.controller.start(f.host)
    expect(f.output.release).toHaveBeenCalledWith('snapshot1')
    expect(f.output.capture).toHaveBeenCalledTimes(1)
    expect(f.changed).toHaveBeenCalledTimes(count)
  })
  it('honors committed success even if cancel races with write completion', async () => {
    const f = fixture(),
      gate = deferred<unknown>()
    f.output.write.mockReturnValue(gate.promise)
    f.controller.start(f.host)
    await tick()
    await f.controller.cancel()
    gate.resolve({ status: 'written', name: '中文笔记.html', bytes: 120 })
    await f.controller.settled()
    expect(f.controller.state.phase).toBe('done')
    expect(f.controller.state.result?.name).toBe('中文笔记.html')
  })
  it('prints captured selection with paper options and supports print cancellation', async () => {
    const f = fixture()
    f.controller.change('format', 'print')
    f.controller.change('scope', 'selection')
    f.controller.change('pageSize', 'letter')
    f.controller.change('orientation', 'landscape')
    f.output.print.mockResolvedValueOnce({ status: 'cancelled' })
    f.controller.start(f.host)
    await f.controller.settled()
    expect(f.output.capture.mock.calls[0]?.[0]).toEqual({
      format: 'print',
      scope: 'selection',
      resources: 'embed',
      pageSize: 'letter',
      landscape: true,
    })
    expect(f.output.chooseTarget).not.toHaveBeenCalled()
    expect(f.controller.state.phase).toBe('cancelled')
    f.controller.start(f.host)
    await f.controller.settled()
    expect(f.controller.state.phase).toBe('done')
  })
  it('fails visibly without real host support', () => {
    const f = fixture()
    f.controller.start({})
    expect(f.controller.state.phase).toBe('error')
    expect(f.controller.state.error).toContain('宿主')
    expect(f.output.capture).not.toHaveBeenCalled()
  })
  it('contains synchronous capture failure and explains revoked permission', async () => {
    const f = fixture()
    f.output.capture.mockImplementation(() => {
      throw { code: 'revoked' }
    })
    expect(() => f.controller.start(f.host)).not.toThrow()
    await f.controller.settled()
    expect(f.controller.state.phase).toBe('error')
    expect(f.controller.state.error).toContain('权限')
  })
})

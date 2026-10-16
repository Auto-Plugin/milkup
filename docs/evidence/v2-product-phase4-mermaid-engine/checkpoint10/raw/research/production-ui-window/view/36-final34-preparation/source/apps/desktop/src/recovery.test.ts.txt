import { afterEach, expect, it, vi } from 'vitest'
import {
  createRecoveryController,
  formatRecoveryError,
  type RecoveryDocument,
  type RecoveryRecord,
  type RecoveryStatus,
} from './recovery'
afterEach(() => vi.useRealTimers())
function fixture() {
  vi.useFakeTimers()
  let document: RecoveryDocument = { documentId: 'a', version: 1, text: 'one', dirty: true }
  const statuses: RecoveryStatus[] = []
  const checkpoint = vi.fn(
    async (input: RecoveryDocument & { key: string }): Promise<RecoveryRecord> => ({
      id: input.key,
      version: input.version,
      createdAt: Date.now(),
      bytes: input.text?.length ?? 10,
      disposition: 'pending',
    }),
  )
  const settle = vi.fn(async () => {})
  const read = vi.fn((includeText: boolean) =>
    includeText ? document : { ...document, text: undefined },
  )
  const controller = createRecoveryController({
    read,
    service: { checkpoint, settle },
    onStatus: (s) => statuses.push(s),
  })
  return {
    controller,
    checkpoint,
    settle,
    statuses,
    read,
    set: (value: Partial<RecoveryDocument>) => (document = { ...document, ...value }),
  }
}
it('captures the latest accepted revision after idle without reading full text on every render', async () => {
  const f = fixture()
  f.controller.observe()
  await vi.advanceTimersByTimeAsync(600)
  f.set({ version: 2, text: 'two' })
  f.controller.observe()
  await vi.advanceTimersByTimeAsync(600)
  expect(f.checkpoint).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(150)
  expect(f.checkpoint).toHaveBeenCalledTimes(1)
  expect(f.checkpoint.mock.calls[0]![0].text).toBe('two')
  expect(f.read.mock.calls.filter(([full]) => full)).toHaveLength(1)
  expect(f.statuses.at(-1)).toMatchObject({ phase: 'ready', version: 2 })
})
it('continuous edits still attempt a checkpoint within five seconds', async () => {
  const f = fixture()
  f.controller.observe()
  for (let n = 2; n <= 13; n++) {
    await vi.advanceTimersByTimeAsync(400)
    f.set({ version: n })
    f.controller.observe()
  }
  expect(f.checkpoint).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(200)
  expect(f.checkpoint).toHaveBeenCalledTimes(1)
})
it('failure retains the acknowledged recovery point and does not endlessly retry', async () => {
  const f = fixture()
  f.controller.observe()
  await f.controller.flush()
  f.set({ version: 2 })
  f.controller.observe()
  f.checkpoint.mockRejectedValueOnce(Error('disk full'))
  await f.controller.flush()
  expect(f.statuses.at(-1)).toMatchObject({ phase: 'error', version: 1, error: 'Error: disk full' })
  await vi.advanceTimersByTimeAsync(20000)
  expect(f.checkpoint).toHaveBeenCalledTimes(2)
  await f.controller.flush()
  expect(f.statuses.at(-1)).toMatchObject({ phase: 'ready', version: 2 })
})
it('late completion cannot publish the previous document as the new draft checkpoint', async () => {
  const f = fixture()
  let finish!: (r: RecoveryRecord) => void
  f.checkpoint.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)))
  f.controller.observe()
  const pending = f.controller.flush()
  await Promise.resolve()
  const closed = f.controller.endDocument()
  f.set({ documentId: 'b', version: 1, text: 'new' })
  f.controller.observe()
  finish({ id: 'old', version: 1, createdAt: 1, bytes: 3, disposition: 'pending' })
  await pending
  await closed
  expect(f.statuses.at(-1)).toMatchObject({ phase: 'pending' })
  expect(f.statuses.at(-1)?.version).toBeUndefined()
  expect(f.settle).toHaveBeenCalledWith(expect.any(String), 'closed')
  await f.controller.flush()
  expect(f.checkpoint.mock.calls[0]![0].key).not.toBe(f.checkpoint.mock.calls[1]![0].key)
  expect(f.checkpoint.mock.calls[1]![0].text).toBe('new')
})
it('a saved revision is archived after an in-flight checkpoint, never deleted', async () => {
  const f = fixture()
  let finish!: (r: RecoveryRecord) => void
  f.checkpoint.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)))
  f.controller.observe()
  const pending = f.controller.flush()
  await Promise.resolve()
  f.set({ dirty: false })
  f.controller.observe()
  finish({ id: 'old', version: 1, createdAt: 1, bytes: 3, disposition: 'pending' })
  await pending
  await f.controller.flush()
  expect(f.statuses.at(-1)?.phase).toBe('idle')
  expect(f.settle).toHaveBeenCalledWith(expect.any(String), 'saved')
})
it('an explicit flush captures native version without materializing a large document', async () => {
  const f = fixture()
  f.set({ nativeVersion: 42, text: undefined })
  f.controller.observe()
  await f.controller.flush()
  expect(f.checkpoint.mock.calls[0]![0]).toMatchObject({ nativeVersion: 42, version: 1 })
  expect(f.checkpoint.mock.calls[0]![0].text).toBeUndefined()
  f.controller.observe()
  await vi.advanceTimersByTimeAsync(10000)
  expect(f.checkpoint).toHaveBeenCalledTimes(1)
})

it('explains real OS disk and permission failures without hiding other diagnostics', () => {
  expect(formatRecoveryError('No space left on device (os error 28)')).toContain('磁盘已满')
  expect(formatRecoveryError('Permission denied (os error 13)')).toContain('无法写入')
  expect(formatRecoveryError('File exists (os error 17)')).toContain('目标文件已存在')
  expect(formatRecoveryError('checksum mismatch')).toBe('checksum mismatch')
})

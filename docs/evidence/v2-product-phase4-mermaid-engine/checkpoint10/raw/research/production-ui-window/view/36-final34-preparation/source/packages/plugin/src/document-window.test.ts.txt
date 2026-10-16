import { MemoryDocumentSource } from '@milkup/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPluginDocumentBroker } from './document-broker'

const request = { documentId: 'doc', version: 3, fromLine: 1, lineCount: 4096 }
const source = (text: string, version = 3) =>
  new MemoryDocumentSource({ documentId: 'doc', version, text })
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('bounded document windows', () => {
  afterEach(() => vi.useRealTimers())
  it('preserves complete Unicode and CRLF lines and absolute offsets', async () => {
    const doc = source('first\r\n中文😀\r\nlast')
    const broker = createPluginDocumentBroker({ pluginId: 'reader', source: () => doc })
    expect(await broker.readWindow({ ...request, fromLine: 2, lineCount: 1 })).toEqual({
      documentId: 'doc',
      version: 3,
      fromLine: 2,
      toLine: 2,
      from: 7,
      to: 11,
      text: '中文😀',
      lines: [{ number: 2, from: 7, to: 11, text: '中文😀' }],
      totalLines: 3,
      completeStart: false,
      completeEnd: false,
    })
    expect(await broker.readWindow(request)).toMatchObject({
      text: 'first\r\n中文😀\r\nlast',
      completeStart: true,
      completeEnd: true,
    })
  })
  it('halves oversized batches without truncating a line and rejects an oversized single line', async () => {
    const doc = source(Array.from({ length: 4 }, () => 'x'.repeat(50_000)).join('\n'))
    const read = vi.spyOn(doc, 'readLineWindow')
    const broker = createPluginDocumentBroker({ pluginId: 'reader', source: () => doc })
    const result = await broker.readWindow(request)
    expect(result.toLine).toBe(2)
    expect(result.text).toBe('x'.repeat(50_000) + '\n' + 'x'.repeat(50_000))
    expect(read.mock.calls).toEqual([
      [1, 4, 131072],
      [1, 2, 131072],
    ])
    const huge = createPluginDocumentBroker({
      pluginId: 'reader',
      source: () => source('x'.repeat(131073)),
    })
    await expect(huge.readWindow(request)).rejects.toThrow(/single line.*budget/i)
  })
  it('checks identity and version both before and after asynchronous reads', async () => {
    let doc = source('secret')
    const pending = deferred<Awaited<ReturnType<typeof doc.readLineWindow>>>()
    const original = await doc.readLineWindow(1, 1)
    vi.spyOn(doc, 'readLineWindow').mockReturnValue(pending.promise)
    const broker = createPluginDocumentBroker({ pluginId: 'reader', source: () => doc })
    await expect(broker.readWindow({ ...request, version: 2 })).rejects.toThrow(/changed/i)
    const result = broker.readWindow(request)
    doc = source('new', 4)
    pending.resolve(original)
    await expect(result).rejects.toThrow(/changed/i)
  })
  it.each(['signal', 'cancelAll', 'dispose'] as const)(
    'cancels stalled reads immediately with %s and ignores late text',
    async (kind) => {
      const doc = source('secret')
      const pending = deferred<Awaited<ReturnType<typeof doc.readLineWindow>>>()
      const original = await doc.readLineWindow(1, 1)
      vi.spyOn(doc, 'readLineWindow').mockReturnValue(pending.promise)
      const broker = createPluginDocumentBroker({ pluginId: 'reader', source: () => doc })
      const controller = new AbortController()
      const result = broker.readWindow(request, { signal: controller.signal })
      if (kind === 'signal') controller.abort()
      else if (kind === 'cancelAll') await broker.cancelAll()
      else broker.dispose()
      await expect(result).rejects.toThrow(/abort|revok/i)
      pending.resolve(original)
      if (kind === 'dispose') await expect(broker.readWindow(request)).rejects.toThrow(/revok/i)
    },
  )
  it('rejects invalid ranges before invoking the source', async () => {
    const doc = source('text')
    const read = vi.spyOn(doc, 'readLineWindow')
    const broker = createPluginDocumentBroker({ pluginId: 'reader', source: () => doc })
    for (const value of [
      { fromLine: 0 },
      { lineCount: 4097 },
      { lineCount: NaN },
      { version: -1 },
      { fromLine: 2 },
    ]) {
      await expect(broker.readWindow({ ...request, ...value })).rejects.toThrow()
    }
    expect(read).not.toHaveBeenCalled()
  })
  it('includes trailing empty logical lines without changing source offsets', async () => {
    const doc = source('a\r\n\r\n😀\n')
    const broker = createPluginDocumentBroker({ pluginId: 'reader', source: () => doc })
    const pages = []
    for (let line = 1; line <= doc.lineCount; line++)
      pages.push(await broker.readWindow({ ...request, fromLine: line, lineCount: 1 }))
    expect(pages.map((page) => [page.from, page.to, page.text])).toEqual([
      [0, 1, 'a'],
      [3, 3, ''],
      [5, 7, '😀'],
      [8, 8, ''],
    ])
    expect(pages.at(-1)?.completeEnd).toBe(true)
  })
  it('coalesces owned renderer invalidation, preserves document CAS, and cancels pending refresh on dispose', async () => {
    vi.useFakeTimers()
    let doc = source('text')
    const refresh = vi.fn()
    const broker = createPluginDocumentBroker({
      pluginId: 'reader',
      source: () => doc,
      rendererIds: ['notes'],
      invalidatePresentation: refresh,
    })
    const invalidate = { documentId: 'doc', version: 3, rendererId: 'notes' }
    await expect(
      broker.invalidatePresentation({ ...invalidate, rendererId: 'foreign' }),
    ).rejects.toThrow(/unavailable/)
    const a = broker.invalidatePresentation(invalidate),
      b = broker.invalidatePresentation(invalidate)
    expect(a).toBe(b)
    await vi.advanceTimersByTimeAsync(0)
    await a
    expect(refresh).toHaveBeenCalledTimes(1)
    const stale = broker.invalidatePresentation(invalidate)
    const staleRejected = expect(stale).rejects.toThrow(/changed/)
    doc = source('new', 4)
    await vi.advanceTimersByTimeAsync(250)
    await staleRejected
    expect(refresh).toHaveBeenCalledTimes(1)
    const pending = broker.invalidatePresentation({ ...invalidate, version: 4 })
    const rejected = expect(pending).rejects.toThrow(/aborted/)
    broker.dispose()
    await rejected
    await vi.runAllTimersAsync()
    expect(refresh).toHaveBeenCalledTimes(1)
  })
  it('never calls invalidation more often than once per 250ms during bursts', async () => {
    vi.useFakeTimers()
    const refresh = vi.fn()
    const broker = createPluginDocumentBroker({
      pluginId: 'reader',
      source: () => source('text'),
      rendererIds: ['notes'],
      invalidatePresentation: refresh,
    })
    const request = { documentId: 'doc', version: 3, rendererId: 'notes' }
    const first = broker.invalidatePresentation(request)
    await vi.advanceTimersByTimeAsync(0)
    await first
    const pending = Array.from({ length: 20 }, () => broker.invalidatePresentation(request))
    await vi.advanceTimersByTimeAsync(249)
    expect(refresh).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    await Promise.all(pending)
    expect(refresh).toHaveBeenCalledTimes(2)
    broker.dispose()
  })
  it('cancels queued RPC invalidation only after all coalesced callers cancel', async () => {
    vi.useFakeTimers()
    const refresh = vi.fn()
    const broker = createPluginDocumentBroker({
      pluginId: 'reader',
      source: () => source('text'),
      rendererIds: ['notes'],
      invalidatePresentation: refresh,
    })
    const request = { documentId: 'doc', version: 3, rendererId: 'notes' }
    const a = new AbortController(),
      b = new AbortController()
    const first = broker.invalidatePresentation(request, { signal: a.signal })
    const rejected = expect(first).rejects.toThrow(/aborted/)
    const second = broker.invalidatePresentation(request, { signal: b.signal })
    a.abort()
    await rejected
    await vi.advanceTimersByTimeAsync(0)
    await second
    expect(refresh).toHaveBeenCalledTimes(1)
    const c = new AbortController()
    const last = broker.invalidatePresentation(request, { signal: c.signal })
    const lastRejected = expect(last).rejects.toThrow(/aborted/)
    c.abort()
    await lastRejected
    await vi.advanceTimersByTimeAsync(250)
    expect(refresh).toHaveBeenCalledTimes(1)
    broker.dispose()
  })
})

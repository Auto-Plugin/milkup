import { describe, expect, it, vi } from 'vitest'
import { MemoryDocumentSource } from '@milkup/core'
import { locateDocumentPresentationTarget } from './document-navigation'

const operation = () => ({ signal: new AbortController().signal, assertCurrent: vi.fn() })
describe('bounded document presentation navigation', () => {
  it('locates UTF-16 targets without a length property and permits the true document end', async () => {
    const memory = new MemoryDocumentSource({
      documentId: 'native',
      text: '😀\r\n中[^x]\r\n[^x]: end',
    })
    const read = vi.fn(memory.readLineWindow.bind(memory))
    const source = { lineCount: memory.lineCount, readLineWindow: read }
    expect(
      await locateDocumentPresentationTarget(source, { from: 4, to: 11 }, operation()),
    ).toEqual({ fromLine: 2, toLine: 3 })
    expect(
      await locateDocumentPresentationTarget(source, { from: 11, to: memory.length }, operation()),
    ).toEqual({ fromLine: 3, toLine: 3 })
    expect(read.mock.calls.every(([a, b, budget]) => a === b && budget === 65536)).toBe(true)
    await expect(
      locateDocumentPresentationTarget(source, { from: memory.length + 1 }, operation()),
    ).rejects.toThrow()
  })
  it('never reads an oversized intermediate line without a budget or navigates truncated text', async () => {
    const source = new MemoryDocumentSource({
      documentId: 'native',
      text: `start\n${'x'.repeat(65537)}\nend`,
    })
    const read = vi.spyOn(source, 'readLineWindow')
    await expect(
      locateDocumentPresentationTarget(source, { from: 0 }, operation()),
    ).rejects.toThrow()
    expect(read).toHaveBeenCalledWith(2, 2, 65536)
  })
  it('rejects stale and aborted results after an awaited native read', async () => {
    const memory = new MemoryDocumentSource({ documentId: 'native', text: 'a\nb' })
    let current = true
    const source = {
      lineCount: 2,
      readLineWindow: async (...args: Parameters<typeof memory.readLineWindow>) => {
        const result = await memory.readLineWindow(...args)
        current = false
        return result
      },
    }
    await expect(
      locateDocumentPresentationTarget(
        source,
        { from: 0 },
        {
          signal: new AbortController().signal,
          assertCurrent: () => {
            if (!current) throw Error('stale')
          },
        },
      ),
    ).rejects.toThrow('stale')
    const abort = new AbortController()
    const aborted = {
      lineCount: 2,
      readLineWindow: async (...args: Parameters<typeof memory.readLineWindow>) => {
        const result = await memory.readLineWindow(...args)
        abort.abort()
        return result
      },
    }
    await expect(
      locateDocumentPresentationTarget(
        aborted,
        { from: 0 },
        { signal: abort.signal, assertCurrent: () => undefined },
      ),
    ).rejects.toMatchObject({ name: 'AbortError' })
  })
  it('rejects invalid ranges before I/O and accepts an empty document cursor', async () => {
    const source = new MemoryDocumentSource({ documentId: 'empty', text: '' })
    const read = vi.spyOn(source, 'readLineWindow')
    for (const target of [{ from: -1 }, { from: NaN }, { from: 1, to: 0 }, { from: 0, to: 0.5 }]) {
      await expect(locateDocumentPresentationTarget(source, target, operation())).rejects.toThrow()
    }
    expect(read).not.toHaveBeenCalled()
    expect(await locateDocumentPresentationTarget(source, { from: 0, to: 0 }, operation())).toEqual(
      { fromLine: 1, toLine: 1 },
    )
  })
})

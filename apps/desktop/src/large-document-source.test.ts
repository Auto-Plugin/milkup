import { describe, expect, it, vi } from 'vitest'

import { LargeDocumentSource, mapLargeLineWindow } from './large-document-source'
import type { DesktopLargeTextFileService } from './large-file-service'

describe('LargeDocumentSource', () => {
  it('maps native line windows to the editor document source contract', async () => {
    const service = createService()
    const source = new LargeDocumentSource({
      service,
      documentId: 'large-doc',
      path: 'D:/notes/large.md',
      version: 2,
      sizeBytes: 1024,
      lineCount: 12,
    })

    await expect(source.readLineWindow(2, 3)).resolves.toEqual({
      fromLine: 2,
      toLine: 3,
      from: 6,
      to: 16,
      text: 'two\nthree',
      lines: [
        { number: 2, from: 6, to: 9, text: 'two' },
        { number: 3, from: 10, to: 15, text: 'three' },
      ],
    })
    await expect(source.positionAtLineOffset(2, 99)).resolves.toBe(9)
    expect(source.snapshot()).toEqual({
      documentId: 'large-doc',
      version: 2,
      lineCount: 12,
      length: 1024,
    })
  })

  it('updates metadata from native edit and flush snapshots', () => {
    const source = new LargeDocumentSource({
      service: createService(),
      documentId: 'large-doc',
      path: 'D:/notes/large.md',
      version: 2,
      sizeBytes: 1024,
      lineCount: 12,
    })

    source.applyNativeSnapshot({
      path: 'D:/notes/large-copy.md',
      version: 3,
      sizeBytes: 1050,
      lineCount: 13,
    })

    expect(source.path).toBe('D:/notes/large-copy.md')
    expect(source.version).toBe(3)
    expect(source.sizeBytes).toBe(1050)
    expect(source.lineCount).toBe(13)
    expect(source.snapshot()).toMatchObject({ version: 3, lineCount: 13, length: 1050 })
  })

  it('locates UTF-16 caret positions across CRLF and an empty final line', async () => {
    const service = createService()
    const texts = ['😀x', '', 'last', '']
    const starts = [0, 5, 7, 13]
    service.readLineWindow = vi.fn(async (_id, fromLine, toLine) => {
      const lines = texts.slice(fromLine - 1, toLine).map((text, index) => {
        const number = fromLine + index
        const fromUtf16 = starts[number - 1]!
        return {
          number,
          fromUtf16,
          toUtf16: fromUtf16 + text.length,
          fromByte: 99,
          toByte: 199,
          text,
        }
      })
      return {
        documentId: 'large-doc',
        fromLine,
        toLine,
        fromByte: 99,
        toByte: 199,
        fromUtf16: lines[0]!.fromUtf16,
        toUtf16: lines.at(-1)!.toUtf16,
        text: lines.map((line) => line.text).join('\r\n'),
        lines,
      }
    })
    const source = new LargeDocumentSource({
      service,
      documentId: 'large-doc',
      path: '/test.md',
      version: 1,
      lineCount: 4,
      sizeBytes: 15,
    })
    for (const [position, number] of [
      [0, 1],
      [3, 1],
      [4, 1],
      [5, 2],
      [6, 2],
      [7, 3],
      [12, 3],
      [13, 4],
    ]) {
      expect((await source.lineAtPosition(position!)).number).toBe(number)
    }
    await expect(source.lineAtPosition(14)).rejects.toThrow(RangeError)
    await expect(source.lineAtPosition(-1)).rejects.toThrow(RangeError)
  })

  it('rejects native line lookup when its document version changes mid-read', async () => {
    const service = createService()
    const source = new LargeDocumentSource({
      service,
      documentId: 'large-doc',
      path: '/test.md',
      version: 1,
      lineCount: 3,
      sizeBytes: 20,
    })
    const read = service.readLineWindow
    service.readLineWindow = async (...args) => {
      source.applyNativeSnapshot({ version: 2, lineCount: 3, sizeBytes: 20 })
      return read(...args)
    }
    await expect(source.lineAtPosition(8)).rejects.toThrow('changed')
  })

  it('maps native UTF-16 offsets without byte offset leakage', () => {
    expect(
      mapLargeLineWindow({
        documentId: 'large-doc',
        fromLine: 1,
        toLine: 1,
        fromByte: 0,
        toByte: 6,
        fromUtf16: 0,
        toUtf16: 4,
        text: '😀x',
        lines: [{ number: 1, fromByte: 0, toByte: 6, fromUtf16: 0, toUtf16: 3, text: '😀x' }],
      }).lines[0],
    ).toEqual({ number: 1, from: 0, to: 3, text: '😀x' })
  })
})

function createService(): DesktopLargeTextFileService {
  return {
    open: vi.fn(),
    readChunk: vi.fn(),
    readLineWindow: vi.fn(async () => ({
      documentId: 'large-doc',
      fromLine: 2,
      toLine: 3,
      fromByte: 6,
      toByte: 16,
      fromUtf16: 6,
      toUtf16: 16,
      text: 'two\nthree',
      lines: [
        { number: 2, fromByte: 6, toByte: 9, fromUtf16: 6, toUtf16: 9, text: 'two' },
        { number: 3, fromByte: 10, toByte: 15, fromUtf16: 10, toUtf16: 15, text: 'three' },
      ],
    })),
    applyChanges: vi.fn(),
    flush: vi.fn(),
    flushAs: vi.fn(),
    close: vi.fn(),
  }
}

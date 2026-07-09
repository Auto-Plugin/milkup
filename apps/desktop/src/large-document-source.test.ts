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

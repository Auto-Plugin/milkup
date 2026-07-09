import { describe, expect, it, vi } from 'vitest'

import { formatLargeDocumentPreviewText, openLargeDocumentPreview } from './desktop-large-open-flow'
import type { DesktopLargeTextFileService } from './large-file-service'

describe('desktop large open flow', () => {
  it('opens a native large file and reads only the first preview line window', async () => {
    const service: DesktopLargeTextFileService = {
      open: vi.fn(async () => ({
        documentId: 'large-doc',
        path: 'D:/notes/large.md',
        version: 0,
        sizeBytes: 256 * 1024 * 1024,
        lineCount: 1_000_000,
      })),
      readLineWindow: vi.fn(async () => ({
        documentId: 'large-doc',
        fromLine: 1,
        toLine: 2,
        fromByte: 0,
        toByte: 8,
        fromUtf16: 0,
        toUtf16: 8,
        text: 'one\ntwo',
        lines: [
          { number: 1, fromByte: 0, toByte: 3, fromUtf16: 0, toUtf16: 3, text: 'one' },
          { number: 2, fromByte: 4, toByte: 7, fromUtf16: 4, toUtf16: 7, text: 'two' },
        ],
      })),
      readChunk: vi.fn(),
      applyChanges: vi.fn(),
      flush: vi.fn(),
      flushAs: vi.fn(),
      close: vi.fn(),
    }

    const preview = await openLargeDocumentPreview({
      service,
      documentId: 'large-doc',
      path: 'D:/notes/large.md',
      previewLineCount: 80,
    })

    expect(service.open).toHaveBeenCalledWith('large-doc', 'D:/notes/large.md')
    expect(service.readLineWindow).toHaveBeenCalledWith('large-doc', 1, 80)
    expect(service.readChunk).not.toHaveBeenCalled()
    expect(preview.lineCount).toBe(1_000_000)
    expect(formatLargeDocumentPreviewText(preview)).toContain('one\ntwo')
  })
})

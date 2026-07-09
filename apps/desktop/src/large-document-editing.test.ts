import { ChangeSet, LargeEditSession } from '@milkup/core'
import { describe, expect, it, vi } from 'vitest'

import {
  applyLargeDocumentEditBatch,
  mapLargeTextEditsToDesktopChanges,
} from './large-document-editing'
import type { DesktopLargeTextFileService } from './large-file-service'

describe('large document editing bridge', () => {
  it('maps core UTF-16 edit log entries to native large text changes', () => {
    expect(
      mapLargeTextEditsToDesktopChanges([
        { from: 2, to: 4, insert: 'x', deletedText: 'bc' },
        { from: 8, to: 8, insert: '!', deletedText: '' },
      ]),
    ).toEqual([
      { fromUtf16: 2, toUtf16: 4, insert: 'x' },
      { fromUtf16: 8, toUtf16: 8, insert: '!' },
    ])
  })

  it('applies pending visible edits through apply_large_text_file_changes only', async () => {
    const service = createService()
    const session = new LargeEditSession({ documentId: 'large-doc', baseVersion: 7 })
    const batch = session.recordVisibleEdits(ChangeSet.replace(6, 11, 'milkup'), ['world'])

    await expect(
      applyLargeDocumentEditBatch({
        service,
        documentId: 'large-doc',
        expectedVersion: 7,
        batch,
      }),
    ).resolves.toMatchObject({ documentId: 'large-doc', version: 8 })

    expect(service.applyChanges).toHaveBeenCalledWith('large-doc', 7, [
      { fromUtf16: 6, toUtf16: 11, insert: 'milkup' },
    ])
    expect(service.flush).not.toHaveBeenCalled()
    expect(service.readChunk).not.toHaveBeenCalled()
  })

  it('does not call native apply for an empty visible edit batch', async () => {
    const service = createService()

    await expect(
      applyLargeDocumentEditBatch({
        service,
        documentId: 'large-doc',
        expectedVersion: 7,
        batch: { edits: [] },
      }),
    ).resolves.toBeUndefined()

    expect(service.applyChanges).not.toHaveBeenCalled()
  })
})

function createService(): DesktopLargeTextFileService {
  return {
    open: vi.fn(),
    readChunk: vi.fn(),
    readLineWindow: vi.fn(),
    applyChanges: vi.fn(async () => ({
      documentId: 'large-doc',
      path: 'D:/notes/large.md',
      version: 8,
      sizeBytes: 1024,
      lineCount: 12,
    })),
    flush: vi.fn(),
    flushAs: vi.fn(),
    close: vi.fn(),
  }
}

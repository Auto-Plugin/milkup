import { describe, expect, it, vi } from 'vitest'

import {
  createDesktopLargeTextFileService,
  type DesktopLargeTextFileInvoke,
} from './large-file-service'

describe('desktop large text file service', () => {
  it('maps open, chunk, line-window, apply, flush, save-as, and close calls to dedicated Tauri commands', async () => {
    const invoke = createInvokeMock({
      open_large_text_file: {
        documentId: 'large-doc',
        path: 'D:/workspace/large.md',
        version: 0,
        sizeBytes: 1024,
        lineCount: 12,
      },
      read_large_text_file_chunk: {
        documentId: 'large-doc',
        fromByte: 0,
        toByte: 5,
        fromUtf16: 0,
        toUtf16: 5,
        text: 'hello',
      },
      read_large_text_file_line_window: {
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
      },
      apply_large_text_file_changes: {
        documentId: 'large-doc',
        path: 'D:/workspace/large.md',
        version: 1,
        sizeBytes: 1030,
        lineCount: 13,
      },
      flush_large_text_file: {
        documentId: 'large-doc',
        path: 'D:/workspace/large.md',
        version: 1,
        sizeBytes: 1030,
        lineCount: 13,
      },
      flush_large_text_file_as: {
        documentId: 'large-doc',
        path: 'D:/workspace/large-copy.md',
        version: 1,
        sizeBytes: 1030,
        lineCount: 13,
      },
      close_large_text_file: true,
    })
    const service = createDesktopLargeTextFileService({ invoke })

    await expect(service.open('large-doc', 'D:/workspace/large.md')).resolves.toMatchObject({
      documentId: 'large-doc',
      sizeBytes: 1024,
      lineCount: 12,
    })
    await expect(service.readChunk('large-doc', 0, 5)).resolves.toMatchObject({
      text: 'hello',
      fromUtf16: 0,
      toUtf16: 5,
    })
    await expect(service.readLineWindow('large-doc', 2, 3)).resolves.toMatchObject({
      text: 'two\nthree',
      fromUtf16: 6,
      toUtf16: 16,
      lines: [
        { number: 2, fromByte: 6, toByte: 9, fromUtf16: 6, toUtf16: 9, text: 'two' },
        { number: 3, fromByte: 10, toByte: 15, fromUtf16: 10, toUtf16: 15, text: 'three' },
      ],
    })
    await expect(
      service.applyChanges('large-doc', 0, [{ fromUtf16: 5, toUtf16: 5, insert: '!' }]),
    ).resolves.toMatchObject({
      version: 1,
      lineCount: 13,
    })
    await expect(service.flush('large-doc', 1)).resolves.toMatchObject({
      version: 1,
      sizeBytes: 1030,
    })
    await expect(
      service.flushAs('large-doc', 1, 'D:/workspace/large-copy.md'),
    ).resolves.toMatchObject({
      path: 'D:/workspace/large-copy.md',
      version: 1,
    })
    await expect(service.close('large-doc')).resolves.toBe(true)

    expect(invoke).toHaveBeenCalledWith('open_large_text_file', {
      documentId: 'large-doc',
      path: 'D:/workspace/large.md',
    })
    expect(invoke).toHaveBeenCalledWith('read_large_text_file_chunk', {
      documentId: 'large-doc',
      fromByte: 0,
      toByte: 5,
    })
    expect(invoke).toHaveBeenCalledWith('read_large_text_file_line_window', {
      documentId: 'large-doc',
      fromLine: 2,
      toLine: 3,
    })
    expect(invoke).toHaveBeenCalledWith('apply_large_text_file_changes', {
      documentId: 'large-doc',
      expectedVersion: 0,
      changes: [{ fromUtf16: 5, toUtf16: 5, insert: '!' }],
    })
    expect(invoke).toHaveBeenCalledWith('flush_large_text_file', {
      documentId: 'large-doc',
      expectedVersion: 1,
    })
    expect(invoke).toHaveBeenCalledWith('flush_large_text_file_as', {
      documentId: 'large-doc',
      expectedVersion: 1,
      path: 'D:/workspace/large-copy.md',
    })
    expect(invoke).toHaveBeenCalledWith('close_large_text_file', {
      documentId: 'large-doc',
    })
  })
})

function createInvokeMock(
  responses: Readonly<Record<string, unknown>>,
): DesktopLargeTextFileInvoke {
  return vi.fn(async (command: string) => responses[command]) as DesktopLargeTextFileInvoke
}

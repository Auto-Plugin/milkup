import { describe, expect, it } from 'vitest'

import { MemoryDocumentSource } from '../index'

describe('MemoryDocumentSource', () => {
  it('adapts memory text into the view-facing document source contract', async () => {
    const source = new MemoryDocumentSource({
      documentId: 'doc-source',
      text: 'alpha\nbeta\ngamma',
      version: 4,
    })

    expect(source.snapshot()).toEqual({
      documentId: 'doc-source',
      version: 4,
      lineCount: 3,
      length: 16,
    })
    await expect(source.readLineWindow(2, 3)).resolves.toEqual({
      fromLine: 2,
      toLine: 3,
      from: 6,
      to: 16,
      text: 'beta\ngamma',
      lines: [
        { number: 2, from: 6, to: 10, text: 'beta' },
        { number: 3, from: 11, to: 16, text: 'gamma' },
      ],
    })
    await expect(source.lineAtPosition(7)).resolves.toEqual({
      number: 2,
      from: 6,
      to: 10,
      text: 'beta',
    })
    await expect(source.positionAtLineOffset(2, 99)).resolves.toBe(10)
  })

  it('rejects invalid line windows', async () => {
    const source = new MemoryDocumentSource({ documentId: 'doc-source', text: 'one' })

    await expect(source.readLineWindow(0, 1)).rejects.toThrow('Invalid line window')
  })
})

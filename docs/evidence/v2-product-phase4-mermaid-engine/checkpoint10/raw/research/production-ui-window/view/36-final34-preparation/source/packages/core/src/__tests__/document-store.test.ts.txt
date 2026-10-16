import { describe, expect, it } from 'vitest'

import { ChangeSet, MemoryDocumentStore } from '../index'

describe('MemoryDocumentStore', () => {
  it('exposes an initial immutable snapshot', () => {
    const store = new MemoryDocumentStore({
      documentId: 'doc-store',
      text: 'one\ntwo\n',
      version: 3,
    })

    expect(store.snapshot()).toEqual({
      documentId: 'doc-store',
      version: 3,
      length: 8,
      lineCount: 3,
    })
    expect(Object.isFrozen(store.snapshot())).toBe(true)
  })

  it('reads bounded text chunks by UTF-16 offsets', async () => {
    const store = new MemoryDocumentStore({
      documentId: 'doc-store',
      text: 'alpha\nbeta\ngamma',
    })

    await expect(store.readChunk({ from: 6, to: 10 })).resolves.toEqual({
      from: 6,
      to: 10,
      text: 'beta',
    })
  })

  it('reads individual lines from the store line index', async () => {
    const store = new MemoryDocumentStore({
      documentId: 'doc-store',
      text: 'alpha\r\nbeta\n',
    })

    await expect(store.readLine(1)).resolves.toEqual({
      number: 1,
      from: 0,
      to: 5,
      text: 'alpha',
    })
    await expect(store.readLine(2)).resolves.toEqual({
      number: 2,
      from: 7,
      to: 11,
      text: 'beta',
    })
    await expect(store.readLine(3)).resolves.toEqual({
      number: 3,
      from: 12,
      to: 12,
      text: '',
    })
  })

  it('reads line windows without materializing unrelated document ranges', async () => {
    const store = new MemoryDocumentStore({
      documentId: 'doc-store',
      text: ['# Title', 'one', 'two', 'three', 'tail'].join('\n'),
    })

    await expect(store.readLineWindow(2, 4)).resolves.toEqual({
      fromLine: 2,
      toLine: 4,
      from: 8,
      to: 21,
      text: 'one\ntwo\nthree',
      lines: [
        { number: 2, from: 8, to: 11, text: 'one' },
        { number: 3, from: 12, to: 15, text: 'two' },
        { number: 4, from: 16, to: 21, text: 'three' },
      ],
    })
  })

  it('rejects line windows outside the current line index', async () => {
    const store = new MemoryDocumentStore({ documentId: 'doc-store', text: 'one\ntwo' })

    await expect(store.readLineWindow(2, 3)).rejects.toThrow('Invalid line window')
  })

  it('rejects chunks outside the current document', async () => {
    const store = new MemoryDocumentStore({ documentId: 'doc-store', text: 'short' })

    await expect(store.readChunk({ from: 0, to: 6 })).rejects.toThrow('document length')
  })

  it('applies changes through the same ChangeSet semantics as TextDocument', async () => {
    const store = new MemoryDocumentStore({ documentId: 'doc-store', text: 'one two three' })
    const snapshot = await store.applyChanges(
      ChangeSet.of([
        { from: 0, to: 3, insert: '1' },
        { from: 4, to: 7, insert: '2' },
        { from: 8, to: 13, insert: '3' },
      ]),
    )

    expect(snapshot).toEqual({
      documentId: 'doc-store',
      version: 1,
      length: 5,
      lineCount: 1,
    })
    await expect(store.readChunk({ from: 0, to: store.length })).resolves.toMatchObject({
      text: '1 2 3',
    })
  })

  it('does not advance version for empty changes', async () => {
    const store = new MemoryDocumentStore({
      documentId: 'doc-store',
      text: 'stable',
      version: 9,
    })

    await expect(store.applyChanges(ChangeSet.empty())).resolves.toMatchObject({ version: 9 })
  })

  it('flushes a stable full snapshot for persistence adapters', async () => {
    const store = new MemoryDocumentStore({ documentId: 'doc-store', text: 'draft' })

    await store.applyChanges(ChangeSet.insert(5, '\nnext'))

    await expect(store.flush()).resolves.toEqual({
      documentId: 'doc-store',
      version: 1,
      length: 10,
      lineCount: 2,
      text: 'draft\nnext',
    })
  })
})

import { describe, expect, it } from 'vitest'

import {
  ChangeSet,
  LargeEditSession,
  MemoryTextDocument,
  largeTextEditsToChangeSet,
  type LargeTextEditBatch,
} from '../index'

describe('LargeEditSession', () => {
  it('records visible edits as pending UTF-16 patches without storing the full document', () => {
    const session = new LargeEditSession({ documentId: 'large-doc', baseVersion: 4 })
    const batch = session.recordVisibleEdits(ChangeSet.replace(6, 11, 'milkup'), ['world'])

    expect(batch.edits).toEqual([{ from: 6, to: 11, insert: 'milkup', deletedText: 'world' }])
    expect(session.snapshot()).toEqual({
      documentId: 'large-doc',
      baseVersion: 4,
      version: 5,
      savedVersion: 4,
      pendingEditCount: 1,
      dirty: true,
      canUndo: true,
      canRedo: false,
    })
  })

  it('creates inverse undo and redo patches for visible edits', () => {
    const session = new LargeEditSession({ documentId: 'large-doc', baseVersion: 0 })
    const original = new MemoryTextDocument('hello world')
    const edit = session.recordVisibleEdits(ChangeSet.replace(6, 11, 'milkup'), ['world'])
    const edited = applyBatch(original, edit)
    const undo = session.undo()
    const undone = undo ? applyBatch(edited, undo) : edited
    const redo = session.redo()
    const redone = redo ? applyBatch(undone, redo) : undone

    expect(edited.text).toBe('hello milkup')
    expect(undo?.edits).toEqual([{ from: 6, to: 12, insert: 'world', deletedText: 'milkup' }])
    expect(undone.text).toBe('hello world')
    expect(redo?.edits).toEqual([{ from: 6, to: 11, insert: 'milkup', deletedText: 'world' }])
    expect(redone.text).toBe('hello milkup')
  })

  it('inverts multi-change batches in reverse applied order', () => {
    const session = new LargeEditSession({ documentId: 'large-doc', baseVersion: 0 })
    const original = new MemoryTextDocument('abcdef')
    const edit = session.recordVisibleEdits(
      ChangeSet.of([
        { from: 1, to: 2, insert: 'XX' },
        { from: 4, to: 5, insert: '' },
      ]),
      ['b', 'e'],
    )
    const edited = applyBatch(original, edit)
    const undo = session.undo()
    const undone = undo ? applyBatch(edited, undo) : edited

    expect(edited.text).toBe('aXXcdf')
    expect(undo?.edits).toEqual([
      { from: 5, to: 5, insert: 'e', deletedText: '' },
      { from: 1, to: 3, insert: 'b', deletedText: 'XX' },
    ])
    expect(undone.text).toBe('abcdef')
  })

  it('consumes pending edits and marks a native flush version as saved', () => {
    const session = new LargeEditSession({ documentId: 'large-doc', baseVersion: 2 })

    session.recordVisibleEdits(ChangeSet.insert(0, '# '), [''])
    session.recordVisibleEdits(ChangeSet.delete(4, 7), ['old'])

    expect(session.consumePendingEdits().edits).toHaveLength(2)
    expect(session.snapshot()).toMatchObject({ pendingEditCount: 0, dirty: true })
    expect(session.markFlushed(session.version)).toMatchObject({
      version: 4,
      savedVersion: 4,
      pendingEditCount: 0,
      dirty: false,
    })
  })

  it('rejects visible edits when the caller cannot provide the deleted text', () => {
    const session = new LargeEditSession({ documentId: 'large-doc', baseVersion: 0 })

    expect(() => session.recordVisibleEdits(ChangeSet.delete(1, 3), ['x'])).toThrow(
      'Deleted text length',
    )
  })
})

function applyBatch(doc: MemoryTextDocument, batch: LargeTextEditBatch): MemoryTextDocument {
  try {
    return doc.apply(largeTextEditsToChangeSet(batch.edits)) as MemoryTextDocument
  } catch (error) {
    if (
      !(error instanceof RangeError) ||
      !error.message.includes('sorted and non-overlapping')
    ) {
      throw error
    }
  }

  return batch.edits.reduce(
    (current, edit) =>
      current.apply(ChangeSet.replace(edit.from, edit.to, edit.insert)) as MemoryTextDocument,
    doc,
  )
}

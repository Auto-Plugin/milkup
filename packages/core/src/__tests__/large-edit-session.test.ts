import { describe, expect, it, vi } from 'vitest'

import {
  ChangeSet,
  Selection,
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

  it('does not advance version or history before native confirmation', () => {
    const session = new LargeEditSession({ documentId: 'large-doc', baseVersion: 7 })
    const batch = session.prepareVisibleEdits(ChangeSet.insert(0, '# '), [''])

    expect(session.snapshot()).toMatchObject({ version: 7, pendingEditCount: 0, canUndo: false })

    session.confirmVisibleEdits(batch, 8)
    expect(session.snapshot()).toMatchObject({ version: 8, pendingEditCount: 1, canUndo: true })

    const undo = session.prepareUndo()
    expect(undo?.edits).toEqual([{ from: 0, to: 2, insert: '', deletedText: '# ' }])
    expect(session.snapshot()).toMatchObject({ version: 8, canUndo: true, canRedo: false })

    session.confirmUndo(9)
    expect(session.snapshot()).toMatchObject({ version: 9, canUndo: false, canRedo: true })
  })

  it('rejects stale or skipped native confirmations without mutating state', () => {
    const session = new LargeEditSession({ documentId: 'large-doc', baseVersion: 3 })
    const batch = session.prepareVisibleEdits(ChangeSet.insert(0, 'x'), [''])

    expect(() => session.confirmVisibleEdits(batch, 5)).toThrow('expected 4')
    expect(session.snapshot()).toMatchObject({ version: 3, pendingEditCount: 0, canUndo: false })
  })
})

function applyBatch(doc: MemoryTextDocument, batch: LargeTextEditBatch): MemoryTextDocument {
  try {
    return doc.apply(largeTextEditsToChangeSet(batch.edits)) as MemoryTextDocument
  } catch (error) {
    if (!(error instanceof RangeError) || !error.message.includes('sorted and non-overlapping')) {
      throw error
    }
  }

  return batch.edits.reduce(
    (current, edit) =>
      current.apply(ChangeSet.replace(edit.from, edit.to, edit.insert)) as MemoryTextDocument,
    doc,
  )
}

it('restores directional selections only after confirmed native history changes', () => {
  const session = new LargeEditSession({ documentId: 'selection-history', baseVersion: 0 })
  const before = Selection.range(8, 0),
    after = Selection.range(11, 2)
  const batch = session.prepareVisibleEdits(
    ChangeSet.replace(0, 8, '  - a\n  - b'),
    ['- a\n- b!'],
    { selectionBefore: before, selectionAfter: after },
  )
  expect(session.prepareUndo()).toBeUndefined()
  session.confirmVisibleEdits(batch, 1)
  expect(session.prepareUndo()?.selectionAfter).toEqual(before)
  session.confirmUndo(2)
  expect(session.prepareRedo()?.selectionAfter).toEqual(after)
})

it('orders opaque native replacement history with ordinary edits and preserves selections', () => {
  const session = new LargeEditSession({ documentId: 'native-history', baseVersion: 0 })
  const before = Selection.range(8, 0),
    after = Selection.cursor(4)
  session.confirmNativeHistory('snapshot-token', 1, {
    selectionBefore: before,
    selectionAfter: after,
  })
  expect(session.dirty).toBe(true)
  expect(session.pendingEditCount).toBe(0)
  const edit = session.prepareVisibleEdits(ChangeSet.insert(4, '!'), [''])
  session.confirmVisibleEdits(edit, 2)
  expect(session.prepareUndo()?.nativeHistory).toBeUndefined()
  session.confirmUndo(3)
  expect(session.prepareUndo()).toMatchObject({
    edits: [],
    nativeHistory: { token: 'snapshot-token', direction: 'undo' },
    selectionAfter: before,
  })
  session.confirmUndo(4)
  expect(session.prepareRedo()).toMatchObject({
    nativeHistory: { token: 'snapshot-token', direction: 'redo' },
    selectionAfter: after,
  })
  session.confirmRedo(5)
  session.markFlushed(5)
  expect(session.dirty).toBe(false)
})

it('groups adjacent typing across native batches but keeps structural, save and history boundaries', () => {
  const session = new LargeEditSession({ documentId: 'typing', baseVersion: 0 })
  const type = (from: number, text: string, typing = true) => {
    const batch = session.prepareVisibleEdits(ChangeSet.insert(from, text), [''], {
      selectionBefore: Selection.cursor(from),
      selectionAfter: Selection.cursor(from + text.length),
      ...(typing ? { historyGroup: 'typing' as const } : {}),
    })
    session.confirmVisibleEdits(batch, session.version + 1)
  }
  type(0, '<br>', false)
  type(4, 'q')
  type(5, 'uick中文😀')
  expect(session.undo()?.edits).toEqual([
    { from: 4, to: 13, insert: '', deletedText: 'quick中文😀' },
  ])
  expect(session.redo()?.edits).toEqual([
    { from: 4, to: 4, insert: 'quick中文😀', deletedText: '' },
  ])
  type(13, '!')
  expect(session.undo()?.edits[0]?.deletedText).toBe('!')
  session.redo()
  session.markFlushed(session.version)
  type(14, '?')
  expect(session.undo()?.edits[0]?.deletedText).toBe('?')
  expect(session.undo()?.edits[0]?.deletedText).toBe('!')
  expect(session.undo()?.edits[0]?.deletedText).toBe('quick中文😀')
  expect(session.undo()?.edits[0]?.deletedText).toBe('<br>')
  const selected = new LargeEditSession({ documentId: 'direction', baseVersion: 0 })
  const first = selected.prepareVisibleEdits(ChangeSet.replace(1, 5, 'q'), ['bcde'], {
    historyGroup: 'typing',
    selectionBefore: Selection.range(5, 1),
    selectionAfter: Selection.cursor(2),
  })
  selected.confirmVisibleEdits(first, 1)
  selected.confirmVisibleEdits(
    selected.prepareVisibleEdits(ChangeSet.insert(2, 'uick'), [''], {
      historyGroup: 'typing',
      selectionBefore: Selection.cursor(2),
      selectionAfter: Selection.cursor(6),
    }),
    2,
  )
  const undo = selected.prepareUndo()!
  expect(undo.edits).toEqual([{ from: 1, to: 6, insert: 'bcde', deletedText: 'quick' }])
  expect(undo.selectionAfter?.main.anchor).toBe(5)
  expect(undo.selectionAfter?.main.head).toBe(1)
})
it('bounds typing groups and never merges separate locations or native snapshot history', () => {
  const session = new LargeEditSession({ documentId: 'typing-budget', baseVersion: 0 })
  const type = (from: number, text: string) => {
    const batch = session.prepareVisibleEdits(ChangeSet.insert(from, text), [''], {
      historyGroup: 'typing',
    })
    session.confirmVisibleEdits(batch, session.version + 1)
  }
  type(0, 'x'.repeat(65_536))
  type(65_536, 'y')
  expect(session.undo()?.edits[0]?.deletedText).toBe('y')
  session.confirmNativeHistory('snapshot', session.version + 1)
  type(0, 'z')
  expect(session.undo()?.edits[0]?.deletedText).toBe('z')
  expect(session.prepareUndo()?.nativeHistory?.token).toBe('snapshot')
})

it('ends a typing group after its time window or a directional selection change', () => {
  const clock = vi.spyOn(Date, 'now').mockReturnValue(1000)
  try {
    const session = new LargeEditSession({ documentId: 'time', baseVersion: 0 })
    const type = (from: number, text: string, selectionBefore = Selection.cursor(from)) => {
      const batch = session.prepareVisibleEdits(ChangeSet.insert(from, text), [''], {
        historyGroup: 'typing',
        selectionBefore,
        selectionAfter: Selection.cursor(from + text.length),
      })
      session.confirmVisibleEdits(batch, session.version + 1)
    }
    type(0, 'a')
    clock.mockReturnValue(1800)
    type(1, 'b')
    type(2, 'c', Selection.range(3, 2))
    expect(session.undo()?.edits[0]?.deletedText).toBe('c')
    expect(session.undo()?.edits[0]?.deletedText).toBe('b')
    expect(session.undo()?.edits[0]?.deletedText).toBe('a')
  } finally {
    clock.mockRestore()
  }
})

it('isolates formatting from adjacent typing and keeps selection-only plans clean', () => {
  const session = new LargeEditSession({ documentId: 'isolated-format', baseVersion: 0 })
  const selectionOnly = session.prepareVisibleEdits(ChangeSet.of([]), [], {
    historyGroup: 'isolate',
    selectionAfter: Selection.cursor(0),
  })
  session.confirmVisibleEdits(selectionOnly, 0)
  expect(session.snapshot()).toMatchObject({ version: 0, dirty: false, canUndo: false })
  for (const [index, historyGroup] of (['typing', 'isolate', 'typing'] as const).entries()) {
    const batch = session.prepareVisibleEdits(ChangeSet.insert(index, 'x'), [''], { historyGroup })
    session.confirmVisibleEdits(batch, index + 1)
  }
  expect(session.prepareUndo()?.edits).toEqual([{ from: 2, to: 3, insert: '', deletedText: 'x' }])
  session.confirmUndo(4)
  expect(session.prepareUndo()?.edits).toEqual([{ from: 1, to: 2, insert: '', deletedText: 'x' }])
  session.confirmUndo(5)
  expect(session.prepareUndo()?.edits).toEqual([{ from: 0, to: 1, insert: '', deletedText: 'x' }])
})

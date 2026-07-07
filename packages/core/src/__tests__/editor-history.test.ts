import { describe, expect, it } from 'vitest'

import { BasicEditor, ChangeSet, EditorState, MemoryTextDocument, Selection } from '../index'

function createEditor(text = ''): BasicEditor {
  return new BasicEditor(
    new EditorState({
      doc: new MemoryTextDocument(text),
      selection: Selection.cursor(text.length),
    }),
  )
}

describe('Editor history', () => {
  it('undoes and redoes basic typing', () => {
    const editor = createEditor()

    editor.dispatch({
      changes: ChangeSet.insert(0, 'hello'),
      origin: { type: 'input.type' },
      historyGroup: 'isolate',
    })

    expect(editor.state.doc.text).toBe('hello')
    expect(editor.undo()).toBe(true)
    expect(editor.state.doc.text).toBe('')
    expect(editor.redo()).toBe(true)
    expect(editor.state.doc.text).toBe('hello')
  })

  it('undoes deletes', () => {
    const editor = createEditor('hello noisy world')

    editor.dispatch({
      changes: ChangeSet.delete(5, 11),
      origin: { type: 'input.delete' },
    })

    expect(editor.state.doc.text).toBe('hello world')
    expect(editor.undo()).toBe(true)
    expect(editor.state.doc.text).toBe('hello noisy world')
  })

  it('undoes replacements', () => {
    const editor = createEditor('hello old world')

    editor.dispatch({
      changes: ChangeSet.replace(6, 9, 'new'),
      origin: { type: 'command', id: 'replace-word' },
    })

    expect(editor.state.doc.text).toBe('hello new world')
    expect(editor.undo()).toBe(true)
    expect(editor.state.doc.text).toBe('hello old world')
  })

  it('treats paste as one undo step', () => {
    const editor = createEditor()

    editor.dispatch({
      changes: ChangeSet.insert(0, '# Title\n\n- one\n- two\n'),
      origin: { type: 'paste' },
    })

    expect(editor.state.history.undoStack).toHaveLength(1)
    expect(editor.state.doc.text).toBe('# Title\n\n- one\n- two\n')
    expect(editor.undo()).toBe(true)
    expect(editor.state.doc.text).toBe('')
  })

  it('maps selection after insertion when transaction does not provide selection', () => {
    const editor = createEditor('hello world')

    editor.dispatch({
      changes: ChangeSet.insert(5, ' quiet'),
      origin: { type: 'input.type' },
      historyGroup: 'isolate',
    })

    expect(editor.state.selection.main.anchor).toBe('hello quiet world'.length)
    expect(editor.state.selection.main.head).toBe('hello quiet world'.length)
  })

  it('maps selection after deletion when transaction does not provide selection', () => {
    const editor = new BasicEditor(
      new EditorState({
        doc: new MemoryTextDocument('hello noisy world'),
        selection: Selection.cursor(17),
      }),
    )

    editor.dispatch({
      changes: ChangeSet.delete(5, 11),
      origin: { type: 'input.delete' },
    })

    expect(editor.state.doc.text).toBe('hello world')
    expect(editor.state.selection.main.anchor).toBe(11)
    expect(editor.state.selection.main.head).toBe(11)
  })

  it('does not clear history for mode switch effects', () => {
    const editor = createEditor()

    editor.dispatch({
      changes: ChangeSet.insert(0, 'hello'),
      origin: { type: 'input.type' },
      historyGroup: 'isolate',
    })

    editor.dispatch({
      effects: [{ type: 'view.mode', value: 'source' }],
      origin: { type: 'mode.switch' },
      addToHistory: false,
    })

    expect(editor.state.history.canUndo).toBe(true)
    expect(editor.undo()).toBe(true)
    expect(editor.state.doc.text).toBe('')
  })

  it('records code block edits in the global history', () => {
    const source = '```ts\nconsole.log(1)\n```\n'
    const editor = createEditor(source)

    editor.dispatch({
      changes: ChangeSet.insert(6, '// comment\n'),
      origin: { type: 'codeBlock', id: 'block-1' },
    })

    expect(editor.state.doc.text).toBe('```ts\n// comment\nconsole.log(1)\n```\n')
    expect(editor.state.history.undoStack).toHaveLength(1)
    expect(editor.undo()).toBe(true)
    expect(editor.state.doc.text).toBe(source)
  })

  it('can undo deleting an entire document', () => {
    const editor = createEditor('# Title\n\nBody\n')

    editor.dispatch({
      changes: ChangeSet.delete(0, editor.state.doc.length),
      origin: { type: 'input.delete' },
    })

    expect(editor.state.doc.text).toBe('')
    expect(editor.undo()).toBe(true)
    expect(editor.state.doc.text).toBe('# Title\n\nBody\n')
  })

  it('groups nearby typing transactions when requested', () => {
    const editor = createEditor()

    editor.dispatch({
      changes: ChangeSet.insert(0, 'a'),
      origin: { type: 'input.type' },
      historyGroup: 'merge',
      time: 100,
    })
    editor.dispatch({
      changes: ChangeSet.insert(1, 'b'),
      origin: { type: 'input.type' },
      historyGroup: 'merge',
      time: 200,
    })

    expect(editor.state.doc.text).toBe('ab')
    expect(editor.state.history.undoStack).toHaveLength(1)
    expect(editor.undo()).toBe(true)
    expect(editor.state.doc.text).toBe('')
  })

  it('keeps selection-only transactions out of document history', () => {
    const editor = createEditor('hello')

    editor.dispatch({
      selection: Selection.cursor(0),
      origin: { type: 'command', id: 'move-cursor' },
      addToHistory: false,
    })

    expect(editor.state.selection.main.anchor).toBe(0)
    expect(editor.state.history.canUndo).toBe(false)
  })
})

import { EditorState, MemoryTextDocument, MemoryDocumentSource, Selection } from '@milkup/core'
import { describe, expect, it, vi } from 'vitest'
import { EditorView, SourceDocumentView } from '../index'

function editor(text = '', selection = Selection.cursor(text.length)) {
  return new EditorView({
    parent: document.createElement('main'),
    state: new EditorState({ doc: new MemoryTextDocument(text), selection }),
  })
}
function key(view: EditorView, value: string) {
  view.inputDOM.dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true }))
}
function composition(input: HTMLTextAreaElement, final: string) {
  input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
  input.value = 'zhong'
  input.dispatchEvent(new CompositionEvent('compositionupdate', { data: 'zhong', bubbles: true }))
  input.value = final
  input.dispatchEvent(new CompositionEvent('compositionend', { data: final, bubbles: true }))
}
function paste(view: EditorView, text: string) {
  const event = new Event('paste', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'clipboardData', {
    value: { files: [], getData: (type: string) => (type === 'text/plain' ? text : '') },
  })
  view.inputDOM.dispatchEvent(event)
}

describe('input transaction boundaries', () => {
  it('cancelled composition preserves selected text, selection and history', () => {
    const view = editor('原文保留', Selection.range(0, 2))
    const before = view.state
    composition(view.inputDOM, '')
    expect(view.state.doc.text).toBe('原文保留')
    expect(view.state.selection).toBe(before.selection)
    expect(view.state.history).toBe(before.history)
    expect(view.inputDOM.value).toBe('')
    key(view, 'X')
    expect(view.state.doc.text).toBe('X保留')
    view.destroy()
  })
  it('cancelled composition does not reach the asynchronous source edit queue', async () => {
    const onEdit = vi.fn()
    const view = new SourceDocumentView({
      parent: document.createElement('main'),
      source: new MemoryDocumentSource({ documentId: 'source', text: '原文' }),
      editable: true,
      onEdit,
    })
    await view.renderVisibleWindow()
    composition(view.inputDOM, '')
    await view.flushPendingEdits()
    expect(onEdit).not.toHaveBeenCalled()
    expect(view.cursorLayerDOM.querySelector('.milkup-composition')).toBeNull()
    view.destroy()
  })
  it.each(['paste', 'composition', 'enter'] as const)(
    'isolates %s from typing on both sides',
    (kind) => {
      const view = editor()
      key(view, 'A')
      const insert = kind === 'paste' ? 'line1\n\nline2' : kind === 'composition' ? '中' : '\n'
      if (kind === 'paste') paste(view, insert)
      else if (kind === 'composition') composition(view.inputDOM, insert)
      else key(view, 'Enter')
      key(view, 'B')
      expect(view.state.doc.text).toBe(`A${insert}B`)
      const first = view.state.undo()
      expect(first.doc.text).toBe(`A${insert}`)
      const second = first.undo()
      expect(second.doc.text).toBe('A')
      expect(second.selection.main.head).toBe(1)
      const third = second.undo()
      expect(third.doc.text).toBe('')
      expect(third.redo().redo().redo().doc.text).toBe(`A${insert}B`)
      view.destroy()
    },
  )
  it('starts a new typing undo group after cursor navigation', () => {
    const view = editor()
    key(view, 'A')
    key(view, 'B')
    key(view, 'ArrowLeft')
    key(view, 'X')
    expect(view.state.doc.text).toBe('AXB')
    const undone = view.state.undo()
    expect(undone.doc.text).toBe('AB')
    expect(undone.selection.main.head).toBe(1)
    expect(undone.undo().doc.text).toBe('')
    view.destroy()
  })
})

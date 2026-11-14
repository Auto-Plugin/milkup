import { EditorState, MemoryTextDocument, Selection } from '@milkup/core'
import type { ImportedAsset } from '@milkup/assets'
import { describe, expect, it, vi } from 'vitest'
import { EditorView } from '../index'

const image: ImportedAsset = {
  originalName: 'a.png',
  fileName: 'a.png',
  relativePath: 'assets/a.png',
  mimeType: 'image/png',
}
function key(view: EditorView, key: string, shiftKey = false) {
  view.inputDOM.dispatchEvent(new KeyboardEvent('keydown', { key, shiftKey, bubbles: true }))
}
function pasteImages(view: EditorView, count = 1) {
  const event = new Event('paste', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'clipboardData', {
    value: {
      files: Array.from(
        { length: count },
        () => new File(['bytes'], 'a.png', { type: 'image/png' }),
      ),
      getData: () => '',
    },
  })
  view.inputDOM.dispatchEvent(event)
}
async function settle() {
  for (let i = 0; i < 12; i++) await Promise.resolve()
}
function pendingImageView() {
  let release!: (asset: ImportedAsset) => void
  const importAsset = vi.fn(
    () =>
      new Promise<ImportedAsset>((resolve) => {
        release = resolve
      }),
  )
  const view = new EditorView({
    parent: document.createElement('main'),
    assetProvider: { importAsset },
    state: new EditorState({
      doc: new MemoryTextDocument('original'),
      selection: Selection.cursor(0),
    }),
  })
  return { view, importAsset, release: () => release(image) }
}

describe('asynchronous image ownership', () => {
  it('never dispatches from a destroyed view or starts later imports from its batch', async () => {
    const pending = pendingImageView()
    pasteImages(pending.view, 2)
    pending.view.destroy()
    pending.release()
    await settle()
    expect(pending.importAsset).toHaveBeenCalledTimes(1)
    expect(pending.view.state.doc.text).toBe('original')
  })
  it('reports import errors without changing the document or producing an unhandled rejection', async () => {
    const view = new EditorView({
      parent: document.createElement('main'),
      state: new EditorState({ doc: new MemoryTextDocument('keep') }),
      assetProvider: {
        importAsset: async () => {
          throw new Error('asset disk full')
        },
      },
    })
    const errors: unknown[] = []
    view.dom.addEventListener('milkup-input-error', (event) =>
      errors.push((event as CustomEvent).detail),
    )
    pasteImages(view)
    await settle()
    expect(errors).toHaveLength(1)
    expect(errors[0]).toEqual(new Error('asset disk full'))
    expect(view.state.doc.text).toBe('keep')
    expect(view.state.history.canUndo).toBe(false)
    view.destroy()
  })
  it('does not insert a late import after a save lock has been released', async () => {
    const pending = pendingImageView()
    pasteImages(pending.view)
    const errors = vi.fn()
    pending.view.dom.addEventListener('milkup-input-error', errors)
    pending.view.setEditable(false)
    pending.view.setEditable(true)
    pending.release()
    await settle()
    expect(pending.view.state.doc.text).toBe('original')
    expect(errors).toHaveBeenCalledOnce()
    pending.view.destroy()
  })
  it('does not replace changed text with an import anchored in an older document', async () => {
    const pending = pendingImageView()
    pasteImages(pending.view)
    key(pending.view, 'X')
    pending.release()
    await settle()
    expect(pending.view.state.doc.text).toBe('Xoriginal')
    pending.view.destroy()
  })
  it('inserts at the original paste position if only the caret has moved', async () => {
    const pending = pendingImageView()
    pasteImages(pending.view)
    key(pending.view, 'ArrowRight')
    pending.release()
    await settle()
    expect(pending.view.state.doc.text).toBe('![a](assets/a.png)original')
    expect(pending.view.state.undo().doc.text).toBe('original')
    pending.view.destroy()
  })
})

describe('grapheme-safe ordinary editor keys', () => {
  it.each(['😀', 'e\u0301', '👩🏽‍💻', '🇨🇳', '中'])(
    'keeps %s intact when moving, selecting and deleting',
    (cluster) => {
      const doc = new MemoryTextDocument(`A${cluster}B`)
      const view = new EditorView({
        parent: document.createElement('main'),
        state: new EditorState({ doc, selection: Selection.cursor(1) }),
      })
      key(view, 'ArrowRight')
      expect(view.state.selection.main.head).toBe(1 + cluster.length)
      key(view, 'ArrowLeft', true)
      expect(view.state.selection.main.from).toBe(1)
      expect(view.state.selection.main.to).toBe(1 + cluster.length)
      key(view, 'Backspace')
      expect(view.state.doc.text).toBe('AB')
      view.updateState(view.state.undo())
      view.updateState(new EditorState({ doc, selection: Selection.cursor(1 + cluster.length) }))
      key(view, 'Backspace')
      expect(view.state.doc.text).toBe('AB')
      expect(view.state.undo().doc.text).toBe(doc.text)
      view.updateState(new EditorState({ doc, selection: Selection.cursor(1) }))
      key(view, 'Delete')
      expect(view.state.doc.text).toBe('AB')
      expect(view.state.undo().redo().doc.text).toBe('AB')
      view.destroy()
    },
  )
  it('does not move vertically into the middle of a surrogate pair', () => {
    const view = new EditorView({
      parent: document.createElement('main'),
      state: new EditorState({
        doc: new MemoryTextDocument('ab\n😀x'),
        selection: Selection.cursor(1),
      }),
    })
    key(view, 'ArrowDown')
    expect(view.state.selection.main.head).toBe(3)
    key(view, 'Delete')
    expect(view.state.doc.text).toBe('ab\nx')
    view.destroy()
  })
})

it.each(['Backspace', 'Delete'])('repairs an interior UTF-16 caret safely on %s', (keyName) => {
  const view = new EditorView({
    parent: document.createElement('main'),
    state: new EditorState({ doc: new MemoryTextDocument('A😀B'), selection: Selection.cursor(2) }),
  })
  key(view, keyName)
  expect(view.state.doc.text).toBe('AB')
  expect(view.state.selection.main.head).toBe(1)
  view.destroy()
})
it.each(['\n', '\r\n'])(
  'preserves complete line breaks when navigating and deleting %j',
  (newline) => {
    const view = new EditorView({
      parent: document.createElement('main'),
      state: new EditorState({
        doc: new MemoryTextDocument(`A${newline}B`),
        selection: Selection.cursor(1),
      }),
    })
    key(view, 'ArrowRight')
    expect(view.state.selection.main.head).toBe(1 + newline.length)
    key(view, 'Backspace')
    expect(view.state.doc.text).toBe('AB')
    expect(view.state.undo().doc.text).toBe(`A${newline}B`)
    view.destroy()
  },
)

import { afterEach, describe, expect, it, vi } from 'vitest'
import { ChangeSet, EditorState, MemoryTextDocument, Selection } from '@milkup/core'
import { parseMarkdown } from '@milkup/markdown'
import { EditorView } from '../editor-view'

vi.mock('@milkup/markdown', async (original) => {
  const actual = await original<typeof import('@milkup/markdown')>()
  return { ...actual, parseMarkdown: vi.fn(actual.parseMarkdown) }
})

afterEach(() => {
  document.body.replaceChildren()
  vi.clearAllMocks()
})

describe('ordinary live navigation parse budget', () => {
  it('reuses the current syntax tree for cursor reveal and coordinate queries', () => {
    const text = '# 中文 heading\n\n' + 'body plain é 👩🏽‍💻\n'.repeat(1024)
    const view = new EditorView({
      parent: document.body,
      mode: 'live',
      state: new EditorState({ doc: new MemoryTextDocument(text), selection: Selection.cursor(3) }),
    })
    vi.mocked(parseMarkdown).mockClear()
    view.ensureCursorVisible()
    const before = view.positionToRect(3)
    expect(view.coordinateToPosition({ x: before.left, y: before.top })).toBe(3)
    expect(parseMarkdown).not.toHaveBeenCalled()
    expect(view.state.doc.text).toBe(text)
    expect(view.contentDOM.querySelectorAll('.milkup-line').length).toBe(1027)
    view.destroy()
  })

  it('uses the updated tree after a document edit without reparsing during reveal', () => {
    const view = new EditorView({
      parent: document.body,
      mode: 'live',
      state: new EditorState({
        doc: new MemoryTextDocument('plain\n\nlast'),
        selection: Selection.cursor(0),
      }),
    })
    const transaction = { changes: ChangeSet.insert(0, '# '), selection: Selection.cursor(2) }
    view.updateState(view.state.applyTransaction(transaction), [transaction])
    expect(view.contentDOM.querySelector('.milkup-block-heading')).not.toBeNull()
    vi.mocked(parseMarkdown).mockClear()
    view.ensureCursorVisible()
    expect(view.positionToRect(2).left).toBeGreaterThanOrEqual(0)
    expect(parseMarkdown).not.toHaveBeenCalled()
    expect(view.state.doc.text).toBe('# plain\n\nlast')
    view.destroy()
  })
})

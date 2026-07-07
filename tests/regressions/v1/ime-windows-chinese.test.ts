import { Selection } from '@milkup/core'
import { describe, expect, it } from 'vitest'

import { createRegressionEditor } from './helpers/operation-log'
import { v1Issue } from './helpers/metadata'

const issue = v1Issue({
  area: 'ime',
  lesson: 'IME composition must not mutate the document before compositionend.',
  risk: 'Windows Chinese IME input in v1 could commit partial text or lose punctuation.',
  source: 'https://github.com/Auto-Plugin/milkup/issues/242',
})

describe('v1 regression: Windows Chinese IME composition', () => {
  it('keeps intermediate composition text out of history and commits the final text once', () => {
    expect(issue.source).toContain('/242')

    const editor = createRegressionEditor('标题：', Selection.cursor(3))

    editor.view.inputDOM.dispatchEvent(new CompositionEvent('compositionstart'))
    editor.view.inputDOM.value = 'ni'
    editor.view.inputDOM.dispatchEvent(new Event('input'))
    editor.view.inputDOM.dispatchEvent(new CompositionEvent('compositionupdate', { data: 'ni' }))

    expect(editor.view.state.doc.text).toBe('标题：')
    expect(editor.view.state.history.canUndo).toBe(false)
    expect(editor.view.state.selection.main.head).toBe(3)

    editor.view.inputDOM.dispatchEvent(
      new CompositionEvent('compositionend', { data: '你好，世界' }),
    )

    expect(editor.view.state.doc.text).toBe('标题：你好，世界')
    expect(editor.view.state.selection.main.head).toBe(8)
    expect(editor.view.state.history.undoStack).toHaveLength(1)
    editor.undo()
    expect(editor.view.state.doc.text).toBe('标题：')

    editor.destroy()
  })
})

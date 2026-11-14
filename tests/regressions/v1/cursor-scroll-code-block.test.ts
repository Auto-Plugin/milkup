import { Selection } from '@milkup/core'
import { describe, expect, it } from 'vitest'

import { createRegressionEditor } from './helpers/operation-log'
import { v1Issue } from './helpers/metadata'

const issue = v1Issue({
  area: 'mode-switch',
  lesson:
    'Cursor visibility must be calculated from source positions even inside rendered code blocks.',
  risk: 'v1 could lose cursor anchoring or scroll to the wrong place inside code-block editors.',
})

describe('v1 regression: cursor scroll inside code block', () => {
  it('keeps a deep fenced-code cursor visible after live/source mode switches', () => {
    expect(issue.risk).toContain('code-block')

    const text = [
      '# doc',
      '',
      '```ts',
      ...Array.from({ length: 28 }, (_, index) => `const value${index} = ${index}`),
      '```',
      '',
      'tail',
    ].join('\n')
    const codePosition = text.indexOf('const value25')
    const editor = createRegressionEditor(text, Selection.cursor(0))

    editor.dispatch({
      selection: Selection.cursor(codePosition),
      origin: { type: 'command', id: 'regression.moveCursor.deepCode' },
      addToHistory: false,
    })
    const sourceScroll = editor.view.dom.scrollTop

    editor.setMode('live')
    editor.view.ensureCursorVisible({ viewportHeight: 80, scrollPadding: 10 })
    const liveScroll = editor.view.dom.scrollTop
    editor.setMode('source')
    editor.view.ensureCursorVisible({ viewportHeight: 80, scrollPadding: 10 })

    expect(editor.view.state.doc.text).toBe(text)
    expect(editor.view.state.selection.main.head).toBe(codePosition)
    expect(editor.view.state.history.canUndo).toBe(false)
    expect(sourceScroll).toBeGreaterThan(0)
    expect(liveScroll).toBeGreaterThan(0)
    expect(editor.view.dom.scrollTop).toBeGreaterThan(0)

    editor.destroy()
  })
})

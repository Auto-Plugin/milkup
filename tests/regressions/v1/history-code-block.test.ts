import { ChangeSet, Selection } from '@milkup/core'
import { describe, expect, it } from 'vitest'

import { createRegressionEditor } from './helpers/operation-log'
import { v1Issue } from './helpers/metadata'

const issue = v1Issue({
  area: 'history',
  lesson: 'Code block editing must dispatch through the document transaction pipeline.',
  risk: 'The v1 CodeMirror island could create an isolated undo stack split from the document.',
})

describe('v1 regression: code block edits use global history', () => {
  it('undoes a fenced code edit after leaving and re-entering live mode', () => {
    expect(issue.risk).toContain('isolated undo stack')

    const source = '```ts\nconsole.log(1)\n```\n\noutside'
    const editor = createRegressionEditor(source, Selection.cursor(6))

    editor.dispatch({
      changes: ChangeSet.insert(6, '// comment\n'),
      selection: Selection.cursor(17),
      origin: { type: 'codeBlock', id: 'fence-1' },
      historyGroup: 'isolate',
    })
    editor.setMode('live')
    editor.setMode('source')

    expect(editor.view.state.doc.text).toBe('```ts\n// comment\nconsole.log(1)\n```\n\noutside')
    expect(editor.view.state.history.undoStack).toHaveLength(1)
    editor.undo()
    expect(editor.view.state.doc.text).toBe(source)
    expect(editor.log.at(0)).toMatchObject({
      type: 'dispatch',
      origin: 'codeBlock',
      undoDepth: 1,
    })

    editor.destroy()
  })
})

import { ChangeSet, Selection } from '@milkup/core'
import { describe, expect, it } from 'vitest'

import { createRegressionEditor, replayOperationLog } from './helpers/operation-log'
import { v1Issue } from './helpers/metadata'

const issue = v1Issue({
  area: 'history',
  lesson: 'Source/live/preview mode switches must be view changes, not document resets.',
  risk: 'Switching modes after edits used to drop undo history.',
})

describe('v1 regression: history survives mode switches', () => {
  it('keeps global undo history intact across repeated source/live/preview switches', async () => {
    expect(issue.area).toBe('history')

    const editor = createRegressionEditor('# Title\n\nBody', Selection.cursor(8))

    editor.dispatch({
      changes: ChangeSet.insert(8, 'edited '),
      selection: Selection.cursor(15),
      origin: { type: 'input.type' },
      historyGroup: 'isolate',
    })
    const history = editor.view.state.history

    editor.setMode('live')
    editor.setMode('preview')
    editor.setMode('source')
    editor.setMode('live')

    expect(editor.view.state.doc.text).toBe('# Title\nedited \nBody')
    expect(editor.view.state.history).toBe(history)
    expect(editor.view.state.history.canUndo).toBe(true)
    editor.undo()
    expect(editor.view.state.doc.text).toBe('# Title\n\nBody')
    expect(editor.log.map((operation) => operation.type)).toEqual([
      'dispatch',
      'mode',
      'mode',
      'mode',
      'mode',
      'undo',
    ])
    const replayed = await replayOperationLog('# Title\n\nBody', editor.log, Selection.cursor(8))
    expect(replayed.view.state.doc.text).toBe(editor.view.state.doc.text)
    expect(replayed.view.state.selection.main.anchor).toBe(editor.view.state.selection.main.anchor)

    replayed.destroy()
    editor.destroy()
  })
})

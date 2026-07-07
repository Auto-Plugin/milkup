import { Selection } from '@milkup/core'
import { parseMarkdown } from '@milkup/markdown'
import { describe, expect, it } from 'vitest'

import { createRegressionEditor } from './helpers/operation-log'
import { v1Issue } from './helpers/metadata'

const issue = v1Issue({
  area: 'mode-switch',
  lesson: 'Rendered table views must never become the source of truth.',
  risk: 'Switching modes around tables can lose pipes, rows, or history if view DOM is serialized.',
})

describe('v1 regression: table data survives mode switches', () => {
  it('keeps pasted table Markdown stable across source/live/preview toggles', async () => {
    expect(issue.risk).toContain('lose pipes')

    const editor = createRegressionEditor('', Selection.cursor(0))
    await editor.paste({
      html: '<table><tr><th>Name</th><th>Status</th></tr><tr><td>paste</td><td>ok</td></tr></table>',
    })
    const pasted = editor.view.state.doc.text
    const history = editor.view.state.history

    editor.setMode('live')
    editor.setMode('preview')
    editor.setMode('source')
    editor.setMode('live')

    expect(editor.view.state.doc.text).toBe(pasted)
    expect(editor.view.state.doc.text).toBe('| Name | Status |\n| --- | --- |\n| paste | ok |')
    expect(editor.view.state.history).toBe(history)
    expect(parseMarkdown(editor.view.state.doc.text).root.status).toBe('valid')
    editor.undo()
    expect(editor.view.state.doc.text).toBe('')

    editor.destroy()
  })
})

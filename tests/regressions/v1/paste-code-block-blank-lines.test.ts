import { Selection } from '@milkup/core'
import { describe, expect, it } from 'vitest'

import { createRegressionEditor } from './helpers/operation-log'
import { v1Issue } from './helpers/metadata'

const issue = v1Issue({
  area: 'paste',
  lesson: 'Pasting inside fenced code must preserve literal text and blank lines.',
  risk: 'Code-block paste in v1 could normalize or partially render Markdown-looking content.',
})

describe('v1 regression: code block paste preserves blank lines', () => {
  it('pastes literal text into a fenced code block and undoes it in one step', async () => {
    expect(issue.lesson).toContain('literal text')

    const source = '```ts\n\n```\n'
    const editor = createRegressionEditor(source, Selection.cursor(6))
    await editor.paste({
      plainText: 'const first = 1\n\n# not a heading\n\nconst second = 2\n',
      html: '<h1>not a heading</h1>',
    })

    expect(editor.view.state.doc.text).toBe(
      '```ts\nconst first = 1\n\n# not a heading\n\nconst second = 2\n\n```\n',
    )
    expect(editor.view.state.history.undoStack).toHaveLength(1)
    expect(editor.log.at(-1)).toMatchObject({
      type: 'paste',
      undoDepth: 1,
    })
    editor.undo()
    expect(editor.view.state.doc.text).toBe(source)

    editor.destroy()
  })
})

import { Selection } from '@milkup/core'
import { parseMarkdown } from '@milkup/markdown'
import { describe, expect, it } from 'vitest'

import { createRegressionEditor } from './helpers/operation-log'
import { v1Issue } from './helpers/metadata'

const issue = v1Issue({
  area: 'paste',
  lesson: 'AI-generated nested HTML must normalize to Markdown immediately after paste.',
  risk: 'Some pasted syntax in v1 stayed as unrendered or flattened text until another edit.',
})

describe('v1 regression: AI output paste normalizes immediately', () => {
  it('converts nested rich AI answer HTML into Markdown and keeps paste undoable once', async () => {
    expect(issue.area).toBe('paste')

    const editor = createRegressionEditor('', Selection.cursor(0))
    await editor.paste({
      html: [
        '<div>',
        '<h2>Plan</h2>',
        '<p>Use <strong>transactions</strong> and <em>stable</em> parsing.</p>',
        '<ol><li>Parse</li><li>Render</li></ol>',
        '<pre><code>const ok = true\n\nconsole.log(ok)</code></pre>',
        '<table><tr><th>Risk</th><th>Status</th></tr><tr><td>history</td><td>covered</td></tr></table>',
        '</div>',
      ].join(''),
    })

    const pasted = editor.view.state.doc.text
    expect(pasted).toContain('## Plan')
    expect(pasted).toContain('Use **transactions** and *stable* parsing.')
    expect(pasted).toContain('1. Parse\n2. Render')
    expect(pasted).toContain('```\nconst ok = true\n\nconsole.log(ok)\n```')
    expect(pasted).toContain('| Risk | Status |\n| --- | --- |\n| history | covered |')
    expect(parseMarkdown(pasted).root.status).toBe('valid')
    expect(editor.view.state.history.undoStack).toHaveLength(1)
    editor.undo()
    expect(editor.view.state.doc.text).toBe('')

    editor.destroy()
  })
})

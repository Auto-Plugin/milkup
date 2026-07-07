import { parseMarkdown, runMarkdownExtensionSafely } from '@milkup/markdown'
import { describe, expect, it } from 'vitest'

import { v1Issue } from './helpers/metadata'

const issue = v1Issue({
  area: 'rendering',
  lesson: 'Extension/render failures must be contained and must not mutate document content.',
  risk: 'Mermaid or plugin render failures in v1 could affect the wider app shell.',
  source: 'https://github.com/Auto-Plugin/milkup/issues/166',
})

describe('v1 regression: renderer and extension failure boundary', () => {
  it('captures extension failures while base Markdown parsing and source text remain stable', () => {
    expect(issue.source).toContain('/166')

    const source = '```mermaid\ngraph TD\n  A -->\n```\n\n# Still editable'
    const error = new Error('mermaid renderer exploded')
    const result = runMarkdownExtensionSafely({ extensionName: 'mermaid', hook: 'block' }, () => {
      throw error
    })
    const parsed = parseMarkdown(source)

    expect(result).toEqual({
      ok: false,
      error,
      context: {
        extensionName: 'mermaid',
        hook: 'block',
      },
    })
    expect(parsed.source).toBe(source)
    expect(parsed.root.status).toBe('valid')
    expect(parsed.root.children?.map((child) => child.type)).toContain('fencedCode')
    expect(parsed.root.children?.map((child) => child.type)).toContain('heading')
  })
})

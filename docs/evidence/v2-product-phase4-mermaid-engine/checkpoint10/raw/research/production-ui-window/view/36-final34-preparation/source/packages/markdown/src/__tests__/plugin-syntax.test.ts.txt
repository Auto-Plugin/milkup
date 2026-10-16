import { describe, expect, it } from 'vitest'

import { parseMarkdown } from '../index'

describe('controlled plugin markdown syntax', () => {
  it('adds declared block and inline nodes to the shared syntax tree', () => {
    const result = parseMarkdown(':::note Important\nText with ==mark== here\n', {
      syntaxExtensions: [
        {
          id: 'note-block',
          nodeType: 'pluginNote',
          pattern: '^:::note\\b.*$',
          block: true,
        },
        {
          id: 'highlight-inline',
          nodeType: 'pluginHighlight',
          pattern: '==[^=]+==',
          inline: true,
        },
      ],
    })

    expect(result.root.children?.[0]).toMatchObject({
      type: 'pluginNote',
      data: { extensionId: 'note-block' },
    })
    expect(result.root.children?.[1]?.children?.[0]).toMatchObject({
      type: 'pluginHighlight',
      data: { extensionId: 'highlight-inline' },
    })
  })

  it('isolates invalid extension patterns and preserves built-in parsing', () => {
    const result = parseMarkdown('# Still a heading', {
      syntaxExtensions: [
        {
          id: 'unsafe',
          nodeType: 'unsafeNode',
          pattern: '(a+)+',
          block: true,
        },
      ],
    })

    expect(result.root.children?.[0]).toMatchObject({ type: 'heading', status: 'valid' })
  })
})

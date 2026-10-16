import { describe, expect, it } from 'vitest'

import { parseMarkdownAst, stringifyMarkdownAst, type MarkdownAstDocument } from '../index'

describe('parseMarkdownAst', () => {
  it('projects CST blocks into a source-preserving Markdown AST', () => {
    const source = '# Title\n\nHello **world**\n'
    const ast = parseMarkdownAst(source)

    expect(ast).toMatchObject({
      type: 'document',
      source,
      raw: source,
      children: [
        {
          type: 'heading',
          text: 'Title',
          raw: '# Title\n',
          data: { level: 1 },
          inlineChildren: [{ type: 'text', text: 'Title' }],
        },
        { type: 'blankLine', raw: '\n' },
        {
          type: 'paragraph',
          text: 'Hello **world**',
          inlineChildren: [
            { type: 'text', text: 'Hello ' },
            { type: 'strong', text: 'world', children: [{ type: 'text', text: 'world' }] },
          ],
        },
      ],
    })
    expect(Object.isFrozen(ast)).toBe(true)
  })
})

describe('stringifyMarkdownAst', () => {
  it('round-trips parsed source by default', () => {
    const source = [
      '# Title',
      '',
      '> quote',
      '',
      '- one',
      '- two',
      '',
      '```ts',
      'const answer = 42',
      '```',
      '',
    ].join('\n')

    expect(stringifyMarkdownAst(parseMarkdownAst(source))).toBe(source)
  })

  it('can synthesize Markdown from a simple AST when source preservation is disabled', () => {
    const ast: MarkdownAstDocument = {
      type: 'document',
      from: 0,
      to: 0,
      status: 'valid',
      raw: '',
      source: '',
      children: [
        {
          type: 'heading',
          from: 0,
          to: 0,
          status: 'valid',
          raw: '',
          text: 'Generated',
          data: { level: 2 },
        },
        {
          type: 'unorderedList',
          from: 0,
          to: 0,
          status: 'valid',
          raw: '',
          children: [
            {
              type: 'listItem',
              from: 0,
              to: 0,
              status: 'valid',
              raw: '',
              text: 'one',
            },
            {
              type: 'listItem',
              from: 0,
              to: 0,
              status: 'valid',
              raw: '',
              text: 'two',
            },
          ],
        },
      ],
    }

    expect(stringifyMarkdownAst(ast, { preserveSource: false })).toBe(
      ['## Generated', '- one', '- two', ''].join('\n'),
    )
  })
})

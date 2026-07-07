import { describe, expect, it } from 'vitest'

import { parseInlineText, parseMarkdown, scanLines } from '../index'

describe('scanLines', () => {
  it('scans LF lines with source ranges', () => {
    expect(scanLines('a\nbb\n')).toEqual([
      { number: 1, from: 0, contentTo: 1, to: 2, text: 'a' },
      { number: 2, from: 2, contentTo: 4, to: 5, text: 'bb' },
    ])
  })

  it('preserves CRLF in source ranges but excludes CR from line text', () => {
    expect(scanLines('a\r\n')).toEqual([{ number: 1, from: 0, contentTo: 1, to: 3, text: 'a' }])
  })
})

describe('parseMarkdown block parser', () => {
  it('parses an empty document', () => {
    const result = parseMarkdown('')

    expect(result.root).toMatchObject({
      type: 'document',
      from: 0,
      to: 0,
      status: 'valid',
      children: [],
    })
  })

  it('parses blank lines as source-preserving nodes', () => {
    const result = parseMarkdown('\n\n')

    expect(result.root.children).toEqual([
      {
        type: 'blankLine',
        from: 0,
        to: 1,
        status: 'valid',
        contentRanges: [],
      },
      {
        type: 'blankLine',
        from: 1,
        to: 2,
        status: 'valid',
        contentRanges: [],
      },
    ])
  })

  it('parses ATX headings with marker and content ranges', () => {
    const result = parseMarkdown('###   Title\n')

    expect(result.root.children?.[0]).toEqual({
      type: 'heading',
      from: 0,
      to: 12,
      status: 'valid',
      markerRanges: [{ from: 0, to: 3 }],
      contentRanges: [{ from: 6, to: 11 }],
      data: { level: 3 },
    })
  })

  it('parses indented ATX headings up to three spaces', () => {
    const result = parseMarkdown('   ## Title')

    expect(result.root.children?.[0]).toMatchObject({
      type: 'heading',
      markerRanges: [{ from: 3, to: 5 }],
      contentRanges: [{ from: 6, to: 11 }],
      data: { level: 2 },
    })
  })

  it('does not parse seven hashes as an ATX heading', () => {
    const result = parseMarkdown('####### nope')

    expect(result.root.children?.[0]).toMatchObject({
      type: 'paragraph',
      from: 0,
      to: 12,
      status: 'valid',
      contentRanges: [{ from: 0, to: 12 }],
    })
  })

  it('collects adjacent plain lines into one paragraph', () => {
    const result = parseMarkdown('hello\nworld\n\nnext')

    expect(result.root.children).toMatchObject([
      {
        type: 'paragraph',
        from: 0,
        to: 12,
        contentRanges: [{ from: 0, to: 11 }],
      },
      {
        type: 'blankLine',
        from: 12,
        to: 13,
      },
      {
        type: 'paragraph',
        from: 13,
        to: 17,
        contentRanges: [{ from: 13, to: 17 }],
      },
    ])
  })

  it('keeps math-like delimiters as paragraph text before math syntax exists', () => {
    const result = parseMarkdown('$$\na=b\n$$\n')

    expect(result.root.children?.[0]).toMatchObject({
      type: 'paragraph',
      from: 0,
      to: 10,
      contentRanges: [{ from: 0, to: 9 }],
    })
  })

  it('parses GFM pipe tables with header, alignment, and body rows', () => {
    const source = '| Name | Value |\n| :--- | ---: |\n| alpha | a \\| b |\n'
    const result = parseMarkdown(source)

    expect(result.root.children?.[0]).toMatchObject({
      type: 'table',
      from: 0,
      to: source.length,
      status: 'valid',
      data: { alignments: ['left', 'right'] },
      children: [
        {
          type: 'tableRow',
          children: [
            { type: 'tableCell', contentRanges: [{ from: 2, to: 6 }] },
            { type: 'tableCell', contentRanges: [{ from: 9, to: 14 }] },
          ],
        },
        {
          type: 'tableRow',
          children: [
            { type: 'tableCell', contentRanges: [{ from: 35, to: 40 }] },
            { type: 'tableCell', contentRanges: [{ from: 43, to: 49 }] },
          ],
        },
      ],
    })
  })

  it('keeps malformed inline syntax as paragraph text', () => {
    const result = parseMarkdown('[title](\n**bold\n')

    expect(result.root.status).toBe('valid')
    expect(result.root.children?.[0]).toMatchObject({
      type: 'paragraph',
      from: 0,
      to: 16,
      status: 'valid',
    })
  })

  it('parses fenced code blocks and preserves Python blank lines', () => {
    const source = '```python\nprint(1)\n\nprint(2)\n```\n'
    const result = parseMarkdown(source)

    expect(result.root.children?.[0]).toEqual({
      type: 'fencedCode',
      from: 0,
      to: source.length,
      status: 'valid',
      markerRanges: [
        { from: 0, to: 3 },
        { from: 29, to: 32 },
      ],
      contentRanges: [{ from: 10, to: 29 }],
      data: { fenceChar: '`', fenceLength: 3, info: 'python' },
    })
    expect(source.slice(10, 29)).toBe('print(1)\n\nprint(2)\n')
  })

  it('represents unclosed fenced code blocks as incomplete nodes', () => {
    const source = '~~~js\nconsole.log(1)\n'
    const result = parseMarkdown(source)

    expect(result.root.children?.[0]).toEqual({
      type: 'fencedCode',
      from: 0,
      to: source.length,
      status: 'incomplete',
      markerRanges: [{ from: 0, to: 3 }],
      contentRanges: [{ from: 6, to: source.length }],
      data: { fenceChar: '~', fenceLength: 3, info: 'js' },
    })
  })

  it('does not parse Markdown syntax inside fenced code blocks', () => {
    const result = parseMarkdown('```\n# not heading\n- not list\n```\n')

    expect(result.root.children).toHaveLength(1)
    expect(result.root.children?.[0]).toMatchObject({
      type: 'fencedCode',
      status: 'valid',
      contentRanges: [{ from: 4, to: 29 }],
    })
  })

  it('parses thematic breaks before list markers', () => {
    const result = parseMarkdown('---\n- item\n')

    expect(result.root.children).toMatchObject([
      {
        type: 'thematicBreak',
        from: 0,
        to: 4,
        markerRanges: [{ from: 0, to: 3 }],
      },
      {
        type: 'unorderedList',
        from: 4,
        to: 11,
      },
    ])
  })

  it('parses unordered list items with marker and content ranges', () => {
    const result = parseMarkdown('- one\n- two\n')

    expect(result.root.children?.[0]).toEqual({
      type: 'unorderedList',
      from: 0,
      to: 12,
      status: 'valid',
      children: [
        {
          type: 'listItem',
          from: 0,
          to: 6,
          status: 'valid',
          markerRanges: [{ from: 0, to: 1 }],
          contentRanges: [{ from: 2, to: 5 }],
          data: { marker: '-' },
        },
        {
          type: 'listItem',
          from: 6,
          to: 12,
          status: 'valid',
          markerRanges: [{ from: 6, to: 7 }],
          contentRanges: [{ from: 8, to: 11 }],
          data: { marker: '-' },
        },
      ],
      data: {},
    })
  })

  it('parses ordered list items with start data', () => {
    const result = parseMarkdown('3. one\n4. two\n')

    expect(result.root.children?.[0]).toEqual({
      type: 'orderedList',
      from: 0,
      to: 14,
      status: 'valid',
      children: [
        {
          type: 'listItem',
          from: 0,
          to: 7,
          status: 'valid',
          markerRanges: [{ from: 0, to: 2 }],
          contentRanges: [{ from: 3, to: 6 }],
          data: { number: 3, delimiter: '.' },
        },
        {
          type: 'listItem',
          from: 7,
          to: 14,
          status: 'valid',
          markerRanges: [{ from: 7, to: 9 }],
          contentRanges: [{ from: 10, to: 13 }],
          data: { number: 4, delimiter: '.' },
        },
      ],
      data: { start: 3 },
    })
  })

  it('parses indented code blocks with indentation marker ranges', () => {
    const source = '    const a = 1\n    const b = 2\n'
    const result = parseMarkdown(source)

    expect(result.root.children?.[0]).toEqual({
      type: 'indentedCode',
      from: 0,
      to: source.length,
      status: 'valid',
      markerRanges: [
        { from: 0, to: 4 },
        { from: 16, to: 20 },
      ],
      contentRanges: [
        { from: 4, to: 15 },
        { from: 20, to: 31 },
      ],
    })
  })

  it('parses blockquotes with line marker and content ranges', () => {
    const source = '> quote\n> **still raw**\n'
    const result = parseMarkdown(source)

    expect(result.root.children?.[0]).toEqual({
      type: 'blockquote',
      from: 0,
      to: source.length,
      status: 'valid',
      markerRanges: [
        { from: 0, to: 1 },
        { from: 8, to: 9 },
      ],
      contentRanges: [
        { from: 2, to: 7 },
        { from: 10, to: 23 },
      ],
      children: [
        {
          type: 'blockquoteLine',
          from: 0,
          to: 8,
          status: 'valid',
          markerRanges: [{ from: 0, to: 1 }],
          contentRanges: [{ from: 2, to: 7 }],
        },
        {
          type: 'blockquoteLine',
          from: 8,
          to: 24,
          status: 'valid',
          markerRanges: [{ from: 8, to: 9 }],
          contentRanges: [{ from: 10, to: 23 }],
        },
      ],
    })
  })

  it('keeps list-looking content inside blockquotes as quote content for now', () => {
    const result = parseMarkdown('> - quoted item\n- plain item\n')

    expect(result.root.children).toMatchObject([
      {
        type: 'blockquote',
        from: 0,
        to: 16,
        contentRanges: [{ from: 2, to: 15 }],
      },
      {
        type: 'unorderedList',
        from: 16,
        to: 29,
      },
    ])
  })
})

describe('parseInlineText', () => {
  it('returns a text node over the requested range', () => {
    expect(parseInlineText('hello **world**', 6, 15)).toEqual([
      {
        type: 'text',
        from: 6,
        to: 15,
        status: 'valid',
        contentRanges: [{ from: 6, to: 15 }],
        data: { value: '**world**' },
      },
    ])
  })

  it('returns no nodes for an empty range', () => {
    expect(parseInlineText('hello', 2, 2)).toEqual([])
  })
})

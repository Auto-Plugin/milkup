import { describe, expect, it } from 'vitest'

import { parseInline, parseInlineText } from '../index'

describe('parseInline', () => {
  it('parses plain text', () => {
    expect(parseInline('hello')).toEqual([
      {
        type: 'text',
        from: 0,
        to: 5,
        status: 'valid',
        contentRanges: [{ from: 0, to: 5 }],
        data: { value: 'hello' },
      },
    ])
  })

  it('parses escaped characters', () => {
    expect(parseInline('\\*')).toEqual([
      {
        type: 'escape',
        from: 0,
        to: 2,
        status: 'valid',
        markerRanges: [{ from: 0, to: 1 }],
        contentRanges: [{ from: 1, to: 2 }],
        data: { value: '*' },
      },
    ])
  })

  it('parses inline code spans', () => {
    expect(parseInline('`a * b`')).toEqual([
      {
        type: 'inlineCode',
        from: 0,
        to: 7,
        status: 'valid',
        markerRanges: [
          { from: 0, to: 1 },
          { from: 6, to: 7 },
        ],
        contentRanges: [{ from: 1, to: 6 }],
        data: { value: 'a * b' },
      },
    ])
  })

  it('represents unclosed inline code spans as incomplete nodes', () => {
    expect(parseInline('`abc')).toEqual([
      {
        type: 'inlineCode',
        from: 0,
        to: 4,
        status: 'incomplete',
        markerRanges: [{ from: 0, to: 1 }],
        contentRanges: [{ from: 1, to: 4 }],
      },
    ])
  })

  it('parses emphasis with child text', () => {
    expect(parseInline('*em*')).toEqual([
      {
        type: 'emphasis',
        from: 0,
        to: 4,
        status: 'valid',
        markerRanges: [
          { from: 0, to: 1 },
          { from: 3, to: 4 },
        ],
        contentRanges: [{ from: 1, to: 3 }],
        children: [
          {
            type: 'text',
            from: 1,
            to: 3,
            status: 'valid',
            contentRanges: [{ from: 1, to: 3 }],
            data: { value: 'em' },
          },
        ],
      },
    ])
  })

  it('parses strong with child text', () => {
    expect(parseInline('**bold**')).toEqual([
      {
        type: 'strong',
        from: 0,
        to: 8,
        status: 'valid',
        markerRanges: [
          { from: 0, to: 2 },
          { from: 6, to: 8 },
        ],
        contentRanges: [{ from: 2, to: 6 }],
        children: [
          {
            type: 'text',
            from: 2,
            to: 6,
            status: 'valid',
            contentRanges: [{ from: 2, to: 6 }],
            data: { value: 'bold' },
          },
        ],
      },
    ])
  })

  it('preserves surrounding text around strong nodes', () => {
    expect(parseInline('a **b** c')).toEqual([
      {
        type: 'text',
        from: 0,
        to: 2,
        status: 'valid',
        contentRanges: [{ from: 0, to: 2 }],
        data: { value: 'a ' },
      },
      {
        type: 'strong',
        from: 2,
        to: 7,
        status: 'valid',
        markerRanges: [
          { from: 2, to: 4 },
          { from: 5, to: 7 },
        ],
        contentRanges: [{ from: 4, to: 5 }],
        children: [
          {
            type: 'text',
            from: 4,
            to: 5,
            status: 'valid',
            contentRanges: [{ from: 4, to: 5 }],
            data: { value: 'b' },
          },
        ],
      },
      {
        type: 'text',
        from: 7,
        to: 9,
        status: 'valid',
        contentRanges: [{ from: 7, to: 9 }],
        data: { value: ' c' },
      },
    ])
  })

  it('represents unclosed emphasis as an incomplete node', () => {
    expect(parseInline('*em')).toEqual([
      {
        type: 'emphasis',
        from: 0,
        to: 3,
        status: 'incomplete',
        markerRanges: [{ from: 0, to: 1 }],
        contentRanges: [{ from: 1, to: 3 }],
      },
    ])
  })

  it('parses inline links with label children and destination ranges', () => {
    expect(parseInline('[title](url)')).toEqual([
      {
        type: 'link',
        from: 0,
        to: 12,
        status: 'valid',
        markerRanges: [
          { from: 0, to: 1 },
          { from: 6, to: 7 },
          { from: 7, to: 8 },
          { from: 11, to: 12 },
        ],
        contentRanges: [
          { from: 1, to: 6 },
          { from: 8, to: 11 },
        ],
        children: [
          {
            type: 'text',
            from: 1,
            to: 6,
            status: 'valid',
            contentRanges: [{ from: 1, to: 6 }],
            data: { value: 'title' },
          },
        ],
        data: { label: 'title', destination: 'url' },
      },
    ])
  })

  it('parses images with alt text and destination ranges', () => {
    expect(parseInline('![alt](img.png)')).toEqual([
      {
        type: 'image',
        from: 0,
        to: 15,
        status: 'valid',
        markerRanges: [
          { from: 0, to: 1 },
          { from: 1, to: 2 },
          { from: 5, to: 6 },
          { from: 6, to: 7 },
          { from: 14, to: 15 },
        ],
        contentRanges: [
          { from: 2, to: 5 },
          { from: 7, to: 14 },
        ],
        children: [],
        data: { label: 'alt', destination: 'img.png' },
      },
    ])
  })

  it('represents unclosed links as incomplete nodes', () => {
    expect(parseInline('[title](')).toEqual([
      {
        type: 'link',
        from: 0,
        to: 8,
        status: 'incomplete',
        markerRanges: [
          { from: 0, to: 1 },
          { from: 6, to: 7 },
          { from: 7, to: 8 },
        ],
        contentRanges: [
          { from: 1, to: 6 },
          { from: 8, to: 8 },
        ],
        children: [
          {
            type: 'text',
            from: 1,
            to: 6,
            status: 'valid',
            contentRanges: [{ from: 1, to: 6 }],
            data: { value: 'title' },
          },
        ],
      },
    ])
  })

  it('parses URL autolinks', () => {
    expect(parseInline('<https://a.dev>')).toEqual([
      {
        type: 'autolink',
        from: 0,
        to: 15,
        status: 'valid',
        markerRanges: [
          { from: 0, to: 1 },
          { from: 14, to: 15 },
        ],
        contentRanges: [{ from: 1, to: 14 }],
        data: { kind: 'url', value: 'https://a.dev' },
      },
    ])
  })

  it('parses email autolinks', () => {
    expect(parseInline('<a@b.dev>')).toMatchObject([
      {
        type: 'autolink',
        data: { kind: 'email', value: 'a@b.dev' },
      },
    ])
  })

  it('parses hard breaks from two spaces before a newline', () => {
    expect(parseInline('a  \nb')).toEqual([
      {
        type: 'text',
        from: 0,
        to: 1,
        status: 'valid',
        contentRanges: [{ from: 0, to: 1 }],
        data: { value: 'a' },
      },
      {
        type: 'hardBreak',
        from: 1,
        to: 4,
        status: 'valid',
        markerRanges: [{ from: 1, to: 3 }],
        data: { kind: 'spaces' },
      },
      {
        type: 'text',
        from: 4,
        to: 5,
        status: 'valid',
        contentRanges: [{ from: 4, to: 5 }],
        data: { value: 'b' },
      },
    ])
  })

  it('parses emphasis inside link labels', () => {
    expect(parseInline('[*x*](y)')).toMatchObject([
      {
        type: 'link',
        from: 0,
        to: 8,
        children: [
          {
            type: 'emphasis',
            from: 1,
            to: 4,
          },
        ],
      },
    ])
  })

  it('parses links and code spans inside emphasis', () => {
    expect(parseInline('*[x](y)* *`z`*')).toMatchObject([
      {
        type: 'emphasis',
        from: 0,
        to: 8,
        children: [
          {
            type: 'link',
            from: 1,
            to: 7,
          },
        ],
      },
      {
        type: 'text',
        from: 8,
        to: 9,
      },
      {
        type: 'emphasis',
        from: 9,
        to: 14,
        children: [
          {
            type: 'inlineCode',
            from: 10,
            to: 13,
          },
        ],
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

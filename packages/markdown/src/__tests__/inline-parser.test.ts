import { describe, expect, it } from 'vitest'

import { parseInline, parseInlineText } from '../index'

describe('parseInline', () => {
  it('parses strikethrough with nested emphasis and leaves following Unicode text plain', () => {
    const source = '~~中文 **bold *斜体***~~ 后文👩🏽‍💻'
    const nodes = parseInline(source)
    const closing = source.indexOf('~~', 2)
    expect(nodes[0]).toMatchObject({
      type: 'strikethrough',
      status: 'valid',
      from: 0,
      to: closing + 2,
      markerRanges: [
        { from: 0, to: 2 },
        { from: closing, to: closing + 2 },
      ],
      contentRanges: [{ from: 2, to: closing }],
      children: expect.arrayContaining([
        expect.objectContaining({ type: 'strong', status: 'valid' }),
      ]),
    })
    expect(nodes[1]).toMatchObject({ type: 'text', from: closing + 2, data: { value: ' 后文👩🏽‍💻' } })
  })

  it('ignores strike delimiters in escaped text and complete code spans', () => {
    expect(parseInline('\\~\\~literal\\~\\~').some((node) => node.type === 'strikethrough')).toBe(
      false,
    )
    expect(parseInline('`~~literal~~`')[0]).toMatchObject({ type: 'inlineCode', status: 'valid' })
    expect(parseInline('~~a `~~` b~~ tail')[0]).toMatchObject({
      type: 'strikethrough',
      status: 'valid',
      to: 12,
      children: expect.arrayContaining([
        expect.objectContaining({ type: 'inlineCode', status: 'valid' }),
      ]),
    })
    expect(parseInline('~~a \\~\\~ b~~')[0]).toMatchObject({
      type: 'strikethrough',
      status: 'valid',
    })
  })

  it('preserves incomplete strike while typing and does not treat single or triple tildes as strike', () => {
    expect(parseInline('~~未完成')[0]).toMatchObject({
      type: 'strikethrough',
      status: 'incomplete',
      markerRanges: [{ from: 0, to: 2 }],
    })
    for (const source of ['~single~', '~~~literal~~~', '~~ whitespace ~~', '~~~~']) {
      expect(parseInline(source).some((node) => node.type === 'strikethrough')).toBe(false)
    }
  })

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

  it.each([
    ['粗体中的 ', '斜体', ''],
    ['粗体中的 ', '斜体', ' 后续文字'],
    ['中文 bold ', 'italic 斜体', ' following 中文 text'],
    ['English 中文 ', '斜体 italic', ' 后续 English'],
    ['粗体😀 ', '斜体🧑‍💻', ' 中文 English🚀'],
  ])('closes nested emphasis before strong in %s', (bold, italic, trailing) => {
    const source = `**${bold}*${italic}***${trailing}`
    const emphasisFrom = 2 + bold.length
    const closingFrom = emphasisFrom + 1 + italic.length
    const strongTo = closingFrom + 3

    const nodes = parseInline(source)
    expect(nodes).toHaveLength(trailing ? 2 : 1)
    expect(nodes[0]).toMatchObject({
      type: 'strong',
      from: 0,
      to: strongTo,
      status: 'valid',
      markerRanges: [
        { from: 0, to: 2 },
        { from: closingFrom + 1, to: strongTo },
      ],
      contentRanges: [{ from: 2, to: closingFrom + 1 }],
      children: [
        { type: 'text', data: { value: bold } },
        {
          type: 'emphasis',
          from: emphasisFrom,
          to: closingFrom + 1,
          status: 'valid',
          markerRanges: [
            { from: emphasisFrom, to: emphasisFrom + 1 },
            { from: closingFrom, to: closingFrom + 1 },
          ],
          children: [{ type: 'text', data: { value: italic } }],
        },
      ],
    })
    if (trailing) {
      expect(nodes[1]).toMatchObject({
        type: 'text',
        from: strongTo,
        to: source.length,
        data: { value: trailing },
      })
    }
  })

  it.each(['\\* ', '`*` ', '``a * ` b`` ', '*earlier* '])(
    'ignores already consumed star delimiters before nested emphasis: %s',
    (prefix) => {
      const source = `**${prefix}*斜体*** 后续`
      const nodes = parseInline(source)
      expect(nodes).toHaveLength(2)
      expect(nodes[0]).toMatchObject({ type: 'strong', status: 'valid' })
      expect(nodes[0]?.children?.at(-1)).toMatchObject({
        type: 'emphasis',
        status: 'valid',
        children: [{ type: 'text', data: { value: '斜体' } }],
      })
      expect(nodes[1]).toMatchObject({ type: 'text', data: { value: ' 后续' } })
    },
  )

  it.each(['\\*', '`*`', '``a * ` b``'])(
    'keeps literal stars inside nested emphasis: %s',
    (literal) => {
      const nodes = parseInline(`**粗体 *斜体 ${literal} text*** 后续`)
      expect(nodes).toHaveLength(2)
      expect(nodes[0]).toMatchObject({
        type: 'strong',
        status: 'valid',
        children: [
          { type: 'text' },
          {
            type: 'emphasis',
            status: 'valid',
            children: [
              { type: 'text', data: { value: '斜体 ' } },
              { type: literal.startsWith('\\') ? 'escape' : 'inlineCode' },
              { type: 'text', data: { value: ' text' } },
            ],
          },
        ],
      })
      expect(nodes[1]).toMatchObject({ type: 'text', data: { value: ' 后续' } })
    },
  )

  it('keeps successive mixed-language emphasis independent', () => {
    expect(parseInline('中文 *italic* English **粗体 *斜体*** 后续 **bold**')).toMatchObject([
      { type: 'text', data: { value: '中文 ' } },
      { type: 'emphasis', status: 'valid' },
      { type: 'text', data: { value: ' English ' } },
      { type: 'strong', status: 'valid' },
      { type: 'text', data: { value: ' 后续 ' } },
      { type: 'strong', status: 'valid' },
    ])
  })

  it('preserves incomplete strong and emphasis children while typing', () => {
    expect(parseInline('**粗体 *斜体')).toMatchObject([
      { type: 'strong', status: 'incomplete', markerRanges: [{ from: 0, to: 2 }] },
    ])
    expect(parseInline('**粗体 *斜体** 后续')).toMatchObject([
      {
        type: 'strong',
        status: 'valid',
        children: [{ type: 'text' }, { type: 'emphasis', status: 'incomplete' }],
      },
      { type: 'text', data: { value: ' 后续' } },
    ])
    expect(parseInline('**粗体 `code** 后续')).toMatchObject([
      {
        type: 'strong',
        status: 'valid',
        children: [{ type: 'text' }, { type: 'inlineCode', status: 'incomplete' }],
      },
      { type: 'text', data: { value: ' 后续' } },
    ])
  })

  it('respects requested ranges when a closing run continues outside them', () => {
    expect(parseInline('**粗体**', 0, 5)).toMatchObject([
      {
        type: 'strong',
        from: 0,
        to: 5,
        status: 'incomplete',
        markerRanges: [{ from: 0, to: 2 }],
      },
    ])
    expect(parseInline('***', 0, 1)).toMatchObject([
      {
        type: 'emphasis',
        from: 0,
        to: 1,
        status: 'incomplete',
        markerRanges: [{ from: 0, to: 1 }],
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

  it.each(['!', ''])(
    'recognizes escaped closing brackets in %s labels without extending the range',
    (prefix) => {
      const label = String.raw`左\]右 😀`,
        source = `${prefix}[${label}](assets/pic.png) tail`
      const nodes = parseInline(source)
      expect(nodes[0]).toMatchObject({
        type: prefix ? 'image' : 'link',
        status: 'valid',
        from: 0,
        to: source.indexOf(' tail'),
        data: { label, destination: 'assets/pic.png' },
        contentRanges: [
          { from: prefix.length + 1, to: source.indexOf('](') },
          { from: source.indexOf('](') + 2, to: source.indexOf(')') },
        ],
      })
      expect(nodes[1]).toMatchObject({ type: 'text', data: { value: ' tail' } })
    },
  )

  it('uses backslash parity for label delimiters and preserves incomplete bounded labels', () => {
    const even = String.raw`![left\\](assets/x.png)`
    expect(parseInline(even)[0]).toMatchObject({
      type: 'image',
      status: 'valid',
      data: { label: String.raw`left\\` },
    })
    const odd = String.raw`![left\\\]right](assets/x.png)`
    expect(parseInline(odd)[0]).toMatchObject({
      type: 'image',
      status: 'valid',
      data: { label: String.raw`left\\\]right` },
    })
    const partial = String.raw`![left\]right](assets/x.png)`
    const end = partial.indexOf('](')
    expect(parseInline(partial, 0, end)[0]).toMatchObject({
      type: 'image',
      status: 'incomplete',
      to: end,
      contentRanges: [{ from: 2, to: end }],
    })
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

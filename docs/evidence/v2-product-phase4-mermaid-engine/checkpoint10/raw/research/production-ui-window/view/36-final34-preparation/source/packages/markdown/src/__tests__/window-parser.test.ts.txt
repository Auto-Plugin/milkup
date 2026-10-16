import { describe, expect, it } from 'vitest'

import { parseMarkdownWindow, type MarkdownLineWindow } from '../index'

class FakeLineWindowStore {
  readonly documentId = 'window-doc'
  readonly version = 7
  readonly requests: Array<{ fromLine: number; toLine: number }> = []

  constructor(private readonly text: string) {}

  async readLineWindow(fromLine: number, toLine: number): Promise<MarkdownLineWindow> {
    this.requests.push({ fromLine, toLine })

    const lines = buildLines(this.text).slice(fromLine - 1, toLine)
    const first = lines[0]
    const last = lines.at(-1)

    if (!first || !last) {
      throw new RangeError(`Invalid line window: ${fromLine}-${toLine}`)
    }

    return Object.freeze({
      fromLine,
      toLine,
      from: first.from,
      to: last.to,
      text: this.text.slice(first.from, last.to),
      lines: Object.freeze(lines),
    })
  }
}

describe('parseMarkdownWindow', () => {
  it('parses a line window and maps CST ranges back to document offsets', async () => {
    const store = new FakeLineWindowStore(['intro', '# Window', '', '- item'].join('\n'))
    const result = await parseMarkdownWindow(store, { fromLine: 2, toLine: 4 })

    expect(result.documentId).toBe('window-doc')
    expect(result.version).toBe(7)
    expect(result.window).toMatchObject({ fromLine: 2, toLine: 4, from: 6, to: 22 })
    expect(result.localSource).toBe('# Window\n\n- item')
    expect(result.root).toMatchObject({
      type: 'document',
      from: 6,
      to: 22,
      children: [
        {
          type: 'heading',
          from: 6,
          to: 15,
          markerRanges: [{ from: 6, to: 7 }],
          contentRanges: [{ from: 8, to: 14 }],
        },
        { type: 'blankLine', from: 15, to: 16 },
        {
          type: 'unorderedList',
          from: 16,
          to: 22,
          children: [
            {
              type: 'listItem',
              from: 16,
              to: 22,
              markerRanges: [{ from: 16, to: 17 }],
              contentRanges: [{ from: 18, to: 22 }],
            },
          ],
        },
      ],
    })
  })

  it('does not read or parse lines outside the requested window', async () => {
    const store = new FakeLineWindowStore(
      ['# Outside', 'plain **inside**', '# Outside 2'].join('\n'),
    )
    const result = await parseMarkdownWindow(store, { fromLine: 2, toLine: 2 })

    expect(result.localSource).toBe('plain **inside**')
    expect(result.root.children).toHaveLength(1)
    expect(result.root.children?.[0]).toMatchObject({
      type: 'paragraph',
      from: 10,
      to: 26,
      contentRanges: [{ from: 10, to: 26 }],
    })
  })

  it('parses a large fenced code block from a local line window', async () => {
    const codeLines = Array.from({ length: 256 }, (_, index) => `line-${index}`)
    const text = ['# Outside', '```log', ...codeLines, '```', '# Tail'].join('\n')
    const store = new FakeLineWindowStore(text)
    const result = await parseMarkdownWindow(store, { fromLine: 2, toLine: 259 })
    const firstFenceOffset = '# Outside\n'.length
    const closingFenceOffset = ['# Outside', '```log', ...codeLines].join('\n').length + 1

    expect(store.requests).toEqual([{ fromLine: 2, toLine: 259 }])
    expect(result.localSource).not.toContain('# Outside')
    expect(result.localSource).not.toContain('# Tail')
    expect(result.root.children).toHaveLength(1)
    expect(result.root.children?.[0]).toMatchObject({
      type: 'fencedCode',
      status: 'valid',
      from: firstFenceOffset,
      to: result.window.to,
      markerRanges: [
        { from: firstFenceOffset, to: firstFenceOffset + 3 },
        { from: closingFenceOffset, to: closingFenceOffset + 3 },
      ],
      contentRanges: [{ from: firstFenceOffset + 7, to: closingFenceOffset }],
    })
  })
})

function buildLines(text: string): readonly MarkdownLineWindow['lines'][number][] {
  const starts = [0]

  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) === 10) {
      starts.push(index + 1)
    }
  }

  return Object.freeze(
    starts.map((from, index) => {
      const next = starts[index + 1]
      const rawTo = next === undefined ? text.length : next - 1
      const to = rawTo > from && text.charCodeAt(rawTo - 1) === 13 ? rawTo - 1 : rawTo

      return Object.freeze({
        number: index + 1,
        from,
        to,
        text: text.slice(from, to),
      })
    }),
  )
}

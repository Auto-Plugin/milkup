import { describe, expect, it } from 'vitest'

import {
  createMarkdownParseCache,
  expandInvalidationRange,
  parseMarkdown,
  parseMarkdownIncremental,
} from '../index'

describe('incremental parsing cache', () => {
  it('captures top-level block ranges', () => {
    const parsed = parseMarkdown('# Title\n\nBody\n')
    const cache = createMarkdownParseCache(parsed)

    expect(cache.blockRanges).toEqual([
      { from: 0, to: 8 },
      { from: 8, to: 9 },
      { from: 9, to: 14 },
    ])
  })

  it('expands invalidation to the touched block boundary', () => {
    const cache = createMarkdownParseCache(parseMarkdown('hello\nworld\n\nnext'))

    expect(expandInvalidationRange(cache, { from: 3, to: 4 })).toEqual({ from: 0, to: 12 })
  })

  it('returns an incremental result equivalent to a full parse', () => {
    const initial = '# Title\n\nBody\n'
    const previous = createMarkdownParseCache(parseMarkdown(initial))
    const next = replace(initial, 9, 13, '- one\n- two')
    const incremental = parseMarkdownIncremental(next, {
      previous,
      change: { from: 9, to: 13, insertedLength: '- one\n- two'.length },
    })
    const full = parseMarkdown(next)

    expect(incremental.root).toEqual(full.root)
    expect(incremental.cache.root).toEqual(full.root)
    expect(incremental.reusedPreviousTree).toBe(false)
  })

  it('matches full parse after a deterministic edit sequence', () => {
    let source = '# Title\n\nBody\n\n```ts\nconsole.log(1)\n```\n'
    let cache = createMarkdownParseCache(parseMarkdown(source))
    const edits = [
      { from: 2, to: 7, insert: 'Heading' },
      { from: source.length, to: source.length, insert: '\n> quote\n' },
      { from: 10, to: 10, insert: '**' },
      { from: 16, to: 16, insert: '**' },
      { from: 0, to: 0, insert: '---\n' },
    ]

    for (const edit of edits) {
      source = replace(source, edit.from, edit.to, edit.insert)
      const incremental = parseMarkdownIncremental(source, {
        previous: cache,
        change: { from: edit.from, to: edit.to, insertedLength: edit.insert.length },
      })
      const full = parseMarkdown(source)

      expect(incremental.root).toEqual(full.root)
      cache = incremental.cache
    }
  })
})

function replace(source: string, from: number, to: number, insert: string): string {
  return source.slice(0, from) + insert + source.slice(to)
}

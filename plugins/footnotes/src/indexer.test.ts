import { describe, expect, it } from 'vitest'
import { FootnoteIndex, normalizeLabel } from './indexer'
function feed(index: FootnoteIndex, source: string, start = 0, line = 1) {
  let from = start
  for (const text of source.split('\n')) {
    index.consume({
      number: line++,
      from,
      to: from + text.replace(/\r$/, '').length,
      text: text.replace(/\r$/, ''),
    })
    from += text.length + 1
  }
}
describe('bounded footnote index', () => {
  it('numbers by first reference and keeps first definition with duplicate diagnostics', () => {
    const index = new FootnoteIndex()
    feed(index, 'B[^b] A[^a] 再[^b]\n[^a]: *alpha*\n[^b]: beta\n[^b]: duplicate')
    index.finish()
    expect(index.references.map((r) => [r.key, r.number])).toEqual([
      ['b', 1],
      ['a', 2],
      ['b', 1],
    ])
    expect(index.definitions.get('b')?.body).toBe('beta')
    expect(index.duplicates).toHaveLength(1)
    expect(index.complete).toBe(true)
  })
  it('keeps CRLF Unicode source offsets and normalizes NFC without case folding', () => {
    const index = new FootnoteIndex()
    feed(index, '😀[^e\u0301]\r\n[^é]: 中文\r\n')
    index.finish()
    expect(index.references[0]).toMatchObject({ from: 2, to: 7, key: 'é' })
    expect(index.definitions.get('é')?.from).toBe(9)
    expect(normalizeLabel(' A ')).toBe('A')
    expect(normalizeLabel('a b')).toBeUndefined()
    expect(normalizeLabel('a')).not.toBe(normalizeLabel('A'))
  })
  it('collects space and tab continuations across pages without retaining unrelated text', () => {
    const index = new FootnoteIndex()
    feed(index, '[^x]: first\n    second', 0)
    feed(index, '\tthird\nordinary[^x]', 25, 3)
    index.finish()
    expect(index.definitions.get('x')?.body).toBe('first\nsecond\nthird')
    expect(index.references).toHaveLength(1)
  })
  it('excludes escapes, inline code, fences, HTML and uncertain nested containers', () => {
    const index = new FootnoteIndex()
    feed(
      index,
      '\\[^a] `[^b]`\n```md\n[^c]: bad\n```\n<div>\n[^d]\n</div>\n\nplain[^ok]\n> ```\n> [^nested]',
    )
    index.finish()
    expect(index.references.map((r) => r.key)).toEqual(['ok'])
    expect(index.definitions.size).toBe(0)
  })
  it('distinguishes absent definitions from incomplete budget-limited search', () => {
    const index = new FootnoteIndex({ maxEntries: 2 })
    feed(index, 'one[^a] two[^b] three[^c]')
    index.finish()
    expect(index.complete).toBe(false)
    expect(index.partialReason).toBe('entry-limit')
    expect(index.references).toHaveLength(2)
  })
  it('does not accept malformed or unbounded labels and bounds definition previews', () => {
    const index = new FootnoteIndex({ maxBody: 8 })
    feed(index, '[^bad id] [^] [^' + 'a'.repeat(129) + ']\n[^ok]: ' + 'x'.repeat(20))
    index.finish()
    expect(index.references).toHaveLength(0)
    expect(index.definitions.get('ok')?.body.length).toBe(8)
    expect(index.definitions.get('ok')?.truncated).toBe(true)
  })
})

it('keeps incomplete image syntax and unfinished code source without claiming missing definitions', () => {
  const index = new FootnoteIndex()
  feed(index, '![^image] [label](assets/[^path]) normal[^ok]\n`unfinished\n[^ok]: uncertain')
  index.finish()
  expect(index.references.map((r) => r.key)).toEqual(['ok'])
  expect(index.complete).toBe(false)
  expect(index.partialReason).toBe('incomplete-inline-code')
})

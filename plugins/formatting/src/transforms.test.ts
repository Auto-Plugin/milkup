import { describe, expect, it } from 'vitest'
import { transform, type Capture } from './transforms'

function capture(text: string, anchor = 0, head = text.length): Capture {
  return {
    text,
    selection: { anchor, head },
    lineEnding: text.includes('\r\n') ? '\r\n' : '\n',
    syntax: { context: 'text', complete: true, nodes: [] },
  }
}
function result(c: Capture, action: string, input?: string) {
  const edit = transform(c, action, input)
  let text = c.text
  for (const change of [...edit.changes].reverse())
    text = text.slice(0, change.from) + change.insert + text.slice(change.to)
  return { text, selection: edit.selection }
}
describe('bounded formatting transformations', () => {
  it('preserves Unicode and backward selection when emphasizing', () => {
    expect(result(capture('😀中文', 4, 0), 'bold')).toEqual({
      text: '**😀中文**',
      selection: { anchor: 6, head: 2 },
    })
  })
  it('uses CST markers to toggle valid nested emphasis without deleting inner syntax', () => {
    const c = capture('**bold *italic***', 2, 15)
    c.syntax.nodes.push({
      type: 'strong',
      status: 'valid',
      from: 0,
      to: 17,
      markerRanges: [
        { from: 0, to: 2 },
        { from: 15, to: 17 },
      ],
      contentRanges: [{ from: 2, to: 15 }],
    })
    expect(result(c, 'bold').text).toBe('bold *italic*')
  })
  it('rejects unknown and code contexts rather than guessing', () => {
    for (const context of ['unknown', 'code'] as const) {
      const c = capture('text')
      c.syntax.context = context
      expect(() => transform(c, 'bold')).toThrow()
    }
  })
  it('rejects a selection cutting through a syntax marker', () => {
    const c = capture('**bold**', 1, 4)
    c.syntax.nodes.push({
      type: 'strong',
      status: 'valid',
      from: 0,
      to: 8,
      markerRanges: [
        { from: 0, to: 2 },
        { from: 6, to: 8 },
      ],
      contentRanges: [{ from: 2, to: 6 }],
    })
    expect(() => transform(c, 'italic')).toThrow()
  })
  it('rejects a surrogate split', () =>
    expect(() => transform(capture('😀', 0, 1), 'bold')).toThrow())
  it('rejects partial combining and joined emoji graphemes', () => {
    expect(() => transform(capture('e\u0301', 0, 1), 'bold')).toThrow()
    expect(() => transform(capture('👩‍💻', 0, 2), 'italic')).toThrow()
  })
  it('keeps CRLF when changing multiple heading lines', () =>
    expect(result(capture('one\r\ntwo\r\n', 0, 8), 'heading3').text).toBe('### one\r\n### two\r\n'))
  it('toggles ATX headings without touching literal escaped hashes', () => {
    expect(result(capture('### title'), 'heading3').text).toBe('title')
    expect(result(capture('\\# literal'), 'heading1').text).toBe('# \\# literal')
  })
  it('toggles task markers and preserves item text', () => {
    expect(result(capture('- [x] done\n- [ ] todo'), 'task').text).toBe('done\ntodo')
    expect(result(capture('one\ntwo'), 'task').text).toBe('- [ ] one\n- [ ] two')
  })
  it('wraps quote blocks and removes one level', () => {
    expect(result(capture('> one\n> > two'), 'quote').text).toBe('one\n> two')
  })
  it('chooses a safe code delimiter for literal backticks', () =>
    expect(result(capture('a`b'), 'inlineCode').text).toBe('``a`b``'))
  it('does not accept unsafe link protocols', () =>
    expect(() => transform(capture('label'), 'link', 'javascript:alert(1)')).toThrow())
  it('encodes link destination punctuation without changing label Unicode', () =>
    expect(result(capture('中文'), 'link', 'https://example.com/a(b)').text).toBe(
      '[中文](https://example.com/a%28b%29)',
    ))
  it('uses a longer fenced-code delimiter when content contains a fence', () =>
    expect(result(capture('```\ntext'), 'fence').text).toBe('````\n```\ntext\n````'))
  it('rejects partial nested block conversion explicitly', () =>
    expect(() => transform(capture('> - nested'), 'heading1')).toThrow())
  it('rejects a selection crossing only one side of existing emphasis', () => {
    const c = capture('**bold** tail', 4, 11)
    c.syntax.nodes.push({
      type: 'strong',
      status: 'valid',
      from: 0,
      to: 8,
      markerRanges: [
        { from: 0, to: 2 },
        { from: 6, to: 8 },
      ],
      contentRanges: [{ from: 2, to: 6 }],
    })
    expect(() => transform(c, 'italic')).toThrow()
  })
  it('does not consume the previous line at a collapsed first-line cursor', () => {
    expect(result(capture('one\ntwo', 0, 0), 'heading1').text).toBe('# one\ntwo')
  })
  it('toggles ATX closing markers along with its opening prefix', () => {
    expect(result(capture('### title ###'), 'heading3').text).toBe('title')
  })
  it('formats an empty first line without affecting its following line', () =>
    expect(result(capture('\nnext', 0, 0), 'heading2').text).toBe('## \nnext'))
  it('removes whole fence lines including language info and preserves code content', () => {
    const c = capture('```js\r\nconst x = 1\r\n```\r\n')
    c.syntax.context = 'code'
    c.syntax.nodes.push({
      type: 'fencedCode',
      status: 'valid',
      from: 0,
      to: c.text.length,
      markerRanges: [
        { from: 0, to: 3 },
        { from: 20, to: 23 },
      ],
      contentRanges: [{ from: 7, to: 20 }],
    })
    expect(result(c, 'fence').text).toBe('const x = 1\r\n')
  })
  it('preserves mixed line endings while prefixing their actual offsets', () =>
    expect(result(capture('one\ntwo\r\nthree'), 'bullet').text).toBe('- one\n- two\r\n- three'))
  it('updates an existing selected link label through its CST destination range', () => {
    const c = capture('[word](old.md)', 1, 5)
    c.syntax.nodes.push({
      type: 'link',
      status: 'valid',
      from: 0,
      to: 14,
      markerRanges: [
        { from: 0, to: 1 },
        { from: 5, to: 7 },
        { from: 13, to: 14 },
      ],
      contentRanges: [
        { from: 1, to: 5 },
        { from: 7, to: 13 },
      ],
    })
    expect(result(c, 'link', './new.md').text).toBe('[word](./new.md)')
    expect(result(c, 'unlink').text).toBe('word')
  })
  it('adds valid nested emphasis inside a complete strong content range', () => {
    const c = capture('**word**', 2, 6)
    c.syntax.nodes.push({
      type: 'strong',
      status: 'valid',
      from: 0,
      to: 8,
      markerRanges: [
        { from: 0, to: 2 },
        { from: 6, to: 8 },
      ],
      contentRanges: [{ from: 2, to: 6 }],
    })
    expect(result(c, 'italic').text).toBe('***word***')
  })
  it('coalesces large line edits into the public 64-change budget', () => {
    const c = capture(Array(100).fill('line').join('\n'))
    const edit = transform(c, 'quote')
    expect(edit.changes.length).toBeLessThanOrEqual(64)
    expect(result(c, 'quote').text).toBe(Array(100).fill('> line').join('\n'))
  })
})

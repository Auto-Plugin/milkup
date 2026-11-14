import { describe, it, expect } from 'vitest'
import type { SdkDocumentPresentationRequest } from '@milkup/plugin-sdk'
import { renderMathDocument } from './renderer'
function request(
  source: string,
  overrides: Partial<SdkDocumentPresentationRequest> = {},
): SdkDocumentPresentationRequest {
  return {
    documentId: 'doc',
    version: 1,
    source,
    from: 0,
    to: source.length,
    fromLine: 1,
    toLine: source.split('\n').length,
    completeStart: true,
    completeEnd: true,
    contextKnown: true,
    protectedRanges: [],
    blocks: [
      {
        kind: 'text',
        complete: true,
        from: 0,
        to: source.length,
        contentRanges: [{ from: 0, to: source.length }],
      },
    ],
    selection: { anchor: 0, head: 0 },
    theme: 'light',
    target: 'screen',
    width: 760,
    ...overrides,
  }
}
const render = (source: string, overrides: Partial<SdkDocumentPresentationRequest> = {}) =>
  renderMathDocument(request(source, overrides), { signal: new AbortController().signal })
describe('context-bound math discovery', () => {
  it('finds inline Unicode expressions without changing source offsets', () => {
    const source = '中文🙂 $α+1$ and $x_1$.'
    const result = render(source)
    expect(result.fragments.map((x) => source.slice(x.from, x.to))).toEqual(['$α+1$', '$x_1$'])
    expect(result.fragments.every((x) => x.status === 'ready' && x.layout === 'inline')).toBe(true)
  })
  it.each(['cost $5 and $10', String.raw`\$x$`, '$ x$', '$x $', '$x$2', '$$x$$', '$unfinished'])(
    'keeps ambiguous currency/escaped/unclosed literal %s',
    (source) => expect(render(source).fragments).toEqual([]),
  )
  it('excludes protected code and link target ranges', () => {
    const source = '`$code$` [link]($target$) $yes$'
    expect(
      render(source, {
        protectedRanges: [
          { from: 0, to: 8 },
          { from: 15, to: 24 },
        ],
      }).fragments.map((x) => source.slice(x.from, x.to)),
    ).toEqual(['$yes$'])
  })
  it('never guesses opaque contexts or incomplete document edges', () => {
    expect(render('$x$', { contextKnown: false }).fragments).toEqual([])
    expect(render('$$\nx\n$$', { completeStart: false }).fragments).toEqual([])
    expect(
      render('$x$', {
        blocks: [{ kind: 'unknown', complete: false, from: 0, to: 3, contentRanges: [] }],
      }).fragments,
    ).toEqual([])
  })
  it('finds a standalone multiline block across trusted paragraphs and CRLF', () => {
    const source = '$$\r\n\\frac{x}{y}\r\n\r\n+1\r\n$$\r\n'
    const result = render(source)
    expect(result.fragments).toHaveLength(1)
    expect(result.fragments[0]).toMatchObject({ layout: 'block', status: 'ready' })
    expect(source.slice(result.fragments[0]!.from, result.fragments[0]!.to)).toBe(
      source.slice(0, -2),
    )
  })
  it('keeps the entire unclosed display body literal', () => {
    expect(render('$$\nx + $y$').fragments).toEqual([])
  })
  it('does not cross opaque or protected regions for block math', () => {
    const source = '$$\nx\n$$'
    expect(render(source, { protectedRanges: [{ from: 3, to: 4 }] }).fragments).toEqual([])
  })
  it('uses only complete declared math fences', () => {
    const source = '```math\n\\sqrt{x}\n```'
    const fence = {
      kind: 'fence' as const,
      complete: true,
      from: 0,
      to: source.length,
      info: 'math',
      contentRanges: [{ from: 8, to: 16 }],
    }
    expect(
      render(source, { blocks: [fence], protectedRanges: [{ from: 0, to: source.length }] })
        .fragments[0],
    ).toMatchObject({ from: 0, to: source.length, layout: 'block', status: 'ready' })
    expect(render(source, { blocks: [{ ...fence, complete: false }] }).fragments).toEqual([])
    expect(render(source, { blocks: [{ ...fence, info: 'javascript' }] }).fragments).toEqual([])
  })
  it('handles absolute UTF16 offsets', () => {
    const source = '$x$'
    const result = render(source, {
      from: 100,
      to: 103,
      blocks: [
        {
          kind: 'text',
          complete: true,
          from: 100,
          to: 103,
          contentRanges: [{ from: 100, to: 103 }],
        },
      ],
    })
    expect(result.fragments[0]).toMatchObject({ from: 100, to: 103 })
  })
  it('returns accessible source fallback for unsafe and oversized formulas', () => {
    for (const source of [String.raw`$\href{https://x}{x}$`, '$' + 'x'.repeat(8193) + '$']) {
      const result = render(source)
      expect(result.fragments[0]).toMatchObject({
        status: 'error',
        content: { type: 'text', text: source },
      })
      expect(result.fragments[0]?.message).toBeTruthy()
      expect(result.fragments[0]!.accessibleText.length).toBeLessThanOrEqual(8192)
    }
  })
  it('scans a near-limit malformed delimiter stream in one pass', () => {
    expect(render('$x '.repeat(21000)).fragments).toEqual([])
    const source = '$5 and $10 then $x$'
    expect(render(source).fragments.map((x) => source.slice(x.from, x.to))).toEqual(['$x$'])
  })
  it('honors cancellation and fragment budget', () => {
    const controller = new AbortController()
    controller.abort()
    expect(renderMathDocument(request('$x$'), { signal: controller.signal }).fragments).toEqual([])
    const result = render(Array(200).fill('$x$').join(' '))
    expect(result.fragments.length).toBeLessThanOrEqual(128)
    expect(result.complete).toBe(false)
  })
})

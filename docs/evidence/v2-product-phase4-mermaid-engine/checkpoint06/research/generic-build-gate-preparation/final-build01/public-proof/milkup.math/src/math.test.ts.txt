import { describe, it, expect, vi } from 'vitest'
import { renderFormula } from './math'
import { parseMathMarkup } from './mathml'

describe('isolated KaTeX MathML', () => {
  it.each([
    String.raw`\frac{x_1^2}{\sqrt[3]{y}}`,
    String.raw`\int_0^\infty x\,dx=\sum_{i=1}^n i`,
    String.raw`\begin{pmatrix}a&b\\c&d\end{pmatrix}`,
    String.raw`\begin{aligned}a&=b+c\\x&=y\end{aligned}`,
    String.raw`\begin{cases}x&x>0\\-x&x\le0\end{cases}`,
    String.raw`\hat{x}+\bar{y}+\overline{z}`,
    String.raw`\quad x`,
    'α+β≤∞',
    String.raw`\text{中文}`,
  ])('preserves supported formula %s', (source) => {
    expect(renderFormula(source, true).tag).toBe('math')
  })
  it.each([
    String.raw`\href{https://example.com}{x}`,
    String.raw`\url{file:///tmp/a}`,
    String.raw`\includegraphics{https://example.com/x.png}`,
    String.raw`\htmlStyle{background:url(x)}{x}`,
    String.raw`\htmlClass{x}{y}`,
    String.raw`\def\x{\href{https://x}{x}}\x`,
    String.raw`\gdef\x{\x}\x`,
    String.raw`\color{red}{x}`,
    String.raw`\boxed{x}`,
    '🙂',
    '\\unknown',
  ])('rejects unsafe or unsupported formula %s', (source) => {
    expect(() => renderFormula(source, false)).toThrow()
  })
  it('does not call ambient network while rejecting resource commands', () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      throw new Error('network forbidden')
    })
    try {
      expect(() =>
        renderFormula(String.raw`\includegraphics{https://example.com/image.png}`, false),
      ).toThrow()
      expect(fetch).not.toHaveBeenCalled()
    } finally {
      fetch.mockRestore()
    }
  })
  it('preserves matrix alignment and script style as typed attributes', () => {
    const result = renderFormula(String.raw`\begin{aligned}a&=b+c\\x&=y\end{aligned}`, true)
    const table = result.children![0]!
    expect(table).toMatchObject({
      tag: 'mtable',
      attributes: { rowSpacingEm: [0.25], columnAlign: ['right', 'left'], columnSpacingEm: [0] },
    })
    expect(table.children![0]!.children![0]!.children![0]).toMatchObject({
      tag: 'mstyle',
      attributes: { scriptLevel: 0, displayStyle: true },
    })
  })
  it('bounds input and recursive braces', () => {
    expect(() => renderFormula('a'.repeat(8193), false)).toThrow()
    expect(() => renderFormula('{'.repeat(65) + 'x' + '}'.repeat(65), false)).toThrow()
  })
  it('never shares document macros', () => {
    renderFormula(String.raw`\gdef\abc{x}\abc`, false)
    expect(() => renderFormula(String.raw`\abc`, false)).toThrow()
  })
  it('keeps literal XML-like source inert', () => {
    const result = renderFormula(String.raw`\text{<script>}`, false)
    expect(JSON.stringify(result)).toContain('<script>')
    expect(JSON.stringify(result)).not.toContain('"tag":"script"')
  })
})

describe('bounded XML conversion', () => {
  const wrap = (body: string) =>
    `<span class="katex"><math xmlns="http://www.w3.org/1998/Math/MathML"><semantics>${body}<annotation encoding="application/x-tex">x</annotation></semantics></math></span>`
  it('accepts exact generated wrappers and standard entities', () => {
    expect(parseMathMarkup(wrap('<mrow><mi>&lt;&amp;&#x3B1;</mi></mrow>'), 'x')).toMatchObject({
      tag: 'math',
      children: [{ tag: 'mrow', children: [{ tag: 'mi', text: '<&α' }] }],
    })
  })
  it.each([
    '<script>x</script>',
    '<mi onclick="evil">x</mi>',
    '<mi xmlns="evil">x</mi>',
    '<mi href="https://x">x</mi>',
    '<mrow><mi>x</mrow>',
    '<mi>&custom;</mi>',
    '<mi>&#0;</mi>',
    '<mrow><mi>x</mi>text</mrow>',
    '<mi>\u0000</mi>',
    '<mi>\uD800</mi>',
  ])('rejects entire invalid tree %s', (body) => {
    expect(() => parseMathMarkup(wrap(body), 'x')).toThrow()
  })
  it('rejects declarations, extra roots, annotation mismatches and attributes', () => {
    for (const input of [
      '<!DOCTYPE math>' + wrap('<mi>x</mi>'),
      '<?xml version="1.0"?>' + wrap('<mi>x</mi>'),
      wrap('<mi>x</mi>') + '<math/>',
      wrap('<mi>x</mi>').replace('>x</annotation>', '>different</annotation>'),
      wrap('<mi x="1">x</mi>'),
    ])
      expect(() => parseMathMarkup(input, 'x')).toThrow()
  })
  it('bounds output, depth, number lists and dimensions', () => {
    for (const body of [
      '<mrow>'.repeat(65) + '<mi>x</mi>' + '</mrow>'.repeat(65),
      '<mrow>' + '<mi>x</mi>'.repeat(4097) + '</mrow>',
      '<mtable rowspacing="21em"></mtable>',
      '<mspace width="-1em"></mspace>',
    ])
      expect(() => parseMathMarkup(wrap(body), 'x')).toThrow()
    expect(() => parseMathMarkup('x'.repeat(262145), 'x')).toThrow()
  })
})

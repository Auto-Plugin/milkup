import { describe, expect, it } from 'vitest'
import * as api from './index'

// Regression evidence: the old serializer has neither a static contract nor safe URLs.
describe('static document export regressions', () => {
  it('exposes the controlled static conversion entry point', () => {
    expect(api).toHaveProperty('renderStaticMarkdownDocument')
  })
  it('does not emit executable link URLs through the legacy entry point', () => {
    expect(api.renderMarkdownDocumentHtml('[bad](javascript:alert)')).not.toContain(
      'href="javascript:',
    )
  })
  it('preserves strikethrough semantics in legacy Markdown export', () => {
    expect(api.renderMarkdownDocumentHtml('~~removed~~')).toContain('<del>removed</del>')
  })
})

import {
  copyDocumentPresentationNode,
  type DocumentPresentationFragment as Fragment,
  type DocumentPresentationNode as Node,
} from '@milkup/core'
import {
  collectMarkdownImageResources,
  renderStaticMarkdownDocument as render,
  STATIC_EXPORT_LIMITS,
  type ExportPresentationBatch,
} from './static-html'
const options = { documentId: 'doc', version: 1 }
function batch(source: string, fragments: readonly Fragment[], base = 0): ExportPresentationBatch {
  return {
    request: {
      ...options,
      source,
      from: base,
      to: base + source.length,
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
          from: base,
          to: base + source.length,
          contentRanges: [{ from: base, to: base + source.length }],
        },
      ],
      selection: { anchor: base, head: base },
      theme: 'light',
      target: 'export',
      width: 760,
    },
    result: { complete: true, fragments },
    declarations: [{ id: 'test', contexts: ['text'] }],
  }
}
const fragment = (
  from: number,
  to: number,
  content: Node,
  layout: 'inline' | 'block' = 'inline',
): Fragment => ({ from, to, content, layout, accessibleText: '呈现' })
const math = (display = false): Node => ({
  type: 'math',
  tree: {
    tag: 'math',
    attributes: { display: display ? 'block' : 'inline' },
    children: [
      {
        tag: 'msup',
        children: [
          { tag: 'mi', text: '中' },
          { tag: 'mn', text: '2' },
        ],
      },
    ],
  },
})
const ref = (label: string, from: number, to: number): Node => ({
  type: 'reference',
  label,
  target: { ...options, from, to },
})
const svg = () =>
  copyDocumentPresentationNode({
    type: 'svg-image',
    profile: 'bounded-svg-v1',
    motion: 'static',
    width: 160,
    height: 96,
    rasterBounds: [0, 0, 160, 96],
    viewBox: [0, 0, 160, 96],
    aspect: { align: 'xMidYMid', fit: 'meet' },
    title: '图表',
    styles: [{ filter: { kind: 'unresolved-local' } }],
    definitions: [],
    children: [{ kind: 'rect', x: 4, y: 8, width: 80, height: 40, style: 0 }],
  })

describe('controlled static HTML document', () => {
  it('preserves Chinese, normal Markdown, tables, code and fixed print policy', () => {
    const source =
      '# 中文\n\n**粗体** *斜体* ~~删除~~\n\n| 中文 | 值 |\n| --- | ---: |\n| 测试 | 42 |\n\n```js\n<script>\n```'
    const result = render(source, {
      ...options,
      title: '中文 <title>',
      pageSize: 'letter',
      landscape: true,
    })
    for (const text of [
      '<h1>中文</h1>',
      '<strong>粗体</strong> <em>斜体</em> <del>删除</del>',
      '<table><thead>',
      'text-align:right',
      '&lt;script&gt;',
      'size:letter landscape',
      'table-header-group',
      'white-space:pre-wrap',
      'Content-Security-Policy',
    ])
      expect(result.html).toContain(text)
    expect(result.html).not.toContain('<script>')
    expect(result.warnings).toEqual([])
  })
  it('splices validated inline MathML inside emphasis without losing surrounding text', () => {
    const source = '前 **公式 $x^2$ 后** 文',
      from = source.indexOf('$'),
      to = source.lastIndexOf('$') + 1
    const result = render(source, {
      ...options,
      presentations: [batch(source, [fragment(from, to, math())])],
    })
    for (const text of [
      '前 <strong>公式 <span',
      '<msup><mi>中</mi><mn>2</mn></msup>',
      '</span> 后</strong> 文',
    ])
      expect(result.html).toContain(text)
    expect(result.warnings).toEqual([])
  })
  it('replaces display math across paragraphs without nesting blocks in paragraphs', () => {
    const source = '$$\n\nx^2\n\n$$\n\n尾部',
      end = source.lastIndexOf('$$') + 2
    const result = render(source, {
      ...options,
      presentations: [batch(source, [fragment(0, end, math(true), 'block')])],
    })
    expect(result.html).toContain('<body><div id="source-0"')
    expect(result.html).toContain('<p>尾部</p>')
    expect(result.html).not.toContain('<p><div')
    expect(result.warnings).toEqual([])
  })
  it('uses distinct SVG IDs for separately serialized fragments', () => {
    const source = 'first\n\nsecond'
    const result = render(source, {
      ...options,
      presentations: [
        batch(source, [fragment(0, 5, svg(), 'block'), fragment(7, 13, svg(), 'block')]),
      ],
    })
    const ids = [...result.html.matchAll(/id="([^"]+)"/g)].map((match) => match[1])
    expect(new Set(ids).size).toBe(ids.length)
    expect(result.html).toContain('export-svg-0-0-unresolved-filter')
    expect(result.html).toContain('export-svg-1-0-unresolved-filter')
  })
  it('keeps selection absolute offsets and footnote forward/back links', () => {
    const source = '引用[^a]\n\n[^a]: 正文',
      base = 100
    const start = base + source.indexOf('[^a]'),
      definition = base + source.lastIndexOf('[^a]')
    const result = render(source, {
      ...options,
      sourceOffset: base,
      presentations: [
        batch(
          source,
          [
            fragment(start, start + 4, {
              type: 'sup',
              children: [ref('1', definition, base + source.length)],
            }),
            fragment(definition, definition + 5, {
              type: 'group',
              children: [{ type: 'text', text: '[1] ' }, ref('返回', start, start + 4)],
            }),
          ],
          base,
        ),
      ],
    })
    expect(result.html).toContain(`href="#source-${definition}"`)
    expect(result.html).toContain(`href="#source-${start}"`)
    expect(result.html).toContain('正文')
    expect(result.warnings).toEqual([])
  })
  it('keeps renderer error source byte-for-byte instead of its substitute', () => {
    const source = '$\\unsupported{a}$'
    const result = render(source, {
      ...options,
      presentations: [
        batch(source, [
          {
            ...fragment(0, source.length, { type: 'text', text: 'wrong substitute' }),
            status: 'error',
            message: 'unsupported',
          },
        ]),
      ],
    })
    expect(result.html).toContain(source)
    expect(result.html).not.toContain('wrong substitute')
    expect(result.warnings).toEqual([
      expect.objectContaining({ code: 'renderer-error', message: 'unsupported' }),
    ])
  })
  it('preserves absent math/footnote/diagram renderers with explicit warnings', () => {
    const source = '$\\frac{a}{b}$\n\n引用[^a]\n\n[^a]: 内容\n\n```mermaid\ngraph TD; A-->B\n```'
    const result = render(source, options)
    for (const text of ['$\\frac{a}{b}$', '[^a]: 内容', '```mermaid'])
      expect(result.html).toContain(text)
    expect(result.warnings.some((w) => w.code === 'unrendered-enhancement')).toBe(true)
  })
  it('preserves unsupported nested source explicitly', () => {
    const result = render('> ```mermaid\n> graph TD; A-->B\n> ```\n\n- outer\n  - inner', options)
    expect(result.html).toContain('&gt; ```mermaid')
    expect(result.html).toContain('- outer\n  - inner')
    expect(result.warnings.filter((w) => w.code === 'unsupported-nesting')).toHaveLength(2)
  })
  it('enumerates real image uses excluding code and embeds offline data', () => {
    const source = '![中文](assets/a.png)\n\n`![code](x.png)`\n\n```md\n![code](y.png)\n```'
    expect(collectMarkdownImageResources(source)).toEqual([
      { url: 'assets/a.png', from: 0, to: 19 },
    ])
    const result = render(source, { ...options, resolveUrl: () => 'data:image/png;base64,AQID' })
    expect(result.html).toContain('<img src="data:image/png;base64,AQID" alt="中文">')
    expect(result.warnings).toEqual([])
  })
  it.each([
    '',
    'https://example.com/x.png',
    'data:image/svg+xml;base64,PHN2Zz4=',
    'data:text/html;base64,eA==',
  ])('reports missing/remote/unsafe images: %s', (url) => {
    const result = render('![image](relative.png)', { ...options, resolveUrl: () => url })
    expect(result.html).not.toContain('<img')
    expect(result.html).toContain('![image](relative.png)')
    expect(result.warnings[0]?.code).toBe('image-unavailable')
  })
  it('does not read image resources when omitted', () => {
    const result = render('![image](a.png)', {
      ...options,
      imageMode: 'omit',
      resolveUrl: () => {
        throw Error('unexpected')
      },
    })
    expect(result.warnings[0]?.code).toBe('image-omitted')
  })
  it.each([
    'javascript:alert',
    'data:text/html;base64,eA==',
    'file:///tmp/private',
    'https:\\evil',
  ])('rejects unsafe static link %s', (url) => {
    const result = render('[label](safe)', { ...options, resolveUrl: () => url })
    expect(result.html).not.toContain('<a href')
    expect(result.html).toContain('[label](safe)')
    expect(result.warnings[0]?.code).toBe('unsafe-or-unresolved-link')
  })
  it('rejects stale identity, mismatched source, overlap and raw HTML injection', () => {
    const source = '$x$',
      good = batch(source, [fragment(0, 3, math())])
    expect(() => render(source, { ...options, version: 2, presentations: [good] })).toThrow(
      'snapshot mismatch',
    )
    expect(() => render('$y$', { ...options, presentations: [good] })).toThrow('snapshot mismatch')
    expect(() => render(source, { ...options, presentations: [good, good] })).toThrow('Overlapping')
    const bad = batch(source, [
      fragment(0, 3, { type: 'html', html: '<script>x</script>' } as unknown as Node),
    ])
    expect(() => render(source, { ...options, presentations: [bad] })).toThrow()
  })
  it('rejects budgets without truncating output', () => {
    expect(() => render('a'.repeat(STATIC_EXPORT_LIMITS.sourceUtf16 + 1), options)).toThrow('limit')
    const huge = 'data:image/png;base64,' + 'AAAA'.repeat(STATIC_EXPORT_LIMITS.imageBytes / 4)
    expect(() => render('![x](a)', { ...options, resolveUrl: () => huge })).toThrow('limit')
  })
})

it('keeps a partial block presentation as source with a visible boundary warning', () => {
  const source = 'before $$x$$ after'
  const result = render(source, {
    ...options,
    presentations: [batch(source, [fragment(7, 12, math(true), 'block')])],
  })
  expect(result.html).toContain(source)
  expect(result.html).not.toContain('<math')
  expect(result.html).toContain('导出警告')
  expect(result.warnings.some((w) => w.code === 'presentation-boundary')).toBe(true)
})
it('reports footnote references outside the selected snapshot without a broken link', () => {
  const source = '[^a]'
  const result = render(source, {
    ...options,
    sourceOffset: 100,
    presentations: [batch(source, [fragment(100, 104, ref('1', 0, 10))], 100)],
  })
  expect(result.html).not.toContain('href="#source-0"')
  expect(result.warnings[0]?.code).toBe('reference-outside-export')
})
it('does not enumerate image syntax inside raw HTML source fallback', () => {
  expect(collectMarkdownImageResources('<div>\n![x](private.png)\n</div>')).toEqual([])
})
it('escapes mixed case style termination through the legacy API', () => {
  const result = api.renderMarkdownDocumentHtml('text', {
    themeStyles: '</StYlE><script>x</script>',
  })
  expect(result).not.toContain('</StYlE>')
})
it('keeps four-space nested list continuations together instead of reclassifying them as code', () => {
  const source = '- outer\n    - inner\n\n    continuation\n\nEnd'
  const result = render(source, options)
  expect(result.html).toContain('- outer\n    - inner\n\n    continuation')
  expect(result.html).toContain('<p>End</p>')
  expect(result.warnings.some((w) => w.code === 'unsupported-nesting')).toBe(true)
})
it('preserves line boundaries in indented code in both serializers', () => {
  const source = '    first()\n    second()'
  expect(render(source, options).html).toContain('<pre><code>first()\nsecond()</code></pre>')
  expect(api.renderMarkdownDocumentHtml(source)).toContain(
    '<pre><code>first()\nsecond()</code></pre>',
  )
})

describe('print heading leads', () => {
  it('groups a valid heading with only its first following paragraph across blank lines', () => {
    const source = '# 中文标题 👩🏽‍💻\n\n\n首段 é 与中文。\n\n第二段保留。'
    const result = render(source, options)
    expect(result.html).toContain(
      '<div class="heading-lead"><h1>中文标题 👩🏽‍💻</h1><p>首段 é 与中文。</p></div><p>第二段保留。</p>',
    )
    expect(result.warnings).toEqual([])
  })
  it('preserves inline presentation and absolute footnote anchors inside a grouped paragraph', () => {
    const source = '## 脚注\n\n公式 $x$ 引用[^a]\n\n[^a]: 正文',
      base = 500
    const mathFrom = base + source.indexOf('$'),
      refFrom = base + source.indexOf('[^a]'),
      defFrom = base + source.lastIndexOf('[^a]')
    const result = render(source, {
      ...options,
      sourceOffset: base,
      presentations: [
        batch(
          source,
          [
            fragment(mathFrom, mathFrom + 3, math()),
            fragment(refFrom, refFrom + 4, {
              type: 'sup',
              children: [ref('1', defFrom, base + source.length)],
            }),
            fragment(defFrom, defFrom + 5, {
              type: 'group',
              children: [{ type: 'text', text: '[1] ' }, ref('返回', refFrom, refFrom + 4)],
            }),
          ],
          base,
        ),
      ],
    })
    expect(result.html).toContain('<div class="heading-lead"><h2>脚注</h2><p>公式 ')
    expect(result.html).toContain(`<span id="source-${mathFrom}"`)
    expect(result.html).toContain(`<a href="#source-${defFrom}">1</a>`)
    expect(result.html).toContain(`<a href="#source-${refFrom}">返回</a>`)
    expect(result.html).toContain('</p></div><p>')
    expect(result.html.match(/<math /g)).toHaveLength(1)
    expect(result.warnings).toEqual([])
  })
  it('does not take a block presentation spanning several paragraphs into the heading group', () => {
    const source = '## 公式\n\n$$\n\nx^2\n\n$$\n\n尾段'
    const from = source.indexOf('$$'),
      to = source.lastIndexOf('$$') + 2
    const result = render(source, {
      ...options,
      presentations: [batch(source, [fragment(from, to, math(true), 'block')])],
    })
    expect(result.html).toContain('<body><h2>公式</h2><div id=')
    expect(result.html.match(/<math /g)).toHaveLength(1)
    expect(result.html).toContain('<p>尾段</p>')
    expect(result.html).not.toContain('<div class="heading-lead">')
    expect(result.warnings).toEqual([])
  })
  it.each(['## 第二标题', '> 引用', '---', ''])(
    'does not bind other blocks or an empty tail: %s',
    (tail) => {
      const result = render('# 标题\n\n' + tail, options)
      expect(result.html).not.toContain('<div class="heading-lead">')
      expect(result.html).toContain('<h1>标题</h1>')
    },
  )
  it.each([
    ['table', '| 项目 | 值 |\n| --- | --- |\n| 中文 | 1 |'],
    ['fenced code', '```ts\nconst 中文 = "<&>";\n```'],
    ['indented code', '    first()\n    second()'],
    ['unordered list', '- 中文 👩🏽‍💻\n- 第二项'],
    ['ordered list', '7. 中文 é\n8. 第二项'],
  ])('groups only one complete %s unit and preserves its original rendering', (_name, tail) => {
    const result = render('# 标题\n\n' + tail + '\n\n后段', options)
    const original = render(tail, options).html.match(/<body>([\s\S]*?)<\/body>/)![1]
    expect(result.html).toContain(
      `<div class="heading-lead"><h1>标题</h1>${original}</div><p>后段</p>`,
    )
    expect(result.warnings).toEqual([])
  })
  it.each(['| 公式 | 脚注 |\n| --- | --- |\n| $x$ | [^a] |', '7. 公式 $x$\n8. 引用[^a]'])(
    'keeps inline presentation and bidirectional absolute anchors inside table/list units',
    (tail) => {
      const source = '# 标题\n\n' + tail + '\n\n[^a]: 正文'
      const base = 700,
        mathFrom = base + source.indexOf('$'),
        refFrom = base + source.indexOf('[^a]'),
        defFrom = base + source.lastIndexOf('[^a]')
      const result = render(source, {
        ...options,
        sourceOffset: base,
        presentations: [
          batch(
            source,
            [
              fragment(mathFrom, mathFrom + 3, math()),
              fragment(refFrom, refFrom + 4, ref('1', defFrom, base + source.length)),
              fragment(defFrom, defFrom + 5, ref('返回', refFrom, refFrom + 4)),
            ],
            base,
          ),
        ],
      })
      expect(result.html).toContain('<div class="heading-lead"><h1>标题</h1>')
      expect(result.html).toContain(`href="#source-${defFrom}"`)
      expect(result.html).toContain(`href="#source-${refFrom}"`)
      expect(result.html).toContain('</div><p>')
      expect(result.html.match(/<math /g)).toHaveLength(1)
      for (const offset of [mathFrom, refFrom, defFrom])
        expect(result.html.split(`id="source-${offset}"`)).toHaveLength(2)
      expect(result.warnings).toEqual([])
    },
  )
  it.each([
    '| 项目 | 值 |\n| --- | --- |\n' +
      Array.from({ length: 60 }, (_, i) => `| 项${i} | 值${i} |`).join('\n'),
    '```ts\n' + Array.from({ length: 80 }, (_, i) => `line${i}();`).join('\n') + '\n```',
    Array.from({ length: 80 }, (_, i) => `${i + 7}. 项${i}`).join('\n'),
  ])(
    'does not split or duplicate long units while applying the same soft grouping policy',
    (tail) => {
      const original = render(tail, options).html.match(/<body>([\s\S]*?)<\/body>/)![1]
      const result = render('# 标题\n\n' + tail + '\n\n尾段', options)
      expect(result.html).toContain(
        `<div class="heading-lead"><h1>标题</h1>${original}</div><p>尾段</p>`,
      )
      expect(result.warnings).toEqual([])
    },
  )
  it('keeps nested list continuation fallback consumption and absolute offsets unchanged after a heading', () => {
    const nested = '- outer 👩🏽‍💻\n    - inner <tag>\n\n    continuation é'
    const source = '# 标题\n\n' + nested + '\n\n尾段 $x$'
    const base = 900,
      from = base + source.indexOf('$')
    const result = render(source, {
      ...options,
      sourceOffset: base,
      presentations: [batch(source, [fragment(from, from + 3, math())], base)],
    })
    const listFrom = source.indexOf('- outer')
    const previous = render(source.slice(listFrom), {
      ...options,
      sourceOffset: base + listFrom,
      presentations: [
        batch(source.slice(listFrom), [fragment(from, from + 3, math())], base + listFrom),
      ],
    })
    expect(result.html).toContain(
      '<h1>标题</h1><pre class="source-fallback">' + nested.replace('<tag>', '&lt;tag&gt;'),
    )
    expect(result.html).not.toContain('<div class="heading-lead">')
    expect(result.html).not.toContain('<ul><li>outer')
    expect(result.html).not.toContain('<pre><code>')
    expect(result.html.match(/<math /g)).toHaveLength(1)
    expect(result.html).toContain(`id="source-${from}"`)
    expect(result.warnings).toEqual(previous.warnings)
    expect(result.warnings).toEqual([
      expect.objectContaining({ code: 'unsupported-nesting', from: base + listFrom }),
    ])
  })
  it.each([
    ['- outer 👩🏽‍💻\n  - inner é', 'unsupported-nesting'],
    ['- outer <tag>\n- second', 'unsupported-nesting'],
    ['- ```ts\n- value\n- ```', 'unsupported-nesting'],
    ['```mermaid\ngraph TD; A-->B\n```', 'unrendered-enhancement'],
    ['```math\nx^2\n```', 'unrendered-enhancement'],
  ])(
    'preserves single-block source fallback and offsets without claiming nested/enhanced support: %s',
    (tail, code) => {
      const prefix = '# 标题\n\n',
        base = 1200
      const previous = render(tail, { ...options, sourceOffset: base + prefix.length })
      const result = render(prefix + tail, { ...options, sourceOffset: base })
      const originalBody = previous.html.match(/<body>([\s\S]*?)<aside /)![1]
      expect(result.html).toContain(`<div class="heading-lead"><h1>标题</h1>${originalBody}</div>`)
      expect(result.html).toContain('<pre class="source-fallback">')
      expect(result.html).not.toContain('<ul><li>outer')
      expect(result.html).not.toContain('<pre><code>')
      expect(result.html).not.toContain('<math ')
      expect(result.html).not.toContain('<svg ')
      expect(result.warnings).toEqual(previous.warnings)
      expect(result.warnings).toEqual([
        expect.objectContaining({
          code,
          from: base + prefix.length,
          to: base + prefix.length + tail.length,
        }),
      ])
    },
  )
  it.each([
    '| 项目 | 值 |\n| --- | --- |\n| 中文 | 1 |',
    '```ts\ncode();\n```',
    '- first\n- second',
  ])('preserves block presentation ownership instead of grouping its Markdown unit', (tail) => {
    const source = '# 标题\n\n' + tail + '\n\n尾段',
      from = source.indexOf(tail)
    const result = render(source, {
      ...options,
      presentations: [batch(source, [fragment(from, from + tail.length, svg(), 'block')])],
    })
    expect(result.html).not.toContain('<div class="heading-lead">')
    expect(result.html.match(/class="presentation-block"/g)).toHaveLength(1)
    expect(result.html).toContain('<h1>标题</h1><div id=')
    expect(result.html).toContain('<p>尾段</p>')
    expect(result.warnings).toEqual([])
  })
  it('retains missing-renderer source and absolute warning offsets inside the first paragraph', () => {
    const source = '## 公式\n\n$\\unsupported{x}$',
      base = 80
    const result = render(source, { ...options, sourceOffset: base })
    expect(result.html).toContain(
      '<div class="heading-lead"><h2>公式</h2><p><span class="source-fallback">$\\unsupported{x}$</span></p></div>',
    )
    expect(result.warnings).toEqual([
      expect.objectContaining({
        code: 'unrendered-enhancement',
        from: base + source.indexOf('$'),
        to: base + source.length,
      }),
    ])
  })
  it('adds only fixed screen and print grouping policies with warning containment', () => {
    const result = render('# 标题\n\n正文', options)
    expect(result.html).toContain('.heading-lead{display:contents}')
    expect(result.html).toContain(
      '.heading-lead{display:block;break-inside:avoid;page-break-inside:avoid}',
    )
    expect(result.html).toContain(
      'aside.export-warning{break-inside:avoid;page-break-inside:avoid}',
    )
  })
})

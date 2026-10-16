import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SdkDocumentPresentationRequest, SdkDocumentSvgImage } from '@milkup/plugin-sdk'

const mocked = vi.hoisted(() => ({ initialize: vi.fn(), render: vi.fn(), convert: vi.fn() }))
vi.mock('mermaid', () => ({ default: { initialize: mocked.initialize, render: mocked.render } }))
vi.mock('./svg-converter', () => ({
  convertSvgElement: mocked.convert,
  ConversionError: class extends Error {
    constructor(
      readonly code: string,
      message = 'untrusted converter diagnostic',
    ) {
      super(message)
    }
  },
}))
import { renderDocuments, prepareRenderer } from './renderer'
import { ConversionError } from './svg-converter'

function request(
  body = 'classDiagram\nAnimal <|-- Duck',
  from = 123,
): SdkDocumentPresentationRequest {
  const opening = '```mermaid\r\n',
    ending = '\r\n```\r\n'
  const source = opening + body + ending
  return {
    documentId: 'doc-a',
    version: 7,
    source,
    from,
    to: from + source.length,
    fromLine: 9,
    toLine: 9 + source.split('\n').length - 1,
    completeStart: true,
    completeEnd: true,
    contextKnown: true,
    protectedRanges: [],
    blocks: [
      {
        kind: 'fence',
        complete: true,
        info: 'mermaid',
        from,
        to: from + source.length,
        contentRanges: [{ from: from + opening.length, to: from + opening.length + body.length }],
      },
    ],
    selection: { anchor: from, head: from },
    theme: 'light',
    target: 'screen',
    width: 800,
  }
}
function image(): SdkDocumentSvgImage {
  return {
    type: 'svg-image',
    profile: 'bounded-svg-v1',
    motion: 'static',
    width: 100,
    height: 80,
    rasterBounds: [0, 0, 100, 80],
    viewBox: [0, 0, 100, 80],
    aspect: { align: 'none', fit: 'meet' },
    styles: [],
    definitions: [],
    children: [{ kind: 'rect', x: 2, y: 2, width: 90, height: 70 }],
    title: '原图标题 中文😀',
  }
}
const options = () => ({ signal: new AbortController().signal })
class RootSvg {}
class Container {
  style = { width: '' }
  innerHTML = ''
  removed = false
  root: RootSvg | null = new RootSvg()
  querySelector(selector: string) {
    expect(selector).toBe('svg')
    return this.root
  }
  remove() {
    this.removed = true
  }
}
let containers: Container[]
let fonts: { ready: Promise<unknown> }
beforeEach(() => {
  vi.clearAllMocks()
  containers = []
  fonts = { ready: Promise.resolve() }
  vi.stubGlobal('SVGSVGElement', RootSvg)
  vi.stubGlobal('document', {
    fonts,
    createElement(tag: string) {
      expect(tag).toBe('div')
      const value = new Container()
      containers.push(value)
      return value
    },
    body: { append: vi.fn() },
  })
  mocked.render.mockResolvedValue({
    svg: '<svg><text>原始</text></svg>',
    diagramType: 'class',
    bindFunctions: vi.fn(),
  })
  mocked.convert.mockImplementation(() => image())
})
afterEach(() => vi.unstubAllGlobals())

describe('official Mermaid document wrapper (mock engine; native layout tested separately)', () => {
  it('prepares fonts without parsing any document', async () => {
    let ready!: () => void
    fonts.ready = new Promise<void>((resolve) => {
      ready = resolve
    })
    let completed = false
    const pending = prepareRenderer().then(() => {
      completed = true
    })
    await Promise.resolve()
    expect(completed).toBe(false)
    expect(mocked.render).not.toHaveBeenCalled()
    ready()
    await pending
    expect(completed).toBe(true)
  })
  it('preserves exact CRLF/Unicode source offsets and returns only typed image data', async () => {
    const input = request('classDiagram\nclass 账户\n账户 : +String 中文😀é'),
      before = structuredClone(input)
    const result = await renderDocuments(input, options())
    expect(input).toEqual(before)
    expect(result).toMatchObject({
      complete: true,
      fragments: [
        { from: input.from, to: input.to, status: 'ready', layout: 'block', content: image() },
      ],
    })
    expect(mocked.render.mock.calls[0]?.[1]).toBe(
      'classDiagram\nclass 账户\n账户 : +String 中文😀é',
    )
    expect(containers[0]?.style.width).toBe('800px')
    expect(containers[0]?.removed).toBe(true)
    expect(JSON.stringify(result)).not.toContain('<svg>')
    expect((await mocked.render.mock.results[0]?.value).bindFunctions).not.toHaveBeenCalled()
  })
  it('uses fixed strict baseline settings and host-selected themes for each request', async () => {
    await renderDocuments(request(), options())
    await renderDocuments({ ...request(), theme: 'dark', target: 'export', width: 420 }, options())
    expect(mocked.initialize.mock.calls.map((call) => call[0].theme)).toEqual(['default', 'dark'])
    for (const call of mocked.initialize.mock.calls) {
      expect(call[0]).toMatchObject({
        securityLevel: 'strict',
        htmlLabels: false,
        maxTextSize: 50_000,
        maxEdges: 500,
        startOnLoad: false,
        suppressErrorRendering: true,
        fontFamily: 'Arial, sans-serif',
        legacyMathML: false,
        forceLegacyMathML: false,
      })
      expect(call[0].secure).toEqual(
        expect.arrayContaining([
          'secure',
          'securityLevel',
          'themeCSS',
          'theme',
          'htmlLabels',
          'look',
          'dompurifyConfig',
          'arrowMarkerAbsolute',
          'deterministicIds',
          'deterministicIDSeed',
        ]),
      )
      expect(call[0]).not.toHaveProperty('journey')
    }
    expect(containers[1]?.style.width).toBe('420px')
  })
  it.each([
    'unsupported-animation',
    'unsafe-output',
    'unsupported-feature',
    'limit-exceeded',
    'font-unavailable',
    'invalid-output',
  ] as const)('preserves the whole original fence for %s', async (code) => {
    const input = request('flowchart TD\nA[中文😀] --> B\nclick A "https://secret.invalid"')
    mocked.convert.mockImplementation(() => {
      throw new ConversionError(code, 'https://secret.invalid private diagnostic')
    })
    const result = await renderDocuments(input, options())
    expect(result.fragments[0]).toMatchObject({
      status: 'error',
      content: { type: 'code', children: [{ type: 'text', text: input.source }] },
    })
    expect(result.fragments[0]?.message).not.toContain('https:')
    expect(containers.every((container) => container.removed)).toBe(true)
  })
  it('cleans the isolated container after an engine error and a missing SVG', async () => {
    mocked.render.mockRejectedValueOnce(new Error('untrusted parse failure'))
    expect((await renderDocuments(request(), options())).fragments[0]?.status).toBe('error')
    mocked.render.mockImplementationOnce(async (_id, _input, container: Container) => {
      container.root = null
      return { svg: '' }
    })
    expect((await renderDocuments(request(), options())).fragments[0]?.status).toBe('error')
    expect(containers.every((container) => container.removed)).toBe(true)
  })
  it('does not parse partial, unrelated or malformed ranges', async () => {
    const input = request(),
      block = input.blocks[0]!
    for (const candidate of [
      { ...input, contextKnown: false },
      { ...input, blocks: [{ ...block, complete: false }] },
      { ...input, blocks: [{ ...block, kind: 'unknown' as const }] },
      { ...input, blocks: [{ ...block, info: 'javascript' }] },
      { ...input, blocks: [{ ...block, from: input.from - 1 }] },
      { ...input, blocks: [{ ...block, contentRanges: [{ from: 0, to: 1 }] }] },
      { ...input, blocks: [{ ...block, to: NaN }] },
    ])
      expect((await renderDocuments(candidate, options())).fragments).toEqual([])
    expect(mocked.render).not.toHaveBeenCalled()
  })
  it('rejects custom fence parameters and engine input limits without truncating source', async () => {
    const input = request(),
      block = input.blocks[0]!
    expect(
      (
        await renderDocuments(
          { ...input, blocks: [{ ...block, info: 'mermaid custom' }] },
          options(),
        )
      ).fragments[0]?.status,
    ).toBe('error')
    const huge = request('flowchart TD\n' + 'x'.repeat(50_000))
    expect((await renderDocuments(huge, options())).fragments[0]?.content).toMatchObject({
      type: 'code',
      children: [{ text: huge.source }],
    })
    for (const invalid of [
      request('x'.repeat(65_537)),
      request('\n'.repeat(257)),
      { ...input, width: NaN },
    ])
      expect(await renderDocuments(invalid, options())).toEqual({ fragments: [], complete: false })
    expect(mocked.render).not.toHaveBeenCalled()
  })
  it('bounds combined UTF-8 output across separate complete fences', async () => {
    const first = request('flowchart TD\nA-->B', 0),
      second = request('flowchart TD\nC-->D', first.to)
    const content = image()
    mocked.convert.mockReturnValue({
      ...content,
      children: Array.from({ length: 40 }, () => ({
        kind: 'text',
        children: [{ kind: 'textRun', text: 'x'.repeat(3500) }],
      })),
    })
    const result = await renderDocuments(
      {
        ...first,
        source: first.source + second.source,
        blocks: [...first.blocks, ...second.blocks],
        to: second.to,
      },
      options(),
    )
    expect(result.complete).toBe(false)
    expect(result.fragments).toHaveLength(1)
    expect(new TextEncoder().encode(JSON.stringify(result)).length).toBeLessThanOrEqual(262_144)
    expect(containers.every((container) => container.removed)).toBe(true)
  })
  it('rejects cancellation before parsing and after asynchronous engine work', async () => {
    const before = new AbortController()
    before.abort()
    await expect(renderDocuments(request(), { signal: before.signal })).rejects.toThrow(/cancel/i)
    expect(mocked.render).not.toHaveBeenCalled()
    const during = new AbortController()
    mocked.render.mockImplementationOnce(async () => {
      during.abort()
      return { svg: '<svg/>' }
    })
    await expect(renderDocuments(request(), { signal: during.signal })).rejects.toThrow(/cancel/i)
    expect(mocked.convert).not.toHaveBeenCalled()
    expect(containers[0]?.removed).toBe(true)
    expect((await renderDocuments(request(), options())).fragments[0]?.status).toBe('ready')
  })
  it('does not overlap two calls into the engine singleton', async () => {
    let finish!: (value: { svg: string }) => void
    mocked.render.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    const pending = renderDocuments(request(), options())
    await expect(renderDocuments(request(), options())).rejects.toThrow(/already executing/)
    finish({ svg: '<svg/>' })
    expect((await pending).complete).toBe(true)
  })
})

import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DocumentPresentationRequest, DocumentPresentationResult } from '@milkup/core'
import { collectOutputPresentations } from './output-presentations'

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})
const textRenderer = { pluginId: 'generic-text', id: 'text', contexts: ['text'] as const }
const fenceRenderer = {
  pluginId: 'generic-fence',
  id: 'fence',
  contexts: ['fence'] as const,
  fenceLanguages: ['diagram'],
}
function options(source = 'Hello $x$\n') {
  return {
    source,
    sourceOffset: 0,
    documentId: 'doc',
    version: 7,
    fromLine: 1,
    selection: { anchor: 0, head: 0 },
    signal: new AbortController().signal,
    assertCurrent: vi.fn(),
    renderers: () => [textRenderer, fenceRenderer],
    render: vi.fn(
      async (
        _plugin: string,
        _id: string,
        request: DocumentPresentationRequest,
      ): Promise<DocumentPresentationResult> => ({
        complete: true,
        fragments: request.blocks
          .filter((b) => b.kind === 'fence' && b.complete)
          .map((b) => ({
            from: b.from,
            to: b.to,
            layout: 'block' as const,
            content: { type: 'text' as const, text: 'diagram' },
            accessibleText: 'diagram',
          })),
      }),
    ),
  }
}
describe('frozen output presentation collection', () => {
  it('calls generic enabled providers with export target and trusted protected context', async () => {
    const input = options('`$hidden$` and $x$\n')
    input.render.mockImplementation(async (_p, _r, request) => ({
      complete: true,
      fragments: [
        {
          from: request.source.lastIndexOf('$x$'),
          to: request.source.lastIndexOf('$x$') + 3,
          layout: 'inline',
          content: { type: 'text', text: 'x' },
          accessibleText: 'x',
        },
      ],
    }))
    const result = await collectOutputPresentations(input)
    expect(result.presentations[0]!.request.target).toBe('export')
    expect(result.presentations[0]!.request.protectedRanges).toEqual([{ from: 0, to: 10 }])
    expect(result.presentations[0]!.result.fragments).toHaveLength(1)
    expect(result.warnings).toEqual([])
  })
  it('keeps a fence crossing a normal window boundary whole and preserves exact source slices', async () => {
    const input = options('line\n'.repeat(250) + '```diagram\n' + 'edge\n'.repeat(10) + '```\n')
    input.renderers = () => [fenceRenderer]
    const result = await collectOutputPresentations(input)
    expect(input.render).toHaveBeenCalledTimes(1)
    const request = input.render.mock.calls[0]![2]
    expect(request.source).toBe('```diagram\n' + 'edge\n'.repeat(10) + '```')
    expect(request.blocks[0]!.complete).toBe(true)
    for (const batch of result.presentations)
      expect(batch.request.source).toBe(input.source.slice(batch.request.from, batch.request.to))
    expect(result.presentations.flatMap((p) => p.result.fragments)).toHaveLength(1)
  })
  it('warns and preserves source fallback for an oversized complete fence', async () => {
    const input = options('```diagram\n' + 'edge\n'.repeat(300) + '```\n')
    const result = await collectOutputPresentations(input)
    expect(input.render).not.toHaveBeenCalled()
    expect(result.warnings.some((w) => w.code === 'presentation-oversized')).toBe(true)
  })
  it('rejects edits during rendering instead of accepting a stale frozen snapshot', async () => {
    const input = options()
    let current = true
    input.assertCurrent.mockImplementation(() => {
      if (!current) throw Error('stale capture')
    })
    input.render.mockImplementation(async () => {
      current = false
      return { complete: true, fragments: [] }
    })
    await expect(collectOutputPresentations(input)).rejects.toThrow('stale capture')
  })
  it('bounds an unresponsive host by the existing preparation window and warns', async () => {
    vi.useFakeTimers()
    const input = options()
    input.render.mockImplementation(() => new Promise(() => {}))
    const pending = collectOutputPresentations(input)
    await vi.advanceTimersByTimeAsync(10_001)
    const result = await pending
    expect(result.warnings.some((w) => w.code === 'presentation-timeout')).toBe(true)
  })
  it('rejects a result past the preparation deadline even before its timer callback runs', async () => {
    const clock = vi.spyOn(performance, 'now').mockReturnValue(0)
    const input = options()
    input.render.mockImplementation(async () => {
      clock.mockReturnValue(10_000)
      return { complete: true, fragments: [] }
    })
    const result = await collectOutputPresentations(input)
    expect(result.presentations.every((batch) => !batch.result.complete)).toBe(true)
    expect(result.warnings.some((warning) => warning.code === 'presentation-timeout')).toBe(true)
  })
  it('warns for selection context without guessing a full-document opening state', async () => {
    const input = options('```diagram\nfake\n```')
    const result = await collectOutputPresentations({
      ...input,
      sourceOffset: 123,
      fromLine: 9,
      completeStart: false,
      completeEnd: false,
    })
    expect(input.render).not.toHaveBeenCalled()
    expect(result.presentations).toEqual([])
    expect(result.warnings.some((w) => w.code === 'presentation-selection-context')).toBe(true)
  })
  it('marks each block-aligned chunk edge complete so later text providers do not silently skip math', async () => {
    const input = options('line\n'.repeat(250) + '\n$$\nx\n$$\n\nend\n'.repeat(2))
    input.renderers = () => [textRenderer]
    await collectOutputPresentations(input)
    expect(input.render.mock.calls.length).toBeGreaterThan(1)
    expect(
      input.render.mock.calls.every((call) => call[2].completeStart && call[2].completeEnd),
    ).toBe(true)
  })
  it('warns when a matching fence renderer declines a complete supported fence', async () => {
    const input = options('```diagram\nunsupported syntax\n```')
    input.renderers = () => [fenceRenderer]
    input.render.mockResolvedValue({ complete: true, fragments: [] })
    const result = await collectOutputPresentations(input)
    expect(result.warnings.some((w) => w.code === 'presentation-unsupported')).toBe(true)
  })
  it('preserves absolute UTF-16 ranges, line numbers, math and footnote nodes for a proven boundary', async () => {
    const input = options('🙂 $x$ [^a]\n\n[^a]: note')
    input.renderers = () => [textRenderer]
    input.render.mockImplementation(async (_p, _r, request) => ({
      complete: true,
      fragments: [
        {
          from: request.from + 3,
          to: request.from + 6,
          layout: 'inline',
          content: { type: 'math', tree: { tag: 'math', children: [{ tag: 'mi', text: 'x' }] } },
          accessibleText: 'x',
        },
        {
          from: request.from + 7,
          to: request.from + 11,
          layout: 'inline',
          content: {
            type: 'reference',
            label: '1',
            target: {
              documentId: request.documentId,
              version: request.version,
              from: request.from + 13,
              to: request.to,
            },
          },
          accessibleText: 'footnote 1',
        },
      ],
    }))
    const result = await collectOutputPresentations({
      ...input,
      sourceOffset: 50,
      fromLine: 9,
      completeStart: true,
      completeEnd: true,
    })
    const batch = result.presentations[0]!
    expect(batch.request.from).toBe(50)
    expect(batch.request.fromLine).toBe(9)
    expect(input.render.mock.calls[0]![2].fromLine).toBe(9)
    expect(batch.result.fragments.map((fragment) => fragment.content.type)).toEqual([
      'math',
      'reference',
    ])
    expect(batch.result.fragments.map((fragment) => fragment.from)).toEqual([53, 57])
    expect(result.warnings).toEqual([])
  })
  it('rejects an oversized renderer payload with explicit source fallback', async () => {
    const input = options()
    input.render.mockResolvedValue({
      complete: true,
      fragments: [
        {
          from: 0,
          to: 5,
          layout: 'inline',
          accessibleText: 'large',
          content: {
            type: 'group',
            children: Array.from({ length: 4097 }, () => ({ type: 'text', text: 'x' })),
          },
        },
      ],
    })
    const result = await collectOutputPresentations(input)
    expect(result.presentations.flatMap((batch) => batch.result.fragments)).toEqual([])
    expect(result.warnings.some((warning) => warning.code === 'presentation-incomplete')).toBe(true)
  })
  it('rejects cancellation immediately even if the renderer ignores its abort signal', async () => {
    const input = options(),
      controller = new AbortController()
    input.render.mockImplementation(async () => {
      controller.abort()
      return new Promise(() => {})
    })
    await expect(
      collectOutputPresentations({ ...input, signal: controller.signal }),
    ).rejects.toThrow('aborted')
  })
  it('does not admit source above the two-Mi UTF-16 cap', async () => {
    const input = options('x'.repeat(2 * 1024 * 1024 + 1))
    const result = await collectOutputPresentations(input)
    expect(input.render).not.toHaveBeenCalled()
    expect(result.presentations).toEqual([])
    expect(result.warnings.some((warning) => warning.code === 'presentation-oversized')).toBe(true)
  })
})

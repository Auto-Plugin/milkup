import { describe, expect, it } from 'vitest'
import type { SdkDocumentPresentationRequest } from '@milkup/plugin-sdk'
import { renderDocuments } from './renderer'

function request(body = 'flowchart TD\nA --> B', from = 123): SdkDocumentPresentationRequest {
  const source = `\`\`\`mermaid\r\n${body}\r\n\`\`\`\r\n`
  return {
    documentId: 'doc-a',
    version: 7,
    source,
    from,
    to: from + source.length,
    fromLine: 9,
    toLine: 14,
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
        contentRanges: [{ from: from + 12, to: from + source.length - 5 }],
      },
    ],
    selection: { anchor: from, head: from },
    theme: 'light',
    target: 'screen',
    width: 800,
  }
}
const options = () => ({ signal: new AbortController().signal })
describe('public document renderer', () => {
  it('returns exact absolute complete-fence offsets and does not mutate requests', async () => {
    const input = request(),
      snapshot = structuredClone(input)
    const result = await renderDocuments(input, options())
    expect(input).toEqual(snapshot)
    expect(result.complete).toBe(true)
    expect(result.fragments).toHaveLength(1)
    expect(result.fragments[0]).toMatchObject({
      from: input.from,
      to: input.to,
      status: 'ready',
      layout: 'block',
      content: { type: 'vector' },
    })
  })
  it('uses identical safe semantics for screen/export and theme tokens for light/dark', async () => {
    const input = request('sequenceDiagram\nA->>B: hi')
    expect(await renderDocuments({ ...input, target: 'export', theme: 'dark' }, options())).toEqual(
      await renderDocuments(input, options()),
    )
  })
  it('returns fixed accessible error and complete original fence for any unsupported statement', async () => {
    const input = request('flowchart TD\nA-->B\nclick A "https://example.com"')
    const result = await renderDocuments(input, options())
    expect(result.fragments).toHaveLength(1)
    expect(result.fragments[0]).toMatchObject({
      status: 'error',
      content: { type: 'code', children: [{ type: 'text', text: input.source }] },
    })
    expect(result.fragments[0]?.message).not.toContain('https:')
  })
  it('does not render uncertain, partial, unrelated or malformed ranges', async () => {
    const input = request(),
      block = input.blocks[0]!
    for (const candidate of [
      { ...input, contextKnown: false },
      { ...input, blocks: [{ ...block, complete: false }] },
      { ...input, blocks: [{ ...block, kind: 'unknown' as const }] },
      { ...input, blocks: [{ ...block, info: 'javascript' }] },
      { ...input, blocks: [{ ...block, from: input.from - 1 }] },
      { ...input, blocks: [{ ...block, contentRanges: [{ from: 0, to: 1 }] }] },
    ])
      expect((await renderDocuments(candidate, options())).fragments).toEqual([])
  })
  it('rejects custom fence parameters and oversized body without discarding source', async () => {
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
    const huge = request('flowchart TD\n' + ' '.repeat(32768))
    expect((await renderDocuments(huge, options())).fragments[0]?.content).toMatchObject({
      type: 'code',
      children: [{ text: huge.source }],
    })
  })
  it('bounds combined output across many independently valid fences', async () => {
    const template = request(
      'flowchart TD\n' +
        Array.from(
          { length: 100 },
          (_, i) => `N${i}-->N${(i + 1) % 100}\nN${i}-->N${(i + 2) % 100}`,
        ).join('\n'),
      0,
    )
    let source = '',
      blocks: SdkDocumentPresentationRequest['blocks'][number][] = []
    for (let i = 0; i < 12; i++) {
      const offset = source.length,
        block = template.blocks[0]!
      source += template.source
      blocks.push({
        ...block,
        from: offset,
        to: source.length,
        contentRanges: block.contentRanges.map((r) => ({
          from: r.from + offset,
          to: r.to + offset,
        })),
      })
    }
    const result = await renderDocuments(
      { ...template, source, blocks, to: source.length },
      options(),
    )
    expect(result.complete).toBe(false)
    expect(result.fragments.length).toBeGreaterThan(0)
    expect(new TextEncoder().encode(JSON.stringify(result)).length).toBeLessThanOrEqual(262144)
    expect(
      result.fragments.reduce(
        (sum, f) =>
          sum +
          (f.content.type === 'vector'
            ? f.content.children.reduce(
                (n, child) => n + 1 + ('points' in child ? child.points.length : 0),
                1,
              )
            : 2),
        0,
      ),
    ).toBeLessThanOrEqual(4096)
  })
  it('honors an already cancelled request rather than returning partial output', () => {
    const controller = new AbortController()
    controller.abort()
    expect(() => renderDocuments(request(), { signal: controller.signal })).toThrow(/cancel/i)
  })
})

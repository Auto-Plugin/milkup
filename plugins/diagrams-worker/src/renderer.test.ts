import { expect, it } from 'vitest'
import type { SdkDocumentPresentationRequest } from '@milkup/plugin-sdk'
import { renderDocuments } from './renderer'
function request(body: string, offset = 0, lineEnding = '\n'): SdkDocumentPresentationRequest {
  const source = '```mermaid' + lineEnding + body + lineEnding + '```'
  return {
    documentId: 'test',
    version: 1,
    source,
    from: offset,
    to: offset + source.length,
    fromLine: 1,
    toLine: source.split('\n').length,
    completeStart: true,
    completeEnd: true,
    contextKnown: true,
    protectedRanges: [],
    blocks: [
      {
        kind: 'fence',
        complete: true,
        from: offset,
        to: offset + source.length,
        info: 'mermaid',
        contentRanges: [{ from: offset + 10 + lineEnding.length, to: offset + source.length - 3 }],
      },
    ],
    selection: { anchor: offset + source.length, head: offset + source.length },
    theme: 'light',
    target: 'screen',
    width: 800,
  }
}
const render = (input: SdkDocumentPresentationRequest) =>
  renderDocuments(input, { signal: new AbortController().signal })
it('produces a static vector and absolute UTF-16 offsets for a bounded window', async () => {
  const result = await render(request('flowchart LR\nA["开始😀"]-->B[完成]', 400))
  expect(result.fragments).toHaveLength(1)
  expect(result.fragments[0]).toMatchObject({
    from: 400,
    status: 'ready',
    content: { type: 'vector' },
  })
})
it.each([
  'pie\n"A":3',
  'sequenceDiagram\nloop More\nA->>B: x\nend',
  'flowchart TD\nA["<img src=x onerror=alert(1)>"]-->B',
  'flowchart TD\nA-->B\nclick A "javascript:alert(1)"',
])('preserves exact unsupported fence with CRLF and Unicode: %s', async (body) => {
  const input = request(body.replaceAll('\n', '\r\n') + '\r\n%% 原文😀', 50, '\r\n'),
    result = await render(input)
  expect(result.fragments[0]).toMatchObject({
    from: 50,
    status: 'error',
    content: { type: 'code', children: [{ type: 'text', text: input.source }] },
  })
  expect(result.fragments[0]?.message).toContain('保留完整源码')
})
it('never renders an unknown context, incomplete fence or wrong language', async () => {
  const input = request('flowchart TD\nA-->B')
  expect(await render({ ...input, contextKnown: false })).toEqual({
    fragments: [],
    complete: false,
  })
  for (const block of [
    { ...input.blocks[0]!, complete: false },
    { ...input.blocks[0]!, info: 'javascript' },
    { ...input.blocks[0]!, from: -1 },
  ])
    expect((await render({ ...input, blocks: [block] })).fragments).toEqual([])
})
it('honors cancellation before compiling', async () => {
  const controller = new AbortController()
  controller.abort()
  await expect(
    renderDocuments(request('flowchart TD\nA-->B'), { signal: controller.signal }),
  ).rejects.toThrow()
})
it('keeps body budget failures explicit and input request budget bounded', async () => {
  expect((await render(request('x'.repeat(8193)))).fragments[0]?.status).toBe('error')
  expect(await render(request('x'.repeat(65537)))).toEqual({ fragments: [], complete: false })
})
it('refuses aggregate output beyond the shared host budget without replacing source', async () => {
  const body =
    'sequenceDiagram\n' +
    Array.from({ length: 6 }, (_, i) => 'participant A' + i).join('\n') +
    '\n' +
    Array.from({ length: 16 }, () => 'A0-->>A5: 返回').join('\n')
  const one = request(body),
    source = one.source + '\n' + one.source,
    offset = one.source.length + 1
  const result = await render({
    ...one,
    source,
    to: source.length,
    blocks: [
      ...one.blocks,
      ...one.blocks.map((b) => ({
        ...b,
        from: b.from + offset,
        to: b.to + offset,
        contentRanges: b.contentRanges.map((r) => ({ from: r.from + offset, to: r.to + offset })),
      })),
    ],
  })
  expect(result).toEqual({ fragments: [], complete: false })
})

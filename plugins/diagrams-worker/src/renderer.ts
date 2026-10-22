import type { SdkDocumentPresentationFragment, SdkDocumentRenderer } from '@milkup/plugin-sdk'
import { compileDiagram, LIMITS } from './compiler'
const failure = (
  from: number,
  to: number,
  source: string,
  message: string,
): SdkDocumentPresentationFragment => ({
  from,
  to,
  layout: 'block',
  status: 'error',
  message,
  accessibleText: message,
  content: { type: 'code', children: [{ type: 'text', text: source }] },
})
/** This module has no DOM or network operations. Only host-verified complete fences
 * enter the compiler; every unsupported construct preserves the entire fence. */
export const renderDocuments: SdkDocumentRenderer = async (request, { signal }) => {
  signal.throwIfAborted()
  if (!request.contextKnown) return { fragments: [], complete: false }
  if (request.source.length > 65_536 || request.source.split('\n').length > 256)
    return { fragments: [], complete: false }
  const fragments: SdkDocumentPresentationFragment[] = []
  for (const block of request.blocks) {
    signal.throwIfAborted()
    if (
      block.kind !== 'fence' ||
      !block.complete ||
      block.info?.trim().split(/\s/u)[0] !== 'mermaid' ||
      block.contentRanges.length !== 1
    )
      continue
    const body = block.contentRanges[0]!
    if (
      ![block.from, block.to, body.from, body.to].every(Number.isSafeInteger) ||
      block.from < request.from ||
      block.to > request.to ||
      block.from >= block.to ||
      body.from < block.from ||
      body.to > block.to ||
      body.from > body.to
    )
      continue
    const source = request.source.slice(block.from - request.from, block.to - request.from)
    const input = request.source.slice(body.from - request.from, body.to - request.from)
    try {
      if (input.length > LIMITS.source)
        throw new Error('受限图表正文最多 8192 个 UTF-16 字符；已保留完整源码。')
      const content = compileDiagram(input)
      signal.throwIfAborted()
      fragments.push({
        from: block.from,
        to: block.to,
        layout: 'block',
        status: 'ready',
        accessibleText: '流程图与时序图（受限语法）',
        content,
      })
    } catch (error) {
      signal.throwIfAborted()
      // Parser diagnostics can contain source snippets; keep messages bounded and
      // generic for syntax failures, while the code node contains the exact source.
      const message =
        error instanceof Error && error.message.startsWith('受限')
          ? error.message
          : '受限图表不支持此语法；已保留完整源码。支持基础无环流程图和简单时序图。'
      fragments.push(failure(block.from, block.to, source, message.slice(0, 500)))
    }
  }
  const result = { fragments, complete: true }
  // The host has a shared 256 KiB/4096-node budget for all fragments. Refuse
  // an oversized aggregate as a whole; the editor then keeps all source visible.
  const nodes = fragments.reduce(
    (count, fragment) =>
      count + 1 + (fragment.content.type === 'vector' ? fragment.content.children.length : 2),
    0,
  )
  if (nodes > 4096 || new TextEncoder().encode(JSON.stringify(result)).length > 240_000)
    return { fragments: [], complete: false }
  return result
}

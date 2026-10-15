import type { SdkDocumentRenderer, SdkDocumentPresentationFragment } from '@milkup/plugin-sdk'
import { renderDiagram, countVectorNodes } from './layout'
import { checkCancelled } from './parser'

/** Exact host-supplied fence ranges are the only replaceable source. */
export const renderDocuments: SdkDocumentRenderer = (request, { signal }) => {
  checkCancelled(signal)
  if (!request.contextKnown) return { fragments: [], complete: false }
  const fragments: SdkDocumentPresentationFragment[] = []
  let bytes = 64,
    nodes = 0
  for (const block of request.blocks) {
    checkCancelled(signal)
    if (
      block.kind !== 'fence' ||
      !block.complete ||
      block.info?.trim().split(/\s/u)[0] !== 'mermaid'
    )
      continue
    if (
      block.from < request.from ||
      block.to > request.to ||
      block.to <= block.from ||
      block.contentRanges.length !== 1
    )
      continue
    const body = block.contentRanges[0]!
    if (body.from < block.from || body.to > block.to || body.to < body.from) continue
    // Do not invent semantics for custom info-string options.
    const rendered =
      block.info.trim() === 'mermaid'
        ? renderDiagram(
            request.source.slice(body.from - request.from, body.to - request.from),
            signal,
          )
        : { ok: false as const, message: '图表围栏参数暂不支持，已保留完整源码。' }
    const fragment: SdkDocumentPresentationFragment = rendered.ok
      ? {
          from: block.from,
          to: block.to,
          layout: 'block',
          content: rendered.vector,
          accessibleText: rendered.accessibleText,
          status: 'ready',
        }
      : {
          from: block.from,
          to: block.to,
          layout: 'block',
          content: {
            type: 'code',
            children: [
              {
                type: 'text',
                text: request.source.slice(block.from - request.from, block.to - request.from),
              },
            ],
          },
          accessibleText: rendered.message,
          status: 'error',
          message: rendered.message,
        }
    const size = new TextEncoder().encode(JSON.stringify(fragment)).length
    const count = fragment.content.type === 'vector' ? countVectorNodes(fragment.content) : 2
    if (bytes + size > 256 * 1024 || nodes + count > 4096 || fragments.length >= 128)
      return { fragments, complete: false }
    bytes += size + 1
    nodes += count
    fragments.push(fragment)
  }
  return { fragments, complete: true }
}

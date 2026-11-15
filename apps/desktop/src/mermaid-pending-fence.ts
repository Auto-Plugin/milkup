import { parseMarkdown } from '@milkup/markdown'
import { DOCUMENT_PRESENTATION_LIMITS } from '@milkup/core'

/** Local syntax only. The caller must separately attest current host identity,
 * enabled state and render policy. This cannot grant renderer permissions. */
export function isCompleteMermaidPendingFence(source: string): boolean {
  if (!source || source.length > DOCUMENT_PRESENTATION_LIMITS.inputUtf16) return false
  const children = parseMarkdown(source).root.children ?? []
  if (children.length !== 1) return false
  const block = children[0]!
  return (
    block.type === 'fencedCode' &&
    block.status === 'valid' &&
    block.from === 0 &&
    block.to === source.length &&
    (block.markerRanges?.length ?? 0) >= 2 &&
    typeof block.data?.info === 'string' &&
    block.data.info.trim().split(/\s/u)[0] === 'mermaid'
  )
}

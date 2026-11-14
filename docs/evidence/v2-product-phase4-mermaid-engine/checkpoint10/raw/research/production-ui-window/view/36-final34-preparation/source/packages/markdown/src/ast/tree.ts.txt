import { parseMarkdown } from '../block/parser'
import type { SourceRange, SyntaxNode, SyntaxStatus } from '../cst/node'
import { parseInline } from '../inline/parser'

export type MarkdownAstNodeType = SyntaxNode['type']

export interface MarkdownAstNode {
  readonly type: MarkdownAstNodeType
  readonly from: number
  readonly to: number
  readonly status: SyntaxStatus
  readonly raw: string
  readonly text?: string
  readonly markerRanges?: readonly SourceRange[]
  readonly contentRanges?: readonly SourceRange[]
  readonly data?: Readonly<Record<string, unknown>>
  readonly children?: readonly MarkdownAstNode[]
  readonly inlineChildren?: readonly MarkdownAstNode[]
}

export interface MarkdownAstDocument extends MarkdownAstNode {
  readonly type: 'document'
  readonly source: string
}

export function parseMarkdownAst(source: string): MarkdownAstDocument {
  return createMarkdownAst(source, parseMarkdown(source).root) as MarkdownAstDocument
}

export function createMarkdownAst(source: string, node: SyntaxNode): MarkdownAstNode {
  const text = joinRanges(source, node.contentRanges)
  const children = node.children?.map((child) => createMarkdownAst(source, child))
  const inlineChildren = shouldParseInline(node)
    ? (node.contentRanges ?? []).flatMap((range) =>
        parseInline(source, range.from, range.to).map((child) => createMarkdownAst(source, child)),
      )
    : undefined

  return Object.freeze({
    type: node.type,
    from: node.from,
    to: node.to,
    status: node.status,
    raw: source.slice(node.from, node.to),
    ...(node.type === 'document' ? { source } : {}),
    ...(text !== undefined ? { text } : {}),
    ...(node.markerRanges ? { markerRanges: node.markerRanges } : {}),
    ...(node.contentRanges ? { contentRanges: node.contentRanges } : {}),
    ...(node.data ? { data: node.data } : {}),
    ...(children ? { children: Object.freeze(children) } : {}),
    ...(inlineChildren ? { inlineChildren: Object.freeze(inlineChildren) } : {}),
  })
}

function shouldParseInline(node: SyntaxNode): boolean {
  if (!node.contentRanges || node.contentRanges.length === 0) {
    return false
  }

  return ['heading', 'paragraph', 'blockquoteLine', 'tableCell', 'listItem'].includes(node.type)
}

function joinRanges(
  source: string,
  ranges: readonly SourceRange[] | undefined,
): string | undefined {
  if (!ranges) {
    return undefined
  }

  return ranges.map((range) => source.slice(range.from, range.to)).join('')
}

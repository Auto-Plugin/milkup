export interface SourceRange {
  readonly from: number
  readonly to: number
}

export type SyntaxStatus = 'valid' | 'incomplete' | 'invalid' | 'fallback'

export type SyntaxNodeType =
  | 'document'
  | 'blankLine'
  | 'paragraph'
  | 'heading'
  | 'fencedCode'
  | 'indentedCode'
  | 'blockquote'
  | 'blockquoteLine'
  | 'table'
  | 'tableRow'
  | 'tableCell'
  | 'thematicBreak'
  | 'unorderedList'
  | 'orderedList'
  | 'listItem'
  | 'text'
  | 'escape'
  | 'inlineCode'
  | 'emphasis'
  | 'strong'
  | 'link'
  | 'image'
  | 'autolink'
  | 'hardBreak'
  | 'fallbackText'

export interface SyntaxNode {
  readonly type: SyntaxNodeType | string
  readonly from: number
  readonly to: number
  readonly status: SyntaxStatus
  readonly markerRanges?: readonly SourceRange[]
  readonly contentRanges?: readonly SourceRange[]
  readonly children?: readonly SyntaxNode[]
  readonly data?: Readonly<Record<string, unknown>>
}

export function createNode(node: SyntaxNode): SyntaxNode {
  assertNodeRange(node)

  return Object.freeze({
    type: node.type,
    from: node.from,
    to: node.to,
    status: node.status,
    ...(node.markerRanges ? { markerRanges: freezeRanges(node.markerRanges) } : {}),
    ...(node.contentRanges ? { contentRanges: freezeRanges(node.contentRanges) } : {}),
    ...(node.children ? { children: Object.freeze([...node.children]) } : {}),
    ...(node.data ? { data: Object.freeze({ ...node.data }) } : {}),
  })
}

export function assertNodeRange(node: Pick<SyntaxNode, 'from' | 'to' | 'type'>): void {
  if (!Number.isInteger(node.from) || !Number.isInteger(node.to)) {
    throw new RangeError(`Node ${node.type} range offsets must be integers`)
  }

  if (node.from < 0 || node.to < node.from) {
    throw new RangeError(`Invalid ${node.type} node range: ${node.from}-${node.to}`)
  }
}

function freezeRanges(ranges: readonly SourceRange[]): readonly SourceRange[] {
  return Object.freeze(
    ranges.map((range) => {
      if (!Number.isInteger(range.from) || !Number.isInteger(range.to)) {
        throw new RangeError(`Range offsets must be integers: ${range.from}-${range.to}`)
      }

      if (range.from < 0 || range.to < range.from) {
        throw new RangeError(`Invalid range: ${range.from}-${range.to}`)
      }

      return Object.freeze({ ...range })
    }),
  )
}

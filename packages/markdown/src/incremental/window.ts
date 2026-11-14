import { parseMarkdown, type MarkdownParseResult } from '../block/parser'
import { createNode, type SourceRange, type SyntaxNode } from '../cst/node'

export interface MarkdownLineWindowLine {
  readonly number: number
  readonly from: number
  readonly to: number
  readonly text: string
}

export interface MarkdownLineWindow {
  readonly fromLine: number
  readonly toLine: number
  readonly from: number
  readonly to: number
  readonly text: string
  readonly lines: readonly MarkdownLineWindowLine[]
}

export interface MarkdownLineWindowReadable {
  readonly documentId: string
  readonly version: number
  readLineWindow(fromLine: number, toLine: number): Promise<MarkdownLineWindow>
}

export interface MarkdownWindowParseOptions {
  readonly fromLine: number
  readonly toLine: number
}

export interface MarkdownWindowParseResult extends MarkdownParseResult {
  readonly documentId: string
  readonly version: number
  readonly window: MarkdownLineWindow
  readonly localSource: string
}

export async function parseMarkdownWindow(
  store: MarkdownLineWindowReadable,
  options: MarkdownWindowParseOptions,
): Promise<MarkdownWindowParseResult> {
  const window = await store.readLineWindow(options.fromLine, options.toLine)
  const parsed = parseMarkdown(window.text)

  return Object.freeze({
    documentId: store.documentId,
    version: store.version,
    window,
    localSource: parsed.source,
    source: parsed.source,
    root: shiftNode(parsed.root, window.from),
  })
}

function shiftNode(node: SyntaxNode, offset: number): SyntaxNode {
  return createNode({
    ...node,
    from: node.from + offset,
    to: node.to + offset,
    ...(node.markerRanges ? { markerRanges: shiftRanges(node.markerRanges, offset) } : {}),
    ...(node.contentRanges ? { contentRanges: shiftRanges(node.contentRanges, offset) } : {}),
    ...(node.children ? { children: node.children.map((child) => shiftNode(child, offset)) } : {}),
  })
}

function shiftRanges(ranges: readonly SourceRange[], offset: number): readonly SourceRange[] {
  return ranges.map((range) =>
    Object.freeze({
      from: range.from + offset,
      to: range.to + offset,
    }),
  )
}

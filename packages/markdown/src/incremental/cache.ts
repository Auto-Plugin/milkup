import { parseMarkdown, type MarkdownParseResult } from '../block/parser'
import type { SourceRange, SyntaxNode } from '../cst/node'
import type { MarkdownSyntaxExtension } from '../extensions/safe'

export interface MarkdownParseCache {
  readonly source: string
  readonly root: SyntaxNode
  readonly blockRanges: readonly SourceRange[]
}

export interface ParseChange {
  readonly from: number
  readonly to: number
  readonly insertedLength: number
}

export interface IncrementalParseOptions {
  readonly previous?: MarkdownParseCache
  readonly change?: ParseChange
  readonly syntaxExtensions?: readonly MarkdownSyntaxExtension[]
}

export interface IncrementalMarkdownParseResult extends MarkdownParseResult {
  readonly cache: MarkdownParseCache
  readonly invalidatedRange?: SourceRange
  readonly reusedPreviousTree: boolean
}

export function createMarkdownParseCache(result: MarkdownParseResult): MarkdownParseCache {
  return Object.freeze({
    source: result.source,
    root: result.root,
    blockRanges: Object.freeze(
      (result.root.children ?? []).map((node) => ({ from: node.from, to: node.to })),
    ),
  })
}

export function parseMarkdownIncremental(
  source: string,
  options: IncrementalParseOptions = {},
): IncrementalMarkdownParseResult {
  const invalidatedRange =
    options.previous && options.change
      ? expandInvalidationRange(options.previous, {
          from: options.change.from,
          to: options.change.to,
        })
      : undefined
  const parsed = parseMarkdown(source, {
    ...(options.syntaxExtensions ? { syntaxExtensions: options.syntaxExtensions } : {}),
  })

  return Object.freeze({
    ...parsed,
    cache: createMarkdownParseCache(parsed),
    ...(invalidatedRange ? { invalidatedRange } : {}),
    reusedPreviousTree: false,
  })
}

export function expandInvalidationRange(
  cache: MarkdownParseCache,
  changedRange: SourceRange,
): SourceRange {
  assertRange(changedRange)

  let from = changedRange.from
  let to = changedRange.to

  for (const range of cache.blockRanges) {
    if (!rangesTouch(range, changedRange)) {
      continue
    }

    from = Math.min(from, range.from)
    to = Math.max(to, range.to)
  }

  return Object.freeze({ from, to })
}

function rangesTouch(a: SourceRange, b: SourceRange): boolean {
  return a.from <= b.to && b.from <= a.to
}

function assertRange(range: SourceRange): void {
  if (
    !Number.isInteger(range.from) ||
    !Number.isInteger(range.to) ||
    range.from < 0 ||
    range.to < range.from
  ) {
    throw new RangeError(`Invalid source range: ${range.from}-${range.to}`)
  }
}

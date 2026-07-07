import type { TextRange } from '../position/range'

import type { DocumentStore } from './document-store'

export interface StoreSearchOptions {
  readonly query: string | RegExp
  readonly caseSensitive?: boolean
  readonly maxResults?: number
  readonly windowSizeLines?: number
}

export interface StoreSearchMatch extends TextRange {
  readonly line: number
  readonly lineOffset: number
  readonly text: string
}

export interface StoreSearchResult {
  readonly documentId: string
  readonly version: number
  readonly query: string
  readonly matches: readonly StoreSearchMatch[]
  readonly scannedLineCount: number
  readonly complete: boolean
}

interface CompiledSearchQuery {
  readonly label: string
  readonly findMatches: (line: string) => readonly SearchLineMatch[]
}

interface SearchLineMatch {
  readonly from: number
  readonly to: number
  readonly text: string
}

const DEFAULT_WINDOW_SIZE_LINES = 512

export async function searchDocumentStore(
  store: DocumentStore,
  options: StoreSearchOptions,
): Promise<StoreSearchResult> {
  const query = compileSearchQuery(options)
  const maxResults = normalizeMaxResults(options.maxResults)
  const windowSizeLines = normalizeWindowSize(options.windowSizeLines)
  const matches: StoreSearchMatch[] = []
  let scannedLineCount = 0

  for (let fromLine = 1; fromLine <= store.lineCount; fromLine += windowSizeLines) {
    const toLine = Math.min(store.lineCount, fromLine + windowSizeLines - 1)
    const window = await store.readLineWindow(fromLine, toLine)

    scannedLineCount += window.lines.length

    for (const line of window.lines) {
      for (const match of query.findMatches(line.text)) {
        matches.push(
          Object.freeze({
            from: line.from + match.from,
            to: line.from + match.to,
            line: line.number,
            lineOffset: match.from,
            text: match.text,
          }),
        )

        if (matches.length >= maxResults) {
          return freezeResult(store, query.label, matches, scannedLineCount, false)
        }
      }
    }
  }

  return freezeResult(store, query.label, matches, scannedLineCount, true)
}

function compileSearchQuery(options: StoreSearchOptions): CompiledSearchQuery {
  if (typeof options.query === 'string') {
    return compileStringQuery(options.query, options.caseSensitive ?? false)
  }

  return compileRegExpQuery(options.query)
}

function compileStringQuery(query: string, caseSensitive: boolean): CompiledSearchQuery {
  if (query.length === 0) {
    throw new RangeError('Search query must not be empty')
  }

  const needle = caseSensitive ? query : query.toLocaleLowerCase()

  return {
    label: query,
    findMatches: (line) => {
      const haystack = caseSensitive ? line : line.toLocaleLowerCase()
      const matches: SearchLineMatch[] = []
      let from = haystack.indexOf(needle)

      while (from >= 0) {
        const to = from + query.length

        matches.push({
          from,
          to,
          text: line.slice(from, to),
        })
        from = haystack.indexOf(needle, Math.max(to, from + 1))
      }

      return matches
    },
  }
}

function compileRegExpQuery(query: RegExp): CompiledSearchQuery {
  if (query.source.length === 0 || query.source === '(?:)') {
    throw new RangeError('Search query must not be empty')
  }

  const flags = query.flags.includes('g') ? query.flags : `${query.flags}g`
  const globalQuery = new RegExp(query.source, flags)

  return {
    label: query.toString(),
    findMatches: (line) => {
      globalQuery.lastIndex = 0

      const matches: SearchLineMatch[] = []
      let match: RegExpExecArray | null

      while ((match = globalQuery.exec(line))) {
        const text = match[0] ?? ''

        if (text.length === 0) {
          globalQuery.lastIndex += 1
          continue
        }

        matches.push({
          from: match.index,
          to: match.index + text.length,
          text,
        })
      }

      return matches
    },
  }
}

function normalizeMaxResults(maxResults: number | undefined): number {
  if (maxResults === undefined) {
    return Number.POSITIVE_INFINITY
  }

  if (!Number.isInteger(maxResults) || maxResults < 1) {
    throw new RangeError(`Invalid maxResults: ${maxResults}`)
  }

  return maxResults
}

function normalizeWindowSize(windowSizeLines: number | undefined): number {
  const value = windowSizeLines ?? DEFAULT_WINDOW_SIZE_LINES

  if (!Number.isInteger(value) || value < 1) {
    throw new RangeError(`Invalid windowSizeLines: ${windowSizeLines}`)
  }

  return value
}

function freezeResult(
  store: DocumentStore,
  query: string,
  matches: readonly StoreSearchMatch[],
  scannedLineCount: number,
  complete: boolean,
): StoreSearchResult {
  return Object.freeze({
    documentId: store.documentId,
    version: store.version,
    query,
    matches: Object.freeze([...matches]),
    scannedLineCount,
    complete,
  })
}

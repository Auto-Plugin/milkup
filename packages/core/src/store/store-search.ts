import type { TextRange } from '../position/range'

import type { DocumentLineWindow } from './document-store'

export interface StoreSearchOptions {
  readonly query: string | RegExp
  readonly caseSensitive?: boolean
  readonly maxResults?: number
  readonly windowSizeLines?: number
  readonly signal?: AbortSignal
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

export interface DocumentLineWindowSearchReadable {
  readonly documentId: string
  readonly version: number
  readonly lineCount: number
  readLineWindow(fromLine: number, toLine: number): Promise<DocumentLineWindow>
}

export type StoreSearchEvent =
  | {
      readonly type: 'match'
      readonly documentId: string
      readonly version: number
      readonly query: string
      readonly match: StoreSearchMatch
      readonly scannedLineCount: number
    }
  | {
      readonly type: 'progress'
      readonly documentId: string
      readonly version: number
      readonly query: string
      readonly scannedLineCount: number
      readonly matchCount: number
    }
  | {
      readonly type: 'done'
      readonly documentId: string
      readonly version: number
      readonly query: string
      readonly scannedLineCount: number
      readonly complete: boolean
      readonly matchCount: number
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
  store: DocumentLineWindowSearchReadable,
  options: StoreSearchOptions,
): Promise<StoreSearchResult> {
  const matches: StoreSearchMatch[] = []
  let finalEvent: Extract<StoreSearchEvent, { readonly type: 'done' }> | undefined

  for await (const event of searchDocumentLineWindows(store, options)) {
    if (event.type === 'match') {
      matches.push(event.match)
    } else if (event.type === 'done') {
      finalEvent = event
    }
  }

  return freezeResult(
    store,
    finalEvent?.query ?? formatSearchQuery(options.query),
    matches,
    finalEvent?.scannedLineCount ?? 0,
    finalEvent?.complete ?? true,
  )
}

export async function* searchDocumentLineWindows(
  store: DocumentLineWindowSearchReadable,
  options: StoreSearchOptions,
): AsyncGenerator<StoreSearchEvent> {
  const query = compileSearchQuery(options)
  const maxResults = normalizeMaxResults(options.maxResults)
  const windowSizeLines = normalizeWindowSize(options.windowSizeLines)
  let matchCount = 0
  let scannedLineCount = 0

  for (let fromLine = 1; fromLine <= store.lineCount; fromLine += windowSizeLines) {
    throwIfAborted(options.signal)

    const toLine = Math.min(store.lineCount, fromLine + windowSizeLines - 1)
    const window = await store.readLineWindow(fromLine, toLine)

    throwIfAborted(options.signal)
    scannedLineCount += window.lines.length

    for (const line of window.lines) {
      for (const match of query.findMatches(line.text)) {
        const storeMatch = Object.freeze({
          from: line.from + match.from,
          to: line.from + match.to,
          line: line.number,
          lineOffset: match.from,
          text: match.text,
        })

        matchCount += 1
        if (matchCount <= maxResults) {
          yield Object.freeze({
            type: 'match',
            documentId: store.documentId,
            version: store.version,
            query: query.label,
            match: storeMatch,
            scannedLineCount,
          })
        }
      }
    }

    throwIfAborted(options.signal)
    yield Object.freeze({
      type: 'progress',
      documentId: store.documentId,
      version: store.version,
      query: query.label,
      scannedLineCount,
      matchCount,
    })
  }

  yield freezeDoneEvent(store, query.label, scannedLineCount, matchCount <= maxResults, matchCount)
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

function formatSearchQuery(query: string | RegExp): string {
  return typeof query === 'string' ? query : query.toString()
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
  store: DocumentLineWindowSearchReadable,
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

function freezeDoneEvent(
  store: DocumentLineWindowSearchReadable,
  query: string,
  scannedLineCount: number,
  complete: boolean,
  matchCount: number,
): Extract<StoreSearchEvent, { readonly type: 'done' }> {
  return Object.freeze({
    type: 'done',
    documentId: store.documentId,
    version: store.version,
    query,
    scannedLineCount,
    complete,
    matchCount,
  })
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw signal.reason instanceof Error
      ? signal.reason
      : new DOMException('Search aborted', 'AbortError')
  }
}

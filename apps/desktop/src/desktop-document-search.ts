import {
  MemoryDocumentSource,
  searchDocumentLineWindows,
  type DocumentLineWindowSearchReadable,
  type EditorDocumentSource,
  type StoreSearchEvent,
  type StoreSearchMatch,
} from '@milkup/core'
import type { EditorState } from '@milkup/core'

export interface DesktopSearchRunOptions {
  readonly query: string
  readonly state?: EditorState
  readonly source?: EditorDocumentSource
  readonly documentId?: string
  readonly version?: number
  readonly maxResults?: number
  readonly windowSizeLines?: number
  readonly onUpdate?: (state: DesktopSearchState) => void
}

export type DesktopSearchPhase = 'idle' | 'searching' | 'done' | 'cancelled' | 'failed'

export interface DesktopSearchState {
  readonly phase: DesktopSearchPhase
  readonly query: string
  readonly matches: readonly StoreSearchMatch[]
  readonly scannedLineCount: number
  readonly complete: boolean
  readonly message?: string
}

export class DesktopDocumentSearchController {
  private activeAbort: AbortController | undefined

  cancel(): void {
    this.activeAbort?.abort(new Error('Search cancelled'))
    this.activeAbort = undefined
  }

  async run(options: DesktopSearchRunOptions): Promise<DesktopSearchState> {
    this.cancel()

    const query = options.query.trim()

    if (query.length === 0) {
      return emit(options.onUpdate, createState({ phase: 'idle', query }))
    }

    const source = resolveSearchSource(options)
    const abort = new AbortController()
    this.activeAbort = abort
    const matches: StoreSearchMatch[] = []
    const progressStride = (options.windowSizeLines ?? 512) * 8
    let lastProgressLineCount = 0
    let latest = emit(options.onUpdate, createState({ phase: 'searching', query }))

    try {
      for await (const event of searchDocumentLineWindows(source, {
        query,
        maxResults: options.maxResults ?? 200,
        windowSizeLines: options.windowSizeLines ?? 512,
        signal: abort.signal,
      })) {
        if (event.type === 'match') {
          matches.push(event.match)
          lastProgressLineCount = event.scannedLineCount
          latest = emit(options.onUpdate, stateFromEvent(event, query, matches, 'searching'))
        } else if (event.type === 'progress') {
          if (
            event.scannedLineCount > latest.scannedLineCount &&
            (event.scannedLineCount === source.lineCount ||
              event.scannedLineCount - lastProgressLineCount >= progressStride)
          ) {
            lastProgressLineCount = event.scannedLineCount
            latest = emit(options.onUpdate, stateFromEvent(event, query, matches, 'searching'))
          }
        } else {
          latest = emit(options.onUpdate, stateFromEvent(event, query, matches, 'done'))
        }
      }

      if (this.activeAbort === abort) {
        this.activeAbort = undefined
      }

      return latest
    } catch (error) {
      if (abort.signal.aborted) {
        const cancelled = createState({
          phase: 'cancelled',
          query,
          matches,
          scannedLineCount: latest.scannedLineCount,
          complete: false,
          message: getErrorMessage(error),
        })
        emit(options.onUpdate, cancelled)
        return cancelled
      }

      const failed = createState({
        phase: 'failed',
        query,
        matches,
        scannedLineCount: latest.scannedLineCount,
        complete: false,
        message: getErrorMessage(error),
      })
      emit(options.onUpdate, failed)
      return failed
    }
  }
}

function resolveSearchSource(options: DesktopSearchRunOptions): DocumentLineWindowSearchReadable {
  if (options.source) {
    return options.source
  }

  if (options.state) {
    return new MemoryDocumentSource({
      documentId: options.documentId ?? 'desktop-memory-search',
      document: options.state.doc,
      version: options.version ?? 0,
    })
  }

  throw new Error('Desktop search requires a document state or source')
}

function stateFromEvent(
  event: StoreSearchEvent,
  query: string,
  matches: readonly StoreSearchMatch[],
  phase: DesktopSearchPhase,
): DesktopSearchState {
  return createState({
    phase,
    query,
    matches,
    scannedLineCount: event.scannedLineCount,
    complete: event.type === 'done' ? event.complete : false,
  })
}

function createState(config: {
  readonly phase: DesktopSearchPhase
  readonly query: string
  readonly matches?: readonly StoreSearchMatch[]
  readonly scannedLineCount?: number
  readonly complete?: boolean
  readonly message?: string
}): DesktopSearchState {
  return Object.freeze({
    phase: config.phase,
    query: config.query,
    matches: Object.freeze([...(config.matches ?? [])]),
    scannedLineCount: config.scannedLineCount ?? 0,
    complete: config.complete ?? config.phase === 'idle',
    ...(config.message ? { message: config.message } : {}),
  })
}

function emit(
  onUpdate: ((state: DesktopSearchState) => void) | undefined,
  state: DesktopSearchState,
): DesktopSearchState {
  onUpdate?.(state)
  return state
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

import type { StoreSearchMatch } from '@milkup/core'
import type { DesktopLargeTextFileInvoke, DesktopLargeTextFileSnapshot } from './large-file-service'
export interface LargeSearchRequest {
  readonly documentId: string
  readonly expectedVersion: number
  readonly searchId: string
  readonly generation: number
  readonly query: string
  readonly caseSensitive: boolean
  readonly asciiFoldSafe: boolean
}
export interface LargeSearchProgress {
  readonly complete: boolean
  readonly matchCount: number
  readonly scannedLineCount: number
  readonly scannedBytes: number
  readonly nativeMs: number
  readonly indexBytes: number
  readonly fallback?: {
    readonly text: string
    readonly fromUtf16: number
    readonly fromLine: number
  }
}
export interface LargeSearchPage {
  readonly matches: readonly StoreSearchMatch[]
  readonly matchOffset: number
  readonly matchCount: number
}
export interface LargeReplaceRequest {
  readonly documentId: string
  readonly expectedVersion: number
  readonly searchId: string
  readonly replacementId: string
  readonly insert: string
  readonly selectedIndex: number | null
}
export interface LargeReplaceProgress {
  readonly ready: boolean
  readonly copiedBytes: number
  readonly totalBytes: number
  readonly replacedCount: number
}
export interface LargeReplaceResult {
  readonly snapshot: DesktopLargeTextFileSnapshot
  readonly historyId: string
}
export interface LargeSearchService {
  begin(request: LargeSearchRequest): Promise<void>
  step(searchId: string): Promise<LargeSearchProgress>
  append(
    searchId: string,
    matches: readonly (readonly number[])[],
    done: boolean,
  ): Promise<LargeSearchProgress>
  page(searchId: string, start: number): Promise<LargeSearchPage>
  cancel(searchId: string): Promise<void>
  beginReplacement(request: LargeReplaceRequest): Promise<LargeReplaceProgress>
  stepReplacement(replacementId: string): Promise<LargeReplaceProgress>
  commitReplacement(replacementId: string): Promise<LargeReplaceResult>
  cancelReplacement(replacementId: string): Promise<void>
  restore(
    documentId: string,
    expectedVersion: number,
    historyId: string,
    direction: 'undo' | 'redo',
  ): Promise<DesktopLargeTextFileSnapshot>
}
export function createLargeSearchService(
  invoke: DesktopLargeTextFileInvoke = loadInvoke,
): LargeSearchService {
  return {
    begin: (request) => invoke('begin_large_text_search', { request }),
    step: (searchId) => invoke('step_large_text_search', { searchId }),
    append: (searchId, matches, done) =>
      invoke('append_large_text_search_matches', { searchId, matches, done }),
    page: (searchId, start) => invoke('page_large_text_search', { searchId, start }),
    cancel: (searchId) => invoke('cancel_large_text_search', { searchId }),
    beginReplacement: (request) => invoke('begin_large_text_replacement', { request }),
    stepReplacement: (replacementId) => invoke('step_large_text_replacement', { replacementId }),
    commitReplacement: (replacementId) =>
      invoke('commit_large_text_replacement', { replacementId }),
    cancelReplacement: (replacementId) =>
      invoke('cancel_large_text_replacement', { replacementId }),
    restore: (documentId, expectedVersion, historyId, direction) =>
      invoke('restore_large_text_history', { documentId, expectedVersion, historyId, direction }),
  }
}
async function loadInvoke<T>(command: string, args?: unknown): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<T>(command, args as never)
}

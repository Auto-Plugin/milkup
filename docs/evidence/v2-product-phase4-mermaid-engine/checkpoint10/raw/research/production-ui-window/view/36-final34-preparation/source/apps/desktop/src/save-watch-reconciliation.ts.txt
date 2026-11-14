import { applyFileWatchEvent } from '@milkup/tauri-bridge'
import type { DocumentSession, FileWatchEvent } from '@milkup/tauri-bridge'

/** Retain ambiguous external changes observed during a write until the user resolves them. */
export function reconcileSaveWatchEvents(
  saved: DocumentSession,
  events: readonly FileWatchEvent[],
): DocumentSession {
  let next = saved
  for (const event of events) {
    // Save As can move the document. An event on the old path does not invalidate its new copy.
    if (event.documentId !== next.documentId || event.file.path !== next.file?.path) continue
    next = applyFileWatchEvent(next, event)
  }
  return next.externalChangeState === 'none'
    ? next
    : Object.freeze({ ...next, externalChangeState: 'conflict' })
}

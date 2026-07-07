import type { DocumentFileIdentity, DocumentSessionId } from '../session/document-session'

export const FILE_WATCH_EVENT_NAME = 'milkup-file-watch-event'

export type FileWatchEventKind = 'modified' | 'deleted'

export interface FileWatchEvent {
  readonly kind: FileWatchEventKind
  readonly documentId: DocumentSessionId
  readonly file: DocumentFileIdentity
  readonly diskSnapshotHash?: string
}

export function createFileWatchEvent(config: FileWatchEvent): FileWatchEvent {
  return Object.freeze({
    ...config,
    file: Object.freeze({ ...config.file }),
  })
}

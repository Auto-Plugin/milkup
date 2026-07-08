import { transactionChangesDocument, type Transaction } from '@milkup/core'
import type { OpenFileResult, SaveFileResult } from '../file/file-actions'
import type { FileWatchEvent } from '../file/file-watcher'
import { detectLineEnding, type LineEnding } from '../file/line-ending'

export type DocumentSessionId = string

export type ExternalChangeState = 'none' | 'modified-clean' | 'deleted-clean' | 'conflict'

export type SessionViewMode = 'source' | 'live'

export interface DocumentFileIdentity {
  readonly path: string
}

export interface DocumentSession {
  readonly documentId: DocumentSessionId
  readonly file: DocumentFileIdentity | undefined
  readonly documentVersion: number
  readonly savedVersion: number
  readonly diskSnapshotHash: string | undefined
  readonly dirty: boolean
  readonly readonly: boolean
  readonly externalChangeState: ExternalChangeState
  readonly lineEnding: LineEnding
  readonly viewMode: SessionViewMode
  readonly themeId: string | undefined
  readonly parserCacheVersion: number
}

export interface DocumentSessionConfig {
  readonly documentId: DocumentSessionId
  readonly file?: DocumentFileIdentity
  readonly diskSnapshotHash?: string
  readonly readonly?: boolean
  readonly lineEnding?: LineEnding
  readonly viewMode?: SessionViewMode
  readonly themeId?: string
}

export function createDocumentSession(config: DocumentSessionConfig): DocumentSession {
  return freezeSession({
    documentId: config.documentId,
    file: config.file,
    documentVersion: 0,
    savedVersion: 0,
    diskSnapshotHash: config.diskSnapshotHash,
    dirty: false,
    readonly: config.readonly ?? false,
    externalChangeState: 'none',
    lineEnding: config.lineEnding ?? 'lf',
    viewMode: config.viewMode ?? 'source',
    themeId: config.themeId,
    parserCacheVersion: 0,
  })
}

export function createDocumentSessionFromOpenResult(
  result: OpenFileResult,
  viewMode: SessionViewMode = 'source',
): DocumentSession {
  return createDocumentSession({
    documentId: result.documentId,
    file: result.file,
    diskSnapshotHash: result.diskSnapshotHash,
    readonly: result.readonly ?? false,
    lineEnding: detectLineEnding(result.text),
    viewMode,
  })
}

export function recordDocumentTransaction(
  session: DocumentSession,
  transaction: Transaction,
): DocumentSession {
  if (!transactionChangesDocument(transaction)) {
    return session
  }

  const documentVersion = session.documentVersion + 1

  return freezeSession({
    ...session,
    documentVersion,
    dirty: documentVersion !== session.savedVersion,
    externalChangeState:
      session.externalChangeState === 'none' ? session.externalChangeState : 'conflict',
  })
}

export interface FileSaveResult {
  readonly file?: DocumentFileIdentity
  readonly diskSnapshotHash?: string
}

export function recordFileSave(session: DocumentSession, result: FileSaveResult): DocumentSession {
  const file = result.file ?? session.file

  return freezeSession({
    ...session,
    ...(file === undefined ? {} : { file }),
    savedVersion: session.documentVersion,
    diskSnapshotHash: result.diskSnapshotHash ?? session.diskSnapshotHash,
    dirty: false,
    externalChangeState: 'none',
  })
}

export function recordFileSaveResult(
  session: DocumentSession,
  result: SaveFileResult,
): DocumentSession {
  if (result.documentId !== session.documentId) {
    throw new Error(
      `Save result documentId ${result.documentId} does not match session ${session.documentId}`,
    )
  }

  return recordFileSave(session, result)
}

export function recordFileReloadResult(
  session: DocumentSession,
  result: OpenFileResult,
): DocumentSession {
  assertReloadResultMatchesSession(session, result)

  if (session.externalChangeState !== 'modified-clean') {
    throw new Error(
      `Cannot reload session ${session.documentId} from external state ${session.externalChangeState}`,
    )
  }

  const documentVersion = session.documentVersion + 1

  return freezeSession({
    ...session,
    documentVersion,
    savedVersion: documentVersion,
    diskSnapshotHash: result.diskSnapshotHash,
    dirty: false,
    readonly: result.readonly ?? session.readonly,
    externalChangeState: 'none',
    lineEnding: detectLineEnding(result.text),
  })
}

export function recordSelectionChange(session: DocumentSession): DocumentSession {
  return session
}

export function recordModeChange(
  session: DocumentSession,
  viewMode: SessionViewMode,
): DocumentSession {
  if (session.viewMode === viewMode) {
    return session
  }

  return freezeSession({
    ...session,
    viewMode,
  })
}

export function recordThemeChange(session: DocumentSession, themeId: string): DocumentSession {
  if (session.themeId === themeId) {
    return session
  }

  return freezeSession({
    ...session,
    themeId,
  })
}

export function recordParserCacheUpdate(session: DocumentSession): DocumentSession {
  return freezeSession({
    ...session,
    parserCacheVersion: session.parserCacheVersion + 1,
  })
}

export function markSessionReadonly(session: DocumentSession, readonly: boolean): DocumentSession {
  if (session.readonly === readonly) {
    return session
  }

  return freezeSession({
    ...session,
    readonly,
  })
}

export function markExternalFileModified(session: DocumentSession): DocumentSession {
  return freezeSession({
    ...session,
    externalChangeState: session.dirty ? 'conflict' : 'modified-clean',
  })
}

export function markExternalFileDeleted(session: DocumentSession): DocumentSession {
  return freezeSession({
    ...session,
    externalChangeState: session.dirty ? 'conflict' : 'deleted-clean',
  })
}

export function applyFileWatchEvent(
  session: DocumentSession,
  event: FileWatchEvent,
): DocumentSession {
  assertFileWatchEventMatchesSession(session, event)

  if (isOwnSavedModifiedEvent(session, event)) {
    return session
  }

  return event.kind === 'modified'
    ? markExternalFileModified(session)
    : markExternalFileDeleted(session)
}

function isOwnSavedModifiedEvent(session: DocumentSession, event: FileWatchEvent): boolean {
  return (
    event.kind === 'modified' &&
    event.diskSnapshotHash !== undefined &&
    event.diskSnapshotHash === session.diskSnapshotHash
  )
}

function assertReloadResultMatchesSession(session: DocumentSession, result: OpenFileResult): void {
  if (result.documentId !== session.documentId) {
    throw new Error(
      `Reload result documentId ${result.documentId} does not match session ${session.documentId}`,
    )
  }

  if (!session.file) {
    throw new Error(`Reload result cannot be applied to unsaved session ${session.documentId}`)
  }

  if (result.file.path !== session.file.path) {
    throw new Error(
      `Reload result path ${result.file.path} does not match session path ${session.file.path}`,
    )
  }
}

function assertFileWatchEventMatchesSession(session: DocumentSession, event: FileWatchEvent): void {
  if (event.documentId !== session.documentId) {
    throw new Error(
      `File watch event documentId ${event.documentId} does not match session ${session.documentId}`,
    )
  }

  if (!session.file) {
    throw new Error(`File watch event cannot be applied to unsaved session ${session.documentId}`)
  }

  if (event.file.path !== session.file.path) {
    throw new Error(
      `File watch event path ${event.file.path} does not match session path ${session.file.path}`,
    )
  }
}

function freezeSession(session: DocumentSession): DocumentSession {
  return Object.freeze(session)
}

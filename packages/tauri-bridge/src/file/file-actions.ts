import type { DocumentFileIdentity, DocumentSessionId } from '../session/document-session'

export type FileActionKind = 'new' | 'open' | 'reload' | 'save' | 'saveAs' | 'revealInFolder'

export interface NewFileAction {
  readonly kind: 'new'
  readonly documentId: DocumentSessionId
}

export interface OpenFileAction {
  readonly kind: 'open'
  readonly path: string
}

export interface SaveFileAction {
  readonly kind: 'save'
  readonly documentId: DocumentSessionId
}

export interface ReloadFileAction {
  readonly kind: 'reload'
  readonly documentId: DocumentSessionId
  readonly path: string
}

export interface SaveAsFileAction {
  readonly kind: 'saveAs'
  readonly documentId: DocumentSessionId
  readonly path: string
}

export interface RevealInFolderAction {
  readonly kind: 'revealInFolder'
  readonly documentId: DocumentSessionId
}

export type FileAction =
  | NewFileAction
  | OpenFileAction
  | ReloadFileAction
  | SaveFileAction
  | SaveAsFileAction
  | RevealInFolderAction

export interface OpenFileResult {
  readonly documentId: DocumentSessionId
  readonly file: DocumentFileIdentity
  readonly text: string
  readonly diskSnapshotHash: string
  readonly readonly?: boolean
}

export interface SaveFileResult {
  readonly documentId: DocumentSessionId
  readonly file: DocumentFileIdentity
  readonly diskSnapshotHash: string
}

export function fileActionRequiresDocumentId(kind: FileActionKind): boolean {
  return kind !== 'open'
}

export function getFileActionDocumentId(action: FileAction): DocumentSessionId | undefined {
  return 'documentId' in action ? action.documentId : undefined
}

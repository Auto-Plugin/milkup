export {
  fileActionRequiresDocumentId,
  getFileActionDocumentId,
  type FileAction,
  type FileActionKind,
  type NewFileAction,
  type OpenFileAction,
  type OpenFileResult,
  type ReloadFileAction,
  type RevealInFolderAction,
  type SaveAsFileAction,
  type SaveFileAction,
  type SaveFileResult,
} from './file/file-actions'
export {
  createFileWatchEvent,
  FILE_WATCH_EVENT_NAME,
  type FileWatchEvent,
  type FileWatchEventKind,
} from './file/file-watcher'
export {
  detectLineEnding,
  normalizeLineEndings,
  prepareTextForFileSave,
  type LineEnding,
} from './file/line-ending'
export { recordRecentFile, removeRecentFile, type RecentFileEntry } from './file/recent-files'
export { getRevealTarget, type RevealTarget } from './file/reveal-target'
export {
  applyCloseDecision,
  evaluateCloseProtection,
  shouldPromptBeforeClose,
  type CloseProtectionDecision,
  type CloseRequest,
  type CloseScope,
  type CloseUserChoice,
} from './session/close-protection'
export {
  applyFileWatchEvent,
  createDocumentSessionFromOpenResult,
  createDocumentSession,
  markExternalFileDeleted,
  markExternalFileModified,
  markSessionReadonly,
  recordDocumentTransaction,
  recordFileSave,
  recordFileReloadResult,
  recordFileSaveResult,
  recordModeChange,
  recordParserCacheUpdate,
  recordSelectionChange,
  recordThemeChange,
  type DocumentFileIdentity,
  type DocumentSession,
  type DocumentSessionConfig,
  type DocumentSessionId,
  type ExternalChangeState,
  type SessionViewMode,
} from './session/document-session'
export {
  canSaveSession,
  getSaveSafety,
  type SaveBlockReason,
  type SaveSafety,
} from './session/save-safety'

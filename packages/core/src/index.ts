export { ChangeSet, type Change } from './change/change'
export { BasicEditor, type Command, type Editor } from './editor/editor'
export { createBuiltinActions } from './actions/builtin'
export {
  ActionRegistry,
  actionAllowed,
  assertActionAllowed,
  validateActionDefinition,
  validateActionInput,
  type ActionCategory,
  type ActionConfirmationRequest,
  type ActionContext,
  type ActionDefinition,
  type ActionInputField,
  type ActionInputSchema,
  type ActionPermission,
  type ActionRiskLevel,
  type ActionRunOptions,
} from './actions/registry'
export { EditorState, type EditorStateConfig } from './editor/state'
export { HistoryState, type HistoryEntry } from './history/history'
export { MemoryTextDocument, type Line, type TextDocument } from './text/document'
export {
  MemoryDocumentStore,
  type DocumentChunk,
  type DocumentLine,
  type DocumentLineWindow,
  type DocumentStore,
  type DocumentStoreFlushResult,
  type DocumentStoreSnapshot,
  type MemoryDocumentStoreConfig,
} from './store/document-store'
export {
  MemoryDocumentSource,
  type EditorDocumentSource,
  type EditorDocumentSourceSnapshot,
} from './store/editor-document-source'
export {
  LargeEditSession,
  largeTextEditsToChangeSet,
  type LargeEditSessionSnapshot,
  type LargeTextEdit,
  type LargeTextEditBatch,
} from './store/large-edit-session'
export {
  classifyDocumentScale,
  DEFAULT_DOCUMENT_SCALE_THRESHOLDS,
  getFeatureDegradationPolicy,
  GIB,
  MIB,
  resolveFeatureDegradationPolicy,
  type DocumentScaleInput,
  type DocumentScaleMode,
  type DocumentScaleThresholds,
  type FeatureDegradationPolicy,
  type LiveRenderStrategy,
  type ParseStrategy,
  type PluginRenderStrategy,
  type RenderStrategy,
  type SearchStrategy,
  type StoreStrategy,
} from './store/large-file-policy'
export {
  searchDocumentLineWindows,
  searchDocumentStore,
  type DocumentLineWindowSearchReadable,
  type StoreSearchEvent,
  type StoreSearchMatch,
  type StoreSearchOptions,
  type StoreSearchResult,
} from './store/store-search'
export { assertValidRange, type TextRange } from './position/range'
export { Selection, SelectionRange, type SelectionAffinity } from './selection/selection'
export {
  shouldAddToHistory,
  transactionChangesDocument,
  type Annotation,
  type HistoryGroup,
  type StateEffect,
  type Transaction,
  type TransactionOrigin,
  type TransactionOriginType,
} from './transaction/transaction'

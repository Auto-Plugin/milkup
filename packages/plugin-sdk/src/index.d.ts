export interface SdkChange {
  readonly from: number
  readonly to: number
  readonly insert: string
}

export interface SdkChangeSet {
  readonly changes: readonly SdkChange[]
  readonly empty: boolean
  mapPosition(position: number, affinity?: -1 | 1): number
}

export type SdkSelectionAffinity = 'forward' | 'backward' | 'none'

export interface SdkSelectionRange {
  readonly anchor: number
  readonly head: number
  readonly from: number
  readonly to: number
  readonly empty: boolean
  readonly affinity: SdkSelectionAffinity
}

export interface SdkSelection {
  readonly ranges: readonly SdkSelectionRange[]
  readonly mainIndex: number
  readonly main: SdkSelectionRange
}

export interface SdkEditor {
  readonly state: {
    readonly selection: SdkSelection
  }
  dispatch(transaction: SdkTransaction): void
}

export interface SdkPluginCommandContext {
  /** Per-command capabilities; workspace picker/open require a trusted user command. */
  readonly host?: SdkPluginCommandHost
  readonly editor?: SdkEditor
  readonly command?: {
    readonly action: string
  }
}

export interface SdkPluginStorage {
  getItem(key: string): Promise<string | null>
  setItem(key: string, value: string): Promise<void>
  removeItem(key: string): Promise<void>
  /** Optional on older hosts. Temporary pages are quota limited and never document recovery data. */
  createTemporaryStore?(): Promise<SdkTemporaryStore>
}

export interface SdkTemporaryStore {
  get(key: string): Promise<string | null>
  set(key: string, value: string): Promise<void>
  getMany(keys: readonly string[]): Promise<readonly (string | null)[]>
  setMany(entries: readonly { readonly key: string; readonly value: string }[]): Promise<void>
  dispose(): Promise<void>
}

export type SdkDocumentScanQuery =
  | { readonly kind: 'text'; readonly text: string; readonly caseSensitive?: boolean }
  | { readonly kind: 'regexp'; readonly pattern: string; readonly flags?: string }
  | { readonly kind: 'markdownHeadings'; readonly levels?: readonly number[] }

export interface SdkDocumentScanRequest {
  readonly query: SdkDocumentScanQuery
  readonly batchSize?: number
  readonly windowSizeLines?: number
  readonly maxResults?: number
  readonly fromLine?: number
  readonly toLine?: number
}

export type SdkDocumentScanItem =
  | {
      readonly id: string
      readonly kind: 'match'
      readonly from: number
      readonly to: number
      readonly line: number
      readonly lineOffset: number
      readonly text: string
      readonly textTruncated?: boolean
      readonly captures?: readonly string[]
    }
  | {
      readonly id: string
      readonly kind: 'heading'
      readonly from: number
      readonly to: number
      readonly line: number
      readonly lineOffset: number
      readonly level: number
      readonly label: string
      readonly labelTruncated?: boolean
      readonly labelFrom: number
      readonly labelTo: number
    }

export type SdkDocumentScanHeading = Extract<SdkDocumentScanItem, { readonly kind: 'heading' }>

interface SdkDocumentScanEventBase {
  readonly scanId: string
  readonly documentId: string
  readonly version: number
  readonly scannedLineCount: number
  readonly totalLineCount: number
  readonly resultCount: number
}

export type SdkDocumentScanEvent =
  | (SdkDocumentScanEventBase & {
      readonly type: 'batch'
      readonly items: readonly SdkDocumentScanItem[]
    })
  | (SdkDocumentScanEventBase & { readonly type: 'progress' })
  | (SdkDocumentScanEventBase & {
      readonly type: 'done'
      readonly complete: boolean
      readonly reason: 'complete' | 'cancelled' | 'invalidated' | 'truncated'
      readonly currentVersion?: number
    })

export interface SdkDocumentScanner extends AsyncIterable<SdkDocumentScanEvent> {
  cancel(): Promise<void>
}

export interface SdkPluginDocumentHost {
  scan(request: SdkDocumentScanRequest): SdkDocumentScanner
}

export interface SdkPluginUiHost {
  requestUpdate(viewId?: string): Promise<void>
  revealLine(line: number): Promise<void>
}

/** Host-issued handles are valid only within the current activation and root grant. */
export interface SdkWorkspaceRoot {
  readonly id: string
  /** Stable plugin-storage partition key. Never an authorization token. */
  readonly key: string
  readonly label: string
}
export interface SdkWorkspaceEntry {
  readonly id: string
  readonly name: string
  readonly kind: 'file' | 'directory'
  readonly relativePath: string
}
export interface SdkWorkspacePage {
  readonly entries: readonly SdkWorkspaceEntry[]
  readonly nextCursor: string | null
}
export interface SdkWorkspaceOperationOptions {
  readonly signal?: AbortSignal
}
export interface SdkWorkspaceListOptions extends SdkWorkspaceOperationOptions {
  readonly directoryId?: string
  readonly cursor?: string
  /** Integer 1..200; defaults to 100. */
  readonly limit?: number
}
export interface SdkPluginWorkspaceReadHost {
  /** Omitting cursor restarts this directory enumeration and invalidates old cursors. */
  listChildren(rootId: string, options?: SdkWorkspaceListOptions): Promise<SdkWorkspacePage>
  resolveEntry(
    rootId: string,
    relativePath: string,
    options?: SdkWorkspaceOperationOptions,
  ): Promise<SdkWorkspaceEntry | null>
  /** Returns a new root grant; all old entries and cursors are invalidated. */
  refreshRoot(rootId: string, options?: SdkWorkspaceOperationOptions): Promise<SdkWorkspaceRoot>
  releaseRoot(rootId: string): Promise<void>
}
export interface SdkPluginWorkspaceHost extends SdkPluginWorkspaceReadHost {
  chooseRoot(options?: SdkWorkspaceOperationOptions): Promise<SdkWorkspaceRoot | null>
  /** Always uses the trusted host's single-document save/conflict/recovery guard. */
  requestOpen(
    fileId: string,
    options?: SdkWorkspaceOperationOptions,
  ): Promise<{ readonly status: 'opened' | 'cancelled' }>
}
export interface SdkPluginCommandHost extends SdkPluginHost {
  readonly workspace?: SdkPluginWorkspaceHost
}

/** Host-managed releases; requires the sensitive app:updates permission (SDK 0.2.0). */
export interface SdkPluginReleasesHost {
  check(): Promise<SdkReleaseCheckResult>
  /** Starts background signed staging; poll status for completion. */
  stage(releaseId: string): Promise<void>
  status(releaseId: string): Promise<SdkReleaseStatus>
  cancel(releaseId: string): Promise<void>
  /** Always passes through trusted host confirmation and dirty-document save handling. */
  requestInstall(releaseId: string): Promise<SdkReleaseInstallResult>
}

export interface SdkReleaseCheckResult {
  readonly configured: boolean
  readonly channel: string
  readonly currentVersion: string
  readonly release?: {
    /** Opaque host-issued ID. Never a URL, path, payload or signing key. */
    readonly id: string
    readonly version: string
    readonly notes: string
    readonly date: string | null
  }
}

export interface SdkReleaseStatus {
  readonly phase: 'available' | 'downloading' | 'verifying' | 'ready' | 'error'
  readonly received: number
  readonly total: number | null
  readonly error?: string
}

export interface SdkReleaseInstallResult {
  readonly status: 'cancelled' | 'installing'
}

export interface SdkPluginHost {
  readonly workspace?: SdkPluginWorkspaceReadHost
  readonly releases?: SdkPluginReleasesHost
  readonly document?: SdkPluginDocumentHost
  readonly ui?: SdkPluginUiHost
  readonly storage?: SdkPluginStorage
  readText?(path: string): Promise<string>
  writeText?(path: string, text: string): Promise<void>
  deleteFile?(path: string): Promise<void>
  fetch?(url: string, init?: unknown): Promise<unknown>
}

export interface SdkPluginActivationContext {
  readonly pluginId: string
  readonly permissions: readonly string[]
  readonly host: SdkPluginHost
}

/** Logical document lines are one-based and inclusive, independent of visual wrapping. */
export interface SdkPluginViewport {
  readonly fromLine: number
  readonly toLine: number
  readonly activeLine: number
}

/** Item indices are zero-based; toIndex is exclusive. Requests are coalesced by the host. */
export interface SdkPluginVirtualViewport {
  readonly id: string
  readonly fromIndex: number
  readonly toIndex: number
  readonly userInitiated?: boolean
  readonly edge?: 'before' | 'after'
  readonly requestId?: number
}

export type SdkPluginUiPhase = 'mount' | 'update' | 'focus' | 'blur' | 'dispose'

/** UI lifecycle snapshot. dispose may contain only phase and documentId. */
export interface SdkPluginUiNode {
  /** Actual host view visibility; false when collapsed. Older hosts default to true. */
  readonly visible?: boolean
  readonly phase?: SdkPluginUiPhase
  readonly documentId?: string
  readonly documentVersion?: number
  readonly documentLineCount?: number
  readonly viewMode?: 'source' | 'live'
  readonly viewport?: SdkPluginViewport
  readonly virtualViewport?: SdkPluginVirtualViewport
}

/** Public UI renderer context; this exposes snapshots, never host DOM or stores. */
export interface SdkPluginRendererContext {
  readonly nodeType?: string
  readonly source?: string
  readonly node?: SdkPluginUiNode
}

export type SdkPluginCommandHandler = (
  context: SdkPluginCommandContext,
  input: unknown,
) => unknown | Promise<unknown>

export type SdkPluginRenderer = (
  context: SdkPluginRendererContext,
) => SdkRendererOutput | Promise<SdkRendererOutput>

export interface SdkPluginActivation {
  readonly commands?: Readonly<Record<string, SdkPluginCommandHandler>>
  readonly renderers?: Readonly<Record<string, SdkPluginRenderer>>
  dispose?(): void | Promise<void>
}

export interface SdkPluginModule {
  readonly commands?: Readonly<Record<string, SdkPluginCommandHandler>>
  readonly renderers?: Readonly<Record<string, SdkPluginRenderer>>
  activate?(
    context: SdkPluginActivationContext,
  ): SdkPluginActivation | void | Promise<SdkPluginActivation | void>
  deactivate?(): void | Promise<void>
}

/** Type-check a module without registering it or adding runtime host dependencies. */
export function definePlugin<T extends SdkPluginModule>(plugin: T): T

export type SdkRendererAttribute =
  | 'class'
  | 'title'
  | 'href'
  | 'role'
  | 'aria-label'
  | 'aria-current'
  | 'aria-level'
  | 'aria-expanded'
  | 'data-host-icon'
  | 'data-virtual-list'
  | 'data-virtual-total'
  | 'data-virtual-start'
  | 'data-virtual-end'
  | 'data-virtual-item-height'
  | 'data-virtual-active'
  | 'data-virtual-follow-active'
  | 'data-virtual-has-before'
  | 'data-virtual-has-after'
  | 'data-virtual-scroll-adjust'
  | 'data-virtual-revision'

export type SdkRendererOutput =
  | string
  | number
  | boolean
  | {
      readonly type: 'element'
      readonly tag: 'span' | 'strong' | 'em' | 'code' | 'a' | 'button'
      readonly text?: string
      readonly children?: readonly SdkRendererOutput[]
      readonly attributes?: Readonly<Partial<Record<SdkRendererAttribute, string>>>
      readonly action?: { readonly command: string; readonly input?: unknown }
    }

export interface SdkTransaction {
  readonly changes?: SdkChangeSet
  readonly selection?: SdkSelection
  readonly origin?: {
    readonly type: 'command'
    readonly id?: string
  }
  readonly historyGroup?: 'merge' | 'isolate'
}

export interface DispatchInsertOptions {
  readonly commandId?: string
  readonly historyGroup?: 'merge' | 'isolate'
}

export function insertText(position: number, text: string): SdkChangeSet
export function deleteRange(from: number, to: number): SdkChangeSet
export function replaceRange(from: number, to: number, text: string): SdkChangeSet
export function cursor(position: number): SdkSelection
export function rangeSelection(anchor: number, head: number): SdkSelection
export function dispatchInsert(
  context: SdkPluginCommandContext,
  text: string,
  options?: DispatchInsertOptions,
): void

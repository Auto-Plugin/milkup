export interface SdkEditingOperationOptions {
  readonly signal?: AbortSignal
}
export interface SdkEditingRange {
  readonly from: number
  readonly to: number
}
export interface SdkEditingSelection {
  readonly anchor: number
  readonly head: number
}
export interface SdkEditingCaptureRequest {
  readonly extent: 'selection' | 'lines'
  readonly beforeLines?: number
  readonly afterLines?: number
}
export interface SdkEditingSyntaxNode extends SdkEditingRange {
  readonly type: string
  readonly status: 'valid' | 'incomplete' | 'invalid' | 'fallback'
  readonly markerRanges: readonly SdkEditingRange[]
  readonly contentRanges?: readonly SdkEditingRange[]
}
export interface SdkEditingSnapshot extends SdkEditingRange {
  readonly id: string
  readonly documentId: string
  readonly version: number
  readonly selectionRevision: number
  readonly saveLocationGeneration: number
  readonly text: string
  readonly selection: SdkEditingSelection
  readonly startLine: number
  readonly lineCount: number
  readonly lineEnding: 'lf' | 'crlf'
  readonly mode: 'memory' | 'windowed'
  readonly context?: {
    readonly kind: 'text' | 'code' | 'table' | 'unknown'
    readonly complete: boolean
  }
  readonly syntax?: { readonly nodes: readonly SdkEditingSyntaxNode[] }
  readonly table?: {
    readonly row: number
    readonly column: number
    readonly rowCount: number
    readonly columnCount: number
    readonly alignment: 'left' | 'center' | 'right' | 'default'
    readonly withinCell: boolean
  }
}
export interface SdkEditingApplyRequest {
  readonly snapshotId: string
  readonly changes: readonly (SdkEditingRange & { readonly insert: string })[]
  readonly selection?: SdkEditingSelection
  readonly assetIds?: readonly string[]
}
export type SdkEditingTableRequest =
  | {
      readonly snapshotId: string
      readonly operation: 'insert-table'
      readonly rows: number
      readonly columns: number
    }
  | {
      readonly snapshotId: string
      readonly operation: 'align-column'
      readonly alignment: 'left' | 'center' | 'right' | 'default'
    }
  | { readonly snapshotId: string; readonly operation: 'set-cell'; readonly text: string }
  | {
      readonly snapshotId: string
      readonly operation:
        | 'add-row'
        | 'delete-row'
        | 'add-column'
        | 'delete-column'
        | 'clear-cell'
        | 'select-cell'
        | 'select-table'
        | 'exit'
    }
export interface SdkEditingApplyResult {
  readonly documentId: string
  readonly version: number
}
export interface SdkPluginEditingHost {
  capture(
    request: SdkEditingCaptureRequest,
    options?: SdkEditingOperationOptions,
  ): Promise<SdkEditingSnapshot>
  apply(
    request: SdkEditingApplyRequest,
    options?: SdkEditingOperationOptions,
  ): Promise<SdkEditingApplyResult>
  table(
    request: SdkEditingTableRequest,
    options?: SdkEditingOperationOptions,
  ): Promise<SdkEditingApplyResult>
  release(id: string, options?: SdkEditingOperationOptions): Promise<void>
}
export interface SdkResourcesOperationOptions {
  readonly signal?: AbortSignal
}
export interface SdkResourcesPrepareRequest {
  readonly pasteId?: string
}
export type SdkResourcesPrepareResult =
  { readonly status: 'ready'; readonly id: string } | { readonly status: 'cancelled' }
export type SdkResourcesMimeType = 'image/png' | 'image/jpeg' | 'image/webp'
export interface SdkResourcesSource {
  readonly id: string
  readonly name: string
  readonly mimeType: SdkResourcesMimeType
  readonly sizeBytes: number
}
export interface SdkResourcesStageRequest {
  readonly sourceId: string
  readonly snapshotId: string
  readonly strategy: 'assets' | 'document-assets'
}
export interface SdkResourcesAsset {
  readonly id: string
  readonly reference: string
  readonly mimeType: SdkResourcesMimeType
  readonly width: number
  readonly height: number
  readonly sizeBytes: number
}
export interface SdkPluginResourcesHost {
  prepareDocument(
    request?: SdkResourcesPrepareRequest,
    options?: SdkResourcesOperationOptions,
  ): Promise<SdkResourcesPrepareResult>
  choose(
    intentId: string,
    options?: SdkResourcesOperationOptions,
  ): Promise<SdkResourcesSource | null>
  stage(
    request: SdkResourcesStageRequest,
    options?: SdkResourcesOperationOptions,
  ): Promise<SdkResourcesAsset>
  abort(id: string, options?: SdkResourcesOperationOptions): Promise<void>
}
export interface SdkKeymapCommand {
  readonly id: string
  readonly title: string
  readonly category: string
  readonly defaultKeys: readonly string[]
  readonly keys: readonly string[]
  readonly available: boolean
  readonly bindable: boolean
  readonly input?: string
}
export interface SdkKeymapSnapshot {
  readonly revision: number
  readonly commands: readonly SdkKeymapCommand[]
  readonly fixedShortcuts: readonly {
    readonly keys: string
    readonly title: string
    readonly description: string
  }[]
  readonly error?: string
}
export interface SdkKeymapUpdate {
  readonly revision: number
  readonly bindings: readonly { readonly command: string; readonly keys: readonly string[] }[]
}
export interface SdkKeymapOperationOptions {
  readonly signal?: AbortSignal
}
export interface SdkPluginKeymapHost {
  snapshot(options?: SdkKeymapOperationOptions): Promise<SdkKeymapSnapshot>
  update(input: SdkKeymapUpdate, options?: SdkKeymapOperationOptions): Promise<SdkKeymapSnapshot>
  reset(
    input: { readonly revision: number },
    options?: SdkKeymapOperationOptions,
  ): Promise<SdkKeymapSnapshot>
}

export type SdkSettingsScope = 'application' | 'plugin'
export type SdkSettingsValue = string | number | boolean
export type SdkSettingsValues = Readonly<Record<string, SdkSettingsValue>>
export type SdkSettingsField =
  | { readonly type: 'enum'; readonly options: readonly (string | number)[] }
  | {
      readonly type: 'number'
      readonly minimum: number
      readonly maximum: number
      readonly step?: number
      readonly allowZero?: boolean
    }
  | { readonly type: 'boolean' }
export type SdkSettingsSchema = Readonly<Record<string, SdkSettingsField>>
export interface SdkSettingsDescriptor {
  readonly schema: SdkSettingsSchema
  readonly defaults: SdkSettingsValues
}
export interface SdkSettingsSnapshot extends SdkSettingsDescriptor {
  readonly revision: number
  readonly values: SdkSettingsValues
}
export interface SdkSettingsTransaction {
  readonly id: string
  readonly snapshot: SdkSettingsSnapshot
}
export interface SdkSettingsOperationOptions {
  readonly signal?: AbortSignal
}
export interface SdkPluginSettingsHost {
  describe(
    scope: SdkSettingsScope,
    options?: SdkSettingsOperationOptions,
  ): Promise<SdkSettingsDescriptor>
  get(scope: SdkSettingsScope, options?: SdkSettingsOperationOptions): Promise<SdkSettingsSnapshot>
  begin(
    scope: SdkSettingsScope,
    options?: SdkSettingsOperationOptions,
  ): Promise<SdkSettingsTransaction>
  preview(
    id: string,
    patch: SdkSettingsValues,
    options?: SdkSettingsOperationOptions,
  ): Promise<SdkSettingsSnapshot>
  commit(id: string, options?: SdkSettingsOperationOptions): Promise<SdkSettingsSnapshot>
  cancel(id: string, options?: SdkSettingsOperationOptions): Promise<void>
}

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

export interface SdkDocumentOperationOptions {
  readonly signal?: AbortSignal
}
export interface SdkDocumentReadWindowRequest {
  readonly documentId: string
  readonly version: number
  readonly fromLine: number
  readonly lineCount: number
}
export interface SdkDocumentReadWindowResult {
  readonly documentId: string
  readonly version: number
  readonly fromLine: number
  readonly toLine: number
  readonly from: number
  readonly to: number
  readonly text: string
  readonly totalLines: number
  readonly completeStart: boolean
  readonly completeEnd: boolean
  readonly lines: readonly {
    readonly number: number
    readonly from: number
    readonly to: number
    readonly text: string
  }[]
}
export interface SdkDocumentInvalidatePresentationRequest {
  readonly documentId: string
  readonly version: number
  readonly rendererId: string
}
export interface SdkUiRevealLocationRequest {
  readonly documentId: string
  readonly version: number
  readonly from: number
  readonly to?: number
}
export interface SdkPluginDocumentHost {
  readWindow(
    request: SdkDocumentReadWindowRequest,
    options?: SdkDocumentOperationOptions,
  ): Promise<SdkDocumentReadWindowResult>
  invalidatePresentation(request: SdkDocumentInvalidatePresentationRequest): Promise<void>
  scan(request: SdkDocumentScanRequest): SdkDocumentScanner
}

export interface SdkPluginUiHost {
  revealLocation(
    request: SdkUiRevealLocationRequest,
    options?: SdkDocumentOperationOptions,
  ): Promise<void>
  open(viewId: string): Promise<void>
  notify(notice: { readonly kind: 'info' | 'error'; readonly message: string }): Promise<void>
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
  readonly editing?: SdkPluginEditingHost
  readonly resources?: SdkPluginResourcesHost
  readonly workspace?: SdkPluginWorkspaceReadHost
  readonly keymap?: SdkPluginKeymapHost
  readonly settings?: SdkPluginSettingsHost
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
  readonly documentEditable?: boolean
  readonly selectionRevision?: number
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
  readonly documentRenderers?: Readonly<Record<string, SdkDocumentRenderer>>
  readonly commands?: Readonly<Record<string, SdkPluginCommandHandler>>
  readonly renderers?: Readonly<Record<string, SdkPluginRenderer>>
  dispose?(): void | Promise<void>
}

export interface SdkPluginModule {
  readonly documentRenderers?: Readonly<Record<string, SdkDocumentRenderer>>
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

export interface SdkRendererField {
  readonly type: 'field'
  readonly key: string
  readonly kind: 'text' | 'number' | 'select'
  readonly label: string
  readonly value: string
  readonly onChange: { readonly command: string }
  readonly options?: readonly {
    readonly value: string
    readonly label: string
    readonly disabled?: boolean
  }[]
  readonly disabled?: boolean
  readonly invalid?: boolean
  readonly help?: string
  readonly placeholder?: string
  readonly min?: number
  readonly max?: number
  readonly step?: number
}
export type SdkRendererOutput =
  | SdkRendererField
  | string
  | number
  | boolean
  | {
      readonly type: 'element'
      readonly tag: 'span' | 'strong' | 'em' | 'code' | 'a' | 'button'
      /** Host only permits disabled on button elements. */
      readonly disabled?: boolean
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

/** Shared, inert document presentation data. All source offsets are absolute UTF-16. */
export interface SdkDocumentPresentationRange {
  readonly from: number
  readonly to: number
}
export interface SdkDocumentPresentationBlock extends SdkDocumentPresentationRange {
  readonly kind: 'text' | 'fence' | 'code' | 'unknown'
  readonly complete: boolean
  readonly info?: string
  readonly contentRanges: readonly SdkDocumentPresentationRange[]
}
export interface SdkDocumentPresentationRequest extends SdkDocumentPresentationRange {
  readonly documentId: string
  readonly version: number
  readonly source: string
  readonly fromLine: number
  readonly toLine: number
  readonly completeStart: boolean
  readonly completeEnd: boolean
  readonly contextKnown: boolean
  readonly protectedRanges: readonly SdkDocumentPresentationRange[]
  readonly blocks: readonly SdkDocumentPresentationBlock[]
  readonly selection: { readonly anchor: number; readonly head: number }
  readonly theme: 'light' | 'dark'
  readonly target: 'screen' | 'export'
  readonly width: number
}
export type SdkDocumentPresentationTone =
  'foreground' | 'muted' | 'accent' | 'background' | 'border'
export type SdkDocumentMathTag =
  | 'math'
  | 'mrow'
  | 'mi'
  | 'mn'
  | 'mo'
  | 'mtext'
  | 'mspace'
  | 'msup'
  | 'msub'
  | 'msubsup'
  | 'mfrac'
  | 'msqrt'
  | 'mroot'
  | 'mover'
  | 'munder'
  | 'munderover'
  | 'mtable'
  | 'mtr'
  | 'mtd'
  | 'mstyle'
export interface SdkDocumentMathNode {
  readonly tag: SdkDocumentMathTag
  readonly text?: string
  readonly children?: readonly SdkDocumentMathNode[]
  readonly attributes?: {
    readonly scriptLevel?: number
    readonly displayStyle?: boolean
    readonly rowSpacingEm?: readonly number[]
    readonly columnSpacingEm?: readonly number[]
    readonly columnAlign?: readonly ('left' | 'center' | 'right')[]
    readonly widthEm?: number
    readonly lspaceEm?: number
    readonly rspaceEm?: number
    readonly display?: 'inline' | 'block'
    readonly mathvariant?:
      | 'normal'
      | 'bold'
      | 'italic'
      | 'bold-italic'
      | 'double-struck'
      | 'script'
      | 'fraktur'
      | 'monospace'
    readonly stretchy?: boolean
    readonly fence?: boolean
    readonly separator?: boolean
    readonly accent?: boolean
  }
}
export interface SdkDocumentVectorStyle {
  readonly stroke?: SdkDocumentPresentationTone
  readonly fill?: SdkDocumentPresentationTone | 'none'
  readonly strokeWidth?: number
}
export type SdkDocumentVectorPrimitive =
  | (SdkDocumentVectorStyle & {
      readonly type: 'rect'
      readonly x: number
      readonly y: number
      readonly width: number
      readonly height: number
      readonly radius?: number
    })
  | (SdkDocumentVectorStyle & {
      readonly type: 'ellipse'
      readonly cx: number
      readonly cy: number
      readonly rx: number
      readonly ry: number
    })
  | (SdkDocumentVectorStyle & {
      readonly type: 'line'
      readonly x1: number
      readonly y1: number
      readonly x2: number
      readonly y2: number
    })
  | (SdkDocumentVectorStyle & {
      readonly type: 'polyline' | 'polygon'
      readonly points: readonly { readonly x: number; readonly y: number }[]
    })
  | {
      readonly type: 'text'
      readonly x: number
      readonly y: number
      readonly text: string
      readonly tone?: SdkDocumentPresentationTone
      readonly fontSize?: number
      readonly anchor?: 'start' | 'middle' | 'end'
    }
export type SdkDocumentPresentationNode =
  | SdkDocumentSvgImage
  | { readonly type: 'text'; readonly text: string }
  | {
      readonly type: 'group' | 'emphasis' | 'code' | 'sup' | 'sub'
      readonly children: readonly SdkDocumentPresentationNode[]
    }
  | {
      readonly type: 'reference'
      readonly label: string
      readonly target: {
        readonly documentId: string
        readonly version: number
        readonly from: number
        readonly to: number
      }
    }
  | { readonly type: 'math'; readonly tree: SdkDocumentMathNode }
  | {
      readonly type: 'vector'
      readonly width: number
      readonly height: number
      readonly children: readonly SdkDocumentVectorPrimitive[]
    }
export interface SdkDocumentPresentationFragment extends SdkDocumentPresentationRange {
  readonly layout: 'inline' | 'block'
  readonly content: SdkDocumentPresentationNode
  readonly accessibleText: string
  readonly status?: 'ready' | 'error'
  readonly message?: string
}
export interface SdkDocumentPresentationResult {
  readonly fragments: readonly SdkDocumentPresentationFragment[]
  readonly complete: boolean
}
export interface SdkDocumentRendererDeclaration {
  readonly id: string
  readonly contexts: readonly ('text' | 'fence')[]
  readonly fenceLanguages?: readonly string[]
}
export type SdkDocumentRenderer = (
  request: SdkDocumentPresentationRequest,
  options: { readonly signal: AbortSignal },
) => SdkDocumentPresentationResult | Promise<SdkDocumentPresentationResult>

/** Closed, inert SVG image data. No raw markup, CSS, URLs or host objects. */
export type SdkDocumentSvgRgba = readonly [r: number, g: number, b: number, a: number]
export type SdkDocumentSvgLength = {
  readonly value: number
  readonly unit: 'user' | 'px' | 'em' | 'percent'
}
export type SdkDocumentSvgMatrix = readonly [
  a: number,
  b: number,
  c: number,
  d: number,
  e: number,
  f: number,
]
export type SdkDocumentSvgBox = readonly [x: number, y: number, width: number, height: number]
/** Local opaque IDs only, never URI strings; reference kind is also checked. */
export type SdkDocumentSvgLocalId = string
export type SdkDocumentSvgStyleId = number
export type SdkDocumentSvgPaint =
  | { readonly kind: 'none' }
  | { readonly kind: 'color'; readonly rgba: SdkDocumentSvgRgba }
  | { readonly kind: 'gradient'; readonly ref: SdkDocumentSvgLocalId }
export type SdkDocumentSvgTransform =
  | { readonly kind: 'matrix'; readonly values: SdkDocumentSvgMatrix }
  | { readonly kind: 'translate'; readonly x: number; readonly y: number }
  | { readonly kind: 'scale'; readonly x: number; readonly y: number }
  | { readonly kind: 'rotate'; readonly degrees: number; readonly cx: number; readonly cy: number }
  | { readonly kind: 'skewX' | 'skewY'; readonly degrees: number }
export type SdkDocumentSvgPathCommand =
  | readonly ['M' | 'm' | 'L' | 'l' | 'T' | 't', number, number]
  | readonly ['H' | 'h' | 'V' | 'v', number]
  | readonly ['C' | 'c', number, number, number, number, number, number]
  | readonly ['S' | 's' | 'Q' | 'q', number, number, number, number]
  | readonly ['A' | 'a', number, number, number, 0 | 1, 0 | 1, number, number]
  | readonly ['Z' | 'z']
export type SdkDocumentSvgShadow = {
  readonly dx: number
  readonly dy: number /** CSS blurRadius differs from SVG stdDeviation. */
  readonly blur: number
  readonly color: SdkDocumentSvgRgba
}
export type SdkDocumentSvgFilterValue =
  | { readonly kind: 'none' }
  | { readonly kind: 'unresolved-local' }
  | { readonly kind: 'definition'; readonly ref: SdkDocumentSvgLocalId }
  | { readonly kind: 'cssDropShadow'; readonly shadows: readonly SdkDocumentSvgShadow[] }
/** No arbitrary styles. A deduplicated entry describes this element, not descendants. */
export interface SdkDocumentSvgStyle {
  readonly shapeRendering?: 'auto' | 'optimizeSpeed' | 'crispEdges' | 'geometricPrecision'
  readonly fill?: SdkDocumentSvgPaint
  readonly stroke?: SdkDocumentSvgPaint
  readonly fillOpacity?: number
  readonly strokeOpacity?: number
  readonly opacity?: number
  readonly fillRule?: 'nonzero' | 'evenodd'
  readonly clipRule?: 'nonzero' | 'evenodd'
  readonly strokeWidth?: SdkDocumentSvgLength
  readonly dashArray?: readonly SdkDocumentSvgLength[]
  readonly dashOffset?: SdkDocumentSvgLength
  readonly lineCap?: 'butt' | 'round' | 'square'
  readonly lineJoin?: 'miter' | 'round' | 'bevel'
  readonly miterLimit?: number
  readonly display?: 'inline' | 'none'
  readonly visibility?: 'visible' | 'hidden' | 'collapse'
  readonly overflow?: 'visible' | 'hidden'
  readonly mixBlendMode?: 'normal' | 'multiply'
  readonly isolation?: 'auto' | 'isolate'
  readonly filter?: SdkDocumentSvgFilterValue
  readonly clipPath?: SdkDocumentSvgLocalId
  readonly colorInterpolation?: 'sRGB' | 'linearRGB'
  readonly colorInterpolationFilters?: 'sRGB' | 'linearRGB'
  /** Host-approved offline font mapping; never a CSS or URL string. */
  readonly fontId?:
    | 'sans'
    | 'arial-sans'
    | 'open-sans-sans'
    | 'trebuchet-verdana-arial-sans'
    | 'serif'
    | 'monospace'
  readonly fontSize?: SdkDocumentSvgLength
  readonly fontWeight?: 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900
  readonly fontStyle?: 'normal' | 'italic' | 'oblique'
  readonly letterSpacing?: SdkDocumentSvgLength
  readonly wordSpacing?: SdkDocumentSvgLength
  readonly textAnchor?: 'start' | 'middle' | 'end'
  readonly dominantBaseline?:
    | 'auto'
    | 'alphabetic'
    | 'central'
    | 'middle'
    | 'hanging'
    | 'text-before-edge'
    | 'text-after-edge'
  readonly alignmentBaseline?:
    | 'auto'
    | 'baseline'
    | 'alphabetic'
    | 'central'
    | 'middle'
    | 'hanging'
    | 'before-edge'
    | 'after-edge'
  readonly decoration?: 'none' | 'underline' | 'overline' | 'line-through'
  readonly whiteSpace?: 'normal' | 'pre' | 'pre-wrap' | 'nowrap'
  readonly textTransform?: 'none' | 'uppercase' | 'lowercase' | 'capitalize'
}
export interface SdkDocumentSvgCommon {
  readonly style?: SdkDocumentSvgStyleId
  readonly transforms?: readonly SdkDocumentSvgTransform[]
  /** Typed local origin, only if helper cannot safely canonicalize CSS transform. */
  readonly transformOrigin?: readonly [SdkDocumentSvgLength, SdkDocumentSvgLength]
  readonly transformBox?: 'fill-box' | 'stroke-box' | 'view-box'
  readonly title?: string
  readonly description?: string
}
export interface SdkDocumentSvgMarked extends SdkDocumentSvgCommon {
  readonly markerStart?: SdkDocumentSvgLocalId
  readonly markerMid?: SdkDocumentSvgLocalId
  readonly markerEnd?: SdkDocumentSvgLocalId
}
export type SdkDocumentSvgTextChild =
  { readonly kind: 'textRun'; readonly text: string } | SdkDocumentSvgTspan
export interface SdkDocumentSvgTspan extends SdkDocumentSvgCommon {
  readonly kind: 'tspan'
  readonly x?: readonly SdkDocumentSvgLength[]
  readonly y?: readonly SdkDocumentSvgLength[]
  readonly dx?: readonly SdkDocumentSvgLength[]
  readonly dy?: readonly SdkDocumentSvgLength[]
  readonly xmlSpace?: 'default' | 'preserve'
  readonly children: readonly SdkDocumentSvgTextChild[]
}
export interface SdkDocumentSvgText extends SdkDocumentSvgCommon {
  readonly kind: 'text'
  readonly xmlSpace?: 'default' | 'preserve'
  readonly x?: readonly SdkDocumentSvgLength[]
  readonly y?: readonly SdkDocumentSvgLength[]
  readonly dx?: readonly SdkDocumentSvgLength[]
  readonly dy?: readonly SdkDocumentSvgLength[]
  readonly children: readonly SdkDocumentSvgTextChild[]
}
/** Canonical serializer emits exactly div(table)>div(table-cell)>plain text.
 * No XHTML tree, attributes, class, style-string or HTML escapes are accepted.
 */
export interface SdkDocumentSvgTextBox extends SdkDocumentSvgCommon {
  readonly kind: 'textBox'
  readonly box: SdkDocumentSvgBox
  readonly text: string
  readonly outerBoxSizing?: 'content-box' | 'border-box'
  readonly innerBoxSizing?: 'content-box' | 'border-box'
  readonly textTransform?: 'none' | 'uppercase' | 'lowercase' | 'capitalize'
  readonly letterSpacing?: SdkDocumentSvgLength
  readonly wordSpacing?: SdkDocumentSvgLength
  readonly decoration?: 'none' | 'underline' | 'overline' | 'line-through'
  readonly color: SdkDocumentSvgRgba
  readonly background?: SdkDocumentSvgRgba
  readonly fontId:
    | 'sans'
    | 'arial-sans'
    | 'open-sans-sans'
    | 'trebuchet-verdana-arial-sans'
    | 'serif'
    | 'monospace'
  readonly fontSizePx: number
  readonly fontWeight: 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900
  readonly fontStyle: 'normal' | 'italic' | 'oblique'
  readonly lineHeight: 'normal' | { readonly px: number }
  readonly hAlign: 'start' | 'center' | 'end'
  readonly vAlign: 'top' | 'middle' | 'bottom'
  readonly whiteSpace: 'normal' | 'pre' | 'pre-wrap' | 'nowrap'
  readonly overflowWrap: 'normal' | 'break-word'
  readonly wordBreak: 'normal' | 'break-all' | 'keep-all'
}
export type SdkDocumentSvgNode =
  | (SdkDocumentSvgCommon & {
      readonly kind: 'group'
      readonly children: readonly SdkDocumentSvgNode[]
    })
  | (SdkDocumentSvgCommon & {
      readonly kind: 'rect'
      readonly x: number
      readonly y: number
      readonly width: number
      readonly height: number
      readonly rx?: number
      readonly ry?: number
    })
  | (SdkDocumentSvgCommon & {
      readonly kind: 'circle'
      readonly cx: number
      readonly cy: number
      readonly r: number
    })
  | (SdkDocumentSvgCommon & {
      readonly kind: 'ellipse'
      readonly cx: number
      readonly cy: number
      readonly rx: number
      readonly ry: number
    })
  | (SdkDocumentSvgMarked & {
      readonly kind: 'line'
      readonly x1: number
      readonly y1: number
      readonly x2: number
      readonly y2: number
    })
  | (SdkDocumentSvgMarked & {
      readonly kind: 'path'
      readonly commands: readonly SdkDocumentSvgPathCommand[]
    })
  | (SdkDocumentSvgMarked & {
      readonly kind: 'polyline' | 'polygon'
      readonly points: readonly (readonly [number, number])[]
    })
  | SdkDocumentSvgText
  | SdkDocumentSvgTextBox
  /** Bounded local reference; no URL, remote href or nested document. */
  | (SdkDocumentSvgCommon & {
      readonly kind: 'use'
      readonly ref: SdkDocumentSvgLocalId
      readonly x?: number
      readonly y?: number
      readonly width?: number
      readonly height?: number
    })
  /** Only known, equivalent text alternatives; preserve browser branch semantics. */
  | (SdkDocumentSvgCommon & {
      readonly kind: 'textAlternative'
      readonly primary: SdkDocumentSvgTextBox
      readonly fallback: SdkDocumentSvgText
    })
export interface SdkDocumentSvgDefBase {
  readonly id: SdkDocumentSvgLocalId
}
export type SdkDocumentSvgDefinition =
  | (SdkDocumentSvgDefBase & {
      readonly kind: 'clipPath'
      readonly units: 'userSpaceOnUse' | 'objectBoundingBox'
      readonly transforms?: readonly SdkDocumentSvgTransform[]
      readonly children: readonly SdkDocumentSvgNode[]
    })
  | (SdkDocumentSvgDefBase & {
      readonly kind: 'marker'
      readonly viewBox?: SdkDocumentSvgBox
      readonly width: number
      readonly height: number
      readonly refX: SdkDocumentSvgLength
      readonly refY: SdkDocumentSvgLength
      readonly units: 'strokeWidth' | 'userSpaceOnUse'
      readonly orient: 'auto' | 'auto-start-reverse' | { readonly degrees: number }
      readonly style?: SdkDocumentSvgStyleId
      readonly children: readonly SdkDocumentSvgNode[]
    })
  | (SdkDocumentSvgDefBase & {
      readonly kind: 'linearGradient'
      readonly units: 'userSpaceOnUse' | 'objectBoundingBox'
      readonly x1: SdkDocumentSvgLength
      readonly y1: SdkDocumentSvgLength
      readonly x2: SdkDocumentSvgLength
      readonly y2: SdkDocumentSvgLength
      readonly spread: 'pad' | 'reflect' | 'repeat'
      readonly transforms?: readonly SdkDocumentSvgTransform[]
      readonly stops: readonly { readonly offset: number; readonly color: SdkDocumentSvgRgba }[]
    })
  | (SdkDocumentSvgDefBase & {
      readonly kind: 'dropShadowFilter'
      readonly units: 'userSpaceOnUse' | 'objectBoundingBox'
      readonly primitiveUnits: 'userSpaceOnUse' | 'objectBoundingBox'
      readonly region: readonly [
        SdkDocumentSvgLength,
        SdkDocumentSvgLength,
        SdkDocumentSvgLength,
        SdkDocumentSvgLength,
      ]
      readonly colorInterpolation: 'sRGB' | 'linearRGB'
      readonly dx: number
      readonly dy: number
      readonly stdDeviation: readonly [number, number]
      readonly color: SdkDocumentSvgRgba
    })
  | (SdkDocumentSvgDefBase & {
      readonly kind: 'symbol'
      readonly viewBox?: SdkDocumentSvgBox
      readonly width?: number
      readonly height?: number
      readonly style?: SdkDocumentSvgStyleId
      readonly children: readonly SdkDocumentSvgNode[]
    })
export interface SdkDocumentSvgImage {
  readonly type: 'svg-image'
  readonly profile: 'bounded-svg-v1'
  readonly width: number
  readonly height: number
  /** [x, y, width, height] in root CSS pixels; includes the root viewport and all visible ink. */
  readonly rasterBounds: SdkDocumentSvgBox
  readonly viewBox: SdkDocumentSvgBox
  readonly aspect: {
    readonly align:
      | 'none'
      | 'xMinYMin'
      | 'xMidYMin'
      | 'xMaxYMin'
      | 'xMinYMid'
      | 'xMidYMid'
      | 'xMaxYMid'
      | 'xMinYMax'
      | 'xMidYMax'
      | 'xMaxYMax'
    readonly fit: 'meet' | 'slice'
  }
  /** Full data included and budgeted; indexes alone never authorize shared resources. */
  readonly styles: readonly SdkDocumentSvgStyle[]
  readonly rootStyle?: SdkDocumentSvgStyleId
  readonly definitions: readonly SdkDocumentSvgDefinition[]
  readonly children: readonly SdkDocumentSvgNode[]
  readonly title?: string
  readonly description?: string
  /** Converter rejects effective animation before producing this profile. */
  readonly motion: 'static'
}

/** Converter errors are not accepted ready-image nodes. Host shows original source. */
export type SdkDocumentSvgConversionFailure =
  | { readonly code: 'unsupported-animation'; readonly reason: string }
  | { readonly code: 'unsafe-output'; readonly reason: string }
  | { readonly code: 'unsupported-feature'; readonly reason: string }
  | { readonly code: 'limit-exceeded'; readonly reason: string }
  | { readonly code: 'font-unavailable'; readonly reason: string }
  | { readonly code: 'invalid-output'; readonly reason: string }

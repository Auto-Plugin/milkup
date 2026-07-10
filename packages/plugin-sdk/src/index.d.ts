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
  readonly editor?: SdkEditor
  readonly command?: {
    readonly action: string
  }
}

export interface SdkPluginStorage {
  getItem(key: string): Promise<string | null>
  setItem(key: string, value: string): Promise<void>
  removeItem(key: string): Promise<void>
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

export interface SdkPluginHost {
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

export type SdkRendererOutput =
  | string
  | number
  | boolean
  | {
      readonly type: 'element'
      readonly tag: 'span' | 'strong' | 'em' | 'code' | 'a' | 'button'
      readonly text?: string
      readonly children?: readonly SdkRendererOutput[]
      readonly attributes?: Readonly<Record<string, string>>
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

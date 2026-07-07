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

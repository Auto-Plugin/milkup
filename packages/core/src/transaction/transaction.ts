import type { ChangeSet } from '../change/change'
import type { Selection } from '../selection/selection'

export interface Annotation<T = unknown> {
  readonly type: string
  readonly value: T
}

export interface StateEffect<T = unknown> {
  readonly type: string
  readonly value: T
}

export type TransactionOriginType =
  | 'input.type'
  | 'input.delete'
  | 'paste'
  | 'command'
  | 'mode.switch'
  | 'codeBlock'
  | 'history.undo'
  | 'history.redo'
  | 'unknown'

export interface TransactionOrigin {
  readonly type: TransactionOriginType
  readonly id?: string
}

export type HistoryGroup = 'merge' | 'isolate'

export interface Transaction {
  readonly changes?: ChangeSet
  readonly selection?: Selection
  readonly annotations?: readonly Annotation[]
  readonly effects?: readonly StateEffect[]
  readonly origin?: TransactionOrigin
  readonly addToHistory?: boolean
  readonly historyGroup?: HistoryGroup
  readonly time?: number
}

export function transactionChangesDocument(transaction: Transaction): boolean {
  return Boolean(transaction.changes && !transaction.changes.empty)
}

export function shouldAddToHistory(transaction: Transaction): boolean {
  return transaction.addToHistory !== false && transactionChangesDocument(transaction)
}

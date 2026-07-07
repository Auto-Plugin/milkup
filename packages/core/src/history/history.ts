import type { Selection } from '../selection/selection'
import type { TextDocument } from '../text/document'
import type { Transaction, TransactionOrigin } from '../transaction/transaction'

export interface HistoryEntry {
  readonly beforeDoc: TextDocument
  readonly afterDoc: TextDocument
  readonly beforeSelection: Selection
  readonly afterSelection: Selection
  readonly origin?: TransactionOrigin
  readonly group: 'merge' | 'isolate'
  readonly time: number
}

export interface HistoryRecordResult {
  readonly history: HistoryState
  readonly entry: HistoryEntry
}

export class HistoryState {
  readonly undoStack: readonly HistoryEntry[]
  readonly redoStack: readonly HistoryEntry[]

  private constructor(
    undoStack: readonly HistoryEntry[] = [],
    redoStack: readonly HistoryEntry[] = [],
  ) {
    this.undoStack = Object.freeze([...undoStack])
    this.redoStack = Object.freeze([...redoStack])
    Object.freeze(this)
  }

  static empty(): HistoryState {
    return new HistoryState()
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0
  }

  record(entry: HistoryEntry): HistoryState {
    const undoStack = [...this.undoStack]
    const last = undoStack[undoStack.length - 1]

    if (last && shouldMergeEntries(last, entry)) {
      undoStack[undoStack.length - 1] = {
        beforeDoc: last.beforeDoc,
        afterDoc: entry.afterDoc,
        beforeSelection: last.beforeSelection,
        afterSelection: entry.afterSelection,
        ...(entry.origin ? { origin: entry.origin } : {}),
        group: entry.group,
        time: entry.time,
      }
    } else {
      undoStack.push(entry)
    }

    return new HistoryState(undoStack, [])
  }

  pushRedo(entry: HistoryEntry): HistoryState {
    return new HistoryState(this.undoStack, [...this.redoStack, entry])
  }

  pushUndo(entry: HistoryEntry): HistoryState {
    return new HistoryState([...this.undoStack, entry], this.redoStack)
  }

  popUndo(): readonly [HistoryEntry | undefined, HistoryState] {
    if (this.undoStack.length === 0) {
      return [undefined, this]
    }

    const undoStack = this.undoStack.slice(0, -1)
    const entry = this.undoStack[this.undoStack.length - 1]

    return [entry, new HistoryState(undoStack, this.redoStack)]
  }

  popRedo(): readonly [HistoryEntry | undefined, HistoryState] {
    if (this.redoStack.length === 0) {
      return [undefined, this]
    }

    const redoStack = this.redoStack.slice(0, -1)
    const entry = this.redoStack[this.redoStack.length - 1]

    return [entry, new HistoryState(this.undoStack, redoStack)]
  }
}

export function createHistoryEntry(args: {
  readonly beforeDoc: TextDocument
  readonly afterDoc: TextDocument
  readonly beforeSelection: Selection
  readonly afterSelection: Selection
  readonly transaction: Transaction
}): HistoryEntry {
  return Object.freeze({
    beforeDoc: args.beforeDoc,
    afterDoc: args.afterDoc,
    beforeSelection: args.beforeSelection,
    afterSelection: args.afterSelection,
    ...(args.transaction.origin ? { origin: args.transaction.origin } : {}),
    group: args.transaction.historyGroup ?? defaultHistoryGroup(args.transaction),
    time: args.transaction.time ?? Date.now(),
  })
}

function defaultHistoryGroup(transaction: Transaction): 'merge' | 'isolate' {
  return transaction.origin?.type === 'input.type' ? 'merge' : 'isolate'
}

function shouldMergeEntries(previous: HistoryEntry, next: HistoryEntry): boolean {
  if (previous.group !== 'merge' || next.group !== 'merge') {
    return false
  }

  if (previous.origin?.type !== next.origin?.type) {
    return false
  }

  return next.time - previous.time <= 1000
}

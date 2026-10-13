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

    if (last && this.redoStack.length === 0 && shouldMergeEntries(last, entry)) {
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

  // A new caret/selection or input source is a separate user intent even within the time window.
  const before = next.beforeSelection
  const after = previous.afterSelection
  if (
    previous.origin?.id !== next.origin?.id ||
    previous.afterDoc !== next.beforeDoc ||
    after.mainIndex !== before.mainIndex ||
    after.ranges.length !== before.ranges.length ||
    after.ranges.some((range, index) => {
      const other = before.ranges[index]
      return (
        !other ||
        range.anchor !== other.anchor ||
        range.head !== other.head ||
        range.affinity !== other.affinity
      )
    })
  )
    return false

  const elapsed = next.time - previous.time
  return elapsed >= 0 && elapsed <= 1000
}

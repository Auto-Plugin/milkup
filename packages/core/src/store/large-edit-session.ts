import { ChangeSet, type Change } from '../change/change'
import type { Selection } from '../selection/selection'

export interface LargeTextEdit extends Change {
  readonly deletedText: string
}

export interface LargeTextEditBatch {
  readonly historyGroup?: 'typing' | 'isolate' | undefined
  readonly nativeHistory?:
    { readonly token: string; readonly direction: 'undo' | 'redo' } | undefined
  readonly edits: readonly LargeTextEdit[]
  readonly selectionBefore?: Selection | undefined
  readonly selectionAfter?: Selection | undefined
}

export interface LargeEditSessionSnapshot {
  readonly documentId: string
  readonly baseVersion: number
  readonly version: number
  readonly savedVersion: number
  readonly pendingEditCount: number
  readonly dirty: boolean
  readonly canUndo: boolean
  readonly canRedo: boolean
}

interface HistoryEntry {
  readonly nativeHistory?: string | undefined
  readonly forward: readonly LargeTextEdit[]
  readonly inverse: readonly LargeTextEdit[]
  readonly selectionBefore?: Selection | undefined
  readonly selectionAfter?: Selection | undefined
}

export class LargeEditSession {
  readonly documentId: string
  readonly baseVersion: number

  private currentVersion: number
  private flushedVersion: number
  private readonly pending: LargeTextEdit[] = []
  private readonly undoStack: HistoryEntry[] = []
  private readonly redoStack: HistoryEntry[] = []
  private typingEntry: HistoryEntry | undefined
  private typingAt = 0

  constructor(config: {
    readonly documentId: string
    readonly baseVersion: number
    readonly savedVersion?: number
  }) {
    this.documentId = config.documentId
    this.baseVersion = config.baseVersion
    this.currentVersion = config.baseVersion
    this.flushedVersion = config.savedVersion ?? config.baseVersion
  }

  get version(): number {
    return this.currentVersion
  }

  get savedVersion(): number {
    return this.flushedVersion
  }

  get pendingEditCount(): number {
    return this.pending.length
  }

  get dirty(): boolean {
    return this.currentVersion !== this.flushedVersion || this.pending.length > 0
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0
  }

  recordVisibleEdits(
    changes: ChangeSet,
    deletedTextByChange: readonly string[],
  ): LargeTextEditBatch {
    const batch = this.prepareVisibleEdits(changes, deletedTextByChange)
    this.confirmVisibleEdits(batch, this.currentVersion + (batch.edits.length > 0 ? 1 : 0))
    return batch
  }

  prepareVisibleEdits(
    changes: ChangeSet,
    deletedTextByChange: readonly string[],
    selections: {
      readonly historyGroup?: 'typing' | 'isolate' | undefined
      readonly selectionBefore?: Selection | undefined
      readonly selectionAfter?: Selection | undefined
    } = {},
  ): LargeTextEditBatch {
    if (changes.empty) {
      return Object.freeze({ edits: Object.freeze([]) })
    }

    const edits = changes.changes.map((change, index) =>
      freezeEdit({
        ...change,
        deletedText: deletedTextByChange[index] ?? '',
      }),
    )
    validateDeletedText(edits)
    return Object.freeze({ edits: Object.freeze(edits), ...selections })
  }

  confirmVisibleEdits(batch: LargeTextEditBatch, nativeVersion: number): LargeEditSessionSnapshot {
    if (batch.edits.length === 0) {
      return this.snapshot()
    }
    this.validateNextNativeVersion(nativeVersion)
    const edits = Object.freeze([...batch.edits])
    this.pending.push(...edits)
    // Native transport batches are not user-visible undo boundaries. Coalesce
    // only opted-in adjacent insertions; structural/paste/save/history actions
    // break the group, and text plus time budgets keep each entry bounded.
    const now = Date.now(),
      previous = this.undoStack.at(-1)
    const first = previous?.forward[0],
      next = edits[0]
    const merge =
      batch.historyGroup === 'typing' &&
      previous === this.typingEntry &&
      now >= this.typingAt &&
      now - this.typingAt <= 750 &&
      (!previous?.selectionAfter ||
        !batch.selectionBefore ||
        (previous.selectionAfter.main.empty &&
          batch.selectionBefore.main.empty &&
          previous.selectionAfter.main.head === batch.selectionBefore.main.head)) &&
      first &&
      next &&
      previous.forward.length === 1 &&
      edits.length === 1 &&
      next.from === next.to &&
      next.from === first.from + first.insert.length &&
      first.insert.length + next.insert.length <= 65_536 &&
      !/[\r\n]/.test(first.insert + next.insert)
    const forward = merge
      ? Object.freeze([freezeEdit({ ...first, insert: first.insert + next.insert })])
      : edits
    const entry = Object.freeze({
      forward,
      inverse: invertEdits(forward),
      selectionBefore: merge ? previous.selectionBefore : batch.selectionBefore,
      selectionAfter: batch.selectionAfter,
    })
    if (merge) this.undoStack.pop()
    this.undoStack.push(entry)
    this.typingEntry = batch.historyGroup === 'typing' ? entry : undefined
    this.typingAt = now
    this.redoStack.length = 0
    this.currentVersion = nativeVersion
    return this.snapshot()
  }

  confirmNativeHistory(
    token: string,
    nativeVersion: number,
    selections: Pick<LargeTextEditBatch, 'selectionBefore' | 'selectionAfter'> = {},
  ): LargeEditSessionSnapshot {
    this.validateNextNativeVersion(nativeVersion)
    if (!token) throw new Error('Missing native history token')
    this.typingEntry = undefined
    this.undoStack.push(
      Object.freeze({
        forward: Object.freeze([]),
        inverse: Object.freeze([]),
        nativeHistory: token,
        ...selections,
      }),
    )
    this.redoStack.length = 0
    this.currentVersion = nativeVersion
    return this.snapshot()
  }

  prepareUndo(): LargeTextEditBatch | undefined {
    const entry = this.undoStack.at(-1)
    return entry
      ? Object.freeze({
          edits: Object.freeze([...entry.inverse]),
          nativeHistory: entry.nativeHistory
            ? { token: entry.nativeHistory, direction: 'undo' as const }
            : undefined,
          selectionAfter: entry.selectionBefore,
        })
      : undefined
  }

  prepareRedo(): LargeTextEditBatch | undefined {
    const entry = this.redoStack.at(-1)
    return entry
      ? Object.freeze({
          edits: Object.freeze([...entry.forward]),
          nativeHistory: entry.nativeHistory
            ? { token: entry.nativeHistory, direction: 'redo' as const }
            : undefined,
          selectionAfter: entry.selectionAfter,
        })
      : undefined
  }

  confirmUndo(nativeVersion: number): LargeEditSessionSnapshot {
    this.validateNextNativeVersion(nativeVersion)
    this.typingEntry = undefined
    const entry = this.undoStack.pop()
    if (!entry) {
      throw new RangeError('Cannot confirm undo without an undo entry')
    }
    this.pending.push(...entry.inverse)
    this.redoStack.push(entry)
    this.currentVersion = nativeVersion
    return this.snapshot()
  }

  confirmRedo(nativeVersion: number): LargeEditSessionSnapshot {
    this.validateNextNativeVersion(nativeVersion)
    this.typingEntry = undefined
    const entry = this.redoStack.pop()
    if (!entry) {
      throw new RangeError('Cannot confirm redo without a redo entry')
    }
    this.pending.push(...entry.forward)
    this.undoStack.push(entry)
    this.currentVersion = nativeVersion
    return this.snapshot()
  }

  undo(): LargeTextEditBatch | undefined {
    const batch = this.prepareUndo()
    if (!batch) {
      return undefined
    }
    this.confirmUndo(this.currentVersion + 1)
    return batch
  }

  redo(): LargeTextEditBatch | undefined {
    const batch = this.prepareRedo()
    if (!batch) {
      return undefined
    }
    this.confirmRedo(this.currentVersion + 1)
    return batch
  }

  consumePendingEdits(): LargeTextEditBatch {
    const edits = this.pending.splice(0, this.pending.length)
    return Object.freeze({ edits: Object.freeze(edits) })
  }

  markFlushed(version: number): LargeEditSessionSnapshot {
    this.typingEntry = undefined
    if (!Number.isInteger(version) || version < this.currentVersion) {
      throw new RangeError(`Invalid flushed version: ${version}`)
    }

    this.currentVersion = version
    this.flushedVersion = version
    this.pending.length = 0
    return this.snapshot()
  }

  snapshot(): LargeEditSessionSnapshot {
    return Object.freeze({
      documentId: this.documentId,
      baseVersion: this.baseVersion,
      version: this.currentVersion,
      savedVersion: this.flushedVersion,
      pendingEditCount: this.pending.length,
      dirty: this.dirty,
      canUndo: this.canUndo,
      canRedo: this.canRedo,
    })
  }

  private validateNextNativeVersion(nativeVersion: number): void {
    if (!Number.isInteger(nativeVersion) || nativeVersion !== this.currentVersion + 1) {
      throw new RangeError(
        `Invalid native version confirmation: ${nativeVersion}; expected ${this.currentVersion + 1}`,
      )
    }
  }
}

export function largeTextEditsToChangeSet(edits: readonly LargeTextEdit[]): ChangeSet {
  return ChangeSet.of(edits.map(({ from, to, insert }) => ({ from, to, insert })))
}

function invertEdits(edits: readonly LargeTextEdit[]): readonly LargeTextEdit[] {
  let delta = 0
  const inverse: LargeTextEdit[] = []

  for (const edit of edits) {
    const appliedFrom = edit.from + delta
    const appliedTo = appliedFrom + edit.insert.length

    inverse.push(
      freezeEdit({
        from: appliedFrom,
        to: appliedTo,
        insert: edit.deletedText,
        deletedText: edit.insert,
      }),
    )
    delta += edit.insert.length - (edit.to - edit.from)
  }

  return Object.freeze(inverse.reverse())
}

function validateDeletedText(edits: readonly LargeTextEdit[]): void {
  for (const edit of edits) {
    const deletedLength = edit.to - edit.from

    if (edit.deletedText.length !== deletedLength) {
      throw new RangeError(
        `Deleted text length ${edit.deletedText.length} does not match range ${deletedLength}`,
      )
    }
  }
}

function freezeEdit(edit: LargeTextEdit): LargeTextEdit {
  return Object.freeze({
    from: edit.from,
    to: edit.to,
    insert: edit.insert,
    deletedText: edit.deletedText,
  })
}

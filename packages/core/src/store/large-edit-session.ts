import { ChangeSet, type Change } from '../change/change'

export interface LargeTextEdit extends Change {
  readonly deletedText: string
}

export interface LargeTextEditBatch {
  readonly edits: readonly LargeTextEdit[]
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
  readonly forward: readonly LargeTextEdit[]
  readonly inverse: readonly LargeTextEdit[]
}

export class LargeEditSession {
  readonly documentId: string
  readonly baseVersion: number

  private currentVersion: number
  private flushedVersion: number
  private readonly pending: LargeTextEdit[] = []
  private readonly undoStack: HistoryEntry[] = []
  private readonly redoStack: HistoryEntry[] = []

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
    return Object.freeze({ edits: Object.freeze(edits) })
  }

  confirmVisibleEdits(batch: LargeTextEditBatch, nativeVersion: number): LargeEditSessionSnapshot {
    if (batch.edits.length === 0) {
      return this.snapshot()
    }
    this.validateNextNativeVersion(nativeVersion)
    const edits = Object.freeze([...batch.edits])
    this.pending.push(...edits)
    this.undoStack.push(Object.freeze({ forward: edits, inverse: invertEdits(edits) }))
    this.redoStack.length = 0
    this.currentVersion = nativeVersion
    return this.snapshot()
  }

  prepareUndo(): LargeTextEditBatch | undefined {
    const entry = this.undoStack.at(-1)
    return entry ? Object.freeze({ edits: Object.freeze([...entry.inverse]) }) : undefined
  }

  prepareRedo(): LargeTextEditBatch | undefined {
    const entry = this.redoStack.at(-1)
    return entry ? Object.freeze({ edits: Object.freeze([...entry.forward]) }) : undefined
  }

  confirmUndo(nativeVersion: number): LargeEditSessionSnapshot {
    this.validateNextNativeVersion(nativeVersion)
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

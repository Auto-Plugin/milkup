import { assertValidRange, type TextRange } from '../position/range'

export interface Change extends TextRange {
  readonly insert: string
}

export class ChangeSet {
  readonly changes: readonly Change[]

  private constructor(changes: readonly Change[]) {
    this.changes = Object.freeze([...changes])
    Object.freeze(this)
  }

  static empty(): ChangeSet {
    return new ChangeSet([])
  }

  static of(changes: readonly Change[]): ChangeSet {
    const normalized = [...changes]
    validateChanges(normalized)
    return new ChangeSet(normalized)
  }

  static insert(pos: number, text: string): ChangeSet {
    return ChangeSet.of([{ from: pos, to: pos, insert: text }])
  }

  static delete(from: number, to: number): ChangeSet {
    return ChangeSet.of([{ from, to, insert: '' }])
  }

  static replace(from: number, to: number, text: string): ChangeSet {
    return ChangeSet.of([{ from, to, insert: text }])
  }

  get empty(): boolean {
    return this.changes.length === 0
  }

  mapPosition(pos: number, affinity: -1 | 1 = 1): number {
    if (!Number.isInteger(pos) || pos < 0) {
      throw new RangeError(`Invalid position: ${pos}`)
    }

    let mapped = pos

    for (const change of this.changes) {
      const deletedLength = change.to - change.from
      const insertedLength = change.insert.length
      const delta = insertedLength - deletedLength

      if (pos < change.from) {
        break
      }

      if (pos > change.to) {
        mapped += delta
        continue
      }

      if (pos === change.from) {
        mapped = affinity < 0 ? change.from : change.from + insertedLength
        continue
      }

      if (pos === change.to) {
        mapped = affinity < 0 ? change.from : change.from + insertedLength
        continue
      }

      mapped = affinity < 0 ? change.from : change.from + insertedLength
    }

    return mapped
  }
}

function validateChanges(changes: readonly Change[]): void {
  let previousTo = 0

  for (const change of changes) {
    assertValidRange(change)

    if (change.from < previousTo) {
      throw new RangeError('Changes must be sorted and non-overlapping')
    }

    previousTo = change.to
  }
}

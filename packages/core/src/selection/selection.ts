import { ChangeSet } from '../change/change'

export type SelectionAffinity = -1 | 1

export class SelectionRange {
  readonly anchor: number
  readonly head: number
  readonly affinity: SelectionAffinity

  constructor(anchor: number, head = anchor, affinity: SelectionAffinity = 1) {
    assertValidPosition(anchor)
    assertValidPosition(head)

    this.anchor = anchor
    this.head = head
    this.affinity = affinity
    Object.freeze(this)
  }

  static cursor(pos: number, affinity: SelectionAffinity = 1): SelectionRange {
    return new SelectionRange(pos, pos, affinity)
  }

  static range(anchor: number, head: number, affinity: SelectionAffinity = 1): SelectionRange {
    return new SelectionRange(anchor, head, affinity)
  }

  get from(): number {
    return Math.min(this.anchor, this.head)
  }

  get to(): number {
    return Math.max(this.anchor, this.head)
  }

  get empty(): boolean {
    return this.anchor === this.head
  }

  map(changes: ChangeSet): SelectionRange {
    return new SelectionRange(
      changes.mapPosition(this.anchor, this.affinity),
      changes.mapPosition(this.head, this.affinity),
      this.affinity,
    )
  }
}

export class Selection {
  readonly ranges: readonly SelectionRange[]
  readonly mainIndex: number

  constructor(ranges: readonly SelectionRange[], mainIndex = 0) {
    if (ranges.length === 0) {
      throw new RangeError('Selection must contain at least one range')
    }

    if (!Number.isInteger(mainIndex) || mainIndex < 0 || mainIndex >= ranges.length) {
      throw new RangeError(`Invalid main selection index: ${mainIndex}`)
    }

    this.ranges = Object.freeze([...ranges])
    this.mainIndex = mainIndex
    Object.freeze(this)
  }

  static cursor(pos: number, affinity: SelectionAffinity = 1): Selection {
    return new Selection([SelectionRange.cursor(pos, affinity)])
  }

  static range(anchor: number, head: number, affinity: SelectionAffinity = 1): Selection {
    return new Selection([SelectionRange.range(anchor, head, affinity)])
  }

  get main(): SelectionRange {
    const range = this.ranges[this.mainIndex]

    if (!range) {
      throw new RangeError(`Invalid main selection index: ${this.mainIndex}`)
    }

    return range
  }

  get empty(): boolean {
    return this.ranges.every((range) => range.empty)
  }

  map(changes: ChangeSet): Selection {
    return new Selection(
      this.ranges.map((range) => range.map(changes)),
      this.mainIndex,
    )
  }
}

function assertValidPosition(pos: number): void {
  if (!Number.isInteger(pos) || pos < 0) {
    throw new RangeError(`Invalid selection position: ${pos}`)
  }
}

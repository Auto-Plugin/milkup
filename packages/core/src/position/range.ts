export interface TextRange {
  readonly from: number
  readonly to: number
}

export function assertValidRange(range: TextRange, length?: number): void {
  if (!Number.isInteger(range.from) || !Number.isInteger(range.to)) {
    throw new RangeError(`Range offsets must be integers: ${range.from}-${range.to}`)
  }

  if (range.from < 0 || range.to < range.from) {
    throw new RangeError(`Invalid range: ${range.from}-${range.to}`)
  }

  if (length !== undefined && range.to > length) {
    throw new RangeError(`Range ${range.from}-${range.to} exceeds document length ${length}`)
  }
}

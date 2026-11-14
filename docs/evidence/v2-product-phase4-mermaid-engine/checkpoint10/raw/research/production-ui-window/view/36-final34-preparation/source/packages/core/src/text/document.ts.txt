import { ChangeSet } from '../change/change'
import { assertValidRange } from '../position/range'

export interface Line {
  readonly number: number
  readonly from: number
  readonly to: number
  readonly text: string
}

/**
 * Framework-independent text document.
 *
 * Editor positions are UTF-16 code unit offsets so the core can interoperate
 * with JavaScript strings, DOM input events, and browser selection APIs.
 *
 * MemoryTextDocument preserves source text exactly. Line text excludes the line
 * break itself, and trims a trailing carriage return from CRLF line endings for
 * line-level reads without normalizing the underlying document text.
 */
export interface TextDocument {
  readonly length: number
  readonly lineCount: number
  readonly text: string
  slice(from: number, to: number): string
  lineAt(pos: number): Line
  line(number: number): Line
  apply(changes: ChangeSet): TextDocument
}

export class MemoryTextDocument implements TextDocument {
  readonly text: string
  readonly length: number
  readonly lineCount: number

  private readonly lineStarts: readonly number[]

  constructor(text = '') {
    this.text = text
    this.length = text.length
    this.lineStarts = Object.freeze([...computeLineStarts(text)])
    this.lineCount = this.lineStarts.length
    Object.freeze(this)
  }

  slice(from: number, to: number): string {
    assertValidRange({ from, to }, this.length)
    return this.text.slice(from, to)
  }

  lineAt(pos: number): Line {
    if (!Number.isInteger(pos) || pos < 0 || pos > this.length) {
      throw new RangeError(`Invalid document position: ${pos}`)
    }

    const lineIndex = findLineIndex(this.lineStarts, pos)
    return this.line(lineIndex + 1)
  }

  line(number: number): Line {
    if (!Number.isInteger(number) || number < 1 || number > this.lineCount) {
      throw new RangeError(`Invalid line number: ${number}`)
    }

    const index = number - 1
    const from = this.lineStarts[index]

    if (from === undefined) {
      throw new RangeError(`Invalid line number: ${number}`)
    }

    const nextLineStart = this.lineStarts[index + 1]
    const rawTo = nextLineStart === undefined ? this.length : nextLineStart - 1
    const to = rawTo > from && this.text.charCodeAt(rawTo - 1) === 13 ? rawTo - 1 : rawTo

    return {
      number,
      from,
      to,
      text: this.text.slice(from, to),
    }
  }

  apply(changes: ChangeSet): TextDocument {
    if (changes.empty) {
      return this
    }

    let next = ''
    let offset = 0

    for (const change of changes.changes) {
      assertValidRange(change, this.length)
      next += this.text.slice(offset, change.from)
      next += change.insert
      offset = change.to
    }

    next += this.text.slice(offset)
    return new MemoryTextDocument(next)
  }
}

function computeLineStarts(text: string): readonly number[] {
  const starts = [0]

  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) === 10) {
      starts.push(index + 1)
    }
  }

  return starts
}

function findLineIndex(lineStarts: readonly number[], pos: number): number {
  let low = 0
  let high = lineStarts.length - 1

  while (low <= high) {
    const mid = Math.floor((low + high) / 2)
    const start = lineStarts[mid]

    if (start === undefined) {
      break
    }

    if (start === pos) {
      return mid
    }

    if (start < pos) {
      low = mid + 1
    } else {
      high = mid - 1
    }
  }

  return Math.max(0, low - 1)
}

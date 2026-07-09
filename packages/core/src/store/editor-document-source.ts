import type { Line, TextDocument } from '../text/document'
import { MemoryTextDocument } from '../text/document'
import type { DocumentLineWindow } from './document-store'

export interface EditorDocumentSourceSnapshot {
  readonly documentId: string
  readonly version: number
  readonly lineCount: number
  readonly length?: number
}

export interface EditorDocumentSource {
  readonly documentId: string
  readonly version: number
  readonly lineCount: number
  readonly length?: number
  readLineWindow(fromLine: number, toLine: number): Promise<DocumentLineWindow>
  lineAtPosition(position: number): Promise<Line>
  positionAtLineOffset(lineNumber: number, offset: number): Promise<number>
  snapshot(): EditorDocumentSourceSnapshot
}

export class MemoryDocumentSource implements EditorDocumentSource {
  readonly documentId: string

  private readonly document: TextDocument
  private readonly sourceVersion: number

  constructor(config: {
    readonly documentId: string
    readonly text?: string
    readonly document?: TextDocument
    readonly version?: number
  }) {
    this.documentId = config.documentId
    this.document = config.document ?? new MemoryTextDocument(config.text ?? '')
    this.sourceVersion = config.version ?? 0
  }

  get version(): number {
    return this.sourceVersion
  }

  get lineCount(): number {
    return this.document.lineCount
  }

  get length(): number {
    return this.document.length
  }

  async readLineWindow(fromLine: number, toLine: number): Promise<DocumentLineWindow> {
    assertValidLineWindow(fromLine, toLine, this.document.lineCount)

    const lines: Line[] = []

    for (let lineNumber = fromLine; lineNumber <= toLine; lineNumber += 1) {
      lines.push(this.document.line(lineNumber))
    }

    const first = lines[0]
    const last = lines.at(-1)

    if (!first || !last) {
      throw new RangeError(`Invalid line window: ${fromLine}-${toLine}`)
    }

    return Object.freeze({
      fromLine,
      toLine,
      from: first.from,
      to: last.to,
      text: this.document.slice(first.from, last.to),
      lines: Object.freeze(lines.map(freezeLine)),
    })
  }

  async lineAtPosition(position: number): Promise<Line> {
    return freezeLine(this.document.lineAt(position))
  }

  async positionAtLineOffset(lineNumber: number, offset: number): Promise<number> {
    const line = this.document.line(lineNumber)
    return line.from + clamp(Math.floor(offset), 0, line.to - line.from)
  }

  snapshot(): EditorDocumentSourceSnapshot {
    return Object.freeze({
      documentId: this.documentId,
      version: this.version,
      lineCount: this.lineCount,
      length: this.length,
    })
  }
}

function assertValidLineWindow(fromLine: number, toLine: number, lineCount: number): void {
  if (
    !Number.isInteger(fromLine) ||
    !Number.isInteger(toLine) ||
    fromLine < 1 ||
    toLine < fromLine ||
    toLine > lineCount
  ) {
    throw new RangeError(`Invalid line window: ${fromLine}-${toLine}`)
  }
}

function freezeLine(line: Line): Line {
  return Object.freeze({
    number: line.number,
    from: line.from,
    to: line.to,
    text: line.text,
  })
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

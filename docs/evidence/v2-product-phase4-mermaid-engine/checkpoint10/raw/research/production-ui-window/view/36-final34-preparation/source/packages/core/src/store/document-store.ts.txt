import { ChangeSet } from '../change/change'
import { assertValidRange, type TextRange } from '../position/range'
import { MemoryTextDocument, type TextDocument } from '../text/document'
import type { Line } from '../text/document'

export interface DocumentChunk extends TextRange {
  readonly text: string
}

export interface DocumentLine extends Line {}

export interface DocumentLineWindow {
  readonly fromLine: number
  readonly toLine: number
  readonly from: number
  readonly to: number
  readonly text: string
  readonly lines: readonly DocumentLine[]
}

export interface DocumentStoreSnapshot {
  readonly documentId: string
  readonly version: number
  readonly length: number
  readonly lineCount: number
}

export interface DocumentStoreFlushResult extends DocumentStoreSnapshot {
  readonly text: string
}

export interface DocumentStore {
  readonly documentId: string
  readonly version: number
  readonly length: number
  readonly lineCount: number
  readChunk(range: TextRange): Promise<DocumentChunk>
  readLine(lineNumber: number): Promise<DocumentLine>
  readLineWindow(fromLine: number, toLine: number): Promise<DocumentLineWindow>
  applyChanges(changes: ChangeSet): Promise<DocumentStoreSnapshot>
  flush(): Promise<DocumentStoreFlushResult>
}

export interface MemoryDocumentStoreConfig {
  readonly documentId: string
  readonly text?: string
  readonly version?: number
}

export class MemoryDocumentStore implements DocumentStore {
  readonly documentId: string

  private currentDocument: TextDocument
  private currentVersion: number

  constructor(config: MemoryDocumentStoreConfig) {
    this.documentId = config.documentId
    this.currentDocument = new MemoryTextDocument(config.text ?? '')
    this.currentVersion = config.version ?? 0
  }

  get version(): number {
    return this.currentVersion
  }

  get length(): number {
    return this.currentDocument.length
  }

  get lineCount(): number {
    return this.currentDocument.lineCount
  }

  async readChunk(range: TextRange): Promise<DocumentChunk> {
    assertValidRange(range, this.currentDocument.length)

    return Object.freeze({
      from: range.from,
      to: range.to,
      text: this.currentDocument.slice(range.from, range.to),
    })
  }

  async readLine(lineNumber: number): Promise<DocumentLine> {
    return freezeLine(this.currentDocument.line(lineNumber))
  }

  async readLineWindow(fromLine: number, toLine: number): Promise<DocumentLineWindow> {
    assertValidLineWindow(fromLine, toLine, this.currentDocument.lineCount)

    const lines: DocumentLine[] = []

    for (let lineNumber = fromLine; lineNumber <= toLine; lineNumber += 1) {
      lines.push(this.currentDocument.line(lineNumber))
    }

    const first = lines[0]
    const last = lines.at(-1)

    if (!first || !last) {
      throw new RangeError(`Invalid line window: ${fromLine}-${toLine}`)
    }

    const to = last.to

    return Object.freeze({
      fromLine,
      toLine,
      from: first.from,
      to,
      text: this.currentDocument.slice(first.from, to),
      lines: Object.freeze(lines.map(freezeLine)),
    })
  }

  async applyChanges(changes: ChangeSet): Promise<DocumentStoreSnapshot> {
    if (!changes.empty) {
      this.currentDocument = this.currentDocument.apply(changes)
      this.currentVersion += 1
    }

    return this.snapshot()
  }

  async flush(): Promise<DocumentStoreFlushResult> {
    return Object.freeze({
      ...this.snapshot(),
      text: this.currentDocument.text,
    })
  }

  snapshot(): DocumentStoreSnapshot {
    return Object.freeze({
      documentId: this.documentId,
      version: this.currentVersion,
      length: this.currentDocument.length,
      lineCount: this.currentDocument.lineCount,
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

function freezeLine(line: Line): DocumentLine {
  return Object.freeze({
    number: line.number,
    from: line.from,
    to: line.to,
    text: line.text,
  })
}

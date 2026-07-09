import type { DocumentLineWindow, EditorDocumentSource, Line } from '@milkup/core'

import type {
  DesktopLargeTextFileLineWindow,
  DesktopLargeTextFileService,
} from './large-file-service'

export interface LargeDocumentSourceConfig {
  readonly service: DesktopLargeTextFileService
  readonly documentId: string
  readonly path: string
  readonly version: number
  readonly lineCount: number
  readonly sizeBytes: number
}

export class LargeDocumentSource implements EditorDocumentSource {
  readonly documentId: string
  private sourcePath: string
  private sourceVersion: number
  private sourceLineCount: number
  private sourceSizeBytes: number

  private readonly service: DesktopLargeTextFileService

  constructor(config: LargeDocumentSourceConfig) {
    this.service = config.service
    this.documentId = config.documentId
    this.sourcePath = config.path
    this.sourceVersion = config.version
    this.sourceLineCount = config.lineCount
    this.sourceSizeBytes = config.sizeBytes
  }

  get path(): string {
    return this.sourcePath
  }

  get version(): number {
    return this.sourceVersion
  }

  get lineCount(): number {
    return this.sourceLineCount
  }

  get sizeBytes(): number {
    return this.sourceSizeBytes
  }

  async readLineWindow(fromLine: number, toLine: number): Promise<DocumentLineWindow> {
    return mapLargeLineWindow(await this.service.readLineWindow(this.documentId, fromLine, toLine))
  }

  async lineAtPosition(position: number): Promise<Line> {
    throw new Error(`LargeDocumentSource lineAtPosition requires a line index: ${position}`)
  }

  async positionAtLineOffset(lineNumber: number, offset: number): Promise<number> {
    const window = await this.readLineWindow(lineNumber, lineNumber)
    const line = window.lines[0]

    if (!line) {
      throw new RangeError(`Invalid line number: ${lineNumber}`)
    }

    return line.from + clamp(Math.floor(offset), 0, line.to - line.from)
  }

  snapshot(): {
    readonly documentId: string
    readonly version: number
    readonly lineCount: number
    readonly length: number
  } {
    return Object.freeze({
      documentId: this.documentId,
      version: this.version,
      lineCount: this.lineCount,
      length: this.sizeBytes,
    })
  }

  applyNativeSnapshot(snapshot: {
    readonly path?: string
    readonly version: number
    readonly lineCount: number
    readonly sizeBytes: number
  }): void {
    if (snapshot.path) {
      this.sourcePath = snapshot.path
    }

    this.sourceVersion = snapshot.version
    this.sourceLineCount = snapshot.lineCount
    this.sourceSizeBytes = snapshot.sizeBytes
  }
}

export function mapLargeLineWindow(window: DesktopLargeTextFileLineWindow): DocumentLineWindow {
  return Object.freeze({
    fromLine: window.fromLine,
    toLine: window.toLine,
    from: window.fromUtf16,
    to: window.toUtf16,
    text: window.text,
    lines: Object.freeze(
      window.lines.map((line) =>
        Object.freeze({
          number: line.number,
          from: line.fromUtf16,
          to: line.toUtf16,
          text: line.text,
        }),
      ),
    ),
  })
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

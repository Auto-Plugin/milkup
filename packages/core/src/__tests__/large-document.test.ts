import { describe, expect, it } from 'vitest'

import {
  BasicEditor,
  ChangeSet,
  type DocumentChunk,
  type DocumentLine,
  type DocumentLineWindow,
  type DocumentStore,
  type DocumentStoreFlushResult,
  type DocumentStoreSnapshot,
  EditorState,
  MemoryDocumentStore,
  MemoryTextDocument,
  searchDocumentStore,
} from '../index'

const TEN_MIB = 10 * 1024 * 1024
const HUNDRED_MIB = 100 * 1024 * 1024

describe('large document contracts', () => {
  it('reads windows from a 10 MiB synthetic Markdown document', async () => {
    const text = createSyntheticMarkdown(TEN_MIB)
    const store = new MemoryDocumentStore({ documentId: 'large-doc', text })

    expect(store.length).toBeGreaterThanOrEqual(TEN_MIB)

    const window = await store.readLineWindow(5, 9)

    expect(window.lines).toHaveLength(5)
    expect(window.text.length).toBeLessThan(1_000)
    expect(window.lines[0]?.number).toBe(5)
    expect(window.text).toContain('- repeated item ')
  }, 20_000)

  it('flushes a large edited document snapshot', async () => {
    const text = createSyntheticMarkdown(TEN_MIB)
    const store = new MemoryDocumentStore({ documentId: 'large-doc', text })
    const insertText = '\n<!-- saved marker -->'

    await store.applyChanges(ChangeSet.insert(store.length, insertText))
    const flushed = await store.flush()

    expect(flushed.documentId).toBe('large-doc')
    expect(flushed.version).toBe(1)
    expect(flushed.length).toBe(text.length + insertText.length)
    expect(flushed.text.endsWith(insertText)).toBe(true)
  }, 20_000)

  it('undoes a local edit in a large document through the global editor history', () => {
    const text = createSyntheticMarkdown(TEN_MIB)
    const editOffset = text.indexOf('repeated item 1024')
    const editor = new BasicEditor(
      new EditorState({
        doc: new MemoryTextDocument(text),
      }),
    )

    expect(editOffset).toBeGreaterThan(0)

    editor.dispatch({
      changes: ChangeSet.insert(editOffset, '**local** '),
      origin: { type: 'input.type' },
      historyGroup: 'isolate',
    })

    expect(editor.state.doc.slice(editOffset, editOffset + 10)).toBe('**local** ')
    expect(editor.state.history.canUndo).toBe(true)
    expect(editor.undo()).toBe(true)
    expect(editor.state.doc.text).toBe(text)
  }, 20_000)

  it('searches a virtual 100 MiB synthetic Markdown document through line windows', async () => {
    const store = new VirtualSyntheticMarkdownStore(HUNDRED_MIB)
    const targetLine = 1024
    const target = `marker-${String(targetLine).padStart(9, '0')}`

    const result = await searchDocumentStore(store, {
      query: target,
      maxResults: 1,
      windowSizeLines: 32,
    })

    const targetText = store.lineText(targetLine)
    const targetFrom = store.lineFrom(targetLine) + targetText.indexOf(target)

    expect(store.length).toBeGreaterThanOrEqual(HUNDRED_MIB)
    expect(store.materializedFullText).toBe(false)
    expect(store.readWindowRequests.length).toBeGreaterThan(1)
    expect(
      store.readWindowRequests.every((request) => request.toLine - request.fromLine < 32),
    ).toBe(true)
    expect(result.complete).toBe(true)
    expect(result.scannedLineCount).toBe(store.lineCount)
    expect(result.matches).toEqual([
      {
        from: targetFrom,
        to: targetFrom + target.length,
        line: targetLine,
        lineOffset: targetText.indexOf(target),
        text: target,
      },
    ])
  })
})

class VirtualSyntheticMarkdownStore implements DocumentStore {
  readonly documentId = 'virtual-100mib-doc'
  readonly version = 0
  readonly lineCount: number
  readonly length: number
  readonly materializedFullText = false
  readonly readWindowRequests: Array<{ fromLine: number; toLine: number }> = []

  private readonly lineStride: number

  constructor(minLength: number) {
    const firstLineLength = this.lineText(1).length
    this.lineStride = firstLineLength + 1
    this.lineCount = Math.ceil((minLength + 1) / this.lineStride)
    this.length = this.lineFrom(this.lineCount) + firstLineLength
  }

  async readChunk(range: { from: number; to: number }): Promise<DocumentChunk> {
    this.assertValidRange(range.from, range.to)

    const fromLine = this.lineNumberAtOffset(range.from)
    const toLine = this.lineNumberAtOffset(Math.max(range.from, range.to - 1))
    const window = await this.readLineWindow(fromLine, toLine)
    const relativeFrom = range.from - window.from
    const relativeTo = range.to - window.from

    return Object.freeze({
      from: range.from,
      to: range.to,
      text: window.text.slice(relativeFrom, relativeTo),
    })
  }

  async readLine(lineNumber: number): Promise<DocumentLine> {
    this.assertValidLine(lineNumber)
    return this.freezeLine(lineNumber)
  }

  async readLineWindow(fromLine: number, toLine: number): Promise<DocumentLineWindow> {
    this.assertValidLine(fromLine)
    this.assertValidLine(toLine)

    if (toLine < fromLine) {
      throw new RangeError(`Invalid line window: ${fromLine}-${toLine}`)
    }

    this.readWindowRequests.push({ fromLine, toLine })

    const lines: DocumentLine[] = []

    for (let lineNumber = fromLine; lineNumber <= toLine; lineNumber += 1) {
      lines.push(this.freezeLine(lineNumber))
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
      text: lines.map((line) => line.text).join('\n'),
      lines: Object.freeze(lines),
    })
  }

  async applyChanges(): Promise<DocumentStoreSnapshot> {
    throw new Error('VirtualSyntheticMarkdownStore is read-only')
  }

  async flush(): Promise<DocumentStoreFlushResult> {
    throw new Error('VirtualSyntheticMarkdownStore never materializes full text')
  }

  lineText(lineNumber: number): string {
    const number = String(lineNumber).padStart(9, '0')
    return `- repeated item ${number}: **bold text** with [link](./target.md) and marker-${number}.`
  }

  lineFrom(lineNumber: number): number {
    return (lineNumber - 1) * this.lineStride
  }

  private freezeLine(lineNumber: number): DocumentLine {
    const from = this.lineFrom(lineNumber)
    const text = this.lineText(lineNumber)

    return Object.freeze({
      number: lineNumber,
      from,
      to: from + text.length,
      text,
    })
  }

  private lineNumberAtOffset(offset: number): number {
    if (offset === this.length) {
      return this.lineCount
    }

    return Math.floor(offset / this.lineStride) + 1
  }

  private assertValidLine(lineNumber: number): void {
    if (!Number.isInteger(lineNumber) || lineNumber < 1 || lineNumber > this.lineCount) {
      throw new RangeError(`Invalid line number: ${lineNumber}`)
    }
  }

  private assertValidRange(from: number, to: number): void {
    if (
      !Number.isInteger(from) ||
      !Number.isInteger(to) ||
      from < 0 ||
      to < from ||
      to > this.length
    ) {
      throw new RangeError(`Invalid range: ${from}-${to}`)
    }
  }
}

function createSyntheticMarkdown(minLength: number): string {
  const lines = ['# Synthetic Large Document', '', '> generated for large-file contract tests', '']
  let length = lines.join('\n').length
  let index = 0

  while (length < minLength) {
    length = pushLine(
      lines,
      length,
      `- repeated item ${index}: **bold text** with [link](./target-${index}.md) and inline \`code\`.`,
    )
    index += 1

    if (index % 128 === 0) {
      length = pushLine(lines, length, '')
      length = pushLine(lines, length, '```ts')
      length = pushLine(lines, length, `export const marker${index} = ${index}`)
      length = pushLine(lines, length, '```')
      length = pushLine(lines, length, '')
    }
  }

  return `${lines.join('\n')}\n`
}

function pushLine(lines: string[], currentLength: number, line: string): number {
  lines.push(line)
  return currentLength + 1 + line.length
}

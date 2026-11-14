import {
  EditorState,
  MemoryTextDocument,
  Selection,
  type EditorDocumentSource,
  type DocumentLineWindow,
} from '@milkup/core'
import { parseMarkdown } from '@milkup/markdown'
import { tableContext } from './table-editing'

// Whole-table commands must never operate on a viewport fragment. These limits
// bound source text, parser/DOM work and one structural history transaction.
export const windowedTableLimits = Object.freeze({ lines: 128, text: 262_144, columns: 16 })
export const pipeLine = (text: string): boolean => text.includes('|') && !/^(?: {4}|\t)/.test(text)
export function boundedTableState(window: DocumentLineWindow, selection: Selection) {
  const state = new EditorState({
    doc: new MemoryTextDocument(window.text),
    selection: Selection.range(
      selection.main.anchor - window.from,
      selection.main.head - window.from,
    ),
  })
  const context = tableContext(state, parseMarkdown(window.text).root)
  if (
    !context ||
    context.rows.length + 1 > windowedTableLimits.lines ||
    context.columnCount > windowedTableLimits.columns ||
    context.table.to - context.table.from > windowedTableLimits.text
  )
    return
  return { state, context, offset: window.from }
}

export class WindowedTableReader {
  private source: EditorDocumentSource | undefined
  private version = -1
  private entries: Array<{ from: number; to: number; window?: DocumentLineWindow }> = []
  async read(
    source: EditorDocumentSource,
    number: number,
  ): Promise<DocumentLineWindow | undefined> {
    const version = source.version
    if (this.source !== source || this.version !== version) {
      this.source = source
      this.version = version
      this.entries = []
    }
    const cached = this.entries.find((e) => number >= e.from && number <= e.to)
    if (cached) return cached.window
    let from = number,
      to = number,
      size = 0
    const lines = new Map<number, DocumentLineWindow['lines'][number]>()
    const get = async (n: number) => {
      if (!lines.has(n)) {
        const window = await source.readLineWindow(n, n, windowedTableLimits.text - size)
        if (source.version !== version) throw new Error('Table source version changed')
        const line = window.lines[0]!
        size += line.text.length + 2
        if (size > windowedTableLimits.text) throw new RangeError('Line window exceeds text budget')
        lines.set(n, line)
      }
      return lines.get(n)!
    }
    let window: DocumentLineWindow | undefined
    try {
      if (!pipeLine((await get(number)).text)) return
      while (from > 1 && pipeLine((await get(from - 1)).text)) {
        from--
        if (to - from + 1 > windowedTableLimits.lines) return
      }
      while (to < source.lineCount && pipeLine((await get(to + 1)).text)) {
        to++
        if (to - from + 1 > windowedTableLimits.lines) return
      }
      const first = Math.max(1, from - 1),
        last = Math.min(source.lineCount, to + 1)
      window = await source.readLineWindow(first, last, windowedTableLimits.text)
      if (source.version !== version) return
      const parsed = parseMarkdown(window.text)
      const table = parsed.root.children?.find((n) => n.type === 'table')
      if (
        !table ||
        (table.children?.length ?? 0) + 1 > windowedTableLimits.lines ||
        table.children?.some((row) => (row.children?.length ?? 0) > windowedTableLimits.columns)
      )
        window = undefined
      return window
    } catch (error) {
      if (
        !String(error).includes('text budget') &&
        !String(error).includes('Table source version changed')
      )
        throw error
      return undefined
    } finally {
      if (this.source === source && this.version === version && source.version === version) {
        this.entries.push({ from, to, ...(window ? { window } : {}) })
        // Four windows of at most 262,144 UTF-16 units each. Window text,
        // line strings and parser objects have additional representation overhead.
        while (this.entries.length > 4) this.entries.shift()
      }
    }
  }
}

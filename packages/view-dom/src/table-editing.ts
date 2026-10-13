import {
  nextGraphemePosition,
  previousGraphemePosition,
  snapGraphemePosition,
} from './grapheme-navigation'
import { ChangeSet, Selection } from '@milkup/core'
import type { EditorState, Transaction } from '@milkup/core'
import { parseMarkdown } from '@milkup/markdown'
import type { SyntaxNode } from '@milkup/markdown'

export type TableCommand =
  | 'next'
  | 'previous'
  | 'down'
  | 'exit'
  | 'add-row'
  | 'delete-row'
  | 'add-column'
  | 'delete-column'
  | 'select-cell'
  | 'select-table'
export interface TableContext {
  readonly table: SyntaxNode
  readonly rows: readonly SyntaxNode[]
  readonly cells: readonly SyntaxNode[]
  readonly row: number
  readonly column: number
  readonly cell: SyntaxNode
  readonly withinCell: boolean
  readonly columnCount: number
}
export function tableContext(state: EditorState, root: SyntaxNode): TableContext | undefined {
  const range = state.selection.main
  const table = root.children?.find(
    (node) =>
      node.type === 'table' &&
      range.from >= node.from &&
      range.to <= node.to &&
      (range.from < node.to || (node.to === state.doc.length && !state.doc.text.endsWith('\n'))),
  )
  if (!table) return
  const rows = table.children ?? []
  const row = rows.findIndex(
    (node) => range.head >= node.from && (range.head < node.to || node.to === state.doc.length),
  )
  if (row < 0) return
  const cells = rows[row]!.children ?? []
  const column = Math.max(
    0,
    cells.findIndex((cell, index) => range.head <= cell.to || index === cells.length - 1),
  )
  const cell = cells[column]
  if (!cell) return
  return {
    table,
    rows,
    cells,
    row,
    column,
    cell,
    withinCell: range.from >= cell.from && range.to <= cell.to,
    columnCount: Math.max(...rows.map((row) => row.children?.length ?? 0)),
  }
}
function select(cell: SyntaxNode): Transaction {
  return {
    selection: Selection.range(cell.from, cell.to),
    addToHistory: false,
    origin: { type: 'command', id: 'table.navigate' },
  }
}
function cursor(position: number): Transaction {
  return {
    selection: Selection.cursor(position),
    addToHistory: false,
    origin: { type: 'command', id: 'table.navigate' },
  }
}
function edit(changes: ChangeSet, position: number, id: string): Transaction {
  return {
    changes,
    selection: Selection.cursor(position),
    origin: { type: 'command', id: `table.${id}` },
    historyGroup: 'isolate',
  }
}
function eol(state: EditorState, context: TableContext): string {
  return state.doc.slice(context.table.from, context.table.to).includes('\r\n') ? '\r\n' : '\n'
}
function changedTable(
  state: EditorState,
  context: TableContext,
  changes: ChangeSet,
  row: number,
  column: number,
  id: string,
): Transaction {
  const source = state.doc.apply(changes).text
  const table = parseMarkdown(
    source.slice(context.table.from, changes.mapPosition(context.table.to)),
  ).root.children?.find((node) => node.type === 'table')
  const cells = table?.children?.[row]?.children
  const cell = cells?.[Math.min(column, cells.length - 1)]
  return edit(changes, context.table.from + (cell?.from ?? 0), id)
}
function addRow(
  state: EditorState,
  context: TableContext,
  after: number,
  column: number,
): Transaction {
  const nl = eol(state, context)
  // The delimiter stays immediately below the header.
  const delimiter = state.doc.line(state.doc.lineAt(context.table.from).number + 1)
  const delimiterEnd =
    delimiter.to +
    (state.doc.text.slice(delimiter.to, delimiter.to + 2) === '\r\n'
      ? 2
      : state.doc.text[delimiter.to] === '\n'
        ? 1
        : 0)
  const at = after === 0 ? delimiterEnd : context.rows[after]!.to
  const atEnd = at === state.doc.length && !state.doc.text.endsWith('\n')
  const row = `| ${Array.from({ length: context.columnCount }, () => '').join(' | ')} |`
  const changes = ChangeSet.insert(at, `${atEnd ? nl : ''}${row}${atEnd ? '' : nl}`)
  return changedTable(state, context, changes, after + 1, column, 'add-row')
}
export function tableCommand(
  state: EditorState,
  context: TableContext,
  command: TableCommand,
): Transaction | undefined {
  const { table, rows, row, column, cell, columnCount } = context
  if (command === 'select-table')
    return {
      selection: Selection.range(table.from, table.to),
      addToHistory: false,
      origin: { type: 'command', id: 'table.select' },
    }
  if (command === 'select-cell') return select(cell)
  if (!context.withinCell) return
  if (command === 'exit') {
    const nl = eol(state, context)
    if (table.to < state.doc.length && state.doc.lineAt(table.to).text === '')
      return cursor(table.to)
    const insert = table.to === state.doc.length && !state.doc.text.endsWith('\n') ? nl + nl : nl
    return edit(
      ChangeSet.insert(table.to, insert),
      table.to + (table.to === state.doc.length ? insert.length : 0),
      'exit',
    )
  }
  if (command === 'next' || command === 'previous' || command === 'down') {
    let nextRow = row,
      nextColumn = column
    if (command === 'down') nextRow++
    else if (command === 'next') {
      nextColumn++
      if (nextColumn >= context.cells.length) {
        nextColumn = 0
        nextRow++
      }
    } else {
      nextColumn--
      if (nextColumn < 0) {
        nextRow--
        nextColumn = (rows[nextRow]?.children?.length ?? 1) - 1
      }
    }
    if (nextRow < 0)
      return table.from > 0
        ? cursor(state.doc.lineAt(table.from - 1).to)
        : edit(ChangeSet.insert(0, eol(state, context)), 0, 'exit-before')
    if (nextRow >= rows.length)
      return addRow(state, context, rows.length - 1, command === 'down' ? column : 0)
    const cells = rows[nextRow]!.children!
    return select(cells[Math.min(nextColumn, cells.length - 1)]!)
  }
  if (command === 'add-row') return addRow(state, context, row, column)
  if (command === 'delete-row') {
    if (row === 0) return
    const target = rows[row]!
    const changes = ChangeSet.delete(target.from, target.to)
    return changedTable(
      state,
      context,
      changes,
      Math.min(row, rows.length - 2),
      column,
      'delete-row',
    )
  }
  if (command === 'delete-column' && columnCount <= 2) return
  const contents = rows.map((row) =>
    Array.from({ length: columnCount }, (_, index) => {
      const cell = row.children?.[index]
      return cell ? state.doc.slice(cell.from, cell.to) : ''
    }),
  )
  const aligns = Array.isArray(table.data?.alignments) ? table.data.alignments : []
  const delimiters = Array.from({ length: columnCount }, (_, i) =>
    aligns[i] === 'left'
      ? ':---'
      : aligns[i] === 'right'
        ? '---:'
        : aligns[i] === 'center'
          ? ':---:'
          : '---',
  )
  for (const values of [...contents, delimiters]) {
    if (command === 'add-column') values.splice(column + 1, 0, values === delimiters ? '---' : '')
    else values.splice(column, 1)
  }
  const nl = eol(state, context)
  const lines = [contents[0]!, delimiters, ...contents.slice(1)].map(
    (cells) => `| ${cells.join(' | ')} |`,
  )
  const source = lines.join(nl) + (state.doc.slice(table.from, table.to).endsWith('\n') ? nl : '')
  return changedTable(
    state,
    context,
    ChangeSet.replace(table.from, table.to, source),
    row,
    command === 'add-column' ? column + 1 : Math.min(column, columnCount - 2),
    command,
  )
}

// Pipe tables store visual cell line breaks inline, never as new Markdown rows.
export function tableCellText(text: string, prefix = ''): string {
  const precedingSlashes = /\\*$/.exec(prefix)?.[0].length ?? 0
  return text
    .replace(/(\\*)\|/g, (match, slashes: string, offset: number) =>
      (slashes.length + (offset === 0 ? precedingSlashes : 0)) % 2 ? match : `${slashes}\\|`,
    )
    .replace(/\r\n|\r|\n/g, '<br>')
}

export function tableArrowSelection(
  state: EditorState,
  table: TableContext,
  direction: 'left' | 'right' | 'up' | 'down',
  extend: boolean,
): Selection {
  const { doc, selection } = state
  const range = selection.main
  const forward = direction === 'right' || direction === 'down'
  let next = range.head
  let target = table.cell
  if (!extend && !range.empty) next = forward ? range.to : range.from
  else if (extend && (direction === 'up' || direction === 'down'))
    next = forward ? target.to : target.from
  else if (direction === 'left' || direction === 'right') {
    next = forward
      ? nextGraphemePosition(doc, range.head)
      : previousGraphemePosition(doc, range.head)
    if (next < target.from || next > target.to) {
      if (extend) next = forward ? target.to : target.from
      else {
        const adjacent = forward
          ? (table.cells[table.column + 1] ?? table.rows[table.row + 1]?.children?.[0])
          : (table.cells[table.column - 1] ?? table.rows[table.row - 1]?.children?.at(-1))
        if (adjacent) {
          target = adjacent
          next = forward ? target.from : target.to
        } else next = outsidePosition(state, table, forward)
      }
    }
  } else {
    const row = table.rows[table.row + (forward ? 1 : -1)]
    const adjacent = row?.children?.[Math.min(table.column, (row.children?.length ?? 1) - 1)]
    if (adjacent) {
      target = adjacent
      next = snapGraphemePosition(
        doc,
        Math.min(target.to, target.from + range.head - table.cell.from),
      )
    } else next = outsidePosition(state, table, forward)
  }
  // A rendered line break or escaped pipe is one visible unit in a live cell.
  for (const atom of doc.slice(target.from, target.to).matchAll(/<br[ \t]*\/?>|\\\|/gi)) {
    const from = target.from + atom.index
    const to = from + atom[0].length
    if (next > from && next < to) next = forward ? to : from
  }
  return extend ? Selection.range(range.anchor, next) : Selection.cursor(next)
}

function outsidePosition(state: EditorState, table: TableContext, forward: boolean): number {
  const doc = state.doc
  if (forward) return table.table.to < doc.length ? table.table.to : table.cell.to
  return table.table.from > 0 ? doc.lineAt(table.table.from - 1).to : table.cell.from
}

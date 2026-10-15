import { EditorState, MemoryTextDocument, Selection } from '@milkup/core'
import type { Transaction } from '@milkup/core'
import { parseMarkdown, type SyntaxNode } from '@milkup/markdown'
import { tableCommand, tableContext, type TableContext, type TableCommand } from './table-editing'

export interface EditingSelection {
  readonly anchor: number
  readonly head: number
}
export type TableAlignment = 'left' | 'center' | 'right' | 'default'
export interface TableEditingContext {
  readonly from: number
  readonly to: number
  readonly text: string
  readonly selection: EditingSelection
  readonly row: number
  readonly column: number
  readonly rowCount: number
  readonly columnCount: number
  readonly alignment: TableAlignment
  readonly withinCell: boolean
}
export interface EditingContext {
  readonly kind: 'text' | 'code' | 'table' | 'unknown'
  readonly complete: boolean
  readonly table?: TableEditingContext
}
export type TableEditOperation =
  | { readonly operation: 'set-cell'; readonly text: string }
  | { readonly operation: 'insert-table'; readonly rows: number; readonly columns: number }
  | { readonly operation: 'align-column'; readonly alignment: TableAlignment }
  | {
      readonly operation:
        | 'add-row'
        | 'delete-row'
        | 'add-column'
        | 'delete-column'
        | 'clear-cell'
        | 'select-cell'
        | 'select-table'
        | 'exit'
    }
export interface TableEditPlan {
  readonly changes: readonly {
    readonly from: number
    readonly to: number
    readonly insert: string
  }[]
  readonly selectionAfter: EditingSelection
}
export const editingContextLimits = Object.freeze({ text: 65_536, lines: 256, columns: 16 })

export function tableEditingContext(
  state: EditorState,
  context: TableContext,
  offset = 0,
): TableEditingContext | undefined {
  const { table } = context
  if (
    table.to - table.from > editingContextLimits.text ||
    context.rows.length + 1 > editingContextLimits.lines ||
    context.columnCount > editingContextLimits.columns
  )
    return
  const alignment = (table.data?.alignments as readonly unknown[] | undefined)?.[context.column]
  return {
    from: offset + table.from,
    to: offset + table.to,
    text: state.doc.slice(table.from, table.to),
    selection: {
      anchor: offset + state.selection.main.anchor,
      head: offset + state.selection.main.head,
    },
    row: context.row,
    column: context.column,
    rowCount: context.rows.length,
    columnCount: context.columnCount,
    alignment:
      alignment === 'left' || alignment === 'right' || alignment === 'center'
        ? alignment
        : 'default',
    withinCell: context.withinCell,
  }
}

export function editingContextFromState(
  state: EditorState,
  root: SyntaxNode,
  offset = 0,
): EditingContext {
  const range = state.selection.main
  const code = (node: SyntaxNode): boolean =>
    node.from <= range.to &&
    (node.to > range.from ||
      (range.empty &&
        node.to === range.from &&
        node.to === state.doc.length &&
        !state.doc.text.endsWith('\n'))) &&
    (node.type === 'fencedCode' || node.type === 'indentedCode' || !!node.children?.some(code))
  if (code(root)) return { kind: 'code', complete: true }
  // The block parser deliberately retains container lines rather than parsing
  // their nested block grammar. Do not turn that absence of CST into proof that
  // a quoted/list fence, indented block or raw HTML is ordinary text.
  const uncertainContainer = (node: SyntaxNode): boolean => {
    if (node.from > range.to) return false
    if (['blockquote', 'unorderedList', 'orderedList', 'listItem'].includes(node.type)) {
      if (node.to - node.from > editingContextLimits.text) return true
      const text = state.doc.slice(node.from, node.to)
      // A list continuation may be a sibling paragraph in the current CST.
      // A prior container fence therefore invalidates proof for following text.
      if (/^[\t >+*\d.)-]*(?:`{3,}|~{3,})/m.test(text)) return true
      if (
        node.to >= range.from &&
        (/^(?: {4}|\t| {0,3}>[ \t]?(?: {4}|\t))/m.test(text) || /<\/?[A-Za-z!][^>]*>/.test(text))
      )
        return true
    }
    return !!node.children?.some(uncertainContainer)
  }
  const unsupportedHTML = (node: SyntaxNode): boolean =>
    node.from <= range.to &&
    node.to >= range.from &&
    ((node.type === 'fallbackText' && node.data?.block === 'html') ||
      !!node.children?.some(unsupportedHTML))
  if (unsupportedHTML(root) || uncertainContainer(root)) return { kind: 'unknown', complete: false }
  const context = tableContext(state, root)
  if (context) {
    const table = tableEditingContext(state, context, offset)
    return { kind: 'table', complete: !!table, ...(table ? { table } : {}) }
  }
  // A selection spanning only part of a table must not be treated as ordinary text.
  if (
    root.children?.some(
      (node) => node.type === 'table' && node.from < range.to && node.to > range.from,
    )
  )
    return { kind: 'table', complete: false }
  return { kind: 'text', complete: true }
}

/** Pure preparation only. The caller owns snapshot containment, CAS and the one history commit. */
export function prepareTableEdit(
  context: TableEditingContext,
  operation: TableEditOperation,
  trailingText = '',
): TableEditPlan | undefined {
  if (
    !context ||
    context.text.length + trailingText.length > editingContextLimits.text ||
    context.to - context.from !== context.text.length
  )
    return
  const state = new EditorState({
    doc: new MemoryTextDocument(context.text + trailingText),
    selection: Selection.range(
      context.selection.anchor - context.from,
      context.selection.head - context.from,
    ),
  })
  const table = tableContext(state, parseMarkdown(context.text).root)
  if (!table || !tableEditingContext(state, table)) return
  let command: TableCommand
  if (operation.operation === 'align-column') {
    if (!['left', 'center', 'right', 'default'].includes(operation.alignment)) return
    command = `align-${operation.alignment}`
  } else if (operation.operation === 'insert-table') return
  else command = operation.operation
  if (command === 'add-column' && table.columnCount >= editingContextLimits.columns) return
  if (command === 'add-row' && table.rows.length + 2 > editingContextLimits.lines) return
  if (
    operation.operation === 'set-cell' &&
    (typeof operation.text !== 'string' || operation.text.length > editingContextLimits.text)
  )
    return
  const transaction = tableCommand(
    state,
    table,
    command,
    operation.operation === 'set-cell' ? operation.text : undefined,
  )
  if (
    transaction?.changes &&
    state.doc.length +
      transaction.changes.changes.reduce(
        (delta, change) => delta + change.insert.length - (change.to - change.from),
        0,
      ) >
      editingContextLimits.text
  )
    return
  return transaction
    ? tableTransactionPlan(transaction, context.from, state.selection.main)
    : undefined
}

export function tableTransactionPlan(
  transaction: Transaction,
  offset: number,
  fallback: EditingSelection,
): TableEditPlan {
  const selection = transaction.selection?.main ?? fallback
  return {
    changes: (transaction.changes?.changes ?? []).map((change) => ({
      from: change.from + offset,
      to: change.to + offset,
      insert: change.insert,
    })),
    selectionAfter: { anchor: selection.anchor + offset, head: selection.head + offset },
  }
}

/** Insert into a captured text range. Newline convention comes from that capture. */
export function prepareTableInsertion(
  context: {
    readonly from: number
    readonly text: string
    readonly selection: EditingSelection
    readonly lineEnding?: 'lf' | 'crlf'
  },
  rows: number,
  columns: number,
): TableEditPlan | undefined {
  if (
    !Number.isInteger(rows) ||
    rows < 1 ||
    rows > 64 ||
    !Number.isInteger(columns) ||
    columns < 1 ||
    columns > 16 ||
    context.text.length > editingContextLimits.text
  )
    return
  const from = Math.min(context.selection.anchor, context.selection.head),
    to = Math.max(context.selection.anchor, context.selection.head)
  if (from < context.from || to > context.from + context.text.length) return
  const before = context.text.slice(0, from - context.from),
    after = context.text.slice(to - context.from)
  const nl =
    context.lineEnding === 'crlf' ||
    (context.lineEnding === undefined && context.text.includes('\r\n'))
      ? '\r\n'
      : '\n'
  const row = `| ${Array.from({ length: columns }, () => '').join(' | ')} |`
  const delimiter = `| ${Array.from({ length: columns }, () => '---').join(' | ')} |`
  const prefix =
    before && !before.endsWith('\n') ? nl + nl : before && !before.endsWith(nl + nl) ? nl : ''
  const suffix = after && !after.startsWith('\n') && !after.startsWith('\r\n') ? nl + nl : nl
  const insert =
    prefix + [row, delimiter, ...Array.from({ length: rows }, () => row)].join(nl) + suffix
  return {
    changes: [{ from, to, insert }],
    selectionAfter: { anchor: from + prefix.length + 2, head: from + prefix.length + 2 },
  }
}

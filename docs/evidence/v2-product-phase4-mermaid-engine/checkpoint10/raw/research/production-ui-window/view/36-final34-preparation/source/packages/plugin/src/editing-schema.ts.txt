export interface PluginEditingOperationOptions {
  readonly signal?: AbortSignal
}
export interface PluginEditingRange {
  readonly from: number
  readonly to: number
}
export interface PluginEditingSelection {
  readonly anchor: number
  readonly head: number
}
export interface PluginEditingCaptureRequest {
  readonly extent: 'selection' | 'lines'
  readonly beforeLines?: number
  readonly afterLines?: number
}
export interface PluginEditingSyntaxNode extends PluginEditingRange {
  readonly type: string
  readonly status: 'valid' | 'incomplete' | 'invalid' | 'fallback'
  readonly markerRanges: readonly PluginEditingRange[]
  readonly contentRanges?: readonly PluginEditingRange[]
}
export interface PluginEditingSnapshot extends PluginEditingRange {
  readonly id: string
  readonly documentId: string
  readonly version: number
  readonly selectionRevision: number
  readonly saveLocationGeneration: number
  readonly text: string
  readonly selection: PluginEditingSelection
  readonly startLine: number
  readonly lineCount: number
  readonly lineEnding: 'lf' | 'crlf'
  readonly mode: 'memory' | 'windowed'
  readonly context?: {
    readonly kind: 'text' | 'code' | 'table' | 'unknown'
    readonly complete: boolean
  }
  readonly syntax?: { readonly nodes: readonly PluginEditingSyntaxNode[] }
  readonly table?: {
    readonly row: number
    readonly column: number
    readonly rowCount: number
    readonly columnCount: number
    readonly alignment: 'left' | 'center' | 'right' | 'default'
    readonly withinCell: boolean
  }
}
export interface PluginEditingApplyRequest {
  readonly snapshotId: string
  readonly changes: readonly (PluginEditingRange & { readonly insert: string })[]
  readonly selection?: PluginEditingSelection
  readonly assetIds?: readonly string[]
}
export type PluginEditingTableRequest =
  | {
      readonly snapshotId: string
      readonly operation: 'insert-table'
      readonly rows: number
      readonly columns: number
    }
  | {
      readonly snapshotId: string
      readonly operation: 'align-column'
      readonly alignment: 'left' | 'center' | 'right' | 'default'
    }
  | { readonly snapshotId: string; readonly operation: 'set-cell'; readonly text: string }
  | {
      readonly snapshotId: string
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
export interface PluginEditingApplyResult {
  readonly documentId: string
  readonly version: number
}
export interface PluginEditingHost {
  capture(
    request: PluginEditingCaptureRequest,
    options?: PluginEditingOperationOptions,
  ): Promise<PluginEditingSnapshot>
  apply(
    request: PluginEditingApplyRequest,
    options?: PluginEditingOperationOptions,
  ): Promise<PluginEditingApplyResult>
  table(
    request: PluginEditingTableRequest,
    options?: PluginEditingOperationOptions,
  ): Promise<PluginEditingApplyResult>
  release(id: string, options?: PluginEditingOperationOptions): Promise<void>
}
export const PLUGIN_EDITING_ERROR_CODES = [
  'revoked',
  'invalid-input',
  'invalid-snapshot',
  'stale',
  'readonly',
  'busy',
  'too-large',
  'unsupported',
  'aborted',
  'unavailable',
] as const
export type PluginEditingErrorCode = (typeof PLUGIN_EDITING_ERROR_CODES)[number]
export class PluginEditingError extends Error {
  constructor(readonly code: PluginEditingErrorCode) {
    super(`Editing operation failed: ${code}`)
    this.name = 'PluginEditingError'
  }
}
export const EDITING_LIMITS = Object.freeze({
  text: 65536,
  lines: 256,
  changes: 64,
  snapshots: 8,
  nodes: 2048,
})
export function editingRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
export function editingKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  return (
    required.every((k) => Object.hasOwn(value, k)) &&
    Object.keys(value).every((k) => required.includes(k) || optional.includes(k))
  )
}
function fail(): never {
  throw new PluginEditingError('invalid-input')
}
export function assertPluginEditingId(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) fail()
}
function integer(value: unknown, max = Number.MAX_SAFE_INTEGER, min = 0): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) fail()
}
function range(value: unknown, max: number): PluginEditingRange {
  if (!editingRecord(value) || !editingKeys(value, ['from', 'to'])) fail()
  integer(value.from, max)
  integer(value.to, max, value.from)
  return Object.freeze({ from: value.from, to: value.to })
}
function selection(value: unknown, max: number): PluginEditingSelection {
  if (!editingRecord(value) || !editingKeys(value, ['anchor', 'head'])) fail()
  integer(value.anchor, max)
  integer(value.head, max)
  return Object.freeze({ anchor: value.anchor, head: value.head })
}
export function copyPluginEditingCaptureRequest(value: unknown): PluginEditingCaptureRequest {
  if (
    !editingRecord(value) ||
    !editingKeys(value, ['extent'], ['beforeLines', 'afterLines']) ||
    !['selection', 'lines'].includes(value.extent as string)
  )
    fail()
  for (const key of ['beforeLines', 'afterLines'])
    if (value[key] !== undefined) integer(value[key], 128)
  if (
    value.extent === 'selection' &&
    (value.beforeLines !== undefined || value.afterLines !== undefined)
  )
    fail()
  return Object.freeze({ ...value }) as unknown as PluginEditingCaptureRequest
}
const NODE_TYPES = [
  'document',
  'blankLine',
  'paragraph',
  'heading',
  'fencedCode',
  'indentedCode',
  'blockquote',
  'blockquoteLine',
  'table',
  'tableRow',
  'tableCell',
  'thematicBreak',
  'unorderedList',
  'orderedList',
  'listItem',
  'text',
  'escape',
  'inlineCode',
  'emphasis',
  'strong',
  'strikethrough',
  'link',
  'image',
  'autolink',
  'hardBreak',
  'fallbackText',
]
export function copyPluginEditingSnapshot(value: unknown): PluginEditingSnapshot {
  if (
    !editingRecord(value) ||
    !editingKeys(
      value,
      [
        'id',
        'documentId',
        'version',
        'selectionRevision',
        'saveLocationGeneration',
        'from',
        'to',
        'text',
        'selection',
        'startLine',
        'lineCount',
        'lineEnding',
        'mode',
      ],
      ['context', 'syntax', 'table'],
    )
  )
    fail()
  assertPluginEditingId(value.id)
  if (typeof value.documentId !== 'string' || !value.documentId || value.documentId.length > 512)
    fail()
  for (const key of ['version', 'selectionRevision', 'saveLocationGeneration', 'from', 'to'])
    integer(value[key])
  if (typeof value.text !== 'string') fail()
  if (value.text.length > EDITING_LIMITS.text) throw new PluginEditingError('too-large')
  if ((value.to as number) - (value.from as number) !== value.text.length) fail()
  integer(value.startLine, Number.MAX_SAFE_INTEGER, 1)
  integer(value.lineCount, 256, 1)
  if (
    !['lf', 'crlf'].includes(value.lineEnding as string) ||
    !['memory', 'windowed'].includes(value.mode as string)
  )
    fail()
  const result: Record<string, unknown> = {
    ...value,
    selection: selection(value.selection, value.text.length),
  }
  if (value.context !== undefined) {
    const c = value.context
    if (
      !editingRecord(c) ||
      !editingKeys(c, ['kind', 'complete']) ||
      !['text', 'code', 'table', 'unknown'].includes(c.kind as string) ||
      typeof c.complete !== 'boolean'
    )
      fail()
    result.context = Object.freeze({ ...c })
  }
  if (value.syntax !== undefined) {
    const s = value.syntax
    if (
      !editingRecord(s) ||
      !editingKeys(s, ['nodes']) ||
      !Array.isArray(s.nodes) ||
      s.nodes.length > 2048
    )
      fail()
    result.syntax = Object.freeze({
      nodes: Object.freeze(
        s.nodes.map((n) => {
          if (
            !editingRecord(n) ||
            !editingKeys(n, ['type', 'status', 'from', 'to', 'markerRanges'], ['contentRanges']) ||
            !NODE_TYPES.includes(n.type as string) ||
            !['valid', 'incomplete', 'invalid', 'fallback'].includes(n.status as string)
          )
            fail()
          range({ from: n.from, to: n.to }, (value.text as string).length)
          const ranges = (r: unknown) => {
            if (!Array.isArray(r) || r.length > 64) fail()
            return Object.freeze(
              r.map((v) => {
                const v1 = range(v, (value.text as string).length)
                if (v1.from < (n.from as number) || v1.to > (n.to as number)) fail()
                return v1
              }),
            )
          }
          return Object.freeze({
            ...n,
            markerRanges: ranges(n.markerRanges),
            ...(n.contentRanges !== undefined ? { contentRanges: ranges(n.contentRanges) } : {}),
          })
        }),
      ),
    })
  }
  if (value.table !== undefined) {
    const t = value.table
    if (
      !editingRecord(t) ||
      !editingKeys(t, ['row', 'column', 'rowCount', 'columnCount', 'alignment', 'withinCell'])
    )
      fail()
    integer(t.rowCount, 256, 1)
    integer(t.columnCount, 16, 1)
    integer(t.row, (t.rowCount as number) - 1)
    integer(t.column, (t.columnCount as number) - 1)
    if (
      !['left', 'center', 'right', 'default'].includes(t.alignment as string) ||
      typeof t.withinCell !== 'boolean'
    )
      fail()
    result.table = Object.freeze({ ...t })
  }
  return Object.freeze(result) as unknown as PluginEditingSnapshot
}
export function copyPluginEditingApplyRequest(
  value: unknown,
  snapshot?: PluginEditingSnapshot,
): PluginEditingApplyRequest {
  if (
    !editingRecord(value) ||
    !editingKeys(value, ['snapshotId', 'changes'], ['selection', 'assetIds'])
  )
    fail()
  assertPluginEditingId(value.snapshotId)
  if (!Array.isArray(value.changes) || value.changes.length > 64)
    throw new PluginEditingError('too-large')
  let end = 0,
    inserted = 0,
    delta = 0
  const changes = value.changes.map((c) => {
    if (
      !editingRecord(c) ||
      !editingKeys(c, ['from', 'to', 'insert']) ||
      typeof c.insert !== 'string'
    )
      fail()
    const r = range({ from: c.from, to: c.to }, snapshot?.text.length ?? 65536)
    if (r.from < end) fail()
    end = r.to
    inserted += c.insert.length
    delta += c.insert.length - (r.to - r.from)
    return Object.freeze({ ...r, insert: c.insert })
  })
  if (inserted > 65536) throw new PluginEditingError('too-large')
  let assetIds: readonly string[] | undefined
  if (value.assetIds !== undefined) {
    if (
      !Array.isArray(value.assetIds) ||
      value.assetIds.length > 16 ||
      new Set(value.assetIds).size !== value.assetIds.length
    )
      fail()
    value.assetIds.forEach(assertPluginEditingId)
    assetIds = Object.freeze([...value.assetIds])
  }
  return Object.freeze({
    snapshotId: value.snapshotId,
    changes: Object.freeze(changes),
    ...(value.selection !== undefined
      ? { selection: selection(value.selection, snapshot ? snapshot.text.length + delta : 131072) }
      : {}),
    ...(assetIds ? { assetIds } : {}),
  })
}
export function copyPluginEditingTableRequest(value: unknown): PluginEditingTableRequest {
  if (!editingRecord(value)) fail()
  assertPluginEditingId(value.snapshotId)
  const op = value.operation
  const fields =
    op === 'insert-table'
      ? ['rows', 'columns']
      : op === 'align-column'
        ? ['alignment']
        : op === 'set-cell'
          ? ['text']
          : []
  if (!editingKeys(value, ['snapshotId', 'operation', ...fields])) fail()
  if (op === 'insert-table') {
    integer(value.rows, 64, 1)
    integer(value.columns, 16, 1)
  } else if (op === 'align-column') {
    if (!['left', 'center', 'right', 'default'].includes(value.alignment as string)) fail()
  } else if (op === 'set-cell') {
    if (typeof value.text !== 'string' || value.text.length > 65536) fail()
  } else if (
    ![
      'add-row',
      'delete-row',
      'add-column',
      'delete-column',
      'clear-cell',
      'select-cell',
      'select-table',
      'exit',
    ].includes(op as string)
  )
    fail()
  return Object.freeze({ ...value }) as unknown as PluginEditingTableRequest
}
export function copyPluginEditingApplyResult(value: unknown): PluginEditingApplyResult {
  if (!editingRecord(value) || !editingKeys(value, ['documentId', 'version'])) fail()
  if (typeof value.documentId !== 'string' || !value.documentId || value.documentId.length > 512)
    fail()
  integer(value.version)
  return Object.freeze({ documentId: value.documentId, version: value.version })
}

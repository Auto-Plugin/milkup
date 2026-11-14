import type { SdkEditingSnapshot, SdkPluginEditingHost, SdkPluginUiNode } from '@milkup/plugin-sdk'
import { transform, type Capture } from './transforms'

export interface State {
  busy: boolean
  snapshot?: SdkEditingSnapshot | undefined
  error?: string | undefined
  message?: string | undefined
  fields: { url: string; rows: string; columns: string; cell: string }
}
const failure = (error: unknown): string => {
  const code =
    typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : ''
  if (/stale|invalidated|version|selection/i.test(code))
    return '文档或选区已改变，未应用修改。请重新读取选区后重试。'
  if (/readonly/i.test(code)) return '当前文档只读，未应用修改。'
  if (/limit|budget|range/i.test(code))
    return '选区超过编辑范围或预算，未应用修改。请选择更小的完整内容。'
  if (/abort|disposed|inactive/i.test(code)) return '操作已取消，未应用修改。'
  return error instanceof Error ? error.message : '格式操作失败，未应用修改。'
}
export function normalize(snapshot: SdkEditingSnapshot): Capture {
  return {
    text: snapshot.text,
    selection: snapshot.selection,
    lineEnding: snapshot.lineEnding === 'crlf' ? '\r\n' : '\n',
    syntax: {
      context: snapshot.context?.kind ?? 'unknown',
      complete: snapshot.context?.complete ?? false,
      nodes: [...(snapshot.syntax?.nodes ?? [])].map((n) => ({
        ...n,
        markerRanges: n.markerRanges ?? [],
      })),
    },
  }
}
export function createController(host: SdkPluginEditingHost | undefined, changed: () => void) {
  let active = true,
    generation = 0
  let pending: AbortController | undefined
  let pendingKind: 'load' | 'edit' | undefined
  let state: State = { busy: false, fields: { url: 'https://', rows: '2', columns: '3', cell: '' } }
  const publish = (patch: Partial<State>) => {
    state = { ...state, ...patch }
    if (active) changed()
  }
  const release = (snapshot?: SdkEditingSnapshot) => {
    if (snapshot && host) void host.release(snapshot.id).catch(() => undefined)
  }
  async function captureBounded(signal?: AbortSignal) {
    const options = signal ? { signal } : undefined
    const first = await host!.capture({ extent: 'lines' }, options)
    const table = first.table
    if (!table) return first
    // Metadata is available even when the first small capture cuts the table.
    // Expand by its measured physical rows, not by an arbitrary large window.
    const headLine = first.text.slice(0, first.selection.head).split(/\r\n|\n/).length - 1
    const tableHeadLine = table.row === 0 ? 0 : table.row + 1
    const beforeLines = Math.max(0, tableHeadLine - headLine)
    const afterLines = Math.max(
      0,
      table.rowCount - tableHeadLine - (first.lineCount - headLine - 1) + 2,
    )
    if (first.context?.complete && beforeLines === 0 && afterLines === 0) return first
    try {
      if (first.lineCount + beforeLines + afterLines > 256)
        throw new Error('完整表格超过 256 行，未应用修改。')
      if (signal?.aborted || !active) throw new Error('操作已取消，未应用修改。')
      const expanded = await host!.capture({ extent: 'lines', beforeLines, afterLines }, options)
      if (
        expanded.documentId !== first.documentId ||
        expanded.version !== first.version ||
        expanded.selectionRevision !== first.selectionRevision ||
        expanded.saveLocationGeneration !== first.saveLocationGeneration
      ) {
        release(expanded)
        throw new Error('读取表格时文档或选区已改变，未应用修改。请重试。')
      }
      if (!expanded.context?.complete || !expanded.table) {
        release(expanded)
        throw new Error('无法读取完整表格边界，未应用修改。')
      }
      return expanded
    } finally {
      release(first)
    }
  }
  async function run(
    operation: (signal: AbortSignal) => Promise<void>,
    kind: 'load' | 'edit' = 'edit',
  ) {
    if (!active) return
    if (state.busy) {
      if (pendingKind !== 'load') return
      // A newer context read or explicit action supersedes an obsolete background read.
      pending?.abort()
      generation++
    }
    if (!host) {
      publish({ error: '当前宿主不支持公开编辑接口，请升级到 SDK 0.3.2 对应版本。' })
      return
    }
    const current = ++generation,
      abort = new AbortController()
    pending = abort
    pendingKind = kind
    publish({ busy: true, error: undefined, message: undefined })
    try {
      await operation(abort.signal)
    } catch (error) {
      if (active && current === generation) publish({ error: failure(error) })
    } finally {
      if (active && current === generation) {
        pending = undefined
        pendingKind = undefined
        publish({ busy: false })
      }
    }
  }
  async function refresh(signal?: AbortSignal, target?: SdkPluginUiNode) {
    if (!host) return
    const snapshot = await captureBounded(signal)
    if (
      !active ||
      signal?.aborted ||
      (target?.documentId !== undefined && snapshot.documentId !== target.documentId) ||
      (target?.documentVersion !== undefined && snapshot.version !== target.documentVersion) ||
      (target?.selectionRevision !== undefined &&
        snapshot.selectionRevision !== target.selectionRevision)
    ) {
      release(snapshot)
      return
    }
    release(state.snapshot)
    publish({ snapshot })
  }
  async function snapshotFor(draft: boolean, signal: AbortSignal, snapshotId?: string) {
    if (snapshotId !== undefined && state.snapshot?.id !== snapshotId)
      throw new Error('文档或选区已改变，未应用修改。请重新读取选区后重试。')
    if (draft) {
      if (!state.snapshot) throw new Error('尚未读取选区，请重新读取后重试。')
      return state.snapshot
    }
    return captureBounded(signal)
  }
  return {
    get state() {
      return state
    },
    load(target?: SdkPluginUiNode) {
      return run(async (signal) => {
        release(state.snapshot)
        publish({ snapshot: undefined })
        await refresh(signal, target)
      }, 'load')
    },
    field(input: unknown) {
      if (!active || state.busy || !input || typeof input !== 'object') return
      const value = input as { field?: unknown; value?: unknown }
      if (
        typeof value.field !== 'string' ||
        typeof value.value !== 'string' ||
        !['url', 'rows', 'columns', 'cell'].includes(value.field)
      )
        return
      publish({
        fields: { ...state.fields, [value.field]: value.value },
        error: undefined,
        message: undefined,
      })
    },
    execute(action: string, draft = false, snapshotId?: string) {
      return run(async (signal) => {
        const snapshot = await snapshotFor(draft, signal, snapshotId)
        try {
          if (!active || signal.aborted) return
          const edit = transform(
            normalize(snapshot),
            action,
            action === 'link' ? state.fields.url : undefined,
          )
          await host!.apply({ snapshotId: snapshot.id, ...edit }, { signal })
          if (!active || signal.aborted) return
          publish({ message: '已应用格式，可使用撤销恢复。' })
          try {
            await refresh(signal)
          } catch {
            if (!active || signal.aborted) return
            publish({ error: '格式已应用，但无法重新读取选区。请点击重新读取选区。' })
          }
        } finally {
          if (!draft) release(snapshot)
        }
      })
    },
    table(operation: string, draft = false, snapshotId?: string) {
      return run(async (signal) => {
        const snapshot = await snapshotFor(draft, signal, snapshotId)
        try {
          if (!active || signal.aborted) return
          let request: Parameters<SdkPluginEditingHost['table']>[0]
          if (operation === 'insert-table') {
            const rows = Number(state.fields.rows),
              columns = Number(state.fields.columns)
            if (
              !Number.isInteger(rows) ||
              rows < 1 ||
              rows > 64 ||
              !Number.isInteger(columns) ||
              columns < 1 ||
              columns > 16
            )
              throw new Error('表格正文行数须为 1–64，列数须为 1–16。')
            request = { snapshotId: snapshot.id, operation, rows, columns }
          } else if (operation === 'set-cell') {
            request = { snapshotId: snapshot.id, operation, text: state.fields.cell }
          } else if (operation.startsWith('align-')) {
            if (!['align-left', 'align-center', 'align-right', 'align-default'].includes(operation))
              throw new Error('不支持的列对齐方式。')
            request = {
              snapshotId: snapshot.id,
              operation: 'align-column',
              alignment: operation.slice(6) as 'left' | 'center' | 'right' | 'default',
            }
          } else {
            const allowed = [
              'add-row',
              'delete-row',
              'add-column',
              'delete-column',
              'clear-cell',
              'select-cell',
              'select-table',
              'exit',
            ] as const
            const valid = allowed.find((item) => item === operation)
            if (!valid) throw new Error('不支持的表格操作。')
            request = { snapshotId: snapshot.id, operation: valid }
          }
          await host!.table(request, { signal })
          if (!active || signal.aborted) return
          publish({
            message: operation.startsWith('select-')
              ? '已更新表格选区。'
              : '已应用表格操作，可使用撤销恢复。',
          })
          try {
            await refresh(signal)
          } catch {
            if (!active || signal.aborted) return
            publish({ error: '表格操作已应用，但无法重新读取选区。请点击重新读取选区。' })
          }
        } finally {
          if (!draft) release(snapshot)
        }
      })
    },
    cancel() {
      pending?.abort()
      generation++
      pending = undefined
      pendingKind = undefined
      release(state.snapshot)
      state = { busy: false, fields: state.fields }
      if (active) changed()
    },
    dispose() {
      active = false
      generation++
      pending?.abort()
      release(state.snapshot)
    },
  }
}

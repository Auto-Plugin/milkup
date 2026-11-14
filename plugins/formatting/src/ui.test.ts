import { describe, expect, it, vi } from 'vitest'
import type { SdkRendererOutput } from '@milkup/plugin-sdk'
import plugin, { renderModal, renderToolbar, formatActions, tableActions } from './plugin'
import type { State } from './controller'
import manifest from '../plugin.json'
function elements(output: SdkRendererOutput): any[] {
  if (!output || typeof output !== 'object') return []
  if (Array.isArray(output)) return output.flatMap(elements)
  const item = output as any
  return [item, ...(item.children ?? []).flatMap(elements)]
}
const base = (): State => ({
  busy: false,
  fields: { url: './target.md', rows: '2', columns: '3', cell: '' },
  snapshot: {
    id: 's',
    documentId: 'd',
    version: 1,
    selectionRevision: 1,
    saveLocationGeneration: 0,
    from: 0,
    to: 0,
    text: '',
    selection: { anchor: 0, head: 0 },
    startLine: 1,
    lineCount: 1,
    lineEnding: 'lf',
    mode: 'memory',
    context: { kind: 'text', complete: true },
  },
})
describe('controlled formatting UI', () => {
  it('contributes every rendered action and uses only the intended permissions and slots', () => {
    const commands = new Set(manifest.contributes.commands.map((c) => c.action))
    for (const item of elements(renderModal(base())))
      if (item.action) expect(commands.has(item.action.command)).toBe(true)
    for (const [id] of [...formatActions, ...tableActions])
      expect(commands.has(`formatting.${id}`)).toBe(true)
    expect(manifest.permissions).toEqual(['document:read', 'document:write'])
    expect(manifest.contributes.ui.map((u) => u.slot)).toEqual([
      'document-toolbar',
      'modal',
      'context-menu',
    ])
  })
  it('shows table controls with a reason when the selection is outside a table', () => {
    const nodes = elements(renderModal(base()))
    expect(nodes.find((n) => n.text === '删除行')?.disabled).toBe(true)
    expect(
      nodes.find((n) => typeof n.text === 'string' && n.text.includes('选区不在可编辑的完整表格')),
    ).toBeTruthy()
    expect(nodes.find((n) => n.text === '插入表格')?.disabled).toBe(false)
  })
  it('keeps header and minimum-column operations visibly disabled', () => {
    const state = base()
    state.snapshot = {
      ...state.snapshot!,
      table: {
        row: 0,
        column: 0,
        rowCount: 2,
        columnCount: 2,
        alignment: 'default',
        withinCell: true,
      },
    }
    const nodes = elements(renderToolbar(state))
    expect(nodes.find((n) => n.text === '删除行')?.disabled).toBe(true)
    expect(nodes.find((n) => n.text === '删除列')?.disabled).toBe(true)
    expect(nodes.find((n) => n.text === '下方加行')?.disabled).toBe(false)
    expect(nodes.find((n) => n.text === '退出表格')?.disabled).toBe(false)
  })
  it('uses controlled fields and disables draft editing during a pending operation', () => {
    const nodes = elements(renderModal({ ...base(), busy: true }))
    const fields = nodes.filter((n) => n.type === 'field')
    expect(fields.map((n) => n.key)).toEqual(['url', 'cell', 'rows', 'columns'])
    expect(fields.every((n) => n.disabled && n.onChange.command === 'formatting.field')).toBe(true)
    expect(nodes.filter((n) => n.tag === 'button').every((n) => n.disabled)).toBe(true)
  })
  it('keeps error feedback near the final refresh control', () => {
    const output = renderModal({ ...base(), error: '选区已经改变' }) as any
    const children = output.children
    expect(children[children.length - 2].attributes.role).toBe('alert')
    expect(children[children.length - 1].text).toBe('重新读取选区')
  })
  it('keeps toolbar feedback compact and preserves full details in the modal', () => {
    const state = {
      ...base(),
      snapshot: tableSnapshot(),
      error: '选区已经改变，请重新读取选区后再次提交。',
    }
    const toolbar = elements(renderToolbar(state))
    expect(toolbar.find((node) => node.attributes?.role === 'alert')?.text).toBe(
      '操作未完成，请打开“格式”查看详情。',
    )
    expect(
      elements(renderModal(state)).find((node) => node.attributes?.role === 'alert')?.text,
    ).toBe(state.error)
  })
  it('refreshes the toolbar after closing a modal without changing document selection', async () => {
    const editing = {
      capture: vi.fn().mockResolvedValue(tableSnapshot()),
      release: vi.fn().mockResolvedValue(undefined),
    }
    const context = {
      host: { editing, ui: { requestUpdate: vi.fn().mockResolvedValue(undefined) } },
      node: { documentId: 'd', documentVersion: 1, selectionRevision: 1 },
    } as any
    plugin.activate(context)
    try {
      const toolbar = () => elements(plugin.renderers['formatting-toolbar'](context))
      const modal = () => elements(plugin.renderers['formatting-modal'](context))
      toolbar()
      await vi.waitFor(() => expect(toolbar().find((n) => n.text === '粗体')?.disabled).toBe(false))
      modal()
      await vi.waitFor(() => expect(modal().find((n) => n.text === '粗体')?.disabled).toBe(false))
      const before = editing.capture.mock.calls.length
      plugin.renderers['formatting-modal']({
        ...context,
        node: { ...context.node, phase: 'dispose' },
      })
      toolbar()
      expect(editing.capture).toHaveBeenCalledTimes(before + 1)
      await vi.waitFor(() => expect(toolbar().find((n) => n.text === '粗体')?.disabled).toBe(false))
    } finally {
      plugin.deactivate()
    }
  })
})

const tableSnapshot = (id = 'table', documentId = 'd', selectionRevision = 1) => ({
  ...base().snapshot!,
  id,
  documentId,
  selectionRevision,
  lineCount: 4,
  context: { kind: 'table', complete: true },
  table: {
    row: 0,
    column: 0,
    rowCount: 1,
    columnCount: 2,
    alignment: 'default' as const,
    withinCell: true,
  },
})
function lifecycle() {
  const editing = {
    capture: vi.fn().mockResolvedValue(tableSnapshot()),
    release: vi.fn().mockResolvedValue(undefined),
    table: vi.fn().mockResolvedValue({ documentId: 'd', version: 2 }),
    apply: vi.fn().mockResolvedValue({ documentId: 'd', version: 2 }),
  }
  const context = {
    host: { editing, ui: { requestUpdate: vi.fn().mockResolvedValue(undefined) } },
    node: { documentId: 'd', documentVersion: 1, selectionRevision: 1 },
  } as any
  const activation = plugin.activate(context)
  const toolbar = (node = context.node) => plugin.renderers['formatting-toolbar']({ node })
  return { editing, context, toolbar, activation }
}
describe('contextual table toolbar lifecycle', () => {
  it('keeps the current table snapshot across alternating layout-only viewports', async () => {
    const { editing, toolbar, context } = lifecycle()
    const node = {
      ...context.node,
      viewMode: 'live',
      documentEditable: true,
      saveLocationGeneration: 0,
      viewport: { fromLine: 1, toLine: 35, activeLine: 27 },
    }
    try {
      toolbar(node)
      await vi.waitFor(() =>
        expect(elements(toolbar(node)).find((n) => n.text === '下方加行')?.disabled).toBe(false),
      )
      const settled = toolbar(node)
      const captures = editing.capture.mock.calls.length
      // Showing the toolbar reduces the editor height; hiding it expands the
      // viewport again. Neither layout changes the document or its selection.
      for (const toLine of [33, 35, 33, 35, 33, 35]) {
        expect(toolbar({ ...node, viewport: { ...node.viewport, toLine } })).toEqual(settled)
        await Promise.resolve()
      }
      expect(editing.capture).toHaveBeenCalledTimes(captures)
      expect(editing.release).not.toHaveBeenCalled()
    } finally {
      plugin.deactivate()
    }
  })
  it('does not restart a pending table capture when only the viewport changes', async () => {
    const { editing, toolbar, context } = lifecycle()
    let complete!: (value: any) => void
    editing.capture.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve
        }),
    )
    try {
      const node = { ...context.node, viewport: { fromLine: 1, toLine: 35, activeLine: 27 } }
      expect(toolbar(node)).toBe('')
      const signal = editing.capture.mock.calls[0]![1].signal as AbortSignal
      const resized = { ...node, viewport: { ...node.viewport, toLine: 33 } }
      expect(toolbar(resized)).toBe('')
      expect(editing.capture).toHaveBeenCalledTimes(1)
      expect(signal.aborted).toBe(false)
      complete(tableSnapshot())
      await vi.waitFor(() =>
        expect(elements(toolbar(resized)).find((n) => n.text === '下方加行')?.disabled).toBe(false),
      )
    } finally {
      plugin.deactivate()
    }
  })
  it('invalidates a table snapshot when its save location changes and rejects late reads', async () => {
    const { editing, toolbar, context } = lifecycle()
    try {
      const initial = { ...context.node, saveLocationGeneration: 0 }
      toolbar(initial)
      await vi.waitFor(() =>
        expect(elements(toolbar(initial)).find((n) => n.text === '下方加行')?.disabled).toBe(false),
      )
      const previousAction = elements(toolbar(initial)).find((n) => n.text === '下方加行').action
      let late!: (value: any) => void
      editing.capture.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            late = resolve
          }),
      )
      expect(toolbar({ ...initial, saveLocationGeneration: 1 })).toBe('')
      editing.capture.mockResolvedValue({
        ...tableSnapshot('relocated'),
        saveLocationGeneration: 2,
      })
      const relocated = { ...initial, saveLocationGeneration: 2 }
      expect(toolbar(relocated)).toBe('')
      await vi.waitFor(() =>
        expect(elements(toolbar(relocated)).find((n) => n.text === '下方加行')?.disabled).toBe(
          false,
        ),
      )
      late({ ...tableSnapshot('late-location'), saveLocationGeneration: 1 })
      await vi.waitFor(() => expect(editing.release).toHaveBeenCalledWith('late-location'))
      expect(elements(toolbar(relocated)).find((n) => n.text === '下方加行')?.disabled).toBe(false)
      await plugin.commands[previousAction.command]({}, previousAction.input)
      expect(editing.table).not.toHaveBeenCalled()
      expect(editing.capture).toHaveBeenCalledTimes(3)
    } finally {
      plugin.deactivate()
    }
  })
  it('renders no toolbar outside a table or before a capture completes', () => {
    expect(renderToolbar(base())).toBe('')
    const { toolbar } = lifecycle()
    try {
      expect(toolbar()).toBe('')
    } finally {
      plugin.deactivate()
    }
  })
  it('hides immediately on selection change and replaces an obsolete pending read', async () => {
    const { editing, toolbar, context } = lifecycle()
    try {
      toolbar()
      await vi.waitFor(() =>
        expect(elements(toolbar()).some((n) => n.text === '下方加行')).toBe(true),
      )
      let late!: (value: any) => void
      editing.capture.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            late = resolve
          }),
      )
      const leaving = { ...context.node, selectionRevision: 2 }
      expect(toolbar(leaving)).toBe('')
      editing.capture.mockResolvedValue({
        ...base().snapshot!,
        id: 'outside',
        selectionRevision: 3,
      })
      const outside = { ...context.node, selectionRevision: 3 }
      expect(toolbar(outside)).toBe('')
      await vi.waitFor(() => expect(editing.capture).toHaveBeenCalledTimes(3))
      late(tableSnapshot('late', 'd', 2))
      await vi.waitFor(() => expect(editing.release).toHaveBeenCalledWith('late'))
      expect(toolbar(outside)).toBe('')
    } finally {
      plugin.deactivate()
    }
  })
  it('rejects a toolbar click from the previous document even before the next renderer update', async () => {
    const { editing, toolbar } = lifecycle()
    try {
      toolbar()
      await vi.waitFor(() =>
        expect(elements(toolbar()).some((n) => n.text === '下方加行')).toBe(true),
      )
      const action = elements(toolbar()).find((n) => n.text === '下方加行').action
      editing.capture.mockResolvedValue(tableSnapshot('other', 'other'))
      editing.table.mockRejectedValue(Object.assign(new Error('stale'), { code: 'stale_snapshot' }))
      await plugin.commands[action.command]({}, action.input)
      expect(editing.table).toHaveBeenCalledWith(
        { snapshotId: 'table', operation: 'add-row' },
        expect.any(Object),
      )
      expect(editing.capture).toHaveBeenCalledTimes(1)
    } finally {
      plugin.deactivate()
    }
  })
  it('clears immediately on disable and ignores a late capture', async () => {
    const { editing, toolbar } = lifecycle()
    let complete!: (value: any) => void
    editing.capture.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve
        }),
    )
    toolbar()
    plugin.deactivate()
    expect(toolbar()).toBe('')
    complete(tableSnapshot('late'))
    await vi.waitFor(() => expect(editing.release).toHaveBeenCalledWith('late'))
    expect(toolbar()).toBe('')
  })
  it('ignores old-document reads, disposal and clicks after switching documents', async () => {
    const { editing, toolbar, context } = lifecycle()
    try {
      toolbar()
      await vi.waitFor(() =>
        expect(elements(toolbar()).some((n) => n.text === '下方加行')).toBe(true),
      )
      const action = elements(toolbar()).find((n) => n.text === '下方加行').action
      let late!: (value: any) => void
      editing.capture.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            late = resolve
          }),
      )
      toolbar({ ...context.node, selectionRevision: 2 })
      const next = { ...context.node, documentId: 'other' }
      editing.capture.mockResolvedValue(tableSnapshot('other-table', 'other'))
      expect(toolbar(next)).toBe('')
      await vi.waitFor(() =>
        expect(elements(toolbar(next)).some((n) => n.text === '下方加行')).toBe(true),
      )
      expect(toolbar({ documentId: 'd', phase: 'dispose' })).toBe('')
      late(tableSnapshot('late', 'd', 2))
      await vi.waitFor(() => expect(editing.release).toHaveBeenCalledWith('late'))
      expect(elements(toolbar(next)).some((n) => n.text === '下方加行')).toBe(true)
      await plugin.commands[action.command]({}, action.input)
      expect(editing.table).not.toHaveBeenCalled()
      expect(editing.capture).toHaveBeenCalledTimes(3)
    } finally {
      plugin.deactivate()
    }
  })
  it('does not accept a capture for a different document than the rendered context', async () => {
    const { editing, toolbar } = lifecycle()
    try {
      editing.capture.mockResolvedValue(tableSnapshot('wrong', 'other'))
      expect(toolbar()).toBe('')
      await vi.waitFor(() => expect(editing.release).toHaveBeenCalledWith('wrong'))
      expect(toolbar()).toBe('')
    } finally {
      plugin.deactivate()
    }
  })
  it('hides a loaded toolbar on disable and preserves a new activation from old disposal', async () => {
    const previous = lifecycle()
    previous.toolbar()
    await vi.waitFor(() =>
      expect(elements(previous.toolbar()).some((n) => n.text === '下方加行')).toBe(true),
    )
    plugin.deactivate()
    expect(previous.toolbar()).toBe('')
    const current = lifecycle()
    try {
      current.toolbar()
      await vi.waitFor(() =>
        expect(elements(current.toolbar()).some((n) => n.text === '下方加行')).toBe(true),
      )
      previous.activation.dispose()
      expect(elements(current.toolbar()).some((n) => n.text === '下方加行')).toBe(true)
      expect(current.toolbar({ ...current.context.node, documentEditable: false })).toBe('')
    } finally {
      plugin.deactivate()
    }
  })
})

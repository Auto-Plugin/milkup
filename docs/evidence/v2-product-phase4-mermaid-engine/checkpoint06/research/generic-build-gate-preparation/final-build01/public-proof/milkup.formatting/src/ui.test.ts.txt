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
    const state = { ...base(), error: '选区已经改变，请重新读取选区后再次提交。' }
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
      capture: vi.fn().mockResolvedValue(base().snapshot),
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

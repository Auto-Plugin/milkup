import { describe, expect, it, vi } from 'vitest'
import type { SdkEditingSnapshot, SdkPluginEditingHost } from '@milkup/plugin-sdk'
import { createController } from './controller'

const snapshot = (id = 's1'): SdkEditingSnapshot => ({
  id,
  documentId: 'doc',
  version: 1,
  selectionRevision: 2,
  saveLocationGeneration: 0,
  from: 0,
  to: 4,
  text: 'word',
  selection: { anchor: 0, head: 4 },
  startLine: 1,
  lineCount: 1,
  lineEnding: 'lf',
  mode: 'memory',
  context: { kind: 'text', complete: true },
  syntax: { nodes: [] },
})
function setup() {
  const host = {
    capture: vi.fn().mockResolvedValue(snapshot()),
    apply: vi.fn().mockResolvedValue({ documentId: 'doc', version: 2 }),
    table: vi.fn().mockResolvedValue({ documentId: 'doc', version: 2 }),
    release: vi.fn().mockResolvedValue(undefined),
  }
  const changed = vi.fn()
  return { host, changed, controller: createController(host as SdkPluginEditingHost, changed) }
}
describe('public editing controller', () => {
  it('uses bounded capture and one atomic public apply with preserved selection', async () => {
    const { host, controller } = setup()
    await controller.execute('bold')
    expect(host.capture).toHaveBeenCalledWith({ extent: 'lines' }, expect.any(Object))
    expect(host.apply).toHaveBeenCalledWith(
      {
        snapshotId: 's1',
        changes: [{ from: 0, to: 4, insert: '**word**' }],
        selection: { anchor: 2, head: 6 },
      },
      expect.any(Object),
    )
    expect(controller.state.message).toContain('已应用')
    expect(host.release).toHaveBeenCalledWith('s1')
  })
  it('preserves a form snapshot and exposes stale rejection without retrying another target', async () => {
    const { host, controller } = setup()
    await controller.load()
    controller.field({ field: 'url', value: './next.md' })
    host.apply.mockRejectedValue(Object.assign(new Error('stale'), { code: 'stale_snapshot' }))
    await controller.execute('link', true)
    expect(host.capture).toHaveBeenCalledTimes(1)
    expect(host.apply).toHaveBeenCalledTimes(1)
    expect(controller.state.error).toContain('文档或选区已改变')
    expect(controller.state.message).toBeUndefined()
    expect(controller.state.fields.url).toBe('./next.md')
  })
  it('uses the same public apply for a windowed document', async () => {
    const { host, controller } = setup()
    host.capture.mockResolvedValue({ ...snapshot(), from: 900, to: 904, mode: 'windowed' })
    await controller.execute('italic')
    expect(host.apply).toHaveBeenCalledTimes(1)
    expect(host.apply.mock.calls[0]![0].changes).toEqual([{ from: 0, to: 4, insert: '*word*' }])
  })
  it('does not write when syntax cannot be proven', async () => {
    const { host, controller } = setup()
    host.capture.mockResolvedValue({ ...snapshot(), context: undefined })
    await controller.execute('bold')
    expect(host.apply).not.toHaveBeenCalled()
    expect(controller.state.error).toContain('完整语法上下文')
  })
  it('cancels pending work and does not publish success or recapture after disposal', async () => {
    const { host, controller, changed } = setup()
    let complete!: () => void
    host.apply.mockReturnValue(
      new Promise<void>((resolve) => {
        complete = resolve
      }),
    )
    const running = controller.execute('bold')
    await vi.waitFor(() => expect(host.apply).toHaveBeenCalledTimes(1))
    controller.dispose()
    const updates = changed.mock.calls.length
    complete()
    await running
    expect(host.capture).toHaveBeenCalledTimes(1)
    expect(changed).toHaveBeenCalledTimes(updates)
    expect(host.apply.mock.calls[0]![1].signal.aborted).toBe(true)
  })
  it('preserves successful write status if the follow-up capture fails', async () => {
    const { host, controller } = setup()
    host.capture.mockResolvedValueOnce(snapshot()).mockRejectedValueOnce(new Error('read failed'))
    await controller.execute('bold')
    expect(controller.state.message).toContain('已应用格式')
    expect(controller.state.error).toContain('格式已应用，但无法重新读取')
  })
  it('validates table dimensions before passing the snapshot to a real primitive', async () => {
    const { host, controller } = setup()
    await controller.load()
    controller.field({ field: 'rows', value: '0' })
    await controller.table('insert-table', true)
    expect(host.table).not.toHaveBeenCalled()
    controller.field({ field: 'rows', value: '4' })
    await controller.table('insert-table', true)
    expect(host.table).toHaveBeenCalledWith(
      { snapshotId: 's1', operation: 'insert-table', rows: 4, columns: 3 },
      expect.any(Object),
    )
  })
  it('forwards bounded alignment and cell operations, rejects unknown ones', async () => {
    const { host, controller } = setup()
    await controller.table('align-center')
    expect(host.table).toHaveBeenCalledWith(
      { snapshotId: 's1', operation: 'align-column', alignment: 'center' },
      expect.any(Object),
    )
    await controller.table('clear-cell')
    expect(host.table).toHaveBeenCalledWith(
      { snapshotId: 's1', operation: 'clear-cell' },
      expect.any(Object),
    )
    await controller.table('invented-operation')
    expect(host.table).toHaveBeenCalledTimes(2)
  })
  it('forwards literal cell content and exit through the public table primitive', async () => {
    const { host, controller } = setup()
    await controller.load()
    controller.field({ field: 'cell', value: '中文|value' })
    await controller.table('set-cell', true)
    expect(host.table).toHaveBeenCalledWith(
      { snapshotId: 's1', operation: 'set-cell', text: '中文|value' },
      expect.any(Object),
    )
    await controller.table('exit')
    expect(host.table).toHaveBeenCalledWith(
      { snapshotId: 's1', operation: 'exit' },
      expect.any(Object),
    )
  })
  it('does not submit after a capture ignores cancellation and resolves late', async () => {
    const { host, controller } = setup()
    let complete!: (snapshot: SdkEditingSnapshot) => void
    host.capture.mockReturnValue(
      new Promise<SdkEditingSnapshot>((resolve) => {
        complete = resolve
      }),
    )
    const running = controller.execute('bold')
    controller.cancel()
    complete(snapshot())
    await running
    expect(host.apply).not.toHaveBeenCalled()
    expect(host.release).toHaveBeenCalledWith('s1')
  })
  it('expands a partial table snapshot by its measured rows before applying', async () => {
    const { host, controller } = setup()
    const partial = {
      ...snapshot('small'),
      text: '| x | y |',
      to: 9,
      selection: { anchor: 2, head: 2 },
      context: { kind: 'table', complete: false },
      table: {
        row: 1,
        column: 0,
        rowCount: 3,
        columnCount: 2,
        alignment: 'default',
        withinCell: true,
      },
    }
    const full = { ...partial, id: 'full', context: { kind: 'table', complete: true } }
    host.capture
      .mockResolvedValueOnce(partial)
      .mockResolvedValueOnce(full)
      .mockResolvedValue(snapshot('after'))
    await controller.table('add-column')
    expect(host.capture.mock.calls[1]![0]).toEqual({
      extent: 'lines',
      beforeLines: 2,
      afterLines: 3,
    })
    expect(host.table).toHaveBeenCalledWith(
      { snapshotId: 'full', operation: 'add-column' },
      expect.any(Object),
    )
    expect(host.release).toHaveBeenCalledWith('small')
  })
  it('does not silently retarget when selection changes while expanding the table', async () => {
    const { host, controller } = setup()
    const partial = {
      ...snapshot('small'),
      context: { kind: 'table', complete: false },
      table: {
        row: 0,
        column: 0,
        rowCount: 3,
        columnCount: 2,
        alignment: 'default',
        withinCell: true,
      },
    }
    host.capture.mockResolvedValueOnce(partial).mockResolvedValueOnce({
      ...partial,
      id: 'changed',
      selectionRevision: 99,
      context: { kind: 'table', complete: true },
    })
    await controller.table('add-column')
    expect(host.table).not.toHaveBeenCalled()
    expect(controller.state.error).toContain('文档或选区已改变')
    expect(host.release).toHaveBeenCalledWith('changed')
  })
  it('does not drop a user command when a background selection refresh is still pending', async () => {
    const { host, controller } = setup()
    let complete!: (snapshot: SdkEditingSnapshot) => void
    host.capture
      .mockImplementationOnce(
        () =>
          new Promise<SdkEditingSnapshot>((resolve) => {
            complete = resolve
          }),
      )
      .mockResolvedValue(snapshot('current'))
    const refresh = controller.load()
    await controller.execute('bold')
    expect(host.apply).toHaveBeenCalledTimes(1)
    complete(snapshot('old'))
    await refresh
    expect(controller.state.snapshot?.id).toBe('current')
    expect(controller.state.message).toContain('已应用')
  })
})

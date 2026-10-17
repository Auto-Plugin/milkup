import { afterEach, expect, it, vi } from 'vitest'
import {
  DocumentPresentation,
  type DocumentPresentationConfig,
  type DocumentPresentationResponse,
  type DocumentPresentationWindow,
  type PresentationSnapshot,
} from '../document-presentation'

const cleanup: Array<() => void> = []
afterEach(() => {
  for (const dispose of cleanup.splice(0)) dispose()
  vi.useRealTimers()
  document.body.replaceChildren()
})

async function settle() {
  for (let i = 0; i < 20; i++) await Promise.resolve()
}

async function fixture() {
  const source = Array<string>(20).fill('x').join('\n')
  const root = document.createElement('div')
  const content = document.createElement('div')
  root.append(content)
  document.body.append(root)
  root.getBoundingClientRect = () => new DOMRect(0, 0, 800, 240)
  // Stand in for a virtual view's spacer measurement. Its correction is only
  // published by layout, so checking the final anchor tests measurement order.
  let measuredPrefix = 30
  const rows = Array.from({ length: 20 }, (_, index) => {
    const row = document.createElement('div')
    row.className = 'milkup-line'
    Object.assign(row.dataset, {
      line: String(index + 1),
      from: String(index * 2),
      to: String(index * 2 + 1),
    })
    row.textContent = 'x'
    return row
  })
  const height = (row: HTMLElement) =>
    row.dataset.presentationCollapsed === 'true' ? 0 : row.querySelector('math') ? 80 : 21
  rows.forEach((row, index) => {
    row.getBoundingClientRect = () =>
      new DOMRect(
        0,
        measuredPrefix +
          rows.slice(0, index).reduce((sum, item) => sum + height(item), 0) -
          root.scrollTop,
        800,
        height(row),
      )
  })
  content.append(...rows)
  const snapshot: PresentationSnapshot = {
    mode: 'live',
    sourceIdentity: {},
    sourceVersion: 0,
    documentVersion: 0,
    selection: { anchor: 10, head: 10 },
    lineCount: rows.length,
    read: (from, to) => source.slice(from, to),
  }
  let next: 'pending' | 'result' | 'reject' = 'pending'
  let calls = 0
  let onLayout = () => {}
  const observations: Array<{ preview: boolean; collapsed: number; notice: boolean }> = []
  const layout = vi.fn(() => {
    const preview = !!content.querySelector('math')
    observations.push({
      preview,
      collapsed: content.querySelectorAll('[data-presentation-collapsed="true"]').length,
      notice: !!root.querySelector('[data-document-presentation-notice]'),
    })
    measuredPrefix = preview ? 0 : 30
    onLayout()
  })
  function response(window: DocumentPresentationWindow): DocumentPresentationResponse {
    return {
      declarations: [{ id: 'restore-fixture', contexts: ['text'] }],
      request: {
        documentId: 'restore-fixture',
        version: 0,
        from: window.from,
        to: window.to,
        source: window.source,
        fromLine: window.fromLine,
        toLine: window.toLine,
        completeStart: window.completeStart,
        completeEnd: window.completeEnd,
        selection: window.selection,
        width: window.width,
        contextKnown: true,
        protectedRanges: [],
        blocks: [],
        theme: 'light',
        target: 'screen',
      },
      result: {
        complete: true,
        fragments: [
          {
            from: 0,
            to: 5,
            layout: 'block',
            accessibleText: 'three source rows',
            content: {
              type: 'math',
              tree: { tag: 'math', children: [{ tag: 'mi', text: String(calls) }] },
            },
          },
        ],
      },
    }
  }
  const config: DocumentPresentationConfig = {
    provide(window) {
      calls++
      if (calls === 1 || next === 'result') return response(window)
      if (next === 'reject') return Promise.reject(new Error('controlled preparation failure'))
      return new Promise<DocumentPresentationResponse>(() => {})
    },
  }
  const manager = new DocumentPresentation(
    root,
    content,
    config,
    () => ({ ...snapshot, selection: { ...snapshot.selection } }),
    layout,
    () => {},
  )
  cleanup.push(() => {
    onLayout = () => {}
    manager.destroy()
  })
  manager.schedule()
  await settle()
  expect(content.querySelector('math')).not.toBeNull()
  expect(content.querySelectorAll('[data-presentation-collapsed="true"]')).toHaveLength(2)
  layout.mockClear()
  observations.length = 0
  return {
    manager,
    root,
    content,
    rows,
    snapshot,
    layout,
    observations,
    calls: () => calls,
    setLayout(callback: () => void) {
      onLayout = callback
    },
    next(value: typeof next) {
      next = value
    },
    changeSelection() {
      Object.assign(snapshot, { selection: { anchor: 12, head: 12 } })
      manager.selectionChanged()
    },
  }
}

it('measures restored multiline source before correcting the selected anchor, without awaiting a provider', async () => {
  const f = await fixture()
  const target = f.rows[6]!
  const before = target.getBoundingClientRect().top
  f.changeSelection()
  expect(f.content.querySelector('math')).toBeNull()
  expect(f.observations).toEqual([{ preview: false, collapsed: 0, notice: false }])
  expect(target.getBoundingClientRect().top).toBe(before)
  expect(f.snapshot.selection).toEqual({ anchor: 12, head: 12 })
  await settle()
  expect(f.content.textContent).toBe('x'.repeat(20))
  expect(f.layout).toHaveBeenCalledTimes(1)
})

it('allows layout to redraw selection without recursively restoring or measuring', async () => {
  const f = await fixture()
  f.setLayout(() => f.manager.selectionChanged())
  f.changeSelection()
  expect(f.layout).toHaveBeenCalledTimes(1)
  expect(f.observations[0]).toEqual({ preview: false, collapsed: 0, notice: false })
  await settle()
  expect(f.layout).toHaveBeenCalledTimes(1)
})

for (const change of [
  'source',
  'source-version',
  'document-version',
  'selection',
  'mode',
  'config',
  'epoch',
  'destroy',
] as const) {
  it(`does not restore the old anchor when ${change} changes inside restoration layout`, async () => {
    const f = await fixture()
    let changed = false
    f.setLayout(() => {
      if (changed) return
      changed = true
      if (change === 'source') Object.assign(f.snapshot, { sourceIdentity: {} })
      if (change === 'source-version') Object.assign(f.snapshot, { sourceVersion: 1 })
      if (change === 'document-version') Object.assign(f.snapshot, { documentVersion: 1 })
      if (change === 'selection') Object.assign(f.snapshot, { selection: { anchor: 0, head: 0 } })
      if (change === 'mode') Object.assign(f.snapshot, { mode: 'source' })
      if (change === 'config') f.manager.setConfig(undefined)
      if (change === 'epoch') f.manager.refresh()
      if (change === 'destroy') f.manager.destroy()
      f.root.scrollTop = 300
    })
    f.changeSelection()
    expect(changed).toBe(true)
    expect(f.root.scrollTop).toBe(300)
  })
}

it('measures only the final replacement paint, not its temporary literal source', async () => {
  const f = await fixture()
  f.next('result')
  f.manager.refresh()
  await settle()
  expect(f.content.querySelector('math')?.textContent).toBe('2')
  expect(f.observations).toEqual([{ preview: true, collapsed: 2, notice: false }])
})

it('does not repeatedly measure an already restored selection', async () => {
  const f = await fixture()
  f.changeSelection()
  f.layout.mockClear()
  for (let i = 0; i < 3; i++) f.manager.selectionChanged()
  expect(f.layout).not.toHaveBeenCalled()
})

it('restores source during destroy without calling the live layout callback', async () => {
  const f = await fixture()
  f.manager.destroy()
  expect(f.content.querySelector('math')).toBeNull()
  expect(f.content.querySelector('[data-presentation-collapsed]')).toBeNull()
  expect(f.layout).not.toHaveBeenCalled()
  await settle()
  expect(f.layout).not.toHaveBeenCalled()
})

it('continues observing DOM changes after restoration layout changes mode, but stops after destroy', async () => {
  const f = await fixture()
  let changed = false
  f.setLayout(() => {
    if (changed) return
    changed = true
    Object.assign(f.snapshot, { mode: 'source' })
  })
  f.changeSelection()
  await settle()
  expect(changed).toBe(true)
  expect(f.content.querySelector('math')).toBeNull()
  const before = f.calls()
  // The view supplies a current snapshot. A normal replacement of mapped source
  // DOM must still wake the manager even though the previous anchor was retired.
  Object.assign(f.snapshot, { mode: 'live' })
  f.next('result')
  f.rows[0]!.textContent = 'x'
  await settle()
  expect(f.calls()).toBeGreaterThan(before)
  expect(f.content.querySelector('math')).not.toBeNull()

  f.manager.destroy()
  const afterDestroy = f.calls()
  f.rows[0]!.textContent = 'x'
  await settle()
  expect(f.calls()).toBe(afterDestroy)
})

it('propagates a restoration layout error and releases the reentrancy guard', async () => {
  const f = await fixture()
  f.setLayout(() => {
    throw new Error('controlled layout error')
  })
  expect(() => f.changeSelection()).toThrow('controlled layout error')
  f.setLayout(() => {})
  f.next('result')
  f.manager.invalidate()
  await settle()
  expect(f.content.querySelector('math')).not.toBeNull()
})

it('measures invalidate once for restored content and still measures a later no-op invalidate', async () => {
  const f = await fixture()
  f.manager.invalidate()
  expect(f.observations).toEqual([{ preview: false, collapsed: 0, notice: false }])
  f.layout.mockClear()
  f.manager.invalidate()
  expect(f.layout).toHaveBeenCalledTimes(1)
})

for (const reason of ['rejection', 'preparation timeout'] as const) {
  it(`measures restored source once before inserting the ${reason} notice`, async () => {
    const f = await fixture()
    if (reason === 'preparation timeout') vi.useFakeTimers()
    else f.next('reject')
    f.manager.refresh()
    await settle()
    expect(f.content.querySelector('math') !== null).toBe(reason === 'preparation timeout')
    if (reason === 'preparation timeout') await vi.advanceTimersByTimeAsync(10_001)
    expect(f.content.querySelector('math')).toBeNull()
    expect(f.root.querySelector('[data-document-presentation-notice]')).not.toBeNull()
    expect(f.observations).toEqual([
      { preview: false, collapsed: 0, notice: false },
      { preview: false, collapsed: 0, notice: true },
    ])
  })
}

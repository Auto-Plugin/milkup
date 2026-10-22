import { MemoryDocumentSource } from '@milkup/core'
import { afterEach, expect, it, vi } from 'vitest'
import { SourceDocumentView } from '../source-document-view'
import {
  DocumentPresentation,
  type PresentationSnapshot,
  type DocumentPresentationConfig,
} from '../document-presentation'

const managers: DocumentPresentation[] = []
afterEach(() => {
  for (const manager of managers.splice(0)) manager.destroy()
  document.body.replaceChildren()
})
const settle = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve()
}
function fixture(away = false) {
  const root = document.createElement('div'),
    content = document.createElement('div')
  root.append(content)
  document.body.append(root)
  root.scrollTop = 50
  root.getBoundingClientRect = () => new DOMRect(0, 0, 800, 100)
  let extra = 0
  const lines = () =>
    Array.from({ length: 20 }, (_, index) => {
      const line = document.createElement('div')
      line.className = 'milkup-line'
      Object.assign(line.dataset, {
        line: String(index + 1),
        from: String(index * 2),
        to: String(index * 2 + 1),
      })
      line.textContent = 'x'
      line.getBoundingClientRect = () =>
        new DOMRect(
          0,
          index * 21 +
            (index > 0 ? extra : 0) +
            (root.querySelector('[data-document-presentation-notice]') ? 30 : 0) -
            root.scrollTop,
          800,
          21 + (index === 0 ? extra : 0),
        )
      return line
    })
  content.replaceChildren(...lines())
  const snapshot: PresentationSnapshot = {
    mode: 'live',
    sourceIdentity: {},
    sourceVersion: 1,
    documentVersion: 1,
    selection: { anchor: away ? 0 : 6, head: away ? 0 : 6 },
    lineCount: 20,
    read: (from, to) => 'x\n'.repeat(20).slice(from, to),
  }
  let onLayout = () => {}
  const layout = vi.fn(() => onLayout())
  const manager = new DocumentPresentation(
    root,
    content,
    { provide: () => Promise.reject(Error('preparation failed')) },
    () => ({ ...snapshot, selection: { ...snapshot.selection } }),
    layout,
    () => {},
  )
  managers.push(manager)
  return {
    manager,
    root,
    content,
    snapshot,
    layout,
    lines,
    grow: () => {
      extra = 80
    },
    setLayout: (callback: () => void) => {
      onLayout = callback
    },
  }
}
it('keeps an initial fallback notice visible when the document is at the top', async () => {
  const f = fixture()
  f.root.scrollTop = 0
  const before = { ...f.snapshot.selection }
  f.manager.schedule()
  await settle()
  expect(f.root.querySelector('[data-document-presentation-notice]')).not.toBeNull()
  expect(f.root.scrollTop).toBe(0)
  expect(f.content.children[0]!.getBoundingClientRect().top).toBe(30)
  expect(f.snapshot.selection).toEqual(before)
})

function paintedResponse(kind: 'error' | 'incomplete' | 'complete'): DocumentPresentationConfig {
  return {
    provide: async ({
      sourceIdentity: _i,
      sourceVersion: _v,
      documentVersion: _d,
      visibleFrom: _from,
      visibleTo: _to,
      ...window
    }) => ({
      declarations: [{ id: 'fixture', contexts: ['text'] }],
      request: {
        ...window,
        documentId: 'fixture',
        version: 1,
        contextKnown: true,
        protectedRanges: [],
        blocks: [],
        theme: 'light',
        target: 'screen',
      },
      result: {
        complete: kind !== 'incomplete',
        fragments:
          kind === 'error'
            ? [
                {
                  from: 0,
                  to: 1,
                  layout: 'block',
                  accessibleText: 'x',
                  content: { type: 'text', text: 'x' },
                  status: 'error',
                  message: 'painted fragment failed',
                },
              ]
            : [],
      },
    }),
  }
}
for (const kind of ['error', 'incomplete'] as const)
  for (const initial of [0, 50])
    it(`preserves notice visibility or the existing reading position for a painted ${kind} result at ${initial}`, async () => {
      const f = fixture()
      f.root.scrollTop = initial
      const anchor = f.content.children[3]!,
        before = anchor.getBoundingClientRect().top
      f.manager.setConfig(paintedResponse(kind))
      await settle()
      const notice = f.root.querySelector('[data-document-presentation-notice]')
      expect(notice?.textContent).toBe(
        kind === 'error'
          ? 'painted fragment failed'
          : '部分内容暂未生成预览，已保留对应 Markdown 源码。',
      )
      if (initial === 0) {
        expect(f.root.scrollTop).toBe(0)
        expect(f.content.children[0]!.getBoundingClientRect().top).toBe(30)
      } else expect(anchor.getBoundingClientRect().top).toBe(before)
    })
it('retains successful paint anchoring at the top when no fallback notice appears', async () => {
  const f = fixture()
  f.root.scrollTop = 0
  const anchor = f.content.children[3]!,
    before = anchor.getBoundingClientRect().top
  f.manager.setConfig(paintedResponse('complete'))
  f.setLayout(f.grow)
  await settle()
  expect(f.root.querySelector('[data-document-presentation-notice]')).toBeNull()
  expect(anchor.getBoundingClientRect().top).toBe(before)
  expect(f.root.scrollTop).toBe(80)
})

for (const away of [false, true]) {
  it(`anchors notice layout without pulling an offscreen selection back (${away})`, async () => {
    const f = fixture(away)
    const anchor = f.content.children[away ? 2 : 3]!
    const before = anchor.getBoundingClientRect().top
    const external = document.createElement('button')
    document.body.append(external)
    external.focus()
    f.manager.schedule()
    await settle()
    expect(f.root.querySelector('[data-document-presentation-notice]')).not.toBeNull()
    expect(anchor.getBoundingClientRect().top).toBe(before)
    expect(f.snapshot.selection.head).toBe(away ? 0 : 6)
    expect(document.activeElement).toBe(external)
  })
  it(`anchors uncached replacement after measuring the new lines (${away})`, () => {
    const f = fixture(away)
    const index = away ? 2 : 3
    const before = f.content.children[index]!.getBoundingClientRect().top
    f.setLayout(f.grow)
    expect(f.manager.updateContent(() => f.content.replaceChildren(...f.lines()))).toBe(true)
    expect(f.content.children[index]!.getBoundingClientRect().top).toBe(before)
    expect(f.layout).toHaveBeenCalledTimes(1)
    expect(f.snapshot.selection.head).toBe(away ? 0 : 6)
  })
}
const changes = [
  'source',
  'version',
  'document-version',
  'selection',
  'mode',
  'config',
  'epoch',
  'destroy',
] as const
for (const phase of ['notice', 'replacement'] as const)
  for (const change of changes)
    it(`does not restore an old ${phase} anchor after ${change} changes during layout`, async () => {
      const f = fixture()
      let changed = false
      f.setLayout(() => {
        if (
          changed ||
          (phase === 'notice' && !f.root.querySelector('[data-document-presentation-notice]'))
        )
          return
        changed = true
        if (change === 'source') Object.assign(f.snapshot, { sourceIdentity: {} })
        if (change === 'version') Object.assign(f.snapshot, { sourceVersion: 2 })
        if (change === 'document-version') Object.assign(f.snapshot, { documentVersion: 2 })
        if (change === 'selection') Object.assign(f.snapshot, { selection: { anchor: 0, head: 0 } })
        if (change === 'mode') Object.assign(f.snapshot, { mode: 'source' })
        if (change === 'config') f.manager.setConfig(undefined)
        if (change === 'epoch') f.manager.refresh()
        if (change === 'destroy') f.manager.destroy()
        f.root.scrollTop = 300
      })
      if (phase === 'notice') {
        f.manager.schedule()
        await settle()
      } else f.manager.updateContent(() => f.content.replaceChildren(...f.lines()))
      expect(changed).toBe(true)
      expect(f.root.scrollTop).toBe(300)
    })
it('does not scroll when the old anchor line is absent from an uncached replacement', () => {
  const f = fixture()
  f.manager.updateContent(() => f.content.replaceChildren(...f.lines().slice(10)))
  expect(f.root.scrollTop).toBe(50)
})
it('leaves measurement to the view when presentation is disabled or in source mode', () => {
  for (const mode of ['disabled', 'source']) {
    const f = fixture()
    if (mode === 'disabled') f.manager.setConfig(undefined)
    else Object.assign(f.snapshot, { mode: 'source' })
    f.layout.mockClear()
    expect(f.manager.updateContent(() => f.content.replaceChildren(...f.lines()))).toBe(false)
    expect(f.layout).not.toHaveBeenCalled()
  }
})
it('reports no measurement when a cached paint is already current', async () => {
  const f = fixture()
  f.manager.setConfig({
    provide: async ({
      sourceIdentity: _i,
      sourceVersion: _v,
      documentVersion: _d,
      visibleFrom: _visibleFrom,
      visibleTo: _visibleTo,
      ...window
    }) => ({
      declarations: [],
      request: {
        ...window,
        documentId: 'fixture',
        version: 1,
        contextKnown: true,
        protectedRanges: [],
        blocks: [],
        theme: 'light',
        target: 'screen',
      },
      result: { fragments: [], complete: true },
    }),
  })
  await settle()
  f.layout.mockClear()
  expect(f.manager.updateContent(() => {})).toBe(false)
  expect(f.layout).not.toHaveBeenCalled()
})

it('the source view still measures when presentation reports an already-current paint', async () => {
  const view = new SourceDocumentView({
    parent: document.body,
    source: new MemoryDocumentSource({ documentId: 'measurement', text: 'first\nsecond' }),
  })
  await view.renderVisibleWindow()
  const internals = view as unknown as { measureTableRows: () => void }
  const measure = vi.spyOn(internals, 'measureTableRows')
  const update = vi
    .spyOn(DocumentPresentation.prototype, 'updateContent')
    .mockImplementation((replace) => {
      replace()
      return false
    })
  try {
    await view.renderVisibleWindow()
    expect(update).toHaveBeenCalledTimes(1)
    expect(measure).toHaveBeenCalledTimes(1)
    expect(view.contentDOM.querySelectorAll('.milkup-line')).toHaveLength(2)
  } finally {
    update.mockRestore()
    measure.mockRestore()
    view.destroy()
  }
})

import {
  ChangeSet,
  EditorState,
  MemoryDocumentSource,
  MemoryTextDocument,
  Selection,
} from '@milkup/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EditorView, buildLineProjection, sourcePositionToVisualOffset } from '../editor-view'
import { sourcePositionFromPoint } from '../source-position-mapping'
import { SourceDocumentView, type SourceDocumentEdit } from '../source-document-view'

const views: Array<EditorView | SourceDocumentView> = []
afterEach(() => {
  views.splice(0).forEach((view) => view.destroy())
  vi.restoreAllMocks()
})

async function setup(
  kind: 'ordinary' | 'windowed',
  text: string,
  selection = Selection.cursor(text.length),
) {
  let state = new EditorState({ doc: new MemoryTextDocument(text), selection })
  const edits: SourceDocumentEdit[] = []
  const source = () =>
    new MemoryDocumentSource({ documentId: 'controls', document: state.doc, version: edits.length })
  const view =
    kind === 'ordinary'
      ? new EditorView({ parent: document.body, mode: 'live', state })
      : new SourceDocumentView({
          parent: document.body,
          source: source(),
          mode: 'live',
          editable: true,
          backgroundMarkdownWarmup: false,
          onEdit(edit) {
            edits.push(edit)
            state = state.applyTransaction({
              changes: ChangeSet.replace(edit.from, edit.to, edit.insert),
              ...(edit.selectionAfter ? { selection: edit.selectionAfter } : {}),
              ...(edit.historyGroup ? { historyGroup: edit.historyGroup } : {}),
            })
            ;(view as SourceDocumentView).updateSource(source())
          },
          virtualViewport: { enabled: true, viewportHeight: 120, overscanLines: 6 },
        })
  views.push(view)
  if (view instanceof SourceDocumentView)
    await view.revealSelection(state.doc.lineAt(selection.main.head).number, selection)
  const flush = async () => {
    if (view instanceof SourceDocumentView) {
      await view.flushPendingEdits()
      await view.renderVisibleWindow()
    }
  }
  const current = () => (view instanceof EditorView ? view.state : state)
  return { view, edits, flush, current }
}

for (const kind of ['ordinary', 'windowed'] as const)
  describe(`${kind} live controls`, () => {
    it('applies left, center and right alignment to header and body cells', async () => {
      const { view } = await setup(kind, '| A | B | C |\n| :--- | :---: | ---: |\n| a | b | c |')
      expect(
        Array.from(
          view.contentDOM.querySelectorAll<HTMLElement>('.milkup-table-cell'),
          (cell) => cell.style.textAlign,
        ),
      ).toEqual(['left', 'center', 'right', 'left', 'center', 'right'])
    })

    it('replaces the task bullet with one accessible checkbox, retaining normal bullets', async () => {
      const { view } = await setup(kind, '- [ ] todo\n- plain\n- [X] done')
      expect(
        view.contentDOM.querySelectorAll('.milkup-list-marker:not(.milkup-marker-hidden)'),
      ).toHaveLength(1)
      const tasks = view.contentDOM.querySelectorAll('[role="checkbox"]')
      expect(tasks).toHaveLength(2)
      expect(tasks[0]?.getAttribute('aria-checked')).toBe('false')
      expect(tasks[1]?.getAttribute('aria-checked')).toBe('true')
      expect(tasks[0]?.getAttribute('aria-label')).toBeTruthy()
    })

    it('click toggles only the source marker, preserves reversed Unicode selection, and isolates history', async () => {
      const text = '中文😀\r\n- [ ] café\r\n- plain'
      const selection = Selection.range(text.length, text.indexOf('cafe'))
      const s = await setup(kind, text, selection)
      const task = s.view.contentDOM.querySelector<HTMLElement>('.milkup-task-marker')!
      task.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
      task.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true }))
      task.click()
      await s.flush()
      expect(s.current().doc.text).toBe(text.replace('[ ]', '[x]'))
      expect(s.current().selection).toEqual(selection)
      expect(s.current().undo().doc.text).toBe(text)
      expect(s.current().undo().redo().doc.text).toBe(text.replace('[ ]', '[x]'))
      if (kind === 'windowed')
        expect(s.edits[0]).toMatchObject({
          from: text.indexOf('[ ]') + 1,
          to: text.indexOf('[ ]') + 2,
          insert: 'x',
          historyGroup: 'isolate',
          selectionBefore: selection,
          selectionAfter: selection,
        })
    })

    it('Space toggles uppercase X and read-only rejects further activation', async () => {
      const s = await setup(kind, '- [X] done')
      s.view.contentDOM
        .querySelector<HTMLElement>('.milkup-task-marker')!
        .dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }))
      await s.flush()
      expect(s.current().doc.text).toBe('- [ ] done')
      s.view.setEditable(false)
      s.view.contentDOM.querySelector<HTMLElement>('.milkup-task-marker')!.click()
      await s.flush()
      expect(s.current().doc.text).toBe('- [ ] done')
    })
  })

// jsdom has no layout; these measurements model a 200px inner code scroller
// with 8px glyphs. Browser/native fixtures separately exercise real CSS layout.
function mockCodeGeometry() {
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.classList.contains('milkup-block-code') ? 200 : 0
  })
  vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.classList.contains('milkup-block-code') ? 1600 : 0
  })
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.classList.contains('milkup-line')
      ? new DOMRect(20, 20, 200, 20)
      : new DOMRect(0, 0, 240, 120)
  })
  const rangeRect = function (this: Range) {
    const line = this.startContainer.parentElement?.closest<HTMLElement>('.milkup-line')
    return new DOMRect(
      20 + this.startOffset * 8 - (line?.scrollLeft ?? 0),
      20,
      (this.endOffset - this.startOffset) * 8,
      20,
    )
  }
  const createRange = document.createRange.bind(document)
  vi.spyOn(document, 'createRange').mockImplementation(() => {
    const range = createRange()
    range.getBoundingClientRect = rangeRect
    range.getClientRects = () => [rangeRect.call(range)] as unknown as DOMRectList
    return range
  })
}
for (const kind of ['ordinary', 'windowed'] as const)
  it(`${kind} End scrolls the inner code line and a manual scroll refreshes overlays`, async () => {
    mockCodeGeometry()
    const text = '```\n' + 'x'.repeat(200) + '\n```'
    const s = await setup(kind, text, Selection.cursor(4))
    s.view.inputDOM.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true }),
    )
    if (s.view instanceof SourceDocumentView) await s.view.flushPendingEdits()
    const line = s.view.contentDOM.querySelector<HTMLElement>('[data-line="2"]')!
    expect(line.scrollLeft).toBeGreaterThan(0)
    const cursor = () =>
      Number.parseFloat(
        s.view.cursorLayerDOM.querySelector<HTMLElement>('.milkup-cursor')!.style.left,
      )
    expect(cursor()).toBeLessThanOrEqual(220)
    const previous = cursor()
    line.scrollLeft -= 20
    line.dispatchEvent(new Event('scroll'))
    expect(cursor()).toBe(previous + 20)
  })

for (const kind of ['ordinary', 'windowed'] as const) {
  it(`${kind} checkbox activation keeps adjacent typing in separate undo steps`, async () => {
    const s = await setup(kind, '- [ ] a')
    s.view.inputDOM.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'b', bubbles: true, cancelable: true }),
    )
    await s.flush()
    const task = s.view.contentDOM.querySelector<HTMLButtonElement>('.milkup-task-marker')!
    task.focus()
    task.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }))
    await s.flush()
    expect(s.current().doc.text).toBe('- [x] ab')
    expect(s.current().undo().doc.text).toBe('- [ ] ab')
    expect(s.current().undo().undo().doc.text).toBe('- [ ] a')
    expect(document.activeElement?.classList.contains('milkup-task-marker')).toBe(true)
  })

  it(`${kind} ignores repeated keydown and composition-time checkbox activation`, async () => {
    const s = await setup(kind, '- [ ] a')
    const task = s.view.contentDOM.querySelector<HTMLElement>('.milkup-task-marker')!
    task.dispatchEvent(
      new KeyboardEvent('keydown', { key: ' ', repeat: true, bubbles: true, cancelable: true }),
    )
    s.view.inputDOM.dispatchEvent(new CompositionEvent('compositionstart'))
    task.click()
    await s.flush()
    expect(s.current().doc.text).toBe('- [ ] a')
  })

  it(`${kind} keeps code literal, including inline markup and task-looking text`, async () => {
    const s = await setup(kind, '```\n- [ ] **literal**\n```')
    const line = s.view.contentDOM.querySelector('[data-line="2"]')!
    expect(line.textContent).toBe('- [ ] **literal**')
    expect(line.querySelector('.milkup-task-marker, .milkup-inline-strong')).toBeNull()
  })
}

it('windowed rejects a queued checkbox click after a document switch', async () => {
  const s = await setup('windowed', '- [ ] a')
  const view = s.view as SourceDocumentView
  view.contentDOM.querySelector<HTMLElement>('.milkup-task-marker')!.click()
  view.updateSource(
    new MemoryDocumentSource({
      documentId: 'different',
      document: new MemoryTextDocument('- [ ] other'),
      version: 0,
    }),
  )
  await s.flush()
  expect(s.edits).toHaveLength(0)
})

it('windowed ignores a stale marker while text input is queued', async () => {
  const s = await setup('windowed', '- [ ] a', Selection.cursor(0))
  s.view.inputDOM.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'z', bubbles: true, cancelable: true }),
  )
  s.view.contentDOM.querySelector<HTMLElement>('.milkup-task-marker')!.click()
  await s.flush()
  expect(s.current().doc.text).toBe('z- [ ] a')
  expect(s.edits).toHaveLength(1)
})

for (const kind of ['ordinary', 'windowed'] as const)
  it(`${kind} clips code selection/search to the inner viewport and preserves scroll on rerender`, async () => {
    mockCodeGeometry()
    const text = '```\n' + 'x'.repeat(200) + '\n```'
    const s = await setup(kind, text, Selection.cursor(4))
    s.view.inputDOM.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'End', shiftKey: true, bubbles: true, cancelable: true }),
    )
    if (s.view instanceof SourceDocumentView) await s.view.flushPendingEdits()
    s.view.setSearchHighlights([{ from: 4, to: 204, line: 2 }])
    for (const overlay of Array.from(
      s.view.dom.querySelectorAll<HTMLElement>('.milkup-selection, .milkup-search-highlight'),
    )) {
      expect(Number.parseFloat(overlay.style.left)).toBeGreaterThanOrEqual(20)
      expect(
        Number.parseFloat(overlay.style.left) + Number.parseFloat(overlay.style.width),
      ).toBeLessThanOrEqual(220)
    }
    const line = s.view.contentDOM.querySelector<HTMLElement>('[data-line="2"]')!
    const scroll = line.scrollLeft
    if (s.view instanceof SourceDocumentView) await s.view.renderVisibleWindow()
    else s.view.updateState(s.view.state.applyTransaction({ selection: Selection.cursor(203) }))
    expect(s.view.contentDOM.querySelector<HTMLElement>('[data-line="2"]')!.scrollLeft).toBe(scroll)
  })

for (const kind of ['ordinary', 'windowed'] as const)
  it(`${kind} renders nested inline children and hides their delimiters outside selection`, async () => {
    const s = await setup(kind, '**bold *italic* tail** after\nelsewhere')
    const strong = s.view.contentDOM.querySelector('.milkup-inline-strong')!
    expect(
      strong.querySelector('.milkup-inline-emphasis .milkup-inline-content')?.textContent,
    ).toBe('italic')
    const visibleText = (element: Element): string =>
      Array.from(element.childNodes)
        .map((node) =>
          node instanceof Element
            ? node.classList.contains('milkup-marker-hidden')
              ? ''
              : visibleText(node)
            : (node.textContent ?? ''),
        )
        .join('')
    expect(visibleText(strong)).toBe('bold italic tail')
    expect(s.view.contentDOM.querySelector('[data-line="1"]')?.textContent).toBe(
      '**bold *italic* tail** after',
    )
  })

it('windowed cancels checkbox preparation when editing is locked before its queue runs', async () => {
  const s = await setup('windowed', '- [ ] a')
  s.view.contentDOM.querySelector<HTMLElement>('.milkup-task-marker')!.click()
  s.view.setEditable(false)
  await s.flush()
  expect(s.edits).toHaveLength(0)
  expect(s.current().doc.text).toBe('- [ ] a')
  expect(s.view.contentDOM.querySelector<HTMLButtonElement>('.milkup-task-marker')!.disabled).toBe(
    true,
  )
})

it('windowed serializes a delayed checkbox commit and ignores duplicate activation', async () => {
  let state = new EditorState({
    doc: new MemoryTextDocument('中文😀\r\n- [ ] a'),
    selection: Selection.cursor(0),
  })
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const edits: SourceDocumentEdit[] = []
  const source = () =>
    new MemoryDocumentSource({ documentId: 'delayed', document: state.doc, version: edits.length })
  const view = new SourceDocumentView({
    parent: document.body,
    source: source(),
    mode: 'live',
    editable: true,
    backgroundMarkdownWarmup: false,
    async onEdit(edit) {
      edits.push(edit)
      await gate
      state = state.applyTransaction({
        changes: ChangeSet.replace(edit.from, edit.to, edit.insert),
        selection: edit.selectionAfter!,
        historyGroup: 'isolate',
      })
      view.updateSource(source())
    },
  })
  views.push(view)
  await view.renderVisibleWindow()
  const task = view.contentDOM.querySelector<HTMLButtonElement>('.milkup-task-marker')!
  task.click()
  task.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  await vi.waitFor(() => expect(edits).toHaveLength(1))
  expect(task.disabled).toBe(true)
  release()
  await view.flushPendingEdits()
  expect(edits).toHaveLength(1)
  expect(state.doc.text).toBe('中文😀\r\n- [x] a')
  expect(state.undo().doc.text).toBe('中文😀\r\n- [ ] a')
})

for (const kind of ['ordinary', 'windowed'] as const)
  it(`${kind} maps a scrolled code click back to its source offset`, async () => {
    mockCodeGeometry()
    const s = await setup(kind, '```\n' + 'x'.repeat(200) + '\n```', Selection.cursor(4))
    const line = s.view.contentDOM.querySelector<HTMLElement>('[data-line="2"]')!
    line.scrollLeft = 800
    const click = new MouseEvent('click', { clientX: 100, clientY: 25 })
    expect(sourcePositionFromPoint(line, click, undefined, { allowGeometryFallback: true })).toBe(
      114,
    )
  })

it('nested projection maps text after inner delimiters to its rendered offset', () => {
  const text = '**bold *italic* tail** after'
  const projection = buildLineProjection(text, Selection.cursor(text.length), 0, text.length)
  expect(projection.visualLength).toBe('bold italic tail after'.length)
  expect(sourcePositionToVisualOffset(projection, text.indexOf('tail'))).toBe('bold italic '.length)
})

function mockSourceGeometry() {
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.classList.contains('milkup-editor') ? 240 : 0
  })
  vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.classList.contains('milkup-editor') ? 1640 : 0
  })
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement,
  ) {
    const root = this.closest<HTMLElement>('.milkup-editor')
    if (this.classList.contains('milkup-editor')) return new DOMRect(0, 0, 240, 120)
    if (this.classList.contains('milkup-line'))
      return new DOMRect(20 - (root?.scrollLeft ?? 0), 20, 1600, 20)
    return new DOMRect(-(root?.scrollLeft ?? 0), 0, 240, 120)
  })
  const createRange = document.createRange.bind(document)
  vi.spyOn(document, 'createRange').mockImplementation(() => {
    const range = createRange()
    range.getBoundingClientRect = () => {
      const root = range.startContainer.parentElement?.closest<HTMLElement>('.milkup-editor')
      return new DOMRect(
        20 + range.startOffset * 8 - (root?.scrollLeft ?? 0),
        20,
        (range.endOffset - range.startOffset) * 8,
        20,
      )
    }
    range.getClientRects = () => [range.getBoundingClientRect()] as unknown as DOMRectList
    return range
  })
}
for (const kind of ['ordinary', 'windowed'] as const)
  it(`${kind} source End and Home reveal the caret by scrolling the editor horizontally`, async () => {
    mockSourceGeometry()
    const s = await setup(kind, 'x'.repeat(200), Selection.cursor(0))
    s.view.setMode('source')
    if (s.view instanceof SourceDocumentView) await s.view.renderVisibleWindow()
    const key = async (key: string, shiftKey = false) => {
      s.view.inputDOM.dispatchEvent(
        new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true }),
      )
      if (s.view instanceof SourceDocumentView) await s.view.flushPendingEdits()
    }
    await key('End', true)
    expect(s.view.dom.scrollLeft).toBeGreaterThan(0)
    const cursorLeft = () =>
      Number.parseFloat(
        s.view.cursorLayerDOM.querySelector<HTMLElement>('.milkup-cursor')!.style.left,
      ) - s.view.dom.scrollLeft
    expect(cursorLeft()).toBeLessThanOrEqual(240)
    expect(cursorLeft()).toBeGreaterThanOrEqual(0)
    const selection = s.view instanceof EditorView ? s.view.state.selection : s.view.selection
    expect([selection.main.anchor, selection.main.head]).toEqual([0, 200])
    await key('Home')
    expect(s.view.dom.scrollLeft).toBeLessThanOrEqual(20)
    expect(cursorLeft()).toBeGreaterThanOrEqual(0)
    expect(cursorLeft()).toBeLessThanOrEqual(240)
  })

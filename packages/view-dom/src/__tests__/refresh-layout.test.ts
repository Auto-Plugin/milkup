import { EditorState, MemoryDocumentSource, MemoryTextDocument, Selection } from '@milkup/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EditorView, SourceDocumentView } from '../index'

const text = Array.from({ length: 300 }, (_, i) => `中文😀 é line ${i}`).join('\r\n')
const views: (EditorView | SourceDocumentView)[] = []
afterEach(() => {
  views.splice(0).forEach((view) => view.destroy())
  document.body.replaceChildren()
  document.head.querySelectorAll('[data-layout-test]').forEach((style) => style.remove())
  vi.restoreAllMocks()
})
function theme() {
  const parent = document.createElement('main')
  parent.className = 'layout-test'
  document.body.append(parent)
  const style = document.createElement('style')
  style.dataset.layoutTest = 'true'
  document.head.append(style)
  const apply = (font: number, height: number) => {
    style.textContent = `.layout-test .milkup-editor { font-size: ${font}px; line-height: ${height}px; }`
  }
  apply(14, 20)
  return { parent, apply, style }
}
const viewport = { enabled: true, lineHeight: 20, viewportHeight: 120, overscanLines: 0 }

describe('same-instance CSS layout refresh', () => {
  for (const mode of ['source', 'live'] as const) {
    it(`remeasures ordinary ${mode} computed root typography without changing editor identity/history`, () => {
      const { parent, apply } = theme()
      const state = new EditorState({
        doc: new MemoryTextDocument(text),
        selection: Selection.range(8, 2),
      })
      const dispatch = vi.fn()
      const view = new EditorView({ parent, state, mode, dispatch, virtualViewport: viewport })
      views.push(view)
      const input = view.inputDOM
      input.focus()
      view.dom.scrollTop = 205
      view.dom.scrollLeft = 17
      const revision = view.selectionRevision
      apply(24, 36)
      view.refreshLayout()
      expect(view.lineHeight).toBe(36)
      expect(view.dom.style.lineHeight).toBe('')
      expect(getComputedStyle(view.dom).lineHeight).toBe('36px')
      expect(view.contentDOM.style.getPropertyValue('--milkup-line-height')).toBe('36px')
      expect(view.dom.scrollTop).toBe(369)
      expect(view.dom.scrollLeft).toBe(17)
      expect(view.inputDOM).toBe(input)
      expect(document.activeElement).toBe(input)
      expect(view.state).toBe(state)
      expect(view.state.history).toBe(state.history)
      expect(view.selectionRevision).toBe(revision)
      expect(dispatch).not.toHaveBeenCalled()
      if (mode === 'source') expect(view.contentDOM.dataset.fromLine).toBe('11')
      apply(12, 15)
      view.refreshLayout()
      expect(view.lineHeight).toBe(15)
      expect(view.dom.scrollTop).toBe(153.75)
    })

    it(`remeasures windowed ${mode} typography with the same line and fractional scroll anchor`, async () => {
      const { parent, apply } = theme()
      const source = new MemoryDocumentSource({ documentId: 'css-layout', text })
      const onEdit = vi.fn()
      const view = new SourceDocumentView({
        parent,
        source,
        mode,
        onEdit,
        backgroundMarkdownWarmup: false,
        virtualViewport: viewport,
      })
      views.push(view)
      await view.revealSelection(50, Selection.range(8, 2))
      await view.scrollToLine(50)
      view.dom.scrollTop += 5
      view.dom.scrollLeft = 17
      const input = view.inputDOM,
        selection = view.selection,
        revision = view.selectionRevision
      input.focus()
      apply(24, 36)
      await view.refreshLayout()
      expect(view.lineHeight).toBe(36)
      expect(view.visibleLineRange.fromLine).toBe(50)
      expect(view.dom.scrollTop).toBe(49 * 36 + 9)
      expect(view.dom.scrollLeft).toBe(17)
      expect(view.contentDOM.style.getPropertyValue('--milkup-line-height')).toBe('36px')
      expect(view.inputDOM).toBe(input)
      expect(document.activeElement).toBe(input)
      expect(view.source).toBe(source)
      expect(source.version).toBe(0)
      expect(view.selection).toEqual(selection)
      expect(view.selectionRevision).toBe(revision)
      expect(onEdit).not.toHaveBeenCalled()
    })

    for (const windowed of [false, true])
      it(`retains active ${windowed ? 'windowed' : 'ordinary'} ${mode} IME preedit until its own compositionend`, async () => {
        const { parent, apply } = theme()
        let value = 'ab中文😀\r\nnext'
        const source = new MemoryDocumentSource({ documentId: 'preedit', text: value })
        const edits: unknown[] = []
        const view = windowed
          ? new SourceDocumentView({
              parent,
              source,
              mode,
              editable: true,
              backgroundMarkdownWarmup: false,
              onEdit(edit) {
                edits.push(edit)
                value = value.slice(0, edit.from) + edit.insert + value.slice(edit.to)
                ;(source as unknown as { document: MemoryTextDocument }).document =
                  new MemoryTextDocument(value)
              },
              virtualViewport: viewport,
            })
          : new EditorView({
              parent,
              mode,
              state: new EditorState({
                doc: new MemoryTextDocument(value),
                selection: Selection.cursor(1),
              }),
            })
        views.push(view)
        if (view instanceof SourceDocumentView) await view.revealSelection(1, Selection.cursor(1))
        const input = view.inputDOM
        input.focus()
        input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
        input.value = '候选'
        input.dispatchEvent(
          new CompositionEvent('compositionupdate', { data: '候选', bubbles: true }),
        )
        const revision = view.selectionRevision
        apply(20, 30)
        await view.refreshLayout()
        expect(view.isComposing).toBe(true)
        expect(view.inputDOM).toBe(input)
        expect(input.value).toBe('候选')
        expect(document.activeElement).toBe(input)
        expect(view.selectionRevision).toBe(revision)
        expect(edits).toHaveLength(0)
        input.dispatchEvent(new CompositionEvent('compositionend', { data: '文', bubbles: true }))
        if (view instanceof SourceDocumentView) {
          await view.flushPendingEdits()
          expect(value).toBe('a文b中文😀\r\nnext')
          expect(edits).toHaveLength(1)
        } else {
          expect(view.state.doc.text).toBe('a文b中文😀\r\nnext')
          expect(view.state.undo().doc.text).toBe('ab中文😀\r\nnext')
        }
        expect(view.isComposing).toBe(false)
      })
  }

  it('rejects a late window read from the previous CSS layout', async () => {
    const { parent, apply } = theme()
    const source = new MemoryDocumentSource({ documentId: 'layout-race', text })
    const view = new SourceDocumentView({
      parent,
      source,
      mode: 'source',
      backgroundMarkdownWarmup: false,
      virtualViewport: viewport,
    })
    views.push(view)
    await view.scrollToLine(50)
    const originalRead = source.readLineWindow.bind(source)
    let release!: () => void, started!: () => void
    const reading = new Promise<void>((resolve) => {
      started = resolve
    })
    vi.spyOn(source, 'readLineWindow').mockImplementationOnce(async (...args) => {
      started()
      await new Promise<void>((resolve) => {
        release = resolve
      })
      return originalRead(...args)
    })
    apply(24, 36)
    const old = view.refreshLayout()
    await reading
    apply(30, 48)
    await view.refreshLayout()
    const installed = view.contentDOM.innerHTML
    release()
    await old
    expect(view.lineHeight).toBe(48)
    expect(view.dom.scrollTop).toBe(49 * 48)
    expect(view.visibleLineRange.fromLine).toBe(50)
    expect(view.contentDOM.innerHTML).toBe(installed)
  })
  for (const windowed of [false, true]) {
    it(`restores base metrics after removing a ${windowed ? 'windowed' : 'ordinary'} CSS override`, async () => {
      const { parent, apply, style } = theme()
      const source = new MemoryDocumentSource({ documentId: 'remove-theme', text })
      const view = windowed
        ? new SourceDocumentView({
            parent,
            source,
            backgroundMarkdownWarmup: false,
            virtualViewport: viewport,
          })
        : new EditorView({
            parent,
            state: new EditorState({ doc: new MemoryTextDocument(text) }),
            virtualViewport: viewport,
          })
      views.push(view)
      if (view instanceof SourceDocumentView) await view.renderVisibleWindow()
      apply(24, 36)
      await view.refreshLayout()
      expect(view.lineHeight).toBe(36)
      expect(view.dom.style.getPropertyValue('--milkup-line-height')).toBe('')
      style.remove()
      await view.refreshLayout()
      expect(view.lineHeight).toBe(20)
      expect(view.contentDOM.style.getPropertyValue('--milkup-line-height')).toBe('20px')
    })
  }

  it('does not undo a newer selection or horizontal scroll while layout reading is pending', async () => {
    const { parent, apply } = theme()
    const source = new MemoryDocumentSource({ documentId: 'user-scroll', text })
    const view = new SourceDocumentView({
      parent,
      source,
      backgroundMarkdownWarmup: false,
      virtualViewport: viewport,
    })
    views.push(view)
    await view.scrollToLine(50)
    view.dom.scrollLeft = 17
    const read = source.readLineWindow.bind(source)
    let release!: () => void, started!: () => void
    const reading = new Promise<void>((resolve) => {
      started = resolve
    })
    vi.spyOn(source, 'readLineWindow').mockImplementationOnce(async (...args) => {
      started()
      await new Promise<void>((resolve) => {
        release = resolve
      })
      return read(...args)
    })
    apply(24, 36)
    const changing = view.refreshLayout()
    await reading
    view.dom.scrollLeft = 61
    const selected = Selection.range(8, 2)
    view.setSelection(selected)
    const selectionRevision = view.selectionRevision
    release()
    await changing
    expect(view.dom.scrollLeft).toBe(61)
    expect(view.selection).toEqual(selected)
    expect(view.selectionRevision).toBe(selectionRevision)
  })

  it('never restores a previous document after an in-flight layout refresh', async () => {
    const { parent, apply } = theme()
    const source = new MemoryDocumentSource({ documentId: 'old-css-document', text })
    const view = new SourceDocumentView({
      parent,
      source,
      backgroundMarkdownWarmup: false,
      virtualViewport: viewport,
    })
    views.push(view)
    await view.scrollToLine(50)
    const read = source.readLineWindow.bind(source)
    let release!: () => void, started!: () => void
    const reading = new Promise<void>((resolve) => {
      started = resolve
    })
    vi.spyOn(source, 'readLineWindow').mockImplementationOnce(async (...args) => {
      started()
      await new Promise<void>((resolve) => {
        release = resolve
      })
      return read(...args)
    })
    apply(24, 36)
    const changing = view.refreshLayout()
    await reading
    const next = new MemoryDocumentSource({ documentId: 'next-css-document', text: 'next 中文😀' })
    view.updateSource(next)
    await view.renderVisibleWindow()
    const installed = view.contentDOM.innerHTML
    release()
    await changing
    expect(view.source).toBe(next)
    expect(view.dom.scrollTop).toBe(0)
    expect(view.contentDOM.innerHTML).toBe(installed)
    expect(view.selection.main.head).toBe(0)
  })
})

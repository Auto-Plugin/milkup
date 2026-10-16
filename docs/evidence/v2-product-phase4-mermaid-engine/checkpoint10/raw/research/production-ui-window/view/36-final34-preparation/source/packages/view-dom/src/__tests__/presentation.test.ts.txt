import { EditorState, MemoryTextDocument, MemoryDocumentSource, Selection } from '@milkup/core'
import { describe, expect, it, vi } from 'vitest'
import { EditorView, SourceDocumentView } from '../index'

const presentation = {
  fontFamily: 'serif',
  fontSize: 24,
  lineHeight: 2,
  contentWidth: 720,
  indentation: 'spaces-4',
} as const
const text = Array.from({ length: 1000 }, (_, i) => `- 中文😀 ${i}`).join('\r\n')

class EditableSource extends MemoryDocumentSource {
  private editVersion = 0
  override get version() {
    return this.editVersion
  }
  updateText(text: string) {
    ;(this as unknown as { document: MemoryTextDocument }).document = new MemoryTextDocument(text)
    this.editVersion++
  }
}

describe('editor presentation', () => {
  for (const mode of ['source', 'live'] as const) {
    for (const [indentation, unit] of [
      ['spaces-2', '  '],
      ['spaces-4', '    '],
      ['tabs', '\t'],
    ] as const) {
      it(`applies ${indentation} to future windowed ${mode} edits only`, async () => {
        const initial = '- 中文😀\r\n- é'
        let text = initial
        const source = new EditableSource({ documentId: 'indent', text })
        const edits: unknown[] = []
        const view = new SourceDocumentView({
          parent: document.createElement('main'),
          source,
          mode,
          editable: true,
          backgroundMarkdownWarmup: false,
          onEdit(edit) {
            edits.push(edit)
            text = text.slice(0, edit.from) + edit.insert + text.slice(edit.to)
            source.updateText(text)
          },
        })
        await view.revealSelection(1, Selection.range(initial.length, 0))
        await view.setPresentation({ ...presentation, indentation })
        expect(text).toBe(initial)
        view.inputDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))
        await view.flushPendingEdits()
        expect(text).toBe(unit + '- 中文😀\r\n' + unit + '- é')
        expect(edits).toHaveLength(1)
        expect(view.selection.main.anchor).toBe(initial.length + unit.length * 2)
        expect(view.selection.main.head).toBe(unit.length)
        view.inputDOM.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true }),
        )
        await view.flushPendingEdits()
        expect(text).toBe(initial)
        view.destroy()
      })
    }
    it(`changes ordinary ${mode} layout without a document transaction`, () => {
      const state = new EditorState({
        doc: new MemoryTextDocument(text),
        selection: Selection.range(8, 2),
      })
      const dispatch = vi.fn()
      const view = new EditorView({
        parent: document.createElement('main'),
        state,
        mode,
        dispatch,
        virtualViewport: { enabled: true, lineHeight: 21, viewportHeight: 96, overscanLines: 0 },
      })
      view.setPresentation(presentation)
      expect(view.state).toBe(state)
      expect(dispatch).not.toHaveBeenCalled()
      expect(view.lineHeight).toBe(48)
      expect(view.dom.style.fontSize).toBe('24px')
      expect(view.dom.style.getPropertyValue('--milkup-line-height')).toBe('48px')
      expect(view.positionToRect(state.doc.line(10).from).top).toBe(432)
      if (mode === 'source') expect(view.contentDOM.dataset.toLine).toBe('2')
      expect(view.cursorLayerDOM.firstElementChild?.getAttribute('data-position')).toBe('2')
      view.destroy()
    })
    it(`changes windowed ${mode} geometry while preserving selection and version`, async () => {
      const source = new MemoryDocumentSource({ documentId: 'presentation', text })
      const edit = vi.fn()
      const view = new SourceDocumentView({
        parent: document.createElement('main'),
        source,
        mode,
        onEdit: edit,
        backgroundMarkdownWarmup: false,
        virtualViewport: { enabled: true, lineHeight: 21, viewportHeight: 96, overscanLines: 0 },
      })
      await view.revealSelection(1, Selection.range(8, 2))
      const version = source.version
      await view.setPresentation(presentation)
      expect(view.source).toBe(source)
      expect(source.version).toBe(version)
      expect(edit).not.toHaveBeenCalled()
      expect(view.selection.main.anchor).toBe(8)
      expect(view.selection.main.head).toBe(2)
      expect(view.lineHeight).toBe(48)
      expect(view.visibleLineRange.toLine).toBe(2)
      expect(
        view.contentDOM.querySelector<HTMLElement>('[data-spacer="bottom"]')?.style.height,
      ).toBe('47904px')
      view.destroy()
    })
    it(`uses the future indentation setting in ordinary ${mode}`, () => {
      const initial = '- 中文😀\r\n- next'
      const state = new EditorState({
        doc: new MemoryTextDocument(initial),
        selection: Selection.range(initial.length, 0),
      })
      const view = new EditorView({ parent: document.createElement('main'), state, mode })
      view.setPresentation(presentation)
      expect(view.state.doc.text).toBe(initial)
      view.inputDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))
      expect(view.state.doc.text).toBe('    - 中文😀\r\n    - next')
      view.inputDOM.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true }),
      )
      expect(view.state.doc.text).toBe(initial)
      view.destroy()
    })
  }

  it('rejects invalid values atomically and accepts the supported bounds', () => {
    const view = new EditorView({
      parent: document.createElement('main'),
      state: new EditorState({ doc: new MemoryTextDocument('unchanged') }),
    })
    view.setPresentation(presentation)
    expect(view.dom.style.tabSize).toBe('')
    const line = view.contentDOM.firstElementChild
    view.setPresentation({ ...presentation, indentation: 'tabs' })
    expect(view.contentDOM.firstElementChild).toBe(line)
    const before = view.dom.style.cssText
    for (const value of [
      { fontSize: 33 },
      { fontSize: NaN },
      { lineHeight: 1.1 },
      { contentWidth: 479 },
      { contentWidth: Infinity },
      { fontFamily: 'url(evil)' },
      { indentation: 'evil' },
    ]) {
      expect(() =>
        view.setPresentation({ ...presentation, ...value } as typeof presentation),
      ).toThrow(RangeError)
      expect(view.dom.style.cssText).toBe(before)
    }
    view.setPresentation({ ...presentation, fontSize: 12, lineHeight: 1.2, contentWidth: 480 })
    expect(view.lineHeight).toBeCloseTo(14.4)
    view.setPresentation({ ...presentation, fontSize: 32, lineHeight: 2.4, contentWidth: 1200 })
    expect(view.lineHeight).toBeCloseTo(76.8)
    view.destroy()
  })

  it('updates deep virtual scroll and page navigation with the new line metrics', async () => {
    const source = new MemoryDocumentSource({ documentId: 'deep', text })
    const view = new SourceDocumentView({
      parent: document.createElement('main'),
      source,
      editable: true,
      backgroundMarkdownWarmup: false,
      virtualViewport: { enabled: true, lineHeight: 21, viewportHeight: 192, overscanLines: 0 },
    })
    const window = await source.readLineWindow(800, 800)
    await view.revealSelection(800, Selection.cursor(window.from))
    await view.setPresentation(presentation)
    expect(view.dom.scrollTop).toBe(799 * 48)
    expect(view.visibleLineRange).toEqual({ fromLine: 800, toLine: 803 })
    view.inputDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageDown', bubbles: true }))
    await view.flushPendingEdits()
    expect((await source.lineAtPosition(view.selection.main.head)).number).toBe(803)
    expect(view.contentDOM.querySelectorAll('.milkup-line').length).toBeLessThan(10)
    view.destroy()
  })

  it('does not restore an old layout scroll after the active source changes', async () => {
    const source = new MemoryDocumentSource({ documentId: 'old-layout', text })
    const view = new SourceDocumentView({
      parent: document.createElement('main'),
      source,
      backgroundMarkdownWarmup: false,
      virtualViewport: { enabled: true, lineHeight: 21, viewportHeight: 96, overscanLines: 0 },
    })
    await view.scrollToLine(800)
    const read = source.readLineWindow.bind(source)
    let release!: () => void
    let started!: () => void
    const startedRead = new Promise<void>((resolve) => {
      started = resolve
    })
    vi.spyOn(source, 'readLineWindow').mockImplementationOnce(async (...args) => {
      started()
      await new Promise<void>((resolve) => {
        release = resolve
      })
      return read(...args)
    })
    const changing = view.setPresentation({ ...presentation, fontSize: 12, lineHeight: 1.2 })
    await startedRead
    const next = new MemoryDocumentSource({ documentId: 'next-layout', text: 'next' })
    view.updateSource(next)
    await view.renderVisibleWindow()
    release()
    await changing
    expect(view.source).toBe(next)
    expect(view.dom.scrollTop).toBe(0)
    expect(view.contentDOM.querySelector('.milkup-line')?.textContent).toBe('next')
    view.destroy()
  })

  it('measures wrapped live lines again after a width or font change', async () => {
    const view = new SourceDocumentView({
      parent: document.createElement('main'),
      source: new MemoryDocumentSource({ documentId: 'wrapped', text }),
      mode: 'live',
      backgroundMarkdownWarmup: false,
      virtualViewport: { enabled: true, viewportHeight: 96, overscanLines: 0 },
    })
    await view.renderVisibleWindow()
    const bounds = vi
      .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockImplementation(function (this: HTMLElement) {
        const height = this.classList.contains('milkup-line') ? 96 : 0
        return {
          x: 0,
          y: 0,
          top: 0,
          left: 0,
          right: 400,
          bottom: height,
          width: 400,
          height,
          toJSON() {},
        }
      })
    try {
      await view.setPresentation(presentation)
      expect(view.visibleLineRange.fromLine).toBe(1)
      // Two measured wrapped rows add 96px to the new base extent.
      expect(
        view.contentDOM.querySelector<HTMLElement>('[data-spacer="bottom"]')?.style.height,
      ).toBe('47904px')
      view.dom.scrollTop = 95
      expect(view.visibleLineRange.fromLine).toBe(1)
      view.dom.scrollTop = 96
      expect(view.visibleLineRange.fromLine).toBe(2)
      await view.setPresentation({ ...presentation, fontSize: 12 })
      expect(view.lineHeight).toBe(24)
      expect(view.visibleLineRange.fromLine).toBe(2)
    } finally {
      bounds.mockRestore()
      view.destroy()
    }
  })

  it('keeps live table Tab navigation separate from indentation preferences in both views', async () => {
    const text = '| 中文 | B |\n| --- | --- |\n| 😀 | D |'
    const state = new EditorState({
      doc: new MemoryTextDocument(text),
      selection: Selection.cursor(3),
    })
    const ordinary = new EditorView({ parent: document.createElement('main'), state, mode: 'live' })
    ordinary.setPresentation({ ...presentation, indentation: 'tabs' })
    ordinary.inputDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))
    expect(ordinary.state.doc.text).toBe(text)
    expect(ordinary.state.selection.main.head).toBeGreaterThan(3)
    const edit = vi.fn()
    const windowed = new SourceDocumentView({
      parent: document.createElement('main'),
      source: new MemoryDocumentSource({ documentId: 'table', text }),
      mode: 'live',
      editable: true,
      onEdit: edit,
      backgroundMarkdownWarmup: false,
    })
    await windowed.revealSelection(1, Selection.cursor(3))
    await windowed.setPresentation({ ...presentation, indentation: 'tabs' })
    windowed.inputDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))
    await windowed.flushPendingEdits()
    expect(edit).not.toHaveBeenCalled()
    expect(windowed.selection.main.head).toBeGreaterThan(3)
    ordinary.destroy()
    windowed.destroy()
  })
})

for (const windowed of [false, true]) {
  it(`${windowed ? 'windowed' : 'ordinary'} centered gutters focus exact Unicode endpoints and drag without stealing controls`, async () => {
    const text = '中文😀\r\nsecond é'
    const parent = document.createElement('main')
    document.body.append(parent)
    const view = windowed
      ? new SourceDocumentView({
          parent,
          source: new MemoryDocumentSource({ documentId: 'gutters', text }),
          mode: 'live',
          backgroundMarkdownWarmup: false,
        })
      : new EditorView({
          parent,
          state: new EditorState({
            doc: new MemoryTextDocument(text),
            selection: Selection.cursor(0),
          }),
          mode: 'live',
        })
    if (view instanceof SourceDocumentView) await view.renderVisibleWindow()
    await view.setPresentation(presentation)
    const selection = () => (view instanceof EditorView ? view.state.selection : view.selection)
    const geometry = () => {
      view.dom.getBoundingClientRect = () =>
        ({ left: 0, right: 1000, top: 0, bottom: 500, width: 1000, height: 500 }) as DOMRect
      for (const line of Array.from(
        view.contentDOM.querySelectorAll<HTMLElement>('.milkup-line'),
      )) {
        const top = Number(line.dataset.line) === 1 ? 20 : 100
        line.getBoundingClientRect = () =>
          ({ left: 140, right: 860, top, bottom: top + 60, width: 720, height: 60 }) as DOMRect
      }
    }
    const down = windowed ? 'pointerdown' : 'mousedown'
    const move = windowed ? 'pointermove' : 'mousemove'
    const up = windowed ? 'pointerup' : 'mouseup'
    geometry()
    view.dom.dispatchEvent(
      new MouseEvent(down, {
        bubbles: true,
        cancelable: true,
        button: 0,
        buttons: 1,
        clientX: 20,
        clientY: 50,
      }),
    )
    expect(document.activeElement).toBe(view.inputDOM)
    expect(selection().main.head).toBe(0)
    geometry()
    view.dom.dispatchEvent(
      new MouseEvent(move, {
        bubbles: true,
        cancelable: true,
        buttons: 1,
        clientX: 980,
        clientY: 50,
      }),
    )
    expect(selection().main.anchor).toBe(0)
    expect(selection().main.head).toBe('中文😀'.length)
    document.dispatchEvent(
      new MouseEvent(up, { bubbles: true, button: 0, clientX: 980, clientY: 50 }),
    )
    geometry()
    view.dom.dispatchEvent(
      new MouseEvent(down, {
        bubbles: true,
        cancelable: true,
        button: 0,
        buttons: 1,
        clientX: 20,
        clientY: 130,
      }),
    )
    expect(selection().main.head).toBe('中文😀\r\n'.length)
    const control = document.createElement('button')
    view.dom.append(control)
    control.focus()
    control.dispatchEvent(
      new MouseEvent(down, {
        bubbles: true,
        cancelable: true,
        button: 0,
        clientX: 20,
        clientY: 50,
      }),
    )
    control.dispatchEvent(
      new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        button: 0,
        clientX: 20,
        clientY: 50,
      }),
    )
    expect(document.activeElement).toBe(control)
    expect(selection().main.head).toBe('中文😀\r\n'.length)
    // The root now owns gutter events; the actual scrollbar strip still belongs
    // to the browser and must not focus the proxy or start selection dragging.
    Object.defineProperties(view.dom, {
      clientWidth: { value: 984, configurable: true },
      offsetWidth: { value: 1000, configurable: true },
      clientHeight: { value: 484, configurable: true },
      offsetHeight: { value: 500, configurable: true },
      scrollHeight: { value: 2000, configurable: true },
      scrollWidth: { value: 2000, configurable: true },
    })
    for (const [clientX, clientY] of [
      [995, 50],
      [50, 495],
    ] as const) {
      for (const type of [down, 'click']) {
        const event = new MouseEvent(type, {
          bubbles: true,
          cancelable: true,
          button: 0,
          buttons: 1,
          clientX,
          clientY,
        })
        view.dom.dispatchEvent(event)
        expect(event.defaultPrevented).toBe(false)
        expect(document.activeElement).toBe(control)
        expect(selection().main.head).toBe('中文😀\r\n'.length)
      }
    }
    view.destroy()
    parent.remove()
  })
}

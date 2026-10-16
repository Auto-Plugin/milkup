import { afterEach, expect, it, vi } from 'vitest'
import { EditorState, MemoryDocumentSource, MemoryTextDocument, Selection } from '@milkup/core'
import { EditorView, SourceDocumentView, type DocumentPresentationConfig } from '../index'
import type { DocumentPresentationWindow } from '../document-presentation'

const views: Array<EditorView | SourceDocumentView> = []
afterEach(() => {
  views.splice(0).forEach((view) => view.destroy())
  vi.restoreAllMocks()
  document.body.replaceChildren()
})
const settle = async () => {
  for (let i = 0; i < 8; i++) await new Promise((resolve) => setTimeout(resolve, 0))
}
for (const windowed of [false, true])
  for (const ending of ['lf', 'crlf', 'eof'] as const) {
    it(`includes an initially visible complete long fence within the input budget (${windowed ? 'windowed' : 'ordinary'}, ${ending})`, async () => {
      const newline = ending === 'crlf' ? '\r\n' : '\n'
      const close = '```  \t'
      const source = [
        'MARKER',
        '```generic',
        ...Array.from({ length: 60 }, (_, i) => `node ${i}`),
        close,
        ...(ending === 'eof' ? [] : ['AFTER']),
      ].join(newline)
      const calls: DocumentPresentationWindow[] = []
      const config: DocumentPresentationConfig = {
        provide: (window) => {
          calls.push(window)
          return {
            declarations: [],
            request: {
              documentId: 'boundary',
              version: 0,
              source: window.source,
              from: window.from,
              to: window.to,
              fromLine: window.fromLine,
              toLine: window.toLine,
              completeStart: window.completeStart,
              completeEnd: window.completeEnd,
              selection: window.selection,
              width: window.width,
              contextKnown: true,
              blocks: [],
              protectedRanges: [],
              theme: 'light',
              target: 'screen',
            },
            result: { complete: true, fragments: [] },
          }
        },
      }
      vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
        this: HTMLElement,
      ) {
        const top = this.classList.contains('milkup-line')
          ? (Number(this.dataset.line) - 1) * 21
          : 0
        const height = this.classList.contains('milkup-line') ? 21 : 100
        return {
          x: 0,
          y: top,
          top,
          bottom: top + height,
          left: 0,
          right: 400,
          width: 400,
          height,
          toJSON: () => ({}),
        }
      })
      const parent = document.createElement('main')
      document.body.append(parent)
      const doc = new MemoryTextDocument(source)
      const view = windowed
        ? new SourceDocumentView({
            parent,
            mode: 'live',
            source: new MemoryDocumentSource({ documentId: 'boundary', document: doc }),
            documentPresentation: config,
          })
        : new EditorView({
            parent,
            mode: 'live',
            state: new EditorState({ doc, selection: Selection.cursor(0) }),
            documentPresentation: config,
          })
      views.push(view)
      await settle()
      const request = calls.at(-1)!
      expect(request).toBeDefined()
      expect(request.source).toContain(`node 59${newline}${close}`)
      expect(request.toLine).toBeGreaterThanOrEqual(63)
      expect(request.toLine - request.fromLine + 1).toBeLessThanOrEqual(256)
      view.setMode('source')
      await settle()
      expect(view.contentDOM.querySelector('[data-presentation-block-from]')).toBeNull()
      view.setMode('live')
      await settle()
      const changed = new MemoryTextDocument(source.replace(`${newline}${close}`, ''))
      if (view instanceof SourceDocumentView)
        view.updateSource(
          new MemoryDocumentSource({ documentId: 'changed', version: 1, document: changed }),
        )
      else view.updateState(new EditorState({ doc: changed, selection: Selection.cursor(0) }))
      await settle()
      expect(view.contentDOM.querySelector('[data-presentation-block-from]')).toBeNull()
    })
  }

for (const limit of ['lines', 'characters'] as const) {
  it(`keeps an oversized complete fence literal at the ${limit} budget`, async () => {
    const count = limit === 'lines' ? 260 : 60
    const body = Array.from(
      { length: count },
      (_, i) => `node ${i}${limit === 'characters' ? 'x'.repeat(1100) : ''}`,
    )
    const source = ['MARKER', '```generic', ...body, '```', 'AFTER'].join('\n')
    const calls: DocumentPresentationWindow[] = []
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement,
    ) {
      const top = this.classList.contains('milkup-line') ? (Number(this.dataset.line) - 1) * 21 : 0,
        height = this.classList.contains('milkup-line') ? 21 : 100
      return {
        x: 0,
        y: top,
        top,
        bottom: top + height,
        left: 0,
        right: 400,
        width: 400,
        height,
        toJSON: () => ({}),
      }
    })
    const parent = document.createElement('main')
    document.body.append(parent)
    const doc = new MemoryTextDocument(source)
    const view = new EditorView({
      parent,
      mode: 'live',
      state: new EditorState({ doc, selection: Selection.cursor(0) }),
      documentPresentation: {
        provide: (window) => {
          calls.push(window)
          return {
            declarations: [],
            request: {
              documentId: 'budget',
              version: 0,
              source: window.source,
              from: window.from,
              to: window.to,
              fromLine: window.fromLine,
              toLine: window.toLine,
              completeStart: window.completeStart,
              completeEnd: window.completeEnd,
              selection: window.selection,
              width: window.width,
              contextKnown: true,
              blocks: [],
              protectedRanges: [],
              theme: 'light',
              target: 'screen',
            },
            result: { complete: true, fragments: [] },
          }
        },
      },
    })
    views.push(view)
    await settle()
    const request = calls.at(-1)!
    expect(request.toLine - request.fromLine + 1).toBeLessThanOrEqual(256)
    expect(request.source.length).toBeLessThanOrEqual(65_536)
    expect(request.source).not.toContain(`${body.at(-1)}\n\x60\x60\x60`)
    expect(view.contentDOM.querySelector('[data-document-presentation]')).toBeNull()
    expect(view.state.doc.text).toBe(source)
  })
}

function boundedFixture(source: MemoryDocumentSource) {
  const calls: DocumentPresentationWindow[] = []
  const config: DocumentPresentationConfig = {
    provide: (window) => {
      calls.push(window)
      return {
        declarations: [],
        request: {
          documentId: source.documentId,
          version: source.version,
          source: window.source,
          from: window.from,
          to: window.to,
          fromLine: window.fromLine,
          toLine: window.toLine,
          completeStart: window.completeStart,
          completeEnd: window.completeEnd,
          selection: window.selection,
          width: window.width,
          contextKnown: true,
          blocks: [],
          protectedRanges: [],
          theme: 'light',
          target: 'screen',
        },
        result: { complete: true, fragments: [] },
      }
    },
  }
  const parent = document.createElement('main')
  document.body.append(parent)
  const view = new SourceDocumentView({
    parent,
    source,
    mode: 'live',
    documentPresentation: config,
  })
  views.push(view)
  return { view, calls, config }
}

for (const kind of ['unclosed', 'over-lines', 'over-characters'] as const) {
  it(`bounds and remembers unsuccessful ${kind} supplementary reads`, async () => {
    const text = [
      'MARKER',
      '```generic',
      ...Array.from(
        { length: 300 },
        (_, i) => `line ${i}${kind === 'over-characters' ? 'x'.repeat(1000) : ''}`,
      ),
      ...(kind === 'unclosed' ? [] : ['```']),
    ].join('\n')
    const source = new MemoryDocumentSource({ documentId: kind, text })
    const read = vi.spyOn(source, 'readLineWindow')
    const { view } = boundedFixture(source)
    await settle()
    const supplements = () => read.mock.calls.filter((call) => call[2] === 65_536)
    expect(supplements()).toHaveLength(1)
    expect(supplements()[0]![1] - supplements()[0]![0] + 1).toBeLessThanOrEqual(256)
    for (let i = 0; i < 4; i++) await view.renderVisibleWindow()
    expect(supplements()).toHaveLength(1)
    expect(Number(view.contentDOM.dataset.toLine)).toBeLessThan(63)
    expect(view.contentDOM.querySelector('[data-presentation-block-from]')).toBeNull()
    if (kind === 'unclosed') {
      // Reusing a negative hint must retain the new, larger ordinary window.
      Object.defineProperty(view.dom, 'clientHeight', { configurable: true, value: 1000 })
      await view.renderVisibleWindow()
      expect(Number(view.contentDOM.dataset.toLine)).toBeGreaterThanOrEqual(60)
      expect(supplements()).toHaveLength(1)
    }
    expect((await source.readLineWindow(1, source.lineCount)).text).toBe(text)
  })
}

for (const change of ['source', 'version', 'mode', 'configuration'] as const) {
  it(`discards supplementary results after a ${change} change`, async () => {
    const text = [
      'MARKER',
      '```generic',
      ...Array.from({ length: 60 }, (_, i) => `line ${i}`),
      '```',
      ...Array(300).fill('tail'),
    ].join('\n')
    const source = new MemoryDocumentSource({ documentId: 'deferred', text })
    const original = source.readLineWindow.bind(source)
    let release!: () => void,
      started = false
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    vi.spyOn(source, 'readLineWindow').mockImplementation(async (from, to, max) => {
      const result = await original(from, to, max)
      if (max === 65_536) {
        started = true
        await gate
      }
      return result
    })
    const { view } = boundedFixture(source)
    await vi.waitFor(() => expect(started).toBe(true))
    if (change === 'source')
      view.updateSource(new MemoryDocumentSource({ documentId: 'new', text: 'new document' }))
    if (change === 'version') {
      vi.spyOn(source, 'version', 'get').mockReturnValue(1)
      view.setDocumentPresentation(undefined)
      view.updateSource(source)
    }
    if (change === 'mode') view.setMode('source')
    if (change === 'configuration') view.setDocumentPresentation(undefined)
    await settle()
    release()
    await settle()
    if (change === 'source') expect(view.contentDOM.textContent).toContain('new document')
    else expect(Number(view.contentDOM.dataset.toLine)).toBeLessThan(63)
    expect(view.contentDOM.querySelector('[data-presentation-block-from]')).toBeNull()
    expect(view.selection.main.head).toBe(0)
  })
}

it('does not use an old base parse as a supplementary hint for a replacement source', async () => {
  const text = [
    'MARKER',
    '```generic',
    ...Array.from({ length: 60 }, (_, i) => `old ${i}`),
    '```',
  ].join('\n')
  const source = new MemoryDocumentSource({ documentId: 'old', text })
  const original = source.readLineWindow.bind(source)
  let release!: () => void,
    started = false
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  vi.spyOn(source, 'readLineWindow').mockImplementation(async (from, to, max) => {
    const result = await original(from, to, max)
    started = true
    await gate
    return result
  })
  const { view } = boundedFixture(source)
  await vi.waitFor(() => expect(started).toBe(true))
  const replacement = new MemoryDocumentSource({
    documentId: 'replacement',
    text: Array.from({ length: 300 }, (_, i) => `new ${i}`).join('\n'),
  })
  const read = vi.spyOn(replacement, 'readLineWindow')
  view.updateSource(replacement)
  await settle()
  release()
  await settle()
  expect(read.mock.calls.filter((call) => call[2] === 65_536)).toHaveLength(0)
  expect(view.contentDOM.textContent).toContain('new 0')
  expect(view.contentDOM.textContent).not.toContain('old 0')
})

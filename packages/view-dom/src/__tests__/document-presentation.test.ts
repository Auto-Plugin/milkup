import { afterEach, expect, it, vi } from 'vitest'
import {
  ChangeSet,
  EditorState,
  MemoryTextDocument,
  Selection,
  MemoryDocumentSource,
} from '@milkup/core'
import {
  EditorView,
  SourceDocumentView,
  createDocumentPresentationNode,
  type DocumentPresentationConfig,
} from '../index'
const views: Array<EditorView | SourceDocumentView> = []
it('uses the host foreground for untoned vector text and preserves explicit tones', () => {
  const svg = createDocumentPresentationNode(document, {
    type: 'vector',
    width: 100,
    height: 80,
    children: [
      { type: 'text', x: 1, y: 20, text: 'Default' },
      { type: 'text', x: 1, y: 40, text: 'Muted', tone: 'muted' },
      { type: 'text', x: 1, y: 60, text: 'Accent', tone: 'accent' },
    ],
  }) as SVGElement
  const labels = Array.from(svg.querySelectorAll('text'))
  expect(labels.map((label) => label.getAttribute('fill'))).toEqual([
    'currentColor',
    'var(--milkup-presentation-muted, currentColor)',
    'var(--milkup-presentation-accent, currentColor)',
  ])
})
afterEach(() => {
  for (const view of views.splice(0)) view.destroy()
  document.body.replaceChildren()
})
import { sourcePositionToVisualOffsetInLine } from '../source-position-mapping'
const settle = async () => {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0))
}
function provider(from = 0, to = 5): DocumentPresentationConfig {
  return {
    provide: async ({
      sourceIdentity: _identity,
      sourceVersion: _version,
      documentVersion: _documentVersion,
      visibleFrom: _visibleFrom,
      visibleTo: _visibleTo,
      ...window
    }) => ({
      declarations: [{ id: 'test', contexts: ['text'] }],
      request: {
        ...window,
        documentId: 'test',
        version: 0,
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
            from,
            to,
            layout: 'inline',
            accessibleText: 'fraction',
            content: {
              type: 'math',
              tree: {
                tag: 'math',
                children: [
                  {
                    tag: 'mfrac',
                    children: [
                      { tag: 'mi', text: 'a' },
                      { tag: 'mi', text: 'b' },
                    ],
                  },
                ],
              },
            },
          },
        ],
      },
    }),
  }
}
for (const windowed of [false, true]) {
  async function make(
    mode: 'source' | 'live' = 'live',
    config = provider(),
    text = '$a/b$ 中文😀 tail',
  ) {
    const doc = new MemoryTextDocument(text)
    const parent = document.createElement('main')
    document.body.append(parent)
    const view = windowed
      ? new SourceDocumentView({
          parent,
          mode,
          source: new MemoryDocumentSource({ documentId: 'test', document: doc }),
          documentPresentation: config,
        })
      : new EditorView({
          parent,
          mode,
          state: new EditorState({ doc, selection: Selection.cursor(doc.length) }),
          documentPresentation: config,
        })
    views.push(view)
    if (view instanceof SourceDocumentView)
      await view.revealSelection(1, Selection.cursor(doc.length))
    await settle()
    return view
  }
  function largeVectorProvider(targetText = () => 'Reading target'): DocumentPresentationConfig {
    const base = provider()
    return {
      provide: async (window, options) => {
        const response = await base.provide(window, options)
        return {
          ...response,
          result: {
            ...response.result,
            fragments: response.result.fragments.map((fragment) => ({
              ...fragment,
              layout: 'block' as const,
              accessibleText: 'Scrollable reading diagram',
              content: {
                type: 'vector' as const,
                width: 900,
                height: 900,
                children: [
                  { type: 'text' as const, x: 20, y: 30, text: 'Start' },
                  { type: 'text' as const, x: 700, y: 850, text: targetText() },
                ],
              },
            })),
          },
        }
      },
    }
  }

  const readingPreview = (
    view: EditorView | SourceDocumentView,
    targetText = 'Reading target',
  ): HTMLElement => {
    const preview = view.contentDOM.querySelector<HTMLElement>('[data-document-presentation]')
    expect(preview?.querySelector('svg text')?.textContent).toBe('Start')
    expect(preview?.textContent).toContain(targetText)
    return preview!
  }

  for (const refresh of windowed ? ['source-window', 'provider'] : ['provider']) {
    it(`keeps the reader's inner diagram position through ${refresh} refresh (${windowed})`, async () => {
      const config = largeVectorProvider()
      const provide = vi.spyOn(config, 'provide')
      const view = await make('live', config)
      const before = readingPreview(view)
      // jsdom verifies continuity of public DOM scroll state only. The separate
      // browser regression must establish real wheel/visible-target reachability.
      before.scrollTop = 120
      before.scrollLeft = 90
      const outside = document.createElement('button')
      document.body.append(outside)
      outside.focus()
      const text =
        view instanceof SourceDocumentView
          ? (await view.source.readLineWindow(1, view.source.lineCount)).text
          : view.state.doc.text
      const selection =
        view instanceof SourceDocumentView ? view.selection.main : view.state.selection.main
      const callsBefore = provide.mock.calls.length
      if (refresh === 'source-window') {
        expect(view).toBeInstanceOf(SourceDocumentView)
        await (view as SourceDocumentView).renderVisibleWindow()
      } else {
        view.refreshDocumentPresentation()
        await vi.waitFor(() => expect(provide.mock.calls.length).toBeGreaterThan(callsBefore))
      }
      await settle()
      const after = readingPreview(view)
      expect({ top: after.scrollTop, left: after.scrollLeft }).toEqual({ top: 120, left: 90 })
      expect(document.activeElement).toBe(outside)
      expect(
        view instanceof SourceDocumentView ? view.selection.main : view.state.selection.main,
      ).toEqual(selection)
      if (view instanceof SourceDocumentView) {
        expect(view.source.version).toBe(0)
        expect((await view.source.readLineWindow(1, view.source.lineCount)).text).toBe(text)
      } else {
        expect(view.state.doc.text).toBe(text)
        expect(view.state.undo().doc.text).toBe(text)
      }
    })
  }

  for (const change of ['identity', 'version', 'config', 'semantic-content'] as const) {
    it(`does not carry a prior diagram position across ${change} replacement (${windowed})`, async () => {
      let targetText = 'Reading target'
      const view = await make(
        'live',
        largeVectorProvider(() => targetText),
      )
      const before = readingPreview(view)
      before.scrollTop = 120
      before.scrollLeft = 90
      const text =
        view instanceof SourceDocumentView
          ? (await view.source.readLineWindow(1, view.source.lineCount)).text
          : view.state.doc.text
      if (change === 'config') {
        view.setDocumentPresentation(largeVectorProvider())
      } else if (change === 'semantic-content') {
        targetText = 'Changed reading target'
        view.refreshDocumentPresentation()
      } else if (view instanceof SourceDocumentView) {
        const nextText = change === 'version' ? text + '!' : text
        view.updateSource(
          new MemoryDocumentSource({
            documentId: change === 'identity' ? 'different-document' : view.source.documentId,
            version: change === 'version' ? 1 : 0,
            text: nextText,
          }),
        )
        await view.revealSelection(1, Selection.cursor(nextText.length))
      } else if (change === 'identity') {
        view.updateState(
          new EditorState({
            doc: new MemoryTextDocument(text),
            selection: Selection.cursor(text.length),
          }),
        )
        view.refreshDocumentPresentation()
      } else {
        view.updateState(
          view.state.applyTransaction({
            changes: ChangeSet.insert(text.length, '!'),
            selection: Selection.cursor(text.length + 1),
          }),
        )
      }
      await settle()
      const after = readingPreview(view, targetText)
      expect({ top: after.scrollTop, left: after.scrollLeft }).toEqual({ top: 0, left: 0 })
    })
  }

  if (windowed) {
    it('does not carry a diagram position across a version change on the same source object', async () => {
      const memory = new MemoryDocumentSource({ documentId: 'mutable-version', text: '$a/b$ tail' })
      let version = 0
      const source = {
        documentId: memory.documentId,
        get version() {
          return version
        },
        lineCount: memory.lineCount,
        length: memory.length,
        readLineWindow: memory.readLineWindow.bind(memory),
        lineAtPosition: memory.lineAtPosition.bind(memory),
        positionAtLineOffset: memory.positionAtLineOffset.bind(memory),
        snapshot: () => ({ ...memory.snapshot(), version }),
      }
      const parent = document.createElement('main')
      document.body.append(parent)
      const view = new SourceDocumentView({
        parent,
        source,
        mode: 'live',
        documentPresentation: largeVectorProvider(),
      })
      views.push(view)
      await view.revealSelection(1, Selection.cursor(memory.length))
      await settle()
      const before = readingPreview(view)
      before.scrollTop = 120
      before.scrollLeft = 90
      version = 1
      view.updateSource(source)
      await view.renderVisibleWindow()
      await settle()
      expect(view.source).toBe(source)
      expect(view.source.version).toBe(1)
      const after = readingPreview(view)
      expect({ top: after.scrollTop, left: after.scrollLeft }).toEqual({ top: 0, left: 0 })
    })
  }

  if (windowed) {
    async function makeScrollableDiagram() {
      const text = ['$a/b$ tail', ...Array<string>(199).fill('reader text')].join('\n')
      const source = new MemoryDocumentSource({ documentId: 'scroll-reader', text })
      const read = vi.spyOn(source, 'readLineWindow')
      const base = largeVectorProvider()
      const parent = document.createElement('main')
      document.body.append(parent)
      const view = new SourceDocumentView({
        parent,
        source,
        mode: 'live',
        backgroundMarkdownWarmup: false,
        virtualViewport: { enabled: true, viewportHeight: 84, overscanLines: 2 },
        documentPresentation: {
          provide: async (window, options) => {
            const response = await base.provide(window, options)
            return {
              ...response,
              result: {
                ...response.result,
                fragments: response.result.fragments.filter(
                  (fragment) => fragment.from >= window.from && fragment.to <= window.to,
                ),
              },
            }
          },
        },
      })
      views.push(view)
      await view.revealSelection(1, Selection.cursor(10))
      await settle()
      return { view, source, read, text }
    }

    it('keeps a reader diagram mounted across repeated same-position editor scroll events', async () => {
      const { view, read, source, text } = await makeScrollableDiagram()
      // Establish a handled real position first. The following notifications
      // carry no further motion and must not recreate the reader's viewport.
      // Move beyond the navigation anchor's existing one-pixel tolerance.
      view.dom.scrollTop = 2
      view.dom.dispatchEvent(new Event('scroll'))
      await settle()
      const before = readingPreview(view)
      before.scrollTop = 120
      before.scrollLeft = 90
      const selection = view.selection.main
      const reads = read.mock.calls.length
      for (let count = 0; count < 3; count++) {
        view.dom.dispatchEvent(new Event('scroll'))
        await settle()
      }
      const after = readingPreview(view)
      expect(after).toBe(before)
      expect({ top: after.scrollTop, left: after.scrollLeft }).toEqual({ top: 120, left: 90 })
      expect(read.mock.calls.length).toBe(reads)
      expect(view.selection.main).toEqual(selection)
      expect(source.version).toBe(0)
      expect((await source.readLineWindow(1, source.lineCount)).text).toBe(text)
    })

    it('retries an anchor-owned failed navigation read on the next same-position scroll', async () => {
      const { view, read, source, text } = await makeScrollableDiagram()
      let entered = false
      let rejectRead!: (reason: Error) => void
      const waiting = new Promise<never>((_, reject) => {
        rejectRead = reject
      })
      read.mockImplementationOnce(async () => {
        entered = true
        return waiting
      })
      const failure = new Error('temporarily unavailable target window')
      // Attach a rejection observer before releasing the failing source read.
      const navigation = view.scrollToLine(100).then(
        () => undefined,
        (error: unknown) => error,
      )
      try {
        await vi.waitFor(() => expect(entered).toBe(true))
        view.dom.dispatchEvent(new Event('scroll'))
      } finally {
        rejectRead(failure)
      }
      expect(await navigation).toBe(failure)
      const failedPosition = view.dom.scrollTop
      const callsAfterFailure = read.mock.calls.length
      view.dom.dispatchEvent(new Event('scroll'))
      await vi.waitFor(() => {
        expect(read.mock.calls.length).toBeGreaterThan(callsAfterFailure)
        expect(view.contentDOM.querySelector('[data-line="100"]')?.textContent).toContain(
          'reader text',
        )
      })
      expect(view.dom.scrollTop).toBe(failedPosition)
      expect(source.version).toBe(0)
      expect((await source.readLineWindow(1, source.lineCount)).text).toBe(text)
    })

    it('loads a genuinely moved editor viewport after duplicate scroll notifications', async () => {
      const { view, source, text } = await makeScrollableDiagram()
      // Move beyond the navigation anchor's existing one-pixel tolerance.
      view.dom.scrollTop = 2
      view.dom.dispatchEvent(new Event('scroll'))
      await settle()
      view.dom.dispatchEvent(new Event('scroll'))
      await settle()
      const fromBefore = Number(view.contentDOM.dataset.fromLine)
      const selection = view.selection.main
      view.dom.scrollTop = 420
      view.dom.dispatchEvent(new Event('scroll'))
      await vi.waitFor(() =>
        expect(Number(view.contentDOM.dataset.fromLine)).toBeGreaterThan(fromBefore),
      )
      const from = Number(view.contentDOM.dataset.fromLine)
      const to = Number(view.contentDOM.dataset.toLine)
      expect(from).toBeLessThanOrEqual(21)
      expect(to).toBeGreaterThanOrEqual(21)
      expect(view.contentDOM.querySelector('[data-line="21"]')?.textContent).toContain(
        'reader text',
      )
      expect(view.selection.main).toEqual(selection)
      expect(source.version).toBe(0)
      expect((await source.readLineWindow(1, source.lineCount)).text).toBe(text)
    })
  }

  for (const change of ['mode', 'selection'] as const) {
    it(`resets a prior diagram reading position after ${change} changes (${windowed})`, async () => {
      const view = await make('live', largeVectorProvider())
      const before = readingPreview(view)
      before.scrollTop = 120
      before.scrollLeft = 90
      const text =
        view instanceof SourceDocumentView
          ? (await view.source.readLineWindow(1, view.source.lineCount)).text
          : view.state.doc.text
      if (change === 'mode') {
        view.setMode('source')
        await settle()
        expect(view.contentDOM.querySelector('[data-document-presentation]')).toBeNull()
        view.setMode('live')
      } else {
        // Both selections stay outside the fragment; no edit reveals or changes it.
        const selection = Selection.cursor(text.length - 1)
        if (view instanceof SourceDocumentView) await view.revealSelection(1, selection)
        else view.updateState(view.state.applyTransaction({ selection }))
      }
      await settle()
      const after = readingPreview(view)
      expect({ top: after.scrollTop, left: after.scrollLeft }).toEqual({ top: 0, left: 0 })
      if (view instanceof SourceDocumentView) {
        expect(view.source.version).toBe(0)
        expect((await view.source.readLineWindow(1, view.source.lineCount)).text).toBe(text)
      } else {
        expect(view.state.doc.text).toBe(text)
        expect(view.state.undo().doc.text).toBe(text)
      }
    })
  }

  it(`keeps preview keyboard focus when the view refreshes its source DOM (${windowed})`, async () => {
    const base = provider()
    const view = await make('live', {
      provide: async (window, options) => {
        const response = await base.provide(window, options)
        return {
          ...response,
          result: {
            ...response.result,
            fragments: response.result.fragments.map((fragment) => ({
              ...fragment,
              layout: 'block' as const,
            })),
          },
        }
      },
    })
    view.contentDOM.querySelector<HTMLElement>('[data-document-presentation]')!.focus()
    if (view instanceof SourceDocumentView) await view.renderVisibleWindow()
    else
      view.setPresentation({
        fontFamily: 'monospace',
        fontSize: 16,
        lineHeight: 1.5,
        contentWidth: 0,
        indentation: 'spaces-2',
      })
    await settle()
    expect(document.activeElement).toBe(
      view.contentDOM.querySelector('[data-document-presentation]'),
    )
  })
  it(`anchors an asynchronously growing preview above the visible selection (${windowed})`, async () => {
    const source = 'top\n$a/b$\nmarker',
      base = provider(4, 9)
    let resume!: () => void
    const waiting = new Promise<void>((resolve) => {
      resume = resolve
    })
    const view = await make(
      'live',
      {
        provide: async (window, options) => {
          await waiting
          return base.provide(window, options)
        },
      },
      source,
    )
    const rect = (top: number, height: number) =>
      ({
        x: 0,
        y: top,
        top,
        bottom: top + height,
        left: 0,
        right: 800,
        width: 800,
        height,
        toJSON: () => ({}),
      }) as DOMRect
    vi.spyOn(view.dom, 'getBoundingClientRect').mockImplementation(() => rect(0, 100))
    const lines = Array.from(view.contentDOM.querySelectorAll<HTMLElement>('.milkup-line'))
    for (const [index, line] of lines.entries())
      vi.spyOn(line, 'getBoundingClientRect').mockImplementation(() =>
        rect(
          (index === 2 && view.contentDOM.querySelector('math') ? 221 : index * 21) -
            view.dom.scrollTop,
          21,
        ),
      )
    view.dom.scrollTop = 0
    const selectionBefore =
      view instanceof SourceDocumentView ? view.selection.main : view.state.selection.main
    resume()
    await settle()
    expect(view.contentDOM.querySelector('math')).not.toBeNull()
    expect(lines[2]!.getBoundingClientRect().top).toBe(42)
    view.setDocumentPresentation(undefined)
    expect(lines[2]!.getBoundingClientRect().top).toBe(42)
    expect(view.dom.scrollTop).toBe(0)
    expect(
      view instanceof SourceDocumentView ? view.selection.main : view.state.selection.main,
    ).toEqual(selectionBefore)
    view.setMode('source')
    await settle()
    expect(view.contentDOM.querySelector('math')).toBeNull()
    if (view instanceof SourceDocumentView) {
      expect(view.source.version).toBe(0)
      expect((await view.source.readLineWindow(1, view.source.lineCount)).text).toBe(source)
    } else {
      expect(view.state.doc.text).toBe(source)
      expect(view.state.undo().doc.text).toBe(source)
    }
  })
  it(`refreshes selection-dependent third-party output without repaint loops (${windowed})`, async () => {
    const base = provider()
    const config: DocumentPresentationConfig = {
      provide: vi.fn(async (window, options) => {
        const response = await base.provide(window, options)
        return {
          ...response,
          result: {
            ...response.result,
            fragments: response.result.fragments.map((fragment) => ({
              ...fragment,
              content: {
                type: 'text' as const,
                text: `${window.selection.anchor}/${window.selection.head}`,
              },
            })),
          },
        }
      }),
    }
    const view = await make('live', config)
    const change = async (selection: Selection) => {
      if (view instanceof SourceDocumentView) await view.revealSelection(1, selection)
      else view.updateState(view.state.applyTransaction({ selection }))
      await settle()
    }
    await change(Selection.range(11, 14))
    expect(view.contentDOM.querySelector('[data-document-presentation]')?.textContent).toBe('11/14')
    await change(Selection.range(14, 11))
    expect(view.contentDOM.querySelector('[data-document-presentation]')?.textContent).toBe('14/11')
    const count = vi.mocked(config.provide).mock.calls.length
    await change(Selection.range(14, 11))
    expect(config.provide).toHaveBeenCalledTimes(count)
    await change(Selection.cursor(2))
    expect(view.contentDOM.querySelector('[data-document-presentation]')).toBeNull()
    await change(Selection.cursor(14))
    expect(view.contentDOM.querySelector('[data-document-presentation]')?.textContent).toBe('14/14')
  })
  it(`cancels the old selection job and discards its late output (${windowed})`, async () => {
    const base = provider()
    let resume!: () => void, oldSignal: AbortSignal | undefined
    const waiting = new Promise<void>((resolve) => (resume = resolve))
    const config: DocumentPresentationConfig = {
      provide: async (window, options) => {
        if (window.selection.head === 14) {
          oldSignal = options.signal
          await waiting
        }
        const response = await base.provide(window, options)
        return {
          ...response,
          result: {
            ...response.result,
            fragments: response.result.fragments.map((fragment) => ({
              ...fragment,
              content: { type: 'text' as const, text: String(window.selection.head) },
            })),
          },
        }
      },
    }
    const view = await make('live', config)
    const change = async (head: number) => {
      if (view instanceof SourceDocumentView) await view.revealSelection(1, Selection.cursor(head))
      else view.updateState(view.state.applyTransaction({ selection: Selection.cursor(head) }))
      await settle()
    }
    await change(14)
    await change(13)
    expect(oldSignal?.aborted).toBe(true)
    resume()
    await settle()
    expect(view.contentDOM.querySelector('[data-document-presentation]')?.textContent).toBe('13')
  })
  it(`uses real MathML, retains mapped source and reveals on selection (${windowed})`, async () => {
    const view = await make()
    expect(view.contentDOM.querySelector('math')?.namespaceURI).toBe(
      'http://www.w3.org/1998/Math/MathML',
    )
    expect(view.contentDOM.querySelector('mfrac')).not.toBeNull()
    expect(view.contentDOM.querySelector('[data-document-presentation]')?.textContent).toBe('ab')
    expect(view.contentDOM.textContent).toContain('中文😀 tail')
    if (view instanceof SourceDocumentView) await view.revealSelection(1, Selection.cursor(2))
    else view.updateState(view.state.applyTransaction({ selection: Selection.cursor(2) }))
    await settle()
    expect(view.contentDOM.querySelector('math')).toBeNull()
    expect(view.contentDOM.textContent).toContain('$a/b$ 中文😀 tail')
  })
  it(`keeps source literal and disable restores source without a transaction (${windowed})`, async () => {
    const config = provider()
    const spy = vi.spyOn(config, 'provide')
    const view = await make('source', config)
    expect(spy).not.toHaveBeenCalled()
    view.setMode('live')
    await settle()
    expect(view.contentDOM.querySelector('math')).not.toBeNull()
    const selection = view instanceof SourceDocumentView ? view.selection : view.state.selection
    view.setDocumentPresentation(undefined)
    await settle()
    expect(view.contentDOM.querySelector('math')).toBeNull()
    expect(view.contentDOM.textContent).toContain('$a/b$')
    expect(view instanceof SourceDocumentView ? view.selection : view.state.selection).toEqual(
      selection,
    )
  })
  it(`excludes preview text from mapped offsets, coalesces and invalidates (${windowed})`, async () => {
    const config = provider(),
      spy = vi.spyOn(config, 'provide')
    const view = await make('live', config)
    const line = view.contentDOM.querySelector<HTMLElement>('.milkup-line')!
    expect(sourcePositionToVisualOffsetInLine(line, 14)).toBe(9)
    const initialCalls = spy.mock.calls.length
    expect(initialCalls).toBeGreaterThan(0)
    view.dom.dispatchEvent(new Event('scroll'))
    await settle()
    expect(spy).toHaveBeenCalledTimes(initialCalls)
    view.invalidateDocumentPresentation()
    await settle()
    expect(spy).toHaveBeenCalledTimes(initialCalls + 1)
    expect(view.contentDOM.querySelectorAll('math')).toHaveLength(1)
  })
  it(`mounts a multiline block once and restores every original line (${windowed})`, async () => {
    const text = '$$\r\na+b\r\n$$\r\n中文😀 tail'
    const base = provider(0, 11)
    const config: DocumentPresentationConfig = {
      provide: async (window, options) => {
        const response = await base.provide(window, options)
        return {
          ...response,
          result: {
            ...response.result,
            fragments: response.result.fragments.map((fragment) => ({
              ...fragment,
              layout: 'block' as const,
            })),
          },
        }
      },
    }
    const view = await make('live', config, text)
    expect(view.contentDOM.querySelectorAll('math')).toHaveLength(1)
    expect(view.contentDOM.querySelectorAll('[data-presentation-collapsed="true"]')).toHaveLength(2)
    view.inputDOM.focus()
    if (view instanceof SourceDocumentView) await view.revealSelection(2, Selection.cursor(5))
    else view.updateState(view.state.applyTransaction({ selection: Selection.cursor(5) }))
    await settle()
    expect(view.contentDOM.querySelector('math')).toBeNull()
    expect(view.contentDOM.querySelectorAll('[data-presentation-collapsed]')).toHaveLength(0)
    expect(view.contentDOM.textContent).toContain('a+b')
    if (view instanceof EditorView) {
      expect(view.state.doc.text).toBe(text)
      expect(view.state.undo().doc.text).toBe(text)
    }
  })
  it(`renders the native CRLF matrix range without consuming its line ending (${windowed})`, async () => {
    const formula = String.raw`\begin{pmatrix}a&b\\c&d\end{pmatrix}`
    const text = ['SAMPLE-MATRIX', '$$', formula, '$$', '', 'SAMPLE-FLOW', '中文😀 tail'].join(
      '\r\n',
    )
    const from = text.indexOf('$$'),
      to = text.indexOf('$$', from + 2) + 2
    expect(text.slice(to, to + 2)).toBe('\r\n')
    expect(text.slice(from, to)).toBe(['$$', formula, '$$'].join('\r\n'))
    const base = provider(from, to)
    const config: DocumentPresentationConfig = {
      provide: async (window, options) => {
        const response = await base.provide(window, options)
        return {
          ...response,
          result: {
            ...response.result,
            fragments: [
              {
                from,
                to,
                layout: 'block',
                accessibleText: formula,
                content: {
                  type: 'math',
                  tree: {
                    tag: 'math',
                    attributes: { display: 'block' },
                    children: [
                      {
                        tag: 'mtable',
                        children: ['ab', 'cd'].map((row) => ({
                          tag: 'mtr' as const,
                          children: [...row].map((text) => ({
                            tag: 'mtd' as const,
                            children: [{ tag: 'mi' as const, text }],
                          })),
                        })),
                      },
                    ],
                  },
                },
              },
            ],
          },
        }
      },
    }
    const view = await make('live', config, text)
    expect(view.contentDOM.querySelectorAll('math')).toHaveLength(1)
    expect(view.contentDOM.querySelectorAll('mtable mtr')).toHaveLength(2)
    expect(view.contentDOM.querySelectorAll('mtable mtd')).toHaveLength(4)
    expect(
      view.contentDOM
        .querySelector('[data-document-presentation]')
        ?.getAttribute('data-presentation-to'),
    ).toBe(String(to))
    expect(view.contentDOM.textContent).toContain('SAMPLE-FLOW')
    if (view instanceof SourceDocumentView) await view.revealSelection(3, Selection.range(from, to))
    else view.updateState(view.state.applyTransaction({ selection: Selection.range(from, to) }))
    await settle()
    expect(view.contentDOM.querySelector('math')).toBeNull()
    view.setMode('source')
    await settle()
    expect(view.contentDOM.textContent).toContain(formula)
    if (view instanceof EditorView) {
      expect(view.state.doc.text).toBe(text)
      expect(view.state.undo().doc.text).toBe(text)
    } else {
      const source = view.source
      expect((await source.readLineWindow(1, source.lineCount)).text).toBe(text)
    }
  })
  it(`uses accessible references without editing or swallowing keyboard activation (${windowed})`, async () => {
    const base = provider(),
      navigate = vi.fn()
    const config: DocumentPresentationConfig = {
      onNavigate: navigate,
      provide: async (window, options) => {
        const response = await base.provide(window, options)
        return {
          ...response,
          result: {
            ...response.result,
            fragments: [
              {
                from: 0,
                to: 5,
                layout: 'inline',
                accessibleText: 'footnote one',
                content: {
                  type: 'reference',
                  label: '1',
                  target: { documentId: 'test', version: 0, from: 6, to: 8 },
                },
              },
            ],
          },
        }
      },
    }
    const view = await make('live', config)
    const button = view.contentDOM.querySelector('button')!
    button.focus()
    const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
    button.dispatchEvent(enter)
    expect(enter.defaultPrevented).toBe(false)
    button.click()
    expect(document.activeElement).toBe(button)
    expect(navigate).toHaveBeenCalledWith({ documentId: 'test', version: 0, from: 6, to: 8 })
    view.setDocumentPresentation(undefined)
    button.click()
    expect(navigate).toHaveBeenCalledTimes(1)
  })
  it(`preserves an ordinary task control alongside inline presentation (${windowed})`, async () => {
    const view = await make('live', provider(6, 11), '- [ ] $a/b$ tail')
    expect(view.contentDOM.querySelectorAll('math')).toHaveLength(1)
    expect(view.contentDOM.querySelectorAll('.milkup-task-marker')).toHaveLength(1)
  })
  it(`rejects protected and malformed output while preserving editable source (${windowed})`, async () => {
    const base = provider()
    const config: DocumentPresentationConfig = {
      provide: async (window, options) => {
        const response = await base.provide(window, options)
        return {
          ...response,
          request: { ...response.request, protectedRanges: [{ from: 0, to: 5 }] },
        }
      },
    }
    const view = await make('live', config)
    expect(view.contentDOM.querySelector('math')).toBeNull()
    expect(view.contentDOM.textContent).toContain('$a/b$')
    expect(view.contentDOM.getAttribute('aria-description')).toContain('源码')
    const notice = view.dom.querySelector('[data-document-presentation-notice]')
    expect(notice?.textContent).toContain('源码')
    expect(notice?.getAttribute('role')).toBe('status')
    expect(view.contentDOM.contains(notice)).toBe(false)
    view.setMode('source')
    await settle()
    expect(view.dom.querySelector('[data-document-presentation-notice]')).toBeNull()
  })
  it(`bounds requests before invoking a provider on a huge line (${windowed})`, async () => {
    const config = provider(),
      spy = vi.spyOn(config, 'provide')
    const view = await make('live', config, 'x'.repeat(65537))
    expect(spy).not.toHaveBeenCalled()
    expect(view.contentDOM.getAttribute('aria-description')).toContain('预算')
  })
  it(`discards old-document results while a fresh document remains editable (${windowed})`, async () => {
    const base = provider()
    let resume!: () => void,
      calls = 0
    const waiting = new Promise<void>((resolve) => (resume = resolve))
    const config: DocumentPresentationConfig = {
      provide: async (window, options) => {
        const count = ++calls
        if (count === 1) await waiting
        const response = await base.provide(window, options)
        return {
          ...response,
          result: {
            ...response.result,
            fragments: response.result.fragments.map((fragment) => ({
              ...fragment,
              content: { type: 'text' as const, text: count === 1 ? 'stale' : 'fresh' },
            })),
          },
        }
      },
    }
    const view = await make('live', config)
    const doc = new MemoryTextDocument('$c/d$ new document')
    if (view instanceof SourceDocumentView) {
      view.updateSource(new MemoryDocumentSource({ documentId: 'next', document: doc }))
      await view.revealSelection(1, Selection.cursor(doc.length))
    } else view.updateState(new EditorState({ doc, selection: Selection.cursor(doc.length) }))
    await settle()
    resume()
    await settle()
    expect(view.contentDOM.querySelector('[data-document-presentation]')?.textContent).toBe('fresh')
    expect(view.contentDOM.textContent).not.toContain('stale')
  })
  it(`discards an asynchronous result after disable (${windowed})`, async () => {
    let release!: () => void
    const wait = new Promise<void>((resolve) => (release = resolve))
    const base = provider()
    let signal: AbortSignal | undefined
    const view = await make('live', {
      provide: async (window, options) => {
        signal = options.signal
        await wait
        return base.provide(window, options)
      },
    })
    view.setDocumentPresentation(undefined)
    release()
    await settle()
    expect(signal?.aborted).toBe(true)
    expect(view.contentDOM.querySelector('math')).toBeNull()
  })
}

it('constructs inert SVG and maps only validated MathML attribute names', () => {
  const svg = createDocumentPresentationNode(document, {
    type: 'vector',
    width: 100,
    height: 100,
    children: [{ type: 'line', x1: 0, y1: 0, x2: 80, y2: 80, stroke: 'foreground' }],
  }) as Element
  expect(svg.namespaceURI).toBe('http://www.w3.org/2000/svg')
  const math = createDocumentPresentationNode(document, {
    type: 'math',
    tree: { tag: 'math', children: [{ tag: 'mspace', attributes: { widthEm: 0.5 } }] },
  }) as Element
  expect(math.querySelector('mspace')?.getAttribute('width')).toBe('0.5em')
  expect(() =>
    createDocumentPresentationNode(document, {
      type: 'math',
      tree: { tag: 'script', text: 'alert(1)' },
    } as never),
  ).toThrow()
  expect(() =>
    createDocumentPresentationNode(document, {
      type: 'vector',
      width: 100,
      height: 100,
      children: [{ type: 'image', href: 'https://example.test/image' }],
    } as never),
  ).toThrow()
})

it('checks the host navigation lease after asynchronous viewport loading', async () => {
  const view = new SourceDocumentView({
    parent: document.createElement('main'),
    source: new MemoryDocumentSource({ documentId: 'nav', text: 'first\ntarget' }),
  })
  views.push(view)
  await view.renderVisibleWindow()
  let resume!: () => void
  vi.spyOn(view, 'scrollToLine').mockImplementation(
    () => new Promise<void>((resolve) => (resume = resolve)),
  )
  const controller = new AbortController()
  const pending = view.revealSelection(2, Selection.cursor(6), { signal: controller.signal })
  controller.abort()
  resume()
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  expect(view.selection.main.head).toBe(0)
})

it('checks the host navigation assertion before changing selection', async () => {
  const view = new SourceDocumentView({
    parent: document.createElement('main'),
    source: new MemoryDocumentSource({ documentId: 'nav', text: 'first\ntarget' }),
  })
  views.push(view)
  await view.renderVisibleWindow()
  let resume!: () => void,
    current = true
  vi.spyOn(view, 'scrollToLine').mockImplementation(
    () => new Promise<void>((resolve) => (resume = resolve)),
  )
  const pending = view.revealSelection(2, Selection.cursor(6), {
    assertCurrent: () => {
      if (!current) throw new Error('stale lease')
    },
  })
  current = false
  resume()
  await expect(pending).rejects.toThrow('stale lease')
  expect(view.selection.main.head).toBe(0)
})

it('measures collapsed block continuation lines as zero and restores their heights', async () => {
  const rect = vi
    .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
    .mockImplementation(function (this: HTMLElement) {
      const height = this.classList.contains('milkup-line')
        ? this.dataset.presentationCollapsed === 'true'
          ? 0
          : this.querySelector('math')
            ? 80
            : 21
        : 500
      return {
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: 800,
        bottom: height,
        width: 800,
        height,
        toJSON: () => ({}),
      } as DOMRect
    })
  try {
    const base = provider(0, 9)
    const config: DocumentPresentationConfig = {
      provide: async (window, options) => {
        const response = await base.provide(window, options)
        return {
          ...response,
          result: {
            ...response.result,
            fragments: response.result.fragments.map((fragment) => ({
              ...fragment,
              layout: 'block' as const,
            })),
          },
        }
      },
    }
    const view = new SourceDocumentView({
      parent: document.createElement('main'),
      mode: 'live',
      source: new MemoryDocumentSource({ documentId: 'heights', text: '$$\na+b\n$$\ntail' }),
      documentPresentation: config,
    })
    views.push(view)
    await view.revealSelection(4, Selection.cursor(14))
    await settle()
    await view.scrollToLine(4)
    expect(view.dom.scrollTop).toBe(80)
    view.setDocumentPresentation(undefined)
    await view.scrollToLine(4)
    expect(view.dom.scrollTop).toBe(63)
  } finally {
    rect.mockRestore()
  }
})

it('allows bounded host snapshot preparation beyond the renderer worker deadline', async () => {
  vi.useFakeTimers()
  try {
    const doc = new MemoryTextDocument('$a/b$ tail'),
      base = provider()
    const view = new EditorView({
      parent: document.createElement('main'),
      mode: 'live',
      state: new EditorState({ doc, selection: Selection.cursor(doc.length) }),
      documentPresentation: {
        provide: async (window, options) => {
          await new Promise((resolve) => setTimeout(resolve, 3000))
          return base.provide(window, options)
        },
      },
    })
    views.push(view)
    await vi.advanceTimersByTimeAsync(3001)
    expect(view.contentDOM.querySelector('math')).not.toBeNull()
  } finally {
    vi.useRealTimers()
  }
})

it('cancels a slow host preparation without waiting for its deadline', async () => {
  vi.useFakeTimers()
  try {
    const doc = new MemoryTextDocument('$a/b$ tail'),
      base = provider()
    let signal: AbortSignal | undefined
    const view = new EditorView({
      parent: document.createElement('main'),
      mode: 'live',
      state: new EditorState({ doc, selection: Selection.cursor(doc.length) }),
      documentPresentation: {
        provide: async (window, options) => {
          signal = options.signal
          await new Promise((resolve) => setTimeout(resolve, 3000))
          return base.provide(window, options)
        },
      },
    })
    views.push(view)
    await vi.advanceTimersByTimeAsync(1000)
    view.setDocumentPresentation(undefined)
    expect(signal?.aborted).toBe(true)
    await vi.advanceTimersByTimeAsync(3000)
    expect(view.contentDOM.querySelector('math')).toBeNull()
  } finally {
    vi.useRealTimers()
  }
})

it('rejects a completed job if selection changed before the next synchronization', async () => {
  const { DocumentPresentation } = await import('../document-presentation')
  const root = document.createElement('div'),
    content = document.createElement('div'),
    line = document.createElement('div')
  line.className = 'milkup-line'
  line.dataset.line = '1'
  line.dataset.from = '0'
  line.dataset.to = '10'
  line.textContent = '$a/b$ tail'
  content.append(line)
  root.append(content)
  const identity = {},
    base = provider()
  let selection = { anchor: 10, head: 10 },
    resume!: () => void
  const waiting = new Promise<void>((resolve) => (resume = resolve))
  const manager = new DocumentPresentation(
    root,
    content,
    {
      provide: async (window, options) => {
        await waiting
        return base.provide(window, options)
      },
    },
    () => ({
      mode: 'live',
      sourceIdentity: identity,
      sourceVersion: 0,
      selection,
      lineCount: 1,
      read: () => '$a/b$ tail',
    }),
    () => {},
    () => {},
  )
  try {
    manager.schedule()
    await settle()
    selection = { anchor: 9, head: 9 }
    resume()
    await settle()
    expect(content.querySelector('math')).toBeNull()
  } finally {
    manager.destroy()
  }
})

it.each(['visible', 'scrolled-away', 'source'] as const)(
  'preserves the correct viewport anchor during preview growth (%s)',
  async (scenario) => {
    const { DocumentPresentation } = await import('../document-presentation')
    const root = document.createElement('div'),
      content = document.createElement('div')
    root.append(content)
    document.body.append(root)
    const source = 'top\n$a/b$\nmarker'
    const lines = [
      [0, 3],
      [4, 9],
      [10, 16],
    ].map(([from, to], index) => {
      const line = document.createElement('div')
      line.className = 'milkup-line'
      Object.assign(line.dataset, { line: String(index + 1), from: String(from), to: String(to) })
      const span = document.createElement('span')
      Object.assign(span.dataset, { from: String(from), to: String(to) })
      span.textContent = source.slice(from, to)
      line.append(span)
      content.append(line)
      return line
    })
    const box = (top: number, height: number) =>
      ({
        x: 0,
        y: top,
        top,
        bottom: top + height,
        left: 0,
        right: 800,
        width: 800,
        height,
        toJSON: () => ({}),
      }) as DOMRect
    vi.spyOn(root, 'getBoundingClientRect').mockImplementation(() => box(0, 100))
    lines.forEach((line, index) =>
      vi
        .spyOn(line, 'getBoundingClientRect')
        .mockImplementation(() =>
          box(
            (index === 2
              ? (scenario === 'scrolled-away' ? 121 : 42) +
                (content.querySelector('math') ? 179 : 0)
              : index * 21) - root.scrollTop,
            21,
          ),
        ),
    )
    const identity = {},
      base = provider(4, 9)
    const manager = new DocumentPresentation(
      root,
      content,
      base,
      () => ({
        mode: scenario === 'source' ? 'source' : 'live',
        sourceIdentity: identity,
        sourceVersion: 0,
        selection: { anchor: 10, head: 16 },
        lineCount: 3,
        read: (from, to) => source.slice(from, to),
      }),
      () => {},
      () => {},
    )
    try {
      manager.schedule()
      await settle()
      expect(Boolean(content.querySelector('math'))).toBe(scenario !== 'source')
      expect(lines[2]!.getBoundingClientRect().top).toBe(scenario === 'scrolled-away' ? 300 : 42)
      expect(root.scrollTop).toBe(scenario === 'visible' ? 179 : 0)
      manager.setConfig(undefined)
      expect(lines[2]!.getBoundingClientRect().top).toBe(scenario === 'scrolled-away' ? 121 : 42)
      expect(root.scrollTop).toBe(0)
    } finally {
      manager.destroy()
    }
  },
)

it.each(['block', 'reference'] as const)(
  'preserves %s focus across a viewport job without stealing a later external focus',
  async (kind) => {
    const { DocumentPresentation } = await import('../document-presentation')
    const root = document.createElement('div'),
      content = document.createElement('div'),
      line = document.createElement('div'),
      external = document.createElement('button')
    line.className = 'milkup-line'
    Object.assign(line.dataset, { line: '1', from: '0', to: '10' })
    line.textContent = '$a/b$ tail'
    content.append(line)
    root.append(content)
    document.body.append(root, external)
    let width = 800,
      resume: (() => void) | undefined
    Object.defineProperty(content, 'clientWidth', { get: () => width })
    const identity = {},
      base = provider(),
      navigate = vi.fn()
    const manager = new DocumentPresentation(
      root,
      content,
      {
        onNavigate: navigate,
        provide: async (window, options) => {
          if (width !== 800)
            await new Promise<void>((resolve) => {
              resume = resolve
            })
          if (width === 550) throw new Error('renderer failed')
          const response = await base.provide(window, options)
          return {
            ...response,
            result: {
              ...response.result,
              fragments: response.result.fragments.map((fragment) => ({
                ...fragment,
                layout: kind === 'block' ? ('block' as const) : ('inline' as const),
                ...(kind === 'reference'
                  ? {
                      content: {
                        type: 'reference' as const,
                        label: 'Jump',
                        target: { documentId: 'test', version: 0, from: 6, to: 10 },
                      },
                    }
                  : {}),
              })),
            },
          }
        },
      },
      () => ({
        mode: 'live',
        sourceIdentity: identity,
        sourceVersion: 0,
        selection: { anchor: 10, head: 10 },
        lineCount: 1,
        read: (from, to) => '$a/b$ tail'.slice(from, to),
      }),
      () => {},
      () => {},
    )
    const selector =
      kind === 'block' ? '[data-document-presentation]' : '.milkup-document-reference'
    try {
      manager.schedule()
      await settle()
      let focused = content.querySelector<HTMLElement>(selector)!
      focused.focus()
      width = 700
      manager.schedule()
      await settle()
      expect(focused.isConnected).toBe(true)
      expect(document.activeElement).toBe(focused)
      if (kind === 'reference') {
        focused.click()
        expect(navigate).toHaveBeenCalledTimes(1)
      }
      resume!()
      await settle()
      focused = content.querySelector<HTMLElement>(selector)!
      expect(document.activeElement).toBe(focused)
      width = 600
      manager.schedule()
      await settle()
      external.focus()
      resume!()
      await settle()
      expect(document.activeElement).toBe(external)
      width = 550
      manager.schedule()
      await settle()
      expect(content.querySelector(selector)).not.toBeNull()
      resume!()
      await settle()
      expect(content.querySelector(selector)).toBeNull()
      expect(root.querySelector('[role="status"]')?.textContent).toContain('预览不可用')
      width = 800
      manager.invalidate()
      await settle()
      content.querySelector<HTMLElement>(selector)!.focus()
      width = 500
      manager.schedule()
      await settle()
      manager.setConfig(undefined)
      resume!()
      await settle()
      expect(content.querySelector(selector)).toBeNull()
      expect(document.activeElement).not.toBe(focused)
    } finally {
      manager.destroy()
    }
  },
)

it.each(['block', 'reference'] as const)(
  'retains validated %s during background refresh and clears failed or revoked results',
  async (kind) => {
    const { DocumentPresentation } = await import('../document-presentation')
    const root = document.createElement('div'),
      content = document.createElement('div'),
      line = document.createElement('div'),
      external = document.createElement('button')
    line.className = 'milkup-line'
    Object.assign(line.dataset, { line: '1', from: '0', to: '10' })
    line.textContent = '$a/b$ tail'
    content.append(line)
    root.append(content)
    document.body.append(root, external)
    const identity = {},
      base = provider(),
      navigate = vi.fn(),
      layout = vi.fn()
    let delayed = false,
      failed = false,
      resume!: () => void,
      version = 0,
      selection = { anchor: 10, head: 10 }
    const config: DocumentPresentationConfig = {
      onNavigate: navigate,
      provide: async (window, options) => {
        if (delayed)
          await new Promise<void>((resolve) => {
            resume = resolve
          })
        if (failed) throw new Error('unavailable')
        const response = await base.provide(window, options)
        return {
          ...response,
          result: {
            ...response.result,
            fragments: response.result.fragments.map((fragment) => ({
              ...fragment,
              layout: kind === 'block' ? ('block' as const) : ('inline' as const),
              ...(kind === 'reference'
                ? {
                    content: {
                      type: 'reference' as const,
                      label: 'Jump',
                      target: { documentId: 'test', version: 0, from: 6, to: 10 },
                    },
                  }
                : {}),
            })),
          },
        }
      },
    }
    const manager = new DocumentPresentation(
      root,
      content,
      config,
      () => ({
        mode: 'live',
        sourceIdentity: identity,
        sourceVersion: version,
        selection,
        lineCount: 1,
        read: (from, to) => '$a/b$ tail'.slice(from, to),
      }),
      layout,
      () => {},
    )
    const selector =
      kind === 'block' ? '[data-document-presentation]' : '.milkup-document-reference'
    try {
      manager.schedule()
      await settle()
      const original = content.querySelector<HTMLElement>(selector)!
      original.focus()
      delayed = true
      layout.mockClear()
      manager.refresh()
      await settle()
      expect(original.isConnected).toBe(true)
      expect(document.activeElement).toBe(original)
      expect(layout).not.toHaveBeenCalled()
      if (kind === 'reference') {
        original.click()
        expect(navigate).toHaveBeenCalledTimes(1)
      }
      external.focus()
      resume()
      await settle()
      expect(document.activeElement).toBe(external)
      failed = true
      manager.refresh()
      await settle()
      expect(content.querySelector(selector)).not.toBeNull()
      resume()
      await settle()
      expect(content.querySelector(selector)).toBeNull()
      expect(root.querySelector('[role="status"]')?.textContent).toContain('预览不可用')
      failed = false
      delayed = false
      manager.refresh()
      await settle()
      expect(content.querySelector(selector)).not.toBeNull()
      delayed = true
      manager.refresh()
      await settle()
      manager.setConfig(undefined)
      resume()
      await settle()
      expect(content.querySelector(selector)).toBeNull()
      delayed = false
      manager.setConfig(config)
      await settle()
      version++
      manager.refresh()
      expect(content.querySelector(selector)).toBeNull()
      await settle()
      selection = { anchor: 2, head: 2 }
      manager.refresh()
      expect(content.querySelector(selector)).toBeNull()
    } finally {
      manager.destroy()
    }
  },
)

it.each([
  'selected-line',
  'reader-position',
  'new-document',
  'new-version',
  'source-mode',
  'missing-line',
] as const)(
  'preserves the pre-replacement %s anchor when a window reinstalls source DOM',
  async (scenario) => {
    const { DocumentPresentation } = await import('../document-presentation')
    const root = document.createElement('div')
    const content = document.createElement('div')
    root.append(content)
    document.body.append(root)
    const source = ['top', '$a/b$', 'marker', ...Array<string>(21).fill('tail')].join('\n')
    const box = (top: number, height: number) =>
      ({
        x: 0,
        y: top,
        top,
        bottom: top + height,
        left: 0,
        right: 800,
        width: 800,
        height,
        toJSON: () => ({}),
      }) as DOMRect
    vi.spyOn(root, 'getBoundingClientRect').mockImplementation(() => box(0, 100))
    const makeLines = () => {
      let from = 0
      return source.split('\n').map((text, index) => {
        const line = document.createElement('div')
        line.className = 'milkup-line'
        Object.assign(line.dataset, {
          line: String(index + 1),
          from: String(from),
          to: String(from + text.length),
        })
        const span = document.createElement('span')
        Object.assign(span.dataset, { from: String(from), to: String(from + text.length) })
        span.textContent = text
        line.append(span)
        from += text.length + 1
        vi.spyOn(line, 'getBoundingClientRect').mockImplementation(() => {
          const expanded = Boolean(content.querySelector('math'))
          return box(
            index * 21 + (index > 1 && expanded ? 179 : 0) - root.scrollTop,
            index === 1 && expanded ? 200 : 21,
          )
        })
        return line
      })
    }
    content.replaceChildren(...makeLines())
    let identity = {},
      version = 0,
      mode: 'live' | 'source' = 'live'
    const manager = new DocumentPresentation(
      root,
      content,
      provider(4, 9),
      () => ({
        mode,
        sourceIdentity: identity,
        sourceVersion: version,
        selection: { anchor: 10, head: 16 },
        lineCount: 24,
        read: (from, to) => source.slice(from, to),
      }),
      () => {},
      () => {},
    )
    try {
      manager.schedule()
      await settle()
      expect(root.scrollTop).toBe(179)
      if (scenario === 'reader-position') root.scrollTop = 400
      const anchor =
        scenario !== 'reader-position'
          ? content.querySelector<HTMLElement>('[data-line="3"]')!
          : (Array.from(content.children).find(
              (line) => line.getBoundingClientRect().bottom > 0,
            ) as HTMLElement)
      const number = anchor.dataset.line!
      const top = anchor.getBoundingClientRect().top
      const selectionTop = content.querySelector('[data-line="3"]')!.getBoundingClientRect().top
      // This is SourceDocumentView's ordering: replace literal lines, then render selection.
      // No preview has focus; the user is editing or reading the source-backed viewport.
      const scrollTop = root.scrollTop
      const external = document.createElement('button')
      document.body.append(external)
      external.focus()
      manager.updateContent(() => {
        if (scenario === 'new-document') identity = {}
        if (scenario === 'new-version') version++
        if (scenario === 'source-mode') mode = 'source'
        const lines = makeLines()
        content.replaceChildren(...(scenario === 'missing-line' ? lines.slice(-1) : lines))
      })
      manager.selectionChanged()
      if (scenario === 'selected-line' || scenario === 'reader-position') {
        expect(content.querySelector(`[data-line="${number}"]`)!.getBoundingClientRect().top).toBe(
          top,
        )
        expect(content.querySelector('[data-line="3"]')!.getBoundingClientRect().top).toBe(
          selectionTop,
        )
        expect(content.querySelector('math')).not.toBeNull()
      } else {
        expect(root.scrollTop).toBe(scrollTop)
        expect(content.querySelector('math')).toBeNull()
      }
      expect(document.activeElement).toBe(external)
    } finally {
      manager.destroy()
    }
  },
)

it('publishes the source window range before measuring replacement preview lines', async () => {
  const parent = document.createElement('main')
  document.body.append(parent)
  const base = provider()
  const view = new SourceDocumentView({
    parent,
    mode: 'live',
    source: new MemoryDocumentSource({
      documentId: 'window-metadata',
      text: ['$a/b$', ...Array<string>(99).fill('tail')].join('\n'),
    }),
    virtualViewport: { enabled: true, viewportHeight: 84, overscanLines: 2 },
    documentPresentation: {
      provide: async (window, options) => {
        const response = await base.provide(window, options)
        return {
          ...response,
          result: {
            ...response.result,
            fragments: response.result.fragments.filter(
              (fragment) => fragment.from >= window.from && fragment.to <= window.to,
            ),
          },
        }
      },
    },
  })
  views.push(view)
  await settle()
  const mismatches: { declared: string; actual: string }[] = []
  const measure = HTMLElement.prototype.getBoundingClientRect
  const spy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement,
  ) {
    if (this.classList.contains('milkup-line') && this.parentElement === view.contentDOM) {
      const lines = Array.from(view.contentDOM.children).filter((line) =>
        line.classList.contains('milkup-line'),
      ) as HTMLElement[]
      const declared = `${view.contentDOM.dataset.fromLine}:${view.contentDOM.dataset.toLine}`
      const actual = `${lines[0]?.dataset.line}:${lines.at(-1)?.dataset.line}`
      if (declared !== actual) mismatches.push({ declared, actual })
    }
    return measure.call(this)
  })
  try {
    await view.scrollToLine(50)
    await settle()
    expect(view.contentDOM.dataset.fromLine).toBe('48')
    expect(mismatches.slice(0, 3)).toEqual([])
    expect(view.source.version).toBe(0)
  } finally {
    spy.mockRestore()
  }
})

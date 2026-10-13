import {
  MemoryDocumentSource,
  MemoryTextDocument,
  Selection,
  type DocumentLineWindow,
} from '@milkup/core'
import { describe, expect, it, vi } from 'vitest'

import { SourceDocumentView } from '../index'

function createLineFixture(lineCount: number): string {
  return Array.from({ length: lineCount }, (_value, index) => `line ${index + 1}`).join('\n')
}

function createClipboardEvent(
  type: 'copy' | 'cut' | 'paste',
  text = '',
): {
  readonly event: Event
  readonly read: () => string
} {
  let written = ''
  const event = new Event(type, { bubbles: true, cancelable: true })

  Object.defineProperty(event, 'clipboardData', {
    value: {
      getData: () => text,
      setData: (_type: string, value: string) => {
        written = value
      },
    },
  })

  return { event, read: () => written }
}

describe('SourceDocumentView', () => {
  it.each(['source', 'live'] as const)(
    'restores the %s caret after a save lock rerenders the window',
    async (mode) => {
      const parent = document.createElement('main')
      const view = new SourceDocumentView({
        parent,
        mode,
        editable: true,
        source: new MemoryDocumentSource({ documentId: 'save-caret', text: '- 中文😀\r\nnext' }),
      })
      await view.renderVisibleWindow()
      await view.revealSelection(1, Selection.range(6, 2))
      view.setEditable(false)
      await view.renderVisibleWindow()
      expect(parent.querySelector('.milkup-cursor')).toBeNull()

      view.setEditable(true)
      expect(view.inputDOM.readOnly).toBe(false)
      expect(view.selection.main.anchor).toBe(6)
      expect(view.selection.main.head).toBe(2)
      expect(parent.querySelector<HTMLElement>('.milkup-cursor')?.dataset.position).toBe('2')
      view.destroy()
    },
  )

  it('renders an async document source as a bounded line window', async () => {
    const parent = document.createElement('main')
    const source = new MemoryDocumentSource({
      documentId: 'source-doc',
      text: createLineFixture(1_000),
    })
    const view = new SourceDocumentView({
      parent,
      source,
      virtualViewport: {
        enabled: true,
        lineHeight: 20,
        viewportHeight: 100,
        overscanLines: 2,
      },
    })

    await view.renderVisibleWindow()

    const lines = Array.from(view.contentDOM.querySelectorAll<HTMLElement>('.milkup-line'))

    expect(parent.querySelector('.milkup-source-document-view')).toBe(view.dom)
    expect(view.contentDOM.dataset.fromLine).toBe('1')
    expect(view.contentDOM.dataset.toLine).toBe('7')
    expect(lines).toHaveLength(7)
    expect(lines[0]?.textContent).toBe('line 1')
    expect(view.contentDOM.querySelector<HTMLElement>('[data-spacer="bottom"]')?.style.height).toBe(
      '19860px',
    )
  })

  it('refreshes the source line window on scroll without rendering offscreen lines', async () => {
    const parent = document.createElement('main')
    const view = new SourceDocumentView({
      parent,
      source: new MemoryDocumentSource({
        documentId: 'source-doc',
        text: createLineFixture(1_000),
      }),
      virtualViewport: {
        enabled: true,
        lineHeight: 20,
        viewportHeight: 100,
        overscanLines: 1,
      },
    })

    await view.renderVisibleWindow()
    view.dom.scrollTop = 400
    view.dom.dispatchEvent(new Event('scroll'))
    await view.renderVisibleWindow()

    const lines = Array.from(view.contentDOM.querySelectorAll<HTMLElement>('.milkup-line'))

    expect(view.contentDOM.dataset.fromLine).toBe('20')
    expect(view.contentDOM.dataset.toLine).toBe('26')
    expect(lines).toHaveLength(7)
    expect(lines[0]?.dataset.line).toBe('20')
    expect(view.contentDOM.querySelector<HTMLElement>('.milkup-line[data-line="1"]')).toBeNull()
  })

  it('can swap to another source and resets the scroll window', async () => {
    const parent = document.createElement('main')
    const view = new SourceDocumentView({
      parent,
      source: new MemoryDocumentSource({
        documentId: 'source-a',
        text: createLineFixture(100),
      }),
      virtualViewport: {
        enabled: true,
        lineHeight: 20,
        viewportHeight: 100,
        overscanLines: 0,
      },
    })

    view.dom.scrollTop = 400
    view.updateSource(
      new MemoryDocumentSource({
        documentId: 'source-b',
        text: 'replacement\nsource',
      }),
    )
    await view.renderVisibleWindow()

    expect(view.dom.scrollTop).toBe(0)
    expect(view.contentDOM.dataset.fromLine).toBe('1')
    expect(view.contentDOM.querySelector<HTMLElement>('.milkup-line')?.textContent).toBe(
      'replacement',
    )
  })

  it('keeps scroll position when updating the same source document version', async () => {
    const parent = document.createElement('main')
    const view = new SourceDocumentView({
      parent,
      source: new MemoryDocumentSource({
        documentId: 'source-doc',
        text: createLineFixture(100),
      }),
      virtualViewport: {
        enabled: true,
        lineHeight: 20,
        viewportHeight: 100,
        overscanLines: 0,
      },
    })

    await view.renderVisibleWindow()
    view.dom.scrollTop = 400
    view.updateSource(
      new MemoryDocumentSource({
        documentId: 'source-doc',
        text: createLineFixture(100),
        version: 1,
      }),
    )
    await view.renderVisibleWindow()

    expect(view.dom.scrollTop).toBe(400)
    expect(view.contentDOM.dataset.fromLine).toBe('21')
  })

  it('scrolls directly to a requested line window', async () => {
    const parent = document.createElement('main')
    const view = new SourceDocumentView({
      parent,
      source: new MemoryDocumentSource({
        documentId: 'source-doc',
        text: createLineFixture(1_000),
      }),
      virtualViewport: {
        enabled: true,
        lineHeight: 20,
        viewportHeight: 100,
        overscanLines: 1,
      },
    })

    await view.scrollToLine(500)

    expect(view.dom.scrollTop).toBe(9980)
    expect(view.contentDOM.dataset.fromLine).toBe('499')
    expect(view.contentDOM.dataset.toLine).toBe('505')
    expect(view.contentDOM.querySelector<HTMLElement>('.milkup-line')?.dataset.line).toBe('499')
  })

  it('renders the requested line even when the browser clamps a huge scroll offset', async () => {
    const parent = document.createElement('main')
    const view = new SourceDocumentView({
      parent,
      source: new MemoryDocumentSource({
        documentId: 'source-doc',
        text: createLineFixture(1_000),
      }),
      virtualViewport: {
        enabled: true,
        lineHeight: 20,
        viewportHeight: 100,
        overscanLines: 1,
      },
    })
    let clampedScrollTop = 0
    Object.defineProperty(view.dom, 'scrollTop', {
      configurable: true,
      get: () => clampedScrollTop,
      set: (value: number) => {
        clampedScrollTop = Math.min(value, 1_000)
      },
    })

    await view.scrollToLine(900)

    expect(view.dom.scrollTop).toBe(1_000)
    expect(view.contentDOM.dataset.fromLine).toBe('899')
    expect(view.contentDOM.querySelector('.milkup-line[data-line="900"]')).not.toBeNull()
  })

  it('renders search highlights and marks the active result', async () => {
    const parent = document.createElement('main')
    const view = new SourceDocumentView({
      parent,
      source: new MemoryDocumentSource({
        documentId: 'source-doc',
        text: ['alpha', 'target', 'tail'].join('\n'),
      }),
      virtualViewport: {
        enabled: true,
        lineHeight: 20,
        viewportHeight: 60,
        overscanLines: 0,
      },
    })

    await view.renderVisibleWindow()
    view.setSearchHighlights([{ from: 6, to: 12, line: 2 }], 0)

    const highlight = view.searchLayerDOM.querySelector<HTMLElement>('.milkup-search-highlight')
    expect(highlight?.dataset.from).toBe('6')
    expect(highlight?.classList.contains('is-active')).toBe(true)
  })

  it('renders live mode from a padded markdown line window without offscreen DOM', async () => {
    const parent = document.createElement('main')
    const source = new RecordingDocumentSource({
      documentId: 'source-doc',
      text: ['intro', '# Heading', '', '- item', 'tail'].join('\n'),
    })
    const view = new SourceDocumentView({
      parent,
      source,
      mode: 'live',
      markdownContextLines: 1,
      virtualViewport: {
        enabled: true,
        lineHeight: 20,
        viewportHeight: 40,
        overscanLines: 0,
      },
    })

    view.dom.scrollTop = 20
    await view.renderVisibleWindow()

    const lines = Array.from(view.contentDOM.querySelectorAll<HTMLElement>('.milkup-line'))

    expect(source.requests.at(-1)).toEqual({ fromLine: 1, toLine: 4 })
    expect(view.contentDOM.dataset.renderMode).toBe('live')
    expect(view.contentDOM.dataset.fromLine).toBe('2')
    expect(view.contentDOM.dataset.toLine).toBe('3')
    expect(lines.map((line) => line.dataset.line)).toEqual(['2', '3'])
    expect(lines[0]?.classList.contains('milkup-block-heading')).toBe(true)
    expect(lines[0]?.querySelector('.milkup-heading-marker')).not.toBeNull()
    expect(view.contentDOM.querySelector<HTMLElement>('.milkup-line[data-line="1"]')).toBeNull()
  })

  it('maps live-mode clicks through visible source spans before editing', async () => {
    const parent = document.createElement('main')
    const onEdit = vi.fn()
    const view = new SourceDocumentView({
      parent,
      source: new MemoryDocumentSource({
        documentId: 'source-doc',
        text: '# Title',
      }),
      mode: 'live',
      editable: true,
      onEdit,
      markdownContextLines: 0,
      virtualViewport: {
        enabled: true,
        lineHeight: 20,
        viewportHeight: 40,
        overscanLines: 0,
      },
    })

    await view.renderVisibleWindow()
    const content = view.contentDOM.querySelector<HTMLElement>('.milkup-heading-content')

    expect(content).not.toBeNull()

    content!.getBoundingClientRect = () =>
      ({ left: 0, top: 0, right: 50, bottom: 20, width: 50, height: 20 }) as DOMRect
    content!.dispatchEvent(
      new MouseEvent('pointerdown', { bubbles: true, clientX: 20, clientY: 10 }),
    )
    view.inputDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'x', bubbles: true }))
    await flushPromises()

    expect(view.dom.querySelector<HTMLElement>('.milkup-cursor')?.dataset.position).toBe('5')
    expect(onEdit).not.toHaveBeenCalled()
    await delay(40)
    expect(onEdit).toHaveBeenCalledWith(
      expect.objectContaining({ from: 4, to: 4, insert: 'x', deletedText: '' }),
    )
  })

  it('positions the source cursor from the rendered line box instead of guessed line number', async () => {
    const parent = document.createElement('main')
    const view = new SourceDocumentView({
      parent,
      source: new MemoryDocumentSource({
        documentId: 'source-doc',
        text: createLineFixture(20),
      }),
      editable: true,
      virtualViewport: {
        enabled: true,
        lineHeight: 20,
        viewportHeight: 40,
        overscanLines: 0,
      },
    })

    await view.renderVisibleWindow()
    const line = view.contentDOM.querySelector<HTMLElement>('.milkup-line[data-line="2"]')

    expect(line).not.toBeNull()

    Object.defineProperty(line!, 'offsetTop', { configurable: true, value: 123 })
    line!.getBoundingClientRect = () =>
      ({ left: 0, top: 123, right: 60, bottom: 143, width: 60, height: 20 }) as DOMRect
    line!.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: 0, clientY: 130 }))

    expect(view.dom.querySelector<HTMLElement>('.milkup-cursor')?.style.top).toBe('123px')
  })

  it('moves the source cursor with arrow keys without editing', async () => {
    const parent = document.createElement('main')
    const onEdit = vi.fn()
    const view = new SourceDocumentView({
      parent,
      source: new MemoryDocumentSource({
        documentId: 'source-doc',
        text: ['alpha', 'beta'].join('\n'),
      }),
      editable: true,
      onEdit,
      virtualViewport: {
        enabled: true,
        lineHeight: 20,
        viewportHeight: 40,
        overscanLines: 0,
      },
    })

    await view.renderVisibleWindow()
    view.inputDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    await flushPromises()

    expect(view.dom.querySelector<HTMLElement>('.milkup-cursor')?.dataset.position).toBe('1')
    expect(onEdit).not.toHaveBeenCalled()
  })

  it('handles source cursor arrow keys from the focused root element', async () => {
    const parent = document.createElement('main')
    const view = new SourceDocumentView({
      parent,
      source: new MemoryDocumentSource({
        documentId: 'source-doc',
        text: 'alpha',
      }),
      editable: true,
      virtualViewport: {
        enabled: true,
        lineHeight: 20,
        viewportHeight: 40,
        overscanLines: 0,
      },
    })

    await view.renderVisibleWindow()
    view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    await flushPromises()

    expect(view.dom.querySelector<HTMLElement>('.milkup-cursor')?.dataset.position).toBe('1')
  })

  it('moves the source cursor vertically by preserving line offset', async () => {
    const parent = document.createElement('main')
    const view = new SourceDocumentView({
      parent,
      source: new MemoryDocumentSource({
        documentId: 'source-doc',
        text: ['alpha', 'beta'].join('\n'),
      }),
      editable: true,
      virtualViewport: {
        enabled: true,
        lineHeight: 20,
        viewportHeight: 40,
        overscanLines: 0,
      },
    })

    await view.renderVisibleWindow()
    view.inputDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    view.inputDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    await flushPromises()
    view.inputDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
    await flushPromises()

    expect(view.dom.querySelector<HTMLElement>('.milkup-cursor')?.dataset.position).toBe('8')
  })

  it('moves vertically from rendered lines when the source cannot resolve positions directly', async () => {
    const parent = document.createElement('main')
    const view = new SourceDocumentView({
      parent,
      source: new RenderedOnlyLineSource({
        documentId: 'source-doc',
        text: ['alpha', 'beta'].join('\n'),
      }),
      editable: true,
      virtualViewport: {
        enabled: true,
        lineHeight: 20,
        viewportHeight: 40,
        overscanLines: 0,
      },
    })

    await view.renderVisibleWindow()
    view.inputDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    view.inputDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    await flushPromises()
    view.inputDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
    await flushPromises()

    expect(view.dom.querySelector<HTMLElement>('.milkup-cursor')?.dataset.position).toBe('8')
  })

  it('uses measured line width when source cursor range measurement is unavailable', async () => {
    const parent = document.createElement('main')
    const view = new SourceDocumentView({
      parent,
      source: new MemoryDocumentSource({
        documentId: 'source-doc',
        text: 'abcdef',
      }),
      editable: true,
      virtualViewport: {
        enabled: true,
        lineHeight: 20,
        viewportHeight: 40,
        overscanLines: 0,
      },
    })

    await view.renderVisibleWindow()
    const line = view.contentDOM.querySelector<HTMLElement>('.milkup-line[data-line="1"]')

    expect(line).not.toBeNull()

    line!.getBoundingClientRect = () =>
      ({ left: 0, top: 0, right: 72, bottom: 20, width: 72, height: 20 }) as DOMRect

    view.inputDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    view.inputDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    view.inputDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    await flushPromises()

    expect(view.dom.querySelector<HTMLElement>('.milkup-cursor')?.style.left).toBe('36px')
  })

  it('uses font-size instead of line-height for the source cursor height', async () => {
    const parent = document.createElement('main')
    const view = new SourceDocumentView({
      parent,
      source: new MemoryDocumentSource({
        documentId: 'source-doc',
        text: 'alpha',
      }),
      editable: true,
      virtualViewport: {
        enabled: true,
        lineHeight: 24,
        viewportHeight: 40,
        overscanLines: 0,
      },
    })

    await view.renderVisibleWindow()
    const line = view.contentDOM.querySelector<HTMLElement>('.milkup-line[data-line="1"]')

    expect(line).not.toBeNull()

    line!.style.fontSize = '14px'
    line!.style.lineHeight = '24px'
    line!.getBoundingClientRect = () =>
      ({ left: 0, top: 0, right: 50, bottom: 24, width: 50, height: 24 }) as DOMRect
    view.inputDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    await flushPromises()

    expect(view.dom.querySelector<HTMLElement>('.milkup-cursor')?.style.height).toBe('14px')
  })

  it('caches live markdown windows by document version and line range', async () => {
    const parent = document.createElement('main')
    const source = new RecordingDocumentSource({
      documentId: 'source-doc',
      text: ['# A', 'body', 'tail'].join('\n'),
    })
    const view = new SourceDocumentView({
      parent,
      source,
      mode: 'live',
      markdownContextLines: 0,
      virtualViewport: {
        enabled: true,
        lineHeight: 20,
        viewportHeight: 40,
        overscanLines: 0,
      },
    })

    await view.renderVisibleWindow()
    await view.renderVisibleWindow()

    expect(
      source.requests.filter((request) => request.fromLine === 1 && request.toLine === 2),
    ).toHaveLength(1)
  })

  it('shows live block syntax around the source cursor', async () => {
    const parent = document.createElement('main')
    const view = new SourceDocumentView({
      parent,
      source: new MemoryDocumentSource({
        documentId: 'source-doc',
        text: ['intro', '# A'].join('\n'),
      }),
      mode: 'live',
      editable: true,
      markdownContextLines: 0,
      virtualViewport: {
        enabled: true,
        lineHeight: 20,
        viewportHeight: 40,
        overscanLines: 0,
      },
    })

    await view.renderVisibleWindow()

    expect(
      view.contentDOM
        .querySelector<HTMLElement>('.milkup-heading-marker')
        ?.classList.contains('milkup-marker-hidden'),
    ).toBe(true)

    view.contentDOM
      .querySelector<HTMLElement>('.milkup-heading-content')
      ?.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: 0, clientY: 0 }))
    await flushPromises()

    expect(
      view.contentDOM
        .querySelector<HTMLElement>('.milkup-heading-marker')
        ?.classList.contains('milkup-marker-hidden'),
    ).toBe(false)
  })

  it('hides table pipes between rendered source cells', async () => {
    const parent = document.createElement('main')
    const view = new SourceDocumentView({
      parent,
      source: new MemoryDocumentSource({
        documentId: 'source-doc',
        text: '| Name || Status |\n| --- | --- | --- |\n| Milk || ok |',
      }),
      mode: 'live',
      markdownContextLines: 0,
      virtualViewport: {
        enabled: true,
        lineHeight: 20,
        viewportHeight: 80,
        overscanLines: 0,
      },
    })

    await view.renderVisibleWindow()

    const cells = Array.from(view.contentDOM.querySelectorAll<HTMLElement>('.milkup-table-cell'))
    const markers = Array.from(
      view.contentDOM.querySelectorAll<HTMLElement>('.milkup-table-marker'),
    )

    expect(cells.map((cell) => cell.textContent)).toEqual(['Name', '', 'Status', 'Milk', '', 'ok'])
    expect(markers.some((marker) => marker.textContent?.includes('|'))).toBe(true)
    expect(markers.every((marker) => marker.classList.contains('milkup-marker-hidden'))).toBe(true)
  })

  it('preserves native horizontal code-scrollbar dragging in the source view', async () => {
    const parent = document.createElement('main')
    const view = new SourceDocumentView({
      parent,
      source: new MemoryDocumentSource({
        documentId: 'source-doc',
        text: '```\nvery long code line\n```',
      }),
      mode: 'live',
      editable: true,
      markdownContextLines: 0,
      virtualViewport: {
        enabled: true,
        lineHeight: 20,
        viewportHeight: 80,
        overscanLines: 0,
      },
    })

    await view.renderVisibleWindow()
    const code = view.contentDOM.querySelector<HTMLElement>('.milkup-block-code')

    expect(code).not.toBeNull()
    Object.defineProperties(code!, {
      scrollWidth: { configurable: true, value: 200 },
      clientWidth: { configurable: true, value: 100 },
      offsetHeight: { configurable: true, value: 100 },
      clientHeight: { configurable: true, value: 85 },
    })
    code!.getBoundingClientRect = () =>
      ({ left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100 }) as DOMRect
    const event = new MouseEvent('pointerdown', {
      bubbles: true,
      cancelable: true,
      button: 0,
      clientX: 50,
      clientY: 95,
    })

    code!.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(false)
    expect(view.dom.querySelector<HTMLElement>('.milkup-cursor')?.dataset.position).toBe('0')
  })

  it('patches the edited visible source line without rereading the window', async () => {
    const parent = document.createElement('main')
    const source = new RecordingDocumentSource({
      documentId: 'source-doc',
      text: ['alpha', 'beta', 'gamma'].join('\n'),
    })
    const onEdit = vi.fn(async () => {
      source.updateText(['xalpha', 'beta', 'gamma'].join('\n'))
    })
    const view = new SourceDocumentView({
      parent,
      source,
      editable: true,
      onEdit,
      virtualViewport: {
        enabled: true,
        lineHeight: 20,
        viewportHeight: 60,
        overscanLines: 0,
      },
    })

    await view.renderVisibleWindow()
    source.requests.length = 0
    view.inputDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'x', bubbles: true }))
    await flushPromises()

    expect(source.requests).toEqual([])
    expect(
      view.contentDOM.querySelector<HTMLElement>('.milkup-line[data-line="1"]')?.textContent,
    ).toBe('xalpha')
  })

  it('warms markdown windows around the visible viewport without repeated source reads', async () => {
    const parent = document.createElement('main')
    const source = new RecordingDocumentSource({
      documentId: 'source-doc',
      text: createLineFixture(100),
    })
    const view = new SourceDocumentView({
      parent,
      source,
      markdownContextLines: 0,
      markdownWarmupWindows: 1,
      virtualViewport: {
        enabled: true,
        lineHeight: 20,
        viewportHeight: 40,
        overscanLines: 0,
      },
    })

    view.dom.scrollTop = 40
    await view.renderVisibleWindow()
    source.requests.length = 0

    await expect(view.warmMarkdownCacheAroundVisibleWindow()).resolves.toEqual([
      '1-2',
      '3-4',
      '5-6',
    ])
    await view.warmMarkdownCacheAroundVisibleWindow()

    expect(source.requests).toEqual([
      { fromLine: 1, toLine: 2 },
      { fromLine: 3, toLine: 4 },
      { fromLine: 5, toLine: 6 },
    ])
  })

  it('emits bounded visible edits when editable source mode receives keyboard input', async () => {
    const parent = document.createElement('main')
    const onEdit = vi.fn()
    const view = new SourceDocumentView({
      parent,
      source: new MemoryDocumentSource({
        documentId: 'source-doc',
        text: ['alpha', 'beta'].join('\n'),
      }),
      editable: true,
      onEdit,
      virtualViewport: {
        enabled: true,
        lineHeight: 20,
        viewportHeight: 40,
        overscanLines: 0,
      },
    })

    await view.renderVisibleWindow()
    view.inputDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'x', bubbles: true }))
    await flushPromises()

    expect(onEdit).not.toHaveBeenCalled()
    await delay(40)
    expect(onEdit).toHaveBeenCalledWith(
      expect.objectContaining({ from: 0, to: 0, insert: 'x', deletedText: '' }),
    )
  })

  it('continues list prefixes when editable source mode receives Enter', async () => {
    const parent = document.createElement('main')
    const onEdit = vi.fn()
    const view = new SourceDocumentView({
      parent,
      source: new MemoryDocumentSource({
        documentId: 'source-doc',
        text: ['- one', '2. two', '- [x] done'].join('\n'),
      }),
      editable: true,
      onEdit,
      virtualViewport: {
        enabled: true,
        lineHeight: 20,
        viewportHeight: 80,
        overscanLines: 0,
      },
    })

    await view.renderVisibleWindow()
    const firstLine = view.contentDOM.querySelector<HTMLElement>('.milkup-line[data-line="1"]')

    expect(firstLine).not.toBeNull()

    firstLine!.getBoundingClientRect = () =>
      ({ left: 0, top: 0, right: 80, bottom: 20, width: 80, height: 20 }) as DOMRect
    firstLine!.dispatchEvent(
      new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 80, clientY: 10 }),
    )
    view.inputDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await flushPromises()

    expect(view.contentDOM.querySelector('.milkup-line[data-line="2"]')?.textContent).toBe('- ')
    expect(onEdit).not.toHaveBeenCalled()

    await view.flushPendingEdits()

    expect(onEdit).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 5,
        to: 5,
        insert: '\n- ',
        deletedText: '',
        historyGroup: 'isolate',
      }),
    )
  })

  it('commits only finalized IME composition text', async () => {
    const parent = document.createElement('main')
    const onEdit = vi.fn()
    const view = new SourceDocumentView({
      parent,
      source: new MemoryDocumentSource({
        documentId: 'source-doc',
        text: 'alpha',
      }),
      editable: true,
      onEdit,
      virtualViewport: {
        enabled: true,
        lineHeight: 20,
        viewportHeight: 40,
        overscanLines: 0,
      },
    })

    await view.renderVisibleWindow()
    view.inputDOM.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
    view.inputDOM.value = 'ni'
    view.inputDOM.dispatchEvent(
      new CompositionEvent('compositionupdate', { bubbles: true, data: 'ni' }),
    )
    view.inputDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', bubbles: true }))
    view.inputDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'i', bubbles: true }))
    view.inputDOM.dispatchEvent(new InputEvent('input', { bubbles: true, data: 'ni' }))
    await flushPromises()

    expect(onEdit).not.toHaveBeenCalled()

    view.inputDOM.dispatchEvent(
      new CompositionEvent('compositionend', { bubbles: true, data: '你' }),
    )
    await view.flushPendingEdits()

    expect(onEdit).toHaveBeenCalledTimes(1)
    expect(onEdit).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 0,
        to: 0,
        insert: '你',
        deletedText: '',
        historyGroup: 'isolate',
      }),
    )
    expect(view.inputDOM.value).toBe('')
  })

  it('clears the IME placeholder before immediately handling enter and delete', async () => {
    const parent = document.createElement('main')
    const source = new RecordingDocumentSource({ documentId: 'large-source', text: 'alpha' })
    let text = 'alpha'
    const onEdit = vi.fn(
      async (edit: { readonly from: number; readonly to: number; readonly insert: string }) => {
        text = text.slice(0, edit.from) + edit.insert + text.slice(edit.to)
        source.updateText(text)
      },
    )
    const view = new SourceDocumentView({
      parent,
      source,
      editable: true,
      onEdit,
      virtualViewport: {
        enabled: true,
        lineHeight: 20,
        viewportHeight: 40,
        overscanLines: 0,
      },
    })

    await view.renderVisibleWindow()
    view.inputDOM.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
    view.inputDOM.value = 'zhong'
    view.inputDOM.dispatchEvent(
      new CompositionEvent('compositionupdate', { bubbles: true, data: 'zhong' }),
    )

    expect(view.cursorLayerDOM.querySelector<HTMLElement>('.milkup-composition')?.textContent).toBe(
      'zhong',
    )

    view.inputDOM.dispatchEvent(
      new CompositionEvent('compositionend', { bubbles: true, data: '中' }),
    )
    expect(view.cursorLayerDOM.querySelector('.milkup-composition')).toBeNull()

    view.inputDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    view.inputDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }))
    await view.flushPendingEdits()

    expect(onEdit).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        from: 0,
        to: 0,
        insert: '中',
        deletedText: '',
        historyGroup: 'isolate',
      }),
    )
    expect(onEdit).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        from: 1,
        to: 1,
        insert: '\n',
        deletedText: '',
        historyGroup: 'isolate',
      }),
    )
    expect(onEdit).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        from: 2,
        to: 3,
        insert: '',
        deletedText: 'a',
      }),
    )
    expect(text).toBe('中\nlpha')
  })

  it('does not let a stale composition flag block enter and delete', async () => {
    const parent = document.createElement('main')
    const source = new RecordingDocumentSource({ documentId: 'large-source', text: 'ab' })
    let text = 'ab'
    const onEdit = vi.fn(
      async (edit: { readonly from: number; readonly to: number; readonly insert: string }) => {
        text = text.slice(0, edit.from) + edit.insert + text.slice(edit.to)
        source.updateText(text)
      },
    )
    const view = new SourceDocumentView({
      parent,
      source,
      editable: true,
      onEdit,
      virtualViewport: {
        enabled: true,
        lineHeight: 20,
        viewportHeight: 40,
        overscanLines: 0,
      },
    })

    await view.renderVisibleWindow()
    view.inputDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    await flushPromises()
    view.inputDOM.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
    view.inputDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    view.inputDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }))
    await view.flushPendingEdits()

    expect(onEdit).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        from: 1,
        to: 1,
        insert: '\n',
        deletedText: '',
        historyGroup: 'isolate',
      }),
    )
    expect(onEdit).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        from: 2,
        to: 3,
        insert: '',
        deletedText: 'b',
      }),
    )
  })

  it('handles editing keys reported with the legacy IME key code', async () => {
    const parent = document.createElement('main')
    const source = new RecordingDocumentSource({ documentId: 'large-source', text: 'ab' })
    let text = 'ab'
    const onEdit = vi.fn(
      async (edit: { readonly from: number; readonly to: number; readonly insert: string }) => {
        text = text.slice(0, edit.from) + edit.insert + text.slice(edit.to)
        source.updateText(text)
      },
    )
    const view = new SourceDocumentView({ parent, source, editable: true, onEdit })
    const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })
    const remove = new KeyboardEvent('keydown', { key: 'Delete', bubbles: true })
    Object.defineProperty(enter, 'keyCode', { value: 229 })
    Object.defineProperty(remove, 'keyCode', { value: 229 })

    await view.renderVisibleWindow()
    view.inputDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    await flushPromises()
    view.inputDOM.dispatchEvent(enter)
    view.inputDOM.dispatchEvent(remove)
    await view.flushPendingEdits()

    expect(onEdit).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        from: 1,
        to: 1,
        insert: '\n',
        deletedText: '',
        historyGroup: 'isolate',
      }),
    )
    expect(onEdit).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        from: 2,
        to: 3,
        insert: '',
        deletedText: 'b',
      }),
    )
  })

  it('flushes pending source edits before save operations', async () => {
    const parent = document.createElement('main')
    const onEdit = vi.fn()
    const view = new SourceDocumentView({
      parent,
      source: new MemoryDocumentSource({
        documentId: 'source-doc',
        text: 'alpha',
      }),
      editable: true,
      onEdit,
      virtualViewport: {
        enabled: true,
        lineHeight: 20,
        viewportHeight: 40,
        overscanLines: 0,
      },
    })

    await view.renderVisibleWindow()
    view.inputDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'x', bubbles: true }))
    await flushPromises()

    expect(onEdit).not.toHaveBeenCalled()

    await view.flushPendingEdits()

    expect(onEdit).toHaveBeenCalledWith(
      expect.objectContaining({ from: 0, to: 0, insert: 'x', deletedText: '' }),
    )
  })

  it('does not block saving when a structural edit commits but its viewport refresh fails', async () => {
    const parent = document.createElement('main')
    const source = new FailingLineWindowSource({ documentId: 'large-source', text: 'alpha' })
    const onEdit = vi.fn(async () => undefined)
    const view = new SourceDocumentView({
      parent,
      source,
      editable: true,
      onEdit,
      virtualViewport: {
        enabled: true,
        lineHeight: 20,
        viewportHeight: 40,
        overscanLines: 0,
      },
    })

    await view.renderVisibleWindow()
    source.failReads = true
    view.inputDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))

    await expect(view.flushPendingEdits()).resolves.toBeUndefined()
    expect(onEdit).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 0,
        to: 0,
        insert: '\n',
        deletedText: '',
        historyGroup: 'isolate',
      }),
    )
  })

  it('keeps consecutive structural edits in separate native history commits', async () => {
    const parent = document.createElement('main')
    const source = new RecordingDocumentSource({ documentId: 'large-source', text: 'alpha' })
    let text = 'alpha'
    const onEdit = vi.fn(
      async (edit: { readonly from: number; readonly to: number; readonly insert: string }) => {
        text = text.slice(0, edit.from) + edit.insert + text.slice(edit.to)
        source.updateText(text)
      },
    )
    const view = new SourceDocumentView({
      parent,
      source,
      editable: true,
      onEdit,
      virtualViewport: {
        enabled: true,
        lineHeight: 20,
        viewportHeight: 40,
        overscanLines: 0,
      },
    })

    await view.renderVisibleWindow()
    view.inputDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    view.inputDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await view.flushPendingEdits()

    expect(onEdit).toHaveBeenCalledTimes(2)
    expect(onEdit).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        from: 0,
        to: 0,
        insert: '\n',
        deletedText: '',
        historyGroup: 'isolate',
      }),
    )
    expect(onEdit).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        from: 1,
        to: 1,
        insert: '\n',
        deletedText: '',
        historyGroup: 'isolate',
      }),
    )
    expect(text).toBe('\n\nalpha')
  })

  it('flush waits for every isolated batch even when the first commit is delayed', async () => {
    const source = new RecordingDocumentSource({ documentId: 'delayed', text: 'alpha' })
    let text = 'alpha'
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    let count = 0
    const onEdit = vi.fn(async (edit: { from: number; to: number; insert: string }) => {
      if (++count === 1) await gate
      text = text.slice(0, edit.from) + edit.insert + text.slice(edit.to)
      source.updateText(text)
    })
    const view = new SourceDocumentView({
      parent: document.createElement('main'),
      source,
      editable: true,
      onEdit,
    })
    await view.renderVisibleWindow()
    view.inputDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    view.inputDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    const completed = vi.fn()
    const flush = view.flushPendingEdits().then(completed)
    await flushPromises()
    expect(completed).not.toHaveBeenCalled()
    release()
    await flush
    expect(onEdit).toHaveBeenCalledTimes(2)
    expect(text).toBe('\n\nalpha')
    view.destroy()
  })

  it('flush rejects when a later isolated edit fails instead of reporting a successful save', async () => {
    const source = new RecordingDocumentSource({ documentId: 'failing', text: 'alpha' })
    let count = 0
    const view = new SourceDocumentView({
      parent: document.createElement('main'),
      source,
      editable: true,
      onEdit: async () => {
        if (++count === 2) throw new Error('second edit failed')
      },
    })
    await view.renderVisibleWindow()
    view.inputDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    view.inputDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await expect(view.flushPendingEdits()).rejects.toThrow('second edit failed')
    expect(count).toBe(2)
    view.destroy()
  })

  it('renders structural edits while the native commit is still pending', async () => {
    const parent = document.createElement('main')
    let releaseCommit: (() => void) | undefined
    const onEdit = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          releaseCommit = resolve
        }),
    )
    const view = new SourceDocumentView({
      parent,
      source: new MemoryDocumentSource({ documentId: 'large-source', text: 'alpha' }),
      editable: true,
      onEdit,
    })

    await view.renderVisibleWindow()
    view.inputDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await flushPromises()

    expect(view.contentDOM.querySelectorAll('.milkup-line')).toHaveLength(2)
    expect(view.cursorLayerDOM.querySelector('.milkup-cursor')?.getAttribute('data-position')).toBe(
      '1',
    )

    await delay(40)
    expect(onEdit).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 0,
        to: 0,
        insert: '\n',
        deletedText: '',
        historyGroup: 'isolate',
      }),
    )
    expect(view.contentDOM.querySelectorAll('.milkup-line')).toHaveLength(2)

    releaseCommit?.()
    await view.flushPendingEdits()
  })

  it('rolls back an optimistic structural edit when the native commit fails', async () => {
    const parent = document.createElement('main')
    const view = new SourceDocumentView({
      parent,
      source: new MemoryDocumentSource({ documentId: 'large-source', text: 'alpha' }),
      editable: true,
      onEdit: async () => {
        throw new Error('native edit failed')
      },
    })

    await view.renderVisibleWindow()
    view.inputDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await flushPromises()

    expect(view.contentDOM.querySelectorAll('.milkup-line')).toHaveLength(2)
    await expect(view.flushPendingEdits()).rejects.toThrow('native edit failed')
    await flushPromises()

    expect(view.contentDOM.querySelectorAll('.milkup-line')).toHaveLength(1)
    expect(view.contentDOM.querySelector('.milkup-line')?.textContent).toBe('alpha')
  })

  it('deletes a selected range inside the rendered source window', async () => {
    const parent = document.createElement('main')
    const onEdit = vi.fn()
    const view = new SourceDocumentView({
      parent,
      source: new MemoryDocumentSource({
        documentId: 'source-doc',
        text: ['alpha', 'beta'].join('\n'),
      }),
      editable: true,
      onEdit,
      virtualViewport: {
        enabled: true,
        lineHeight: 20,
        viewportHeight: 40,
        overscanLines: 0,
      },
    })

    await view.renderVisibleWindow()
    view.contentDOM
      .querySelector<HTMLElement>('.milkup-line[data-line="1"]')
      ?.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
    view.contentDOM
      .querySelector<HTMLElement>('.milkup-line[data-line="2"]')
      ?.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, shiftKey: true }))

    expect(view.dom.querySelector<HTMLElement>('.milkup-selection')).not.toBeNull()

    view.inputDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true }))
    await view.flushPendingEdits()

    expect(onEdit).toHaveBeenCalledWith(
      expect.objectContaining({ from: 0, to: 6, insert: '', deletedText: 'alpha\n' }),
    )
  })

  it('commits enter and delete keys when lineAtPosition is unavailable', async () => {
    const parent = document.createElement('main')
    const onEdit = vi.fn()
    const view = new SourceDocumentView({
      parent,
      source: new RenderedOnlyLineSource({ documentId: 'large-source', text: 'alpha\nbeta' }),
      editable: true,
      onEdit,
      virtualViewport: {
        enabled: true,
        lineHeight: 20,
        viewportHeight: 40,
        overscanLines: 0,
      },
    })

    await view.renderVisibleWindow()
    view.inputDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }))
    await view.flushPendingEdits()
    view.inputDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await view.flushPendingEdits()

    expect(onEdit).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        from: 0,
        to: 1,
        insert: '',
        deletedText: 'a',
      }),
    )
    expect(onEdit).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        from: 0,
        to: 0,
        insert: '\n',
        deletedText: '',
        historyGroup: 'isolate',
      }),
    )
  })

  it('deletes complete surrogate pairs from a rendered-only source', async () => {
    const parent = document.createElement('main')
    const onEdit = vi.fn()
    const view = new SourceDocumentView({
      parent,
      source: new RenderedOnlyLineSource({ documentId: 'large-source', text: '😀alpha' }),
      editable: true,
      onEdit,
    })

    await view.renderVisibleWindow()
    view.inputDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }))
    await view.flushPendingEdits()

    expect(onEdit).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 0,
        to: 2,
        insert: '',
        deletedText: '😀',
      }),
    )
  })

  it('copies, cuts, and pastes a selection through clipboard events', async () => {
    const parent = document.createElement('main')
    const onEdit = vi.fn()
    const view = new SourceDocumentView({
      parent,
      source: new MemoryDocumentSource({ documentId: 'source-doc', text: 'alpha beta' }),
      editable: true,
      onEdit,
      virtualViewport: {
        enabled: true,
        lineHeight: 20,
        viewportHeight: 40,
        overscanLines: 0,
      },
    })

    await view.renderVisibleWindow()
    const line = view.contentDOM.querySelector<HTMLElement>('.milkup-line[data-line="1"]')!
    line.getBoundingClientRect = () =>
      ({ left: 0, top: 0, right: 100, bottom: 20, width: 100, height: 20 }) as DOMRect
    line.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: 0, clientY: 10 }))
    line.dispatchEvent(
      new MouseEvent('pointermove', { bubbles: true, buttons: 1, clientX: 50, clientY: 10 }),
    )
    document.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, clientX: 50, clientY: 10 }))
    await flushPromises()

    const copied = createClipboardEvent('copy')
    view.inputDOM.dispatchEvent(copied.event)
    expect(copied.read()).toBe('alpha')
    expect(copied.event.defaultPrevented).toBe(true)

    const cut = createClipboardEvent('cut')
    view.inputDOM.dispatchEvent(cut.event)
    await flushPromises()
    await view.flushPendingEdits()
    expect(cut.read()).toBe('alpha')
    expect(onEdit).toHaveBeenLastCalledWith(
      expect.objectContaining({ from: 0, to: 5, insert: '', deletedText: 'alpha' }),
    )

    const pasted = createClipboardEvent('paste', 'omega')
    view.inputDOM.dispatchEvent(pasted.event)
    await flushPromises()
    await view.flushPendingEdits()
    expect(pasted.event.defaultPrevented).toBe(true)
    expect(onEdit).toHaveBeenLastCalledWith(
      expect.objectContaining({
        from: 0,
        to: 0,
        insert: 'omega',
        deletedText: '',
        historyGroup: 'isolate',
      }),
    )
  })

  it('renders live list markers like the regular editor', async () => {
    const parent = document.createElement('main')
    const view = new SourceDocumentView({
      parent,
      source: new MemoryDocumentSource({
        documentId: 'source-doc',
        text: ['- one', '3. two'].join('\n'),
      }),
      mode: 'live',
      markdownContextLines: 0,
      virtualViewport: {
        enabled: true,
        lineHeight: 20,
        viewportHeight: 40,
        overscanLines: 0,
      },
    })

    await view.renderVisibleWindow()

    const markers = Array.from(view.contentDOM.querySelectorAll<HTMLElement>('.milkup-list-marker'))

    expect(markers.map((marker) => marker.textContent)).toEqual(['•', '3.'])
    expect(markers[0]?.classList.contains('milkup-marker-hidden')).toBe(false)
  })

  it('keeps live list clicks out of source marker ranges', async () => {
    const parent = document.createElement('main')
    const view = new SourceDocumentView({
      parent,
      source: new MemoryDocumentSource({
        documentId: 'source-doc',
        text: '- one',
      }),
      mode: 'live',
      editable: true,
      markdownContextLines: 0,
      virtualViewport: {
        enabled: true,
        lineHeight: 20,
        viewportHeight: 40,
        overscanLines: 0,
      },
    })

    await view.renderVisibleWindow()
    const marker = view.contentDOM.querySelector<HTMLElement>('.milkup-list-marker')

    expect(marker).not.toBeNull()

    marker!.getBoundingClientRect = () =>
      ({ left: 0, top: 0, right: 16, bottom: 20, width: 16, height: 20 }) as DOMRect
    marker!.dispatchEvent(
      new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 4, clientY: 10 }),
    )
    await flushPromises()

    expect(view.cursorLayerDOM.querySelector<HTMLElement>('.milkup-cursor')?.dataset.position).toBe(
      '2',
    )
  })

  it('keeps task-list syntax rendered after the cursor enters the item', async () => {
    const parent = document.createElement('main')
    const view = new SourceDocumentView({
      parent,
      source: new MemoryDocumentSource({
        documentId: 'source-doc',
        text: '- [ ] pending',
      }),
      mode: 'live',
      editable: true,
      markdownContextLines: 0,
    })

    await view.renderVisibleWindow()
    view.contentDOM
      .querySelector<HTMLElement>('.milkup-list-content')
      ?.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }))
    await flushPromises()

    const line = view.contentDOM.querySelector<HTMLElement>('.milkup-line')
    expect(line?.querySelector('.milkup-task-marker')).not.toBeNull()
    expect(line?.textContent).not.toContain('[ ]')
    expect(line?.querySelector('.milkup-list-marker')?.textContent).toBe('•')
  })

  it('creates a selection while dragging through a rendered source window', async () => {
    const parent = document.createElement('main')
    const view = new SourceDocumentView({
      parent,
      source: new MemoryDocumentSource({
        documentId: 'source-doc',
        text: 'alpha',
      }),
      editable: true,
      virtualViewport: {
        enabled: true,
        lineHeight: 20,
        viewportHeight: 40,
        overscanLines: 0,
      },
    })

    await view.renderVisibleWindow()
    const line = view.contentDOM.querySelector<HTMLElement>('.milkup-line[data-line="1"]')

    expect(line).not.toBeNull()
    line!.getBoundingClientRect = () =>
      ({ left: 0, top: 0, right: 50, bottom: 20, width: 50, height: 20 }) as DOMRect
    view.selectionLayerDOM.getBoundingClientRect = () =>
      ({ left: 0, top: 0, right: 50, bottom: 20, width: 50, height: 20 }) as DOMRect
    line!.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: 0, clientY: 10 }))
    line!.dispatchEvent(
      new MouseEvent('pointermove', { bubbles: true, buttons: 1, clientX: 30, clientY: 10 }),
    )
    document.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, clientX: 30, clientY: 10 }))
    await flushPromises()

    const selection = view.dom.querySelector<HTMLElement>('.milkup-selection')

    expect(selection?.dataset.from).toBe('0')
    expect(selection?.dataset.to).toBe('3')
  })

  it('does not let stale single-line commits replace newer optimistic input', async () => {
    const parent = document.createElement('main')
    const source = new RecordingDocumentSource({
      documentId: 'source-doc',
      text: 'alpha',
    })
    let text = 'alpha'
    const pendingCommits: Array<() => void> = []
    const onEdit = vi.fn(
      (edit: { readonly from: number; readonly to: number; readonly insert: string }) =>
        new Promise<void>((resolve) => {
          pendingCommits.push(() => {
            text = text.slice(0, edit.from) + edit.insert + text.slice(edit.to)
            source.updateText(text)
            resolve()
          })
        }),
    )
    const view = new SourceDocumentView({
      parent,
      source,
      mode: 'live',
      editable: true,
      onEdit,
      markdownContextLines: 0,
      virtualViewport: {
        enabled: true,
        lineHeight: 20,
        viewportHeight: 40,
        overscanLines: 0,
      },
    })

    await view.renderVisibleWindow()
    view.inputDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'x', bubbles: true }))
    view.inputDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'y', bubbles: true }))
    await flushPromises()

    expect(view.contentDOM.querySelector<HTMLElement>('.milkup-line')?.textContent).toBe('xyalpha')
    expect(onEdit).not.toHaveBeenCalled()

    await delay(40)

    expect(view.contentDOM.querySelector<HTMLElement>('.milkup-line')?.textContent).toBe('xyalpha')
    expect(onEdit).toHaveBeenCalledTimes(1)
    expect(onEdit).toHaveBeenCalledWith(
      expect.objectContaining({ from: 0, to: 0, insert: 'xy', deletedText: '' }),
    )

    pendingCommits.shift()?.()
    await flushPromises()

    expect(view.contentDOM.querySelector<HTMLElement>('.milkup-line')?.textContent).toBe('xyalpha')
    expect(view.dom.querySelector<HTMLElement>('.milkup-cursor')?.dataset.position).toBe('2')
  })

  it('does not emit edits when the source view remains readonly', async () => {
    const parent = document.createElement('main')
    const onEdit = vi.fn()
    const view = new SourceDocumentView({
      parent,
      source: new MemoryDocumentSource({
        documentId: 'source-doc',
        text: 'alpha',
      }),
      onEdit,
    })

    await view.renderVisibleWindow()
    view.inputDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'x', bubbles: true }))
    await Promise.resolve()

    expect(onEdit).not.toHaveBeenCalled()
    expect(view.dom.querySelector<HTMLElement>('.milkup-cursor')).toBeNull()
  })
})

class RecordingDocumentSource extends MemoryDocumentSource {
  readonly requests: Array<{ fromLine: number; toLine: number }> = []
  private textVersion = 0

  override async readLineWindow(fromLine: number, toLine: number): Promise<DocumentLineWindow> {
    this.requests.push({ fromLine, toLine })
    return super.readLineWindow(fromLine, toLine)
  }

  override get version(): number {
    return this.textVersion
  }

  updateText(text: string): void {
    ;(this as unknown as { document: MemoryTextDocument }).document = new MemoryTextDocument(text)
    this.textVersion += 1
  }
}

class RenderedOnlyLineSource extends MemoryDocumentSource {
  override async lineAtPosition(position: number): Promise<never> {
    throw new Error(`lineAtPosition unavailable: ${position}`)
  }
}

class FailingLineWindowSource extends MemoryDocumentSource {
  failReads = false

  override async readLineWindow(fromLine: number, toLine: number): Promise<DocumentLineWindow> {
    if (this.failReads) {
      throw new Error('temporary native line window failure')
    }

    return super.readLineWindow(fromLine, toLine)
  }
}

async function flushPromises(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await new Promise((resolve) => setTimeout(resolve, 0))
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

it('reveals an exact source search selection without stealing focus', async () => {
  const parent = document.createElement('main')
  document.body.append(parent)
  const input = document.createElement('input')
  document.body.append(input)
  const view = new SourceDocumentView({
    parent,
    source: new MemoryDocumentSource({ documentId: 'navigation', text: 'one\nİ target 😀' }),
    editable: true,
  })
  await view.renderVisibleWindow()
  input.focus()
  await view.revealSelection(2, Selection.range(6, 12))
  expect(view.selection.main.from).toBe(6)
  expect(view.selection.main.to).toBe(12)
  expect(document.activeElement).toBe(input)
  view.destroy()
  parent.remove()
  input.remove()
})

it('moves a source outline cursor to the revealed heading line', async () => {
  const parent = document.createElement('main')
  const view = new SourceDocumentView({
    parent,
    source: new MemoryDocumentSource({ documentId: 'outline-nav', text: 'body\n# Heading\ntail' }),
    editable: true,
  })
  await view.renderVisibleWindow()
  await view.revealSelection(2)
  expect(view.selection.main.from).toBe(5)
  expect(view.selection.main.empty).toBe(true)
  view.destroy()
})

it('ignores a pending reveal after the document identity changes', async () => {
  const view = new SourceDocumentView({
    parent: document.createElement('main'),
    source: new MemoryDocumentSource({ documentId: 'before', text: 'one\ntarget' }),
    editable: true,
  })
  await view.renderVisibleWindow()
  let resume!: () => void
  vi.spyOn(view, 'scrollToLine').mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        resume = resolve
      }),
  )
  const pending = view.revealSelection(2, Selection.range(4, 10))
  view.updateSource(new MemoryDocumentSource({ documentId: 'after', text: 'new text' }))
  resume()
  await pending
  expect(view.selection.main.head).toBe(0)
  view.destroy()
})

for (const mode of ['source', 'live'] as const) {
  describe(`windowed ${mode} block commands`, () => {
    async function setup(initial: string, line: number, selection: Selection) {
      let text = initial
      const source = new RecordingDocumentSource({ documentId: 'windowed-blocks', text })
      const edits: unknown[] = []
      const view = new SourceDocumentView({
        parent: document.createElement('main'),
        source,
        mode,
        editable: true,
        backgroundMarkdownWarmup: false,
        markdownContextLines: 0,
        virtualViewport: { enabled: true, lineHeight: 20, viewportHeight: 40, overscanLines: 0 },
        onEdit(edit) {
          edits.push(edit)
          text = text.slice(0, edit.from) + edit.insert + text.slice(edit.to)
          source.updateText(text)
        },
      })
      await view.revealSelection(line, selection)
      return {
        view,
        source,
        edits,
        text: () => text,
        async key(key: string, shiftKey = false) {
          view.inputDOM.dispatchEvent(
            new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true }),
          )
          await view.flushPendingEdits()
        },
      }
    }
    it('exits an empty nested list without inserting another marker', async () => {
      const s = await setup('before\n  - ', 2, Selection.cursor(11))
      try {
        await s.key('Enter')
        expect(s.text()).toBe('before\n- ')
        expect(s.view.selection.main.head).toBe(9)
      } finally {
        s.view.destroy()
      }
    })
    it('does not continue literal lists inside a fence outside the rendered window and preserves CRLF', async () => {
      const initial = '```md\r\n' + 'literal\r\n'.repeat(40) + '- text\r\n```'
      const end = initial.indexOf('- text') + 6
      const s = await setup(initial, 42, Selection.cursor(end))
      try {
        await s.key('Enter')
        expect(s.text()).toBe(initial.slice(0, end) + '\r\n' + initial.slice(end))
      } finally {
        s.view.destroy()
      }
    })
    it('indents a reversed selection across windows in one edit and preserves its direction', async () => {
      const initial = Array.from({ length: 20 }, (_, i) => `- item${i}`).join('\r\n')
      const end = initial.indexOf('\r\n- item19')
      const s = await setup(initial, 1, Selection.range(end, 0))
      try {
        await s.key('Tab')
        const expected = initial
          .split('\r\n')
          .map((x, i) => (i < 19 ? '  ' + x : x))
          .join('\r\n')
        expect(s.text()).toBe(expected)
        expect(s.edits).toHaveLength(1)
        expect(s.view.selection.main.anchor).toBe(end + 38)
        expect(s.view.selection.main.head).toBe(2)
        await s.key('Tab', true)
        expect(s.text()).toBe(initial)
      } finally {
        s.view.destroy()
      }
    })
  })
}

it('does not scan the document prefix for ordinary windowed character backspace', async () => {
  const text = createLineFixture(1000)
  const source = new RecordingDocumentSource({ documentId: 'fast-delete', text })
  const view = new SourceDocumentView({
    parent: document.createElement('main'),
    source,
    editable: true,
    backgroundMarkdownWarmup: false,
    virtualViewport: { enabled: true, viewportHeight: 40, lineHeight: 20, overscanLines: 0 },
    onEdit(edit) {
      source.updateText(text.slice(0, edit.from) + edit.insert + text.slice(edit.to))
    },
  })
  const line = await source.readLineWindow(800, 800)
  await view.revealSelection(800, Selection.cursor(line.to))
  source.requests.length = 0
  view.inputDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true }))
  await view.flushPendingEdits()
  expect(source.requests.every((request) => request.fromLine > 700)).toBe(true)
  view.destroy()
})

it('discards a delayed fence scan after the active document changes', async () => {
  const source = new RecordingDocumentSource({
    documentId: 'old-block',
    text: createLineFixture(1000),
  })
  const onEdit = vi.fn()
  const view = new SourceDocumentView({
    parent: document.createElement('main'),
    source,
    editable: true,
    onEdit,
    backgroundMarkdownWarmup: false,
    virtualViewport: { enabled: true, viewportHeight: 40, lineHeight: 20, overscanLines: 0 },
  })
  const line = await source.readLineWindow(800, 800)
  await view.revealSelection(800, Selection.cursor(line.to))
  const oldWindow = await source.readLineWindow(1, 512)
  let resolve!: (window: DocumentLineWindow) => void
  vi.spyOn(source, 'readLineWindow').mockImplementationOnce(
    () =>
      new Promise((r) => {
        resolve = r
      }),
  )
  view.inputDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  await flushPromises()
  view.updateSource(new MemoryDocumentSource({ documentId: 'new-block', text: 'keep me' }))
  resolve(oldWindow)
  await view.flushPendingEdits()
  expect(onEdit).not.toHaveBeenCalled()
  expect(view.selection.main.head).toBe(0)
  view.destroy()
})

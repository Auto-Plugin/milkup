import { MemoryDocumentSource, MemoryTextDocument, type DocumentLineWindow } from '@milkup/core'
import { describe, expect, it, vi } from 'vitest'

import { SourceDocumentView } from '../index'

function createLineFixture(lineCount: number): string {
  return Array.from({ length: lineCount }, (_value, index) => `line ${index + 1}`).join('\n')
}

describe('SourceDocumentView', () => {
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
    expect(onEdit).toHaveBeenCalledWith({ from: 4, to: 4, insert: 'x', deletedText: '' })
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
    expect(view.contentDOM.querySelector<HTMLElement>('.milkup-line[data-line="1"]')?.textContent).toBe(
      'xalpha',
    )
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
    expect(onEdit).toHaveBeenCalledWith({ from: 0, to: 0, insert: 'x', deletedText: '' })
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
    expect(onEdit).toHaveBeenCalledWith({ from: 0, to: 0, insert: '你', deletedText: '' })
    expect(view.inputDOM.value).toBe('')
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

    expect(onEdit).toHaveBeenCalledWith({ from: 0, to: 0, insert: 'x', deletedText: '' })
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
    await flushPromises()

    expect(onEdit).toHaveBeenCalledWith({ from: 0, to: 6, insert: '', deletedText: 'alpha\n' })
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
    expect(onEdit).toHaveBeenCalledWith({ from: 0, to: 0, insert: 'xy', deletedText: '' })

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

async function flushPromises(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await new Promise((resolve) => setTimeout(resolve, 0))
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

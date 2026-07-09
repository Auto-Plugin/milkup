import { MemoryDocumentSource, type DocumentLineWindow } from '@milkup/core'
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

    expect(view.contentDOM.querySelector<HTMLElement>('.milkup-cursor')?.dataset.position).toBe('5')
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

    expect(view.contentDOM.querySelector<HTMLElement>('.milkup-cursor')?.style.top).toBe('123px')
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
    await Promise.resolve()

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

    expect(view.contentDOM.querySelector<HTMLElement>('.milkup-selection')).not.toBeNull()

    view.inputDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true }))
    await flushPromises()

    expect(onEdit).toHaveBeenCalledWith({ from: 0, to: 6, insert: '', deletedText: 'alpha\n' })
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
    expect(view.contentDOM.querySelector<HTMLElement>('.milkup-cursor')).toBeNull()
  })
})

class RecordingDocumentSource extends MemoryDocumentSource {
  readonly requests: Array<{ fromLine: number; toLine: number }> = []

  override async readLineWindow(fromLine: number, toLine: number): Promise<DocumentLineWindow> {
    this.requests.push({ fromLine, toLine })
    return super.readLineWindow(fromLine, toLine)
  }
}

async function flushPromises(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await new Promise((resolve) => setTimeout(resolve, 0))
}

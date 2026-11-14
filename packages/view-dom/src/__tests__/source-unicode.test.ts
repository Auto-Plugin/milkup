import { MemoryDocumentSource, MemoryTextDocument, type DocumentLineWindow } from '@milkup/core'
import { afterEach, describe, expect, it } from 'vitest'

import { SourceDocumentView, type SourceDocumentEdit } from '../source-document-view'

// Match the native source: positions are available from bounded line reads only.
class WindowOnlySource extends MemoryDocumentSource {
  requests: [number, number][] = []
  override async lineAtPosition(): Promise<never> {
    throw new Error('No global position index')
  }
  override async readLineWindow(from: number, to: number): Promise<DocumentLineWindow> {
    this.requests.push([from, to])
    return super.readLineWindow(from, to)
  }
  update(text: string): void {
    ;(this as unknown as { document: MemoryTextDocument }).document = new MemoryTextDocument(text)
  }
}

const views: SourceDocumentView[] = []
afterEach(() => views.splice(0).forEach((view) => view.destroy()))

async function setup(text: string, mode: 'source' | 'live' = 'source') {
  const source = new WindowOnlySource({ documentId: 'unicode', text })
  const edits: SourceDocumentEdit[] = []
  const view = new SourceDocumentView({
    parent: document.createElement('main'),
    source,
    mode,
    editable: true,
    backgroundMarkdownWarmup: false,
    markdownContextLines: 0,
    virtualViewport: { enabled: true, lineHeight: 20, viewportHeight: 20, overscanLines: 0 },
    onEdit(edit) {
      edits.push(edit)
      text = text.slice(0, edit.from) + edit.insert + text.slice(edit.to)
      source.update(text)
    },
  })
  views.push(view)
  await view.renderVisibleWindow()
  const key = (key: string, shiftKey = false) =>
    view.inputDOM.dispatchEvent(
      new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true }),
    )
  const cursor = () =>
    Number(view.dom.querySelector<HTMLElement>('.milkup-cursor')?.dataset.position)
  return { view, source, edits, key, cursor, text: () => text }
}

for (const mode of ['source', 'live'] as const) {
  describe(`windowed ${mode} Unicode keys`, () => {
    for (const grapheme of ['😀', 'e\u0301', '👩🏽‍💻', '🇨🇳']) {
      it(`moves and extends selection over the whole ${grapheme}`, async () => {
        const s = await setup(`A${grapheme}B`, mode)
        s.key('ArrowRight')
        s.key('ArrowRight')
        await s.view.flushPendingEdits()
        expect(s.cursor()).toBe(1 + grapheme.length)
        s.key('ArrowLeft', true)
        s.key('Delete')
        await s.view.flushPendingEdits()
        expect(s.text()).toBe('AB')
        expect(s.edits[0]?.deletedText).toBe(grapheme)
      })
      it(`deletes the whole ${grapheme} forward`, async () => {
        const s = await setup(`A${grapheme}B`, mode)
        s.key('ArrowRight')
        s.key('Delete')
        await s.view.flushPendingEdits()
        expect(s.text()).toBe('AB')
        expect(s.edits[0]?.deletedText).toBe(grapheme)
      })
      it(`deletes the whole ${grapheme} backward`, async () => {
        const s = await setup(`A${grapheme}\nB`, mode)
        s.key('ArrowDown')
        await s.view.flushPendingEdits()
        s.key('ArrowLeft')
        s.key('Backspace')
        await s.view.flushPendingEdits()
        expect(s.text()).toBe('A\nB')
        expect(s.edits[0]?.deletedText).toBe(grapheme)
      })
    }
    it('snaps vertical movement to the beginning of a grapheme', async () => {
      const s = await setup('abc\nA😀B', mode)
      s.key('ArrowRight')
      s.key('ArrowRight')
      s.key('ArrowDown')
      await s.view.flushPendingEdits()
      expect(s.cursor()).toBe(5)
      s.key('Delete')
      await s.view.flushPendingEdits()
      expect(s.text()).toBe('abc\nAB')
    })
    it('deletes an entire offscreen CRLF backward with the correct undo payload', async () => {
      const s = await setup('a\r\nb\r\nc', mode)
      s.key('ArrowDown')
      await s.view.flushPendingEdits()
      expect(s.view.contentDOM.dataset.fromLine).toBe('2')
      s.key('Backspace')
      await s.view.flushPendingEdits()
      expect(s.text()).toBe('ab\r\nc')
      expect(s.cursor()).toBe(1)
      expect(s.edits[0]).toMatchObject({ from: 1, to: 3, deletedText: '\r\n' })
    })
    it('crosses and deletes an offscreen CRLF forward using bounded reads', async () => {
      const s = await setup('a\r\nb\r\nc', mode)
      s.key('ArrowRight')
      s.key('ArrowRight')
      await s.view.flushPendingEdits()
      expect(s.cursor()).toBe(3)
      expect(s.view.contentDOM.dataset.fromLine).toBe('2')
      s.key('ArrowLeft')
      s.key('Delete')
      await s.view.flushPendingEdits()
      expect(s.text()).toBe('ab\r\nc')
      expect(s.cursor()).toBe(1)
      expect(s.edits[0]).toMatchObject({ from: 1, to: 3, deletedText: '\r\n' })
      expect(s.source.requests.every(([from, to]) => to - from <= 1)).toBe(true)
    })
  })
}

describe('windowed edit ordering and viewport stability', () => {
  it('commits visible edits before history and queues subsequent typing after it', async () => {
    const s = await setup('A👩🏽‍💻B')
    s.key('ArrowRight')
    s.key('Delete')
    const history = s.view.runAfterPendingEdits(async () => {
      expect(s.text()).toBe('AB')
      expect(s.edits[0]?.deletedText).toBe('👩🏽‍💻')
      await new Promise((resolve) => setTimeout(resolve, 25))
      s.source.update('A👩🏽‍💻B')
      await s.view.renderVisibleWindow()
    })
    s.key('ArrowRight')
    await history
    await s.view.flushPendingEdits()
    expect(s.cursor()).toBe(8)
  })

  it('preserves the cursor when scrolling away and back without reading the whole document', async () => {
    const s = await setup('A👩🏽‍💻B\n' + 'body\n'.repeat(10000))
    s.key('ArrowRight')
    s.key('ArrowRight')
    await s.view.flushPendingEdits()
    await s.view.scrollToLine(5000)
    await s.view.scrollToLine(1)
    expect(s.cursor()).toBe(8)
    expect(s.source.requests.every(([from, to]) => to - from <= 1)).toBe(true)
  })

  it('selects across a CRLF window boundary and retains all deleted text for undo', async () => {
    const s = await setup('A👩🏽‍💻\r\n🇨🇳B\r\ntail\r\nend')
    s.key('ArrowRight')
    s.key('ArrowRight', true)
    s.key('ArrowRight', true)
    s.key('ArrowRight', true)
    s.key('Delete')
    await s.view.flushPendingEdits()
    expect(s.text()).toBe('AB\r\ntail\r\nend')
    expect(s.cursor()).toBe(1)
    expect(s.edits[0]).toMatchObject({ from: 1, to: 14, deletedText: '👩🏽‍💻\r\n🇨🇳' })
  })
})

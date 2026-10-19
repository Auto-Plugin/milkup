import { MemoryDocumentSource, Selection, type DocumentLineWindow } from '@milkup/core'
import { describe, expect, it, vi } from 'vitest'
import { SourceDocumentView } from '../source-document-view'

class DelayedNavigationSource extends MemoryDocumentSource {
  holdLine: number | undefined
  failLine: number | undefined
  entered!: () => void
  release!: () => void
  reject!: (reason: Error) => void
  readonly started = new Promise<void>((resolve) => {
    this.entered = resolve
  })
  readonly blocked = new Promise<void>((resolve, reject) => {
    this.release = resolve
    this.reject = reject
  })
  override async readLineWindow(
    from: number,
    to: number,
    limit?: number,
  ): Promise<DocumentLineWindow> {
    const window = await super.readLineWindow(from, to, limit)
    if (from <= (this.failLine ?? -1) && to >= (this.failLine ?? -1))
      throw new Error('navigation read failed')
    if (this.holdLine !== undefined && from <= this.holdLine && to >= this.holdLine) {
      this.entered()
      await this.blocked
    }
    return window
  }
}

const text = 'first 中文\nmiddle 😀\nlast é'
for (const mode of ['source', 'live'] as const)
  describe(`windowed ${mode} explicit document navigation`, () => {
    async function setup() {
      const parent = document.createElement('main')
      document.body.append(parent)
      const source = new DelayedNavigationSource({ documentId: 'navigation', text })
      const notified: { edge: string; anchor: number; head: number; renderedHead: number }[] = []
      const onEdit = vi.fn()
      const view: SourceDocumentView = new SourceDocumentView({
        parent,
        source,
        mode,
        editable: true,
        onEdit,
        backgroundMarkdownWarmup: false,
        markdownContextLines: 0,
        virtualViewport: { enabled: true, lineHeight: 20, viewportHeight: 20, overscanLines: 0 },
        onDocumentNavigation: (edge) =>
          notified.push({
            edge,
            anchor: view.selection.main.anchor,
            head: view.selection.main.head,
            renderedHead: Number(
              view.cursorLayerDOM.querySelector<HTMLElement>('.milkup-cursor')?.dataset.position,
            ),
          }),
      })
      await view.revealSelection(1, Selection.cursor(2))
      view.inputDOM.focus()
      return {
        view,
        source,
        onEdit,
        notified,
        parent,
        key(key: string, shiftKey = false) {
          view.inputDOM.dispatchEvent(
            new KeyboardEvent('keydown', {
              key,
              ctrlKey: true,
              shiftKey,
              bubbles: true,
              cancelable: true,
            }),
          )
        },
        dispose() {
          source.release()
          view.destroy()
          parent.remove()
        },
      }
    }
    for (const edge of ['start', 'end'] as const)
      for (const shift of [false, true])
        it(`notifies ${edge} only after deferred reveal, preserving Shift=${shift} anchor`, async () => {
          const s = await setup()
          try {
            if (edge === 'start') await s.view.revealSelection(3, Selection.cursor(text.length - 2))
            const before = s.view.selection.main.anchor
            s.source.holdLine = edge === 'start' ? 1 : 3
            s.key(edge === 'start' ? 'Home' : 'End', shift)
            await s.source.started
            expect(s.notified).toEqual([])
            s.source.release()
            await s.view.flushPendingEdits()
            const head = edge === 'start' ? 0 : text.length
            expect(s.notified).toEqual([
              { edge, anchor: shift ? before : head, head, renderedHead: head },
            ])
            expect(s.onEdit).not.toHaveBeenCalled()
          } finally {
            s.dispose()
          }
        })
    for (const invalidate of [
      'document',
      'same-document',
      'document-roundtrip',
      'destroy',
      'new-key',
    ] as const)
      it(`drops a deferred old End after ${invalidate}`, async () => {
        const s = await setup()
        try {
          s.source.holdLine = 3
          s.key('End')
          await s.source.started
          if (invalidate === 'document' || invalidate === 'document-roundtrip') {
            s.view.updateSource(
              new MemoryDocumentSource({ documentId: 'replacement', text: 'keep me' }),
            )
            if (invalidate === 'document-roundtrip')
              s.view.updateSource(new MemoryDocumentSource({ documentId: 'navigation', text }))
          } else if (invalidate === 'same-document')
            s.view.updateSource(
              new MemoryDocumentSource({ documentId: 'navigation', text: 'changed', version: 1 }),
            )
          else if (invalidate === 'destroy') s.view.destroy()
          else s.key('Home')
          s.source.release()
          await s.view.flushPendingEdits()
          expect(s.notified.map((n) => n.edge)).toEqual(invalidate === 'new-key' ? ['start'] : [])
          expect(s.view.selection.main.head).toBe(
            invalidate === 'destroy' || invalidate === 'same-document' ? 2 : 0,
          )
          expect(s.onEdit).not.toHaveBeenCalled()
        } finally {
          if (invalidate === 'destroy') {
            s.source.release()
            s.parent.remove()
          } else s.dispose()
        }
      })
    for (const phase of ['read', 'reveal'] as const)
      for (const invalidate of ['document', 'destroy'] as const)
        it(`discards obsolete ${phase} rejection after ${invalidate}`, async () => {
          const s = await setup()
          try {
            if (phase === 'read') s.source.holdLine = 3
            else
              vi.spyOn(s.view, 'revealSelection').mockImplementationOnce(async () => {
                s.source.entered()
                await s.source.blocked
              })
            s.key('End')
            await s.source.started
            if (invalidate === 'document')
              s.view.updateSource(
                new MemoryDocumentSource({ documentId: 'replacement', text: 'keep me' }),
              )
            else s.view.destroy()
            s.source.reject(new Error('obsolete navigation failed'))
            await expect(s.view.flushPendingEdits()).resolves.toBeUndefined()
            expect(s.notified).toEqual([])
            expect(s.onEdit).not.toHaveBeenCalled()
            expect(s.view.selection.main.head).toBe(invalidate === 'document' ? 0 : 2)
          } finally {
            if (invalidate === 'destroy') s.parent.remove()
            else s.dispose()
          }
        })
    it('captures the source version after preceding typed edits commit', async () => {
      const s = await setup()
      try {
        s.onEdit.mockImplementation((edit) => {
          const changed = text.slice(0, edit.from) + edit.insert + text.slice(edit.to)
          s.view.updateSource(
            new MemoryDocumentSource({ documentId: 'navigation', text: changed, version: 1 }),
          )
        })
        s.view.inputDOM.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'x', bubbles: true, cancelable: true }),
        )
        s.key('End')
        await s.view.flushPendingEdits()
        expect(s.onEdit).toHaveBeenCalledTimes(1)
        expect(s.notified).toEqual([
          {
            edge: 'end',
            anchor: text.length + 1,
            head: text.length + 1,
            renderedHead: text.length + 1,
          },
        ])
      } finally {
        s.dispose()
      }
    })
    for (const phase of ['read', 'reveal'] as const)
      it(`keeps current failed ${phase} visible and does not notify`, async () => {
        const s = await setup()
        try {
          if (phase === 'read') s.source.failLine = 3
          else
            vi.spyOn(s.view, 'revealSelection').mockRejectedValueOnce(
              new Error('navigation reveal failed'),
            )
          s.key('End')
          await expect(s.view.flushPendingEdits()).rejects.toThrow(`navigation ${phase} failed`)
          expect(s.notified).toEqual([])
        } finally {
          s.dispose()
        }
      })
    it('does not notify ordinary cursor movement or typing', async () => {
      const s = await setup()
      try {
        for (const key of ['ArrowRight', 'x'])
          s.view.inputDOM.dispatchEvent(
            new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
          )
        await s.view.flushPendingEdits()
        expect(s.notified).toEqual([])
        expect(s.onEdit).toHaveBeenCalledTimes(1)
      } finally {
        s.dispose()
      }
    })
  })

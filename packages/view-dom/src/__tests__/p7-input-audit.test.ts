import { EditorState, MemoryDocumentSource, MemoryTextDocument, Selection } from '@milkup/core'
import { describe, expect, it, vi } from 'vitest'
import { EditorView, SourceDocumentView } from '../index'

// Synthetic DOM regression only; this does not verify a system IME session.
for (const mode of ['source', 'live'] as const) {
  describe(`P7 ${mode} input boundaries`, () => {
    it('keeps programmatic root navigation without making it a second sequential Tab stop', async () => {
      const parent = document.createElement('main')
      const before = document.createElement('button')
      parent.append(before)
      document.body.append(parent)
      const origins: Element[] = []
      const onEdit = vi.fn()
      const view: SourceDocumentView = new SourceDocumentView({
        parent,
        mode,
        editable: true,
        source: new MemoryDocumentSource({ documentId: 'backward', text: 'plain 中文' }),
        backgroundMarkdownWarmup: false,
        onEdit,
        onFocusNavigation: ({ backward }) => {
          expect(backward).toBe(true)
          const origin = document.activeElement!
          origins.push(origin)
          // Minimal host callback. Desktop focus-order behavior has separate tests.
          before.focus()
        },
      })
      try {
        await view.renderVisibleWindow()
        expect(view.dom.tabIndex).toBe(-1)
        for (const target of [view.inputDOM, view.dom]) {
          target.focus()
          expect(document.activeElement).toBe(target)
          target.dispatchEvent(
            new KeyboardEvent('keydown', {
              key: 'Unidentified',
              code: 'Tab',
              shiftKey: true,
              bubbles: true,
              cancelable: true,
            }),
          )
          await view.flushPendingEdits()
        }
        expect(origins).toEqual([view.inputDOM, view.dom])
        expect(document.activeElement).toBe(before)
        expect(onEdit).not.toHaveBeenCalled()
      } finally {
        view.destroy()
        parent.remove()
      }
    })
    it('preserves standalone root and input Tab stops without a host callback', () => {
      const view = new SourceDocumentView({
        parent: document.createElement('main'),
        mode,
        source: new MemoryDocumentSource({ documentId: 'standalone', text: 'plain' }),
        backgroundMarkdownWarmup: false,
      })
      try {
        expect(view.dom.tabIndex).toBe(0)
        expect(view.inputDOM.tabIndex).toBe(0)
      } finally {
        view.destroy()
      }
    })
    for (const windowed of [false, true]) {
      for (const shiftKey of [false, true]) {
        it(`${windowed ? 'windowed' : 'ordinary'} readonly editor allows ${shiftKey ? 'Shift+Tab' : 'Tab'} without editing`, async () => {
          const onEdit = vi.fn()
          const view = windowed
            ? new SourceDocumentView({
                parent: document.createElement('main'),
                mode,
                editable: false,
                source: new MemoryDocumentSource({ documentId: 'readonly', text: '  - item' }),
                backgroundMarkdownWarmup: false,
                onEdit,
              })
            : new EditorView({
                parent: document.createElement('main'),
                mode,
                editable: false,
                state: new EditorState({ doc: new MemoryTextDocument('  - item') }),
              })
          try {
            if (view instanceof SourceDocumentView) await view.renderVisibleWindow()
            const event = new KeyboardEvent('keydown', {
              key: 'Tab',
              shiftKey,
              bubbles: true,
              cancelable: true,
            })
            view.inputDOM.dispatchEvent(event)
            if (view instanceof SourceDocumentView) await view.flushPendingEdits()
            expect(event.defaultPrevented).toBe(false)
            expect(onEdit).not.toHaveBeenCalled()
            if (view instanceof EditorView) {
              expect(view.state.doc.text).toBe('  - item')
              expect(view.state.history.canUndo).toBe(false)
            }
          } finally {
            view.destroy()
          }
        })
      }
    }
    for (const change of ['focus', 'selection', 'document-roundtrip', 'composition', 'destroy']) {
      it(`does not steal focus after deferred Tab and ${change} changes`, async () => {
        const parent = document.createElement('main')
        const other = document.createElement('button')
        parent.append(other)
        document.body.append(parent)
        const onFocusNavigation = vi.fn()
        const onEdit = vi.fn()
        const view = new SourceDocumentView({
          parent,
          mode,
          editable: true,
          source: new MemoryDocumentSource({ documentId: 'plain', text: 'plain 中文 😀' }),
          backgroundMarkdownWarmup: false,
          onEdit,
          onFocusNavigation,
        })
        let release!: () => void
        const blocked = new Promise<void>((resolve) => {
          release = resolve
        })
        try {
          await view.renderVisibleWindow()
          view.inputDOM.focus()
          const barrier = view.runAfterPendingEdits(() => blocked)
          view.inputDOM.dispatchEvent(
            new KeyboardEvent('keydown', {
              key: 'Tab',
              bubbles: true,
              cancelable: true,
            }),
          )
          if (change === 'focus') other.focus()
          if (change === 'selection') await view.revealSelection(1, Selection.cursor(2))
          if (change === 'document-roundtrip') {
            view.updateSource(new MemoryDocumentSource({ documentId: 'other', text: 'other' }))
            view.updateSource(
              new MemoryDocumentSource({ documentId: 'plain', text: 'plain 中文 😀' }),
            )
          }
          if (change === 'composition')
            view.inputDOM.dispatchEvent(new CompositionEvent('compositionstart'))
          if (change === 'destroy') view.destroy()
          release()
          await barrier
          await view.flushPendingEdits()
          expect(onFocusNavigation).not.toHaveBeenCalled()
          expect(onEdit).not.toHaveBeenCalled()
          if (change === 'focus') expect(document.activeElement).toBe(other)
        } finally {
          release()
          if (change !== 'destroy') view.destroy()
          parent.remove()
        }
      })
    }

    for (const kind of ['list', 'long-fence', 'multiline', 'table']) {
      it(`preserves ${kind} Tab editing when host focus navigation is configured`, async () => {
        const text =
          kind === 'list'
            ? '- item'
            : kind === 'multiline'
              ? 'one\ntwo'
              : kind === 'table'
                ? '| a | b |\n| --- | --- |\n| c | d |'
                : '```\n' + 'literal\n'.repeat(40) + 'body\n```'
        const at = kind === 'long-fence' ? text.indexOf('body') : kind === 'table' ? 2 : 0
        const onEdit = vi.fn()
        const onFocusNavigation = vi.fn()
        const parent = document.createElement('main')
        document.body.append(parent)
        const view = new SourceDocumentView({
          parent,
          mode,
          editable: true,
          source: new MemoryDocumentSource({ documentId: kind, text }),
          backgroundMarkdownWarmup: false,
          markdownContextLines: 0,
          virtualViewport: { enabled: true, lineHeight: 20, viewportHeight: 40, overscanLines: 0 },
          onEdit,
          onFocusNavigation,
        })
        try {
          await view.revealSelection(
            kind === 'long-fence' ? 42 : 1,
            kind === 'multiline' ? Selection.range(text.length, 0) : Selection.cursor(at),
          )
          view.inputDOM.focus()
          view.inputDOM.dispatchEvent(
            new KeyboardEvent('keydown', {
              key: 'Tab',
              bubbles: true,
              cancelable: true,
            }),
          )
          await view.flushPendingEdits()
          expect(onFocusNavigation).not.toHaveBeenCalled()
          if (kind === 'table' && mode === 'live') {
            expect(onEdit).not.toHaveBeenCalled()
            expect(view.selection.main.head).toBeGreaterThan(at)
          } else {
            expect(onEdit).toHaveBeenCalledTimes(1)
            const edit = onEdit.mock.calls[0]![0]
            const actual = text.slice(0, edit.from) + edit.insert + text.slice(edit.to)
            const expected =
              kind === 'multiline'
                ? '  one\n  two'
                : kind === 'table'
                  ? '  ' + text
                  : text.slice(0, at) + '  ' + text.slice(at)
            expect(actual).toBe(expected)
            expect(edit.historyGroup).toBe('isolate')
          }
        } finally {
          view.destroy()
          parent.remove()
        }
      })
    }

    for (const shiftKey of [false, true]) {
      it(`ordinary plain paragraph preserves ${shiftKey ? 'Shift+Tab' : 'Tab'} focus navigation`, () => {
        const view = new EditorView({
          parent: document.createElement('main'),
          mode,
          state: new EditorState({ doc: new MemoryTextDocument('plain 中文 😀') }),
        })
        try {
          const event = new KeyboardEvent('keydown', {
            key: 'Tab',
            shiftKey,
            bubbles: true,
            cancelable: true,
          })
          view.inputDOM.dispatchEvent(event)
          expect(event.defaultPrevented).toBe(false)
          expect(view.state.doc.text).toBe('plain 中文 😀')
          expect(view.state.history.canUndo).toBe(false)
        } finally {
          view.destroy()
        }
      })

      it(`windowed plain paragraph preserves ${shiftKey ? 'Shift+Tab' : 'Tab'} focus navigation`, async () => {
        const onEdit = vi.fn()
        const onFocusNavigation = vi.fn()
        const parent = document.createElement('main')
        document.body.append(parent)
        const view = new SourceDocumentView({
          parent,
          mode,
          editable: true,
          source: new MemoryDocumentSource({ documentId: 'plain', text: 'plain 中文 😀' }),
          backgroundMarkdownWarmup: false,
          onEdit,
          onFocusNavigation,
        })
        try {
          await view.renderVisibleWindow()
          view.inputDOM.focus()
          const event = new KeyboardEvent('keydown', {
            key: 'Tab',
            shiftKey,
            bubbles: true,
            cancelable: true,
          })
          view.inputDOM.dispatchEvent(event)
          await view.flushPendingEdits()
          expect(event.defaultPrevented).toBe(true)
          expect(onFocusNavigation).toHaveBeenCalledExactlyOnceWith({ backward: shiftKey })
          expect.soft(onEdit).not.toHaveBeenCalled()
        } finally {
          view.destroy()
          parent.remove()
        }
      })
    }

    for (const retirement of ['document-switch', 'document-roundtrip', 'destroy'] as const) {
      it(`does not commit queued composition after ${retirement}`, async () => {
        const onEdit = vi.fn()
        const view = new SourceDocumentView({
          parent: document.createElement('main'),
          mode,
          editable: true,
          source: new MemoryDocumentSource({ documentId: 'old', text: 'old 中文' }),
          backgroundMarkdownWarmup: false,
          onEdit,
        })
        try {
          await view.renderVisibleWindow()
          view.inputDOM.dispatchEvent(new CompositionEvent('compositionstart'))
          view.inputDOM.dispatchEvent(new CompositionEvent('compositionend', { data: '新😀' }))
          // The commit is queued. Retire its document/owner before the microtask runs.
          if (retirement !== 'destroy') {
            view.updateSource(new MemoryDocumentSource({ documentId: 'new', text: 'keep me' }))
            if (retirement === 'document-roundtrip')
              view.updateSource(new MemoryDocumentSource({ documentId: 'old', text: 'old 中文' }))
          } else view.destroy()
          await view.flushPendingEdits()
          expect(onEdit).not.toHaveBeenCalled()
        } finally {
          if (retirement !== 'destroy') view.destroy()
        }
      })
    }

    it('does not apply an old compositionend delivered after a document switch', async () => {
      const onEdit = vi.fn()
      const view = new SourceDocumentView({
        parent: document.createElement('main'),
        mode,
        editable: true,
        source: new MemoryDocumentSource({ documentId: 'old', text: 'old 中文' }),
        backgroundMarkdownWarmup: false,
        onEdit,
      })
      try {
        await view.renderVisibleWindow()
        view.inputDOM.dispatchEvent(new CompositionEvent('compositionstart'))
        view.updateSource(new MemoryDocumentSource({ documentId: 'new', text: 'keep me' }))
        await view.renderVisibleWindow()
        view.inputDOM.dispatchEvent(new CompositionEvent('compositionend', { data: '新😀' }))
        await view.flushPendingEdits()
        expect(onEdit).not.toHaveBeenCalled()
      } finally {
        view.destroy()
      }
    })

    it('commits a new composition session after switching documents with isolated history', async () => {
      const onEdit = vi.fn()
      const view = new SourceDocumentView({
        parent: document.createElement('main'),
        mode,
        editable: true,
        source: new MemoryDocumentSource({ documentId: 'old', text: 'old 中文' }),
        backgroundMarkdownWarmup: false,
        onEdit,
      })
      try {
        await view.renderVisibleWindow()
        view.inputDOM.dispatchEvent(new CompositionEvent('compositionstart'))
        view.updateSource(new MemoryDocumentSource({ documentId: 'new', text: 'keep me' }))
        await view.renderVisibleWindow()
        view.inputDOM.dispatchEvent(new CompositionEvent('compositionend', { data: 'stale' }))
        view.inputDOM.dispatchEvent(new CompositionEvent('compositionstart'))
        view.inputDOM.dispatchEvent(new CompositionEvent('compositionend', { data: '新😀' }))
        await view.flushPendingEdits()
        expect(onEdit).toHaveBeenCalledTimes(1)
        expect(onEdit).toHaveBeenCalledWith(
          expect.objectContaining({ from: 0, to: 0, insert: '新😀', historyGroup: 'isolate' }),
        )
        expect(view.selection.main.head).toBe(3)
        expect(view.isComposing).toBe(false)
      } finally {
        view.destroy()
      }
    })
  })
}

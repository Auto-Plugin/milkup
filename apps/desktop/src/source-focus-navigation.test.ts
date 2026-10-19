// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryDocumentSource, Selection } from '@milkup/core'
import { SourceDocumentView } from '@milkup/view-dom'
import { moveDesktopFocus } from './desktop-focus'

afterEach(() => {
  document.body.replaceChildren()
  vi.restoreAllMocks()
})
for (const mode of ['source', 'live'] as const)
  describe(`host windowed ${mode} focus order`, () => {
    for (const backward of [false, true])
      it(`one ${backward ? 'Shift+Tab' : 'Tab'} leaves the editor and preserves selection`, async () => {
        document.body.innerHTML =
          '<button id="before">Before</button><main></main><button id="after">After</button>'
        vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([
          {},
        ] as unknown as DOMRectList)
        const parent = document.querySelector('main')!
        const onEdit = vi.fn()
        const onFocusNavigation = vi.fn(({ backward }: { backward: boolean }) => {
          const focused = document.activeElement
          if (focused instanceof HTMLElement && parent.contains(focused))
            moveDesktopFocus(focused, backward)
        })
        const view = new SourceDocumentView({
          parent,
          mode,
          editable: true,
          onEdit,
          onFocusNavigation,
          source: new MemoryDocumentSource({ documentId: 'focus-parity', text: 'plain 中文 😀' }),
          backgroundMarkdownWarmup: false,
        })
        try {
          await view.revealSelection(1, Selection.range(2, 5))
          const selection = view.selection.main
          view.inputDOM.focus()
          view.inputDOM.dispatchEvent(
            new KeyboardEvent('keydown', {
              key: 'Tab',
              shiftKey: backward,
              bubbles: true,
              cancelable: true,
            }),
          )
          await view.flushPendingEdits()
          expect(document.activeElement).toBe(
            document.getElementById(backward ? 'before' : 'after'),
          )
          expect(onFocusNavigation).toHaveBeenCalledTimes(1)
          expect([view.selection.main.anchor, view.selection.main.head]).toEqual([
            selection.anchor,
            selection.head,
          ])
          expect(onEdit).not.toHaveBeenCalled()
        } finally {
          view.destroy()
        }
      })
    it('host mode leaves only the proxy in sequential focus order, including readonly', async () => {
      for (const editable of [true, false]) {
        const parent = document.createElement('main')
        document.body.append(parent)
        const view = new SourceDocumentView({
          parent,
          mode,
          editable,
          onFocusNavigation: vi.fn(),
          source: new MemoryDocumentSource({ documentId: 'focus-stops', text: 'plain' }),
          backgroundMarkdownWarmup: false,
        })
        try {
          await view.renderVisibleWindow()
          expect(view.dom.tabIndex).toBe(-1)
          expect(view.inputDOM.tabIndex).toBe(0)
          expect(
            Array.from(parent.querySelectorAll<HTMLElement>('[tabindex]')).filter(
              (el) => el.tabIndex >= 0,
            ),
          ).toEqual([view.inputDOM])
          view.dom.focus()
          expect(document.activeElement).toBe(view.dom)
        } finally {
          view.destroy()
          parent.remove()
        }
      }
    })
  })

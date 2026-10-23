import {
  ChangeSet,
  EditorState,
  MemoryDocumentSource,
  MemoryTextDocument,
  Selection,
} from '@milkup/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EditorView } from '../editor-view'
import { SourceDocumentView, type SourceDocumentEdit } from '../source-document-view'
import { sourcePositionToVisualOffsetInLine } from '../source-position-mapping'

const views: Array<EditorView | SourceDocumentView> = []
afterEach(() => {
  views.splice(0).forEach((view) => view.destroy())
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

async function setup(
  kind: 'ordinary' | 'windowed',
  text = '',
  mode: 'source' | 'live' = 'live',
  selection = Selection.cursor(text.length),
  editable = true,
) {
  let state = new EditorState({ doc: new MemoryTextDocument(text), selection })
  let version = 0
  const edits: SourceDocumentEdit[] = []
  const source = () =>
    new MemoryDocumentSource({ documentId: 'list-input', document: state.doc, version })
  const view =
    kind === 'ordinary'
      ? new EditorView({ parent: document.body, state, mode, editable })
      : new SourceDocumentView({
          parent: document.body,
          source: source(),
          mode,
          editable,
          backgroundMarkdownWarmup: false,
          virtualViewport: { enabled: true, viewportHeight: 120, overscanLines: 6 },
          onEdit(edit) {
            edits.push(edit)
            state = state.applyTransaction({
              changes: ChangeSet.replace(edit.from, edit.to, edit.insert),
              ...(edit.selectionAfter ? { selection: edit.selectionAfter } : {}),
              ...(edit.historyGroup ? { historyGroup: edit.historyGroup } : {}),
            })
            version++
            ;(view as SourceDocumentView).updateSource(source())
          },
        })
  views.push(view)
  const current = () => (view instanceof EditorView ? view.state : state)
  const flush = async () => {
    if (view instanceof SourceDocumentView) {
      await view.flushPendingEdits()
      await view.renderVisibleWindow()
    }
  }
  const replaceState = async (next: EditorState) => {
    if (view instanceof EditorView) view.updateState(next)
    else {
      state = next
      version++
      view.updateSource(source())
      await view.revealSelection(
        state.doc.lineAt(state.selection.main.head).number,
        state.selection,
      )
    }
  }
  const select = async (next: Selection) => {
    await replaceState(current().applyTransaction({ selection: next }))
  }
  const key = async (key: string, shiftKey = false) => {
    view.inputDOM.dispatchEvent(
      new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true }),
    )
    await flush()
  }
  const type = async (text: string) => {
    for (const character of text) await key(character)
  }
  if (view instanceof SourceDocumentView)
    await view.revealSelection(state.doc.lineAt(selection.main.head).number, selection)
  return { view, current, flush, select, key, type, replaceState, edits }
}

describe('ordinary empty-task projection fallback', () => {
  it.each([' ', 'x', 'X'])(
    'matches read-only checkbox presentation for [%s] when DOM geometry is unavailable',
    async (check) => {
      // Force overlay placement through its projection fallback, even if the
      // test DOM gains layout support. The public coordinate helpers use the
      // same projection independently of the rendered DOM.
      vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect())
      const text = `- [${check}]`
      const s = await setup('ordinary', text, 'live', Selection.cursor(text.length), false)
      const view = s.view as EditorView
      const state = view.state
      const cursor = () => view.cursorLayerDOM.querySelector<HTMLElement>('.milkup-cursor')!
      const task = () => view.contentDOM.querySelector<HTMLButtonElement>('[role="checkbox"]')
      const expectReadOnlyProjection = () => {
        expect(task()?.disabled).toBe(true)
        expect(task()?.getAttribute('aria-checked')).toBe(String(check !== ' '))
        expect(cursor().dataset.offset).toBe('0')
        expect(cursor().style.left).toBe('0px')
        expect(view.positionToRect(text.length, { charWidth: 8 }).left).toBe(0)
        expect(view.coordinateToPosition({ x: 0, y: 0 }, { charWidth: 8 })).toBe(text.length)
        expect(view.coordinateToPosition({ x: 8, y: 0 }, { charWidth: 8 })).toBe(text.length)
      }

      expectReadOnlyProjection()
      view.setEditable(true)
      expect(task()).toBeNull()
      expect(cursor().dataset.offset).toBe('3')
      expect(cursor().style.left).toBe('24px')
      expect(view.positionToRect(text.length, { charWidth: 8 }).left).toBe(24)
      expect(view.coordinateToPosition({ x: 0, y: 0 }, { charWidth: 8 })).toBe(2)
      expect(view.coordinateToPosition({ x: 8, y: 0 }, { charWidth: 8 })).toBe(3)

      view.setEditable(false)
      expectReadOnlyProjection()
      expect(view.state).toBe(state)
    },
  )
})

for (const kind of ['ordinary', 'windowed'] as const) {
  describe(`${kind} list input presentation`, () => {
    for (const bullet of ['-', '*', '+'])
      for (const check of [' ', 'x', 'X'])
        it(`waits for both separators while typing ${bullet} [${check}] one key at a time`, async () => {
          const s = await setup(kind)
          let expected = ''
          for (const character of `${bullet} [${check}] `) {
            expected += character
            await s.key(character)
            expect(s.current().doc.text).toBe(expected)
            expect(s.current().selection.main.head).toBe(expected.length)
            const line = s.view.contentDOM.querySelector<HTMLElement>('[data-line="1"]')!
            if (expected.length === 1) {
              expect(line.textContent).toBe(bullet)
              expect(line.classList.contains('milkup-block-list')).toBe(false)
              expect(line.querySelector('.milkup-list-marker')).toBeNull()
            } else {
              expect(line.querySelector('.milkup-list-marker')?.textContent).toBe('•')
            }
            const task = line.querySelector<HTMLElement>('[role="checkbox"]')
            if (expected.length < 6) {
              expect(task).toBeNull()
              if (expected.length > 2) expect(line.textContent).toContain(expected.slice(2))
            } else {
              expect(task?.getAttribute('aria-checked')).toBe(String(check !== ' '))
              expect([task?.dataset.from, task?.dataset.to]).toEqual(['2', '6'])
              expect(
                line
                  .querySelector('.milkup-list-marker')
                  ?.classList.contains('milkup-marker-hidden'),
              ).toBe(true)
            }
          }
        })

    it('keeps the bare bullet addressable before and after its source character', async () => {
      const s = await setup(kind)
      await s.key('-')
      const line = s.view.contentDOM.querySelector<HTMLElement>('[data-line="1"]')!
      expect(sourcePositionToVisualOffsetInLine(line, 0)).toBe(0)
      expect(sourcePositionToVisualOffsetInLine(line, 1)).toBe(1)
      if (s.view instanceof EditorView) {
        expect(s.view.coordinateToPosition({ x: 0, y: 0 })).toBe(0)
        expect(s.view.coordinateToPosition({ x: 8, y: 0 })).toBe(1)
      }
      line.getBoundingClientRect = () => new DOMRect(0, 0, 100, 20)
      line.dispatchEvent(
        new MouseEvent(kind === 'ordinary' ? 'mousedown' : 'pointerdown', {
          bubbles: true,
          button: 0,
          clientX: 0,
          clientY: 10,
        }),
      )
      await s.flush()
      expect(
        (s.view instanceof EditorView ? s.view.state.selection : s.view.selection).main.head,
      ).toBe(0)
      expect(s.current().doc.text).toBe('-')
    })

    it('reverses incomplete prefixes by Backspace and reprojects undo/redo without rewriting text', async () => {
      const s = await setup(kind)
      await s.type('- [ ]')
      for (const expected of ['- [ ', '- [', '- ']) {
        await s.key('Backspace')
        expect(s.current().doc.text).toBe(expected)
        expect(s.view.contentDOM.querySelector('[role="checkbox"]')).toBeNull()
      }
      // Keep the established empty-list Backspace action: exit the whole prefix.
      await s.key('Backspace')
      expect(s.current().doc.text).toBe('')
      await s.replaceState(s.current().undo())
      expect(s.current().doc.text).toBe('- ')
      expect(s.view.contentDOM.querySelector('.milkup-list-marker')?.textContent).toBe('•')
      await s.replaceState(s.current().redo())
      expect(s.current().doc.text).toBe('')
    })

    it('removes and restores the task separator with exact selection and isolated toggle history', async () => {
      const s = await setup(kind)
      await s.type('- [ ] ')
      await s.select(Selection.range(6, 5))
      await s.key('Backspace')
      expect(s.current().doc.text).toBe('- [ ]')
      expect(s.current().selection.main.head).toBe(5)
      expect(s.view.contentDOM.querySelector('[role="checkbox"]')).toBeNull()
      await s.replaceState(s.current().undo())
      expect(s.current().doc.text).toBe('- [ ] ')
      expect(s.current().selection).toEqual(Selection.range(6, 5))
      expect(s.view.contentDOM.querySelector('[role="checkbox"]')).not.toBeNull()
      await s.replaceState(s.current().redo())
      expect(s.view.contentDOM.querySelector('[role="checkbox"]')).toBeNull()
      await s.key(' ')
      const selection = s.current().selection
      s.view.contentDOM.querySelector<HTMLElement>('[role="checkbox"]')!.click()
      await s.flush()
      expect(s.current().doc.text).toBe('- [x] ')
      expect(s.current().selection).toEqual(selection)
      await s.replaceState(s.current().undo())
      expect(s.current().doc.text).toBe('- [ ] ')
      expect(
        s.view.contentDOM.querySelector('[role="checkbox"]')?.getAttribute('aria-checked'),
      ).toBe('false')
      await s.replaceState(s.current().redo())
      expect(s.current().doc.text).toBe('- [x] ')
    })

    it('preserves indented task offsets and ordinary indent/outdent history', async () => {
      const s = await setup(kind, '- parent\n  ')
      await s.key('-')
      let line = s.view.contentDOM.querySelector<HTMLElement>('[data-line="2"]')!
      expect(line.querySelector('.milkup-list-marker')).toBeNull()
      await s.type(' [x] child')
      line = s.view.contentDOM.querySelector<HTMLElement>('[data-line="2"]')!
      expect(line.querySelector<HTMLElement>('[role="checkbox"]')?.dataset.from).toBe('13')
      const nested = s.current().doc.text
      await s.key('Tab', true)
      expect(s.current().doc.text).toBe('- parent\n- [x] child')
      await s.replaceState(s.current().undo())
      expect(s.current().doc.text).toBe(nested)
      expect(s.current().selection.main.head).toBe(nested.length)
      await s.key('Tab', true)
      await s.key('Tab')
      expect(s.current().doc.text).toBe(nested)
    })

    it('does not interpret an uncommitted composition as a bullet or task separator', async () => {
      const s = await setup(kind)
      await s.key('-')
      s.view.inputDOM.dispatchEvent(new CompositionEvent('compositionstart'))
      s.view.inputDOM.value = ' '
      s.view.inputDOM.dispatchEvent(new CompositionEvent('compositionupdate', { data: ' ' }))
      expect(s.current().doc.text).toBe('-')
      expect(s.view.contentDOM.querySelector('.milkup-list-marker')).toBeNull()
      s.view.inputDOM.dispatchEvent(new CompositionEvent('compositionend', { data: ' ' }))
      await s.flush()
      expect(s.current().doc.text).toBe('- ')
      await s.type('[ ]')
      s.view.inputDOM.dispatchEvent(new CompositionEvent('compositionstart'))
      s.view.inputDOM.value = ' '
      s.view.inputDOM.dispatchEvent(new CompositionEvent('compositionupdate', { data: ' ' }))
      expect(s.current().doc.text).toBe('- [ ]')
      expect(s.view.contentDOM.querySelector('[role="checkbox"]')).toBeNull()
      s.view.inputDOM.dispatchEvent(new CompositionEvent('compositionend', { data: ' ' }))
      await s.flush()
      expect(s.current().doc.text).toBe('- [ ] ')
      expect(s.view.contentDOM.querySelector('[role="checkbox"]')).not.toBeNull()
    })

    it.each(['source', 'code'] as const)(
      'keeps every typed prefix literal in %s',
      async (context) => {
        const prefix = context === 'code' ? '```\n' : ''
        const suffix = context === 'code' ? '\n```' : ''
        const s = await setup(
          kind,
          prefix + suffix,
          context === 'source' ? 'source' : 'live',
          Selection.cursor(prefix.length),
        )
        let inserted = ''
        for (const character of '- [ ] ') {
          inserted += character
          await s.key(character)
          expect(s.current().doc.text).toBe(prefix + inserted + suffix)
          expect(
            s.view.contentDOM.querySelector('.milkup-list-marker, [role="checkbox"]'),
          ).toBeNull()
        }
      },
    )

    it('requires horizontal whitespace immediately after the closing task bracket', async () => {
      const s = await setup(kind)
      await s.type('- [x]word ')
      expect(s.view.contentDOM.querySelector('[role="checkbox"]')).toBeNull()
      expect(s.current().doc.text).toBe('- [x]word ')
    })

    it('keeps loaded empty tasks and refreshes Home/End/arrow presentation without a document revision', async () => {
      const text = '- [ ]\nnext'
      const s = await setup(kind, text, 'live', Selection.cursor(0))
      const doc = s.current().doc
      expect(s.view.contentDOM.querySelector('[role="checkbox"]')).not.toBeNull()
      const keyWithoutWindowRefresh = async (key: string) => {
        s.view.inputDOM.dispatchEvent(
          new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
        )
        if (s.view instanceof SourceDocumentView) await s.view.flushPendingEdits()
      }
      await keyWithoutWindowRefresh('End')
      expect(s.view.contentDOM.querySelector('[role="checkbox"]')).toBeNull()
      expect(s.view.contentDOM.querySelector('[data-line="1"]')?.textContent).toContain('[ ]')
      await keyWithoutWindowRefresh('Home')
      expect(s.view.contentDOM.querySelector('[role="checkbox"]')).not.toBeNull()
      await keyWithoutWindowRefresh('End')
      expect(s.view.contentDOM.querySelector('[role="checkbox"]')).toBeNull()
      await keyWithoutWindowRefresh('ArrowDown')
      expect(s.view.contentDOM.querySelector('[role="checkbox"]')).not.toBeNull()
      expect(s.current().doc).toBe(doc)
      expect(s.current().doc.text).toBe(text)
      expect(s.current().history.canUndo).toBe(false)
      expect(s.edits).toHaveLength(0)
    })

    it('updates collapsed and reversed host selections without changing the source version', async () => {
      const s = await setup(kind, '- [x]', 'live', Selection.cursor(0))
      const doc = s.current().doc
      const selectWithoutSourceUpdate = (selection: Selection) => {
        if (s.view instanceof EditorView)
          s.view.updateState(s.view.state.applyTransaction({ selection }))
        else s.view.setSelection(selection)
      }
      selectWithoutSourceUpdate(Selection.cursor(5))
      await vi.waitFor(() =>
        expect(s.view.contentDOM.querySelector('[role="checkbox"]')).toBeNull(),
      )
      selectWithoutSourceUpdate(Selection.range(5, 2))
      await vi.waitFor(() =>
        expect(s.view.contentDOM.querySelector('[role="checkbox"]')).not.toBeNull(),
      )
      selectWithoutSourceUpdate(Selection.cursor(5))
      await vi.waitFor(() =>
        expect(s.view.contentDOM.querySelector('[role="checkbox"]')).toBeNull(),
      )
      selectWithoutSourceUpdate(Selection.cursor(0))
      await vi.waitFor(() =>
        expect(s.view.contentDOM.querySelector('[role="checkbox"]')).not.toBeNull(),
      )
      expect(s.current().doc).toBe(doc)
      expect(s.edits).toHaveLength(0)
    })

    it('preserves empty-task read-only presentation and updates editability without altering text', async () => {
      const s = await setup(kind, '- [X]', 'live', Selection.cursor(5), false)
      const doc = s.current().doc
      const task = () => s.view.contentDOM.querySelector<HTMLButtonElement>('[role="checkbox"]')
      expect(task()?.getAttribute('aria-checked')).toBe('true')
      expect(task()?.disabled).toBe(true)
      s.view.setEditable(true)
      await vi.waitFor(() => expect(task()).toBeNull())
      s.view.setEditable(false)
      await vi.waitFor(() => expect(task()?.disabled).toBe(true))
      expect(task()?.getAttribute('aria-checked')).toBe('true')
      expect(s.current().doc).toBe(doc)
      expect(s.edits).toHaveLength(0)
    })

    it('retains ordered-marker compatibility and loaded tab-delimited tasks', async () => {
      const s = await setup(kind, '1.\n-\t[x]\t', 'live', Selection.cursor(0))
      expect(
        s.view.contentDOM.querySelector('[data-line="1"] .milkup-list-marker')?.textContent,
      ).toBe('1.')
      expect(
        s.view.contentDOM
          .querySelector('[data-line="2"] [role="checkbox"]')
          ?.getAttribute('aria-checked'),
      ).toBe('true')
    })
  })
}

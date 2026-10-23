import {
  ChangeSet,
  EditorState,
  MemoryDocumentSource,
  MemoryTextDocument,
  Selection,
} from '@milkup/core'
import { afterEach, expect, it } from 'vitest'
import { EditorView } from '../editor-view'
import { SourceDocumentView, type SourceDocumentEdit } from '../source-document-view'

const views: Array<EditorView | SourceDocumentView> = []
afterEach(() => {
  views.splice(0).forEach((view) => view.destroy())
  document.body.replaceChildren()
})

async function setup(
  kind: 'ordinary' | 'windowed',
  mode: 'source' | 'live',
  text: string,
  selection: Selection,
) {
  let state = new EditorState({ doc: new MemoryTextDocument(text), selection })
  const edits: SourceDocumentEdit[] = []
  const source = () =>
    new MemoryDocumentSource({
      documentId: 'ime-preedit',
      document: state.doc,
      version: edits.length,
    })
  const view =
    kind === 'ordinary'
      ? new EditorView({ parent: document.body, mode, state })
      : new SourceDocumentView({
          parent: document.body,
          source: source(),
          mode,
          editable: true,
          backgroundMarkdownWarmup: false,
          onEdit(edit) {
            edits.push(edit)
            state = state.applyTransaction({
              changes: ChangeSet.replace(edit.from, edit.to, edit.insert),
              ...(edit.selectionAfter ? { selection: edit.selectionAfter } : {}),
              ...(edit.historyGroup ? { historyGroup: edit.historyGroup } : {}),
            })
            ;(view as SourceDocumentView).updateSource(source())
          },
          virtualViewport: { enabled: true, viewportHeight: 120, overscanLines: 6 },
        })
  views.push(view)
  if (view instanceof SourceDocumentView)
    await view.revealSelection(state.doc.lineAt(selection.main.head).number, selection)
  const flush = async () => {
    if (view instanceof SourceDocumentView) await view.flushPendingEdits()
  }
  const current = () => (view instanceof EditorView ? view.state : state)
  return { view, edits, flush, current }
}

for (const kind of ['ordinary', 'windowed'] as const)
  for (const blurOrder of ['before-end', 'after-end'] as const)
    for (const outcome of ['commit', 'cancel'] as const)
      it(`${kind} ${blurOrder} ${outcome} handles late final input notifications exactly once`, async () => {
        const text = '原😀文\r\nnext'
        const s = await setup(kind, 'live', text, Selection.range(4, 0))
        const input = s.view.inputDOM
        const before = s.current()
        const other = document.createElement('button')
        document.body.append(other)
        input.focus()
        input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
        input.value = 'ni'
        input.dispatchEvent(
          new CompositionEvent('compositionupdate', { data: 'ni', bubbles: true }),
        )
        input.dispatchEvent(
          new InputEvent('input', {
            data: 'ni',
            inputType: 'insertCompositionText',
            isComposing: true,
            bubbles: true,
          }),
        )
        if (blurOrder === 'before-end') {
          other.focus()
          expect(document.activeElement).toBe(other)
          expect(s.current()).toBe(before)
          expect(s.view.isComposing).toBe(true)
        }

        const final = outcome === 'commit' ? '你' : ''
        input.value = final
        input.dispatchEvent(new CompositionEvent('compositionend', { data: final, bubbles: true }))
        if (blurOrder === 'after-end') other.focus()
        // The end handler owns the commit and clears the native proxy. A final
        // input notification reports that same mutation; it does not replay it.
        const notifyFinalInput = () =>
          input.dispatchEvent(
            new InputEvent('input', {
              data: final,
              inputType: 'insertText',
              bubbles: true,
            }),
          )
        notifyFinalInput()
        await s.flush()
        notifyFinalInput()
        await s.flush()

        const expected = outcome === 'commit' ? '你\r\nnext' : text
        expect(s.current().doc.text).toBe(expected)
        expect(s.current().undo().doc.text).toBe(text)
        if (outcome === 'cancel') expect(s.current()).toBe(before)
        if (kind === 'windowed') expect(s.edits).toHaveLength(outcome === 'commit' ? 1 : 0)
        expect(s.view.isComposing).toBe(false)
        expect(s.view.cursorLayerDOM.querySelector('.milkup-composition')).toBeNull()
        expect(s.view.inputDOM).toBe(input)
        expect(input.value).toBe('')
        expect(document.activeElement).toBe(other)

        // Refocusing and committing the same character is a new transaction,
        // not a duplicate of the previous composition or a cancelled preedit.
        input.focus()
        input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
        input.value = 'ni'
        input.dispatchEvent(
          new CompositionEvent('compositionupdate', { data: 'ni', bubbles: true }),
        )
        input.value = '你'
        input.dispatchEvent(new CompositionEvent('compositionend', { data: '你', bubbles: true }))
        notifyFinalInput()
        await s.flush()
        const next = outcome === 'commit' ? '你你\r\nnext' : '你\r\nnext'
        expect(s.current().doc.text).toBe(next)
        expect(s.current().undo().doc.text).toBe(expected)
        expect(s.current().undo().redo().doc.text).toBe(next)
        expect(document.activeElement).toBe(input)
      })
for (const kind of ['ordinary', 'windowed'] as const)
  for (const mode of ['source', 'live'] as const) {
    for (const context of ['paragraph', 'code'] as const)
      it(`${kind} ${mode} ${context} displays preedit without editing or replacing its native input`, async () => {
        const text = context === 'code' ? '```js\r\n// 原😀文\r\n```' : '原😀文\r\nnext'
        const position = text.indexOf('原')
        const s = await setup(kind, mode, text, Selection.cursor(position))
        const input = s.view.inputDOM
        input.focus()
        const selection = s.current().selection
        const history = s.current().history
        const revision = s.view.selectionRevision
        const anchor = { left: input.style.left, top: input.style.top, height: input.style.height }
        s.view.dom.style.backgroundColor = 'rgb(18, 24, 30)'
        const line = s.view.contentDOM.querySelector<HTMLElement>(
          `.milkup-line[data-line="${s.current().doc.lineAt(position).number}"]`,
        )!
        line.style.backgroundColor = 'rgba(220, 230, 240, 0.25)'
        line.style.fontSize = '19px'
        line.style.fontFamily = 'monospace'
        const overlay = () =>
          s.view.cursorLayerDOM.querySelector<HTMLElement>('.milkup-composition')
        input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
        for (const candidate of ['n', 'ni', 'n', '', 'ni']) {
          input.value = candidate
          input.dispatchEvent(
            new CompositionEvent('compositionupdate', { data: candidate, bubbles: true }),
          )
          input.dispatchEvent(
            new InputEvent('input', { data: candidate, isComposing: true, bubbles: true }),
          )
          await s.flush()
          if (candidate) {
            expect(overlay()?.textContent).toBe(candidate)
            const cursor = s.view.cursorLayerDOM.querySelector<HTMLElement>('.milkup-cursor')!
            expect(overlay()?.style.left).toBe(cursor.style.left)
            expect(overlay()?.style.top).toBe(cursor.style.top)
            expect(overlay()?.style.minHeight).toBe(cursor.style.height)
            expect(overlay()?.style.backgroundColor).toBe('rgb(18, 24, 30)')
            expect(overlay()?.style.fontSize).toBe('19px')
            expect(overlay()?.style.fontFamily).toBe('monospace')
          } else expect(overlay()).toBeNull()
          expect(s.current().doc.text).toBe(text)
          expect(s.current().selection).toBe(selection)
          expect(s.current().history).toBe(history)
          expect(s.view.selectionRevision).toBe(revision)
          expect(s.edits).toHaveLength(0)
          expect(s.view.inputDOM).toBe(input)
          expect(document.activeElement).toBe(input)
          expect({
            left: input.style.left,
            top: input.style.top,
            height: input.style.height,
          }).toEqual(anchor)
        }
        for (const key of ['Backspace', 'ArrowLeft', 'Enter'])
          input.dispatchEvent(
            new KeyboardEvent('keydown', { key, isComposing: true, bubbles: true }),
          )
        await s.view.refreshLayout()
        expect(overlay()?.textContent).toBe('ni')
        expect(input.value).toBe('ni')
        expect(s.view.inputDOM).toBe(input)
        expect(s.current().doc.text).toBe(text)
        input.dispatchEvent(new CompositionEvent('compositionend', { data: '你', bubbles: true }))
        await s.flush()
        const committed = text.slice(0, position) + '你' + text.slice(position)
        expect(s.current().doc.text).toBe(committed)
        expect(s.current().selection.main.head).toBe(position + 1)
        expect(s.current().undo().doc.text).toBe(text)
        expect(s.current().undo().redo().doc.text).toBe(committed)
        expect(s.view.isComposing).toBe(false)
        expect(overlay()).toBeNull()
        expect(input.value).toBe('')
        if (kind === 'windowed') expect(s.edits).toHaveLength(1)
      })

    it(`${kind} ${mode} clears cancelled preedit and retains the exact Unicode selection/history`, async () => {
      const text = '原😀文\r\nnext'
      const s = await setup(kind, mode, text, Selection.range(4, 0))
      const input = s.view.inputDOM
      const before = s.current()
      input.focus()
      input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
      input.value = 'zhong'
      input.dispatchEvent(
        new CompositionEvent('compositionupdate', { data: 'zhong', bubbles: true }),
      )
      expect(s.view.cursorLayerDOM.querySelector('.milkup-composition')?.textContent).toBe('zhong')
      input.dispatchEvent(new CompositionEvent('compositionend', { data: '', bubbles: true }))
      await s.flush()
      expect(s.view.cursorLayerDOM.querySelector('.milkup-composition')).toBeNull()
      expect(s.current()).toBe(before)
      expect(s.edits).toHaveLength(0)
      expect(s.view.isComposing).toBe(false)
      expect(input.value).toBe('')
      expect(document.activeElement).toBe(input)
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'X', bubbles: true }))
      await s.flush()
      expect(s.current().doc.text).toBe('X\r\nnext')
      expect(s.current().undo().doc.text).toBe(text)
    })
  }

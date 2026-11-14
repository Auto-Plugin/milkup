import {
  ChangeSet,
  EditorState,
  MemoryDocumentSource,
  MemoryTextDocument,
  Selection,
} from '@milkup/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EditorView } from '../editor-view'
import { SourceDocumentView } from '../source-document-view'
import type { DocumentPresentationConfig } from '../document-presentation'

const views: Array<EditorView | SourceDocumentView> = []
const releases: Array<() => void> = []
afterEach(() => {
  releases.splice(0).forEach((release) => release())
  views.splice(0).forEach((view) => view.destroy())
  vi.restoreAllMocks()
  document.body.replaceChildren()
})

const body = 'const 名 = "😀 <img src=x>"; // 原文保持'
const fixture = (eol: string) =>
  [
    '# Code selection',
    '',
    '```js title="demo"',
    body,
    'console.log(名)',
    '```',
    '',
    'After **中文😀** and `é 👩🏽‍💻`',
    '',
    '```js',
    'const later = "中文😀";',
    '```',
    '',
  ].join(eol)

async function setup(
  kind: 'ordinary' | 'windowed',
  text: string,
  selection: Selection,
  documentPresentation?: DocumentPresentationConfig,
) {
  let state = new EditorState({ doc: new MemoryTextDocument(text), selection })
  let version = 0
  const source = () =>
    new MemoryDocumentSource({ documentId: 'incremental-mapping', document: state.doc, version })
  let release!: () => void
  const gate = new Promise<void>((resolve) => (release = resolve))
  releases.push(release)
  let started!: () => void
  const committing = new Promise<void>((resolve) => (started = resolve))
  const view =
    kind === 'ordinary'
      ? new EditorView({
          parent: document.body,
          mode: 'live',
          state,
          ...(documentPresentation ? { documentPresentation } : {}),
        })
      : new SourceDocumentView({
          parent: document.body,
          source: source(),
          mode: 'live',
          editable: true,
          backgroundMarkdownWarmup: false,
          ...(documentPresentation ? { documentPresentation } : {}),
          virtualViewport: { enabled: true, viewportHeight: 500, overscanLines: 20 },
          async onEdit(edit) {
            started()
            await gate
            state = state.applyTransaction({
              changes: ChangeSet.replace(edit.from, edit.to, edit.insert),
              ...(edit.selectionAfter ? { selection: edit.selectionAfter } : {}),
              historyGroup: 'isolate',
            })
            version++
            ;(view as SourceDocumentView).updateSource(source())
          },
        })
  views.push(view)
  if (view instanceof SourceDocumentView)
    await view.revealSelection(state.doc.lineAt(selection.main.head).number, selection)
  const current = () => (view instanceof EditorView ? view.state : state)
  const edit = async (insert: string) => {
    if (insert) {
      view.inputDOM.value = insert
      view.inputDOM.dispatchEvent(new InputEvent('input', { bubbles: true, data: insert }))
    } else
      view.inputDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }))
    // Inspect the real optimistic DOM while the host commit is blocked. In
    // particular, do not call renderVisibleWindow() to hide stale reused ranges.
    if (view instanceof SourceDocumentView) await committing
  }
  const commit = async () => {
    const first = rows(view)[0]
    release()
    if (view instanceof SourceDocumentView) {
      await view.flushPendingEdits()
      // Wait for the host's updateSource render, without requesting a redraw.
      await vi.waitFor(() => expect(rows(view)[0]).not.toBe(first))
    }
  }
  const history = async (direction: 'undo' | 'redo') => {
    if (view instanceof EditorView) view.updateState(view.state[direction]())
    else {
      state = state[direction]()
      version++
      view.updateSource(source())
      await view.revealSelection(
        state.doc.lineAt(state.selection.main.head).number,
        state.selection,
      )
    }
  }
  return { view, current, edit, commit, history }
}

const rows = (view: EditorView | SourceDocumentView) =>
  Array.from(view.contentDOM.querySelectorAll<HTMLElement>('.milkup-line'))

// Compute UTF-16 offsets independently of the document/view implementation.
function sourceLines(text: string) {
  let from = 0
  return text.split('\n').map((raw, index) => {
    const content = raw.endsWith('\r') ? raw.slice(0, -1) : raw
    const line = { number: index + 1, from, to: from + content.length }
    from += raw.length + 1
    return line
  })
}

function assertSourceRanges(view: EditorView | SourceDocumentView, text: string) {
  const expected = sourceLines(text)
  expect(rows(view)).toHaveLength(expected.length)
  for (const row of rows(view)) {
    const line = expected[Number(row.dataset.line) - 1]!
    expect([Number(row.dataset.from), Number(row.dataset.to)]).toEqual([line.from, line.to])
    for (const span of Array.from(row.querySelectorAll<HTMLElement>('[data-from][data-to]'))) {
      const source = text.slice(Number(span.dataset.from), Number(span.dataset.to))
      expect(source === '' && span.textContent === '\u200b' ? '' : span.textContent).toBe(source)
    }
  }
  expect(view.contentDOM.querySelector('img')).toBeNull()
}

function assertCodeRanges(view: EditorView | SourceDocumentView, text: string) {
  const expected = sourceLines(text)
  for (const [first, last] of [
    [3, 6],
    [10, 12],
  ]) {
    for (const row of rows(view).slice(first! - 1, last)) {
      expect(Number(row.dataset.presentationBlockFrom)).toBe(expected[first! - 1]!.from)
      expect(Number(row.dataset.presentationBlockTo)).toBe(expected[last! - 1]!.to)
    }
  }
  for (const picker of Array.from(
    view.contentDOM.querySelectorAll<HTMLElement>('.milkup-code-language'),
  )) {
    const row = picker.closest<HTMLElement>('.milkup-line')!
    expect(Number(picker.dataset.codeFrom)).toBe(expected[Number(row.dataset.line) - 1]!.from)
  }
}

for (const kind of ['ordinary', 'windowed'] as const) {
  describe(`${kind} incremental live source mappings`, () => {
    it('maps clicks inside retained highlighted code and inline Unicode after replacement', async () => {
      const text = fixture('\r\n')
      const from = text.indexOf(body)
      const s = await setup(kind, text, Selection.range(from, from + body.length))
      await s.edit('native_selection_edit')
      const expected = text.replace(body, 'native_selection_edit')
      // Check the retained highlighted token before any host reconciliation.
      const code = s.view.contentDOM.querySelector<HTMLElement>(
        '[data-line="5"] .milkup-code-source',
      )!
      const token = Array.from(code.childNodes).find((node) => node.textContent === 'console')!
      const textNode = token instanceof Text ? token : token.firstChild!
      const descriptor = Object.getOwnPropertyDescriptor(document, 'caretPositionFromPoint')
      let targetNode: Node = textNode
      let offset = 3
      Object.defineProperty(document, 'caretPositionFromPoint', {
        configurable: true,
        value: () => ({ offsetNode: targetNode, offset }),
      })
      try {
        // Exercise the shared DOM-to-source mapping before the windowed commit.
        const { sourcePositionFromPoint } = await import('../source-position-mapping')
        expect(
          sourcePositionFromPoint(code.closest('.milkup-line')!, new MouseEvent('click')),
        ).toBe(expected.indexOf('console') + 3)
        await s.commit()
        const inline = s.view.contentDOM.querySelector<HTMLElement>('[data-line="8"]')!
        const walker = document.createTreeWalker(inline, NodeFilter.SHOW_TEXT)
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          if (node.textContent?.includes('👩🏽‍💻')) targetNode = node
        }
        offset = (targetNode.textContent ?? '').indexOf('👩🏽‍💻') + '👩🏽‍💻'.length
        targetNode.parentElement!.dispatchEvent(
          new MouseEvent(kind === 'ordinary' ? 'click' : 'pointerdown', { bubbles: true }),
        )
        const selection = s.view instanceof EditorView ? s.view.state.selection : s.view.selection
        expect(selection.main.head).toBe(expected.indexOf('👩🏽‍💻') + '👩🏽‍💻'.length)
        expect(s.current().history.undoStack).toHaveLength(1)
      } finally {
        if (descriptor) Object.defineProperty(document, 'caretPositionFromPoint', descriptor)
        else Reflect.deleteProperty(document, 'caretPositionFromPoint')
      }
    })

    it('remaps saved source children when an earlier edit withdraws an inline preview', async () => {
      const text = 'before 中文😀\r\n\r\n$x$ after **中文😀**\r\n'
      const from = text.indexOf('$x$')
      const config: DocumentPresentationConfig = {
        provide: async ({
          sourceIdentity: _identity,
          sourceVersion,
          documentVersion: _version,
          visibleFrom: _from,
          visibleTo: _to,
          ...window
        }) => ({
          declarations: [{ id: 'mapping-math', contexts: ['text'] }],
          request: {
            ...window,
            documentId: 'incremental-mapping',
            version: 0,
            contextKnown: true,
            protectedRanges: [],
            blocks: [],
            theme: 'light',
            target: 'screen',
          },
          result: {
            complete: true,
            fragments:
              sourceVersion === 0
                ? [
                    {
                      from,
                      to: from + 3,
                      layout: 'inline',
                      accessibleText: 'x',
                      content: {
                        type: 'math',
                        tree: { tag: 'math', children: [{ tag: 'mi', text: 'x' }] },
                      },
                    },
                  ]
                : [],
          },
        }),
      }
      const s = await setup(kind, text, Selection.cursor(0), config)
      await vi.waitFor(() =>
        expect(s.view.contentDOM.querySelector('[data-document-presentation]')).not.toBeNull(),
      )
      const retained = rows(s.view)[2]
      await s.edit('新😀')
      expect(rows(s.view)[2]).toBe(retained)
      expect(s.view.contentDOM.querySelector('[data-document-presentation]')).toBeNull()
      assertSourceRanges(s.view, '新😀' + text)
      await s.commit()
      expect(s.current().doc.text).toBe('新😀' + text)
    })

    it('keeps the retained later language control attached to its shifted fence', async () => {
      const text = fixture('\r\n')
      const from = text.indexOf(body)
      const s = await setup(kind, text, Selection.range(from, from + body.length))
      const later =
        s.view.contentDOM.querySelectorAll<HTMLSelectElement>('.milkup-code-language')[1]!
      await s.edit('native_selection_edit')
      const expected = text.replace(body, 'native_selection_edit')
      expect(s.view.contentDOM.querySelectorAll('.milkup-code-language')[1]).toBe(later)
      expect(Number(later.dataset.codeFrom)).toBe(
        expected.indexOf('```js', expected.indexOf('```js') + 1),
      )
      await s.commit()
      const picker =
        s.view.contentDOM.querySelectorAll<HTMLSelectElement>('.milkup-code-language')[1]!
      picker.value = 'python'
      picker.dispatchEvent(new Event('change', { bubbles: true }))
      if (s.view instanceof SourceDocumentView) await s.view.flushPendingEdits()
      expect(s.current().doc.text).toBe(expected.replace('```js\r\n', '```python\r\n'))
      expect(s.current().doc.text).toContain('```js title="demo"')
    })

    for (const eol of ['\n', '\r\n']) {
      for (const operation of ['replace', 'insert', 'delete'] as const) {
        it(`${operation} preserves reused code/inline ranges and history with ${JSON.stringify(eol)}`, async () => {
          const text = fixture(eol)
          const from = text.indexOf(body)
          const to = operation === 'insert' ? from : from + body.length
          const insert =
            operation === 'delete'
              ? ''
              : operation === 'replace'
                ? 'native_selection_edit'
                : '汉字🧑🏾‍🚀é'
          const selection = Selection.range(to, from)
          const s = await setup(kind, text, selection)
          const before = rows(s.view)
          await s.edit(insert)
          const expected = text.slice(0, from) + insert + text.slice(to)
          expect(rows(s.view).every((row, index) => index === 3 || row === before[index])).toBe(
            true,
          )
          assertSourceRanges(s.view, expected)
          assertCodeRanges(s.view, expected)
          expect(
            Number(
              s.view.cursorLayerDOM.querySelector<HTMLElement>('.milkup-cursor')!.dataset.position,
            ),
          ).toBe(from + insert.length)
          await s.commit()
          expect(s.current().doc.text).toBe(expected)
          expect(s.current().history.undoStack).toHaveLength(1)
          await s.history('undo')
          expect(s.current().doc.text).toBe(text)
          expect(s.current().selection).toEqual(selection)
          assertSourceRanges(s.view, text)
          assertCodeRanges(s.view, text)
          await s.history('redo')
          expect(s.current().doc.text).toBe(expected)
          expect(s.current().selection.main.head).toBe(from + insert.length)
          assertSourceRanges(s.view, expected)
          assertCodeRanges(s.view, expected)
        })
      }
    }
  })
}

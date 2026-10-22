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

const views: Array<EditorView | SourceDocumentView> = []
afterEach(() => {
  views.splice(0).forEach((view) => view.destroy())
  vi.restoreAllMocks()
})

async function setup(
  kind: 'ordinary' | 'windowed',
  text: string,
  selection = Selection.cursor(text.length),
) {
  let state = new EditorState({ doc: new MemoryTextDocument(text), selection })
  const edits: SourceDocumentEdit[] = []
  const source = () =>
    new MemoryDocumentSource({ documentId: 'controls', document: state.doc, version: edits.length })
  const view =
    kind === 'ordinary'
      ? new EditorView({ parent: document.body, mode: 'live', state })
      : new SourceDocumentView({
          parent: document.body,
          source: source(),
          mode: 'live',
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
    if (view instanceof SourceDocumentView) {
      await view.flushPendingEdits()
      await view.renderVisibleWindow()
    }
  }
  const current = () => (view instanceof EditorView ? view.state : state)
  return { view, edits, flush, current }
}

for (const kind of ['ordinary', 'windowed'] as const) {
  it(`${kind} highlights safe source text and changes only fence language with undo`, async () => {
    const text = '~~~js title="demo"\r\nconst 名 = "<img src=x onerror=alert(1)>😀"; // 注释\r\n~~~'
    const s = await setup(kind, text, Selection.range(text.length - 4, text.indexOf('名')))
    const picker = s.view.contentDOM.querySelector<HTMLSelectElement>('.milkup-code-language')!
    expect(picker).not.toBeNull()
    expect(picker.value).toBe('javascript')
    expect(s.view.contentDOM.querySelector('.milkup-code-token-keyword')?.textContent).toBe('const')
    expect(s.view.contentDOM.querySelector('img')).toBeNull()
    picker.value = 'python'
    picker.dispatchEvent(new Event('change', { bubbles: true }))
    await s.flush()
    expect(s.current().doc.text).toBe(text.replace('~~~js', '~~~python'))
    expect(s.current().selection.main.anchor).toBe(text.length)
    expect(s.current().selection.main.head).toBe(text.indexOf('名') + 4)
    expect(s.current().undo().doc.text).toBe(text)
    expect(s.current().undo().redo().doc.text).toBe(text.replace('~~~js', '~~~python'))
  })
}

for (const kind of ['ordinary', 'windowed'] as const) {
  it(`${kind} supports empty/incomplete fences and plain text without losing trailing metadata`, async () => {
    const s = await setup(kind, '```js title="demo"\n😀')
    let picker = s.view.contentDOM.querySelector<HTMLSelectElement>('.milkup-code-language')!
    picker.value = ''
    picker.dispatchEvent(new Event('change', { bubbles: true }))
    await s.flush()
    expect(s.current().doc.text).toBe('```text title="demo"\n😀')
    picker = s.view.contentDOM.querySelector<HTMLSelectElement>('.milkup-code-language')!
    expect(picker.value).toBe('')
    picker.value = 'json'
    picker.dispatchEvent(new Event('change', { bubbles: true }))
    await s.flush()
    expect(s.current().doc.text).toBe('```json title="demo"\n😀')
  })

  it(`${kind} isolates language history from typed Unicode and composition commits`, async () => {
    const text = '```js\nconst x = 1;\n```'
    const s = await setup(kind, text, Selection.cursor(text.indexOf('1')))
    s.view.inputDOM.dispatchEvent(new CompositionEvent('compositionstart'))
    let picker = s.view.contentDOM.querySelector<HTMLSelectElement>('.milkup-code-language')!
    picker.value = 'python'
    picker.dispatchEvent(new Event('change', { bubbles: true }))
    await s.flush()
    expect(s.current().doc.text).toBe(text)
    s.view.inputDOM.dispatchEvent(new CompositionEvent('compositionend', { data: '中文😀' }))
    await s.flush()
    const composed = text.replace('1', '中文😀1')
    expect(s.current().doc.text).toBe(composed)
    picker = s.view.contentDOM.querySelector<HTMLSelectElement>('.milkup-code-language')!
    picker.value = 'python'
    picker.dispatchEvent(new Event('change', { bubbles: true }))
    await s.flush()
    expect(s.current().doc.text).toBe(composed.replace('```js', '```python'))
    expect(s.current().undo().doc.text).toBe(composed)
    expect(s.current().undo().undo().doc.text).toBe(text)
    s.view.inputDOM.focus()
    s.view.inputDOM.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Z', bubbles: true, cancelable: true }),
    )
    await s.flush()
    expect(s.current().doc.text).toBe(
      composed.replace('```js', '```python').replace('中文😀1', '中文😀Z1'),
    )
  })

  it(`${kind} read-only and stale detached controls cannot mutate text`, async () => {
    const text = '```js\nconst x = 1;\n```'
    const s = await setup(kind, text)
    const picker = s.view.contentDOM.querySelector<HTMLSelectElement>('.milkup-code-language')!
    s.view.setEditable(false)
    expect(picker.disabled).toBe(true)
    picker.value = 'python'
    picker.dispatchEvent(new Event('change', { bubbles: true }))
    await s.flush()
    expect(s.current().doc.text).toBe(text)
    s.view.setEditable(true)
    picker.remove()
    picker.dispatchEvent(new Event('change', { bubbles: true }))
    await s.flush()
    expect(s.current().doc.text).toBe(text)
  })

  it(`${kind} bounds token nodes and keeps oversized and unknown language text intact`, async () => {
    const dense = '1 '.repeat(1500),
      long = 'const x = "' + '😀'.repeat(4096) + '"'
    const s = await setup(
      kind,
      '```js\n' + dense + '\n' + long + '\n```\n```unknown\nconst html = "<script>"\n```',
    )
    const rows = s.view.contentDOM.querySelectorAll('.milkup-code-source')
    expect(rows[1]?.textContent).toBe(dense)
    expect(rows[1]?.childElementCount).toBeLessThanOrEqual(256)
    expect(rows[2]?.textContent).toBe(long)
    expect(rows[2]?.childElementCount).toBe(0)
    expect(rows[5]?.textContent).toBe('const html = "<script>"')
    expect(rows[5]?.childElementCount).toBe(0)
    expect(s.view.contentDOM.querySelector('script')).toBeNull()
  })
}

import {
  ChangeSet,
  EditorState,
  MemoryDocumentSource,
  MemoryTextDocument,
  Selection,
} from '@milkup/core'
import { afterEach, expect, it } from 'vitest'
import { EditorView, SourceDocumentView, prepareTableEdit, prepareTableInsertion } from '../index'
import type { TableCommand } from '../table-editing'

const table = '| A | B | C |\r\n| :--- | --- | ---: |\r\n| 中文😀 | x | y |\r\n'
const views: Array<EditorView | SourceDocumentView> = []
afterEach(() => views.splice(0).forEach((view) => view.destroy()))

it('rejects an untrusted table command instead of falling through to column deletion', () => {
  const view = new EditorView({
    parent: document.createElement('main'),
    mode: 'live',
    state: new EditorState({
      doc: new MemoryTextDocument(table),
      selection: Selection.cursor(table.indexOf('中文')),
    }),
  })
  views.push(view)
  expect(view.runTableCommand('untrusted-operation' as TableCommand)).toBe(false)
  expect(view.state.doc.text).toBe(table)
})

for (const mode of ['source', 'live'] as const) {
  it(`runs explicit ordinary table operations in ${mode} with one undo transaction`, () => {
    const view = new EditorView({
      parent: document.createElement('main'),
      mode,
      state: new EditorState({
        doc: new MemoryTextDocument(table),
        selection: Selection.cursor(table.indexOf('中文')),
      }),
    })
    views.push(view)
    expect(view.runTableCommand('add-column')).toBe(true)
    expect(view.state.doc.text).toContain('| A |  | B | C |')
    expect(view.state.undo().doc.text).toBe(table)
  })
  it(`runs explicit windowed table operations in ${mode} against the complete table`, async () => {
    const text = table + '\r\n' + 'outside\r\n'.repeat(1000)
    let doc = new MemoryTextDocument(text),
      version = 0
    const source = () =>
      new MemoryDocumentSource({ documentId: 'public-table', document: doc, version })
    const view = new SourceDocumentView({
      parent: document.createElement('main'),
      source: source(),
      mode,
      editable: true,
      onEdit(edit) {
        doc = doc.apply(ChangeSet.replace(edit.from, edit.to, edit.insert)) as MemoryTextDocument
        version++
        view.updateSource(source())
      },
    })
    views.push(view)
    await view.revealSelection(3, Selection.cursor(text.indexOf('中文')))
    await view.runTableCommand('add-column')
    await view.flushPendingEdits()
    expect(doc.text).toContain('| A |  | B | C |')
    expect(doc.text.slice(doc.text.indexOf('\r\n\r\n'))).toBe(text.slice(text.indexOf('\r\n\r\n')))
  })
}

it('prepares alignment and clearing as bounded absolute plans without changing state', async () => {
  const text = 'prefix\r\n\r\n' + table + 'tail'
  const view = new EditorView({
    parent: document.createElement('main'),
    mode: 'source',
    state: new EditorState({
      doc: new MemoryTextDocument(text),
      selection: Selection.range(text.indexOf('中文'), text.indexOf('中文') + 4),
    }),
  })
  views.push(view)
  const context = await view.readEditingContext()
  expect(context.kind).toBe('table')
  expect(context.table?.row).toBe(1)
  expect(context.table?.alignment).toBe('left')
  const aligned = prepareTableEdit(context.table!, {
    operation: 'align-column',
    alignment: 'center',
  })!
  expect(aligned.changes).toHaveLength(1)
  expect(view.state.doc.apply(ChangeSet.of(aligned.changes)).text).toContain(
    '| :---: | --- | ---: |\r\n',
  )
  const cleared = prepareTableEdit(context.table!, { operation: 'clear-cell' })!
  expect(view.state.doc.apply(ChangeSet.of(cleared.changes)).text).toContain('|  | x | y |\r\n')
  const replaced = prepareTableEdit(context.table!, {
    operation: 'set-cell',
    text: '中文😀 | next\nline',
  })!
  expect(view.state.doc.apply(ChangeSet.of(replaced.changes)).text).toContain(
    '| 中文😀 \\| next<br>line | x | y |\r\n',
  )
  expect(view.state.doc.text).toBe(text)
  expect(prepareTableEdit(context.table!, { operation: 'untrusted' } as never)).toBeUndefined()
  expect(
    prepareTableEdit(context.table!, {
      operation: 'align-column',
      alignment: 'untrusted',
    } as never),
  ).toBeUndefined()
})

it('inserts the requested body rows with captured CRLF and rejects unbounded dimensions', () => {
  const context = { from: 10, text: 'before\r\nafter', selection: { anchor: 18, head: 18 } }
  const plan = prepareTableInsertion(context, 2, 3)!
  expect(plan.changes).toHaveLength(1)
  expect(plan.changes[0]?.insert).toBe(
    '\r\n|  |  |  |\r\n| --- | --- | --- |\r\n|  |  |  |\r\n|  |  |  |\r\n\r\n',
  )
  expect(prepareTableInsertion(context, 65, 3)).toBeUndefined()
  expect(prepareTableInsertion(context, 2, 17)).toBeUndefined()
  const singleLine = prepareTableInsertion(
    { from: 0, text: 'word', selection: { anchor: 0, head: 4 }, lineEnding: 'crlf' },
    1,
    2,
  )!
  expect(singleLine.changes[0]?.insert).toBe('|  |  |\r\n| --- | --- |\r\n|  |  |\r\n')
})

it('does not misclassify a table-looking block inside code and bounds far windowed syntax reads', async () => {
  const text = '```md\n' + table + '```\n' + 'tail\n'.repeat(500)
  const source = new MemoryDocumentSource({ documentId: 'bounded-context', text })
  const reads: Array<[number, number, number | undefined]> = []
  const read = source.readLineWindow.bind(source)
  source.readLineWindow = async (from, to, max) => {
    reads.push([from, to, max])
    return read(from, to, max)
  }
  const view = new SourceDocumentView({
    parent: document.createElement('main'),
    source,
    mode: 'source',
  })
  views.push(view)
  await view.renderVisibleWindow()
  reads.length = 0
  expect(
    await view.readEditingContext({ anchor: text.indexOf('中文'), head: text.indexOf('中文') }),
  ).toEqual({ kind: 'code', complete: true })
  expect(reads.every(([from, to, max]) => to - from + 1 <= 256 && max === 65536)).toBe(true)
  reads.length = 0
  expect(await view.readEditingContext({ anchor: text.length - 2, head: text.length - 2 })).toEqual(
    { kind: 'unknown', complete: false },
  )
  expect(reads).toHaveLength(0)
  const controller = new AbortController()
  controller.abort()
  await expect(view.readEditingContext(undefined, controller.signal)).rejects.toMatchObject({
    name: 'AbortError',
  })
})

it('keeps an EOF cursor inside an unfinished code block out of formatting context', async () => {
  const text = '```md\nunfinished 中文😀'
  const view = new EditorView({
    parent: document.createElement('main'),
    state: new EditorState({
      doc: new MemoryTextDocument(text),
      selection: Selection.cursor(text.length),
    }),
  })
  views.push(view)
  expect(await view.readEditingContext()).toEqual({ kind: 'code', complete: true })
})

for (const text of [
  '> ```md\n> code\n> ```',
  '- ```\n  code\n  ```',
  '- item\n    code',
  '<div>\ncode\n</div>',
]) {
  it(`does not claim plain-text safety inside unsupported container/HTML context: ${text}`, async () => {
    const view = new EditorView({
      parent: document.createElement('main'),
      state: new EditorState({
        doc: new MemoryTextDocument(text),
        selection: Selection.cursor(text.indexOf('code')),
      }),
    })
    views.push(view)
    expect((await view.readEditingContext()).kind).toBe(
      text === '- item\n    code' ? 'code' : 'unknown',
    )
  })
}

it('reads windowed syntax with a budget before any unbounded position-to-line access', async () => {
  const source = new MemoryDocumentSource({ documentId: 'bounded-only', text: 'paragraph\nnext' })
  const view = new SourceDocumentView({
    parent: document.createElement('main'),
    source,
    mode: 'source',
  })
  views.push(view)
  await view.renderVisibleWindow()
  source.lineAtPosition = async () => {
    throw new Error('Unbounded position read must not be used')
  }
  expect(await view.readEditingContext({ anchor: 2, head: 2 })).toEqual({
    kind: 'text',
    complete: true,
  })
})

it('prepares table exit using the captured suffix rather than inventing table EOF', async () => {
  const text = table + '\r\nfollowing'
  const view = new EditorView({
    parent: document.createElement('main'),
    state: new EditorState({
      doc: new MemoryTextDocument(text),
      selection: Selection.cursor(text.indexOf('中文')),
    }),
  })
  views.push(view)
  const context = (await view.readEditingContext()).table!
  const plan = prepareTableEdit(context, { operation: 'exit' }, text.slice(context.to))!
  expect(plan.changes).toEqual([])
  expect(plan.selectionAfter).toEqual({ anchor: context.to, head: context.to })
})

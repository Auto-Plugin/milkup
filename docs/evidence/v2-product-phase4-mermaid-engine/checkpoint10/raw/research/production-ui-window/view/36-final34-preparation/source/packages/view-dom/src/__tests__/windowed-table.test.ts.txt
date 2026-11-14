import {
  ChangeSet,
  MemoryDocumentSource,
  MemoryTextDocument,
  Selection,
  type TextDocument,
} from '@milkup/core'
import { parseMarkdown } from '@milkup/markdown'
import { afterEach, expect, it, vi } from 'vitest'
import { SourceDocumentView } from '../source-document-view'
import { WindowedTableReader, windowedTableLimits } from '../windowed-table'
const views: SourceDocumentView[] = []
afterEach(() => views.splice(0).forEach((view) => view.destroy()))
const table =
  '\n| Name | Value |\r\n| --- | --- |\r\n' +
  Array.from({ length: 96 }, (_, i) => `| r${i}中文😀 | v${i} |\r\n`).join('') +
  '\r\nafter'
async function setup(text = table) {
  let doc: TextDocument = new MemoryTextDocument(text),
    version = 0
  const source = () => new MemoryDocumentSource({ documentId: 'table', document: doc, version })
  const edits: Array<{
    from: number
    to: number
    insert: string
    deletedText: string
    selectionAfter?: Selection | undefined
    selectionBefore?: Selection | undefined
  }> = []
  const view = new SourceDocumentView({
    parent: document.createElement('main'),
    source: source(),
    mode: 'live',
    editable: true,
    virtualViewport: { enabled: true, viewportHeight: 126, lineHeight: 21, overscanLines: 2 },
    onEdit: (edit) => {
      edits.push(edit)
      doc = doc.apply(ChangeSet.replace(edit.from, edit.to, edit.insert))
      version++
      view.updateSource(source())
    },
  })
  views.push(view)
  await view.renderVisibleWindow()
  const select = async (from: number, to = from) =>
    view.revealSelection(doc.lineAt(to).number, Selection.range(from, to))
  const key = async (key: string, shiftKey = false) => {
    view.inputDOM.dispatchEvent(
      new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true }),
    )
    await view.flushPendingEdits()
    await view.renderVisibleWindow()
  }
  return { view, edits, select, key, text: () => doc.text }
}
it('recovers the full table across viewport boundaries without rendering every row', async () => {
  const s = await setup()
  await s.select(table.indexOf('r80'))
  expect(s.view.activeTable?.row).toBe(81)
  expect(s.view.contentDOM.querySelectorAll('.milkup-table-cell').length).toBeGreaterThan(0)
  expect(s.view.contentDOM.querySelectorAll('.milkup-line').length).toBeLessThan(30)
  await s.key('Tab')
  expect(s.view.selection.main.from).toBe(table.indexOf('v80'))
  await s.key('ArrowDown')
  expect(s.view.selection.main.head).toBe(table.indexOf('v80') + 3)
  await s.key('ArrowDown')
  expect(s.view.selection.main.head).toBe(table.indexOf('v81') + 3)
  await s.key('Home')
  expect(s.view.selection.main.head).toBe(table.indexOf('v81'))
  await s.key('Backspace')
  expect(s.text()).toBe(table)
})
it('keeps Unicode, escaped pipes, visual breaks and complete-column history atomic', async () => {
  const s = await setup()
  await s.select(table.indexOf('r80') + 3)
  await s.key('|')
  expect(s.text()).toContain('r80\\|中文😀')
  await s.key('Enter', true)
  expect(s.text()).toContain('r80\\|<br>中文😀')
  expect(s.view.contentDOM.querySelector('br')).not.toBeNull()
  for (const key of 'fast')
    s.view.inputDOM.dispatchEvent(
      new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
    )
  await s.view.flushPendingEdits()
  await s.view.renderVisibleWindow()
  expect(s.view.contentDOM.querySelector('br')).not.toBeNull()
  for (let i = 0; i < 4; i++) await s.key('Backspace')
  await s.key('Backspace')
  expect(s.text()).toContain('r80\\|中文😀')
  await s.view.runTableCommand('add-column')
  await s.view.flushPendingEdits()
  expect(
    parseMarkdown(s.text())
      .root.children?.find((n) => n.type === 'table')
      ?.children?.every((row) => row.children?.length === 3),
  ).toBe(true)
  const edit = s.edits.at(-1)!
  expect(edit.deletedText).toContain('Name')
  expect(edit.deletedText).toContain('r95')
  expect(edit.selectionAfter?.main.head).toBeGreaterThan(table.indexOf('r70'))
})
it('keeps typing queued during an asynchronous column command without dropping characters', async () => {
  const s = await setup()
  await s.select(table.indexOf('r90'))
  const pending = s.view.runTableCommand('add-row')
  for (const key of 'quick123')
    s.view.inputDOM.dispatchEvent(
      new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
    )
  await pending
  await s.view.flushPendingEdits()
  expect(s.text()).toContain('quick123')
})
it('preserves literal source and disables whole-table operations for an over-budget block or fenced code', async () => {
  for (const text of [
    '| A | B |\n| --- | --- |\n' + '| a | b |\n'.repeat(200),
    '```md\n' + table + '\n```',
  ]) {
    const s = await setup(text)
    await s.select(text.indexOf('| a') >= 0 ? text.indexOf('| a') : text.indexOf('r80'))
    expect(s.view.activeTable).toBeUndefined()
    expect(s.view.contentDOM.querySelector('.milkup-table-cell')).toBeNull()
    await s.view.runTableCommand('delete-column')
    await s.view.flushPendingEdits()
    expect(s.text()).toBe(text)
  }
})
it('checks allocation budgets and discards version changes during context loading', async () => {
  const reader = new WindowedTableReader(),
    source = new MemoryDocumentSource({
      documentId: 'budget',
      text: '| A | B |\n| --- | --- |\n| ' + 'x'.repeat(windowedTableLimits.text) + ' | b |',
    })
  const rectangular = (columns: number) =>
    `| ${Array.from({ length: columns }, (_, i) => `h${i}`).join(' | ')} |\n| ${Array(columns).fill('---').join(' | ')} |\n` +
    Array.from({ length: 126 }, () => `| ${Array(columns).fill('x').join(' | ')} |\n`).join('')
  expect(
    await reader.read(
      new MemoryDocumentSource({ documentId: 'limit-valid', text: rectangular(16) }),
      80,
    ),
  ).toBeDefined()
  expect(
    await reader.read(
      new MemoryDocumentSource({ documentId: 'limit-wide', text: rectangular(17) }),
      80,
    ),
  ).toBeUndefined()
  const read = vi.spyOn(source, 'readLineWindow')
  expect(await reader.read(source, 2)).toBeUndefined()
  expect(read.mock.calls.every((args) => args[2] !== undefined)).toBe(true)
  await expect(source.readLineWindow(1, 3, 1024)).rejects.toThrow('text budget')
  let version = 0
  const changing = {
    ...source.snapshot(),
    get version() {
      return version
    },
    readLineWindow: async (...args: Parameters<typeof source.readLineWindow>) => {
      const result = await source.readLineWindow(...args)
      version++
      return result
    },
    lineAtPosition: source.lineAtPosition.bind(source),
    positionAtLineOffset: source.positionAtLineOffset.bind(source),
    snapshot: source.snapshot.bind(source),
  }
  expect(await reader.read(changing, 1)).toBeUndefined()
})

it('keeps visual cell breaks during optimistic input while native reads are delayed', async () => {
  const s = await setup()
  await s.select(table.indexOf('r80') + 3)
  await s.key('Enter', true)
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const source = s.view.source,
    read = source.readLineWindow.bind(source)
  vi.spyOn(source, 'readLineWindow').mockImplementation(async (...args) => {
    await gate
    return read(...args)
  })
  const before = s.view.selection.main.head
  s.view.inputDOM.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'q', bubbles: true, cancelable: true }),
  )
  await vi.waitFor(() => expect(s.view.selection.main.head).toBe(before + 1))
  expect(s.view.contentDOM.querySelector('.milkup-line[data-line="84"] br')).not.toBeNull()
  release()
  await s.view.flushPendingEdits()
})

it('background table context parsing does not prematurely commit a typing batch', async () => {
  const s = await setup()
  await s.select(table.indexOf('r80') + 3)
  vi.useFakeTimers()
  try {
    s.view.inputDOM.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'q', bubbles: true, cancelable: true }),
    )
    for (let i = 0; i < 30; i++) await Promise.resolve()
    await s.view.warmMarkdownCacheAroundVisibleWindow()
    expect(s.edits).toHaveLength(0)
  } finally {
    vi.useRealTimers()
    await s.view.flushPendingEdits()
  }
  expect(s.text()).toContain('r80q中文😀')
})

it('respects an existing cell backslash when a pipe is typed as the next key', async () => {
  const s = await setup()
  await s.select(table.indexOf('r80') + 3)
  await s.key('\\')
  await s.key('|')
  expect(s.text()).toContain('r80\\|中文😀')
  expect(s.view.activeTable?.columnCount).toBe(2)
})

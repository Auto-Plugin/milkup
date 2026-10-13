import { EditorState, MemoryTextDocument, Selection } from '@milkup/core'
import { afterEach, describe, expect, it } from 'vitest'
import { EditorView } from '../index'

const table = '| Name | Value |\n| --- | --- |\n| A | 1 |\n| B | 2 |'
const views: EditorView[] = []
afterEach(() => views.splice(0).forEach((v) => v.destroy()))
function setup(position = table.indexOf('A'), text = table, mode: 'live' | 'source' = 'live') {
  const view = new EditorView({
    parent: document.createElement('main'),
    mode,
    state: new EditorState({
      doc: new MemoryTextDocument(text),
      selection: Selection.cursor(position),
    }),
  })
  views.push(view)
  return {
    view,
    text: () => view.state.doc.text,
    key: (key: string, shiftKey = false) => {
      const event = new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true })
      view.inputDOM.dispatchEvent(event)
      return event.defaultPrevented
    },
    undo: () => view.updateState(view.state.undo()),
    redo: () => view.updateState(view.state.redo()),
  }
}
describe('live table editing', () => {
  it('Tab selects the next cell without changing source', () => {
    const s = setup()
    expect(s.key('Tab')).toBe(true)
    expect(s.view.state.selection.main.from).toBe(table.indexOf('1'))
    expect(s.view.state.selection.main.to).toBe(table.indexOf('1') + 1)
    expect(s.text()).toBe(table)
  })
  it('Shift+Tab skips the delimiter row', () => {
    const s = setup()
    s.key('Tab', true)
    expect(s.view.state.selection.main.from).toBe(table.indexOf('Value'))
    expect(s.text()).toBe(table)
  })
  it('Enter goes down the same column without splitting the row', () => {
    const s = setup()
    s.key('Enter')
    expect(s.view.state.selection.main.from).toBe(table.indexOf('B'))
    expect(s.text()).toBe(table)
  })
  it('Tab at the last cell appends one row and undo/redo restores it', () => {
    const s = setup(table.lastIndexOf('2'))
    s.key('Tab')
    expect(s.text()).toBe(table + '\n|  |  |')
    s.undo()
    expect(s.text()).toBe(table)
    s.redo()
    expect(s.text()).toBe(table + '\n|  |  |')
  })
  it('Shift+Enter inserts a cell line break without adding a Markdown row', () => {
    const s = setup(table.indexOf('A') + 1)
    s.key('Enter', true)
    expect(s.text()).toBe(table.replace('A', 'A<br>'))
    s.undo()
    expect(s.text()).toBe(table)
  })
  it('a literal pipe does not silently add a column', () => {
    const s = setup(table.indexOf('A') + 1)
    s.key('|')
    expect(s.text()).toBe(table.replace('A', 'A\\|'))
  })
  it('Backspace at the cell start does not erase a separator', () => {
    const s = setup()
    s.key('Backspace')
    expect(s.text()).toBe(table)
  })
  it('Delete at the cell end does not erase a separator', () => {
    const s = setup(table.indexOf('A') + 1)
    s.key('Delete')
    expect(s.text()).toBe(table)
  })
  it('Escape exits after the table into a separate paragraph', () => {
    const s = setup()
    s.key('Escape')
    expect(s.text()).toBe(table + '\n\n')
    expect(s.view.state.selection.main.head).toBe(s.text().length)
  })
  it('source mode keeps literal Enter and source/live switching preserves selection', () => {
    const s = setup(table.indexOf('A'), table, 'source')
    s.key('Enter')
    expect(s.text()).toBe(table.replace('A', '\nA'))
    const range = s.view.state.selection.main
    s.view.setMode('live')
    s.view.setMode('source')
    expect(s.view.state.selection.main).toEqual(range)
  })
})

describe('explicit table structure commands', () => {
  it('adds/deletes a data row as separate undo steps', () => {
    const s = setup()
    expect(s.view.runTableCommand('add-row')).toBe(true)
    expect(s.text()).toBe(table.replace('| B |', '|  |  |\n| B |'))
    expect(s.view.runTableCommand('delete-row')).toBe(true)
    expect(s.text()).toBe(table)
    s.undo()
    expect(s.text()).toContain('|  |  |')
    s.undo()
    expect(s.text()).toBe(table)
    s.redo()
    expect(s.text()).toContain('|  |  |')
  })
  it('adds/deletes a column preserving cells and alignment', () => {
    const t = table.replace('| --- | --- |', '| :--- | ---: |')
    const s = setup(t.indexOf('A'), t)
    s.view.runTableCommand('add-column')
    expect(s.text()).toContain('| Name |  | Value |')
    expect(s.text()).toContain('| :--- | --- | ---: |')
    expect(s.text()).toContain('| A |  | 1 |')
    s.view.runTableCommand('delete-column')
    expect(s.text()).toBe(t)
    s.undo()
    s.undo()
    expect(s.text()).toBe(t)
  })
  it('never deletes the header or reduces a table below two columns', () => {
    const s = setup(2)
    expect(s.view.runTableCommand('delete-row')).toBe(false)
    expect(s.view.runTableCommand('delete-column')).toBe(false)
    expect(s.text()).toBe(table)
  })
  it('appends a row to a header-only table without losing its delimiter', () => {
    const t = '| A | B |\n| --- | --- |'
    const s = setup(2, t)
    s.view.runTableCommand('add-row')
    expect(s.text()).toBe(t + '\n|  |  |')
    s.view.runTableCommand('delete-row')
    expect(s.text()).toBe(t + '\n')
    s.undo()
    s.undo()
    expect(s.text()).toBe(t)
  })
  it('keeps CRLF and adjacent paragraphs during column/row changes', () => {
    const t = table.replaceAll('\n', '\r\n') + '\r\n\r\nafter'
    const s = setup(t.indexOf('A'), t)
    s.view.runTableCommand('add-column')
    expect(s.text()).not.toMatch(/(?<!\r)\n/)
    expect(s.text().endsWith('\r\n\r\nafter')).toBe(true)
    s.undo()
    expect(s.text()).toBe(t)
  })
  it('selects the table including the delimiter and preserves the source selection across modes', () => {
    const s = setup()
    s.view.runTableCommand('select-table')
    expect(s.view.state.selection.main.from).toBe(0)
    expect(s.view.state.selection.main.to).toBe(table.length)
    const selection = s.view.state.selection
    s.view.setMode('source')
    s.view.setMode('live')
    expect(s.view.state.selection).toEqual(selection)
    expect(s.text()).toBe(table)
  })
  it('keeps cross-cell selections intact instead of indenting or splitting the table', () => {
    const s = setup()
    s.view.updateState(
      new EditorState({
        doc: s.view.state.doc,
        selection: Selection.range(table.indexOf('A'), table.indexOf('2') + 1),
      }),
    )
    s.key('Tab')
    s.key('Enter')
    expect(s.text()).toBe(table)
    expect(s.view.state.selection.main.empty).toBe(false)
  })
  it('replaces the selected next cell and undoes typing independently of navigation', () => {
    const s = setup()
    s.key('Tab')
    s.key('x')
    expect(s.text()).toBe(table.replace('1', 'x'))
    s.undo()
    expect(s.text()).toBe(table)
    expect(s.view.state.selection.main.from).toBe(table.indexOf('1'))
  })
  it('pastes multiline content into one cell and undoes it as a unit', async () => {
    const s = setup(table.indexOf('A') + 1)
    const event = new Event('paste', { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'clipboardData', {
      value: {
        getData: (type: string) => (type === 'text/plain' ? 'one\ntwo|three' : ''),
        files: [],
      },
    })
    s.view.inputDOM.dispatchEvent(event)
    await Promise.resolve()
    expect(s.text()).toBe(table.replace('A', 'Aone<br>two\\|three'))
    s.undo()
    expect(s.text()).toBe(table)
  })
  it('deletes the inline break as one unit and restores it on undo', () => {
    const s = setup(table.indexOf('A') + 1)
    s.key('Enter', true)
    s.key('Backspace')
    expect(s.text()).toBe(table)
    s.undo()
    expect(s.text()).toContain('A<br>')
  })
  it('preserves an already typed pipe escape', () => {
    const s = setup(table.indexOf('A') + 1)
    s.key('\\')
    s.key('|')
    expect(s.text()).toBe(table.replace('A', 'A\\|'))
  })
  it('does not modify a readonly or composing table', () => {
    const s = setup()
    s.view.setEditable(false)
    expect(s.view.runTableCommand('add-row')).toBe(false)
    s.key('Tab')
    expect(s.text()).toBe(table)
    s.view.setEditable(true)
    s.view.inputDOM.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
    expect(s.view.runTableCommand('add-column')).toBe(false)
    expect(s.text()).toBe(table)
  })
})

it('does not capture Tab/Enter on the empty line after a trailing table newline', () => {
  const text = table + '\n'
  const s = setup(text.length, text)
  expect(s.view.activeTable).toBeUndefined()
  expect(s.key('Tab')).toBe(false)
  s.key('Enter')
  expect(s.text()).toBe(text + '\n')
})

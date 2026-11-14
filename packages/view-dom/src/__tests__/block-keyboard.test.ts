import { EditorState, MemoryTextDocument, Selection } from '@milkup/core'
import { afterEach, describe, expect, it } from 'vitest'
import { EditorView } from '../index'

const views: EditorView[] = []
afterEach(() => views.splice(0).forEach((view) => view.destroy()))
function setup(text: string, mode: 'source' | 'live', selection = Selection.cursor(text.length)) {
  const view = new EditorView({
    parent: document.createElement('main'),
    mode,
    state: new EditorState({ doc: new MemoryTextDocument(text), selection }),
  })
  views.push(view)
  const key = (key: string, shiftKey = false) => {
    const event = new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true })
    view.inputDOM.dispatchEvent(event)
    return event.defaultPrevented
  }
  return {
    view,
    key,
    text: () => view.state.doc.text,
    undo: () => view.updateState(view.state.undo()),
  }
}
for (const mode of ['source', 'live'] as const) {
  describe(`${mode} daily block keyboard`, () => {
    for (const marker of ['- ', '1. ', '- [ ] ']) {
      it(`exits an empty ${marker} item without another marker`, () => {
        const s = setup(`- parent\n${marker}`, mode)
        s.key('Enter')
        expect(s.text()).toBe('- parent\n')
        s.undo()
        expect(s.text()).toBe(`- parent\n${marker}`)
      })
    }
    it('outdents an empty nested item before exiting the list', () => {
      const s = setup('- parent\n  - ', mode)
      s.key('Enter')
      expect(s.text()).toBe('- parent\n- ')
      s.key('Enter')
      expect(s.text()).toBe('- parent\n')
      s.undo()
      expect(s.text()).toBe('- parent\n- ')
      s.undo()
      expect(s.text()).toBe('- parent\n  - ')
    })
    it('continues ordered and task items', () => {
      const s = setup('  09. [x] done', mode)
      s.key('Enter')
      expect(s.text()).toBe('  09. [x] done\n  10. [ ] ')
    })
    it('does not duplicate a marker when splitting before it', () => {
      const s = setup('- item', mode, Selection.cursor(0))
      s.key('Enter')
      expect(s.text()).toBe('\n- item')
    })
    it('Tab and Shift+Tab nest a list while preserving caret and undo', () => {
      const s = setup('- item', mode)
      expect(s.key('Tab')).toBe(true)
      expect(s.text()).toBe('  - item')
      expect(s.view.state.selection.main.head).toBe(8)
      s.view.setMode(mode === 'live' ? 'source' : 'live')
      expect(s.view.state.selection.main.head).toBe(8)
      expect(s.key('Tab', true)).toBe(true)
      expect(s.text()).toBe('- item')
      s.undo()
      expect(s.text()).toBe('  - item')
      s.undo()
      expect(s.text()).toBe('- item')
    })
    it('indents a reversed multiline selection without swallowing its text', () => {
      const s = setup('- a\n- b\nend', mode, Selection.range(7, 0))
      s.key('Tab')
      expect(s.text()).toBe('  - a\n  - b\nend')
      expect([s.view.state.selection.main.anchor, s.view.state.selection.main.head]).toEqual([
        11, 2,
      ])
      s.key('Tab', true)
      expect(s.text()).toBe('- a\n- b\nend')
      expect([s.view.state.selection.main.anchor, s.view.state.selection.main.head]).toEqual([7, 0])
      s.undo()
      s.undo()
      expect(s.text()).toBe('- a\n- b\nend')
    })
    it('does not indent the next line when selection ends at its start', () => {
      const s = setup('- a\n- b', mode, Selection.range(0, 4))
      s.key('Tab')
      expect(s.text()).toBe('  - a\n- b')
    })
    it('Backspace at list content start removes structure one level at a time', () => {
      const s = setup('  - item', mode, Selection.cursor(4))
      s.key('Backspace')
      expect(s.text()).toBe('- item')
      expect(s.view.state.selection.main.head).toBe(2)
      s.key('Backspace')
      expect(s.text()).toBe('item')
      s.undo()
      expect(s.text()).toBe('- item')
    })
    it('keeps list-looking text literal inside a fenced code block', () => {
      const text = '```\n- literal\n```'
      const s = setup(text, mode, Selection.cursor(text.lastIndexOf('\n')))
      s.key('Enter')
      expect(s.text()).toBe('```\n- literal\n\n```')
      s.undo()
      expect(s.text()).toBe(text)
    })
    it('preserves code indentation and blank lines', () => {
      const text = '```js\n  value\n```'
      const s = setup(text, mode, Selection.cursor(text.lastIndexOf('\n')))
      s.key('Enter')
      expect(s.text()).toBe('```js\n  value\n  \n```')
      s.key('Enter')
      expect(s.text()).toBe('```js\n  value\n  \n  \n```')
      s.undo()
      expect(s.text()).toBe('```js\n  value\n  \n```')
    })
    it('Tab indents code, Backspace removes one indent step, and closing fence exits normally', () => {
      const text = '```\nvalue\n```'
      const s = setup(text, mode, Selection.cursor(4))
      s.key('Tab')
      expect(s.text()).toBe('```\n  value\n```')
      s.key('Backspace')
      expect(s.text()).toBe(text)
      s.view.updateState(
        new EditorState({
          doc: new MemoryTextDocument(text),
          selection: Selection.cursor(text.length),
        }),
      )
      s.key('Enter')
      expect(s.text()).toBe(text + '\n')
      s.key('x')
      expect(s.text()).toBe(text + '\nx')
    })
    it('does not treat the line after a closed code fence as code', () => {
      const text = '```\nvalue\n```\n- item'
      const start = text.indexOf('- item')
      const s = setup(text, mode, Selection.cursor(start))
      s.key('Enter')
      expect(s.text()).toBe(text.slice(0, start) + '\n- item')
      s.view.updateState(
        new EditorState({
          doc: new MemoryTextDocument('```\nx\n```\nplain'),
          selection: Selection.cursor(10),
        }),
      )
      expect(s.key('Tab')).toBe(false)
    })
    it('handles native WebKit Shift+Tab reported as Unidentified with a Tab code', () => {
      const s = setup('  - item', mode)
      const event = new KeyboardEvent('keydown', {
        key: 'Unidentified',
        code: 'Tab',
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      })
      s.view.inputDOM.dispatchEvent(event)
      expect(event.defaultPrevented).toBe(true)
      expect(s.text()).toBe('- item')
      s.undo()
      expect(s.text()).toBe('  - item')
    })
    it('selection Backspace removes only the selection, even in a list', () => {
      const s = setup('- item', mode, Selection.range(2, 4))
      s.key('Backspace')
      expect(s.text()).toBe('- em')
      s.undo()
      expect(s.text()).toBe('- item')
    })
  })
}

for (const mode of ['source', 'live'] as const) {
  it(`${mode}: Home/End and Shift select a logical line without splitting CRLF or adding history`, () => {
    const s = setup('# First\r\nnext', mode, Selection.cursor(0))
    expect(s.key('End')).toBe(true)
    expect(s.view.state.selection.main.head).toBe(7)
    expect(s.key('Home', true)).toBe(true)
    expect(s.view.state.selection.main.from).toBe(0)
    expect(s.view.state.selection.main.to).toBe(7)
    expect(s.view.state.history.canUndo).toBe(false)
    expect(s.text()).toBe('# First\r\nnext')
  })
}
it('live table Home/End stay inside the current cell', () => {
  const source = '| Name | Value |\n| --- | --- |\n| first | 1 |'
  const s = setup(source, 'live', Selection.cursor(source.indexOf('first') + 2))
  s.key('Home')
  expect(s.view.state.selection.main.head).toBe(source.indexOf('first'))
  s.key('End', true)
  expect(s.view.state.selection.main.to).toBe(source.indexOf('first') + 5)
})

for (const mode of ['source', 'live'] as const) {
  it(`${mode}: primary Home/End replace or extend directional selection without changing text or history`, () => {
    const text = '# 中文 😀\r\nend'
    const s = setup(text, mode, Selection.range(5, 2))
    const key = (key: string, shiftKey = false, metaKey = false) => {
      const event = new KeyboardEvent('keydown', {
        key,
        shiftKey,
        metaKey,
        ctrlKey: !metaKey,
        bubbles: true,
        cancelable: true,
      })
      s.view.inputDOM.dispatchEvent(event)
      expect(event.defaultPrevented).toBe(true)
    }
    key('Home', true)
    expect(s.view.state.selection.main.anchor).toBe(5)
    expect(s.view.state.selection.main.head).toBe(0)
    key('End', true, true)
    expect(s.view.state.selection.main.anchor).toBe(5)
    expect(s.view.state.selection.main.head).toBe(text.length)
    key('Home')
    expect(s.view.state.selection.main.empty).toBe(true)
    expect(s.view.state.selection.main.head).toBe(0)
    key('End')
    expect(s.view.state.selection.main.empty).toBe(true)
    expect(s.view.state.selection.main.head).toBe(text.length)
    expect(s.text()).toBe(text)
    expect(s.view.state.history.canUndo).toBe(false)
  })
}

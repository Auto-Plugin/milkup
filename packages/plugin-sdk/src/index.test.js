import { describe, expect, it } from 'vitest'

import { BasicEditor, EditorState, MemoryTextDocument, Selection } from '@milkup/core'

import {
  cursor,
  definePlugin,
  deleteRange,
  dispatchInsert,
  insertText,
  rangeSelection,
  replaceRange,
} from './index.js'

describe('@milkup/plugin-sdk', () => {
  it('defines a module without a host registry or global side effects', async () => {
    const calls = []
    const plugin = {
      activate(context) {
        calls.push(context.pluginId)
        return { dispose: () => calls.push('disposed') }
      },
      renderers: { panel: () => 'standalone' },
    }
    const defined = definePlugin(plugin)
    expect(defined).toBe(plugin)
    expect(calls).toEqual([])
    const activation = await defined.activate({
      pluginId: 'example.local',
      permissions: [],
      host: {},
    })
    expect(defined.renderers.panel()).toBe('standalone')
    activation.dispose()
    expect(calls).toEqual(['example.local', 'disposed'])
  })

  it('creates structural ChangeSet objects accepted by the core editor', () => {
    const editor = createEditor('hello')

    editor.dispatch({
      changes: insertText(5, ' sdk'),
      selection: cursor(9),
      origin: { type: 'command', id: 'sdk.insert' },
      historyGroup: 'isolate',
    })

    expect(editor.state.doc.text).toBe('hello sdk')
    expect(editor.state.selection.main.head).toBe(9)
    expect(editor.state.history.canUndo).toBe(true)
  })

  it('maps positions through replacements and deletions', () => {
    expect(replaceRange(1, 4, 'xx').mapPosition(5)).toBe(4)
    expect(replaceRange(1, 4, 'xx').mapPosition(2)).toBe(3)
    expect(replaceRange(1, 4, 'xx').mapPosition(2, -1)).toBe(1)
    expect(deleteRange(1, 4).mapPosition(5)).toBe(2)
  })

  it('creates cursor and range selections with stable shape', () => {
    expect(cursor(3)).toMatchObject({
      mainIndex: 0,
      main: {
        anchor: 3,
        head: 3,
        from: 3,
        to: 3,
        empty: true,
      },
    })
    expect(rangeSelection(5, 2)).toMatchObject({
      main: {
        anchor: 5,
        head: 2,
        from: 2,
        to: 5,
        empty: false,
      },
    })
  })

  it('dispatches a plugin insert through the provided editor context', () => {
    const editor = createEditor('hello', Selection.cursor(5))

    dispatchInsert(
      {
        editor,
        command: {
          action: 'sdk.insert',
        },
      },
      ' plugin',
    )

    expect(editor.state.doc.text).toBe('hello plugin')
    expect(editor.state.history.canUndo).toBe(true)
  })

  it('validates ranges before creating edit helpers', () => {
    expect(() => insertText(-1, 'x')).toThrow('Position must be a non-negative integer')
    expect(() => replaceRange(3, 1, 'x')).toThrow('Range end')
    expect(() => insertText(0, 1)).toThrow('Inserted text must be a string')
  })
})

function createEditor(text, selection = Selection.cursor(text.length)) {
  return new BasicEditor(
    new EditorState({
      doc: new MemoryTextDocument(text),
      selection,
    }),
  )
}

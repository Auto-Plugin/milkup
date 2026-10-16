import { describe, expect, it } from 'vitest'

import {
  ActionRegistry,
  BasicEditor,
  ChangeSet,
  createBuiltinActions,
  EditorState,
  MemoryTextDocument,
  Selection,
  type ActionDefinition,
} from '../index'

describe('ActionRegistry', () => {
  it('validates action definitions and rejects duplicate ids', () => {
    const registry = new ActionRegistry()
    const action = createNoopAction('test.noop')

    registry.register(action)

    expect(() => registry.register(createNoopAction('bad id'))).toThrow('Invalid action id')
    expect(() => registry.register(action)).toThrow('already registered')
  })

  it('unregisters actions for dynamic plugin lifecycles', () => {
    const registry = new ActionRegistry()

    registry.register(createNoopAction('test.noop'))

    expect(registry.get('test.noop')).toBeDefined()
    expect(registry.unregister('test.noop')).toBe(true)
    expect(registry.get('test.noop')).toBeUndefined()
    expect(registry.unregister('test.noop')).toBe(false)
  })

  it('validates required action input fields before running actions', async () => {
    const registry = new ActionRegistry([
      {
        ...createNoopAction('document.echo'),
        inputSchema: {
          type: 'object',
          properties: {
            text: { type: 'string', required: true },
          },
        },
      },
    ])

    await expect(registry.run('document.echo', {}, {})).rejects.toThrow('Missing required')
    await expect(registry.run('document.echo', {}, { text: 1 })).rejects.toThrow(
      'Invalid action input',
    )
    await expect(registry.run('document.echo', {}, { text: 'ok' })).resolves.toBe(true)
  })

  it('filters actions by permission before exposing them to automation surfaces', () => {
    const registry = new ActionRegistry(createBuiltinActions())
    const safeIds = registry.listAllowed(['document:read', 'view:write']).map((action) => action.id)

    expect(safeIds).toContain('document.setSelection')
    expect(safeIds).toContain('view.setMode')
    expect(safeIds).not.toContain('document.replaceSelection')
    expect(safeIds).not.toContain('file.close')
  })

  it('blocks actions without the required permissions', async () => {
    const registry = new ActionRegistry(createBuiltinActions())
    const editor = createEditor('hello')

    await expect(
      registry.run(
        'document.replaceSelection',
        { editor, permissions: ['document:read'] },
        { text: 'x' },
      ),
    ).rejects.toThrow('not allowed')
  })

  it('blocks destructive actions unless confirmation is provided', async () => {
    const registry = new ActionRegistry(createBuiltinActions())

    await expect(registry.run('file.close', { permissions: ['app:control'] })).rejects.toThrow(
      'requires confirmation',
    )
    await expect(
      registry.run('file.close', {
        permissions: ['app:control'],
        confirm: () => false,
      }),
    ).rejects.toThrow('requires confirmation')
  })

  it('runs document edits through editor transactions and global history', async () => {
    const registry = new ActionRegistry(createBuiltinActions())
    const editor = createEditor('hello world', Selection.range(6, 11))

    await expect(
      registry.run(
        'document.replaceSelection',
        { editor, permissions: ['document:write'] },
        { text: 'milkup' },
      ),
    ).resolves.toEqual({ changed: true })

    expect(editor.state.doc.text).toBe('hello milkup')
    expect(editor.state.selection.main.anchor).toBe('hello milkup'.length)
    expect(editor.state.history.canUndo).toBe(true)
    expect(editor.undo()).toBe(true)
    expect(editor.state.doc.text).toBe('hello world')
  })

  it('keeps mode switch actions out of document history', async () => {
    const registry = new ActionRegistry(createBuiltinActions())
    const editor = createEditor('hello')

    editor.dispatch({
      changes: ChangeSet.insert(5, '!'),
      origin: { type: 'input.type' },
      historyGroup: 'isolate',
    })

    await expect(
      registry.run('view.setMode', { editor, permissions: ['view:write'] }, { mode: 'live' }),
    ).resolves.toEqual({ mode: 'live' })

    expect(editor.state.history.canUndo).toBe(true)
    expect(editor.undo()).toBe(true)
    expect(editor.state.doc.text).toBe('hello')
  })
})

function createNoopAction(id: string): ActionDefinition<Record<string, never>, boolean> {
  return {
    id,
    title: 'Noop',
    category: 'core',
    run: () => true,
  }
}

function createEditor(text: string, selection = Selection.cursor(text.length)): BasicEditor {
  return new BasicEditor(
    new EditorState({
      doc: new MemoryTextDocument(text),
      selection,
    }),
  )
}

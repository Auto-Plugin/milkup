import { describe, it, expect } from 'vitest'
import {
  BasicEditor,
  EditorState,
  MemoryTextDocument,
  ChangeSet,
  ActionRegistry,
} from '@milkup/core'
import { PluginRuntime } from './runtime'
import type { PluginPermission } from './manifest'
async function setup(permissions: readonly PluginPermission[]) {
  const editor = new BasicEditor(new EditorState({ doc: new MemoryTextDocument('abc') }))
  const actions = new ActionRegistry()
  let resume!: () => void
  const wait = new Promise<void>((r) => (resume = r))
  const runtime = new PluginRuntime({
    allowInProcessModules: true,
    allowedPermissions: permissions,
    actionRegistry: actions,
  })
  runtime.loadPlugin({
    manifest: {
      id: 'test-edit',
      name: 'Test',
      version: '1.0.0',
      permissions,
      contributes: { commands: [{ id: 'test.edit', action: 'test.edit', title: 'Edit' }] },
    },
    module: {
      commands: {
        'test.edit': async (ctx) => {
          ctx.editor?.dispatch({ changes: ChangeSet.insert(0, 'X') })
          await wait
        },
      },
    },
  })
  await runtime.enablePlugin('test-edit')
  return { editor, runtime, resume, actions }
}
describe('legacy editor boundary', () => {
  it('rejects document changes from a read-only plugin', async () => {
    const t = await setup(['document:read'])
    const result = t.actions.run(
      'test.edit',
      { editor: t.editor, permissions: ['document:read'] },
      undefined,
    )
    t.resume()
    await result
    expect(t.editor.state.doc.text).toBe('abc')
  })
  it('rejects stale buffered changes after host edits', async () => {
    const t = await setup(['document:write'])
    const result = t.actions.run(
      'test.edit',
      { editor: t.editor, permissions: ['document:write'] },
      undefined,
    )
    await Promise.resolve()
    t.editor.dispatch({ changes: ChangeSet.insert(0, 'Y') })
    t.resume()
    await result
    expect(t.editor.state.doc.text).toBe('Yabc')
  })
  it('rejects a late buffered command after disable', async () => {
    const t = await setup(['document:write'])
    const result = t.actions.run(
      'test.edit',
      { editor: t.editor, permissions: ['document:write'] },
      undefined,
    )
    await Promise.resolve()
    await t.runtime.disablePlugin('test-edit')
    t.resume()
    await result
    expect(t.editor.state.doc.text).toBe('abc')
  })
})

import { createPluginModuleIsolationHost } from './isolation-module-host'
it('isolated sequential edits retain cumulative offsets at later boundaries', async () => {
  const manifest = {
    id: 'map-test',
    name: 'Map',
    version: '1.0.0',
    permissions: ['document:write'] as const,
    contributes: { commands: [{ id: 'map.edit', action: 'map.edit', title: 'Map' }] },
  }
  const host = createPluginModuleIsolationHost({
    manifest,
    module: {
      commands: {
        'map.edit': (ctx) => {
          ctx.editor!.dispatch({
            changes: ChangeSet.of([
              { from: 0, to: 0, insert: '##' },
              { from: 2, to: 2, insert: '!' },
            ]),
          })
          return ctx.editor!.state.selection.main.head
        },
      },
    },
  })
  await host.activate({
    pluginId: manifest.id,
    manifest,
    permissions: manifest.permissions,
    hostCapabilities: [],
  })
  const result = await host.runCommand({
    pluginId: manifest.id,
    command: manifest.contributes.commands[0]!,
    selection: { anchor: 2 },
    permissions: manifest.permissions,
    hostCapabilities: [],
    input: undefined,
  })
  expect(result.value).toBe(5)
})

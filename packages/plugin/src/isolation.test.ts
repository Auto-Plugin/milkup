import { describe, expect, it, vi } from 'vitest'

import {
  ActionRegistry,
  BasicEditor,
  EditorState,
  MemoryTextDocument,
  Selection,
  type ActionContext,
} from '@milkup/core'

import { createIsolatedPluginModule } from './isolation'
import type { PluginManifest } from './manifest'
import { PluginRuntime, type PluginModule } from './runtime'

describe('isolated plugin module adapter', () => {
  it('runs isolated commands through serialized transactions and global history', async () => {
    const registry = new ActionRegistry()
    const host = createHost()
    const runtime = new PluginRuntime({
      actionRegistry: registry,
      allowedPermissions: ['document:write'],
    })
    const editor = createEditor('hello', Selection.cursor(5))

    runtime.loadPlugin({
      manifest: commandManifest(),
      module: createIsolatedPluginModule({
        manifest: commandManifest(),
        host,
      }),
    })
    await runtime.enablePlugin('isolated-tools')

    await expect(
      registry.run(
        'isolated.insertText',
        {
          editor,
          permissions: ['document:write'],
        },
        { text: ' realm' },
      ),
    ).resolves.toEqual({
      ok: true,
      value: { inserted: ' realm' },
    })

    expect(host.runCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        pluginId: 'isolated-tools',
        input: { text: ' realm' },
        selection: { anchor: 5 },
        permissions: ['document:write'],
        hostCapabilities: [],
      }),
    )
    expect(editor.state.doc.text).toBe('hello realm')
    expect(editor.state.selection.main.head).toBe('hello realm'.length)
    expect(editor.state.history.canUndo).toBe(true)
    expect(editor.undo()).toBe(true)
    expect(editor.state.doc.text).toBe('hello')
  })

  it('does not expose the real editor object to the isolated host', async () => {
    const registry = new ActionRegistry()
    const host = createHost()
    const runtime = new PluginRuntime({
      actionRegistry: registry,
      allowedPermissions: ['document:write'],
    })
    const editor = createEditor('safe')

    runtime.loadPlugin({
      manifest: commandManifest(),
      module: createIsolatedPluginModule({
        manifest: commandManifest(),
        host,
      }),
    })
    await runtime.enablePlugin('isolated-tools')
    await registry.run(
      'isolated.insertText',
      {
        editor,
        permissions: ['document:write'],
      },
      { text: ' ok' },
    )

    const request = host.runCommand.mock.calls[0]?.[0] as Record<string, unknown>

    expect(request.editor).toBeUndefined()
    expect(request.command).toMatchObject({
      action: 'isolated.insertText',
    })
  })

  it('passes only restricted host capability names across the isolation boundary', async () => {
    const host = createHost()
    const runtime = new PluginRuntime({
      allowedPermissions: ['file:read', 'network:access'],
      host: {
        readText: () => 'file',
        writeText: () => undefined,
        fetch: () => 'network',
      },
    })

    runtime.loadPlugin({
      manifest: {
        ...commandManifest(),
        permissions: ['file:read'],
      },
      module: createIsolatedPluginModule({
        manifest: {
          ...commandManifest(),
          permissions: ['file:read'],
        },
        host,
      }),
    })
    await runtime.enablePlugin('isolated-tools')

    expect(host.activate).toHaveBeenCalledWith(
      expect.objectContaining({
        permissions: ['file:read'],
        hostCapabilities: ['file:read'],
      }),
    )
  })

  it('routes isolated renderers through the host and falls back on renderer errors', async () => {
    const host = createHost()
    const runtime = new PluginRuntime()

    runtime.loadPlugin({
      manifest: rendererManifest(),
      module: createIsolatedPluginModule({
        manifest: rendererManifest(),
        host,
      }),
    })
    await runtime.enablePlugin('isolated-renderers')

    await expect(
      runtime.render('isolated-renderers', 'callout-renderer', {
        nodeType: 'callout',
        source: 'hello',
      }),
    ).resolves.toEqual({
      ok: true,
      value: '<aside>hello</aside>',
    })

    host.render.mockImplementationOnce(() => {
      throw new Error('remote render failed')
    })

    await expect(
      runtime.render('isolated-renderers', 'callout-renderer', {
        nodeType: 'callout',
        source: 'broken',
      }),
    ).resolves.toMatchObject({
      ok: false,
      fallback: true,
      error: {
        pluginId: 'isolated-renderers',
        phase: 'renderer',
        message: 'remote render failed',
      },
    })
  })

  it('keeps isolated command failures out of the real document', async () => {
    const registry = new ActionRegistry()
    const host = createHost()
    const runtime = new PluginRuntime({
      actionRegistry: registry,
      allowedPermissions: ['document:write'],
    })
    const editor = createEditor('safe')

    host.runCommand.mockRejectedValueOnce(new Error('remote command failed'))
    runtime.loadPlugin({
      manifest: commandManifest(),
      module: createIsolatedPluginModule({
        manifest: commandManifest(),
        host,
      }),
    })
    await runtime.enablePlugin('isolated-tools')

    await expect(
      registry.run(
        'isolated.insertText',
        {
          editor,
          permissions: ['document:write'],
        },
        { text: ' bad' },
      ),
    ).resolves.toMatchObject({
      ok: false,
      error: {
        pluginId: 'isolated-tools',
        phase: 'command',
        message: 'remote command failed',
      },
    })
    expect(editor.state.doc.text).toBe('safe')
    expect(editor.state.history.canUndo).toBe(false)
  })

  it('calls isolated dispose and deactivate hooks during disable', async () => {
    const host = createHost()
    const runtime = new PluginRuntime({
      allowedPermissions: ['document:write'],
    })

    runtime.loadPlugin({
      manifest: commandManifest(),
      module: createIsolatedPluginModule({
        manifest: commandManifest(),
        host,
      }),
    })
    await runtime.enablePlugin('isolated-tools')
    await runtime.disablePlugin('isolated-tools')

    expect(host.dispose).toHaveBeenCalledWith({ pluginId: 'isolated-tools' })
    expect(host.deactivate).toHaveBeenCalledWith({ pluginId: 'isolated-tools' })
  })

  it('can be exposed through an activation-returned isolated module', async () => {
    const registry = new ActionRegistry()
    const host = createHost()
    const module: PluginModule = createIsolatedPluginModule({
      manifest: commandManifest(),
      host,
    })
    const runtime = new PluginRuntime({
      actionRegistry: registry,
      allowedPermissions: ['document:write'],
    })

    runtime.loadPlugin({
      manifest: commandManifest(),
      module,
    })
    await runtime.enablePlugin('isolated-tools')

    expect(registry.get('isolated.insertText')).toBeDefined()
  })
})

function createHost() {
  return {
    activate: vi.fn(() => ({
      commands: ['isolated.insertText'],
      renderers: ['callout-renderer'],
    })),
    deactivate: vi.fn(),
    dispose: vi.fn(),
    runCommand: vi.fn((request: { input: unknown; selection?: { anchor: number } }) => {
      const input = request.input as { text?: string }
      const text = input.text ?? ''
      const position = request.selection?.anchor ?? 0

      return {
        value: { inserted: text },
        transactions: [
          {
            changes: [{ from: position, to: position, insert: text }],
            selection: { anchor: position + text.length },
          },
        ],
      }
    }),
    render: vi.fn((request: { context: { source?: string } }) => {
      return `<aside>${request.context.source ?? ''}</aside>`
    }),
  }
}

function commandManifest(): PluginManifest {
  return {
    id: 'isolated-tools',
    name: 'Isolated Tools',
    version: '1.0.0',
    permissions: ['document:write'],
    contributes: {
      commands: [
        {
          id: 'isolated.insertText',
          title: 'Insert Text',
          action: 'isolated.insertText',
        },
      ],
    },
  }
}

function rendererManifest(): PluginManifest {
  return {
    id: 'isolated-renderers',
    name: 'Isolated Renderers',
    version: '1.0.0',
    contributes: {
      renderers: [
        {
          id: 'callout-renderer',
          nodeType: 'callout',
          module: './renderer.js',
        },
      ],
    },
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

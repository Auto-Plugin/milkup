import { describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'

import {
  ActionRegistry,
  BasicEditor,
  ChangeSet,
  EditorState,
  MemoryTextDocument,
  Selection,
  type ActionContext,
} from '@milkup/core'
import { createMcpTools } from '@milkup/mcp'

import { createPluginFileBroker, type PluginFileBrokerAdapter } from './filesystem-broker'
import { createPluginNetworkBroker, type PluginNetworkBrokerAdapter } from './network-broker'
import type { PluginManifest } from './manifest'
import { PluginRuntime, type PluginModule, type PluginRuntimeOptions } from './runtime'

describe('PluginRuntime', () => {
  it('loads, enables, disables, unloads, and reloads local plugins', async () => {
    const registry = new ActionRegistry()
    const runtime = createInProcessTestRuntime({
      actionRegistry: registry,
      allowedPermissions: ['document:write'],
    })
    const deactivate = vi.fn()

    runtime.loadPlugin({
      manifest: writableCommandManifest('1.0.0'),
      module: {
        deactivate,
        commands: {
          'example.insertText': () => 'ok',
        },
      },
    })

    expect(runtime.getPlugin('example-tools')).toMatchObject({
      id: 'example-tools',
      state: 'loaded',
    })

    await runtime.enablePlugin('example-tools')
    expect(registry.get('example.insertText')).toBeDefined()
    expect(runtime.getPlugin('example-tools')?.state).toBe('enabled')

    await runtime.disablePlugin('example-tools')
    expect(registry.get('example.insertText')).toBeUndefined()
    expect(deactivate).toHaveBeenCalledTimes(1)

    await runtime.reloadPlugin('example-tools', {
      manifest: writableCommandManifest('1.0.1'),
      module: {
        commands: {
          'example.insertText': () => 'reloaded',
        },
      },
    })
    expect(runtime.getPlugin('example-tools')?.manifest.version).toBe('1.0.1')

    await runtime.enablePlugin('example-tools')
    expect(registry.get('example.insertText')).toBeDefined()

    await runtime.unloadPlugin('example-tools')
    expect(runtime.getPlugin('example-tools')).toBeUndefined()
    expect(registry.get('example.insertText')).toBeUndefined()
  })

  it('runs plugin commands through the Action Registry and global document history', async () => {
    const registry = new ActionRegistry()
    const runtime = createInProcessTestRuntime({
      actionRegistry: registry,
      allowedPermissions: ['document:write'],
    })
    const editor = createEditor('hello', Selection.cursor(5))

    runtime.loadPlugin({
      manifest: writableCommandManifest('1.0.0'),
      module: {
        commands: {
          'example.insertText': (context) => {
            context.editor?.dispatch({
              changes: ChangeSet.insert(context.editor.state.selection.main.head, ' plugin'),
              selection: Selection.cursor('hello plugin'.length),
              origin: { type: 'command', id: 'example.insertText' },
              historyGroup: 'isolate',
            })

            return { inserted: true }
          },
        },
      },
    })
    await runtime.enablePlugin('example-tools')

    await expect(
      registry.run(
        'example.insertText',
        {
          editor,
          permissions: ['document:write'],
        },
        {},
      ),
    ).resolves.toEqual({
      ok: true,
      value: { inserted: true },
    })

    expect(editor.state.doc.text).toBe('hello plugin')
    expect(editor.state.history.canUndo).toBe(true)
    expect(editor.undo()).toBe(true)
    expect(editor.state.doc.text).toBe('hello')
  })

  it('isolates plugin command failures and keeps failed edits out of the real document', async () => {
    const registry = new ActionRegistry()
    const runtime = createInProcessTestRuntime({
      actionRegistry: registry,
      allowedPermissions: ['document:write'],
    })
    const editor = createEditor('safe', Selection.cursor(4))

    runtime.loadPlugin({
      manifest: writableCommandManifest('1.0.0'),
      module: {
        commands: {
          'example.insertText': (context) => {
            context.editor?.dispatch({
              changes: ChangeSet.insert(4, ' broken'),
              selection: Selection.cursor(11),
              origin: { type: 'command', id: 'example.insertText' },
              historyGroup: 'isolate',
            })

            throw new Error('boom')
          },
        },
      },
    })
    await runtime.enablePlugin('example-tools')

    const result = await registry.run(
      'example.insertText',
      {
        editor,
        permissions: ['document:write'],
      },
      {},
    )

    expect(result).toMatchObject({
      ok: false,
      error: {
        pluginId: 'example-tools',
        phase: 'command',
        message: 'boom',
        commandId: 'example.insertText',
      },
    })
    expect(editor.state.doc.text).toBe('safe')
    expect(editor.state.history.canUndo).toBe(false)
    expect(runtime.getPlugin('example-tools')?.errors).toHaveLength(1)
  })

  it('enforces plugin and action permissions before commands run', async () => {
    const deniedRuntime = createInProcessTestRuntime({
      allowedPermissions: ['document:read'],
    })

    deniedRuntime.loadPlugin({
      manifest: writableCommandManifest('1.0.0'),
      module: {
        commands: {
          'example.insertText': () => 'never',
        },
      },
    })

    await expect(deniedRuntime.enablePlugin('example-tools')).rejects.toThrow(
      'Plugin permissions are not allowed: document:write',
    )

    const registry = new ActionRegistry()
    const runtime = createInProcessTestRuntime({
      actionRegistry: registry,
      allowedPermissions: ['document:write'],
    })
    const handler = vi.fn()

    runtime.loadPlugin({
      manifest: writableCommandManifest('1.0.0'),
      module: {
        commands: {
          'example.insertText': handler,
        },
      },
    })
    await runtime.enablePlugin('example-tools')

    await expect(
      registry.run('example.insertText', { permissions: ['document:read'] }),
    ).rejects.toThrow('Action is not allowed: example.insertText')
    expect(handler).not.toHaveBeenCalled()
  })

  it('rejects in-process plugin modules unless the runtime explicitly allows dev fixtures', async () => {
    const runtime = new PluginRuntime()

    runtime.loadPlugin({
      manifest: {
        id: 'in-process-tools',
        name: 'In Process Tools',
        version: '1.0.0',
      },
      module: {
        commands: {},
      },
    })

    await expect(runtime.enablePlugin('in-process-tools')).rejects.toThrow(
      'In-process plugin modules are not allowed by this runtime',
    )
    expect(runtime.getPlugin('in-process-tools')?.errors).toMatchObject([
      {
        pluginId: 'in-process-tools',
        phase: 'enable',
        message: 'In-process plugin modules are not allowed by this runtime',
      },
    ])
  })

  it('rejects sidecar-hosted plugins unless the runtime explicitly allows them', async () => {
    const deniedRuntime = new PluginRuntime()

    deniedRuntime.loadPlugin({
      manifest: sidecarCommandManifest(),
      module: {
        commands: {
          'sidecar.run': () => 'never',
        },
      },
    })

    await expect(deniedRuntime.enablePlugin('sidecar-tools')).rejects.toThrow(
      'Plugin host is not allowed: sidecar',
    )
    expect(deniedRuntime.getPlugin('sidecar-tools')?.errors).toMatchObject([
      {
        pluginId: 'sidecar-tools',
        phase: 'enable',
        message: 'Plugin host is not allowed: sidecar. Allowed hosts: worker',
      },
    ])

    const registry = new ActionRegistry()
    const allowedRuntime = createInProcessTestRuntime({
      actionRegistry: registry,
      allowedHosts: ['sidecar'],
    })

    allowedRuntime.loadPlugin({
      manifest: sidecarCommandManifest(),
      module: {
        commands: {
          'sidecar.run': () => 'ok',
        },
      },
    })
    await allowedRuntime.enablePlugin('sidecar-tools')

    await expect(registry.run('sidecar.run', {})).resolves.toEqual({
      ok: true,
      value: 'ok',
    })
  })

  it('requires confirmation metadata for destructive plugin actions', async () => {
    const registry = new ActionRegistry()
    const runtime = createInProcessTestRuntime({
      actionRegistry: registry,
      allowedPermissions: ['file:delete'],
    })

    runtime.loadPlugin({
      manifest: {
        id: 'danger-tools',
        name: 'Danger Tools',
        version: '1.0.0',
        permissions: ['file:delete'],
        contributes: {
          commands: [
            {
              id: 'danger.deleteFile',
              title: 'Delete File',
              action: 'danger.deleteFile',
            },
          ],
        },
      },
      module: {
        commands: {
          'danger.deleteFile': () => 'deleted',
        },
      },
    })
    await runtime.enablePlugin('danger-tools')

    const action = registry.get('danger.deleteFile')
    expect(action).toMatchObject({
      risk: 'destructive',
      requiresConfirmation: true,
      permissions: ['file:delete'],
    })
    await expect(
      registry.run('danger.deleteFile', { permissions: ['file:delete'] }),
    ).rejects.toThrow('requires confirmation')
  })

  it('keeps renderer failures contained and returns a fallback result', async () => {
    const runtime = createInProcessTestRuntime()

    runtime.loadPlugin({
      manifest: {
        id: 'render-tools',
        name: 'Render Tools',
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
      },
      module: {
        renderers: {
          'callout-renderer': () => {
            throw new Error('render failed')
          },
        },
      },
    })
    await runtime.enablePlugin('render-tools')

    await expect(
      runtime.render('render-tools', 'callout-renderer', {
        nodeType: 'callout',
        source: '::: warning',
      }),
    ).resolves.toMatchObject({
      ok: false,
      fallback: true,
      error: {
        pluginId: 'render-tools',
        phase: 'renderer',
        rendererId: 'callout-renderer',
        message: 'render failed',
      },
    })
  })

  it('routes plugin file host capabilities through the filesystem broker', async () => {
    const registry = new ActionRegistry()
    const manifest = fileCommandManifest()
    const adapter = createMemoryFileAdapter({
      '/workspace/doc.md': 'broker',
    })
    const rawHost = {
      readText: vi.fn(() => 'raw'),
      writeText: vi.fn(),
    }
    const runtime = createInProcessTestRuntime({
      actionRegistry: registry,
      allowedPermissions: ['file:read', 'file:write'],
      host: rawHost,
      fileBroker: createPluginFileBroker({
        manifest,
        roots: [{ id: 'workspace', path: '/workspace' }],
        adapter,
      }),
    })

    runtime.loadPlugin({
      manifest,
      module: {
        commands: {
          'file.update': async (context) => {
            const text = await context.host.readText?.('/workspace/doc.md')

            await context.host.writeText?.('/workspace/doc.md', `${text} updated`)
            return { text }
          },
        },
      },
    })
    await runtime.enablePlugin('file-tools')

    await expect(
      registry.run('file.update', {
        permissions: ['file:read', 'file:write'],
      }),
    ).resolves.toEqual({
      ok: true,
      value: { text: 'broker' },
    })
    expect(adapter.readText).toHaveBeenCalledWith('/workspace/doc.md')
    expect(adapter.writeText).toHaveBeenCalledWith('/workspace/doc.md', 'broker updated')
    expect(rawHost.readText).not.toHaveBeenCalled()
    expect(rawHost.writeText).not.toHaveBeenCalled()
  })

  it('routes plugin fetch host capabilities through the network broker', async () => {
    const registry = new ActionRegistry()
    const manifest = networkCommandManifest()
    const adapter = createMemoryNetworkAdapter({ status: 200 })
    const rawHost = {
      fetch: vi.fn(() => ({ status: 500 })),
    }
    const runtime = createInProcessTestRuntime({
      actionRegistry: registry,
      allowedPermissions: ['network:access'],
      host: rawHost,
      networkBroker: createPluginNetworkBroker({
        manifest,
        adapter,
        allowedOrigins: ['https://api.example.test'],
      }),
    })

    runtime.loadPlugin({
      manifest,
      module: {
        commands: {
          'network.fetch': async (context) =>
            context.host.fetch?.('https://api.example.test/data', {
              headers: { accept: 'application/json' },
            }),
        },
      },
    })
    await runtime.enablePlugin('network-tools')

    const action = registry.get('network.fetch')
    expect(action).toMatchObject({
      permissions: ['network:access'],
      risk: 'write',
    })
    expect(createMcpTools(registry, { permissions: [] })).toHaveLength(0)
    expect(createMcpTools(registry, { permissions: ['network:access'] })).toMatchObject([
      {
        annotations: {
          actionId: 'network.fetch',
          requiredPermissions: ['network:access'],
          risk: 'write',
          readOnlyHint: false,
        },
      },
    ])

    await expect(
      registry.run('network.fetch', {
        permissions: ['network:access'],
      }),
    ).resolves.toEqual({
      ok: true,
      value: { status: 200 },
    })
    expect(adapter.fetch).toHaveBeenCalledWith('https://api.example.test/data', {
      headers: { accept: 'application/json' },
    })
    expect(rawHost.fetch).not.toHaveBeenCalled()
  })

  it('narrows plugin action permissions and host capabilities per command', async () => {
    const registry = new ActionRegistry()
    const manifest: PluginManifest = {
      id: 'mixed-tools',
      name: 'Mixed Tools',
      version: '1.0.0',
      permissions: ['document:write', 'network:access'],
      contributes: {
        commands: [
          {
            id: 'mixed.local',
            title: 'Local',
            action: 'mixed.local',
            permissions: ['document:write'],
          },
          {
            id: 'mixed.fetch',
            title: 'Fetch',
            action: 'mixed.fetch',
            permissions: ['network:access'],
          },
        ],
      },
    }
    const networkBroker = createPluginNetworkBroker({
      manifest,
      adapter: createMemoryNetworkAdapter('broker'),
      allowedOrigins: ['https://api.example.test'],
    })
    const runtime = createInProcessTestRuntime({
      actionRegistry: registry,
      allowedPermissions: ['document:write', 'network:access'],
      networkBroker,
    })

    runtime.loadPlugin({
      manifest,
      module: {
        commands: {
          'mixed.local': (context) => ({ hasFetch: Boolean(context.host.fetch) }),
          'mixed.fetch': async (context) => context.host.fetch?.('https://api.example.test/data'),
        },
      },
    })
    await runtime.enablePlugin('mixed-tools')

    expect(registry.get('mixed.local')).toMatchObject({
      permissions: ['document:write'],
      risk: 'write',
    })
    expect(registry.get('mixed.fetch')).toMatchObject({
      permissions: ['network:access'],
      risk: 'write',
    })
    expect(
      createMcpTools(registry, { permissions: ['document:write'] }).map(
        (tool) => tool.annotations.actionId,
      ),
    ).toEqual(['mixed.local'])

    await expect(
      registry.run('mixed.local', {
        permissions: ['document:write'],
      }),
    ).resolves.toEqual({
      ok: true,
      value: { hasFetch: false },
    })
    await expect(
      registry.run('mixed.fetch', {
        permissions: ['document:write'],
      }),
    ).rejects.toThrow('Action is not allowed: mixed.fetch')
    await expect(
      registry.run('mixed.fetch', {
        permissions: ['network:access'],
      }),
    ).resolves.toEqual({
      ok: true,
      value: 'broker',
    })
  })

  it('exposes plugin actions to automation surfaces through the shared registry', async () => {
    const registry = new ActionRegistry()
    const runtime = createInProcessTestRuntime({
      actionRegistry: registry,
      allowedPermissions: ['document:write'],
    })

    runtime.loadPlugin({
      manifest: writableCommandManifest('1.0.0'),
      module: {
        commands: {
          'example.insertText': () => 'ok',
        },
      },
    })
    await runtime.enablePlugin('example-tools')

    expect(registry.list().map((action) => action.id)).toContain('example.insertText')
    expect(createMcpTools(registry, { permissions: ['document:read'] })).toHaveLength(0)
    expect(createMcpTools(registry, { permissions: ['document:write'] })).toMatchObject([
      {
        annotations: {
          actionId: 'example.insertText',
          category: 'plugin',
          requiredPermissions: ['document:write'],
          risk: 'write',
        },
      },
    ])
  })

  it('uses activation-returned command handlers and renderer handlers', async () => {
    const registry = new ActionRegistry()
    const module: PluginModule = {
      activate: () => ({
        commands: {
          'example.insertText': (_context: ActionContext, input: unknown) => input,
        },
        renderers: {
          'callout-renderer': (context) => `<aside>${context.source ?? ''}</aside>`,
        },
      }),
    }
    const runtime = createInProcessTestRuntime({
      actionRegistry: registry,
      allowedPermissions: ['document:write'],
    })

    runtime.loadPlugin({
      manifest: {
        ...writableCommandManifest('1.0.0'),
        contributes: {
          commands: [
            {
              id: 'example.insertText',
              title: 'Insert Text',
              action: 'example.insertText',
            },
          ],
          renderers: [
            {
              id: 'callout-renderer',
              nodeType: 'callout',
              module: './renderer.js',
            },
          ],
        },
      },
      module,
    })
    await runtime.enablePlugin('example-tools')

    await expect(
      registry.run(
        'example.insertText',
        {
          permissions: ['document:write'],
        },
        { text: 'from activation' },
      ),
    ).resolves.toEqual({
      ok: true,
      value: { text: 'from activation' },
    })
    await expect(
      runtime.render('example-tools', 'callout-renderer', {
        nodeType: 'callout',
        source: 'hello',
      }),
    ).resolves.toEqual({
      ok: true,
      value: '<aside>hello</aside>',
    })
  })

  it('projects plugin command input schemas to Action Registry and MCP tools', async () => {
    const registry = new ActionRegistry()
    const runtime = createInProcessTestRuntime({
      actionRegistry: registry,
      allowedPermissions: ['document:write'],
    })

    runtime.loadPlugin({
      manifest: {
        id: 'schema-tools',
        name: 'Schema Tools',
        version: '1.0.0',
        permissions: ['document:write'],
        contributes: {
          commands: [
            {
              id: 'schema.insert',
              title: 'Insert',
              action: 'schema.insert',
              permissions: ['document:write'],
              inputSchema: {
                type: 'object',
                properties: {
                  text: {
                    type: 'string',
                    required: true,
                    description: 'Text to insert',
                  },
                  repeat: {
                    type: 'number',
                  },
                },
              },
            },
          ],
        },
      },
      module: {
        commands: {
          'schema.insert': (_context, input) => input,
        },
      },
    })
    await runtime.enablePlugin('schema-tools')

    const action = registry.get('schema.insert')
    expect(action?.inputSchema).toMatchObject({
      type: 'object',
      properties: {
        text: {
          type: 'string',
          required: true,
          description: 'Text to insert',
        },
        repeat: {
          type: 'number',
        },
      },
    })
    expect(createMcpTools(registry, { permissions: ['document:write'] })).toMatchObject([
      {
        inputSchema: {
          type: 'object',
          properties: {
            text: {
              type: 'string',
              description: 'Text to insert',
            },
            repeat: {
              type: 'number',
            },
          },
          required: ['text'],
        },
      },
    ])

    await expect(
      registry.run(
        'schema.insert',
        {
          permissions: ['document:write'],
        },
        {},
      ),
    ).rejects.toThrow('Missing required action input "text"')
    await expect(
      registry.run(
        'schema.insert',
        {
          permissions: ['document:write'],
        },
        { text: 'ok', repeat: 'twice' },
      ),
    ).rejects.toThrow('Invalid action input "repeat"')
    await expect(
      registry.run(
        'schema.insert',
        {
          permissions: ['document:write'],
        },
        { text: 'ok', repeat: 2 },
      ),
    ).resolves.toEqual({
      ok: true,
      value: { text: 'ok', repeat: 2 },
    })
  })
})

function writableCommandManifest(version: string) {
  return {
    id: 'example-tools',
    name: 'Example Tools',
    version,
    permissions: ['document:write'],
    contributes: {
      commands: [
        {
          id: 'example.insertText',
          title: 'Insert Text',
          action: 'example.insertText',
        },
      ],
    },
  }
}

function fileCommandManifest(): PluginManifest {
  return {
    id: 'file-tools',
    name: 'File Tools',
    version: '1.0.0',
    permissions: ['file:read', 'file:write'],
    contributes: {
      commands: [
        {
          id: 'file.update',
          title: 'Update File',
          action: 'file.update',
        },
      ],
    },
  }
}

function networkCommandManifest(): PluginManifest {
  return {
    id: 'network-tools',
    name: 'Network Tools',
    version: '1.0.0',
    permissions: ['network:access'],
    contributes: {
      commands: [
        {
          id: 'network.fetch',
          title: 'Fetch',
          action: 'network.fetch',
        },
      ],
    },
  }
}

function sidecarCommandManifest(): PluginManifest {
  return {
    id: 'sidecar-tools',
    name: 'Sidecar Tools',
    version: '1.0.0',
    host: 'sidecar',
    contributes: {
      commands: [
        {
          id: 'sidecar.run',
          title: 'Run Sidecar',
          action: 'sidecar.run',
        },
      ],
    },
  }
}

function createMemoryFileAdapter(
  files: Readonly<Record<string, string>>,
): PluginFileBrokerAdapter & {
  readonly readText: Mock<(path: string) => string>
  readonly writeText: Mock<(path: string, text: string) => void>
  readonly deleteFile: Mock<(path: string) => void>
} {
  const store = new Map(Object.entries(files))

  return {
    resolvePath: (path: string) => path.replaceAll('\\', '/').replace(/\/+/g, '/'),
    readText: vi.fn((path: string) => store.get(path) ?? ''),
    writeText: vi.fn((path: string, text: string) => {
      store.set(path, text)
    }),
    deleteFile: vi.fn((path: string) => {
      store.delete(path)
    }),
  }
}

function createMemoryNetworkAdapter(value: unknown): PluginNetworkBrokerAdapter & {
  readonly fetch: Mock<(url: string, init?: unknown) => unknown>
} {
  return {
    fetch: vi.fn((_url: string, _init?: unknown) => value),
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

function createInProcessTestRuntime(options: PluginRuntimeOptions = {}): PluginRuntime {
  return new PluginRuntime({
    ...options,
    allowInProcessModules: true,
  })
}

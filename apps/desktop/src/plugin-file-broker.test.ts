import { describe, expect, it, vi } from 'vitest'

import { ActionRegistry } from '@milkup/core'
import {
  createBrowserWorkerPluginHost,
  createIsolatedPluginModule,
  initializePluginWorkerRealm,
  PluginRuntime,
} from '@milkup/plugin'
import type { PluginManifest, PluginModule } from '@milkup/plugin'

import {
  createDesktopPluginFileBroker,
  createDesktopPluginFileBrokerAdapter,
  type DesktopPluginFileInvoke,
} from './plugin-file-broker'

describe('desktop plugin file broker adapter', () => {
  it('maps broker adapter operations to dedicated Tauri commands', async () => {
    const invoke = createInvokeMock({
      resolve_plugin_file_path: 'D:/workspace/doc.md',
      read_plugin_text_file: 'hello',
      write_plugin_text_file: true,
      delete_plugin_file: true,
    })
    const adapter = createDesktopPluginFileBrokerAdapter({ invoke })

    await expect(adapter.resolvePath('D:/workspace/doc.md')).resolves.toBe('D:/workspace/doc.md')
    await expect(adapter.readText('D:/workspace/doc.md')).resolves.toBe('hello')
    await expect(adapter.writeText('D:/workspace/doc.md', 'updated')).resolves.toBeUndefined()
    await expect(adapter.deleteFile('D:/workspace/doc.md')).resolves.toBeUndefined()

    expect(invoke).toHaveBeenCalledWith('resolve_plugin_file_path', {
      path: 'D:/workspace/doc.md',
    })
    expect(invoke).toHaveBeenCalledWith('read_plugin_text_file', {
      path: 'D:/workspace/doc.md',
    })
    expect(invoke).toHaveBeenCalledWith('write_plugin_text_file', {
      path: 'D:/workspace/doc.md',
      text: 'updated',
    })
    expect(invoke).toHaveBeenCalledWith('delete_plugin_file', {
      path: 'D:/workspace/doc.md',
    })
  })

  it('rejects false native write/delete results from dedicated Tauri commands', async () => {
    const invoke = createInvokeMock({
      write_plugin_text_file: false,
      delete_plugin_file: false,
    })
    const adapter = createDesktopPluginFileBrokerAdapter({ invoke })

    await expect(adapter.writeText('D:/workspace/doc.md', 'updated')).rejects.toThrow(
      'Native plugin file write was rejected',
    )
    await expect(adapter.deleteFile('D:/workspace/doc.md')).rejects.toThrow(
      'Native plugin file delete was rejected',
    )
  })

  it('records broker audit failures when native file commands reject writes', async () => {
    const audit = vi.fn()
    const invoke = createInvokeMock({
      resolve_plugin_file_path: (args: Record<string, unknown>) => String(args.path),
      write_plugin_text_file: false,
    })
    const broker = createDesktopPluginFileBroker({
      manifest: {
        id: 'desktop-file-tools',
        name: 'Desktop File Tools',
        version: '1.0.0',
        permissions: ['file:write'],
      },
      roots: [{ id: 'workspace', path: 'D:/workspace' }],
      invoke,
      audit,
    })

    await expect(
      broker.writeText({ path: 'D:/workspace/doc.md', text: 'updated' }),
    ).rejects.toThrow('Native plugin file write was rejected')
    expect(audit).toHaveBeenCalledWith({
      pluginId: 'desktop-file-tools',
      operation: 'write',
      requestedPath: 'D:/workspace/doc.md',
      ok: false,
      reason: 'Native plugin file write was rejected',
    })
  })

  it('combines the desktop adapter with plugin broker scope checks', async () => {
    const invoke = createInvokeMock({
      resolve_plugin_file_path: (args: Record<string, unknown>) =>
        args.path === 'D:/workspace/../secret.md'
          ? 'D:/secret.md'
          : String(args.path).replaceAll('\\', '/'),
      read_plugin_text_file: 'allowed',
    })
    const broker = createDesktopPluginFileBroker({
      manifest: {
        id: 'desktop-file-tools',
        name: 'Desktop File Tools',
        version: '1.0.0',
        permissions: ['file:read'],
      },
      roots: [{ id: 'workspace', path: 'D:/workspace' }],
      invoke,
    })

    await expect(broker.readText({ path: 'D:/workspace/doc.md' })).resolves.toBe('allowed')
    await expect(broker.readText({ path: 'D:/workspace/../secret.md' })).rejects.toThrow(
      'outside allowed roots',
    )
    expect(invoke).toHaveBeenCalledWith('read_plugin_text_file', {
      path: 'D:/workspace/doc.md',
    })
    expect(invoke).not.toHaveBeenCalledWith('read_plugin_text_file', {
      path: 'D:/secret.md',
    })
  })

  it('provides desktop broker file capabilities to a worker plugin through RPC', async () => {
    const { main, worker } = createEndpointPair()
    const manifest = workerFileManifest()
    const invoke = createInvokeMock({
      resolve_plugin_file_path: (args: Record<string, unknown>) => String(args.path),
      read_plugin_text_file: 'desktop',
      write_plugin_text_file: true,
    })
    const fileBroker = createDesktopPluginFileBroker({
      manifest,
      roots: [{ id: 'workspace', path: 'D:/workspace' }],
      invoke,
    })
    const module: PluginModule = {
      commands: {
        'desktopWorker.updateFile': async (context) => {
          const text = await context.host.readText?.('D:/workspace/doc.md')

          await context.host.writeText?.('D:/workspace/doc.md', `${text} worker`)
          return { text }
        },
      },
    }
    const realm = initializePluginWorkerRealm(worker, {
      importModule: async () => ({ default: module }),
    })
    const workerHost = createBrowserWorkerPluginHost({
      worker: main,
      manifest,
      moduleSpecifier: './desktop-worker-plugin.js',
      fileBroker,
    })
    const registry = new ActionRegistry()
    const runtime = new PluginRuntime({
      actionRegistry: registry,
      allowedPermissions: ['file:read', 'file:write'],
      fileBroker,
    })

    await workerHost.ready
    runtime.loadPlugin({
      manifest,
      module: createIsolatedPluginModule({
        manifest,
        host: workerHost.host,
      }),
    })
    await runtime.enablePlugin('desktop-worker-files')

    await expect(
      registry.run('desktopWorker.updateFile', {
        permissions: ['file:read', 'file:write'],
      }),
    ).resolves.toEqual({
      ok: true,
      value: { text: 'desktop' },
    })
    expect(invoke).toHaveBeenCalledWith('read_plugin_text_file', {
      path: 'D:/workspace/doc.md',
    })
    expect(invoke).toHaveBeenCalledWith('write_plugin_text_file', {
      path: 'D:/workspace/doc.md',
      text: 'desktop worker',
    })

    workerHost.dispose()
    realm.dispose()
  })
})

function createEndpointPair() {
  const main = new MemoryWorkerEndpoint()
  const worker = new MemoryWorkerEndpoint()

  main.peer = worker
  worker.peer = main

  return { main, worker }
}

class MemoryWorkerEndpoint {
  peer: MemoryWorkerEndpoint | undefined
  private readonly listeners = new Set<(event: { readonly data: unknown }) => void>()

  postMessage(message: unknown): void {
    queueMicrotask(() => {
      for (const listener of this.peer?.listeners ?? []) {
        listener({ data: message })
      }
    })
  }

  addEventListener(_type: 'message', listener: (event: { readonly data: unknown }) => void): void {
    this.listeners.add(listener)
  }

  removeEventListener(
    _type: 'message',
    listener: (event: { readonly data: unknown }) => void,
  ): void {
    this.listeners.delete(listener)
  }
}

function workerFileManifest(): PluginManifest {
  return {
    id: 'desktop-worker-files',
    name: 'Desktop Worker Files',
    version: '1.0.0',
    permissions: ['file:read', 'file:write'],
    contributes: {
      commands: [
        {
          id: 'desktopWorker.updateFile',
          title: 'Update File',
          action: 'desktopWorker.updateFile',
        },
      ],
    },
  }
}

function createInvokeMock(
  responses: Readonly<
    Record<string, unknown | ((args: Record<string, unknown>) => unknown | Promise<unknown>)>
  >,
): DesktopPluginFileInvoke {
  return vi.fn(async (command: string, args: Record<string, unknown> = {}) => {
    const response = responses[command]

    return typeof response === 'function' ? response(args) : response
  }) as DesktopPluginFileInvoke
}

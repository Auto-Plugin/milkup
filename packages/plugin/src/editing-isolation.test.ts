import { describe, it, expect, vi } from 'vitest'
import { createBrowserWorkerPluginHost, initializePluginWorkerRealm } from './isolation-worker'
import { createSidecarPluginModule } from './isolation-sidecar'
import { createPluginIsolationRpcServer } from './isolation-rpc'
import { PluginRuntime } from './runtime'
import {
  createPluginEditingBroker,
  type PluginEditingHost,
  type PluginEditingSnapshot,
} from './editing-broker'
import { createPluginResourcesBroker, type PluginResourcesHost } from './resources-broker'
import { createRpcPluginEditingBroker } from './editing-rpc'
import { createRpcPluginResourcesBroker } from './resources-rpc'
import { pair, flush } from './settings-test-helpers'
const snapshot: PluginEditingSnapshot = {
  id: 'snap-1',
  documentId: 'doc-1',
  version: 1,
  selectionRevision: 0,
  saveLocationGeneration: 0,
  from: 0,
  to: 1,
  text: 'x',
  selection: { anchor: 0, head: 1 },
  startLine: 1,
  lineCount: 1,
  lineEnding: 'lf',
  mode: 'memory',
}
const manifest = {
  id: 'isolated-edit',
  name: 'Edit',
  version: '1.0.0',
  permissions: ['document:read', 'document:write', 'images:import'] as const,
}
function adapters() {
  return {
    editing: {
      capture: vi.fn(async () => snapshot),
      apply: vi.fn(async () => ({ documentId: 'doc-1', version: 2 })),
      table: vi.fn(async () => ({ documentId: 'doc-1', version: 2 })),
      release: vi.fn(async () => {}),
    },
    resources: {
      prepareDocument: vi.fn(async () => ({ status: 'ready' as const, id: 'intent-1' })),
      choose: vi.fn(async () => null),
      stage: vi.fn(async () => ({
        id: 'asset-1',
        reference: 'assets/x.png',
        mimeType: 'image/png' as const,
        sizeBytes: 32,
        width: 1,
        height: 1,
      })),
      abort: vi.fn(async () => {}),
    },
  }
}
describe('editing/resource isolation lifecycle', () => {
  it.each([true, false])('Worker capabilities declared=%s', async (allowed) => {
    const p = pair(),
      a = adapters(),
      current = { ...manifest, permissions: allowed ? manifest.permissions : [] }
    const editing = createPluginEditingBroker({ manifest: current, adapter: a.editing })
    const resources = createPluginResourcesBroker({
      manifest: current,
      adapter: a.resources,
      getSnapshot: (id) => editing.getSnapshot(id),
    })
    let captured: { editing?: PluginEditingHost; resources?: PluginResourcesHost } | undefined
    const realm = initializePluginWorkerRealm(p.worker, {
      importModule: async () => ({
        activate: ({ host }: { host: typeof captured }) => {
          captured = host
        },
      }),
    })
    const host = createBrowserWorkerPluginHost({
      worker: p.main,
      manifest: current,
      moduleSpecifier: './plugin.js',
      editingBroker: editing,
      resourcesBroker: resources,
    })
    await host.ready
    await host.host.activate({
      pluginId: current.id,
      manifest: current,
      permissions: current.permissions,
      hostCapabilities: ['document:read', 'document:write', 'images:import'],
    })
    if (allowed) {
      expect(await captured!.editing!.capture({ extent: 'selection' })).toEqual(snapshot)
      resources.grantPaste('paste-1')
      expect(await captured!.resources!.prepareDocument({ pasteId: 'paste-1' })).toEqual({
        status: 'ready',
        id: 'intent-1',
      })
      await host.host.deactivate({ pluginId: current.id })
      await expect(async () =>
        captured!.editing!.capture({ extent: 'selection' }),
      ).rejects.toMatchObject({ code: 'revoked' })
      await expect(async () => captured!.resources!.prepareDocument()).rejects.toMatchObject({
        code: 'revoked',
      })
    } else {
      expect(captured!.editing).toBeUndefined()
      expect(captured!.resources).toBeUndefined()
      p.worker.postMessage({
        protocol: 'milkup.plugin.editing.rpc.v1',
        type: 'request',
        id: 'forged',
        method: 'capture',
        payload: { request: { extent: 'selection' } },
      })
      await flush()
      expect(a.editing.capture).not.toHaveBeenCalled()
    }
    host.dispose()
    realm.dispose()
    editing.dispose()
    resources.dispose()
    expect(p.main.listeners.size + p.worker.listeners.size).toBe(0)
  })
  it('sidecar exposes both protocols and shutdown releases outstanding grants', async () => {
    const p = pair(),
      a = adapters(),
      current = { ...manifest, host: 'sidecar' as const }
    const editing = createPluginEditingBroker({ manifest: current, adapter: a.editing })
    const resources = createPluginResourcesBroker({
      manifest: current,
      adapter: a.resources,
      getSnapshot: (id) => editing.getSnapshot(id),
    })
    const server = createPluginIsolationRpcServer(p.worker, {
      activate: () => ({}),
      deactivate: () => {},
      runCommand: () => ({}),
      render: () => '',
      dispose: () => {},
    })
    const runtime = new PluginRuntime({
      allowedHosts: ['sidecar'],
      allowedPermissions: current.permissions,
      editingBroker: editing,
      resourcesBroker: resources,
    })
    runtime.loadPlugin({
      manifest: current,
      module: createSidecarPluginModule({
        manifest: current,
        process: { start: () => p.main },
        editingBroker: editing,
        resourcesBroker: resources,
      }),
    })
    await runtime.enablePlugin(current.id)
    const edits = createRpcPluginEditingBroker(p.worker),
      images = createRpcPluginResourcesBroker(p.worker)
    await edits.capture({ extent: 'selection' })
    resources.grantPaste('paste-1')
    await images.prepareDocument({ pasteId: 'paste-1' })
    await runtime.unloadPlugin(current.id)
    await flush()
    expect(a.editing.release).toHaveBeenCalled()
    expect(a.resources.abort).toHaveBeenCalled()
    await expect(edits.capture({ extent: 'selection' })).rejects.toMatchObject({ code: 'revoked' })
    await expect(images.prepareDocument()).rejects.toMatchObject({ code: 'revoked' })
    edits.dispose()
    images.dispose()
    server.dispose()
    editing.dispose()
    resources.dispose()
  })
})

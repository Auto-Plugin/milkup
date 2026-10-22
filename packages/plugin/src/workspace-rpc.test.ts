import { createSidecarPluginModule } from './isolation-sidecar'
import { createPluginIsolationRpcServer } from './isolation-rpc'
import { PluginRuntime } from './runtime'
import { describe, expect, it, vi } from 'vitest'
import {
  createPluginWorkspaceBroker,
  type PluginWorkspaceReadHost,
  type PluginWorkspaceHost,
} from './workspace-broker'
import { createPluginWorkspaceRpcServer, createRpcPluginWorkspaceBroker } from './workspace-rpc'
import { createBrowserWorkerPluginHost, initializePluginWorkerRealm } from './isolation-worker'
import type { PluginIsolationRpcMessageListener } from './isolation-rpc'
import { adapter, manifest, selected, file, deferred, flush } from './workspace-test-helpers'
const protocol = 'milkup.plugin.workspace.rpc.v1'
class Endpoint {
  peer!: Endpoint
  listeners = new Set<PluginIsolationRpcMessageListener>()
  sent: unknown[] = []
  postMessage(value: unknown) {
    this.sent.push(value)
    queueMicrotask(() => {
      for (const fn of this.peer.listeners) fn({ data: value })
    })
  }
  addEventListener(_type: 'message', listener: PluginIsolationRpcMessageListener) {
    this.listeners.add(listener)
  }
  removeEventListener(_type: 'message', listener: PluginIsolationRpcMessageListener) {
    this.listeners.delete(listener)
  }
}
function pair() {
  const main = new Endpoint()
  const worker = new Endpoint()
  main.peer = worker
  worker.peer = main
  return { main, worker }
}
function setup() {
  const endpoints = pair()
  const host = adapter()
  const broker = createPluginWorkspaceBroker({
    manifest,
    adapter: host,
    consumeGesture: (proof) => proof === 'trusted-proof',
  })
  const server = createPluginWorkspaceRpcServer(endpoints.main, broker)
  const client = createRpcPluginWorkspaceBroker(endpoints.worker, 20)
  return {
    ...endpoints,
    host,
    broker,
    server,
    client,
    close: () => {
      broker.dispose()
      server.dispose()
      client.dispose()
    },
  }
}
describe('workspace isolated protocol', () => {
  it('restores through RPC with no path-bearing payload and rejects forged selection fields', async () => {
    const endpoints = pair()
    const host = { ...adapter(), restoreRoot: vi.fn(async () => selected) }
    const broker = createPluginWorkspaceBroker({ manifest, adapter: host })
    const server = createPluginWorkspaceRpcServer(endpoints.main, broker)
    const client = createRpcPluginWorkspaceBroker(endpoints.worker)
    expect(await client.restoreRoot?.()).toEqual(selected)
    expect(endpoints.worker.sent[0]).toMatchObject({ method: 'restoreRoot', payload: {} })
    endpoints.worker.postMessage({
      protocol,
      type: 'request',
      id: 'forged',
      method: 'restoreRoot',
      payload: { path: '/arbitrary/path' },
    })
    await flush()
    expect(endpoints.main.sent).toContainEqual(
      expect.objectContaining({ id: 'forged', ok: false, error: { code: 'invalid-token' } }),
    )
    expect(host.restoreRoot).toHaveBeenCalledTimes(1)
    broker.dispose()
    server.dispose()
    client.dispose()
  })

  it('dispatches exact scope operations and excludes private native metadata', async () => {
    const s = setup()
    expect(await s.client.chooseRoot({ gesture: 'trusted-proof' })).toEqual(selected)
    expect(await s.client.listChildren(selected.id)).toMatchObject({
      entries: [file, expect.anything()],
    })
    expect(await s.client.resolveEntry(selected.id, file.relativePath)).toEqual(file)
    expect(await s.client.requestOpen(file.id, { gesture: 'trusted-proof' })).toEqual({
      status: 'opened',
    })
    const refreshed = await s.client.refreshRoot(selected.id)
    await s.client.releaseRoot(refreshed.id)
    await expect(s.client.listChildren(selected.id)).rejects.toMatchObject({
      code: 'invalid-token',
    })
    s.close()
  })
  it.each([
    { method: 'constructor', payload: {} },
    { method: 'dispose', payload: {} },
    { method: 'chooseRoot', payload: { path: '/private' } },
    { method: 'chooseRoot', payload: [], args: [] },
    { method: 'chooseRoot', payload: { gesture: true } },
    { method: 'listChildren', payload: { rootId: 'root-1', limit: 999999 } },
    { method: 'listChildren', payload: { rootId: 'root-1', signal: {} } },
    { method: 'resolveEntry', payload: { rootId: 'root-1', relativePath: '../private' } },
    { method: 'requestOpen', payload: { fileId: '/etc/passwd' } },
    { method: 'requestOpen', payload: { fileId: 'f', skipConfirmation: true } },
  ])('rejects malformed RPC without dispatch: %j', async (request) => {
    const s = setup()
    s.worker.postMessage({ protocol, type: 'request', id: 'forged', ...request })
    await flush()
    expect(s.main.sent).toContainEqual(expect.objectContaining({ id: 'forged', ok: false }))
    for (const method of Object.values(s.host)) expect(method).not.toHaveBeenCalled()
    s.close()
  })
  it('propagates AbortSignal to the host and ignores late replies', async () => {
    const s = setup()
    const waiting = deferred<typeof selected>()
    s.host.chooseRoot.mockReturnValueOnce(waiting.promise)
    const abort = new AbortController()
    const request = s.client.chooseRoot({ gesture: 'trusted-proof', signal: abort.signal })
    const rejected = expect(request).rejects.toMatchObject({ code: 'aborted' })
    await flush()
    abort.abort()
    await rejected
    await flush()
    expect(s.host.chooseRoot.mock.calls[0]![0]!.signal!.aborted).toBe(true)
    waiting.resolve({ ...selected, id: 'late' })
    await flush()
    expect(s.host.releaseRoot).toHaveBeenCalledWith('late')
    expect(s.worker.sent).toContainEqual(expect.objectContaining({ type: 'cancel' }))
    s.close()
  })
  it('timeout cancels actual server work instead of merely forgetting the response', async () => {
    vi.useFakeTimers()
    const s = setup()
    await s.client.chooseRoot({ gesture: 'trusted-proof' })
    s.host.resolveEntry.mockReturnValueOnce(new Promise(() => {}))
    const request = s.client.resolveEntry(selected.id, 'readme.md')
    const rejected = expect(request).rejects.toMatchObject({ code: 'aborted' })
    await flush()
    await vi.advanceTimersByTimeAsync(21)
    await rejected
    await flush()
    expect(s.host.resolveEntry.mock.calls[0]![2]!.signal!.aborted).toBe(true)
    s.close()
    vi.useRealTimers()
  })
  it('duplicate active IDs cannot dispatch a second picker and revoked server rejects pending work', async () => {
    const s = setup()
    s.host.chooseRoot.mockReturnValue(new Promise(() => {}))
    const promise = s.client.chooseRoot({ gesture: 'trusted-proof' })
    const rejected = expect(promise).rejects.toMatchObject({ code: 'revoked' })
    s.worker.postMessage(s.worker.sent[0])
    await flush()
    expect(s.host.chooseRoot).toHaveBeenCalledTimes(1)
    s.server.dispose()
    await rejected
    await flush()
    expect(s.host.chooseRoot.mock.calls[0]![0]!.signal!.aborted).toBe(true)
    s.close()
  })
  it('rejects malformed responses rather than exposing URLs or native paths', async () => {
    const { main, worker } = pair()
    const client = createRpcPluginWorkspaceBroker(worker)
    const request = client.chooseRoot({ gesture: 'proof' })
    const rejected = expect(request).rejects.toMatchObject({ code: 'unavailable' })
    main.postMessage({
      protocol,
      type: 'response',
      id: 'workspace-0',
      ok: true,
      value: { ...selected, path: '/private' },
    })
    await rejected
    client.dispose()
  })
  it('worker activation is read-only, command receives picker capability, and stale captures cannot revive', async () => {
    const { main, worker } = pair()
    const host = adapter()
    const broker = createPluginWorkspaceBroker({
      manifest,
      adapter: host,
      consumeGesture: (proof) => proof === 'trusted-proof',
    })
    const captured: PluginWorkspaceReadHost[] = []
    let commandHost: PluginWorkspaceHost | undefined
    const realm = initializePluginWorkerRealm(worker, {
      importModule: async () => ({
        activate: ({ host }: { host: { workspace: PluginWorkspaceReadHost } }) => {
          captured.push(host.workspace)
        },
        commands: {
          choose: ({ host }: { host: { workspace: PluginWorkspaceHost } }) => {
            commandHost = host.workspace
            return host.workspace.chooseRoot()
          },
        },
      }),
    })
    const workerHost = createBrowserWorkerPluginHost({
      worker: main,
      manifest,
      moduleSpecifier: './test.js',
      workspaceBroker: broker,
    })
    await workerHost.ready
    const activation = {
      pluginId: manifest.id,
      manifest,
      permissions: ['workspace:read'] as const,
      hostCapabilities: ['workspace:read'] as const,
    }
    await workerHost.host.activate(activation)
    expect(captured[0]).not.toHaveProperty('chooseRoot')
    expect(
      await workerHost.host.runCommand({
        pluginId: manifest.id,
        command: { id: 'choose', title: 'Choose', action: 'choose' },
        input: {},
        permissions: ['workspace:read'],
        hostCapabilities: ['workspace:read'],
        workspaceGesture: 'trusted-proof',
      }),
    ).toMatchObject({ value: selected })
    await captured[0]!.listChildren(selected.id)
    await workerHost.host.deactivate({ pluginId: manifest.id })
    await expect(commandHost!.chooseRoot()).rejects.toMatchObject({ code: 'revoked' })
    await workerHost.host.activate(activation)
    await expect(captured[0]!.listChildren(selected.id)).rejects.toMatchObject({ code: 'revoked' })
    workerHost.dispose()
    await flush()
    await expect(captured[1]!.listChildren(selected.id)).rejects.toMatchObject({ code: 'revoked' })
    realm.dispose()
    broker.dispose()
    expect(main.listeners.size + worker.listeners.size).toBe(0)
  })
  it('direct realm capability is sealed on realm disposal', async () => {
    const { main, worker } = pair()
    let captured: PluginWorkspaceReadHost | undefined
    const realm = initializePluginWorkerRealm(worker, {
      workspaceBroker: adapter(),
      importModule: async () => ({
        activate: ({ host }: { host: { workspace: PluginWorkspaceReadHost } }) => {
          captured = host.workspace
        },
      }),
    })
    const workerHost = createBrowserWorkerPluginHost({
      worker: main,
      manifest,
      moduleSpecifier: './test.js',
    })
    await workerHost.ready
    await workerHost.host.activate({
      pluginId: manifest.id,
      manifest,
      permissions: ['workspace:read'],
      hostCapabilities: ['workspace:read'],
    })
    realm.dispose()
    await expect(captured!.listChildren(selected.id)).rejects.toMatchObject({ code: 'revoked' })
    workerHost.dispose()
  })
  it('undeclared workspace permission is neither exposed nor served', async () => {
    const { main, worker } = pair()
    const host = adapter()
    const denied = { ...manifest, permissions: [] }
    let captured: unknown = 'unset'
    const realm = initializePluginWorkerRealm(worker, {
      importModule: async () => ({
        activate: ({ host }: { host: { workspace?: unknown } }) => {
          captured = host.workspace
        },
      }),
    })
    const workerHost = createBrowserWorkerPluginHost({
      worker: main,
      manifest: denied,
      moduleSpecifier: './test.js',
      workspaceBroker: host,
    })
    await workerHost.ready
    await workerHost.host.activate({
      pluginId: manifest.id,
      manifest: denied,
      permissions: [],
      hostCapabilities: ['workspace:read'],
    })
    expect(captured).toBeUndefined()
    worker.postMessage({
      protocol,
      type: 'request',
      id: 'forged',
      method: 'chooseRoot',
      payload: {},
    })
    await flush()
    expect(host.chooseRoot).not.toHaveBeenCalled()
    workerHost.dispose()
    realm.dispose()
  })
})

describe('workspace sidecar transport', () => {
  it('serves the same exact protocol and cancels pending calls when the sidecar stops', async () => {
    const { main, worker } = pair()
    const host = adapter()
    const broker = createPluginWorkspaceBroker({
      manifest,
      adapter: host,
      consumeGesture: () => true,
    })
    const isolated = createPluginIsolationRpcServer(worker, {
      activate: () => ({}),
      deactivate: () => {},
      runCommand: () => ({}),
      render: () => '',
      dispose: () => {},
    })
    const stopped = vi.fn()
    const runtime = new PluginRuntime({
      allowedHosts: ['sidecar'],
      allowedPermissions: ['workspace:read'],
      workspaceBroker: broker,
    })
    const sidecarManifest = { ...manifest, host: 'sidecar' as const }
    runtime.loadPlugin({
      manifest: sidecarManifest,
      module: createSidecarPluginModule({
        manifest: sidecarManifest,
        process: { start: () => main, stop: stopped },
        workspaceBroker: broker,
      }),
    })
    await runtime.enablePlugin(manifest.id)
    const client = createRpcPluginWorkspaceBroker(worker)
    expect(await client.chooseRoot()).toEqual(selected)
    host.resolveEntry.mockReturnValueOnce(new Promise(() => {}))
    const pending = client.resolveEntry(selected.id, file.relativePath)
    const rejected = expect(pending).rejects.toMatchObject({ code: 'revoked' })
    await flush()
    await runtime.disablePlugin(manifest.id)
    await rejected
    expect(host.resolveEntry.mock.calls[0]![2]!.signal!.aborted).toBe(true)
    expect(stopped).toHaveBeenCalledTimes(1)
    client.dispose()
    isolated.dispose()
    broker.dispose()
  })
})

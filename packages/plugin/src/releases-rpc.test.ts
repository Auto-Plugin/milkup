import { describe, expect, it, vi } from 'vitest'
import { createPluginReleasesBroker, type PluginReleasesHost } from './releases-broker'
import { createPluginReleasesRpcServer, createRpcPluginReleasesBroker } from './releases-rpc'
import { createBrowserWorkerPluginHost, initializePluginWorkerRealm } from './isolation-worker'
import type { PluginManifest } from './manifest'
import type { PluginIsolationRpcMessageListener } from './isolation-rpc'

const protocol = 'milkup.plugin.releases.rpc.v1'
const manifest: PluginManifest = {
  id: 'releases',
  name: 'Releases',
  version: '1.0.0',
  permissions: ['app:updates'],
}
const checkResult = {
  configured: true,
  channel: 'stable',
  currentVersion: '1.0.0',
  release: { id: 'opaque-1', version: '2.0.0', notes: 'Changes', date: null },
}
function adapter() {
  return {
    check: vi.fn(async () => checkResult),
    stage: vi.fn(async (_id: string) => {}),
    status: vi.fn(async (_id: string) => ({ phase: 'ready' as const, received: 5, total: 5 })),
    cancel: vi.fn(async (_id: string) => {}),
    requestInstall: vi.fn(async (_id: string) => ({ status: 'cancelled' as const })),
  }
}
class Endpoint {
  peer!: Endpoint
  readonly listeners = new Set<PluginIsolationRpcMessageListener>()
  readonly sent: unknown[] = []
  postMessage(value: unknown) {
    this.sent.push(value)
    queueMicrotask(() => {
      for (const listener of this.peer.listeners) listener({ data: value })
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
const flush = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve()
}

describe('release worker protocol', () => {
  it('dispatches all five exact methods and rejects unknown or unissued IDs', async () => {
    const { main, worker } = pair()
    const host = adapter()
    const broker = createPluginReleasesBroker({ manifest, adapter: host })
    const server = createPluginReleasesRpcServer(main, broker)
    const client = createRpcPluginReleasesBroker(worker)
    expect(await client.check()).toEqual(checkResult)
    await client.stage('opaque-1')
    expect(await client.status('opaque-1')).toEqual({ phase: 'ready', received: 5, total: 5 })
    await client.cancel('opaque-1')
    expect(await client.requestInstall('opaque-1')).toEqual({ status: 'cancelled' })
    await expect(client.stage('other')).rejects.toThrow('Unknown')
    await expect(client.stage('https://example.org')).rejects.toThrow('opaque')
    server.dispose()
    client.dispose()
  })

  it.each([
    { method: 'execute', payload: { releaseId: 'opaque-1' } },
    { method: '__proto__', payload: {} },
    { method: 'dispose', payload: {} },
    { method: 'check', payload: { url: 'https://example.org' } },
    { method: 'check', payload: [] },
    { method: 'check', payload: {}, args: [] },
    { method: 'stage', payload: { releaseId: 'opaque-1', url: 'https://example.org' } },
    { method: 'status', payload: {} },
    { method: 'cancel', payload: { releaseId: '/tmp/payload' } },
    { method: 'requestInstall', payload: { releaseId: 'opaque-1', confirmed: true } },
    { method: 'requestInstall', payload: { releaseId: { path: '/tmp/payload' } } },
  ])('rejects malformed request %j without invoking any adapter method', async (invalid) => {
    const { main, worker } = pair()
    const host = adapter()
    const server = createPluginReleasesRpcServer(main, host)
    worker.postMessage({ protocol, type: 'request', id: 'invalid-1', ...invalid })
    await flush()
    expect(main.sent).toMatchObject([{ protocol, type: 'response', id: 'invalid-1', ok: false }])
    for (const method of Object.values(host)) expect(method).not.toHaveBeenCalled()
    server.dispose()
  })

  it('rejects pending and stale calls on server disposal and suppresses late responses', async () => {
    const { main, worker } = pair()
    const host = adapter()
    let finish!: (result: typeof checkResult) => void
    host.check.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    const server = createPluginReleasesRpcServer(main, host)
    const client = createRpcPluginReleasesBroker(worker)
    const pending = client.check()
    const rejection = expect(pending).rejects.toThrow('disposed')
    await flush()
    server.dispose()
    await rejection
    finish(checkResult)
    await flush()
    expect(main.sent).toEqual([{ protocol, type: 'revoked' }])
    await expect(client.check()).rejects.toThrow('disposed')
    expect(main.listeners.size + worker.listeners.size).toBe(0)
  })

  it('rejects pending requests immediately on client disposal', async () => {
    const { worker } = pair()
    const client = createRpcPluginReleasesBroker(worker)
    const pending = client.check()
    const rejection = expect(pending).rejects.toThrow('disposed')
    client.dispose()
    client.dispose()
    await rejection
    await expect(client.requestInstall('opaque-1')).rejects.toThrow('disposed')
  })

  it('uses a longer bounded timeout for trusted install confirmation', async () => {
    vi.useFakeTimers()
    try {
      const { main, worker } = pair()
      const client = createRpcPluginReleasesBroker(worker, 20)
      const check = client.check()
      const checkFailure = expect(check).rejects.toThrow('timed out')
      await vi.advanceTimersByTimeAsync(20)
      await checkFailure
      const install = client.requestInstall('opaque-1')
      const outcome = vi.fn()
      void install.then(outcome, outcome)
      await vi.advanceTimersByTimeAsync(30_000)
      expect(outcome).not.toHaveBeenCalled()
      main.postMessage({
        protocol,
        type: 'response',
        id: 'release-1',
        ok: true,
        value: { status: 'cancelled' },
      })
      await expect(install).resolves.toEqual({ status: 'cancelled' })
      client.dispose()
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not dispatch duplicate pending side effects', async () => {
    const { main, worker } = pair()
    const host = adapter()
    let finish!: () => void
    host.stage.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    const server = createPluginReleasesRpcServer(main, host)
    const request = {
      protocol,
      type: 'request',
      id: 'once',
      method: 'stage',
      payload: { releaseId: 'opaque-1' },
    }
    worker.postMessage(request)
    worker.postMessage(request)
    await flush()
    expect(host.stage).toHaveBeenCalledTimes(1)
    finish()
    await flush()
    server.dispose()
  })

  it('integrates the worker lifecycle and invalidates activation handles', async () => {
    const { main, worker } = pair()
    const broker = createPluginReleasesBroker({ manifest, adapter: adapter() })
    const captured: PluginReleasesHost[] = []
    const realm = initializePluginWorkerRealm(worker, {
      importModule: async () => ({
        activate: ({ host }: { host: { releases: PluginReleasesHost } }) => {
          captured.push(host.releases)
        },
      }),
    })
    const workerHost = createBrowserWorkerPluginHost({
      worker: main,
      manifest,
      moduleSpecifier: './test.js',
      releasesBroker: broker,
    })
    await workerHost.ready
    const request = {
      pluginId: manifest.id,
      manifest,
      permissions: ['app:updates'] as const,
      hostCapabilities: ['app:updates'] as const,
    }
    await workerHost.host.activate(request)
    expect(await captured[0]!.check()).toEqual(checkResult)
    await workerHost.host.deactivate({ pluginId: manifest.id })
    await expect(captured[0]!.check()).rejects.toThrow('revoked')
    await workerHost.host.activate(request)
    await expect(captured[0]!.check()).rejects.toThrow('revoked')
    await captured[1]!.stage((await captured[1]!.check()).release!.id)
    workerHost.dispose()
    await flush()
    await expect(captured[1]!.check()).rejects.toThrow('disposed')
    realm.dispose()
    expect(main.listeners.size + worker.listeners.size).toBe(0)
  })

  it('revokes direct realm capabilities even when supplied without an RPC client', async () => {
    const { main, worker } = pair()
    const host = adapter()
    let captured: PluginReleasesHost | undefined
    const realm = initializePluginWorkerRealm(worker, {
      releasesBroker: host,
      importModule: async () => ({
        activate: ({ host }: { host: { releases: PluginReleasesHost } }) => {
          captured = host.releases
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
      permissions: ['app:updates'],
      hostCapabilities: ['app:updates'],
    })
    await captured!.check()
    realm.dispose()
    await expect(captured!.check()).rejects.toThrow('revoked')
    expect(host.check).toHaveBeenCalledTimes(1)
    workerHost.dispose()
  })

  it('revokes capabilities captured by a failed activation', async () => {
    const { main, worker } = pair()
    let captured: PluginReleasesHost | undefined
    const realm = initializePluginWorkerRealm(worker, {
      importModule: async () => ({
        activate: ({ host }: { host: { releases: PluginReleasesHost } }) => {
          captured = host.releases
          throw new Error('activation failed')
        },
      }),
    })
    const workerHost = createBrowserWorkerPluginHost({
      worker: main,
      manifest,
      moduleSpecifier: './test.js',
      releasesBroker: adapter(),
    })
    await workerHost.ready
    await expect(
      workerHost.host.activate({
        pluginId: manifest.id,
        manifest,
        permissions: ['app:updates'],
        hostCapabilities: ['app:updates'],
      }),
    ).rejects.toThrow('activation failed')
    await expect(captured!.check()).rejects.toThrow('revoked')
    workerHost.dispose()
    realm.dispose()
  })

  it('does not expose or serve updates for a worker without the manifest permission', async () => {
    const { main, worker } = pair()
    const host = adapter()
    let exposed: unknown = 'unset'
    const denied = { ...manifest, permissions: [] }
    const realm = initializePluginWorkerRealm(worker, {
      importModule: async () => ({
        activate: ({ host }: { host: { releases?: PluginReleasesHost } }) => {
          exposed = host.releases
        },
      }),
    })
    const workerHost = createBrowserWorkerPluginHost({
      worker: main,
      manifest: denied,
      moduleSpecifier: './test.js',
      releasesBroker: host,
    })
    await workerHost.ready
    await workerHost.host.activate({
      pluginId: manifest.id,
      manifest: denied,
      permissions: [],
      hostCapabilities: ['app:updates'],
    })
    expect(exposed).toBeUndefined()
    worker.postMessage({ protocol, type: 'request', id: 'forged', method: 'check', payload: {} })
    await flush()
    expect(host.check).not.toHaveBeenCalled()
    workerHost.dispose()
    realm.dispose()
  })
})

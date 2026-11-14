import { describe, expect, it, vi } from 'vitest'
import { createPluginSettingsBroker, type PluginSettingsHost } from './settings-broker'
import { createPluginSettingsRpcServer, createRpcPluginSettingsBroker } from './settings-rpc'
import { createBrowserWorkerPluginHost, initializePluginWorkerRealm } from './isolation-worker'
import {
  adapter,
  descriptor,
  snapshot,
  manifest,
  deferred,
  flush,
  pair,
} from './settings-test-helpers'
const protocol = 'milkup.plugin.settings.rpc.v1'
function setup() {
  const endpoints = pair(),
    host = adapter(),
    broker = createPluginSettingsBroker({ manifest, adapter: host })
  const server = createPluginSettingsRpcServer(endpoints.main, broker),
    client = createRpcPluginSettingsBroker(endpoints.worker, 25)
  return {
    ...endpoints,
    host,
    broker,
    server,
    client,
    close() {
      client.dispose()
      server.dispose()
      broker.dispose()
    },
  }
}
describe('settings isolated protocol', () => {
  it('roundtrips descriptor/snapshot and every exact transaction operation', async () => {
    const s = setup()
    expect(await s.client.describe('plugin')).toEqual(descriptor)
    expect(await s.client.get('application')).toEqual(snapshot)
    const tx = await s.client.begin('application')
    expect((await s.client.preview(tx.id, { size: 20 })).values.size).toBe(20)
    expect((await s.client.commit(tx.id)).revision).toBe(1)
    const own = await s.client.begin('plugin')
    await s.client.cancel(own.id)
    s.close()
  })
  it.each([
    { method: 'constructor', payload: {} },
    { method: 'dispose', payload: {} },
    { method: 'get', payload: { scope: 'other' } },
    { method: 'get', payload: { scope: 'plugin', pluginId: 'other' } },
    { method: 'begin', payload: { scope: 'application', path: '/private' } },
    { method: 'preview', payload: { id: 'tx', patch: { size: 14 }, args: [] } },
    { method: 'preview', payload: { id: 'tx', patch: { nested: { url: 'https://private' } } } },
    { method: 'preview', payload: { id: 'tx', patch: JSON.parse('{"__proto__":14}') } },
    { method: 'commit', payload: { id: '../foreign' } },
    { method: 'cancel', payload: { id: 'tx', signal: {} } },
    { method: 'get', payload: { scope: 'application' }, extra: true },
  ])('rejects malformed message %j without adapter access', async (request) => {
    const s = setup()
    s.worker.postMessage({ protocol, type: 'request', id: 'forged', ...request })
    await flush()
    expect(s.main.sent).toContainEqual(expect.objectContaining({ id: 'forged', ok: false }))
    for (const method of Object.values(s.host)) expect(method).not.toHaveBeenCalled()
    s.close()
  })
  it('timeout aborts host work and rolls back a late transaction instead of publishing it', async () => {
    vi.useFakeTimers()
    try {
      const s = setup(),
        late = deferred<{ id: string; snapshot: typeof snapshot }>()
      s.host.begin.mockReturnValueOnce(late.promise)
      const result = s.client.begin('application'),
        rejected = expect(result).rejects.toMatchObject({ code: 'aborted' })
      await flush()
      await vi.advanceTimersByTimeAsync(26)
      await rejected
      expect(s.host.begin.mock.calls[0]![1]!.signal!.aborted).toBe(true)
      late.resolve({ id: 'late', snapshot })
      await flush()
      expect(s.host.cancel).toHaveBeenCalledWith('late')
      s.close()
    } finally {
      vi.useRealTimers()
    }
  })
  it('client disposal closes the session and cancels an idle successful preview', async () => {
    const s = setup(),
      tx = await s.client.begin('application')
    await s.client.preview(tx.id, { size: 20 })
    s.client.dispose()
    await flush()
    expect(s.host.cancel).toHaveBeenCalledWith(tx.id, expect.anything())
    await expect(s.client.get('application')).rejects.toMatchObject({ code: 'revoked' })
    s.close()
  })
  it('aborts preview on AbortSignal and revokes its transaction', async () => {
    const s = setup(),
      tx = await s.client.begin('application'),
      late = deferred<typeof snapshot>()
    s.host.preview.mockReturnValueOnce(late.promise)
    const abort = new AbortController(),
      result = s.client.preview(tx.id, { size: 20 }, { signal: abort.signal }),
      rejected = expect(result).rejects.toMatchObject({ code: 'aborted' })
    await flush()
    abort.abort()
    await rejected
    await flush()
    expect(s.host.preview.mock.calls[0]![2]!.signal!.aborted).toBe(true)
    expect(s.host.cancel).toHaveBeenCalledWith(tx.id)
    late.resolve(snapshot)
    await flush()
    await expect(s.client.commit(tx.id)).rejects.toMatchObject({ code: 'invalid-transaction' })
    s.close()
  })
  it('duplicate in-flight IDs cannot perform a second begin', async () => {
    const s = setup(),
      late = deferred<{ id: string; snapshot: typeof snapshot }>()
    s.host.begin.mockReturnValueOnce(late.promise)
    const message = {
      protocol,
      type: 'request',
      id: 'duplicate',
      method: 'begin',
      payload: { scope: 'application' },
    }
    s.worker.postMessage(message)
    s.worker.postMessage(message)
    await flush()
    expect(s.host.begin).toHaveBeenCalledTimes(1)
    late.resolve({ id: 'tx', snapshot })
    await flush()
    s.close()
  })
  it('malformed host responses reject without exposing extra metadata', async () => {
    const endpoints = pair(),
      client = createRpcPluginSettingsBroker(endpoints.worker)
    const result = client.get('application'),
      rejected = expect(result).rejects.toMatchObject({ code: 'unavailable' })
    await flush()
    const request = endpoints.worker.sent[0] as { id: string }
    endpoints.main.postMessage({
      protocol,
      type: 'response',
      id: request.id,
      ok: true,
      value: { ...snapshot, path: '/private' },
    })
    await rejected
    client.dispose()
  })
  it('worker transports settings only with permission and seals captured capability on shutdown', async () => {
    const { main, worker } = pair(),
      host = adapter(),
      broker = createPluginSettingsBroker({ manifest, adapter: host })
    const captured: PluginSettingsHost[] = []
    const realm = initializePluginWorkerRealm(worker, {
      importModule: async () => ({
        activate: ({ host }: { host: { settings: PluginSettingsHost } }) => {
          captured.push(host.settings)
        },
      }),
    })
    const workerHost = createBrowserWorkerPluginHost({
      worker: main,
      manifest,
      moduleSpecifier: './settings.js',
      settingsBroker: broker,
    })
    await workerHost.ready
    const activation = {
      pluginId: manifest.id,
      manifest,
      permissions: ['settings:write'] as const,
      hostCapabilities: ['settings:write'] as const,
    }
    await workerHost.host.activate(activation)
    const tx = await captured[0]!.begin('application')
    await captured[0]!.preview(tx.id, { size: 18 })
    await workerHost.host.deactivate({ pluginId: manifest.id })
    await expect(captured[0]!.get('application')).rejects.toMatchObject({ code: 'revoked' })
    workerHost.dispose()
    realm.dispose()
    await flush()
    expect(host.cancel).toHaveBeenCalled()
    broker.dispose()
    expect(main.listeners.size + worker.listeners.size).toBe(0)
  })
  it('undeclared settings are not exposed or served even when a broker is supplied', async () => {
    const { main, worker } = pair(),
      host = adapter(),
      denied = { ...manifest, permissions: [] }
    let captured: unknown = 'unset'
    const realm = initializePluginWorkerRealm(worker, {
      importModule: async () => ({
        activate: ({ host }: { host: { settings?: unknown } }) => {
          captured = host.settings
        },
      }),
    })
    const workerHost = createBrowserWorkerPluginHost({
      worker: main,
      manifest: denied,
      moduleSpecifier: './settings.js',
      settingsBroker: host,
    })
    await workerHost.ready
    await workerHost.host.activate({
      pluginId: manifest.id,
      manifest: denied,
      permissions: [],
      hostCapabilities: ['settings:write'],
    })
    expect(captured).toBeUndefined()
    worker.postMessage({
      protocol,
      type: 'request',
      id: 'try',
      method: 'get',
      payload: { scope: 'application' },
    })
    await flush()
    expect(host.get).not.toHaveBeenCalled()
    workerHost.dispose()
    realm.dispose()
  })
})

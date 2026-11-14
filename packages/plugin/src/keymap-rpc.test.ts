import { describe, expect, it, vi } from 'vitest'
import {
  createPluginKeymapBroker,
  createPluginKeymapHostCapabilities,
  type PluginKeymapHost,
  type PluginKeymapSnapshot,
} from './keymap-broker'
import { createPluginKeymapRpcServer, createRpcPluginKeymapBroker } from './keymap-rpc'
import { pair, flush, deferred } from './settings-test-helpers'
const manifest = {
  id: 'shortcuts',
  name: 'Shortcuts',
  version: '1.0.0',
  permissions: ['app:keymap'] as const,
}
const snapshot: PluginKeymapSnapshot = {
  revision: 0,
  commands: [
    {
      id: 'file.save',
      title: 'Save',
      category: 'file',
      keys: ['Mod+S'],
      defaultKeys: ['Mod+S'],
      available: true,
      bindable: true,
    },
  ],
  fixedShortcuts: [],
}
function setup() {
  const endpoints = pair()
  const adapter = {
    snapshot: vi.fn(async () => snapshot),
    update: vi.fn(async () => ({ ...snapshot, revision: 1 })),
    reset: vi.fn(async () => ({ ...snapshot, revision: 2 })),
  } satisfies PluginKeymapHost
  const broker = createPluginKeymapBroker({ manifest, adapter })
  const server = createPluginKeymapRpcServer(endpoints.main, broker)
  const client = createRpcPluginKeymapBroker(endpoints.worker, 50)
  return {
    ...endpoints,
    adapter,
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
describe('bounded keymap permission and isolated RPC', () => {
  it('roundtrips catalogue, atomic update and reset without execute/file access', async () => {
    const s = setup()
    expect(await s.client.snapshot()).toEqual(snapshot)
    expect(
      (
        await s.client.update({
          revision: 0,
          bindings: [{ command: 'file.save', keys: ['Mod+K'] }],
        })
      ).revision,
    ).toBe(1)
    expect((await s.client.reset({ revision: 1 })).revision).toBe(2)
    expect(Object.keys(createPluginKeymapHostCapabilities(s.broker))).toEqual([
      'snapshot',
      'update',
      'reset',
    ])
    s.close()
  })
  it('denies missing/revoked permission before adapter access', async () => {
    const s = setup()
    const denied = createPluginKeymapBroker({
      manifest: { ...manifest, permissions: [] },
      adapter: s.adapter,
    })
    await expect(denied.snapshot()).rejects.toMatchObject({ code: 'revoked' })
    expect(s.adapter.snapshot).not.toHaveBeenCalled()
    s.broker.dispose()
    await expect(s.broker.snapshot()).rejects.toMatchObject({ code: 'revoked' })
    s.close()
  })
  it.each([
    { method: 'constructor', payload: {} },
    { method: 'execute', payload: { command: 'file.save' } },
    { method: 'snapshot', payload: { path: '/private' } },
    { method: 'reset', payload: { revision: -1 } },
    {
      method: 'update',
      payload: {
        revision: 0,
        bindings: [{ command: 'save', keys: ['Mod+K'], url: 'https://private' }],
      },
    },
    {
      method: 'update',
      payload: {
        revision: 0,
        bindings: [
          { command: 'save', keys: ['Mod+K'] },
          { command: 'save', keys: [] },
        ],
      },
    },
    { method: 'update', payload: { revision: 0, bindings: [], pluginId: 'foreign' } },
  ])('rejects forged request without adapter access %j', async (request) => {
    const s = setup()
    s.worker.postMessage({
      protocol: 'milkup.plugin.keymap.rpc.v1',
      type: 'request',
      id: 'forged',
      ...request,
    })
    await flush()
    expect(s.main.sent).toContainEqual(expect.objectContaining({ id: 'forged', ok: false }))
    for (const method of Object.values(s.adapter)) expect(method).not.toHaveBeenCalled()
    s.close()
  })
  it('sanitizes filesystem failures across RPC', async () => {
    const s = setup()
    s.adapter.snapshot.mockRejectedValueOnce(new Error('/private/user/token'))
    await expect(s.client.snapshot()).rejects.toMatchObject({
      code: 'unavailable',
      message: '快捷键服务暂不可用。',
    })
    expect(JSON.stringify(s.main.sent)).not.toContain('/private')
    s.close()
  })
  it('revokes outstanding operations immediately and forwards abort to adapter', async () => {
    const s = setup(),
      late = deferred<PluginKeymapSnapshot>()
    s.adapter.snapshot.mockReturnValueOnce(late.promise)
    const operation = s.client.snapshot(),
      rejected = expect(operation).rejects.toMatchObject({ code: 'revoked' })
    await flush()
    s.client.dispose()
    await rejected
    await flush()
    const options = (s.adapter.snapshot.mock.calls as unknown as [[{ signal: AbortSignal }]])[0][0]
    expect(options.signal.aborted).toBe(true)
    late.resolve(snapshot)
    await flush()
    s.close()
  })
  it('timeout aborts adapter and keeps closed client unusable', async () => {
    vi.useFakeTimers()
    try {
      const s = setup(),
        late = deferred<PluginKeymapSnapshot>()
      s.adapter.snapshot.mockReturnValueOnce(late.promise)
      const result = s.client.snapshot(),
        rejected = expect(result).rejects.toMatchObject({ code: 'aborted' })
      await flush()
      await vi.advanceTimersByTimeAsync(51)
      await rejected
      await flush()
      expect(
        (s.adapter.snapshot.mock.calls as unknown as [[{ signal: AbortSignal }]])[0][0].signal
          .aborted,
      ).toBe(true)
      late.resolve(snapshot)
      s.close()
    } finally {
      vi.useRealTimers()
    }
  })
  it('pre-abort makes no request; host capability revocation prevents new calls', async () => {
    const s = setup()
    await expect(s.client.snapshot({ signal: AbortSignal.abort() })).rejects.toMatchObject({
      code: 'aborted',
    })
    const host = createPluginKeymapHostCapabilities(s.broker, () => false)
    await expect(host.snapshot()).rejects.toMatchObject({ code: 'revoked' })
    expect(s.adapter.snapshot).not.toHaveBeenCalled()
    s.close()
  })
})

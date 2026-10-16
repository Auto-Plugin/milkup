import { describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'

import {
  createPluginNetworkBroker,
  type PluginNetworkAuditRecord,
  type PluginNetworkBrokerAdapter,
} from './network-broker'
import type { PluginManifest, PluginPermission } from './manifest'

describe('plugin network broker', () => {
  it('fetches through the adapter when network access is declared', async () => {
    const adapter = createNetworkAdapter({ ok: true })
    const broker = createPluginNetworkBroker({
      manifest: manifestWith(['network:access']),
      adapter,
    })

    await expect(
      broker.fetch({
        url: 'https://api.example.test/data',
        init: { method: 'POST' },
      }),
    ).resolves.toEqual({ ok: true })
    expect(adapter.fetch).toHaveBeenCalledWith('https://api.example.test/data', {
      method: 'POST',
    })
  })

  it('rejects fetch access without network permission', async () => {
    const adapter = createNetworkAdapter()
    const broker = createPluginNetworkBroker({
      manifest: manifestWith([]),
      adapter,
    })

    await expect(broker.fetch({ url: 'https://api.example.test/data' })).rejects.toThrow(
      'network:access',
    )
    expect(adapter.fetch).not.toHaveBeenCalled()
  })

  it('enforces allowed origins after URL validation', async () => {
    const adapter = createNetworkAdapter('ok')
    const broker = createPluginNetworkBroker({
      manifest: manifestWith(['network:access']),
      adapter,
      allowedOrigins: ['https://api.example.test'],
    })

    await expect(broker.fetch({ url: 'https://api.example.test/data' })).resolves.toBe('ok')
    await expect(broker.fetch({ url: 'https://other.example.test/data' })).rejects.toThrow(
      'origin is not allowed',
    )
    expect(adapter.fetch).toHaveBeenCalledTimes(1)
  })

  it('rejects invalid URLs before calling the adapter', async () => {
    const adapter = createNetworkAdapter()
    const broker = createPluginNetworkBroker({
      manifest: manifestWith(['network:access']),
      adapter,
    })

    await expect(broker.fetch({ url: 'not a url' })).rejects.toThrow('Invalid plugin network URL')
    expect(adapter.fetch).not.toHaveBeenCalled()
  })

  it('records audit entries for allowed and denied fetches', async () => {
    const audit = vi.fn<(record: PluginNetworkAuditRecord) => void>()
    const adapter = createNetworkAdapter('ok')
    const broker = createPluginNetworkBroker({
      manifest: manifestWith(['network:access']),
      adapter,
      allowedOrigins: ['https://api.example.test'],
      audit,
    })

    await broker.fetch({ url: 'https://api.example.test/data' })
    await expect(broker.fetch({ url: 'https://blocked.example.test/data' })).rejects.toThrow(
      'origin is not allowed',
    )

    expect(audit).toHaveBeenCalledWith({
      pluginId: 'network-tools',
      url: 'https://api.example.test/data',
      origin: 'https://api.example.test',
      ok: true,
    })
    expect(audit).toHaveBeenCalledWith({
      pluginId: 'network-tools',
      url: 'https://blocked.example.test/data',
      ok: false,
      reason: 'Plugin network origin is not allowed: https://blocked.example.test',
    })
  })
})

function manifestWith(permissions: readonly PluginPermission[]): PluginManifest {
  return {
    id: 'network-tools',
    name: 'Network Tools',
    version: '1.0.0',
    permissions,
  }
}

function createNetworkAdapter(value: unknown = 'response'): PluginNetworkBrokerAdapter & {
  readonly fetch: Mock<(url: string, init?: unknown) => unknown>
} {
  return {
    fetch: vi.fn((_url: string, _init?: unknown) => value),
  }
}

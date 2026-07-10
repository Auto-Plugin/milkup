import { describe, expect, it, vi } from 'vitest'

import type { PluginIsolationRpcMessageListener } from './isolation-rpc'
import { createPluginStorageBroker } from './storage-broker'
import { createPluginStorageRpcServer, createRpcPluginStorageBroker } from './storage-rpc'

describe('plugin storage broker', () => {
  it('isolates keys by plugin and audits storage operations', async () => {
    const values = new Map<string, string>()
    const audit = vi.fn()
    const adapter = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value)
      },
      removeItem: (key: string) => {
        values.delete(key)
      },
    }
    const first = createPluginStorageBroker({ pluginId: 'first', adapter, audit })
    const second = createPluginStorageBroker({ pluginId: 'second', adapter })

    await first.setItem('theme', 'dark')
    await second.setItem('theme', 'light')

    await expect(first.getItem('theme')).resolves.toBe('dark')
    await expect(second.getItem('theme')).resolves.toBe('light')
    await expect(first.setItem('../escape', 'x')).rejects.toThrow('safe characters')
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ pluginId: 'first', operation: 'set', key: 'theme', ok: true }),
    )
  })

  it('brokers storage calls across an isolation RPC endpoint', async () => {
    const [hostEndpoint, pluginEndpoint] = createEndpointPair()
    const values = new Map<string, string>()
    const broker = createPluginStorageBroker({
      pluginId: 'rpc-plugin',
      adapter: {
        getItem: (key) => values.get(key) ?? null,
        setItem: (key, value) => {
          values.set(key, value)
        },
        removeItem: (key) => {
          values.delete(key)
        },
      },
    })
    const server = createPluginStorageRpcServer(hostEndpoint, broker)
    const client = createRpcPluginStorageBroker(pluginEndpoint)

    await client.setItem('setting', 'value')
    await expect(client.getItem('setting')).resolves.toBe('value')
    await client.removeItem('setting')
    await expect(client.getItem('setting')).resolves.toBeNull()

    client.dispose()
    server.dispose()
  })
})

class MemoryEndpoint {
  peer: MemoryEndpoint | undefined
  private readonly listeners = new Set<PluginIsolationRpcMessageListener>()

  postMessage(message: unknown): void {
    queueMicrotask(() => {
      for (const listener of this.peer?.listeners ?? []) {
        listener({ data: message })
      }
    })
  }

  addEventListener(_type: 'message', listener: PluginIsolationRpcMessageListener): void {
    this.listeners.add(listener)
  }

  removeEventListener(_type: 'message', listener: PluginIsolationRpcMessageListener): void {
    this.listeners.delete(listener)
  }
}

function createEndpointPair(): readonly [MemoryEndpoint, MemoryEndpoint] {
  const first = new MemoryEndpoint()
  const second = new MemoryEndpoint()
  first.peer = second
  second.peer = first
  return [first, second]
}

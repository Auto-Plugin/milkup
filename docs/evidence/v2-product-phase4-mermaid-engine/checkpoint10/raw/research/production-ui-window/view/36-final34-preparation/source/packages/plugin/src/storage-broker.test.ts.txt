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

  it('bounds active temporary stores and cleans a store created during broker disposal', async () => {
    const created = [] as ReturnType<typeof temporaryStore>[]
    let release: (() => void) | undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const broker = createPluginStorageBroker({
      pluginId: 'pages',
      adapter: persistentAdapter(),
      createTemporaryStore: async () => {
        await gate
        const store = temporaryStore()
        created.push(store)
        return store
      },
    })
    const pending = Array.from({ length: 4 }, () => broker.createTemporaryStore!())
    const settled = Promise.allSettled(pending)
    await expect(broker.createTemporaryStore!()).rejects.toThrow('4 stores')
    const disposal = broker.dispose()
    release!()
    expect((await settled).every((result) => result.status === 'rejected')).toBe(true)
    await disposal
    expect(created).toHaveLength(4)
    for (const store of created) expect(store.dispose).toHaveBeenCalledOnce()
    await expect(broker.createTemporaryStore!()).rejects.toThrow('disposed')
  })

  it('brokers bounded batches and refuses temporary access after endpoint disposal', async () => {
    const [hostEndpoint, pluginEndpoint] = createEndpointPair()
    const store = temporaryStore()
    const broker = createPluginStorageBroker({
      pluginId: 'pages',
      adapter: persistentAdapter(),
      createTemporaryStore: async () => store,
    })
    const server = createPluginStorageRpcServer(hostEndpoint, broker)
    const client = createRpcPluginStorageBroker(pluginEndpoint)
    const remote = await client.createTemporaryStore!()
    await remote.setMany([
      { key: 'p0', value: '中文' },
      { key: 'p1', value: 'next' },
    ])
    await expect(remote.getMany(['p1', 'p0', 'missing'])).resolves.toEqual(['next', '中文', null])
    await expect(remote.set('huge', 'x'.repeat(262145))).rejects.toThrow('256 KiB')
    await remote.dispose()
    await expect(remote.get('p0')).rejects.toThrow('disposed')
    expect(store.dispose).toHaveBeenCalledOnce()
    client.dispose()
    server.dispose()
    await broker.dispose()
    await expect(client.createTemporaryStore!()).rejects.toThrow('disposed')
  })

  it('closes server-owned stores without waiting for a cooperative Worker', async () => {
    const [hostEndpoint, pluginEndpoint] = createEndpointPair()
    const store = temporaryStore()
    const broker = createPluginStorageBroker({
      pluginId: 'pages',
      adapter: persistentAdapter(),
      createTemporaryStore: async () => store,
    })
    const server = createPluginStorageRpcServer(hostEndpoint, broker)
    const client = createRpcPluginStorageBroker(pluginEndpoint)
    await client.createTemporaryStore!()
    server.dispose()
    await broker.dispose()
    expect(store.dispose).toHaveBeenCalledOnce()
    client.dispose()
  })

  it('disposes a late-created store after its RPC server has already closed', async () => {
    const [hostEndpoint, pluginEndpoint] = createEndpointPair()
    const store = temporaryStore()
    let release: (() => void) | undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const started = vi.fn()
    const broker = createPluginStorageBroker({
      pluginId: 'late',
      adapter: persistentAdapter(),
      createTemporaryStore: async () => {
        started()
        await gate
        return store
      },
    })
    const server = createPluginStorageRpcServer(hostEndpoint, broker)
    const client = createRpcPluginStorageBroker(pluginEndpoint)
    const pending = client.createTemporaryStore!()
    const rejected = expect(pending).rejects.toThrow('disposed')
    await vi.waitFor(() => expect(started).toHaveBeenCalledOnce())
    server.dispose()
    client.dispose()
    release!()
    await rejected
    await vi.waitFor(() => expect(store.dispose).toHaveBeenCalledOnce())
    await broker.dispose()
  })
})

function persistentAdapter() {
  return { getItem: () => null, setItem: () => undefined, removeItem: () => undefined }
}
function temporaryStore() {
  const pages = new Map<string, string>()
  return {
    get: async (key: string) => pages.get(key) ?? null,
    set: async (key: string, value: string) => {
      pages.set(key, value)
    },
    getMany: async (keys: readonly string[]) => keys.map((key) => pages.get(key) ?? null),
    setMany: async (entries: readonly { readonly key: string; readonly value: string }[]) => {
      for (const entry of entries) pages.set(entry.key, entry.value)
    },
    dispose: vi.fn(async () => {
      pages.clear()
    }),
  }
}

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

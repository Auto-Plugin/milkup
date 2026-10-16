import { MemoryDocumentSource } from '@milkup/core'
import { describe, expect, it } from 'vitest'

import { createPluginDocumentBroker } from './document-broker'
import { createPluginDocumentRpcServer, createRpcPluginDocumentBroker } from './document-rpc'
import type { PluginIsolationRpcMessageListener, PluginIsolationRpcEndpoint } from './isolation-rpc'

describe('plugin document RPC', () => {
  it('transports start, next, and cancel requests across an isolation endpoint', async () => {
    const { host, plugin } = createEndpointPair()
    const source = new MemoryDocumentSource({ documentId: 'rpc-doc', text: '# RPC' })
    const server = createPluginDocumentRpcServer(
      host,
      createPluginDocumentBroker({ pluginId: 'outline', source: () => source }),
    )
    const broker = createRpcPluginDocumentBroker(plugin)
    const started = await broker.start({ query: { kind: 'markdownHeadings' } })

    await expect(broker.next(started.scanId)).resolves.toMatchObject({
      type: 'batch',
      items: [{ kind: 'heading', label: 'RPC' }],
    })
    await broker.cancel(started.scanId)
    await expect(broker.next(started.scanId)).rejects.toThrow('Unknown document scan')

    broker.dispose()
    server.dispose()
  })
})

function createEndpointPair(): {
  readonly host: PluginIsolationRpcEndpoint
  readonly plugin: PluginIsolationRpcEndpoint
} {
  const host = new MemoryEndpoint()
  const plugin = new MemoryEndpoint()
  host.peer = plugin
  plugin.peer = host
  return { host, plugin }
}

class MemoryEndpoint implements PluginIsolationRpcEndpoint {
  readonly listeners = new Set<PluginIsolationRpcMessageListener>()
  peer: MemoryEndpoint | undefined

  postMessage(message: unknown): void {
    queueMicrotask(() => {
      for (const listener of this.peer?.listeners ?? []) listener({ data: message })
    })
  }

  addEventListener(_type: 'message', listener: PluginIsolationRpcMessageListener): void {
    this.listeners.add(listener)
  }

  removeEventListener(_type: 'message', listener: PluginIsolationRpcMessageListener): void {
    this.listeners.delete(listener)
  }
}

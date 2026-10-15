import { MemoryDocumentSource } from '@milkup/core'
import { describe, expect, it, vi } from 'vitest'
import { createPluginDocumentBroker } from './document-broker'
import { createPluginDocumentRpcServer, createRpcPluginDocumentBroker } from './document-rpc'
import { createPluginUiBroker } from './ui-broker'
import { createPluginUiRpcServer, createRpcPluginUiBroker } from './ui-rpc'
import type { PluginIsolationRpcMessageListener } from './isolation-rpc'

class Endpoint {
  peer!: Endpoint
  readonly sent: unknown[] = []
  readonly listeners = new Set<PluginIsolationRpcMessageListener>()
  postMessage(value: unknown) {
    const data = structuredClone(value)
    this.sent.push(data)
    queueMicrotask(() => {
      for (const listener of this.peer.listeners) listener({ data })
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
  const host = new Endpoint(),
    worker = new Endpoint()
  host.peer = worker
  worker.peer = host
  return { host, worker }
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
const request = { documentId: 'rpc-document', version: 1, fromLine: 1, lineCount: 10 }

describe('document window and location transport', () => {
  it('roundtrips bounded windows and owned invalidation without exposing host-only data', async () => {
    const { host, worker } = pair()
    const source = new MemoryDocumentSource({
      documentId: request.documentId,
      version: 1,
      text: 'a\r\n😀',
    })
    const refresh = vi.fn()
    const server = createPluginDocumentRpcServer(
      host,
      createPluginDocumentBroker({
        pluginId: 'notes',
        source: () => source,
        rendererIds: ['notes'],
        invalidatePresentation: refresh,
      }),
    )
    const client = createRpcPluginDocumentBroker(worker)
    expect(await client.readWindow!(request)).toMatchObject({
      text: 'a\r\n😀',
      lines: [
        { from: 0, to: 1 },
        { from: 3, to: 5 },
      ],
      completeEnd: true,
    })
    await client.invalidatePresentation!({
      documentId: request.documentId,
      version: 1,
      rendererId: 'notes',
    })
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(host.sent)).not.toMatch(/readLineWindow|sourcePath|assertActive/)
    client.dispose()
    server.dispose()
  })
  it.each(['abort', 'timeout', 'dispose'] as const)(
    'cancels a stalled source through RPC on %s and never sends late text',
    async (kind) => {
      const { host, worker } = pair()
      const source = new MemoryDocumentSource({
        documentId: request.documentId,
        version: 1,
        text: 'late-private-text',
      })
      const window = await source.readLineWindow(1, 1)
      const wait = deferred<typeof window>()
      const read = vi.spyOn(source, 'readLineWindow').mockReturnValue(wait.promise)
      const server = createPluginDocumentRpcServer(
        host,
        createPluginDocumentBroker({ pluginId: 'notes', source: () => source }),
      )
      const client = createRpcPluginDocumentBroker(worker, { timeoutMs: 50 })
      const controller = new AbortController()
      const promise = client.readWindow!(request, { signal: controller.signal })
      const rejected = expect(promise).rejects.toThrow(/abort|timed out|disposed/)
      await vi.waitFor(() => expect(read).toHaveBeenCalled(), { interval: 1 })
      if (kind === 'abort') controller.abort()
      else if (kind === 'dispose') client.dispose()
      await rejected
      wait.resolve(window)
      await new Promise((resolve) => setTimeout(resolve, 5))
      expect(JSON.stringify(host.sent)).not.toContain('late-private-text')
      client.dispose()
      server.dispose()
    },
  )
  it('server disposal aborts its broker and suppresses outstanding responses', async () => {
    const { host, worker } = pair()
    const source = new MemoryDocumentSource({
      documentId: request.documentId,
      version: 1,
      text: 'private',
    })
    const window = await source.readLineWindow(1, 1),
      wait = deferred<typeof window>()
    const read = vi.spyOn(source, 'readLineWindow').mockReturnValue(wait.promise)
    const broker = createPluginDocumentBroker({ pluginId: 'notes', source: () => source })
    const server = createPluginDocumentRpcServer(host, broker),
      client = createRpcPluginDocumentBroker(worker)
    const pending = client.readWindow!(request)
    const rejected = expect(pending).rejects.toThrow(/disposed/)
    await vi.waitFor(() => expect(read).toHaveBeenCalled(), { interval: 1 })
    server.dispose()
    client.dispose()
    await rejected
    wait.resolve(window)
    await Promise.resolve()
    await Promise.resolve()
    expect(host.sent).toEqual([])
    await expect(broker.readWindow(request)).rejects.toThrow(/revoked/)
  })
  it('transports versioned navigation, cancels before host commit and retains revealLine', async () => {
    const { host, worker } = pair(),
      wait = deferred<void>()
    const commit = vi.fn(),
      oldNavigation = vi.fn()
    const started = vi.fn()
    const broker = createPluginUiBroker({
      pluginId: 'notes',
      viewIds: [],
      update() {},
      revealLine: oldNavigation,
      revealLocation: async (_value, context) => {
        started()
        await wait.promise
        context.assertActive()
        commit()
      },
    })
    const server = createPluginUiRpcServer(host, broker),
      client = createRpcPluginUiBroker(worker)
    await client.revealLine(2)
    expect(oldNavigation).toHaveBeenCalledWith(2)
    const controller = new AbortController()
    const pending = client.revealLocation!(
      { documentId: request.documentId, version: 1, from: 2, to: 3 },
      { signal: controller.signal },
    )
    const rejected = expect(pending).rejects.toThrow(/aborted/)
    await vi.waitFor(() => expect(started).toHaveBeenCalled(), { interval: 1 })
    controller.abort()
    await rejected
    wait.resolve()
    await new Promise((resolve) => setTimeout(resolve, 5))
    expect(commit).not.toHaveBeenCalled()
    client.dispose()
    server.dispose()
  })
})

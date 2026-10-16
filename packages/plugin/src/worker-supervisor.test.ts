import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDocumentRenderRpcClient } from './document-render-rpc'
import {
  createSupervisedPluginWorkerEndpoint,
  initializePluginWorkerSupervisor,
} from './worker-supervisor'
import { createRpcPluginIsolationHost } from './isolation-rpc'
import { createBrowserWorkerPluginHost } from './isolation-worker'

function channel() {
  const mainListeners = new Set<(value: unknown) => void>()
  const remoteListeners = new Set<(value: unknown) => void>()
  const main = {
    postMessage: vi.fn((value: unknown) => {
      for (const fn of remoteListeners) fn(value)
    }),
    on: (_: string, fn: (value: unknown) => void) => {
      mainListeners.add(fn)
    },
    off: (_: string, fn: (value: unknown) => void) => {
      mainListeners.delete(fn)
    },
    terminate: vi.fn(),
  }
  const remote = {
    postMessage: vi.fn((value: unknown) => {
      for (const fn of mainListeners) fn(value)
    }),
    on: (_: string, fn: (value: unknown) => void) => {
      remoteListeners.add(fn)
    },
    off: (_: string, fn: (value: unknown) => void) => {
      remoteListeners.delete(fn)
    },
  }
  return { main, remote }
}
const protocol = 'milkup.plugin.worker-supervisor.v1'
const renderProtocol = 'milkup.plugin.document-render.v1'
const payload = {
  pluginId: 'test',
  rendererId: 'test',
  request: {
    documentId: 'doc',
    version: 1,
    from: 0,
    to: 5,
    source: 'hello',
    fromLine: 1,
    toLine: 1,
    completeStart: true,
    completeEnd: true,
    contextKnown: true,
    protectedRanges: [],
    blocks: [],
    selection: { anchor: 0, head: 0 },
    theme: 'light' as const,
    target: 'screen' as const,
    width: 400,
  },
}
const output = { fragments: [], complete: true }
afterEach(() => vi.useRealTimers())

describe('trusted Worker render supervision', () => {
  it('reports child startup failure distinctly and revokes pending startup', async () => {
    vi.useFakeTimers()
    const wire = channel(),
      realm = initializePluginWorkerSupervisor(wire.remote, () => {
        throw Error('loading failure')
      })
    const endpoint = createSupervisedPluginWorkerEndpoint(wire.main),
      onIsolationError = vi.fn(),
      onDocumentRenderTimeout = vi.fn()
    const browser = createBrowserWorkerPluginHost({
      worker: endpoint,
      manifest: { id: 'test', name: 'Test', version: '1.0.0' },
      moduleSpecifier: 'unused',
      onIsolationError,
      onDocumentRenderTimeout,
    })
    await expect(browser.ready).rejects.toThrow('execution host failed')
    expect(onIsolationError).toHaveBeenCalledOnce()
    expect(onDocumentRenderTimeout).not.toHaveBeenCalled()
    await expect(
      browser.host.activate({
        pluginId: 'test',
        manifest: { id: 'test', name: 'Test', version: '1.0.0' },
        permissions: [],
        hostCapabilities: [],
      }),
    ).rejects.toThrow('disposed')
    browser.dispose()
    realm.dispose()
    await vi.runAllTimersAsync()
  })
  it('does not re-timeout a supervised result whose main delivery was delayed', async () => {
    vi.useFakeTimers()
    const wire = channel(),
      endpoint = createSupervisedPluginWorkerEndpoint(wire.main)
    const timeout = vi.fn(),
      settled = vi.fn()
    const client = createDocumentRenderRpcClient(endpoint, timeout)
    const pending = client.render(payload).then((value) => {
      settled()
      return value
    })
    // The trusted realm has already settled; the page cannot yet receive it.
    await vi.advanceTimersByTimeAsync(2400)
    expect(timeout).not.toHaveBeenCalled()
    expect(settled).not.toHaveBeenCalled()
    wire.remote.postMessage({
      protocol,
      type: 'child',
      message: {
        protocol: renderProtocol,
        type: 'result',
        id: 'render_1',
        ok: true,
        value: output,
      },
    })
    await expect(pending).resolves.toEqual(output)
    client.dispose()
    endpoint.terminate?.()
    await vi.runAllTimersAsync()
  })
  it('does not let a structural property disable the original watchdog', async () => {
    vi.useFakeTimers()
    const wire = channel(),
      timeout = vi.fn()
    const endpoint = { ...wire.main, externallySupervised: true }
    const client = createDocumentRenderRpcClient(endpoint, timeout)
    const pending = client.render(payload).catch((e) => e.code)
    await vi.advanceTimersByTimeAsync(2000)
    expect(await pending).toBe('timeout')
    expect(timeout).toHaveBeenCalledOnce()
  })
  it('does not promote child control lookalikes into authority', async () => {
    vi.useFakeTimers()
    const wire = channel(),
      endpoint = createSupervisedPluginWorkerEndpoint(wire.main),
      timeout = vi.fn()
    const client = createDocumentRenderRpcClient(endpoint, timeout)
    const pending = client.render(payload).catch((e) => e.code)
    wire.remote.postMessage({
      protocol,
      type: 'child',
      message: { protocol, type: 'control', event: 'timeout', id: 'render_1' },
    })
    expect(timeout).not.toHaveBeenCalled()
    wire.remote.postMessage({ protocol, type: 'control', event: 'timeout', id: 'render_1' })
    expect(await pending).toBe('timeout')
    expect(timeout).toHaveBeenCalledOnce()
    await vi.runAllTimersAsync()
  })
  it('keeps the supervisor deadline after cancellation and kills before notifying', async () => {
    vi.useFakeTimers()
    const wire = channel(),
      child = channel(),
      order: string[] = []
    child.main.terminate.mockImplementation(() => {
      order.push('kill')
    })
    const realm = initializePluginWorkerSupervisor(wire.remote, () => child.main)
    const endpoint = createSupervisedPluginWorkerEndpoint(wire.main)
    const client = createDocumentRenderRpcClient(endpoint, () => {
      order.push('notify')
    })
    const controller = new AbortController()
    const pending = client.render(payload, { signal: controller.signal }).catch((e) => e.code)
    controller.abort()
    expect(await pending).toBe('aborted')
    await vi.advanceTimersByTimeAsync(1999)
    expect(order).toEqual([])
    await vi.advanceTimersByTimeAsync(1)
    expect(order).toEqual(['kill', 'notify'])
    realm.dispose()
    client.dispose()
    endpoint.terminate?.()
  })
  it('settles one render, keeps the activation alive, then supervises the next', async () => {
    vi.useFakeTimers()
    const wire = channel(),
      child = channel(),
      realm = initializePluginWorkerSupervisor(wire.remote, () => child.main)
    const endpoint = createSupervisedPluginWorkerEndpoint(wire.main),
      client = createDocumentRenderRpcClient(endpoint, vi.fn())
    const first = client.render(payload),
      second = client.render(payload)
    child.remote.postMessage({
      protocol: renderProtocol,
      type: 'result',
      id: 'render_1',
      ok: true,
      value: output,
    })
    await expect(first).resolves.toEqual(output)
    expect(child.main.terminate).not.toHaveBeenCalled()
    child.remote.postMessage({
      protocol: renderProtocol,
      type: 'result',
      id: 'render_2',
      ok: true,
      value: output,
    })
    await expect(second).resolves.toEqual(output)
    client.dispose()
    endpoint.terminate?.()
    expect(child.main.terminate).toHaveBeenCalledOnce()
    expect(wire.main.terminate).toHaveBeenCalledOnce()
    realm.dispose()
  })
  it('revokes queued and active work, ignores late responses and cannot revive a retired endpoint', async () => {
    vi.useFakeTimers()
    const wire = channel(),
      endpoint = createSupervisedPluginWorkerEndpoint(wire.main),
      client = createDocumentRenderRpcClient(endpoint, vi.fn())
    const first = client.render(payload).catch((e) => e.code),
      second = client.render(payload).catch((e) => e.code)
    endpoint.terminate?.()
    expect(await first).toBe('revoked')
    expect(await second).toBe('revoked')
    wire.remote.postMessage({
      protocol,
      type: 'child',
      message: {
        protocol: renderProtocol,
        type: 'result',
        id: 'render_1',
        ok: true,
        value: output,
      },
    })
    expect(() => endpoint.postMessage({})).toThrow('disposed')
    await expect(client.render(payload)).rejects.toMatchObject({ code: 'revoked' })
    await vi.runAllTimersAsync()
  })
  it('never disarms for a malformed error that the main RPC would reject', async () => {
    vi.useFakeTimers()
    const wire = channel(),
      child = channel(),
      realm = initializePluginWorkerSupervisor(wire.remote, () => child.main)
    const endpoint = createSupervisedPluginWorkerEndpoint(wire.main),
      timeout = vi.fn()
    const client = createDocumentRenderRpcClient(endpoint, timeout)
    const pending = client.render(payload).catch((e) => e.code)
    child.remote.postMessage({
      protocol: renderProtocol,
      type: 'result',
      id: 'render_1',
      ok: false,
      error: ['timeout'],
    })
    await vi.advanceTimersByTimeAsync(2000)
    expect(child.main.terminate).toHaveBeenCalledOnce()
    expect(await pending).toBe('timeout')
    expect(timeout).toHaveBeenCalledOnce()
    realm.dispose()
    client.dispose()
  })
  it('constructs a revoked isolation host safely from an already closed endpoint', async () => {
    vi.useFakeTimers()
    const wire = channel(),
      endpoint = createSupervisedPluginWorkerEndpoint(wire.main)
    endpoint.terminate?.()
    const host = createRpcPluginIsolationHost(endpoint)
    await expect(
      host.activate({
        pluginId: 'test',
        manifest: { id: 'test', name: 'Test', version: '1.0.0' },
        permissions: [],
        hostCapabilities: [],
      }),
    ).rejects.toThrow('disposed')
    host.dispose()
    await vi.runAllTimersAsync()
  })
  it('uses monotonic elapsed time despite wall-clock changes', async () => {
    vi.useFakeTimers()
    const wire = channel(),
      child = channel(),
      realm = initializePluginWorkerSupervisor(wire.remote, () => child.main)
    const endpoint = createSupervisedPluginWorkerEndpoint(wire.main),
      client = createDocumentRenderRpcClient(endpoint, vi.fn())
    const first = client.render(payload)
    vi.setSystemTime(new Date('2050-01-01'))
    child.remote.postMessage({
      protocol: renderProtocol,
      type: 'result',
      id: 'render_1',
      ok: true,
      value: output,
    })
    await expect(first).resolves.toEqual(output)
    const pending = client.render(payload).catch((e) => e.code)
    vi.setSystemTime(new Date('2000-01-01'))
    await vi.advanceTimersByTimeAsync(2000)
    expect(await pending).toBe('timeout')
    expect(child.main.terminate).toHaveBeenCalledOnce()
    realm.dispose()
    client.dispose()
  })
  it('rejects a late result even if its task runs before the expired timer', async () => {
    vi.useFakeTimers()
    const clock = vi.spyOn(performance, 'now').mockReturnValue(0)
    const wire = channel(),
      child = channel(),
      realm = initializePluginWorkerSupervisor(wire.remote, () => child.main)
    const endpoint = createSupervisedPluginWorkerEndpoint(wire.main),
      client = createDocumentRenderRpcClient(endpoint, vi.fn())
    const pending = client.render(payload).catch((e) => e.code)
    clock.mockReturnValue(2001)
    child.remote.postMessage({
      protocol: renderProtocol,
      type: 'result',
      id: 'render_1',
      ok: true,
      value: output,
    })
    expect(await pending).toBe('timeout')
    expect(child.main.terminate).toHaveBeenCalledOnce()
    realm.dispose()
    client.dispose()
    clock.mockRestore()
  })
})

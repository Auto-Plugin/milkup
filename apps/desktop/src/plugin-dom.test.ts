import { createRpcPluginIsolationHost, type PluginManifest } from '@milkup/plugin'
import { describe, expect, it, vi } from 'vitest'

import {
  DESKTOP_PLUGIN_DOM_EVENT,
  loadDesktopPluginDomModule,
  prepareDesktopPluginDomModule,
  startDesktopPluginDomEndpoint,
  type DesktopPluginDomInvoke,
  type DesktopPluginDomListen,
  type DesktopPluginDomMessageEvent,
} from './plugin-dom'

const manifest: PluginManifest = {
  id: 'layout-tools',
  name: 'Layout tools',
  version: '1.0.0',
  host: 'dom',
  main: 'dist/index.js',
  permissions: ['document:read'],
  contributes: {
    documentRenderers: [{ id: 'layout', contexts: ['fence'], fenceLanguages: ['example-layout'] }],
  },
}

describe('desktop native DOM module preparation', () => {
  it('requires the native runtime before any source preparation', async () => {
    const invoke = vi.fn()
    await expect(prepareDesktopPluginDomModule(manifest, false, invoke)).rejects.toThrow(
      'native desktop runtime',
    )
    expect(invoke).not.toHaveBeenCalled()
  })

  it('passes only plugin identity and expected manifest, and releases the exact lease once', async () => {
    const invokeMock = vi.fn(async (command: string) =>
      command === 'prepare_plugin_dom_module' ? { leaseId: 'lease_1' } : true,
    )
    const prepared = await prepareDesktopPluginDomModule(manifest, true, asInvoke(invokeMock))
    expect(prepared).toMatchObject({ kind: 'dom', leaseId: 'lease_1' })
    expect(prepared).not.toHaveProperty('specifier')
    expect(invokeMock).toHaveBeenCalledWith('prepare_plugin_dom_module', {
      pluginId: manifest.id,
      expectedManifest: manifest,
    })
    prepared.dispose?.()
    prepared.dispose?.()
    expect(invokeMock).toHaveBeenCalledTimes(2)
    expect(invokeMock).toHaveBeenLastCalledWith('release_plugin_dom_module', {
      pluginId: manifest.id,
      leaseId: 'lease_1',
    })
  })

  it('rejects unsupported native hosts and malformed native leases without fallback', async () => {
    await expect(
      prepareDesktopPluginDomModule(manifest, true, async () => {
        throw new Error('DOM host unsupported on this platform')
      }),
    ).rejects.toThrow('unsupported on this platform')
    await expect(
      prepareDesktopPluginDomModule(
        manifest,
        true,
        asInvoke(async () => ({ leaseId: '' })),
      ),
    ).rejects.toThrow('lease identity')
  })
})

describe('desktop native DOM transport (mocked contract, not isolation proof)', () => {
  it('binds before delivery and closes/stops the exact instance idempotently', async () => {
    const fixture = transportFixture()
    const endpoint = await startDesktopPluginDomEndpoint(manifest.id, 'lease_1', fixture.transport)
    expect(fixture.listen).toHaveBeenCalledWith(DESKTOP_PLUGIN_DOM_EVENT, expect.any(Function))
    expect(fixture.invokeMock).toHaveBeenCalledWith('start_plugin_dom_process', {
      pluginId: manifest.id,
      leaseId: 'lease_1',
    })
    const listener = vi.fn()
    endpoint.addEventListener?.('message', listener)
    endpoint.postMessage({ request: 1 })
    fixture.emit({ kind: 'message', instanceId: 'old', message: 'old' })
    fixture.emit({ kind: 'message', pluginId: 'other', message: 'other' })
    fixture.emit({ kind: 'message', message: 'current' })
    expect(listener).toHaveBeenCalledExactlyOnceWith({ data: 'current' })
    expect(fixture.invokeMock).toHaveBeenCalledWith('send_plugin_dom_message', {
      pluginId: manifest.id,
      instanceId: 'native_1',
      message: { request: 1 },
    })
    endpoint.close?.()
    endpoint.close?.()
    expect(fixture.unlisten).toHaveBeenCalledOnce()
    expect(fixture.stopCalls()).toEqual([
      ['stop_plugin_dom_process', { pluginId: manifest.id, instanceId: 'native_1' }],
    ])
  })

  it('keeps the matching early failure when a stale error arrives afterwards', async () => {
    const fixture = transportFixture({
      beforeStartReply: (emit) => {
        emit({ kind: 'error', error: 'initialization failed' })
        emit({ kind: 'error', instanceId: 'old', error: 'stale failure' })
      },
    })
    const failed = vi.fn()
    const endpoint = await startDesktopPluginDomEndpoint(manifest.id, 'lease_1', fixture.transport)
    const host = createRpcPluginIsolationHost(endpoint, { onIsolationError: failed })
    await Promise.resolve()
    expect(failed).toHaveBeenCalledOnce()
    await expect(host.renderDocument!(renderRequest())).rejects.toMatchObject({ code: 'revoked' })
    expect(fixture.stopCalls()).toHaveLength(1)
    host.dispose()
    endpoint.close?.()
  })

  it('ignores an old startup error, and rejects an excessive pre-bind control stream safely', async () => {
    const stale = transportFixture({
      beforeStartReply: (emit) => emit({ kind: 'error', instanceId: 'old' }),
    })
    const endpoint = await startDesktopPluginDomEndpoint(manifest.id, 'lease_1', stale.transport)
    endpoint.postMessage({ request: 1 })
    expect(stale.stopCalls()).toHaveLength(0)
    endpoint.close?.()

    const flooded = transportFixture({
      beforeStartReply: (emit) => {
        for (let index = 0; index < 65; index++) emit({ kind: 'error', instanceId: `old_${index}` })
      },
    })
    const failed = vi.fn()
    const floodedEndpoint = await startDesktopPluginDomEndpoint(
      manifest.id,
      'lease_2',
      flooded.transport,
    )
    const host = createRpcPluginIsolationHost(floodedEndpoint, { onIsolationError: failed })
    await Promise.resolve()
    expect(failed).toHaveBeenCalledOnce()
    expect(flooded.stopCalls()).toHaveLength(1)
    host.dispose()
  })

  it('releases an exact lease and event listener when startup rejects or loses its identity', async () => {
    for (const startReply of [new Error('spawn rejected'), {}, { instanceId: '' }]) {
      const fixture = transportFixture({ startReply })
      const prepared = await prepareDesktopPluginDomModule(manifest, true, fixture.transport.invoke)
      await expect(
        loadDesktopPluginDomModule(manifest, prepared, callbacks(), fixture.transport),
      ).rejects.toThrow(startReply instanceof Error ? 'spawn rejected' : 'instance identity')
      expect(fixture.unlisten).toHaveBeenCalledOnce()
      expect(fixture.invokeMock).toHaveBeenCalledWith('release_plugin_dom_module', {
        pluginId: manifest.id,
        leaseId: 'lease_1',
      })
      // Native lease release owns rollback when the reply cannot identify the child.
      expect(fixture.stopCalls()).toHaveLength(0)
    }
  })

  it('cleans a prepared lease if attaching the native event listener fails', async () => {
    const fixture = transportFixture()
    const prepared = await prepareDesktopPluginDomModule(manifest, true, fixture.transport.invoke)
    await expect(
      loadDesktopPluginDomModule(manifest, prepared, callbacks(), {
        ...fixture.transport,
        listen: async () => {
          throw new Error('listen unavailable')
        },
      }),
    ).rejects.toThrow('listen unavailable')
    expect(fixture.invokeMock).not.toHaveBeenCalledWith(
      'start_plugin_dom_process',
      expect.anything(),
    )
    expect(fixture.invokeMock).toHaveBeenLastCalledWith('release_plugin_dom_module', {
      pluginId: manifest.id,
      leaseId: 'lease_1',
    })
  })

  it('does not let old instance controls or delayed send failure stop a replacement', async () => {
    let rejectSend: ((error: Error) => void) | undefined
    const old = transportFixture({
      send: () =>
        new Promise((_resolve, reject) => {
          rejectSend = reject
        }),
    })
    const first = await startDesktopPluginDomEndpoint(manifest.id, 'lease_1', old.transport)
    first.postMessage({ request: 1 })
    first.close?.()
    const replacement = transportFixture({ instanceId: 'native_2' })
    const second = await startDesktopPluginDomEndpoint(
      manifest.id,
      'lease_2',
      replacement.transport,
    )
    const failed = vi.fn(),
      timedOut = vi.fn()
    const host = createRpcPluginIsolationHost(second, {
      onIsolationError: failed,
      onDocumentRenderTimeout: timedOut,
    })
    const pending = host.renderDocument!(renderRequest())
    replacement.emit({ kind: 'error', instanceId: 'native_1' })
    replacement.emit({
      kind: 'document-render-timeout',
      instanceId: 'native_1',
      requestId: 'render_1',
    })
    replacement.emit({ kind: 'message', instanceId: 'native_1', message: renderResult() })
    rejectSend?.(new Error('old pipe closed'))
    await Promise.resolve()
    expect(failed).not.toHaveBeenCalled()
    expect(timedOut).not.toHaveBeenCalled()
    expect(replacement.stopCalls()).toHaveLength(0)
    replacement.emit({ kind: 'message', message: renderResult() })
    await expect(pending).resolves.toEqual({ fragments: [], complete: true })
    expect(old.stopCalls()).toHaveLength(1)
    host.dispose()
    second.close?.()
  })

  it('accepts only outer native timeout authority, despite delayed frontend delivery', async () => {
    vi.useFakeTimers()
    try {
      const fixture = transportFixture()
      const endpoint = await startDesktopPluginDomEndpoint(
        manifest.id,
        'lease_1',
        fixture.transport,
      )
      const timedOut = vi.fn()
      const host = createRpcPluginIsolationHost(endpoint, { onDocumentRenderTimeout: timedOut })
      const pending = host.renderDocument!(renderRequest())
      const rejected = expect(pending).rejects.toMatchObject({ code: 'timeout' })
      fixture.emit({
        kind: 'message',
        message: { kind: 'document-render-timeout', requestId: 'render_1' },
      })
      await vi.advanceTimersByTimeAsync(2400)
      expect(timedOut).not.toHaveBeenCalled()
      expect(fixture.stopCalls()).toHaveLength(0)
      fixture.emit({ kind: 'document-render-timeout', requestId: 'render_1' })
      await rejected
      expect(timedOut).toHaveBeenCalledOnce()
      expect(fixture.stopCalls()).toHaveLength(1)
      host.dispose()
    } finally {
      vi.useRealTimers()
    }
  })

  it('delivers a completed native result after a frontend stall without a frontend render timer', async () => {
    vi.useFakeTimers()
    try {
      const fixture = transportFixture()
      const endpoint = await startDesktopPluginDomEndpoint(
        manifest.id,
        'lease_1',
        fixture.transport,
      )
      const timedOut = vi.fn()
      const host = createRpcPluginIsolationHost(endpoint, { onDocumentRenderTimeout: timedOut })
      const pending = host.renderDocument!(renderRequest())
      await vi.advanceTimersByTimeAsync(2400)
      fixture.emit({ kind: 'message', message: renderResult() })
      await expect(pending).resolves.toEqual({ fragments: [], complete: true })
      expect(timedOut).not.toHaveBeenCalled()
      expect(fixture.stopCalls()).toHaveLength(0)
      host.dispose()
      endpoint.close?.()
    } finally {
      vi.useRealTimers()
    }
  })

  it('revokes pending work and cleans the module on native send rejection or false acknowledgement', async () => {
    for (const send of [
      async () => false,
      async () => {
        throw new Error('pipe closed')
      },
    ]) {
      const fixture = transportFixture({ send })
      const prepared = await prepareDesktopPluginDomModule(manifest, true, fixture.transport.invoke)
      const observers = callbacks()
      const loaded = await loadDesktopPluginDomModule(
        manifest,
        prepared,
        observers,
        fixture.transport,
      )
      await expect(loaded.module.activate?.(activationContext())).rejects.toThrow('disposed')
      expect(observers.onIsolationError).toHaveBeenCalledOnce()
      expect(fixture.stopCalls()).toHaveLength(1)
      loaded.dispose()
      expect(fixture.stopCalls()).toHaveLength(1)
    }
  })

  it('sends no host capability names and stops even if the failure observer throws', async () => {
    const fixture = transportFixture()
    const prepared = await prepareDesktopPluginDomModule(manifest, true, fixture.transport.invoke)
    const observers = callbacks()
    observers.onIsolationError.mockImplementation(() => {
      throw new Error('observer failed')
    })
    const loaded = await loadDesktopPluginDomModule(
      manifest,
      prepared,
      observers,
      fixture.transport,
    )
    const pending = loaded.module.activate?.({
      ...activationContext(),
      host: { fetch: async () => undefined, readText: () => 'private' },
    })
    const rejected = expect(pending).rejects.toThrow('disposed')
    expect(fixture.invokeMock).toHaveBeenLastCalledWith('send_plugin_dom_message', {
      pluginId: manifest.id,
      instanceId: 'native_1',
      message: expect.objectContaining({
        method: 'activate',
        payload: expect.objectContaining({ hostCapabilities: [], permissions: ['document:read'] }),
      }),
    })
    expect(() => fixture.emit({ kind: 'error' })).not.toThrow()
    await rejected
    expect(observers.onIsolationError).toHaveBeenCalledOnce()
    expect(fixture.stopCalls()).toHaveLength(1)
    expect(fixture.invokeMock).toHaveBeenCalledWith('release_plugin_dom_module', {
      pluginId: manifest.id,
      leaseId: 'lease_1',
    })
    loaded.dispose()
  })

  it('retains the ten-second ordinary lifecycle RPC timeout and cleans activation failure', async () => {
    vi.useFakeTimers()
    try {
      const fixture = transportFixture()
      const prepared = await prepareDesktopPluginDomModule(manifest, true, fixture.transport.invoke)
      const loaded = await loadDesktopPluginDomModule(
        manifest,
        prepared,
        callbacks(),
        fixture.transport,
      )
      const pending = loaded.module.activate?.(activationContext())
      const rejected = expect(pending).rejects.toThrow('timed out: activate')
      await vi.advanceTimersByTimeAsync(9999)
      expect(fixture.stopCalls()).toHaveLength(0)
      await vi.advanceTimersByTimeAsync(1)
      await rejected
      expect(fixture.stopCalls()).toHaveLength(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('completes activation and lifecycle disposal, then releases native ownership once', async () => {
    const fixture = transportFixture()
    const prepared = await prepareDesktopPluginDomModule(manifest, true, fixture.transport.invoke)
    const loaded = await loadDesktopPluginDomModule(
      manifest,
      prepared,
      callbacks(),
      fixture.transport,
    )
    const respond = (value: unknown) => {
      const args = fixture.invokeMock.mock.calls.at(-1)?.[1] as {
        message: { id: string }
      }
      fixture.emit({
        kind: 'message',
        message: {
          protocol: 'milkup.plugin.isolation.rpc.v1',
          type: 'response',
          id: args.message.id,
          ok: true,
          value,
        },
      })
    }
    const pending = loaded.module.activate?.(activationContext())
    respond({ documentRenderers: [] })
    const activation = await pending
    const disposal = activation?.dispose?.()
    await disposal
    const deactivation = loaded.module.deactivate?.()
    await deactivation
    loaded.dispose()
    expect(fixture.stopCalls()).toHaveLength(1)
    expect(
      fixture.invokeMock.mock.calls.filter(([command]) => command === 'release_plugin_dom_module'),
    ).toEqual([['release_plugin_dom_module', { pluginId: manifest.id, leaseId: 'lease_1' }]])
    expect(fixture.unlisten).toHaveBeenCalledOnce()
  })
})

function asInvoke(
  fn: (command: string, args?: unknown) => Promise<unknown>,
): DesktopPluginDomInvoke {
  return async <T>(command: string, args?: unknown) => (await fn(command, args)) as T
}

type EventInput = Omit<DesktopPluginDomMessageEvent, 'pluginId' | 'instanceId'> & {
  readonly pluginId?: string
  readonly instanceId?: string
}

function transportFixture(
  options: {
    readonly instanceId?: string
    readonly startReply?: unknown
    readonly beforeStartReply?: (emit: (event: EventInput) => void) => void
    readonly send?: () => Promise<unknown>
  } = {},
) {
  let handler: Parameters<DesktopPluginDomListen>[1] | undefined
  const instanceId = options.instanceId ?? 'native_1'
  const emit = (event: EventInput) =>
    handler?.({ payload: { pluginId: manifest.id, instanceId, ...event } })
  const unlisten = vi.fn()
  const listen = vi.fn<DesktopPluginDomListen>(async (_event, listener) => {
    handler = listener
    return unlisten
  })
  const invokeMock = vi.fn(async (command: string, _args?: unknown): Promise<unknown> => {
    if (command === 'prepare_plugin_dom_module') return { leaseId: 'lease_1' }
    if (command === 'start_plugin_dom_process') {
      options.beforeStartReply?.(emit)
      if (options.startReply instanceof Error) throw options.startReply
      return options.startReply ?? { instanceId }
    }
    if (command === 'send_plugin_dom_message' && options.send) return options.send()
    return true
  })
  return {
    transport: { invoke: asInvoke(invokeMock), listen },
    invokeMock,
    listen,
    unlisten,
    emit,
    stopCalls: () =>
      invokeMock.mock.calls.filter(([command]) => command === 'stop_plugin_dom_process'),
  }
}

function callbacks() {
  return { onDocumentRenderTimeout: vi.fn(), onIsolationError: vi.fn() }
}

function activationContext() {
  return { pluginId: manifest.id, manifest, permissions: manifest.permissions ?? [], host: {} }
}

function renderResult() {
  return {
    protocol: 'milkup.plugin.document-render.v1',
    type: 'result',
    id: 'render_1',
    ok: true,
    value: { fragments: [], complete: true },
  }
}

function renderRequest() {
  return {
    pluginId: manifest.id,
    rendererId: 'layout',
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
}

it('waits for exact native stop before completing loaded disposal and releasing its lease', async () => {
  const fixture = transportFixture()
  let resolveStop!: (value: boolean) => void
  const stopped = new Promise<boolean>((resolve) => {
    resolveStop = resolve
  })
  const base = fixture.invokeMock.getMockImplementation()!
  fixture.invokeMock.mockImplementation((command, args) =>
    command === 'stop_plugin_dom_process' ? stopped : base(command, args),
  )
  const prepared = await prepareDesktopPluginDomModule(manifest, true, fixture.transport.invoke)
  const loaded = await loadDesktopPluginDomModule(
    manifest,
    prepared,
    callbacks(),
    fixture.transport,
  )
  let done = false
  const disposal = Promise.resolve(loaded.dispose()).then(() => {
    done = true
  })
  await Promise.resolve()
  await Promise.resolve()
  expect(done).toBe(false)
  expect(
    fixture.invokeMock.mock.calls.filter(([command]) => command === 'release_plugin_dom_module'),
  ).toHaveLength(0)
  resolveStop(true)
  await disposal
  expect(done).toBe(true)
  expect(fixture.stopCalls()).toEqual([
    ['stop_plugin_dom_process', { pluginId: manifest.id, instanceId: 'native_1' }],
  ])
  expect(
    fixture.invokeMock.mock.calls.filter(([command]) => command === 'release_plugin_dom_module'),
  ).toHaveLength(1)
})

it('surfaces native stop failure and still attempts exact lease cleanup', async () => {
  const fixture = transportFixture()
  const base = fixture.invokeMock.getMockImplementation()!
  fixture.invokeMock.mockImplementation(async (command, args) => {
    if (command === 'stop_plugin_dom_process') throw new Error('native join failed')
    return base(command, args)
  })
  const prepared = await prepareDesktopPluginDomModule(manifest, true, fixture.transport.invoke)
  const loaded = await loadDesktopPluginDomModule(
    manifest,
    prepared,
    callbacks(),
    fixture.transport,
  )
  await expect(Promise.resolve().then(() => loaded.dispose())).rejects.toThrow()
  expect(fixture.invokeMock).toHaveBeenCalledWith('release_plugin_dom_module', {
    pluginId: manifest.id,
    leaseId: 'lease_1',
  })
})

it('retains an unconfirmed native stop as the same failed cleanup promise', async () => {
  const fixture = transportFixture()
  const base = fixture.invokeMock.getMockImplementation()!
  fixture.invokeMock.mockImplementation(async (command, args) =>
    command === 'stop_plugin_dom_process' ? false : base(command, args),
  )
  const endpoint = await startDesktopPluginDomEndpoint(manifest.id, 'lease_1', fixture.transport)
  const first = endpoint.close?.()
  await expect(first).rejects.toThrow('cleanup failed')
  expect(endpoint.close?.()).toBe(first)
  expect(fixture.stopCalls()).toHaveLength(1)
  expect(() => endpoint.postMessage({ late: true })).toThrow('closed')
})

it('retains lease release rejection and does not hide it behind a disposed flag', async () => {
  const invoke = asInvoke(async (command) => {
    if (command === 'prepare_plugin_dom_module') return { leaseId: 'lease_1' }
    throw new Error('lease release failed')
  })
  const prepared = await prepareDesktopPluginDomModule(manifest, true, invoke)
  const first = prepared.dispose?.()
  await expect(first).rejects.toThrow('lease release failed')
  expect(prepared.dispose?.()).toBe(first)
})

it('retries a failed exact-owner lease cleanup without recreating an instance or reopening RPC', async () => {
  const fixture = transportFixture()
  const base = fixture.invokeMock.getMockImplementation()!
  let failRelease = true
  fixture.invokeMock.mockImplementation(async (command, args) => {
    if (command === 'stop_plugin_dom_process') throw new Error('join not yet confirmed')
    if (command === 'release_plugin_dom_module' && failRelease)
      throw new Error('release join failed')
    return base(command, args)
  })
  const prepared = await prepareDesktopPluginDomModule(manifest, true, fixture.transport.invoke)
  const loaded = await loadDesktopPluginDomModule(
    manifest,
    prepared,
    callbacks(),
    fixture.transport,
  )
  const first = loaded.dispose()
  await expect(first).rejects.toThrow('cleanup failed')
  failRelease = false
  await loaded.retryDispose?.()
  await expect(first).rejects.toThrow('cleanup failed')
  expect(
    fixture.invokeMock.mock.calls.filter(([command]) => command === 'start_plugin_dom_process'),
  ).toHaveLength(1)
  expect(
    fixture.invokeMock.mock.calls.filter(([command]) => command === 'release_plugin_dom_module'),
  ).toHaveLength(2)
  await expect(loaded.module.activate?.(activationContext())).rejects.toThrow('disposed')
})

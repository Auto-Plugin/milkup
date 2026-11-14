import { createRpcPluginIsolationHost } from '@milkup/plugin'
import { describe, expect, it, vi } from 'vitest'

import {
  createDesktopPluginSidecarProcess,
  DESKTOP_PLUGIN_SIDECAR_EVENT,
  type DesktopPluginSidecarInvoke,
  type DesktopPluginSidecarListen,
  type DesktopPluginSidecarMessageEvent,
} from './plugin-sidecar'

describe('desktop plugin sidecar adapter', () => {
  it('does not deliver stdout from an older native process instance', async () => {
    let handler: Parameters<DesktopPluginSidecarListen>[1] | undefined
    const process = createDesktopPluginSidecarProcess({
      executable: '/test/sidecar',
      invoke: async <T>() => ({ instanceId: 'current-instance' }) as T,
      listen: async (_event, listener) => {
        handler = listener
        return () => undefined
      },
    })
    const endpoint = await process.start({
      pluginId: 'sidecar-tools',
      manifest: { id: 'sidecar-tools', name: 'Tools', version: '1.0.0', host: 'sidecar' },
    })
    const listener = vi.fn()
    endpoint.addEventListener?.('message', listener)
    handler?.({
      payload: {
        pluginId: 'sidecar-tools',
        instanceId: 'old-instance',
        kind: 'message',
        message: { type: 'response', id: '1' },
      } as DesktopPluginSidecarMessageEvent,
    })
    expect(listener).not.toHaveBeenCalled()
    endpoint.close?.()
  })

  it('starts a native sidecar process and exposes an isolation RPC endpoint', async () => {
    const calls: string[] = []
    let eventHandler:
      ((event: { readonly payload: DesktopPluginSidecarMessageEvent }) => void) | undefined
    const unlisten = vi.fn(() => calls.push('unlisten'))
    const listen: DesktopPluginSidecarListen = vi.fn(async (_event, handler) => {
      calls.push('listen')
      eventHandler = handler
      return unlisten
    })
    const invokeMock = vi.fn(async (command: string, _args?: unknown) => {
      calls.push(command)
      return command === 'start_plugin_sidecar_process' ? { instanceId: 'native_1' } : true
    })
    const invoke: DesktopPluginSidecarInvoke = async <T>(command: string, args?: unknown) =>
      (await invokeMock(command, args)) as T
    const process = createDesktopPluginSidecarProcess({
      executable: 'D:/plugins/sidecar.exe',
      args: ['--stdio'],
      invoke,
      listen,
    })

    const endpoint = await process.start({
      pluginId: 'sidecar-tools',
      manifest: {
        id: 'sidecar-tools',
        name: 'Sidecar Tools',
        version: '1.0.0',
        host: 'sidecar',
      },
      moduleSpecifier: './sidecar.js',
    })
    const listener = vi.fn()

    endpoint.addEventListener?.('message', listener)
    endpoint.postMessage({ type: 'request', id: '1' })
    eventHandler?.({
      payload: {
        pluginId: 'other-plugin',
        instanceId: 'native_1',
        kind: 'message',
        message: { type: 'ignored' },
      },
    })
    eventHandler?.({
      payload: {
        pluginId: 'sidecar-tools',
        instanceId: 'native_1',
        kind: 'message',
        message: { type: 'response', id: '1' },
      },
    })
    await process.stop?.({ pluginId: 'sidecar-tools' })

    expect(calls).toEqual([
      'listen',
      'start_plugin_sidecar_process',
      'send_plugin_sidecar_message',
      'unlisten',
      'stop_plugin_sidecar_process',
    ])
    expect(listen).toHaveBeenCalledWith(DESKTOP_PLUGIN_SIDECAR_EVENT, expect.any(Function))
    expect(invokeMock).toHaveBeenCalledWith('start_plugin_sidecar_process', {
      pluginId: 'sidecar-tools',
      executable: 'D:/plugins/sidecar.exe',
      args: ['--stdio'],
      moduleSpecifier: './sidecar.js',
    })
    expect(invokeMock).toHaveBeenCalledWith('send_plugin_sidecar_message', {
      pluginId: 'sidecar-tools',
      instanceId: 'native_1',
      message: { type: 'request', id: '1' },
    })
    expect(invokeMock).toHaveBeenCalledWith('stop_plugin_sidecar_process', {
      pluginId: 'sidecar-tools',
      instanceId: 'native_1',
    })
    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenCalledWith({
      data: { type: 'response', id: '1' },
    })
  })

  it('removes listeners when the endpoint is closed directly', async () => {
    const unlisten = vi.fn()
    const invoke: DesktopPluginSidecarInvoke = async <T>() => ({ instanceId: 'native_1' }) as T
    const process = createDesktopPluginSidecarProcess({
      executable: 'sidecar',
      invoke,
      listen: vi.fn(async () => unlisten),
    })
    const endpoint = await process.start({
      pluginId: 'sidecar-tools',
      manifest: {
        id: 'sidecar-tools',
        name: 'Sidecar Tools',
        version: '1.0.0',
        host: 'sidecar',
      },
    })

    endpoint.close?.()

    expect(unlisten).toHaveBeenCalledTimes(1)
  })

  it('binds stop to the old instance without closing its replacement', async () => {
    const handlers: Array<Parameters<DesktopPluginSidecarListen>[1]> = []
    let sequence = 0
    const invokeMock = vi.fn(async (command: string, _args?: unknown) =>
      command === 'start_plugin_sidecar_process' ? { instanceId: `native_${++sequence}` } : true,
    )
    const process = createDesktopPluginSidecarProcess({
      executable: '/test/sidecar',
      invoke: async <T>(command: string, args?: unknown) => (await invokeMock(command, args)) as T,
      listen: async (_event, handler) => {
        handlers.push(handler)
        return () => undefined
      },
    })
    const request = {
      pluginId: 'test',
      manifest: { id: 'test', name: 'Test', version: '1.0.0', host: 'sidecar' as const },
    }
    const first = await process.start(request)
    const second = await process.start(request)
    const listener = vi.fn()
    second.addEventListener?.('message', listener)
    await process.stop?.({ pluginId: 'test', instanceId: first.instanceId! })
    handlers[1]?.({
      payload: {
        pluginId: 'test',
        instanceId: second.instanceId!,
        kind: 'message',
        message: { ready: true },
      },
    })
    expect(listener).toHaveBeenCalledOnce()
    expect(invokeMock).toHaveBeenLastCalledWith('stop_plugin_sidecar_process', {
      pluginId: 'test',
      instanceId: first.instanceId,
    })
    second.close?.()
  })

  it('accepts only native outer timeout authority and ignores delayed UI delivery', async () => {
    vi.useFakeTimers()
    try {
      const fixture = await renderFixture()
      const pending = fixture.host.renderDocument!(renderRequest())
      const rejected = expect(pending).rejects.toMatchObject({ code: 'timeout' })
      // A payload coming from child stdout cannot become transport authority.
      fixture.emit({
        kind: 'message',
        message: { kind: 'document-render-timeout', requestId: 'render_1' },
      })
      fixture.emit({ kind: 'document-render-timeout', requestId: 'render_1', instanceId: 'old' })
      await vi.advanceTimersByTimeAsync(2400)
      expect(fixture.timedOut).not.toHaveBeenCalled()
      fixture.emit({ kind: 'document-render-timeout', requestId: 'render_1' })
      await rejected
      expect(fixture.timedOut).toHaveBeenCalledOnce()
      fixture.endpoint.close?.()
    } finally {
      vi.useRealTimers()
    }
  })

  it('delivers a successful native result after a UI stall without terminating the process', async () => {
    vi.useFakeTimers()
    try {
      const fixture = await renderFixture()
      const pending = fixture.host.renderDocument!(renderRequest())
      await vi.advanceTimersByTimeAsync(2400)
      fixture.emit({
        kind: 'message',
        message: {
          protocol: 'milkup.plugin.document-render.v1',
          type: 'result',
          id: 'render_1',
          ok: true,
          value: { fragments: [], complete: true },
        },
      })
      await expect(pending).resolves.toEqual({ fragments: [], complete: true })
      expect(fixture.timedOut).not.toHaveBeenCalled()
      expect(
        fixture.invokeMock.mock.calls.some(
          ([command]) => command === 'stop_plugin_sidecar_process',
        ),
      ).toBe(false)
      fixture.host.dispose()
      fixture.endpoint.close?.()
    } finally {
      vi.useRealTimers()
    }
  })

  it('revokes pending work if native transport send fails', async () => {
    const fixture = await renderFixture(true)
    await expect(fixture.host.renderDocument!(renderRequest())).rejects.toMatchObject({
      code: 'revoked',
    })
    expect(fixture.failed).toHaveBeenCalledOnce()
    fixture.endpoint.close?.()
  })

  it('releases its listener when native startup fails', async () => {
    const unlisten = vi.fn()
    const process = createDesktopPluginSidecarProcess({
      executable: '/test/sidecar',
      invoke: async () => {
        throw new Error('spawn failed')
      },
      listen: async () => unlisten,
    })
    await expect(
      process.start({ pluginId: 'test', manifest: { id: 'test', name: 'Test', version: '1.0.0' } }),
    ).rejects.toThrow('spawn failed')
    expect(unlisten).toHaveBeenCalledOnce()
  })

  it('retains native startup failure until the RPC owner subscribes', async () => {
    let handler: Parameters<DesktopPluginSidecarListen>[1] | undefined
    const process = createDesktopPluginSidecarProcess({
      executable: '/test/sidecar',
      listen: async (_event, listener) => {
        handler = listener
        return () => undefined
      },
      invoke: async <T>() => {
        handler?.({
          payload: {
            pluginId: 'test',
            instanceId: 'native_1',
            kind: 'error',
            error: 'stdout closed',
          },
        })
        return { instanceId: 'native_1' } as T
      },
    })
    const endpoint = await process.start({
      pluginId: 'test',
      manifest: { id: 'test', name: 'Test', version: '1.0.0' },
    })
    const failed = vi.fn()
    const host = createRpcPluginIsolationHost(endpoint, { onIsolationError: failed })
    await Promise.resolve()
    expect(failed).toHaveBeenCalledOnce()
    await expect(host.renderDocument!(renderRequest())).rejects.toMatchObject({ code: 'revoked' })
    endpoint.close?.()
  })
})

function renderRequest() {
  return {
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
}

async function renderFixture(failSend = false) {
  let handler: Parameters<DesktopPluginSidecarListen>[1] | undefined
  const invokeMock = vi.fn(async (command: string) => {
    if (command === 'send_plugin_sidecar_message' && failSend) throw new Error('pipe closed')
    return command === 'start_plugin_sidecar_process' ? { instanceId: 'native_1' } : true
  })
  const process = createDesktopPluginSidecarProcess({
    executable: '/test/sidecar',
    invoke: async <T>(command: string) => (await invokeMock(command)) as T,
    listen: async (_event, listener) => {
      handler = listener
      return () => undefined
    },
  })
  const endpoint = await process.start({
    pluginId: 'test',
    manifest: { id: 'test', name: 'Test', version: '1.0.0', host: 'sidecar' },
  })
  const timedOut = vi.fn(),
    failed = vi.fn()
  const host = createRpcPluginIsolationHost(endpoint, {
    onDocumentRenderTimeout: timedOut,
    onIsolationError: failed,
  })
  return {
    endpoint,
    host,
    timedOut,
    failed,
    invokeMock,
    emit: (
      value: Omit<DesktopPluginSidecarMessageEvent, 'pluginId' | 'instanceId'> & {
        instanceId?: string
      },
    ) => handler?.({ payload: { pluginId: 'test', instanceId: 'native_1', ...value } }),
  }
}

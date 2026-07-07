import { describe, expect, it, vi } from 'vitest'

import {
  createDesktopPluginSidecarProcess,
  DESKTOP_PLUGIN_SIDECAR_EVENT,
  type DesktopPluginSidecarInvoke,
  type DesktopPluginSidecarListen,
  type DesktopPluginSidecarMessageEvent,
} from './plugin-sidecar'

describe('desktop plugin sidecar adapter', () => {
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
      return true
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
        message: { type: 'ignored' },
      },
    })
    eventHandler?.({
      payload: {
        pluginId: 'sidecar-tools',
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
      message: { type: 'request', id: '1' },
    })
    expect(invokeMock).toHaveBeenCalledWith('stop_plugin_sidecar_process', {
      pluginId: 'sidecar-tools',
    })
    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenCalledWith({
      data: { type: 'response', id: '1' },
    })
  })

  it('removes listeners when the endpoint is closed directly', async () => {
    const unlisten = vi.fn()
    const invoke: DesktopPluginSidecarInvoke = async <T>() => true as T
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
})

import { describe, expect, it, vi } from 'vitest'
import { createBrowserWorkerPluginHost, initializePluginWorkerRealm } from './isolation-worker'
import { createSidecarPluginModule } from './isolation-sidecar'
import { createPluginIsolationRpcServer } from './isolation-rpc'
import { PluginRuntime } from './runtime'
import { createPluginSettingsBroker } from './settings-broker'
import { createRpcPluginSettingsBroker } from './settings-rpc'
import {
  createPluginKeymapBroker,
  type PluginKeymapHost,
  type PluginKeymapSnapshot,
} from './keymap-broker'
import { createRpcPluginKeymapBroker } from './keymap-rpc'
import { adapter, manifest, pair, flush } from './settings-test-helpers'
const keymapSnapshot: PluginKeymapSnapshot = { revision: 0, commands: [], fixedShortcuts: [] }
function keymapAdapter() {
  return {
    snapshot: vi.fn(async () => keymapSnapshot),
    update: vi.fn(async () => keymapSnapshot),
    reset: vi.fn(async () => keymapSnapshot),
  }
}
describe('preferences capability isolation', () => {
  it.each([true, false])(
    'Worker keymap permission declared=%s and captured-host lifecycle',
    async (allowed) => {
      const endpoints = pair(),
        adapter = keymapAdapter(),
        current = { ...manifest, permissions: allowed ? ['app:keymap' as const] : [] }
      const broker = createPluginKeymapBroker({ manifest: current, adapter })
      let captured: PluginKeymapHost | undefined
      const realm = initializePluginWorkerRealm(endpoints.worker, {
        importModule: async () => ({
          activate: ({ host }: { host: { keymap?: PluginKeymapHost } }) => {
            captured = host.keymap
          },
        }),
      })
      const workerHost = createBrowserWorkerPluginHost({
        worker: endpoints.main,
        manifest: current,
        moduleSpecifier: './shortcuts.js',
        keymapBroker: broker,
      })
      await workerHost.ready
      await workerHost.host.activate({
        pluginId: current.id,
        manifest: current,
        permissions: current.permissions,
        hostCapabilities: ['app:keymap'],
      })
      if (allowed) {
        expect(await captured!.snapshot()).toEqual(keymapSnapshot)
        await workerHost.host.deactivate({ pluginId: current.id })
        await expect(captured!.snapshot()).rejects.toMatchObject({ code: 'revoked' })
      } else {
        expect(captured).toBeUndefined()
        endpoints.worker.postMessage({
          protocol: 'milkup.plugin.keymap.rpc.v1',
          type: 'request',
          id: 'forged',
          method: 'snapshot',
          payload: {},
        })
        await flush()
        expect(adapter.snapshot).not.toHaveBeenCalled()
      }
      workerHost.dispose()
      realm.dispose()
      broker.dispose()
      expect(endpoints.main.listeners.size + endpoints.worker.listeners.size).toBe(0)
    },
  )
  it('sidecar stops roll back settings previews and revoke both protocols', async () => {
    const { main, worker } = pair(),
      host = adapter()
    const current = {
      ...manifest,
      host: 'sidecar' as const,
      permissions: ['settings:write', 'app:keymap'] as const,
    }
    const settings = createPluginSettingsBroker({ manifest: current, adapter: host })
    const keymap = createPluginKeymapBroker({ manifest: current, adapter: keymapAdapter() })
    const isolated = createPluginIsolationRpcServer(worker, {
      activate: () => ({}),
      deactivate: () => {},
      runCommand: () => ({}),
      render: () => '',
      dispose: () => {},
    })
    const runtime = new PluginRuntime({
      allowedHosts: ['sidecar'],
      allowedPermissions: ['settings:write', 'app:keymap'],
      settingsBroker: settings,
      keymapBroker: keymap,
    })
    runtime.loadPlugin({
      manifest: current,
      module: createSidecarPluginModule({
        manifest: current,
        process: { start: () => main },
        settingsBroker: settings,
        keymapBroker: keymap,
      }),
    })
    await runtime.enablePlugin(current.id)
    const settingsClient = createRpcPluginSettingsBroker(worker),
      keymapClient = createRpcPluginKeymapBroker(worker)
    const tx = await settingsClient.begin('application')
    await settingsClient.preview(tx.id, { size: 20 })
    expect(await keymapClient.snapshot()).toEqual(keymapSnapshot)
    await runtime.disablePlugin(current.id)
    await flush()
    expect(host.cancel).toHaveBeenCalledWith(tx.id, expect.anything())
    await expect(settingsClient.get('application')).rejects.toMatchObject({ code: 'revoked' })
    await expect(keymapClient.snapshot()).rejects.toMatchObject({ code: 'revoked' })
    settingsClient.dispose()
    keymapClient.dispose()
    settings.dispose()
    keymap.dispose()
    isolated.dispose()
  })
})

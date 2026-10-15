import { ActionRegistry } from '@milkup/core'
import type { PluginManifest, PluginSettingsHost, PluginKeymapHost } from '@milkup/plugin'
import { describe, expect, it, vi } from 'vitest'
import { DesktopPluginManager } from './desktop-plugin-manager'
import { createDesktopSettingsService } from './settings-service'
import { createKeymapService } from './keymap-service'

function memoryStorage(): Storage {
  const values = new Map<string, string>()
  return {
    get length() {
      return values.size
    },
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value)
    },
    removeItem: (key) => {
      values.delete(key)
    },
    clear: () => values.clear(),
    key: (index) => [...values.keys()][index] ?? null,
  }
}

describe('desktop optional settings capabilities', () => {
  it('requires approval, rolls preview back on disable and revokes captured settings/keymap handles', async () => {
    const storage = memoryStorage()
    let fontSize = 0
    const settings = createDesktopSettingsService({
      storage,
      applyView: (values) => {
        fontSize = Number(values['editor.fontSize'])
      },
    })
    await settings.ready
    const keymap = createKeymapService({
      storage,
      commands: () => [
        { id: 'file.save', title: '保存', category: 'file', available: true, bindable: true },
      ],
    })
    const manifest: PluginManifest = {
      id: 'test.preferences',
      name: 'Preferences',
      version: '1.0.0',
      host: 'worker',
      main: './plugin.js',
      engines: { pluginSdk: '^0.3.1' },
      permissions: ['settings:write', 'app:keymap'],
    }
    let capturedSettings: PluginSettingsHost | undefined
    let capturedKeymap: PluginKeymapHost | undefined
    const loadModule = vi.fn(async (_manifest, _specifier, capabilities) => ({
      module: {
        runtimeHost: 'isolated' as const,
        activate: () => {
          capturedSettings = capabilities.settingsBroker
          capturedKeymap = capabilities.keymapBroker
          return {}
        },
      },
      dispose: () => undefined,
    }))
    const manager = new DesktopPluginManager({
      actionRegistry: new ActionRegistry(),
      storage,
      milkupVersion: '2.0.0-beta.1',
      pluginSdkVersion: '0.3.1',
      permissions: ['settings:write', 'app:keymap'],
      manifestHost: {
        selectManifestPath: async () => undefined,
        readManifestText: async () => JSON.stringify(manifest),
      },
      settingsAdapter: (value) => settings.adapterForPlugin(value.id, value.settings),
      keymapAdapter: () => keymap,
      loadModule,
    })
    await manager.installManifestPath('/plugins/preferences/plugin.json')
    await manager.enable(manifest.id)
    expect(loadModule).not.toHaveBeenCalled()
    manager.approve(manifest.id)
    await manager.enable(manifest.id)
    const first = capturedSettings!
    const keys = capturedKeymap!
    const transaction = await first.begin('application')
    await first.preview(transaction.id, { 'editor.fontSize': 22 })
    expect(fontSize).toBe(22)
    await manager.disable(manifest.id)
    expect(fontSize).toBe(14)
    await expect(first.get('application')).rejects.toThrow('revoked')
    await expect(keys.snapshot()).rejects.toMatchObject({ code: 'revoked' })
    await manager.enable(manifest.id)
    const next = await capturedSettings!.begin('application')
    await capturedSettings!.preview(next.id, { 'editor.fontSize': 18 })
    await capturedSettings!.commit(next.id)
    await manager.remove(manifest.id)
    expect(fontSize).toBe(18)
    const restarted = createDesktopSettingsService({
      storage,
      applyView: (values) => {
        fontSize = Number(values['editor.fontSize'])
      },
    })
    await restarted.ready
    expect(fontSize).toBe(18)
    expect(manager.state().records).toHaveLength(0)
  })
})

import { describe, expect, it, vi } from 'vitest'
import { ActionRegistry } from '@milkup/core'
import { DesktopPluginManager } from './desktop-plugin-manager'

function storage(): Storage {
  const values = new Map<string, string>()
  return {
    get length() {
      return values.size
    },
    clear: () => values.clear(),
    key: (i) => [...values.keys()][i] ?? null,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value)
    },
    removeItem: (key) => {
      values.delete(key)
    },
  }
}

const archive = (version = '1.0.0', permissions = ['document:read']) => ({
  format: 'milkup-plugin',
  version: 1,
  manifest: {
    id: 'generic.sample',
    name: 'Sample',
    version,
    host: 'worker',
    main: './plugin.js',
    permissions,
  },
  files: [{ path: 'plugin.js', encoding: 'utf8', content: 'export default {}' }],
})

function setup(saved = storage(), bundled = archive()) {
  const install = vi.fn(async () => ({
    manifestPath: '/installed/plugin.json',
    rootPath: '/installed',
    dataRoot: '/data',
    storageRoot: '/storage',
  }))
  const load = vi.fn(async () => ({
    module: { runtimeHost: 'isolated' as const, activate: () => ({}) },
    dispose: () => undefined,
  }))
  const manager = new DesktopPluginManager({
    actionRegistry: new ActionRegistry(),
    storage: saved,
    permissions: [
      'document:read',
      'file:write',
      'app:updates',
      'workspace:read',
      'settings:write',
      'app:keymap',
    ],
    milkupVersion: '0.1.0',
    pluginSdkVersion: '0.1.1',
    bundledPackagePaths: async () => ['/bundled/sample.milkup-plugin'],
    manifestHost: {
      selectManifestPath: async () => undefined,
      readManifestText: async () => JSON.stringify(bundled),
      installPackage: install,
    },
    loadModule: load,
  })
  return { manager, install, load, saved }
}

describe('bundled plugin first-run installation', () => {
  it('serializes user package selection after default installation has settled', async () => {
    let release!: (paths: readonly string[]) => void
    const paths = new Promise<readonly string[]>((resolve) => {
      release = resolve
    })
    const select = vi.fn(async () => undefined)
    const manager = new DesktopPluginManager({
      actionRegistry: new ActionRegistry(),
      storage: storage(),
      permissions: [],
      milkupVersion: '0.1.0',
      pluginSdkVersion: '0.1.1',
      bundledPackagePaths: () => paths,
      manifestHost: { selectManifestPath: select, readManifestText: async () => '' },
    })
    const install = manager.installFromPicker()
    await Promise.resolve()
    expect(select).not.toHaveBeenCalled()
    release([])
    await install
    expect(select).toHaveBeenCalledTimes(1)
  })
  it('uses the package installer and isolated loader for an arbitrary readonly plugin', async () => {
    const { manager, install, load } = setup()
    await manager.ready
    expect(install).toHaveBeenCalledTimes(1)
    expect(load).toHaveBeenCalledTimes(1)
    expect(manager.state().records[0]).toMatchObject({
      enabled: true,
      manifestPath: '/installed/plugin.json',
      manifest: { id: 'generic.sample' },
    })
  })

  it('preserves disable and uninstall across restart and newer bundled versions', async () => {
    const first = setup()
    await first.manager.ready
    await first.manager.disable('generic.sample')
    const second = setup(first.saved, archive('2.0.0'))
    await second.manager.ready
    expect(second.install).not.toHaveBeenCalled()
    expect(second.load).not.toHaveBeenCalled()
    expect(second.manager.state().records[0]).toMatchObject({
      enabled: false,
      manifest: { version: '1.0.0' },
    })
    await second.manager.remove('generic.sample')
    const third = setup(first.saved, archive('3.0.0'))
    await third.manager.ready
    expect(third.install).not.toHaveBeenCalled()
    expect(third.manager.state().records).toHaveLength(0)
  })

  it.each(['0.5.0', '9.0.0'])(
    'preserves an existing user version %s and its disabled state',
    async (version) => {
      const saved = storage()
      const user = setup(saved, archive(version))
      await user.manager.ready
      await user.manager.disable('generic.sample')
      saved.removeItem('milkup.desktop.plugins.bundled.v1')
      const next = setup(saved)
      await next.manager.ready
      expect(next.install).not.toHaveBeenCalled()
      expect(next.load).not.toHaveBeenCalled()
      expect(next.manager.state().records[0]).toMatchObject({
        enabled: false,
        manifest: { version },
      })
      await next.manager.remove('generic.sample')
      const restart = setup(saved)
      await restart.manager.ready
      expect(restart.manager.state().records).toHaveLength(0)
    },
  )

  it.each(['file:write', 'app:updates', 'workspace:read', 'settings:write', 'app:keymap'])(
    'installs %s packages inactive without approving or executing them',
    async (permission) => {
      const { manager, install, load } = setup(storage(), archive('1.0.0', [permission]))
      await manager.ready
      expect(install).toHaveBeenCalledTimes(1)
      expect(load).not.toHaveBeenCalled()
      expect(manager.state().records[0]).toMatchObject({
        enabled: false,
        approvals: { permissions: [] },
      })
      expect(manager.state().installFailures).toHaveLength(0)
    },
  )

  it('fails closed on corrupt receipts without preventing ordinary startup', async () => {
    const saved = storage()
    saved.setItem('milkup.desktop.plugins.bundled.v1', '{broken')
    const { manager, install } = setup(saved)
    await manager.ready
    expect(install).not.toHaveBeenCalled()
    expect(manager.state().installFailures).toHaveLength(1)
    expect(saved.getItem('milkup.desktop.plugins.bundled.v1')).toBe('{broken')
  })

  it('does not install if durable receipt storage fails', async () => {
    const saved = storage()
    const write = saved.setItem
    saved.setItem = (key, value) => {
      if (key === 'milkup.desktop.plugins.bundled.v1') throw Error('quota')
      write(key, value)
    }
    const { manager, install } = setup(saved)
    await manager.ready
    expect(install).not.toHaveBeenCalled()
    expect(manager.state().installFailures[0]?.message).toContain('quota')
  })

  it('keeps the editor ready even when failure reporting storage is full', async () => {
    const saved = storage()
    saved.setItem = () => {
      throw Error('all storage full')
    }
    const { manager, install } = setup(saved)
    await expect(manager.ready).resolves.toBeUndefined()
    expect(install).not.toHaveBeenCalled()
    expect(manager.state().installFailures[0]?.message).toContain('all storage full')
  })

  it('restores an enabled installed copy without reinstalling or activating it twice', async () => {
    const first = setup()
    await first.manager.ready
    const next = setup(first.saved)
    await next.manager.ready
    expect(next.install).not.toHaveBeenCalled()
    expect(next.load).toHaveBeenCalledTimes(1)
    expect(next.manager.state().records[0]?.enabled).toBe(true)
  })
})

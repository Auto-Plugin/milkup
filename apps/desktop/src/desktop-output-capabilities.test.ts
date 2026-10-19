import { ActionRegistry } from '@milkup/core'
import type { PluginManifest, PluginOutputBrokerAdapter, PluginOutputHost } from '@milkup/plugin'
import { describe, expect, it, vi } from 'vitest'
import {
  DesktopPluginManager,
  renderDesktopPluginManager,
  type DesktopPluginModuleCapabilities,
  type DesktopPluginModuleLoader,
} from './desktop-plugin-manager'

function setup(host: 'worker' | 'sidecar' = 'worker', read = true) {
  const manifest: PluginManifest = {
    id: 'custom-output-provider',
    name: 'Output provider',
    version: '1.0.0',
    host,
    main: 'dist/plugin.js',
    permissions: [...(read ? ['document:read' as const] : []), 'document:output'],
  }
  const adapter: PluginOutputBrokerAdapter = {
    capture: vi.fn(async () => ({
      id: 'snapshot-1',
      documentId: 'doc-1',
      version: 1,
      title: 'Document',
      from: 0,
      to: 1,
      lineCount: 1,
      warnings: [],
    })),
    chooseTarget: vi.fn(async () => ({ status: 'cancelled' as const })),
    write: vi.fn(async () => ({ status: 'written' as const, name: 'Document.html', bytes: 1 })),
    print: vi.fn(async () => ({ status: 'printed' as const })),
    release: vi.fn(async () => {}),
  }
  const stopped: string[] = []
  const dispose = vi.fn(async () => {
    await Promise.resolve()
    stopped.push('output')
  })
  const factory = vi.fn(() => ({ adapter, dispose }))
  const loaded: DesktopPluginModuleCapabilities[] = []
  const runtimeHosts: (PluginOutputHost | undefined)[] = []
  const load: DesktopPluginModuleLoader = async (_manifest, _specifier, capabilities) => {
    loaded.push(capabilities!)
    return {
      module: {
        runtimeHost: 'isolated',
        activate: (context) => {
          runtimeHosts.push(context.host.output)
          return {}
        },
      },
      dispose: () => {
        stopped.push('module')
      },
    }
  }
  const manager = new DesktopPluginManager({
    actionRegistry: new ActionRegistry(),
    manifestHost: {
      selectManifestPath: async () => undefined,
      readManifestText: async () => JSON.stringify(manifest),
    },
    permissions: manifest.permissions!,
    milkupVersion: '2.0.0-beta.1',
    pluginSdkVersion: '0.3.5',
    outputAdapter: factory,
    loadModule: load,
    loadSidecarModule: load,
  })
  return { manifest, adapter, manager, factory, loaded, runtimeHosts, dispose, stopped }
}

describe('desktop output capability lifecycle', () => {
  it.each(['worker', 'sidecar'] as const)(
    'requires sensitive approval and wires %s plus runtime',
    async (host) => {
      const t = setup(host)
      await t.manager.installManifestPath('/plugins/output/plugin.json')
      await t.manager.enable(t.manifest.id)
      expect(t.loaded).toHaveLength(0)
      expect(t.factory).not.toHaveBeenCalled()
      expect(t.manager.state().records[0]?.errors.join(' ')).toContain('document:output')
      const html = renderDesktopPluginManager(t.manager.state(), {
        selectedPluginId: t.manifest.id,
      })
      expect(html).toContain('导出与打印当前文档')
      t.manager.approve(t.manifest.id)
      await t.manager.enable(t.manifest.id)
      expect(t.factory).toHaveBeenCalledTimes(1)
      expect(t.loaded[0]?.outputBroker).toBeDefined()
      expect(t.runtimeHosts[0]).toBeDefined()
      await expect(
        t.loaded[0]!.outputBroker!.capture({
          format: 'html',
          scope: 'document',
          resources: 'embed',
        }),
      ).rejects.toMatchObject({ code: 'gesture-required' })
      expect(t.adapter.capture).not.toHaveBeenCalled()
      await t.manager.disable(t.manifest.id)
      expect(t.stopped).toEqual(['output', 'module'])
      await expect(t.loaded[0]!.outputBroker!.release('snapshot-1')).rejects.toMatchObject({
        code: 'revoked',
      })
      await t.manager.enable(t.manifest.id)
      expect(t.factory).toHaveBeenCalledTimes(2)
      expect(t.loaded[1]!.outputBroker).not.toBe(t.loaded[0]!.outputBroker)
      await t.manager.revokeApproval(t.manifest.id)
      await expect(t.loaded[1]!.outputBroker!.release('snapshot-1')).rejects.toMatchObject({
        code: 'revoked',
      })
      expect(t.dispose).toHaveBeenCalledTimes(2)
    },
  )

  it('does not expose output without document read permission', async () => {
    const t = setup('worker', false)
    await expect(t.manager.installManifestPath('/plugins/output/plugin.json')).rejects.toThrow(
      'Document output requires document:read',
    )
    expect(t.factory).not.toHaveBeenCalled()
    expect(t.loaded).toHaveLength(0)
  })

  it('revokes output synchronously on execution host failure', async () => {
    const t = setup()
    await t.manager.installManifestPath('/plugins/output/plugin.json')
    t.manager.approve(t.manifest.id)
    await t.manager.enable(t.manifest.id)
    t.loaded[0]!.onIsolationError!(new Error('worker failed'))
    await expect(t.loaded[0]!.outputBroker!.release('snapshot-1')).rejects.toMatchObject({
      code: 'revoked',
    })
    await t.manager.disable(t.manifest.id)
    expect(t.dispose).toHaveBeenCalledTimes(1)
  })
})

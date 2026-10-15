import { describe, it, expect, vi } from 'vitest'
import { createPluginUiBroker, createPluginUiHostCapabilities } from './ui-broker'
import { parsePluginManifest } from './manifest'
import { PluginRegistry, createPluginContributionIndex } from './registry'
import { createRpcPluginUiBroker, createPluginUiRpcServer } from './ui-rpc'
import { pair, flush } from './settings-test-helpers'
const manifest = {
  id: 'image-test',
  name: 'Image',
  version: '1.0.0',
  permissions: ['images:import'],
  contributes: {
    commands: [{ id: 'image.insert', action: 'image.insert', title: 'Image' }],
    pasteHandlers: [{ kind: 'image', command: 'image.insert' }],
    ui: [{ id: 'image.menu', slot: 'context-menu', title: 'Image', scope: 'document' }],
  },
}
describe('controlled image contributions and UI', () => {
  it('accepts owned image contribution and context menu but rejects extra/foreign authority', () => {
    expect(parsePluginManifest(manifest).contributes?.pasteHandlers).toHaveLength(1)
    for (const value of [
      { ...manifest, permissions: [] },
      {
        ...manifest,
        contributes: {
          ...manifest.contributes,
          pasteHandlers: [{ kind: 'image', command: 'other.command' }],
        },
      },
      {
        ...manifest,
        contributes: {
          ...manifest.contributes,
          pasteHandlers: [{ kind: 'image', command: 'image.insert', path: '/tmp' }],
        },
      },
    ])
      expect(() => parsePluginManifest(value)).toThrow()
  })
  it('selects first enabled image handler and shadows conflicts', () => {
    const registry = new PluginRegistry()
    const first = registry.installLocalPlugin({ manifest, manifestPath: '/one/plugin.json' })
    registry.approve(first.manifest.id)
    registry.markEnabled(first.manifest.id)
    const second = registry.installLocalPlugin({
      manifest: {
        ...manifest,
        id: 'image-second',
        contributes: {
          ...manifest.contributes,
          commands: [{ id: 'image.second', action: 'image.second', title: 'Image' }],
          pasteHandlers: [{ kind: 'image', command: 'image.second' }],
        },
      },
      manifestPath: '/two/plugin.json',
    })
    registry.approve(second.manifest.id)
    registry.markEnabled(second.manifest.id)
    const actions = [
      { id: 'image.insert', title: 'Image', category: 'plugin' as const, run: () => {} },
      { id: 'image.second', title: 'Image', category: 'plugin' as const, run: () => {} },
    ]
    expect(
      createPluginContributionIndex(registry.list(), actions).pasteHandlers?.map((h) => h.status),
    ).toEqual(['active', 'shadowed'])
    registry.markDisabled(first.manifest.id)
    expect(
      createPluginContributionIndex(registry.list(), actions).pasteHandlers?.[0]?.pluginId,
    ).toBe('image-second')
  })
  it('requires trusted command and owned modal, bounds and rate limits notices', async () => {
    let active = true
    const open = vi.fn(),
      notify = vi.fn()
    const broker = createPluginUiBroker({
      pluginId: 'image-test',
      viewIds: ['own', 'toolbar'],
      modalViewIds: ['own'],
      update: () => {},
      open,
      notify,
      isActive: () => active,
      consumeGesture: (proof) => proof === 'trusted',
    })
    await expect(broker.open!('own')).rejects.toThrow('trusted')
    await expect(broker.open!('toolbar', 'trusted')).rejects.toThrow('unavailable')
    const host = createPluginUiHostCapabilities(broker, () => active, 'trusted')
    await host.open('own')
    expect(open).toHaveBeenCalledWith('image-test', 'own')
    await host.notify({ kind: 'error', message: 'Could not import image' })
    await expect(host.notify({ kind: 'info', message: 'Again' })).rejects.toThrow('rate')
    await expect(host.notify({ kind: 'info', message: 'x'.repeat(1001) })).rejects.toThrow(
      'Invalid',
    )
    active = false
    await expect(host.open('own')).rejects.toThrow('revoked')
  })
  it('rejects unknown UI RPC methods instead of treating them as requestUpdate', async () => {
    const p = pair(),
      update = vi.fn(async () => {})
    const server = createPluginUiRpcServer(p.main, {
      requestUpdate: update,
      revealLine: async () => {},
    })
    p.worker.postMessage({
      protocol: 'milkup.plugin.ui.rpc.v1',
      type: 'request',
      id: 'x',
      method: 'exec',
    })
    await flush()
    expect(update).not.toHaveBeenCalled()
    const client = createRpcPluginUiBroker(p.worker)
    await client.requestUpdate()
    expect(update).toHaveBeenCalledTimes(1)
    client.dispose()
    server.dispose()
  })
})

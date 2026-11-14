import { describe, expect, it } from 'vitest'
import type { PluginHostKind } from './manifest'
import { PluginRegistry, parsePluginRegistrySnapshot, serializePluginRegistry } from './registry'

const manifest = {
  id: 'example.presentation',
  name: 'Presentation',
  version: '1.0.0',
  host: 'dom',
  main: 'dist/plugin.js',
  permissions: ['document:read'],
  contributes: {
    documentRenderers: [
      { id: 'example.graph', contexts: ['fence'], fenceLanguages: ['example-graph'] },
    ],
  },
}
const allowedHosts = ['worker', 'sidecar', 'dom'] as PluginHostKind[]

describe('DOM host approval isolation', () => {
  it('does not inherit an explicitly approved Worker host when the same plugin changes host', () => {
    const registry = new PluginRegistry({ allowedHosts })
    registry.installLocalPlugin({
      manifest: { ...manifest, host: 'worker' },
      manifestPath: '/installed/plugin.json',
    })
    registry.approve(manifest.id)
    registry.markEnabled(manifest.id)
    const installed = registry.installLocalPlugin({
      manifest,
      manifestPath: '/installed/plugin.json',
    })
    expect(installed.manifest.host).toBe('dom')
    expect(installed.enabled).toBe(false)
    expect(installed.state).toBe('disabled')
    expect(installed.approvals.hosts).toEqual([])
    expect(registry.approve(manifest.id).approvals.hosts).toEqual(['dom'])
    expect(registry.revokeApproval(manifest.id).approvals.hosts).toEqual([])
  })

  it('preserves explicit DOM approval through snapshot restore without inventing sidecar approval', () => {
    const original = new PluginRegistry({ allowedHosts })
    original.installLocalPlugin({ manifest, manifestPath: '/installed/plugin.json' })
    expect(original.get(manifest.id)?.approvals.hosts).toEqual([])
    original.approve(manifest.id)
    const restored = new PluginRegistry({ allowedHosts })
    restored.restore(parsePluginRegistrySnapshot(serializePluginRegistry(original)))
    expect(restored.get(manifest.id)?.approvals.hosts).toEqual(['dom'])
    expect(
      restored.installLocalPlugin({
        manifest: { ...manifest, host: 'sidecar' },
        manifestPath: '/installed/plugin.json',
      }).approvals.hosts,
    ).toEqual([])
  })
})

import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { parsePluginManifest } from './manifest'
import { PluginRegistry, validatePluginCompatibility } from './registry'

const compatibility = { milkupVersion: '2.0.0-beta.1', pluginSdkVersion: '0.3.7' }
function manifest(name: string) {
  return parsePluginManifest(
    JSON.parse(
      readFileSync(new URL(`../../../plugins/${name}/plugin.json`, import.meta.url), 'utf8'),
    ),
  )
}
it.each(['outline', 'footnotes', 'diagrams'])(
  'keeps existing %s manifest compatible with SDK 0.3.7 without changing its declared range',
  (name) => {
    expect(validatePluginCompatibility(manifest(name), compatibility)).toEqual([])
  },
)
it('requires SDK 0.3.7 for the management capability and preserves explicit approval', () => {
  const input = manifest('management')
  expect(input.permissions).toEqual(['app:plugins'])
  expect(validatePluginCompatibility(input, compatibility)).toEqual([])
  expect(
    validatePluginCompatibility(input, { ...compatibility, pluginSdkVersion: '0.3.6' }),
  ).not.toEqual([])
  const registry = new PluginRegistry({ compatibility })
  const record = registry.installLocalPlugin({
    manifest: input,
    manifestPath: '/plugins/management/plugin.json',
  })
  expect(record.enabled).toBe(false)
  expect(record.approvals.permissions).toEqual([])
  expect(record.approvals.hosts).toEqual(['worker'])
})

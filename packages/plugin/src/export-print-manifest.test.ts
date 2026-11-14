import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { validatePluginManifest } from './manifest'

const manifest = JSON.parse(
  readFileSync(new URL('../../../plugins/export-print/plugin.json', import.meta.url), 'utf8'),
)
describe('independent export-print manifest admission', () => {
  it('is accepted by the actual host validator with public output permissions', () => {
    const result = validatePluginManifest(manifest)
    expect(result.errors).toEqual([])
    expect(result.ok).toBe(true)
  })
})

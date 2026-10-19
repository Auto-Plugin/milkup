import { expect, it } from 'vitest'
import { parsePluginRegistrySnapshot } from '@milkup/plugin'

it('baseline must reject duplicate legacy plugin records before authority restore', () => {
  const row = { manifest: { id: 'test.catalog', name: 'Catalog', version: '1.0.0' }, enabled: true, state: 'enabled' }
  expect(() => parsePluginRegistrySnapshot(JSON.stringify({ version: 1, records: [row, row] }))).toThrow()
})
it('baseline must reject malformed record approvals before authority restore', () => {
  expect(() => parsePluginRegistrySnapshot(JSON.stringify({ version: 1, records: [{ manifest: {}, approvals: true }] }))).toThrow()
})

import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import plugin from './plugin'
const manifest = JSON.parse(await readFile(new URL('../plugin.json', import.meta.url), 'utf8'))
describe('installable public manifest', () => {
  it('uses action-style command identifiers and matching handlers', () => {
    for (const command of manifest.contributes.commands) {
      expect(command.id).toMatch(/^[a-z][A-Za-z0-9]*(?:[.:][a-z][A-Za-z0-9]*)+$/)
      expect(command.action).toBe(command.id)
      expect(plugin.commands?.[command.id]).toBeTypeOf('function')
    }
  })
})

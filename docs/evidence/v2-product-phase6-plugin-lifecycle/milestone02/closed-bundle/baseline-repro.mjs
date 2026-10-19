import { execFileSync } from 'node:child_process'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
const baseline = '633a6d7910f9fa44b9fa89628967e6b7105071ec'
const source = execFileSync('git', ['show', `${baseline}:apps/desktop/src/main.ts`], { cwd: '/workspace/milkup', encoding: 'utf8' })
const start = source.indexOf('    async prepareModule(manifest: PluginManifest, manifestPath: string, main: string) {')
const end = source.indexOf('    async selectPackageExportPath(', start)
assert.ok(start > 0 && end > start)
const method = source.slice(start, end).replace('(manifest: PluginManifest, manifestPath: string, main: string)', '(manifest, manifestPath, main)').replace(' as unknown', '')
const construct = new Function('isPluginPackageArchive', 'resolvePluginEntryPath', `return ({${method}})`)
const host = construct(() => false, (_path, main) => main)
host.readManifestText = async path => path.endsWith('plugin.json') ? '{}' : `export async function activate() { await import('https://example.test/external.js') }`
let failures = 0
for (const main of ['data:text/javascript,export function activate() {}', 'plugin.js']) {
  try {
    await assert.rejects(host.prepareModule({ host: 'worker' }, '/fixture/plugin.json', main))
  } catch (error) {
    failures++
    console.log(`EXPECTED BASELINE FAILURE: ${main}: ${error.message}`)
  }
}
console.log(JSON.stringify({ baseline, sourceSha256: createHash('sha256').update(source).digest('hex'), extractedMethodSha256: createHash('sha256').update(method).digest('hex'), expectedFailures: failures }))
assert.equal(failures, 2)

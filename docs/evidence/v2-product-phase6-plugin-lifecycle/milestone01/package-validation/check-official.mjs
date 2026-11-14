import { createServer } from '/workspace/milkup/node_modules/vite/dist/node/index.js'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
const root = '/workspace/milkup'
const server = await createServer({ root, configFile: false, optimizeDeps: { noDiscovery: true, entries: [] }, server: { middlewareMode: true }, appType: 'custom' })
try {
  const { parsePluginPackageArchive } = await server.ssrLoadModule('/packages/plugin/src/package.ts')
  const baseline = await server.ssrLoadModule('/workspace/milkup-plugin-lifecycle-evidence/milestone01/package-validation/baseline-package.ts')
  const results = []
  const directories = (await readdir(`${root}/plugins`)).map(dir => `${root}/plugins/${dir}/dist`)
  directories.push(`${root}/apps/desktop/src/bundled-plugins`)
  for (const dist of directories) {
    for (const name of await readdir(dist).catch(() => [])) {
      if (!name.endsWith('.milkup-plugin')) continue
      const path = `${dist}/${name}`, bytes = await readFile(path)
      const value = JSON.parse(bytes.toString('utf8'))
      const check = parser => { try { parser(value); return { status: 'pass' } } catch (error) { return { status: 'rejected', error: String(error) } } }
      results.push({ path, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), id: value.manifest.id, version: value.manifest.version, baseline: check(baseline.parsePluginPackageArchive), current: check(parsePluginPackageArchive) })
    }
  }
  if (!results.some(r => r.id === 'milkup.diagrams' && r.bytes > 5 * 1024 * 1024 && r.current.status === 'pass')) throw new Error('Missing real Mermaid archive')
  await writeFile('/workspace/milkup-plugin-lifecycle-evidence/milestone01/package-validation/official-compatibility.json', JSON.stringify(results, null, 2) + '\n')
  const regressions = results.filter(r => r.baseline.status === 'pass' && r.current.status !== 'pass')
  console.log(JSON.stringify({ archives: results.length, accepted: results.filter(r => r.current.status === 'pass').length, preexistingRejected: results.filter(r => r.baseline.status === 'rejected').length, regressions: regressions.length }))
  if (regressions.length) throw new Error('Official archive compatibility regression')
} finally {
  await server.close()
}

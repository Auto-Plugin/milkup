import { build } from 'esbuild'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

// This script deliberately needs only this plugin directory and its installed public SDK.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(await readFile(resolve(root, 'plugin.json'), 'utf8'))
if (manifest.host !== 'worker' || manifest.main !== './dist/plugin.js') {
  throw new Error('The standalone updates package requires its Worker dist/plugin.js entry')
}
const result = await build({
  absWorkingDir: root,
  entryPoints: ['src/plugin.ts'],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  outfile: 'dist/plugin.js',
  write: false,
  metafile: true,
})
const inputs = Object.keys(result.metafile.inputs)
for (const input of inputs) {
  const normalized = input.replaceAll('\\', '/')
  if (!normalized.startsWith('src/') && !normalized.includes('/@milkup/plugin-sdk/')) {
    throw new Error(`Plugin bundle imported a non-public dependency: ${input}`)
  }
}
if (Object.values(result.metafile.outputs).some((output) => output.imports.length !== 0)) {
  throw new Error('Plugin entry must be self-contained, without runtime imports')
}
if (result.outputFiles.length !== 1) throw new Error('Expected exactly one ESM entry')
const entry = result.outputFiles[0].text
await mkdir(resolve(root, 'dist'), { recursive: true })
await writeFile(resolve(root, 'dist/plugin.js'), entry)
await writeFile(
  resolve(root, 'dist/build-meta.json'),
  `${JSON.stringify(result.metafile, null, 2)}\n`,
)
const archive = {
  format: 'milkup-plugin',
  version: 1,
  manifest,
  files: [{ path: 'dist/plugin.js', encoding: 'utf8', content: entry }],
}
const archiveName = `${manifest.id}-${manifest.version}.milkup-plugin`
await writeFile(resolve(root, 'dist', archiveName), `${JSON.stringify(archive, null, 2)}\n`)
console.log(`Built dist/plugin.js and dist/${archiveName}`)

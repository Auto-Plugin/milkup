import { build } from 'esbuild'
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { dirname, resolve, relative, isAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(resolve(root, 'package.json'))
const manifest = JSON.parse(await readFile(resolve(root, 'plugin.json'), 'utf8'))
if (manifest.host !== 'worker' || manifest.main !== './dist/plugin.js')
  throw Error('A self-contained Worker entry is required')
const katexRoot = dirname(require.resolve('katex/package.json'))
const katexPackage = JSON.parse(await readFile(resolve(katexRoot, 'package.json'), 'utf8'))
if (katexPackage.version !== '0.19.0') throw Error('Only reviewed KaTeX 0.19.0 is permitted')
const allowedFiles = new Set(
  await Promise.all(
    [
      resolve(katexRoot, 'dist/katex.mjs'),
      fileURLToPath(import.meta.resolve('@milkup/plugin-sdk')),
    ].map((path) => realpath(path)),
  ),
)
const sourceRoot = await realpath(resolve(root, 'src'))
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
for (const input of Object.keys(result.metafile.inputs)) {
  const path = await realpath(resolve(root, input))
  const local = relative(sourceRoot, path)
  if (!allowedFiles.has(path) && (local.startsWith('..') || isAbsolute(local)))
    throw Error(`Unreviewed bundle dependency: ${input}`)
}
if (
  result.outputFiles.length !== 1 ||
  Object.values(result.metafile.outputs).some((output) => output.imports.length)
)
  throw Error('Bundle must be one module without runtime imports')
const files = [{ path: 'dist/plugin.js', encoding: 'utf8', content: result.outputFiles[0].text }]
for (const resource of manifest.resources ?? []) {
  const path = await realpath(resolve(root, resource))
  const rel = relative(root, path)
  if (!rel || rel.startsWith('..') || isAbsolute(rel) || resource.includes('\\'))
    throw Error('Package resource escapes plugin root')
  files.push({ path: resource, encoding: 'utf8', content: await readFile(path, 'utf8') })
}
const archive =
  JSON.stringify({ format: 'milkup-plugin', version: 1, manifest, files }, null, 2) + '\n'
await mkdir(resolve(root, 'dist'), { recursive: true })
const archiveName = `${manifest.id}-${manifest.version}.milkup-plugin`
await writeFile(resolve(root, 'dist/plugin.js'), result.outputFiles[0].text)
await writeFile(resolve(root, 'dist', archiveName), archive)
await writeFile(
  resolve(root, 'dist/build-meta.json'),
  JSON.stringify(result.metafile, null, 2) + '\n',
)
await writeFile(
  resolve(root, 'dist/proof.json'),
  JSON.stringify(
    {
      archive: archiveName,
      katex: katexPackage.version,
      bytes: Buffer.byteLength(archive),
      entryBytes: result.outputFiles[0].contents.length,
      sha256: createHash('sha256').update(archive).digest('hex'),
      inputs: Object.keys(result.metafile.inputs),
    },
    null,
    2,
  ) + '\n',
)
console.log(`Built ${archiveName} (${Buffer.byteLength(archive)} bytes)`)

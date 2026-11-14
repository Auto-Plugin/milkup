import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, realpath, readdir, lstat, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { build } from 'esbuild'

const root = await realpath(process.cwd())
const evidence = process.argv[2]
assert.ok(evidence)
const require = createRequire(path.join(root, 'package.json'))
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const read = file => readFile(path.join(root, file))
const json = async file => JSON.parse(await read(file))
const within = file => file.startsWith(root + path.sep)
const sdkEntry = await realpath(fileURLToPath(import.meta.resolve('@milkup/plugin-sdk')))
assert.ok(within(sdkEntry), 'SDK must resolve within the external build')
const sdkRoot = path.dirname(path.dirname(sdkEntry))
const sdkPackage = JSON.parse(await readFile(path.join(sdkRoot, 'package.json')))
assert.equal(sdkPackage.version, '0.3.6')
const sdkSha = sha(await read('vendor/plugin-sdk.tgz'))
assert.equal(sdkSha, '2043b0586c73579c06821c76a20eb0d7a852ffd7c7e8181ea555433a0c506cec')

let links = 0
async function checkLinks(directory) {
  for (const name of await readdir(directory)) {
    const entry = path.join(directory, name), metadata = await lstat(entry)
    if (metadata.isSymbolicLink()) {
      links++
      assert.ok(within(await realpath(entry)), `Dependency symlink escapes: ${entry}`)
    } else if (metadata.isDirectory()) await checkLinks(entry)
  }
}
await checkLinks(path.join(root, 'node_modules'))

const original = JSON.parse(await readFile(path.join(evidence, 'copied-inputs.json')))
for (const item of original) {
  if (item.path === 'package.json') continue // Recorded external dependency replacement.
  assert.equal(sha(await read(item.path)), item.sha256, `Copied input changed: ${item.path}`)
}
const sourcePackage = JSON.parse(await readFile(path.join(evidence, 'copied-input/package.json')))
const externalPackage = await json('package.json')
const {devDependencies: oldDeps, ...oldRest} = sourcePackage
const {devDependencies: newDeps, packageManager, ...newRest} = externalPackage
assert.deepEqual(newRest, oldRest)
assert.equal(packageManager, 'pnpm@11.7.0')
assert.deepEqual(newDeps, {
  '@milkup/plugin-sdk': 'file:vendor/plugin-sdk.tgz',
  esbuild: '0.25.12', typescript: '5.9.3', vitest: '3.2.6',
})
const rebuilt = await build({
  absWorkingDir: root, entryPoints: ['src/plugin.ts'], bundle: true,
  format: 'esm', platform: 'browser', target: 'es2022', outfile: 'dist/plugin.js',
  write: false, metafile: true,
})
assert.equal(rebuilt.outputFiles.length, 1)
assert.equal(rebuilt.outputFiles[0].text, (await read('dist/plugin.js')).toString())
const inputs = []
for (const name of Object.keys(rebuilt.metafile.inputs)) {
  const resolved = await realpath(path.resolve(root, name))
  assert.ok(within(resolved))
  assert.ok(resolved.startsWith(path.join(root, 'src') + path.sep) || resolved.startsWith(sdkRoot + path.sep))
  inputs.push({ path: name, realPath: resolved, sha256: sha(await readFile(resolved)) })
}
for (const output of Object.values(rebuilt.metafile.outputs)) assert.equal(output.imports.length, 0)
const manifest = await json('plugin.json')
assert.equal(manifest.version, '1.3.1')
assert.equal(manifest.engines.pluginSdk, '>=0.2.0 <0.4.0')
assert.deepEqual(manifest.permissions, ['document:read'])
const archiveName = `dist/${manifest.id}-${manifest.version}.milkup-plugin`
const archiveBytes = await read(archiveName)
const archive = JSON.parse(archiveBytes)
assert.equal(archive.format, 'milkup-plugin')
assert.equal(archive.version, 1)
assert.deepEqual(archive.manifest, manifest)
assert.deepEqual(archive.files, [{ path: 'dist/plugin.js', encoding: 'utf8', content: rebuilt.outputFiles[0].text }])
const records = []
for (const name of ['package.json', 'pnpm-lock.yaml', 'vendor/plugin-sdk.tgz', 'dist/plugin.js', 'dist/build-meta.json', archiveName]) {
  const bytes = await read(name)
  records.push({path:name, bytes:bytes.length, sha256:sha(bytes)})
}
const tools = Object.fromEntries(['esbuild','typescript','vitest'].map(name => [name,require(`${name}/package.json`).version]))
await writeFile(path.join(evidence, 'verification.json'), JSON.stringify({
  status:'passed', root, sourceVersion:'1.3.1', sdkVersion:sdkPackage.version,
  sdkSha256:sdkSha, tools, dependencySymlinksWithinExternalRoot:links,
  originalSdkDependency:oldDeps['@milkup/plugin-sdk'], dependencyPolicy:'external-derived-lock; source package remains legacy-non-frozen',
  trustedRebuildMatches:true, copiedSourcesUnchanged:true, runtimeImports:0, inputs, records,
},null,2)+'\n')
console.log(JSON.stringify({status:'passed', archive:archiveName, bytes:archiveBytes.length, sha256:sha(archiveBytes), inputs:inputs.length, links}))

import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { lstat, mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { publicBuildFile, readPublicPluginBuildInputs } from './public-plugin-build-contract.mjs'

// This consumes the same process's successful independent-build proof. It is not
// a signature verifier for arbitrary downloaded archives or a delivery command.
export async function stageVerifiedPlugins({ checkout, output, destination, entries }) {
  const proof = JSON.parse(await readFile(path.join(output, 'verification.json'), 'utf8'))
  assert.equal(proof.status, 'passed')
  assert.ok(Array.isArray(proof.plugins))
  assert.equal(proof.plugins.length, entries.length, 'Unexpected archive inventory')
  const records = new Map(proof.plugins.map((record) => [record.id, record]))
  assert.equal(records.size, entries.length, 'Duplicate verified plugin')
  assert.equal(
    new Set(entries.map((entry) => entry.id)).size,
    entries.length,
    'Duplicate expected plugin',
  )
  assert.equal(
    new Set(entries.map((entry) => entry.name.toLowerCase())).size,
    entries.length,
    'Duplicate archive filename',
  )
  const archives = []
  for (const entry of entries) {
    assert.match(entry.id, /^[a-z][a-z0-9]*(?:[.-][a-z][a-z0-9]*)*$/)
    assert.equal(path.basename(entry.name), entry.name)
    const record = records.get(entry.id)
    assert.ok(record, `Missing verified plugin: ${entry.id}`)
    for (const [key, value] of Object.entries(entry)) assert.deepEqual(record[key], value)
    assert.equal(record.build, 'passed')
    assert.equal(record.tests, 'passed')
    const { bytes } = await publicBuildFile(output, `${entry.id}/dist/${entry.name}`)
    assert.equal(bytes.length, record.bytes)
    assert.equal(createHash('sha256').update(bytes).digest('hex'), record.sha256)
    const contents = JSON.parse(bytes.toString('utf8'))
    assert.equal(contents.format, 'milkup-plugin')
    assert.equal(contents.version, 1)
    const source = await publicBuildFile(checkout, `${entry.directory}/plugin.json`)
    assert.deepEqual(contents.manifest, JSON.parse(source.bytes.toString('utf8')))
    assert.deepEqual(contents.manifest.permissions, entry.permissions)
    assert.equal(contents.manifest.host, entry.host)
    archives.push({ name: entry.name, bytes, sha256: record.sha256 })
  }
  // Validate every archive before the first staging write. Never overwrite an
  // existing local bundle (including an old version of the same plugin).
  await mkdir(destination, { recursive: true })
  assert.ok(!(await lstat(destination)).isSymbolicLink(), 'Bundle staging must not be a symlink')
  assert.deepEqual(await readdir(destination), [], 'Bundle staging must be empty')
  for (const archive of archives) {
    await writeFile(path.join(destination, archive.name), archive.bytes, { flag: 'wx' })
  }
  return archives.map(({ name, bytes, sha256 }) => ({ name, bytes: bytes.length, sha256 }))
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const checkout = await realpath(fileURLToPath(new URL('../..', import.meta.url)))
  const [directory] = process.argv.slice(2)
  assert.ok(directory, 'Usage: node stage-public-plugin-check.mjs <external proof directory>')
  const output = await realpath(directory)
  const relative = path.relative(checkout, output)
  assert.ok(relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))
  const { plugins } = await readPublicPluginBuildInputs(checkout)
  assert.equal(plugins.length, 10, 'Beta4 reviewed platform inventory is exactly ten plugins')
  const result = await stageVerifiedPlugins({
    checkout,
    output,
    destination: path.join(checkout, 'apps/desktop/src/bundled-plugins'),
    entries: plugins,
  })
  await writeFile(path.join(output, 'staged-bundles.json'), `${JSON.stringify(result, null, 2)}\n`)
  console.log(JSON.stringify(result, null, 2))
}

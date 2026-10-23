import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, writeFile, mkdir, copyFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../..', import.meta.url))
const [evidence, output] = process.argv.slice(2).map((v) => path.resolve(v))
assert.ok(evidence && output)
const json = async (file) => JSON.parse((await readFile(file, 'utf8')).replace(/^\uFEFF/, ''))
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex')
const manifest = await json(path.join(output, 'manifest.json'))
assert.equal(manifest.version, '2.0.0-beta.7')
assert.equal(manifest.installerExecuted, false)
const proof = await json(path.join(evidence, 'public-plugins/verification.json'))
const staged = await json(path.join(evidence, 'public-plugins/staged-bundles.json'))
assert.equal(proof.status, 'passed')
assert.equal(proof.plugins.length, 10)
assert.equal(staged.length, 10)
const inventory = []
await mkdir(path.join(output, 'plugins'))
for (const record of proof.plugins) {
  assert.equal(record.build, 'passed')
  assert.equal(record.tests, 'passed')
  const bytes = await readFile(path.join(root, 'apps/desktop/src/bundled-plugins', record.name))
  assert.equal(hash(bytes), record.sha256)
  assert.equal(staged.find((p) => p.name === record.name)?.sha256, record.sha256)
  const archive = JSON.parse(bytes)
  const source = await json(path.join(root, record.directory, 'plugin.json'))
  assert.deepEqual(archive.manifest, source)
  assert.equal(source.engines.milkup, '^2.0.0-0')
  assert.notEqual(source.id, 'milkup.updates', 'Updates is a built-in application feature')
  if (source.id === 'milkup.diagrams') {
    assert.equal(source.version, '1.2.0')
    assert.equal(source.host, 'worker')
  }
  if (source.id === 'milkup.formatting') {
    assert.equal(source.version, '1.0.1')
    assert.equal(source.host, 'worker')
  }
  if (source.id === 'milkup.outline') assert.equal(source.version, '1.3.3')
  inventory.push({
    id: source.id,
    version: source.version,
    host: source.host,
    engines: source.engines,
    permissions: source.permissions,
    archive: record.name,
    bytes: bytes.length,
    sha256: record.sha256,
    sdkVersion: record.sdkVersion,
    buildMode: record.buildMode,
    windowsBackendAvailable: source.host !== 'dom',
  })
  await writeFile(path.join(output, 'plugins', record.name), bytes, { flag: 'wx' })
}
await writeFile(path.join(output, 'plugins.json'), JSON.stringify(inventory, null, 2) + '\n')
for (const name of ['README.md', 'FEEDBACK.md'])
  await copyFile(path.join(root, 'docs/manual-windows-beta7', name), path.join(output, name))
await mkdir(path.join(output, 'samples'))
await copyFile(
  path.join(root, 'docs/manual-windows-beta7/samples/basic.md'),
  path.join(output, 'samples/basic.md'),
)
let larger = '# 较大文档手测副本\n\n首部标记：START_ORIGINAL。\n\n'
for (let section = 1; section <= 200; section++) {
  larger += `## 第 ${section} 节\n\n`
  for (let line = 1; line <= 160; line++)
    larger += `第${section}节第${line}行：中文与 English 混排，🙂；identifier_ABCDEFGHIJKLMNOPQRSTUVWXYZ_0123456789。\n\n`
}
larger += '## 末尾\n\n尾部标记：END_ORIGINAL。\n'
await writeFile(path.join(output, 'samples/larger.md'), larger)
manifest.plugins = inventory
manifest.sourceChecks = {
  phases: await json(path.join(evidence, 'phases.json')),
  rust: await json(path.join(evidence, 'rust-test-result.json')),
}
await writeFile(path.join(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
const files = []
async function walk(relative = '') {
  for (const entry of await readdir(path.join(output, relative), { withFileTypes: true })) {
    const name = path.posix.join(relative, entry.name)
    if (entry.isDirectory()) await walk(name)
    else {
      assert.ok(entry.isFile())
      const bytes = await readFile(path.join(output, name))
      files.push({ name, bytes: bytes.length, sha256: hash(bytes) })
    }
  }
}
await walk()
assert.equal(files.filter((f) => f.name.endsWith('.exe')).length, 1)
assert.equal(files.length, 17)
assert.ok(
  files.reduce((n, f) => n + f.bytes, 0) < 49 * 1024 * 1024,
  'Bounded 50 MiB upload including archive overhead',
)
assert.equal(
  files.find((f) => f.name === manifest.installer.deliveredName)?.sha256,
  manifest.installer.sha256,
)
await writeFile(
  path.join(output, 'SHA256SUMS.txt'),
  files
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((f) => `${f.sha256}  ${f.name}\n`)
    .join(''),
)
console.log(
  JSON.stringify({
    files,
    totalBytes: files.reduce((n, f) => n + f.bytes, 0),
    artifactMaxBytes: 50 * 1024 * 1024,
    retentionDays: 1,
  }),
)

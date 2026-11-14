import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { stageVerifiedPlugins } from '../../scripts/ci/stage-public-plugin-check.mjs'

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'public-plugin-stage-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const checkout = path.join(root, 'checkout')
  const output = path.join(root, 'external')
  const destination = path.join(checkout, 'staged')
  const entry = {
    id: 'test.plugin',
    name: 'test.plugin-1.0.0.milkup-plugin',
    directory: 'plugins/test',
    host: 'worker',
    permissions: ['app:commands'],
  }
  const manifest = {
    id: entry.id,
    version: '1.0.0',
    host: entry.host,
    permissions: entry.permissions,
  }
  const bytes = Buffer.from(
    JSON.stringify({ format: 'milkup-plugin', version: 1, manifest, files: [] }),
  )
  await mkdir(path.join(checkout, entry.directory), { recursive: true })
  await mkdir(path.join(output, entry.id, 'dist'), { recursive: true })
  await writeFile(path.join(checkout, entry.directory, 'plugin.json'), JSON.stringify(manifest))
  await writeFile(path.join(output, entry.id, 'dist', entry.name), bytes)
  const proof = {
    status: 'passed',
    plugins: [
      {
        ...entry,
        build: 'passed',
        tests: 'passed',
        bytes: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      },
    ],
  }
  const saveProof = () => writeFile(path.join(output, 'verification.json'), JSON.stringify(proof))
  await saveProof()
  return { checkout, output, destination, entries: [entry], bytes, proof, saveProof }
}

test('stages only exact verified bytes', async (t) => {
  const f = await fixture(t)
  await stageVerifiedPlugins(f)
  assert.deepEqual(await readFile(path.join(f.destination, f.entries[0].name)), f.bytes)
})
for (const [name, corrupt] of [
  [
    'tampered bytes',
    async (f) => writeFile(path.join(f.output, f.entries[0].id, 'dist', f.entries[0].name), '{}'),
  ],
  [
    'duplicate inventory',
    async (f) => {
      f.proof.plugins.push(f.proof.plugins[0])
      await f.saveProof()
    },
  ],
  [
    'permission drift',
    async (f) => {
      f.proof.plugins[0].permissions = ['network:fetch']
      await f.saveProof()
    },
  ],
  [
    'failed proof',
    async (f) => {
      f.proof.status = 'failed'
      await f.saveProof()
    },
  ],
  [
    'failed plugin build',
    async (f) => {
      f.proof.plugins[0].build = 'failed'
      await f.saveProof()
    },
  ],
  [
    'failed plugin tests',
    async (f) => {
      f.proof.plugins[0].tests = 'failed'
      await f.saveProof()
    },
  ],
  [
    'archive manifest drift even with matching byte proof',
    async (f) => {
      const archive = JSON.parse(f.bytes.toString('utf8'))
      archive.manifest.host = 'dom'
      const bytes = Buffer.from(JSON.stringify(archive))
      await writeFile(path.join(f.output, f.entries[0].id, 'dist', f.entries[0].name), bytes)
      f.proof.plugins[0].bytes = bytes.length
      f.proof.plugins[0].sha256 = createHash('sha256').update(bytes).digest('hex')
      await f.saveProof()
    },
  ],
])
  test(`rejects ${name} before staging`, async (t) => {
    const f = await fixture(t)
    await corrupt(f)
    await assert.rejects(stageVerifiedPlugins(f))
    await assert.rejects(readdir(f.destination), { code: 'ENOENT' })
  })
test('validates the complete inventory before writing any earlier valid archive', async (t) => {
  const f = await fixture(t)
  const second = { ...f.entries[0], id: 'test.second', name: 'test.second-1.0.0.milkup-plugin' }
  f.entries.push(second)
  f.proof.plugins.push({ ...f.proof.plugins[0], ...second })
  await f.saveProof()
  // The first archive passes. The second is absent, so neither may be staged.
  await assert.rejects(stageVerifiedPlugins(f), { code: 'ENOENT' })
  await assert.rejects(readdir(f.destination), { code: 'ENOENT' })
})

test('rejects archive names that collide on Windows before any staging write', async (t) => {
  const f = await fixture(t)
  const second = { ...f.entries[0], id: 'test.second', name: f.entries[0].name.toUpperCase() }
  f.entries.push(second)
  f.proof.plugins.push({ ...f.proof.plugins[0], ...second })
  await f.saveProof()
  await assert.rejects(stageVerifiedPlugins(f), /Duplicate archive filename/)
  await assert.rejects(readdir(f.destination), { code: 'ENOENT' })
})

test('never overwrites an existing staged version', async (t) => {
  const f = await fixture(t)
  await mkdir(f.destination)
  const old = path.join(f.destination, 'old.milkup-plugin')
  await writeFile(old, 'old verified bytes')
  await assert.rejects(stageVerifiedPlugins(f), /must be empty/)
  assert.equal(await readFile(old, 'utf8'), 'old verified bytes')
  assert.deepEqual(await readdir(f.destination), ['old.milkup-plugin'])
})

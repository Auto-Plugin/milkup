import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { readLinkedGuiPluginInventory } from './read-linked-gui-plugin-inventory.mjs'

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex')
const candidateSha = 'a'.repeat(40),
  binarySha256 = 'b'.repeat(64)
async function fixture(t) {
  const checkout = await mkdtemp(path.join(tmpdir(), 'milkup-linked-inventory-'))
  t.after(() => rm(checkout, { recursive: true, force: true }))
  const write = async (name, value) => {
    const file = path.join(checkout, name)
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, JSON.stringify(value) + '\n')
  }
  await write('packages/plugin-sdk/package.json', { name: '@milkup/plugin-sdk', version: '1.0.0' })
  const distribution = ['diagrams', 'outline'].map((name) => ({
    directory: `plugins/${name}`,
    permissions: [],
    host: 'worker',
  }))
  // A non-Windows package must never enter the generated Windows inventory.
  distribution.push({
    directory: 'plugins/mac',
    permissions: [],
    host: 'worker',
    platforms: ['darwin'],
  })
  await write('release/bundled-plugins.json', distribution)
  for (const name of ['diagrams', 'outline']) {
    const manifest = {
      id: `milkup.${name}`,
      version: name === 'diagrams' ? '1.3.0' : '1.0.0',
      main: './dist/plugin.js',
      host: 'worker',
      permissions: [],
      engines: { pluginSdk: '^1.0.0' },
    }
    await write(`plugins/${name}/plugin.json`, manifest)
    await write(
      `apps/desktop/src/bundled-plugins/${manifest.id}-${manifest.version}.milkup-plugin`,
      { format: 'milkup-plugin', version: 1, manifest, files: [] },
    )
  }
  const read = () => readLinkedGuiPluginInventory({ checkout, candidateSha, binarySha256 })
  return { checkout, write, read }
}

test('linked inventory binds canonical Windows selection, generated archive bytes and source manifests', async (t) => {
  const f = await fixture(t),
    result = await f.read()
  assert.equal(result.candidateSha, candidateSha)
  assert.equal(result.binarySha256, binarySha256)
  assert.equal(result.platform, 'win32')
  assert.deepEqual(
    result.plugins.map(({ id, version }) => ({ id, version })),
    [
      { id: 'milkup.diagrams', version: '1.3.0' },
      { id: 'milkup.outline', version: '1.0.0' },
    ],
  )
  for (const item of result.plugins) {
    const bytes = await readFile(path.join(f.checkout, result.stagedSource, item.archiveFile))
    assert.equal(item.bytes, bytes.length)
    assert.equal(item.sha256, hash(bytes))
    assert.equal(
      item.sourceManifestSha256,
      hash(await readFile(path.join(f.checkout, 'plugins', item.id.split('.')[1], 'plugin.json'))),
    )
  }
})

test('linked inventory rejects unbuilt and additional generated archives', async (t) => {
  const f = await fixture(t)
  await rm(
    path.join(f.checkout, 'apps/desktop/src/bundled-plugins/milkup.outline-1.0.0.milkup-plugin'),
  )
  await assert.rejects(f.read, /exactly match/)
  await f.write('apps/desktop/src/bundled-plugins/unknown-1.0.0.milkup-plugin', {})
  await assert.rejects(f.read, /exactly match/)
})

test('linked inventory rejects stale manifest bytes even with the expected filename', async (t) => {
  const f = await fixture(t)
  const name = 'apps/desktop/src/bundled-plugins/milkup.diagrams-1.3.0.milkup-plugin'
  const value = JSON.parse(await readFile(path.join(f.checkout, name)))
  value.manifest.version = '1.2.0'
  await f.write(name, value)
  await assert.rejects(f.read, /deep-equal/)
})

test('linked inventory rejects duplicate canonical identities rather than hiding them', async (t) => {
  const f = await fixture(t)
  const name = 'plugins/outline/plugin.json'
  const value = JSON.parse(await readFile(path.join(f.checkout, name)))
  value.id = 'milkup.diagrams'
  await f.write(name, value)
  await assert.rejects(f.read, /Duplicate plugin identity/)
})

test('linked inventory does not guess source or binary identities', async (t) => {
  const f = await fixture(t)
  for (const change of [{ candidateSha: '' }, { binarySha256: 'unknown' }]) {
    await assert.rejects(() =>
      readLinkedGuiPluginInventory({ checkout: f.checkout, candidateSha, binarySha256, ...change }),
    )
  }
})

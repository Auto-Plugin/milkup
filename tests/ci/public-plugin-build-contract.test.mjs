import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { readPublicPluginBuildInputs } from '../../scripts/ci/public-plugin-build-contract.mjs'
async function fixture(t, version = '0.3.1') {
  const root = await mkdtemp(path.join(os.tmpdir(), 'milkup-public-sdk-input-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const write = async (file, value) => {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true })
    await writeFile(path.join(root, file), JSON.stringify(value))
  }
  await write('packages/plugin-sdk/package.json', { name: '@milkup/plugin-sdk', version })
  const inventory = [
    { directory: 'plugins/workspace', host: 'worker', permissions: ['workspace:read'] },
    { directory: 'plugins/preferences', host: 'worker', permissions: ['settings:write'] },
  ]
  await write('release/bundled-plugins.json', inventory)
  for (const item of inventory)
    await write(`${item.directory}/plugin.json`, {
      id: `milkup.${item.directory.split('/')[1]}`,
      version: '1.0.0',
      host: 'worker',
      main: './dist/plugin.js',
      permissions: item.permissions,
      engines: { pluginSdk: item.directory.endsWith('workspace') ? '^0.3.0' : '^0.3.1' },
    })
  return { root, write, inventory }
}
test('derives the current public SDK version and current local inventory without widening delivery approval', async (t) => {
  const f = await fixture(t)
  const input = await readPublicPluginBuildInputs(f.root)
  assert.equal(input.sdkVersion, '0.3.1')
  assert.ok(input.plugins.every((plugin) => plugin.buildMode === 'legacy-non-frozen'))
  assert.equal(input.sdkTarballName, 'milkup-plugin-sdk-0.3.1.tgz')
  assert.deepEqual(
    input.plugins.map((plugin) => plugin.id),
    ['milkup.preferences', 'milkup.workspace'],
  )
  await f.write('packages/plugin-sdk/package.json', {
    name: '@milkup/plugin-sdk',
    version: '0.3.2',
  })
  assert.equal(
    (await readPublicPluginBuildInputs(f.root)).sdkTarballName,
    'milkup-plugin-sdk-0.3.2.tgz',
  )
})
test('rejects unsafe or partial SDK versions before constructing the tarball path', async (t) => {
  for (const version of ['0.3', '../0.3.1', '0.3.1/secret', '0.03.1', '*']) {
    const f = await fixture(t, version)
    await assert.rejects(readPublicPluginBuildInputs(f.root))
  }
})
test('rejects directory escape, duplicate inventory and undeclared permission drift', async (t) => {
  const f = await fixture(t)
  await f.write('release/bundled-plugins.json', [{ directory: '../outside', permissions: [] }])
  await assert.rejects(readPublicPluginBuildInputs(f.root), /Unsafe plugin directory/)
  await f.write('release/bundled-plugins.json', [f.inventory[0], f.inventory[0]])
  await assert.rejects(readPublicPluginBuildInputs(f.root), /Duplicate plugin directory/)
  await f.write('release/bundled-plugins.json', [
    { ...f.inventory[0], permissions: ['file:write'] },
  ])
  await assert.rejects(readPublicPluginBuildInputs(f.root), /permission mismatch/)
})

test('includes declared resources for external builds and rejects traversal', async (t) => {
  const f = await fixture(t)
  const manifest = {
    id: 'milkup.workspace',
    version: '1.0.0',
    host: 'worker',
    main: './dist/plugin.js',
    permissions: ['workspace:read'],
    engines: { pluginSdk: '^0.3.0' },
    resources: ['assets/workspace.png'],
  }
  await f.write('plugins/workspace/assets/workspace.png', 'local fixture')
  await f.write('plugins/workspace/plugin.json', manifest)
  const input = await readPublicPluginBuildInputs(f.root)
  assert.deepEqual(input.plugins.find((plugin) => plugin.id === 'milkup.workspace').resources, [
    'assets/workspace.png',
  ])
  await f.write('plugins/workspace/plugin.json', { ...manifest, resources: ['../private.png'] })
  await assert.rejects(readPublicPluginBuildInputs(f.root), /Unsafe plugin resource/)
})

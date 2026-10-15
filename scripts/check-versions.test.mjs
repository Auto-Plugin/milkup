import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, copyFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

test('version gate rejects drift and synchronizes derived application versions only', async () => {
  const root = await mkdtemp(join(tmpdir(), 'milkup-version-'))
  try {
    for (const directory of [
      'scripts',
      'apps/desktop/src-tauri',
      'packages/plugin-sdk',
      'tests/regressions',
      'plugins/outline',
      'release',
    ])
      await mkdir(join(root, directory), { recursive: true })
    const json = async (path, value) => writeFile(join(root, path), JSON.stringify(value))
    await copyFile(
      new URL('./check-versions.mjs', import.meta.url),
      join(root, 'scripts/check-versions.mjs'),
    )
    await json('package.json', { version: '2.0.0-beta.1' })
    await json('apps/desktop/package.json', { version: '0.1.0' })
    await json('tests/regressions/package.json', { version: '0.0.0' })
    await json('packages/plugin-sdk/package.json', { version: '0.1.1' })
    await json('plugins/outline/package.json', { version: '1.3.0' })
    await json('plugins/outline/plugin.json', { version: '1.3.0', engines: { milkup: '^2.0.0-0' } })
    await json('release/update-channel.json', { channel: 'beta' })
    await json('apps/desktop/src-tauri/tauri.conf.json', { version: '../../../package.json' })
    await writeFile(
      join(root, 'apps/desktop/src-tauri/Cargo.toml'),
      '[package]\nname = "test"\nversion = "0.1.0"\n',
    )
    const run = (...args) =>
      spawnSync(process.execPath, ['scripts/check-versions.mjs', ...args], {
        cwd: root,
        encoding: 'utf8',
      })
    assert.notEqual(run().status, 0)
    assert.equal(run('--write').status, 0)
    assert.equal(run().status, 0)
    assert.equal(
      JSON.parse(await readFile(join(root, 'packages/plugin-sdk/package.json'))).version,
      '0.1.1',
    )
    assert.equal(
      JSON.parse(await readFile(join(root, 'plugins/outline/package.json'))).version,
      '1.3.0',
    )
    await json('release/update-channel.json', { channel: 'stable' })
    assert.notEqual(run().status, 0)
    await json('release/update-channel.json', { channel: 'beta' })
    await json('apps/desktop/src-tauri/tauri.conf.json', { version: '0.1.0' })
    assert.notEqual(run().status, 0)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

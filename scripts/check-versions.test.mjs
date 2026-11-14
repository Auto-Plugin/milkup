import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, copyFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

async function fixture(check) {
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
      '[package]\nname = "milkup-desktop"\nversion = "0.1.0"\n',
    )
    const lock =
      '# Generated lockfile\nversion = 4\n\n[[package]]\nname = "milkup-desktop"\nversion = "0.1.0"\ndependencies = ["other"]\n\n[[package]]\nname = "other"\nversion = "0.1.0"\nsource = "registry+https://example.test/index"\nchecksum = "preserve-me"\n'
    await writeFile(join(root, 'apps/desktop/src-tauri/Cargo.lock'), lock)
    const run = (...args) =>
      spawnSync(process.execPath, ['scripts/check-versions.mjs', ...args], {
        cwd: root,
        encoding: 'utf8',
      })
    await check({ root, json, run, lock })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

test('version gate rejects drift and synchronizes derived application versions only', async () => {
  await fixture(async ({ root, json, run }) => {
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
  })
})

test('version gate rejects noncanonical application versions before writing', async () => {
  await fixture(async ({ root, json, run }) => {
    for (const version of [
      '2.00.01',
      '2.01.0-beta.1',
      '2.0.01',
      '2.0.0-beta.01',
      '2.0.0-beta.1\n',
    ]) {
      await json('package.json', { version })
      await json('release/update-channel.json', {
        channel: version.includes('-') ? 'beta' : 'stable',
      })
      const before = await readFile(join(root, 'apps/desktop/src-tauri/Cargo.toml'), 'utf8')
      const result = run('--write')
      assert.notEqual(result.status, 0, `must reject ${JSON.stringify(version)}`)
      assert.match(result.stderr, /complete 2.x stable or beta version/)
      assert.equal(await readFile(join(root, 'apps/desktop/src-tauri/Cargo.toml'), 'utf8'), before)
    }
  })
})

test('version sync updates only the unique local Cargo package and the check detects lock drift', async () => {
  await fixture(async ({ root, run, lock }) => {
    assert.equal(run('--write').status, 0)
    const path = join(root, 'apps/desktop/src-tauri/Cargo.lock')
    const expected = lock.replace(
      'name = "milkup-desktop"\nversion = "0.1.0"',
      'name = "milkup-desktop"\nversion = "2.0.0-beta.1"',
    )
    assert.equal(await readFile(path, 'utf8'), expected)
    await writeFile(path, lock)
    const result = run()
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /Cargo.lock/)
    assert.equal(await readFile(path, 'utf8'), lock)
    assert.equal(run('--write').status, 0)
    assert.equal(run().status, 0)
  })
})

test('version sync refuses missing, duplicate or nonlocal application lock entries', async () => {
  await fixture(async ({ root, run, lock }) => {
    const path = join(root, 'apps/desktop/src-tauri/Cargo.lock')
    for (const invalid of [
      lock.replace('name = "milkup-desktop"', 'name = "unrelated"'),
      lock + '\n[[package]]\nname = "milkup-desktop"\nversion = "0.1.0"\n',
      lock.replace(
        'dependencies =',
        'source = "registry+https://example.test/index"\ndependencies =',
      ),
    ]) {
      await writeFile(path, invalid)
      const result = run('--write')
      assert.notEqual(result.status, 0)
      assert.match(result.stderr, /Cargo.lock/)
      assert.equal(await readFile(path, 'utf8'), invalid)
    }
  })
})

test('version sync supports canonical beta and stable versions without rewriting SDK or plugins', async () => {
  await fixture(async ({ root, json, run }) => {
    for (const version of ['2.0.0-beta.0', '2.0.0-beta.10', '2.0.0', '2.12.34']) {
      await json('package.json', { version })
      await json('release/update-channel.json', {
        channel: version.includes('-') ? 'beta' : 'stable',
      })
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
    }
  })
})

test('version sync preserves Cargo.lock CRLF and unrelated bytes', async () => {
  await fixture(async ({ root, run, lock }) => {
    const path = join(root, 'apps/desktop/src-tauri/Cargo.lock')
    const crlf = lock.replaceAll('\n', '\r\n')
    await writeFile(path, crlf)
    assert.equal(run('--write').status, 0)
    assert.equal(
      await readFile(path, 'utf8'),
      crlf.replace(
        'name = "milkup-desktop"\r\nversion = "0.1.0"',
        'name = "milkup-desktop"\r\nversion = "2.0.0-beta.1"',
      ),
    )
    assert.equal(run().status, 0)
  })
})

test('version sync refuses missing or duplicate package versions without rewriting dependency tables', async () => {
  await fixture(async ({ root, run }) => {
    const path = join(root, 'apps/desktop/src-tauri/Cargo.toml')
    for (const cargo of [
      '[package]\nname = "milkup-desktop"\n\n[dependencies.example]\nversion = "1.2.3"\n',
      '[package]\nname = "milkup-desktop"\n\n  [dependencies.example]\nversion = "1.2.3"\n',
      '[package]\nname = "milkup-desktop"\n\n\t[dependencies.example]\nversion = "1.2.3"\n',
      '[package]\nname = "milkup-desktop"\nversion = "0.1.0"\nversion = "0.2.0"\n',
      '[package]\nname = "milkup-desktop"\nversion = "0.1.0"\n\n[package]\nversion = "0.2.0"\n',
    ]) {
      await writeFile(path, cargo)
      const result = run('--write')
      assert.notEqual(result.status, 0)
      assert.match(result.stderr, /Cargo.toml/)
      assert.equal(await readFile(path, 'utf8'), cargo)
    }
  })
})

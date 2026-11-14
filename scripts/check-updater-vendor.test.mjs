import test from 'node:test'
import assert from 'node:assert/strict'
import { cp, mkdtemp, readFile, writeFile, rm, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { checkUpdaterVendor } from './check-updater-vendor.mjs'

test('reviewed updater source, licenses and unchanged dependency closure pass', async () => {
  assert.equal((await checkUpdaterVendor()).version, '2.10.1')
})

test('updater provenance gate rejects source, license, extra file and lock drift', async () => {
  const root = await mkdtemp(join(tmpdir(), 'milkup-updater-vendor-'))
  try {
    await cp(resolve('vendor/tauri-plugin-updater'), join(root, 'vendor/tauri-plugin-updater'), {
      recursive: true,
    })
    await mkdir(join(root, 'apps/desktop/src-tauri'), { recursive: true })
    for (const name of ['Cargo.toml', 'Cargo.lock'])
      await cp(resolve('apps/desktop/src-tauri', name), join(root, 'apps/desktop/src-tauri', name))
    for (const name of ['src/windows_install.rs', 'LICENSE_MIT']) {
      const path = join(root, 'vendor/tauri-plugin-updater', name)
      const original = await readFile(path)
      await writeFile(path, 'changed')
      await assert.rejects(checkUpdaterVendor(root), /hash mismatch/)
      await writeFile(path, original)
    }
    const extra = join(root, 'vendor/tauri-plugin-updater/src/unreviewed.rs')
    await writeFile(extra, '// unexpected implementation')
    await assert.rejects(checkUpdaterVendor(root), /Unexpected vendor file/)
    await rm(extra)
    const path = join(root, 'apps/desktop/src-tauri/Cargo.lock')
    const original = await readFile(path, 'utf8')
    await writeFile(
      path,
      original.replace(
        'name = "tauri-plugin-updater"',
        'name = "tauri-plugin-updater"\nsource = "registry+https://github.com/rust-lang/crates.io-index"',
      ),
    )
    await assert.rejects(checkUpdaterVendor(root), /Cargo.lock/)
    await writeFile(path, original)
    assert.equal((await checkUpdaterVendor(root)).version, '2.10.1')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

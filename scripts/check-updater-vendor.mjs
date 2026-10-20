import { createHash } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')

export async function checkUpdaterVendor(root = repo) {
  const directory = resolve(root, 'vendor/tauri-plugin-updater')
  const provenance = JSON.parse(
    await readFile(resolve(directory, 'MILKUP-PROVENANCE.json'), 'utf8'),
  )
  if (provenance.upstream.version !== '2.10.1') throw Error('Unexpected upstream updater version')
  const knownChanges = new Set(['src/lib.rs', 'src/updater.rs'])
  for (const [path, original] of Object.entries(provenance.upstream.files)) {
    if (!knownChanges.has(path) && provenance.files[path] !== original)
      throw Error(`Unreviewed upstream modification: ${path}`)
  }
  const allowed = new Set([
    ...Object.keys(provenance.files),
    'MILKUP-PROVENANCE.json',
    'MILKUP-PATCH.md',
  ])
  async function walk(relative = '') {
    for (const entry of await readdir(resolve(directory, relative), { withFileTypes: true })) {
      const path = relative ? `${relative}/${entry.name}` : entry.name
      if (entry.isDirectory()) await walk(path)
      else if (!entry.isFile() || !allowed.has(path)) throw Error(`Unexpected vendor file: ${path}`)
    }
  }
  await walk()
  for (const [path, expected] of Object.entries(provenance.files)) {
    if (sha256(await readFile(resolve(directory, path))) !== expected)
      throw Error(`Updater vendor hash mismatch: ${path}`)
  }
  const cargo = await readFile(resolve(root, 'apps/desktop/src-tauri/Cargo.toml'), 'utf8')
  if (!cargo.includes('tauri-plugin-updater = "=2.10.1"'))
    throw Error('Updater version must remain pinned')
  if (
    !/\[patch\.crates-io\]\s+tauri-plugin-updater = \{ path = "\.\.\/\.\.\/\.\.\/vendor\/tauri-plugin-updater" \}/.test(
      cargo,
    )
  )
    throw Error('Updater must resolve to the reviewed local patch')
  const lock = await readFile(resolve(root, 'apps/desktop/src-tauri/Cargo.lock'), 'utf8')
  const entries = lock
    .split(/(?=^\[\[package\]\])/m)
    .filter((entry) => /^name = "tauri-plugin-updater"\r?$/m.test(entry))
  if (
    entries.length !== 1 ||
    !/^version = "2.10.1"\r?$/m.test(entries[0]) ||
    /^(source|checksum) =/m.test(entries[0])
  )
    throw Error('Cargo.lock must select the local updater patch exactly once')
  const dependencies = entries[0].match(/dependencies = (\[[\s\S]*?\])/m)?.[1]
  const names = dependencies
    ? [...dependencies.matchAll(/"([^"]+)"/g)].map((match) => match[1])
    : []
  if (JSON.stringify(names) !== JSON.stringify(provenance.lockedDependencies))
    throw Error('Updater dependency closure changed')
  return { version: '2.10.1', files: Object.keys(provenance.files).length }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await checkUpdaterVendor()
  console.log(`Reviewed local updater ${result.version}: ${result.files} file hashes verified`)
}

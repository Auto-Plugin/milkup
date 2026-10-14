import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

const originalMarker = Buffer.from('__TAURI_BUNDLE_TYPE_VAR_UNK')
const nsisMarker = Buffer.from('__TAURI_BUNDLE_TYPE_VAR_NSS')
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex')
const maxBinaryBytes = 64 * 1024 * 1024

// tauri-cli 2.11.4 locks tauri-bundler 2.9.4. That bundler patches this
// marker before NSIS packaging, then restores the original build output.
// Compare the complete expected bytes; do not ignore an arbitrary byte range.
export function verifyInstalledBinary(built, installed) {
  assert(built.length <= maxBinaryBytes && installed.length <= maxBinaryBytes)
  assert.equal(installed.length, built.length, 'Installed binary length changed')
  const offset = built.indexOf(originalMarker)
  assert(offset >= 0, 'Expected Tauri unbundled marker is missing')
  assert.equal(built.indexOf(originalMarker, offset + 1), -1, 'Ambiguous bundle marker')
  const expected = Buffer.from(built)
  nsisMarker.copy(expected, offset)
  const result = {
    bytes: installed.length,
    builtSha256: hash(built),
    expectedInstalledSha256: hash(expected),
    installedSha256: hash(installed),
    bundleMarkerOffset: offset,
    transformation: '__TAURI_BUNDLE_TYPE_VAR_UNK -> __TAURI_BUNDLE_TYPE_VAR_NSS',
    bundlerVersion: '2.9.4',
  }
  assert(installed.equals(expected), `Unexpected installed bytes: ${JSON.stringify(result)}`)
  return { status: 'passed', ...result }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    assert.equal(process.argv.length, 4, 'Provide built and installed executable paths')
    const paths = process.argv.slice(2)
    for (const file of paths)
      assert((await stat(file)).size <= maxBinaryBytes, 'Binary exceeds 64 MiB verification budget')
    const [built, installed] = await Promise.all(paths.map((file) => readFile(file)))
    console.log(JSON.stringify(verifyInstalledBinary(built, installed), null, 2))
  } catch (error) {
    console.log(JSON.stringify({ status: 'failed', error: String(error) }, null, 2))
    process.exitCode = 1
  }
}

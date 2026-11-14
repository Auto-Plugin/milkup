import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const originalToken = Buffer.from('__TAURI_BUNDLE_TYPE_VAR_UNK')
const nsisToken = Buffer.from('__TAURI_BUNDLE_TYPE_VAR_NSS')
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')
// Tauri CLI 2.11.4 patches this token for NSIS and restores the original EXE
// afterwards. Model only that exact transformation, never normalize a payload.
// https://github.com/tauri-apps/tauri/blob/tauri-cli-v2.11.4/crates/tauri-bundler/src/bundle.rs
export function expectedNsisImage(compiled) {
  const offset = compiled.indexOf(originalToken)
  assert.ok(offset >= 0, 'Missing original Tauri bundle marker')
  assert.equal(compiled.indexOf(originalToken, offset + 1), -1, 'Ambiguous bundle marker')
  const expected = Buffer.from(compiled)
  nsisToken.copy(expected, offset)
  return { expected, offset }
}

export async function verifyNsisImage(compiledPath, inspection, evidencePath) {
  const compiled = await readFile(compiledPath)
  const { expected, offset } = expectedNsisImage(compiled)
  const files = []
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name)
      if (entry.isDirectory()) await walk(file)
      else {
        assert.ok(entry.isFile(), 'Unexpected extracted entry type')
        const bytes = await readFile(file)
        files.push({
          path: file,
          relativePath: path.relative(inspection, file),
          bytes: bytes.length,
          sha256: sha256(bytes),
          exactMatch: bytes.equals(expected),
        })
      }
    }
  }
  await walk(inspection)
  const matches = files.filter((file) => file.exactMatch)
  // Do not publish passed evidence if the compiled input changed during inspection.
  assert.deepEqual(await readFile(compiledPath), compiled)
  const evidence = {
    status: matches.length === 1 ? 'passed' : 'failed',
    transform: 'tauri-cli-2.11.4-unique-UNK-to-NSS',
    compiledSha256: sha256(compiled),
    expectedNsisSha256: sha256(expected),
    markerOffset: offset,
    changedBytes: 3,
    path: matches.length === 1 ? matches[0].path : null,
    files,
  }
  await writeFile(evidencePath, JSON.stringify(evidence, null, 2) + '\n', { flag: 'wx' })
  console.log(JSON.stringify(evidence))
  assert.equal(matches.length, 1, 'Expected exactly one byte-identical NSIS application image')
  return evidence
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  assert.equal(process.argv.length, 5, 'compiled-image inspection-directory evidence-json required')
  await verifyNsisImage(...process.argv.slice(2))
}

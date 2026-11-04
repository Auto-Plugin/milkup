import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, readdir, realpath } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { publicBuildFile, readPublicPluginBuildInputs } from './public-plugin-build-contract.mjs'

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex')
const script = fileURLToPath(import.meta.url)

// Read-only source evidence for a linked-binary GUI run. This inventory does not
// authorize plugins or substitute for installer/embedded-byte verification.
export async function readLinkedGuiPluginInventory({ checkout, candidateSha, binarySha256 }) {
  assert.match(candidateSha, /^[a-f0-9]{40}$/)
  assert.match(binarySha256, /^[a-f0-9]{64}$/)
  checkout = await realpath(checkout)
  const { plugins: expected } = await readPublicPluginBuildInputs(checkout, { platform: 'win32' })
  assert(expected.length > 0 && expected.length <= 32)
  const canonicalSource = 'release/bundled-plugins.json'
  const stagedSource = 'apps/desktop/src/bundled-plugins'
  const stagedRoot = path.join(checkout, stagedSource)
  assert.deepEqual(
    (await readdir(stagedRoot)).sort(),
    expected.map((item) => item.name).sort(),
    'Generated archives must exactly match the canonical Windows distribution',
  )
  const plugins = []
  for (const item of expected) {
    const source = await publicBuildFile(checkout, `${item.directory}/plugin.json`)
    const archive = await publicBuildFile(stagedRoot, item.name)
    const value = JSON.parse(archive.bytes.toString('utf8'))
    assert.equal(value.format, 'milkup-plugin')
    assert.equal(value.version, 1)
    assert.deepEqual(value.manifest, JSON.parse(source.bytes.toString('utf8')))
    assert.equal(value.manifest.host, 'worker', 'Only the canonical Windows Worker inventory')
    plugins.push({
      id: item.id,
      version: item.version,
      archiveFile: item.name,
      bytes: archive.bytes.length,
      sha256: hash(archive.bytes),
      sourceManifestSha256: hash(source.bytes),
    })
  }
  assert.equal(
    plugins.filter((item) => item.id === 'milkup.diagrams' && item.version === '1.3.0').length,
    1,
    'Exact reviewed Mermaid identity is required',
  )
  return {
    schema: 1,
    kind: 'linked-gui-source-inventory',
    candidateSha,
    binarySha256,
    platform: 'win32',
    canonicalSource,
    stagedSource,
    canonicalSourceSha256: hash((await publicBuildFile(checkout, canonicalSource)).bytes),
    producerSha256: hash(await readFile(script)),
    plugins,
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === script) {
  assert.equal(process.argv.length, 4, 'Expected exact candidate SHA and compiled binary SHA256')
  const record = await readLinkedGuiPluginInventory({
    checkout: path.resolve(path.dirname(script), '../..'),
    candidateSha: process.argv[2],
    binarySha256: process.argv[3],
  })
  process.stdout.write(JSON.stringify(record) + '\n')
}

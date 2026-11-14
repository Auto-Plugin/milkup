import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { expectedNsisImage, verifyNsisImage } from './verify-nsis-image.mjs'

const fixture = Buffer.from('synthetic-header\0__TAURI_BUNDLE_TYPE_VAR_UNK\0unchanged-tail')

test('requires one original bundle marker and does not mutate input', () => {
  const original = Buffer.from(fixture)
  const { expected } = expectedNsisImage(fixture)
  assert.deepEqual(fixture, original)
  assert.equal(expected.toString(), original.toString().replace('_VAR_UNK', '_VAR_NSS'))
  assert.throws(() => expectedNsisImage(Buffer.from('no marker')), /Missing/)
  assert.throws(() => expectedNsisImage(Buffer.concat([fixture, fixture])), /Ambiguous/)
})

for (const variant of ['exact', 'extra-byte-change', 'truncated', 'wrong-marker', 'duplicate']) {
  test(`NSIS image comparison: ${variant}`, async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'milkup-nsis-proof-'))
    try {
      const compiled = path.join(root, 'compiled.exe')
      const inspection = path.join(root, 'inspection')
      const evidence = path.join(root, 'evidence.json')
      await mkdir(inspection)
      await writeFile(compiled, fixture)
      let { expected } = expectedNsisImage(fixture)
      if (variant === 'extra-byte-change') expected[0] ^= 1
      if (variant === 'truncated') expected = expected.subarray(0, -1)
      if (variant === 'wrong-marker') expected = fixture
      // NSIS extraction filenames are not an identity proof; compare all bytes.
      await writeFile(path.join(inspection, '$R0'), expected)
      await writeFile(path.join(inspection, 'unrelated.dll'), 'different bytes')
      if (variant === 'duplicate') await writeFile(path.join(inspection, 'duplicate.exe'), expected)
      if (variant === 'exact') {
        const proof = await verifyNsisImage(compiled, inspection, evidence)
        assert.equal(proof.status, 'passed')
        assert.notEqual(proof.compiledSha256, proof.expectedNsisSha256)
        assert.equal(proof.files.filter((file) => file.exactMatch).length, 1)
      } else {
        await assert.rejects(verifyNsisImage(compiled, inspection, evidence), /exactly one/)
        assert.equal(JSON.parse(await readFile(evidence, 'utf8')).status, 'failed')
      }
      assert.deepEqual(await readFile(compiled), fixture)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
}

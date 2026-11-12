import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { verifyCandidate } from './verify-candidate.mjs'
test('installer receipt binds exact source, variant, file bytes, and local filename', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'milkup-receipt-'))
  const sha = 'a'.repeat(40),
    bytes = Buffer.from('fixture bytes, never an executable')
  const name = `milkup-2.0.0-beta.10-windows-standard-${sha.slice(0, 12)}.exe`
  const receipt = {
    schema: 1,
    status: 'built-not-installed',
    sourceSha: sha,
    variant: 'windows-standard',
    architecture: 'x86_64',
    signed: false,
    releasePublished: false,
    version: '2.0.0-beta.10',
    installer: {
      name,
      bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    },
  }
  const save = () => writeFile(path.join(dir, 'manifest.json'), JSON.stringify(receipt))
  try {
    await writeFile(path.join(dir, name), bytes)
    await save()
    assert.equal(
      (await verifyCandidate(dir, sha, 'windows-standard')).installer.path,
      path.join(dir, name),
    )
    await assert.rejects(verifyCandidate(dir, 'b'.repeat(40), 'windows-standard'))
    await assert.rejects(verifyCandidate(dir, sha, 'windows-offline'))
    await writeFile(path.join(dir, name), Buffer.alloc(bytes.length, 42))
    await assert.rejects(verifyCandidate(dir, sha, 'windows-standard'))
    await writeFile(path.join(dir, name), bytes)
    receipt.installer.name = '../outside.exe'
    await save()
    await assert.rejects(verifyCandidate(dir, sha, 'windows-standard'))
    receipt.installer.name = name
    receipt.installer.bytes++
    await save()
    await assert.rejects(verifyCandidate(dir, sha, 'windows-standard'))
    receipt.installer.bytes--
    await save()
    await rm(path.join(dir, name))
    await symlink(path.join(dir, 'manifest.json'), path.join(dir, name))
    await assert.rejects(verifyCandidate(dir, sha, 'windows-standard'))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPairSync, randomBytes } from 'node:crypto'
import { mkdtemp, writeFile, readFile, rm, access } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { seal, unseal } from '../../scripts/ci/seal-etw.mjs'
import { relay } from '../../scripts/ci/relay-etw-key.mjs'
test('sealed trace roundtrip and tampering/truncation never publish plaintext', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'milkup-etw-test-'))
  try {
    const { publicKey, privateKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    })
    const pub = path.join(root, 'public'),
      priv = path.join(root, 'private'),
      raw = path.join(root, 'raw'),
      enc = path.join(root, 'sealed'),
      out = path.join(root, 'out')
    await writeFile(pub, publicKey)
    await writeFile(priv, privateKey)
    const bytes = randomBytes(1024 * 1024 + 73)
    await writeFile(raw, bytes)
    await seal(raw, pub, enc)
    await unseal(enc, priv, out)
    assert.deepEqual(await readFile(out), bytes)
    await assert.rejects(unseal(enc, priv, out))
    assert.deepEqual(await readFile(out), bytes)
    const conflict = path.join(root, 'conflict')
    await writeFile(conflict + '.partial', 'keep existing')
    await assert.rejects(unseal(enc, priv, conflict))
    assert.equal(await readFile(conflict + '.partial', 'utf8'), 'keep existing')
    const receiver = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    })
    const receiverPub = path.join(root, 'receiver.pub'),
      receiverPriv = path.join(root, 'receiver.key'),
      envelope = path.join(root, 'envelope')
    await writeFile(receiverPub, receiver.publicKey)
    await writeFile(receiverPriv, receiver.privateKey)
    await relay(enc, priv, receiverPub, envelope, '43513112486')
    await unseal(enc, receiverPriv, path.join(root, 'relayed'), envelope)
    assert.deepEqual(await readFile(path.join(root, 'relayed')), bytes)
    await assert.rejects(unseal(enc, priv, path.join(root, 'wrong-recipient'), envelope))
    for (const kind of ['cipher', 'header', 'truncate']) {
      const b = await readFile(enc)
      if (kind === 'cipher') b[b.length - 20] ^= 1
      if (kind === 'header') b[35] ^= 1
      const corrupt = path.join(root, kind)
      await writeFile(corrupt, kind === 'truncate' ? b.subarray(0, -1) : b)
      await assert.rejects(unseal(corrupt, priv, corrupt + '.out'))
      await assert.rejects(access(corrupt + '.out'))
      await assert.rejects(access(corrupt + '.out.partial'))
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

import { createHash, generateKeyPairSync, sign } from 'node:crypto'

// Ephemeral in-memory test material only. Never written to disk, exported as a
// usable key, or used by the product/release configuration.
export function signedFixture({ artifact = Buffer.from('not an executable') } = {}) {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  const keyId = Buffer.alloc(8, 7)
  const encodedKey = Buffer.concat([
    Buffer.from('Ed'),
    keyId,
    publicKey.export({ format: 'der', type: 'spki' }).subarray(-32),
  ])
  const config = {
    channel: 'beta',
    endpoints: ['https://updates.milkup.com/beta.json'],
    publicKey: Buffer.from(
      `untrusted comment: ephemeral unit test\n${encodedKey.toString('base64')}`,
    ).toString('base64'),
  }
  const signature = (bytes) => {
    const sig = sign(null, createHash('blake2b512').update(bytes).digest(), privateKey)
    const comment = 'unit test only'
    return Buffer.from(
      `untrusted comment: unit test\n${Buffer.concat([Buffer.from('ED'), keyId, sig]).toString('base64')}\ntrusted comment: ${comment}\n${sign(null, Buffer.concat([sig, Buffer.from(comment)]), privateKey).toString('base64')}`,
    ).toString('base64')
  }
  const statement = {
    schema: 1,
    product: 'milkup-desktop',
    channel: 'beta',
    release: {
      version: '2.0.0-beta.10',
      notes: 'Unit test',
      milkup: { sequence: 2, issuedAt: 1000, expiresAt: 2000 },
      platforms: {
        'windows-x86_64': {
          url: 'https://updates.milkup.com/candidate.exe',
          signature: signature(artifact),
        },
      },
    },
  }
  const envelope = () => {
    const payload = Buffer.from(JSON.stringify(statement))
    return Buffer.from(
      JSON.stringify({ payload: payload.toString('base64'), signature: signature(payload) }),
    )
  }
  return { config, artifact, statement, envelope }
}

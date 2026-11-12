import assert from 'node:assert/strict'
import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { candidateConfig, extractPngIcon, variants } from './build-candidate.mjs'
import { checkChannel, checkSignedRelease, verifyMinisign } from './update-readiness.mjs'

const fixture = JSON.parse(
  await readFile(new URL('../../tests/fixtures/updates/signed-manifest.json', import.meta.url)),
)
const empty = { channel: 'beta', endpoints: [], publicKey: null }
test('unconfigured candidate is explicit, never production-ready', () => {
  assert.deepEqual(checkChannel(empty), { configured: false, channel: 'beta' })
  assert.throws(() => checkChannel(empty, { requireConfigured: true }), /not configured/)
})
test('real minisign fixtures verify, tampered bytes/signature do not', () => {
  const bytes = Buffer.from(fixture.artifact, 'base64')
  verifyMinisign(bytes, fixture.artifactSignature, fixture.publicKey)
  verifyMinisign(
    Buffer.from(fixture.envelopes.valid.payload, 'base64'),
    fixture.envelopes.valid.signature,
    fixture.publicKey,
  )
  assert.throws(
    () =>
      verifyMinisign(
        Buffer.concat([bytes, Buffer.from('x')]),
        fixture.artifactSignature,
        fixture.publicKey,
      ),
    /Invalid content/,
  )
  assert.throws(
    () => verifyMinisign(bytes, fixture.oldArtifactSignature, fixture.publicKey),
    /Invalid content/,
  )
})
test('public synthetic fixture key cannot become production trust root even with renamed comment', () => {
  const renamed = Buffer.from(
    Buffer.from(fixture.publicKey, 'base64')
      .toString()
      .replace(/^[^\n]+/, 'untrusted comment: production'),
  ).toString('base64')
  for (const publicKey of [fixture.publicKey, renamed])
    assert.throws(
      () =>
        checkChannel({ ...empty, endpoints: ['https://updates.milkup.com/beta.json'], publicKey }),
      /synthetic/,
    )
})
// Ephemeral in-memory test material only. Never written to disk, exported as a
// usable key, or used by the product/release configuration.
function signedFixture() {
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
  const artifact = Buffer.from('not an executable')
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
test('offline release preflight binds bytes, version, target, policy and channel', () => {
  const f = signedFixture()
  const check = (now = 1500) =>
    checkSignedRelease(f.envelope(), f.config, f.artifact, 'windows-x86_64', '2.0.0-beta.10', now)
  assert.equal(check().status, 'signed-by-configured-key')
  assert.throws(() => check(2000), /not currently valid/)
  assert.throws(() => check(600), /not currently valid/)
  f.statement.release.version = '2.0.0-beta.9'
  assert.throws(check, /version differs/)
  f.statement.release.version = '2.0.0-beta.10'
  f.statement.channel = 'stable'
  assert.throws(check)
  f.statement.channel = 'beta'
  f.artifact = Buffer.from('replacement')
  assert.throws(check, /Invalid content/)
})
test('malformed/partial configs and unsafe URLs fail closed', () => {
  const { config } = signedFixture()
  for (const endpoints of [
    [],
    ['http://updates.milkup.com/a'],
    ['https://u:p@updates.milkup.com/a'],
    ['https://example.invalid/a'],
    ['https://updates.milkup.com/a#ignored'],
    [config.endpoints[0], config.endpoints[0]],
  ]) {
    assert.throws(() => checkChannel({ ...config, endpoints }))
  }
  assert.throws(() => checkChannel({ ...empty, surprise: true }))
  assert.throws(() => checkChannel({ ...config, publicKey: 'private key' }))
})
test('three native variants have explicit runtime policy and never auto-sign', () => {
  assert.equal(Object.keys(variants).length, 3)
  assert.equal(
    candidateConfig('windows-standard').bundle.windows.webviewInstallMode.type,
    'downloadBootstrapper',
  )
  assert.equal(
    candidateConfig('windows-offline').bundle.windows.webviewInstallMode.type,
    'offlineInstaller',
  )
  assert.equal(candidateConfig('windows-offline').bundle.windows.nsis.installMode, 'currentUser')
  assert.deepEqual(candidateConfig('linux-deb').bundle.targets, ['deb'])
  for (const variant of Object.keys(variants))
    assert.equal(candidateConfig(variant).bundle.createUpdaterArtifacts, false)
  assert.throws(() => candidateConfig('macos'))
})
test('Linux icon is lossless largest existing ICO PNG, not a substituted logo', async () => {
  const ico = await readFile(
    new URL('../../apps/desktop/src-tauri/icons/icon.ico', import.meta.url),
  )
  const png = await readFile(
    new URL('../../apps/desktop/src-tauri/icons/icon.png', import.meta.url),
  )
  assert.deepEqual(extractPngIcon(ico), png)
  assert.equal(png.readUInt32BE(16), 256)
  assert.equal(png.readUInt32BE(20), 256)
  assert.throws(() => extractPngIcon(ico.subarray(0, 20)))
})

test('authenticated metadata still fails invalid policy, target, URL and oversized input', () => {
  for (const mutate of [
    (s) => {
      s.release.milkup.sequence = 0
    },
    (s) => {
      s.release.milkup.expiresAt = 1000 + 8 * 86400
    },
    (s) => {
      delete s.release.platforms['windows-x86_64']
    },
    (s) => {
      s.release.platforms['windows-x86_64'].url = 'http://updates.milkup.com/package'
    },
    (s) => {
      s.product = 'other-app'
    },
    (s) => {
      s.unknown = true
    },
  ]) {
    const f = signedFixture()
    mutate(f.statement)
    assert.throws(() =>
      checkSignedRelease(
        f.envelope(),
        f.config,
        f.artifact,
        'windows-x86_64',
        '2.0.0-beta.10',
        1500,
      ),
    )
  }
  const f = signedFixture()
  assert.throws(
    () =>
      checkSignedRelease(
        Buffer.alloc(256 * 1024 + 1),
        f.config,
        f.artifact,
        'windows-x86_64',
        '2.0.0-beta.10',
        1500,
      ),
    /Manifest exceeds/,
  )
})
test('trusted comment and key-ID tampering fail independently', () => {
  const original = Buffer.from(fixture.artifactSignature, 'base64').toString()
  const changedComment = Buffer.from(
    original.replace('trusted comment: milkup', 'trusted comment: other'),
  ).toString('base64')
  assert.throws(
    () =>
      verifyMinisign(Buffer.from(fixture.artifact, 'base64'), changedComment, fixture.publicKey),
    /trusted-comment/,
  )
  const lines = original.split('\n')
  const raw = Buffer.from(lines[1], 'base64')
  raw[2] ^= 1
  lines[1] = raw.toString('base64')
  assert.throws(
    () =>
      verifyMinisign(
        Buffer.from(fixture.artifact, 'base64'),
        Buffer.from(lines.join('\n')).toString('base64'),
        fixture.publicKey,
      ),
    /key ID/,
  )
})

test('freshness shape and withdrawal precedence mirror native policy', () => {
  for (const rollbackFrom of [
    'garbage',
    '2.0.0-beta.10',
    '2.0.0-beta.10+changed',
    '2.0.0-beta.9',
    '2.0.0-beta.011',
    '02.0.0',
    '18446744073709551616.0.0',
  ]) {
    const f = signedFixture()
    f.statement.release.milkup.rollbackFrom = rollbackFrom
    assert.throws(() =>
      checkSignedRelease(
        f.envelope(),
        f.config,
        f.artifact,
        'windows-x86_64',
        '2.0.0-beta.10',
        1500,
      ),
    )
  }
  for (const rollbackFrom of [
    null,
    '2.0.0-beta.11',
    '2.0.0',
    '2.0.0-rc.1',
    '2.0.0-beta.10.extra',
    '2.1.0',
  ]) {
    const f = signedFixture()
    f.statement.release.milkup.rollbackFrom = rollbackFrom
    assert.equal(
      checkSignedRelease(
        f.envelope(),
        f.config,
        f.artifact,
        'windows-x86_64',
        '2.0.0-beta.10',
        1500,
      ).status,
      'signed-by-configured-key',
    )
  }
  const f = signedFixture()
  f.statement.release.milkup.surprise = true
  assert.throws(
    () =>
      checkSignedRelease(
        f.envelope(),
        f.config,
        f.artifact,
        'windows-x86_64',
        '2.0.0-beta.10',
        1500,
      ),
    /Unknown freshness/,
  )
})

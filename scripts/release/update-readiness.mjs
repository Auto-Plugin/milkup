import assert from 'node:assert/strict'
import { createHash, createPublicKey, verify } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const MAX_MANIFEST = 256 * 1024
const MAX_PACKAGE = 256 * 1024 * 1024
function base64(value) {
  assert.equal(typeof value, 'string', 'Expected base64 string')
  const bytes = Buffer.from(value, 'base64')
  assert.equal(bytes.toString('base64'), value, 'Non-canonical base64')
  return bytes
}
function keyBytes(encoded) {
  const lines = base64(encoded).toString('utf8').trimEnd().split(/\r?\n/)
  assert.equal(lines.length, 2, 'Expected minisign public key, not private key')
  assert.ok(lines[0].startsWith('untrusted comment: '))
  const key = base64(lines[1])
  assert.equal(key.length, 42)
  assert.equal(key.subarray(0, 2).toString(), 'Ed')
  return key
}
export function verifyMinisign(bytes, signature, publicKey) {
  const key = keyBytes(publicKey)
  const lines = base64(signature).toString('utf8').trimEnd().split(/\r?\n/)
  assert.equal(lines.length, 4, 'Expected detached minisign signature')
  assert.ok(lines[0].startsWith('untrusted comment: '))
  assert.ok(lines[2].startsWith('trusted comment: '))
  const sig = base64(lines[1])
  assert.equal(sig.length, 74)
  assert.ok(sig.subarray(2, 10).equals(key.subarray(2, 10)), 'Signing key ID mismatch')
  const algorithm = sig.subarray(0, 2).toString()
  assert.ok(['Ed', 'ED'].includes(algorithm), 'Unsupported signature algorithm')
  const publicObject = createPublicKey({
    key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), key.subarray(10)]),
    format: 'der',
    type: 'spki',
  })
  const message = algorithm === 'ED' ? createHash('blake2b512').update(bytes).digest() : bytes
  assert.ok(verify(null, message, publicObject, sig.subarray(10)), 'Invalid content signature')
  assert.ok(
    verify(
      null,
      Buffer.concat([sig.subarray(10), Buffer.from(lines[2].slice(17))]),
      publicObject,
      base64(lines[3]),
    ),
    'Invalid trusted-comment signature',
  )
}
function https(value) {
  const url = new URL(value)
  assert.ok(
    url.protocol === 'https:' && !url.username && !url.password && !url.hash,
    'Release URLs must be credential-free HTTPS without fragments',
  )
  assert.ok(
    !['localhost', 'example.com', 'example.org', 'example.net'].includes(url.hostname) &&
      !url.hostname.endsWith('.invalid') &&
      !url.hostname.endsWith('.test'),
    'Placeholder release URL',
  )
}
export function checkChannel(config, { requireConfigured = false } = {}) {
  assert.deepEqual(Object.keys(config).sort(), ['channel', 'endpoints', 'publicKey'])
  assert.ok(['stable', 'beta'].includes(config.channel))
  assert.ok(Array.isArray(config.endpoints) && config.endpoints.length <= 8)
  if (config.endpoints.length === 0 && config.publicKey === null) {
    assert.ok(!requireConfigured, 'Production update channel is not configured')
    return { configured: false, channel: config.channel }
  }
  assert.ok(
    config.endpoints.length > 0 && typeof config.publicKey === 'string',
    'Incomplete update channel',
  )
  assert.equal(
    new Set(config.endpoints).size,
    config.endpoints.length,
    'Duplicate update endpoints',
  )
  config.endpoints.forEach(https)
  const key = keyBytes(config.publicKey)
  // This public deterministic fixture must never become a production trust root,
  // even if someone changes its untrusted comment.
  assert.notEqual(
    key.subarray(10).toString('hex'),
    '5078787a3e30f24a7503fc22ff0675901ada430be04d3580f7d132a2257b2341',
    'Public synthetic test key cannot authorize a release',
  )
  return {
    configured: true,
    channel: config.channel,
    publicKeySha256: createHash('sha256').update(key).digest('hex'),
  }
}
// Mirror Rust semver::Version precedence (build metadata never changes precedence).
// Use BigInt so a canonical u64 component is not rounded by JavaScript.
function semver(text) {
  assert.ok(typeof text === 'string' && text.length <= 128, 'Invalid canonical SemVer')
  const match =
    /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/.exec(
      text,
    )
  assert.ok(match, 'Invalid canonical SemVer')
  const core = match.slice(1, 4).map(BigInt)
  assert.ok(
    core.every((part) => part <= 18446744073709551615n),
    'SemVer component exceeds u64',
  )
  const pre = match[4]?.split('.') ?? []
  assert.ok(
    pre.every((part) => !/^0[0-9]+$/.test(part)),
    'Non-canonical numeric prerelease',
  )
  return { core, pre }
}
function compareVersions(a, b) {
  for (let i = 0; i < 3; i++) if (a.core[i] !== b.core[i]) return a.core[i] > b.core[i] ? 1 : -1
  if (!a.pre.length || !b.pre.length)
    return a.pre.length === b.pre.length ? 0 : a.pre.length ? -1 : 1
  for (let i = 0; i < Math.min(a.pre.length, b.pre.length); i++) {
    const x = a.pre[i],
      y = b.pre[i]
    if (x === y) continue
    const xn = /^[0-9]+$/.test(x),
      yn = /^[0-9]+$/.test(y)
    if (xn && yn) return BigInt(x) > BigInt(y) ? 1 : -1
    if (xn !== yn) return xn ? -1 : 1
    return x > y ? 1 : -1
  }
  return Math.sign(a.pre.length - b.pre.length)
}

export function checkSignedRelease(
  envelopeBytes,
  config,
  artifact,
  target,
  expectedVersion,
  now = Math.floor(Date.now() / 1000),
) {
  checkChannel(config, { requireConfigured: true })
  assert.ok(envelopeBytes.length <= MAX_MANIFEST, 'Manifest exceeds application limit')
  assert.ok(
    artifact.length > 0 && artifact.length <= MAX_PACKAGE,
    'Package exceeds application limit',
  )
  const envelope = JSON.parse(envelopeBytes)
  assert.deepEqual(Object.keys(envelope).sort(), ['payload', 'signature'])
  const payload = base64(envelope.payload)
  verifyMinisign(payload, envelope.signature, config.publicKey)
  const statement = JSON.parse(payload)
  assert.deepEqual(Object.keys(statement).sort(), ['channel', 'product', 'release', 'schema'])
  assert.equal(statement.schema, 1)
  assert.equal(statement.product, 'milkup-desktop')
  assert.equal(statement.channel, config.channel)
  const release = statement.release
  assert.equal(release.version, expectedVersion, 'Manifest version differs from source version')
  const candidateVersion = semver(expectedVersion)
  if (config.channel === 'stable') assert.ok(!expectedVersion.split('+')[0].includes('-'))
  const policy = release.milkup
  assert.ok(policy && Number.isSafeInteger(policy.sequence) && policy.sequence > 0)
  assert.ok(
    Object.keys(policy).every((key) =>
      ['sequence', 'issuedAt', 'expiresAt', 'rollbackFrom'].includes(key),
    ),
    'Unknown freshness field',
  )
  if (policy.rollbackFrom != null)
    assert.ok(
      compareVersions(semver(policy.rollbackFrom), candidateVersion) > 0,
      'Invalid candidate withdrawal range',
    )
  assert.ok(
    Number.isSafeInteger(policy.issuedAt) &&
      policy.issuedAt >= 0 &&
      Number.isSafeInteger(policy.expiresAt),
  )
  assert.ok(policy.expiresAt > policy.issuedAt && policy.expiresAt - policy.issuedAt <= 7 * 86400)
  assert.ok(policy.issuedAt <= now + 300 && now < policy.expiresAt, 'Manifest not currently valid')
  assert.ok(typeof release.notes === 'string' && Buffer.byteLength(release.notes) <= 128 * 1024)
  const platform = release.platforms[target]
  assert.ok(platform, 'Platform missing from signed release')
  https(platform.url)
  verifyMinisign(artifact, platform.signature, config.publicKey)
  return {
    status: 'signed-by-configured-key',
    version: expectedVersion,
    target,
    sequence: policy.sequence,
    expiresAt: policy.expiresAt,
    artifactSha256: createHash('sha256').update(artifact).digest('hex'),
    boundary:
      'Offline cryptographic preflight only; installed version, endpoint availability and recovery not verified',
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2)
  const config = JSON.parse(await readFile('release/update-channel.json', 'utf8'))
  if (args.length === 1 && ['--candidate', '--production'].includes(args[0])) {
    console.log(
      JSON.stringify(
        checkChannel(config, { requireConfigured: args[0] === '--production' }),
        null,
        2,
      ),
    )
  } else if (args.length === 4 && args[0] === '--verify') {
    const version = JSON.parse(await readFile('package.json', 'utf8')).version
    console.log(
      JSON.stringify(
        checkSignedRelease(
          await readFile(args[1]),
          config,
          await readFile(args[2]),
          args[3],
          version,
        ),
        null,
        2,
      ),
    )
  } else
    throw Error(
      'Usage: update-readiness.mjs --candidate|--production|--verify <envelope.json> <package> <target>',
    )
}

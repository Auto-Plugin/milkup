// Isolated fixture authorization; no production key, endpoint, or updater config.
import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { signedFixture } from './signing-fixture.mjs'
import { checkSignedRelease } from '../update-readiness.mjs'
import { inspectWindowsInstaller } from '../prepare-recovery-kit.mjs'
assert.equal(process.platform, 'win32')
assert.equal(process.env.GITHUB_ACTIONS, 'true')
assert.equal(process.env.GITHUB_REF, 'refs/heads/dot/gap-native-capabilities-20261114')
const [installer, output, ...rest] = process.argv.slice(2)
assert(installer && output && rest.length === 0)
const bytes = await readFile(installer)
assert.equal(
  createHash('sha256').update(bytes).digest('hex'),
  'e4deb93fc3500cb3b49c7da94c6e777e47ea09851e0f9e6dd3b94aba31cc9f75',
)
const f = signedFixture({ artifact: bytes })
const now = Math.floor(Date.now() / 1000)
f.statement.release.version = '2.0.0-beta.11'
f.statement.release.notes = 'Exact version-only fixture; not a production release'
f.statement.release.milkup.issuedAt = now
f.statement.release.milkup.expiresAt = now + 600
const envelope = f.envelope()
const receipt = checkSignedRelease(
  envelope,
  f.config,
  bytes,
  'windows-x86_64',
  '2.0.0-beta.11',
  now,
)
const pe = inspectWindowsInstaller(installer)
assert.equal(pe.productVersion, receipt.version)
assert.equal(pe.sha256, receipt.artifactSha256)
const changed = Buffer.from(bytes)
changed[changed.length - 1] ^= 1
assert.throws(
  () => checkSignedRelease(envelope, f.config, changed, 'windows-x86_64', '2.0.0-beta.11', now),
  /signature/,
)
assert.throws(
  () => checkSignedRelease(envelope, f.config, bytes, 'windows-x86_64', '2.0.0-beta.11', now + 600),
  /not currently valid/,
)
await writeFile(
  output,
  JSON.stringify(
    {
      status: 'verified-test-fixture-awaiting-installation',
      receipt,
      pe,
      testPublicConfiguration: f.config,
      signedEnvelope: JSON.parse(envelope),
      privateKeyPersisted: false,
      productionChannelChanged: false,
      automaticUpdaterExercised: false,
      negatives: ['altered-package-rejected', 'expired-envelope-rejected'],
    },
    null,
    2,
  ),
)

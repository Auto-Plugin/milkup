// Explicit isolated CI exercise of the real recovery verifier and PE reader.
// Keys exist only in this process; the production channel is never configured.
import assert from 'node:assert/strict'
import { readFile, writeFile, lstat } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { signedFixture } from './signing-fixture.mjs'
import {
  prepareRecoveryKit,
  inspectWindowsInstaller,
  verifyRecoveryCandidate,
} from '../prepare-recovery-kit.mjs'

assert.equal(process.platform, 'win32')
assert.equal(process.env.GITHUB_ACTIONS, 'true')
assert.equal(process.env.GITHUB_REPOSITORY, 'Auto-Plugin/milkup')
assert.equal(process.env.GITHUB_REF, 'refs/heads/dot/gap-native-capabilities-20261114')
const [installerPath, installedVersion, output, reportPath, ...rest] = process.argv.slice(2)
assert(output && reportPath && rest.length === 0)
assert.equal(installedVersion, '2.0.0-beta.10')
const stat = await lstat(installerPath)
assert(stat.isFile() && !stat.isSymbolicLink() && stat.size > 0 && stat.size <= 256 * 1024 * 1024)
const installer = await readFile(installerPath)
assert.equal(installer.length, stat.size)
const hash = (b) => createHash('sha256').update(b).digest('hex')
const f = signedFixture({ artifact: installer })
const now = Math.floor(Date.now() / 1000)
f.statement.release.notes = 'Isolated native recovery acceptance; ephemeral test authority only'
f.statement.release.milkup.issuedAt = now
f.statement.release.milkup.expiresAt = now + 600
const envelope = f.envelope()
const report = {
  status: 'failed',
  scope:
    'Temporary CI key, real unchanged installer; not production trust, cross-version update or automatic rollback',
  privateKeyPersisted: false,
  testPublicConfiguration: f.config,
  networkRequests: 0,
  productionChannelChanged: false,
  installedVersion,
  installerSha256: hash(installer),
  negativeCases: [],
}
try {
  const changed = Buffer.from(installer)
  changed[changed.length - 1] ^= 1
  assert.throws(
    () => verifyRecoveryCandidate(envelope, f.config, changed, installedVersion, now),
    /signature/,
  )
  report.negativeCases.push('changed-installer-rejected')
  assert.throws(
    () =>
      verifyRecoveryCandidate(envelope, signedFixture().config, installer, installedVersion, now),
    /signature/,
  )
  report.negativeCases.push('different-authority-rejected')
  assert.throws(
    () => verifyRecoveryCandidate(envelope, f.config, installer, installedVersion, now + 600),
    /not currently valid/,
  )
  report.negativeCases.push('expired-envelope-rejected')
  const receipt = await prepareRecoveryKit({
    envelope,
    config: f.config,
    installer,
    installedVersion,
    output: path.resolve(output),
    inspect: inspectWindowsInstaller,
  })
  assert.equal(receipt.artifactSha256, hash(installer))
  assert.equal(receipt.purpose, 'same-version-repair')
  assert.equal(receipt.executed, false)
  report.prepared = receipt
  report.status = 'prepared-awaiting-real-install-and-health'
} catch (error) {
  report.error = String(error.stack)
  process.exitCode = 1
} finally {
  await writeFile(reportPath, JSON.stringify(report, null, 2))
}

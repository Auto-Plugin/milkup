import assert from 'node:assert/strict'
import { readFile, stat, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { verifyMinisign } from './update-readiness.mjs'
export const targetHash = 'e4deb93fc3500cb3b49c7da94c6e777e47ea09851e0f9e6dd3b94aba31cc9f75'
const imageHash = 'b129fd49f988eb700db8e606990c7c1f00be92b3fab0d99b4f1bf7070a6c82f6'
export function verifyInApp({
  installation: i,
  supervisor: s,
  ui,
  endpoint,
  before,
  after,
  installed,
  uninstalled,
}) {
  assert.equal(i.status, 'passed')
  assert.equal(i.forcedCleanup, false)
  assert.equal(
    i.inAppUpdate,
    'real-check-download-verify-protected-save-install-automatic-restart-and-health-passed',
  )
  assert.equal(i.inAppFixture.feature, 'ci-update-fixture')
  assert.equal(i.inAppFixture.sourceSha, '6eb10ba8aa21c42ed6291f8ebfc2cfdc68bbe784')
  assert.match(i.inAppFixture.sha256, /^[a-f0-9]{64}$/)
  assert.equal(
    i.receipt.installer.sha256,
    'c9c5b8bf8e8c75607d3288fc105553dce9cd22bf625fa84d86b45cbd32c7a648',
  )
  assert.equal(i.inAppTarget.installer.sha256, targetHash)
  assert.equal(i.rollback, 'not-implemented')
  assert.equal(s.status, 'passed')
  assert.equal(s.accountSid, i.accountSid)
  assert.equal(s.supervisor.activeBeforeOuterCleanup, 0)
  assert.deepEqual(s.cleanupErrors, [])
  for (const flag of ['accountDeleted', 'profileDeleted', 'stageRemoved'])
    assert.equal(s[flag], true)
  assert.equal(ui.status, 'passed-ui-await-native-restart')
  assert.deepEqual(
    ui.cases.map((c) => c.name),
    ['manifest-signature', 'download-http', 'artifact-signature'],
  )
  for (const c of ui.cases) {
    assert.equal(c.oldImageSha256, i.inAppFixture.sha256)
    assert(c.state.updateError)
    assert(!c.state.actions.includes('install'))
    assert.match(c.state.version, /2\.0\.0-beta\.10/)
    assert.match(c.savedSha256, /^[a-f0-9]{64}$/)
  }
  assert(ui.ready.actions.includes('install'))
  assert(!ui.ready.updateError)
  assert.equal(ui.confirmation.discardHidden, true)
  assert.match(ui.confirmation.text, /2\.0\.0-beta\.11/)
  assert.equal(endpoint.status, 'closed')
  assert.equal(endpoint.stopReason, 'requested')
  assert.equal(endpoint.artifactSha256, targetHash)
  assert(endpoint.requests.length <= 64 && endpoint.transferredBytes <= 96 * 1024 * 1024)
  for (const [mode, route, status] of [
    ['bad-manifest', '/manifest.json', 200],
    ['download-error', '/candidate.exe', 503],
    ['bad-artifact', '/candidate.exe', 200],
    ['valid', '/candidate.exe', 200],
  ])
    assert(
      endpoint.requests.some((r) => r.mode === mode && r.path === route && r.status === status),
      `Missing endpoint case ${mode}`,
    )
  assert(
    endpoint.requests.some(
      (r) => r.mode === 'valid' && r.path === '/candidate.exe' && r.sha256 === targetHash,
    ),
  )
  assert(
    endpoint.requests
      .filter((r) => r.mode === 'bad-artifact' && r.path === '/candidate.exe')
      .every((r) => r.sha256 !== targetHash),
  )
  const phase = (name) => {
    const rows = i.phases.filter((p) => p.name === name)
    assert.equal(rows.length, 1)
    return rows[0].detail
  }
  const old = phase('in-app-old-process'),
    exit = phase('in-app-old-normal-exit'),
    restarted = phase('in-app-automatic-restart')
  assert.equal(old.pid, exit.pid)
  assert.equal(old.creationTicks, exit.creationTicks)
  assert.equal(exit.exitCode, 0)
  for (const process of [old, restarted]) {
    assert.equal(typeof process.creationTicks, 'string')
    assert.match(process.creationTicks, /^[0-9]+$/)
    assert.match(process.identity.creationFileTime, /^[0-9]+$/)
    assert.equal(
      BigInt(process.creationTicks),
      BigInt(process.identity.creationFileTime) + 504911232000000000n,
    )
    assert.equal(process.identity.pid, process.pid)
    assert.equal(process.identity.token.sid, i.accountSid)
  }
  assert(BigInt(restarted.creationTicks) > BigInt(old.creationTicks))
  assert.equal(restarted.harnessStartedNewProcess, false)
  assert.equal(restarted.sha256, imageHash)
  assert.equal(restarted.identity.token.sid, i.accountSid)
  assert.equal(restarted.identity.token.elevated, false)
  assert.equal(restarted.identity.token.integrityRid, 8192)
  assert.equal(phase('in-app-restarted-normal-close').exitCode, 0)
  for (const health of [before, after]) {
    assert.equal(health.status, 'passed')
    assert.match(health.saved.sha256, /^[a-f0-9]{64}$/)
  }
  assert.equal(before.pluginAfter.checked, 'false')
  assert.equal(after.pluginBefore.checked, 'false')
  assert.equal(after.pluginAfter.checked, 'true')
  assert.equal(after.decodedImage.fullyDecoded, true)
  assert.equal(after.decodedImage.nonuniform, true)
  assert.equal(after.retainedDocumentSha256, ui.saved.sha256)
  assert.equal(installed.status, 'passed')
  assert.equal(installed.binary.sha256, imageHash)
  assert.equal(installed.binary.productVersion, '2.0.0-beta.11')
  assert.equal(installed.uninstallEntries.length, 1)
  assert.equal(installed.uninstallEntries[0].displayVersion, '2.0.0-beta.11')
  assert.equal(uninstalled.status, 'passed')
  assert.equal(uninstalled.uninstalled, true)
  assert.equal(uninstalled.uninstallEntries.length, 0)
  assert.equal(uninstalled.configurationPreservedAfterUninstall, true)
  assert(installed.configurationFiles.length > 0)
  assert.deepEqual(installed.configurationFiles, uninstalled.configurationFiles)
  assert.equal(installed.documentSha256, after.saved.sha256)
  assert.equal(uninstalled.documentSha256, after.saved.sha256)
  return {
    status: 'passed',
    scope:
      'Instrumented beta.10 native UI updater to existing exact beta.11 test package; no production update, automatic rollback or schema migration claim',
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [directory, artifactPath] = process.argv.slice(2)
  const load = async (name) => {
    const p = path.join(directory, name)
    assert((await stat(p)).size <= 8 * 1024 * 1024)
    return JSON.parse((await readFile(p, 'utf8')).replace(/^\uFEFF/, ''))
  }
  const evidence = {}
  for (const [key, file] of Object.entries({
    installation: 'installation.json',
    supervisor: 'standard-repair-supervisor.json',
    ui: 'in-app-update-ui.json',
    endpoint: 'endpoint-report.json',
    before: 'repair-health-before.json',
    after: 'repair-health-upgrade.json',
    installed: 'cross-version-after-in-app-health.json',
    uninstalled: 'cross-version-after-uninstall.json',
  }))
    evidence[key] = await load(file)
  const fixture = await load('public-fixture.json'),
    envelope = await load('accepted-manifest.json')
  verifyMinisign(
    Buffer.from(envelope.payload, 'base64'),
    envelope.signature,
    fixture.channel.publicKey,
  )
  const statement = JSON.parse(Buffer.from(envelope.payload, 'base64'))
  assert.equal(statement.product, 'milkup-desktop')
  assert.equal(statement.channel, 'beta')
  assert.equal(statement.release.version, '2.0.0-beta.11')
  assert.deepEqual(fixture.channel.endpoints, [evidence.endpoint.endpoint + '/manifest.json'])
  assert.equal(
    statement.release.platforms['windows-x86_64'].url,
    evidence.endpoint.endpoint + '/candidate.exe',
  )
  assert.equal(fixture.expiresAt, statement.release.milkup.expiresAt)
  assert.equal(
    createHash('sha256').update(fixture.certificatePem).digest('hex'),
    evidence.endpoint.certificateSha256,
  )
  for (const request of evidence.endpoint.requests) {
    const at = Date.parse(request.at) / 1000
    assert(at >= statement.release.milkup.issuedAt && at < statement.release.milkup.expiresAt)
  }

  const artifact = await readFile(artifactPath)
  assert.equal(createHash('sha256').update(artifact).digest('hex'), targetHash)
  verifyMinisign(
    artifact,
    statement.release.platforms['windows-x86_64'].signature,
    fixture.channel.publicKey,
  )
  const result = verifyInApp(evidence)
  await writeFile(
    path.join(directory, 'in-app-final-contract.json'),
    JSON.stringify(result, null, 2),
  )
  console.log(JSON.stringify(result))
}

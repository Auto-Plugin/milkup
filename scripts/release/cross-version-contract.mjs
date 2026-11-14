import assert from 'node:assert/strict'
import { readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

export const pair = Object.freeze({
  oldVersion: '2.0.0-beta.10',
  newVersion: '2.0.0-beta.11',
  oldSha: 'c9c5b8bf8e8c75607d3288fc105553dce9cd22bf625fa84d86b45cbd32c7a648',
  newSha: 'e4deb93fc3500cb3b49c7da94c6e777e47ea09851e0f9e6dd3b94aba31cc9f75',
  oldSource: 'b877746f5dfd236dfc13f718ed23d837b8e4f89d',
  newSource: '5fd33f2b63de2755268af6d669b0f4b3b1f21b96',
})

export function verifyCrossVersion({
  installation: i,
  supervisor,
  before,
  upgrade,
  after,
  states,
  preparation,
}) {
  assert.equal(i.status, 'passed')
  assert.equal(i.forcedCleanup, false)
  assert.equal(i.receipt.sourceSha, pair.oldSource)
  assert.equal(i.receipt.version, pair.oldVersion)
  assert.equal(i.receipt.installer.sha256, pair.oldSha)
  assert.equal(i.upgradeReceipt.sourceSha, pair.newSource)
  assert.equal(i.upgradeReceipt.version, pair.newVersion)
  assert.equal(i.upgradeReceipt.installer.sha256, pair.newSha)
  assert.equal(
    i.signedRecovery,
    'ephemeral-test-authority-manual-older-version-recovery-and-health-passed; not automatic rollback',
  )
  assert.equal(
    i.rollback,
    'manual-test-signed-older-version-reinstall-and-health-passed; automatic rollback not implemented',
  )
  assert.equal(supervisor.status, 'passed')
  assert.equal(supervisor.accountSid, i.accountSid)
  assert.equal(supervisor.supervisor.activeBeforeOuterCleanup, 0)
  for (const flag of ['accountDeleted', 'profileDeleted', 'stageRemoved'])
    assert.equal(supervisor[flag], true)
  assert.deepEqual(supervisor.cleanupErrors, [])
  for (const health of [before, upgrade, after]) {
    assert.equal(health.status, 'passed')
    assert.match(health.saved.sha256, /^[a-f0-9]{64}$/)
  }
  assert.equal(before.pluginBefore.checked, 'true')
  assert.equal(before.pluginAfter.checked, 'false')
  for (const health of [upgrade, after]) {
    assert.equal(health.pluginBefore.checked, 'false')
    assert.equal(health.pluginAfter.checked, 'true')
    assert.equal(health.decodedImage.fullyDecoded, true)
    assert.equal(health.decodedImage.nonuniform, true)
  }
  assert.equal(upgrade.pluginRetainedForRecovery.checked, 'false')
  assert.equal(upgrade.retainedDocumentSha256, before.saved.sha256)
  assert.equal(after.retainedDocumentSha256, upgrade.saved.sha256)
  for (const [label, version, documentHash] of [
    ['before-upgrade', pair.oldVersion, before.saved.sha256],
    ['after-upgrade', pair.newVersion, before.saved.sha256],
    ['before-recovery', pair.newVersion, upgrade.saved.sha256],
    ['after-recovery', pair.oldVersion, after.saved.sha256],
    ['after-uninstall', pair.oldVersion, after.saved.sha256],
  ]) {
    const s = states[label]
    assert.equal(s.status, 'passed')
    assert.equal(s.version, version)
    assert.equal(s.documentSha256, documentHash)
    assert.equal(s.uninstallEntries.length, label === 'after-uninstall' ? 0 : 1)
    if (label !== 'after-uninstall') {
      assert.equal(s.binary.productVersion, version)
      assert.equal(s.uninstallEntries[0].displayVersion, version)
    } else assert.equal(s.uninstalled, true)
  }
  assert.equal(states['before-upgrade'].binary.sha256, states['after-recovery'].binary.sha256)
  assert.notEqual(states['before-upgrade'].binary.sha256, states['after-upgrade'].binary.sha256)
  assert.equal(states['after-uninstall'].configurationPreservedAfterUninstall, true)
  assert(states['after-recovery'].configurationFiles.length > 0)
  assert.deepEqual(
    states['after-uninstall'].configurationFiles,
    states['after-recovery'].configurationFiles,
  )
  const backup = states['before-recovery'].backup
  assert.equal(backup.status, 'copied-and-hash-verified')
  assert.equal(backup.restored, false)
  assert(backup.files.length > 0 && backup.files.length <= 8192)
  assert(backup.bytes > 0 && backup.bytes <= 256 * 1024 * 1024)
  assert(backup.files.some((f) => ['local', 'roaming'].includes(f.root)))
  assert(backup.files.some((f) => f.root === 'document' && f.sha256 === upgrade.saved.sha256))
  assert.equal(preparation.status, 'prepared-awaiting-real-install-and-health')
  assert.equal(preparation.privateKeyPersisted, false)
  assert.equal(preparation.productionChannelChanged, false)
  assert.equal(preparation.prepared.purpose, 'manual-older-version-recovery')
  assert.equal(preparation.prepared.reportedInstalledVersion, pair.newVersion)
  assert.equal(preparation.prepared.version, pair.oldVersion)
  assert.equal(preparation.prepared.artifactSha256, pair.oldSha)
  assert.equal(preparation.prepared.executed, false)
  assert.equal(preparation.prepared.automaticRollback, false)
  for (const name of ['normal-close', 'upgrade-normal-close', 'repair-normal-close']) {
    const phases = i.phases.filter((p) => p.name === name)
    assert.equal(phases.length, 1)
    assert.equal(phases[0].detail.exitCode, 0)
  }
  assert(
    i.phases.some(
      (p) => p.name === 'uninstall-and-document-preservation' && p.detail.applicationRemoved,
    ),
  )
  return {
    status: 'passed',
    pair,
    automaticRollback: false,
    productionUpdate: false,
    scope:
      'Version-only fixture upgrade and test-signed manual older-version recovery; no future schema compatibility claim',
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [directory, ...rest] = process.argv.slice(2)
  assert(directory && rest.length === 0)
  const read = async (name) => {
    const file = path.join(directory, `${name}.json`)
    assert((await stat(file)).size <= 8 * 1024 * 1024)
    return JSON.parse(await readFile(file, 'utf8'))
  }
  const states = {}
  for (const label of [
    'before-upgrade',
    'after-upgrade',
    'before-recovery',
    'after-recovery',
    'after-uninstall',
  ])
    states[label] = await read(`cross-version-${label}`)
  const result = verifyCrossVersion({
    installation: await read('installation'),
    supervisor: await read('standard-repair-supervisor'),
    before: await read('repair-health-before'),
    upgrade: await read('repair-health-upgrade'),
    after: await read('repair-health-after'),
    states,
    preparation: await read('native-recovery-preparation'),
  })
  await writeFile(
    path.join(directory, 'cross-version-verified.json'),
    JSON.stringify(result, null, 2),
  )
  console.log(JSON.stringify(result))
}

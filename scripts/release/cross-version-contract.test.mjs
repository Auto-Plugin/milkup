import assert from 'node:assert/strict'
import test from 'node:test'
import { pair, verifyCrossVersion } from './cross-version-contract.mjs'

// Synthetic evidence only. These tests validate rejection rules, not Windows.
function fixture() {
  const beforeHash = 'a'.repeat(64),
    upgradeHash = 'b'.repeat(64),
    afterHash = 'c'.repeat(64)
  const image = { fullyDecoded: true, nonuniform: true }
  const health = (hash) => ({
    status: 'passed',
    saved: { sha256: hash },
    pluginBefore: { checked: 'false' },
    pluginAfter: { checked: 'true' },
    decodedImage: image,
  })
  const before = {
    ...health(beforeHash),
    pluginBefore: { checked: 'true' },
    pluginAfter: { checked: 'false' },
  }
  const upgrade = {
    ...health(upgradeHash),
    retainedDocumentSha256: beforeHash,
    pluginRetainedForRecovery: { checked: 'false' },
  }
  const after = { ...health(afterHash), retainedDocumentSha256: upgradeHash }
  const states = {}
  for (const [label, version, hash] of [
    ['before-upgrade', pair.oldVersion, beforeHash],
    ['after-upgrade', pair.newVersion, beforeHash],
    ['before-recovery', pair.newVersion, upgradeHash],
    ['after-recovery', pair.oldVersion, afterHash],
    ['after-uninstall', pair.oldVersion, afterHash],
  ])
    states[label] = {
      status: 'passed',
      version,
      documentSha256: hash,
      binary: {
        productVersion: version,
        sha256: version === pair.oldVersion ? '1'.repeat(64) : '2'.repeat(64),
      },
      uninstallEntries: label === 'after-uninstall' ? [] : [{ displayVersion: version }],
      uninstalled: label === 'after-uninstall',
    }
  states['after-recovery'].configurationFiles = [
    { root: 'local', relative: 'catalog.db', sha256: 'd'.repeat(64), bytes: 10 },
  ]
  states['after-uninstall'].configurationFiles = structuredClone(
    states['after-recovery'].configurationFiles,
  )
  states['after-uninstall'].configurationPreservedAfterUninstall = true
  states['before-recovery'].backup = {
    status: 'copied-and-hash-verified',
    restored: false,
    bytes: 12,
    files: [
      { root: 'document', sha256: upgradeHash },
      { root: 'local', sha256: 'd'.repeat(64) },
    ],
  }
  return {
    before,
    upgrade,
    after,
    states,
    installation: {
      status: 'passed',
      forcedCleanup: false,
      accountSid: 'owned-sid',
      receipt: {
        sourceSha: pair.oldSource,
        version: pair.oldVersion,
        installer: { sha256: pair.oldSha },
      },
      upgradeReceipt: {
        sourceSha: pair.newSource,
        version: pair.newVersion,
        installer: { sha256: pair.newSha },
      },
      signedRecovery:
        'ephemeral-test-authority-manual-older-version-recovery-and-health-passed; not automatic rollback',
      rollback:
        'manual-test-signed-older-version-reinstall-and-health-passed; automatic rollback not implemented',
      phases: ['normal-close', 'upgrade-normal-close', 'repair-normal-close']
        .map((name) => ({ name, detail: { exitCode: 0 } }))
        .concat([
          { name: 'uninstall-and-document-preservation', detail: { applicationRemoved: true } },
        ]),
    },
    supervisor: {
      status: 'passed',
      accountSid: 'owned-sid',
      supervisor: { activeBeforeOuterCleanup: 0 },
      accountDeleted: true,
      profileDeleted: true,
      stageRemoved: true,
      cleanupErrors: [],
    },
    preparation: {
      status: 'prepared-awaiting-real-install-and-health',
      privateKeyPersisted: false,
      productionChannelChanged: false,
      prepared: {
        purpose: 'manual-older-version-recovery',
        reportedInstalledVersion: pair.newVersion,
        version: pair.oldVersion,
        artifactSha256: pair.oldSha,
        executed: false,
        automaticRollback: false,
      },
    },
  }
}
test('complete synthetic fixture is explicitly manual version-only recovery, not production update', () => {
  const result = verifyCrossVersion(fixture())
  assert.equal(result.status, 'passed')
  assert.equal(result.automaticRollback, false)
  assert.equal(result.productionUpdate, false)
})
for (const [name, mutate] of [
  [
    'different package bytes',
    (f) => {
      f.installation.upgradeReceipt.installer.sha256 = '0'.repeat(64)
    },
  ],
  [
    'stale uninstall version',
    (f) => {
      f.states['after-upgrade'].uninstallEntries[0].displayVersion = pair.oldVersion
    },
  ],
  [
    'lost document after upgrade',
    (f) => {
      f.upgrade.retainedDocumentSha256 = '0'.repeat(64)
    },
  ],
  [
    'lost plugin setting after recovery',
    (f) => {
      f.after.pluginBefore.checked = 'true'
    },
  ],
  [
    'no verified config backup',
    (f) => {
      f.states['before-recovery'].backup.files = []
    },
  ],
  [
    'outer cleanup substituted for normal close',
    (f) => {
      f.installation.forcedCleanup = true
    },
  ],
  [
    'no upgrade close',
    (f) => {
      f.installation.phases.splice(1, 1)
    },
  ],
  [
    'remaining uninstall entry',
    (f) => {
      f.states['after-uninstall'].uninstallEntries.push({ displayVersion: pair.oldVersion })
    },
  ],
  [
    'preparation mislabeled automatic rollback',
    (f) => {
      f.preparation.prepared.automaticRollback = true
    },
  ],
  [
    'different account',
    (f) => {
      f.supervisor.accountSid = 'another-account'
    },
  ],
])
  test(`rejects ${name}`, () => {
    const f = fixture()
    mutate(f)
    assert.throws(() => verifyCrossVersion(f))
  })

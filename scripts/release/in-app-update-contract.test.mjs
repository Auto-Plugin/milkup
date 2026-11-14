import test from 'node:test'
import assert from 'node:assert/strict'
import { verifyInApp, targetHash } from './in-app-update-contract.mjs'
const h = 'a'.repeat(64),
  image = 'b129fd49f988eb700db8e606990c7c1f00be92b3fab0d99b4f1bf7070a6c82f6'
function complete() {
  const cases = ['manifest-signature', 'download-http', 'artifact-signature'].map((name) => ({
    name,
    oldImageSha256: h,
    savedSha256: h,
    state: { updateError: 'signature/download rejected', actions: [], version: '2.0.0-beta.10' },
  }))
  return {
    installation: {
      status: 'passed',
      forcedCleanup: false,
      inAppUpdate:
        'real-check-download-verify-protected-save-install-automatic-restart-and-health-passed',
      inAppFixture: {
        feature: 'ci-update-fixture',
        sourceSha: '6eb10ba8aa21c42ed6291f8ebfc2cfdc68bbe784',
        sha256: h,
      },
      receipt: {
        installer: { sha256: 'c9c5b8bf8e8c75607d3288fc105553dce9cd22bf625fa84d86b45cbd32c7a648' },
      },
      inAppTarget: { installer: { sha256: targetHash } },
      rollback: 'not-implemented',
      accountSid: 'owned',
      phases: [
        {
          name: 'in-app-old-process',
          detail: {
            pid: 7,
            creationTicks: '504911232000000001',
            identity: { pid: 7, creationFileTime: '1', token: { sid: 'owned' } },
          },
        },
        {
          name: 'in-app-old-normal-exit',
          detail: { pid: 7, creationTicks: '504911232000000001', exitCode: 0 },
        },
        {
          name: 'in-app-automatic-restart',
          detail: {
            pid: 7,
            creationTicks: '504911232000000002',
            harnessStartedNewProcess: false,
            sha256: image,
            identity: {
              pid: 7,
              creationFileTime: '2',
              token: { sid: 'owned', elevated: false, integrityRid: 8192 },
            },
          },
        },
        { name: 'in-app-restarted-normal-close', detail: { exitCode: 0 } },
        {
          name: 'in-app-restarted-close-exit-observation',
          detail: {
            pid: 7,
            creationTicks: '504911232000000002',
            heldProcessHandle: true,
            exited: true,
            waitResult: 0,
            exitCode: 0,
          },
        },
      ],
    },
    supervisor: {
      status: 'passed',
      accountSid: 'owned',
      supervisor: { activeBeforeOuterCleanup: 0 },
      cleanupErrors: [],
      accountDeleted: true,
      profileDeleted: true,
      stageRemoved: true,
    },
    ui: {
      status: 'passed-ui-await-native-restart',
      cases,
      ready: { actions: ['install'] },
      confirmation: { discardHidden: true, text: '2.0.0-beta.11' },
      saved: { sha256: h },
    },
    endpoint: {
      status: 'closed',
      stopReason: 'requested',
      artifactSha256: targetHash,
      transferredBytes: 100,
      requests: [
        { mode: 'bad-manifest', path: '/manifest.json', status: 200 },
        { mode: 'download-error', path: '/candidate.exe', status: 503 },
        { mode: 'bad-artifact', path: '/candidate.exe', status: 200, sha256: h },
        { mode: 'valid', path: '/candidate.exe', status: 200, sha256: targetHash },
      ],
    },
    before: { status: 'passed', saved: { sha256: h }, pluginAfter: { checked: 'false' } },
    after: {
      status: 'passed',
      saved: { sha256: h },
      retainedDocumentSha256: h,
      pluginBefore: { checked: 'false' },
      pluginAfter: { checked: 'true' },
      decodedImage: { fullyDecoded: true, nonuniform: true },
    },
    installed: {
      status: 'passed',
      binary: { sha256: image, productVersion: '2.0.0-beta.11' },
      uninstallEntries: [{ displayVersion: '2.0.0-beta.11' }],
      configurationFiles: [{ sha256: h }],
      documentSha256: h,
    },
    uninstalled: {
      status: 'passed',
      uninstalled: true,
      uninstallEntries: [],
      configurationPreservedAfterUninstall: true,
      configurationFiles: [{ sha256: h }],
      documentSha256: h,
    },
  }
}
test('complete synthetic evidence contract permits PID reuse only with a newer birth', () =>
  assert.equal(verifyInApp(complete()).status, 'passed'))
for (const [name, change] of Object.entries({
  'missing negative': (e) => e.ui.cases.pop(),
  'wrong old binary after failure': (e) => (e.ui.cases[0].oldImageSha256 = 'b'.repeat(64)),
  'rejected bytes installable': (e) => e.ui.cases[1].state.actions.push('install'),
  'test manually relaunched new app': (e) =>
    (e.installation.phases[2].detail.harnessStartedNewProcess = true),
  'stale process identity': (e) => (e.installation.phases[2].detail.creationTicks = 1),
  'rounded numeric birth': (e) =>
    (e.installation.phases[2].detail.creationTicks = Number(
      e.installation.phases[2].detail.creationTicks,
    )),
  'mismatched held birth': (e) => (e.installation.phases[2].detail.identity.creationFileTime = '3'),
  'missing held birth': (e) => delete e.installation.phases[2].detail.identity.creationFileTime,
  'new process elevated': (e) => (e.installation.phases[2].detail.identity.token.elevated = true),
  'missing native exit proof': (e) => e.installation.phases.pop(),
  'wrong closed generation': (e) =>
    (e.installation.phases[4].detail.creationTicks = '504911232000000001'),
  'nonzero actual exit': (e) => (e.installation.phases[4].detail.exitCode = 17),
  'exit not observed': (e) => (e.installation.phases[4].detail.exited = false),
  'wrong target package': (e) => (e.installation.inAppTarget.installer.sha256 = h),
  'unmatched endpoint download': (e) => e.endpoint.requests.pop(),
  'forced cleanup': (e) => (e.installation.forcedCleanup = true),
  'document lost on restart': (e) => (e.after.retainedDocumentSha256 = 'b'.repeat(64)),
  'config reset': (e) => (e.after.pluginBefore.checked = 'true'),
  'outer cleanup substituted': (e) => (e.supervisor.supervisor.activeBeforeOuterCleanup = 1),
  'invented rollback': (e) => (e.installation.rollback = 'passed'),
}))
  test(`reject ${name}`, () => {
    const e = complete()
    change(e)
    assert.throws(() => verifyInApp(e))
  })

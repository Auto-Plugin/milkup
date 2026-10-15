import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, writeFile, truncate } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import {
  ARTIFACT_LIMIT,
  PAYLOAD_LIMIT,
  OFFLINE_BRANCH,
  OFFLINE_BASELINE,
  OFFLINE_REQUEST_ID,
  OFFLINE_REQUEST_PATH,
  readPluginInventory,
  validateOfflineRequest,
  verifyOfflinePayload,
} from '../../scripts/ci/plugin-offline-delivery.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const read = (name) => readFile(path.join(root, name), 'utf8')
const currentRequest = JSON.parse(await read(OFFLINE_REQUEST_PATH))
function approval() {
  return {
    ...currentRequest,
    enabled: true,
    uploadConsumed: false,
    finalCodeValidationPassed: true,
    reviewedSourceSha: 'a'.repeat(40),
  }
}
function context() {
  return {
    repository: 'Auto-Plugin/milkup',
    ref: OFFLINE_BRANCH,
    isPrivate: false,
    runAttempt: '1',
    commitMessage: `[windows-v2-plugin-offline-delivery] [upload:${OFFLINE_REQUEST_ID}]`,
    head: 'b'.repeat(40),
    sha: 'b'.repeat(40),
    clean: true,
    baselineAncestor: true,
    reviewedAncestor: true,
    changedSinceReview: [OFFLINE_REQUEST_PATH],
  }
}

test('accepts only the approved final-source request and keeps the historical budget consumed', async () => {
  validateOfflineRequest(approval(), context())
  assert.equal(currentRequest.baselineSha, OFFLINE_BASELINE)
  if (!currentRequest.finalCodeValidationPassed) assert.equal(currentRequest.enabled, false)
  const old = JSON.parse(await read('scripts/ci/windows-v2-standard-request.json'))
  assert.equal(old.uploadConsumed, true)
  assert.notEqual(old.requestId, currentRequest.requestId)
  assert.equal(ARTIFACT_LIMIT - PAYLOAD_LIMIT, 1024 * 1024)
})
for (const [field, value] of [
  ['enabled', false],
  ['uploadConsumed', true],
  ['finalCodeValidationPassed', false],
  ['reviewedSourceSha', null],
  ['baselineSha', 'a'.repeat(40)],
  ['requestId', 'reused'],
  ['offlineEvergreenTermsAccepted', false],
  ['storageBudgetApproved', false],
  ['publicArtifactsAccepted', false],
  ['unsignedTestPackageAccepted', false],
  ['webviewInstallMode', 'embedBootstrapper'],
  ['artifactLimitBytes', ARTIFACT_LIMIT + 1],
  ['payloadLimitBytes', PAYLOAD_LIMIT + 1],
  ['artifactRetentionDays', 2],
  ['maxExtraStorageCostUsd', 0.02],
  ['taxIncluded', true],
  ['maxArtifactUploads', 2],
])
  test(`rejects unauthorized request ${field}`, () => {
    assert.throws(() => validateOfflineRequest({ ...approval(), [field]: value }, context()))
  })
for (const [field, value] of [
  ['repository', 'someone/else'],
  ['ref', 'refs/heads/main'],
  ['isPrivate', true],
  ['runAttempt', '2'],
  ['commitMessage', '[windows-v2-plugin-offline-delivery]'],
  ['head', 'c'.repeat(40)],
  ['clean', false],
  ['baselineAncestor', false],
  ['reviewedAncestor', false],
  ['changedSinceReview', [OFFLINE_REQUEST_PATH, 'apps/desktop/src/main.ts']],
])
  test(`rejects unauthorized execution ${field}`, () => {
    assert.throws(() => validateOfflineRequest(approval(), { ...context(), [field]: value }))
  })

test('workflow mirror preserves one bounded upload, exact trigger, no release/cache and pinned source', async () => {
  const workflow = await read('.github/workflows/v2-windows-plugin-offline-delivery.yml')
  assert.equal(workflow, await read('scripts/ci/windows-v2-plugin-offline-delivery.yml'))
  assert.ok(workflow.includes(`github.ref == '${OFFLINE_BRANCH}'`))
  assert.ok(workflow.includes(`[upload:${OFFLINE_REQUEST_ID}]`))
  assert.equal((workflow.match(/uses: actions\/upload-artifact@/g) ?? []).length, 1)
  assert.match(workflow, /retention-days: 1/)
  assert.match(workflow, /compression-level: 0/)
  assert.match(workflow, /overwrite: false/)
  assert.match(workflow, /ref: \$\{\{ github.sha \}\}/)
  assert.match(workflow, /contents: read/)
  assert.match(workflow, /-OfflineEvergreen/)
  assert.ok(
    workflow.indexOf('plugin-offline-delivery.mjs payload') <
      workflow.indexOf('uses: actions/upload-artifact@'),
  )
  assert.doesNotMatch(
    workflow,
    /workflow_dispatch|pull_request|actions\/cache|tauri-action|contents: write/,
  )
})

test('build accepts only the exact offline overlay and verifies public SDK builds before packaging', async () => {
  assert.deepEqual(JSON.parse(await read('scripts/ci/tauri-windows-offline.json')), {
    bundle: { windows: { webviewInstallMode: { type: 'offlineInstaller', silent: true } } },
  })
  const build = await read('scripts/ci/build-windows-v2-package.ps1')
  assert.match(build, /\[switch\]\$OfflineEvergreen/)
  assert.match(build, /\$env:TAURI_CONFIG/)
  assert.match(build, /Unreviewed offline config overlay/)
  assert.match(build, /plugin-offline-delivery.mjs', 'inventory'/)
  assert.ok(
    build.indexOf('verify-public-plugin-builds.mjs') <
      build.indexOf("Invoke-Checked 'pnpm' $tauriArguments"),
  )
  assert.match(build, /foreach \(\$pluginFile in \$pluginFiles\)/)
  const probe = await read('scripts/ci/verify-public-plugin-builds.mjs')
  assert.match(probe, /'pack', '--pack-destination'/)
  assert.match(probe, /process.execPath, \[pnpmCli/)
  assert.match(probe, /'exec', 'vitest', 'run'/)
  assert.doesNotMatch(probe, /shell: true|alias:/)
})

async function payloadFixture(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'milkup-offline-contract-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const source = path.join(directory, 'source')
  const payload = path.join(directory, 'payload')
  await mkdir(path.join(source, 'release'), { recursive: true })
  await mkdir(payload)
  const catalog = [
    { directory: 'plugins/outline', permissions: ['document:read'] },
    { directory: 'plugins/updates', permissions: ['app:updates'] },
  ]
  await writeFile(path.join(source, 'release/bundled-plugins.json'), JSON.stringify(catalog))
  const records = []
  const record = (name, content) => ({
    name,
    bytes: Buffer.byteLength(content),
    sha256: createHash('sha256').update(content).digest('hex'),
  })
  for (const entry of catalog) {
    const manifest = {
      id: `milkup.${entry.directory.split('/')[1]}`,
      version: '1.0.0',
      host: 'worker',
      main: './dist/plugin.js',
      permissions: entry.permissions,
      engines: { pluginSdk: '^0.2.0' },
    }
    await mkdir(path.join(source, entry.directory), { recursive: true })
    await writeFile(path.join(source, entry.directory, 'plugin.json'), JSON.stringify(manifest))
    const name = `${manifest.id}-${manifest.version}.milkup-plugin`
    const content = JSON.stringify({
      format: 'milkup-plugin',
      version: 1,
      manifest,
      files: [{ path: 'dist/plugin.js', encoding: 'utf8', content: 'export default {}' }],
    })
    await writeFile(path.join(payload, name), content)
    records.push(record(name, content))
  }
  const commit = 'a'.repeat(40)
  const installer = `milkup-v2-test-windows-x64-${commit}.exe`
  // Contract fixture only: these bytes are not an installer or Windows acceptance proof.
  await writeFile(path.join(payload, installer), 'contract fixture')
  const installerRecord = record(installer, 'contract fixture')
  const manifest = {
    commitSha: commit,
    status: 'built-for-user-trial',
    webviewInstallMode: 'offlineInstaller',
    pluginSdkVersion: '0.2.0',
    publicSdkVerification: {
      status: 'passed',
      sdkVersion: '0.2.0',
      sdkSha256: 'a'.repeat(64),
      plugins: records.map((entry) => ({ ...entry, build: 'passed', tests: 'passed' })),
    },
    installer: { ...installerRecord, deliveredName: installer, signature: 'NotSigned' },
    binary: { signature: 'NotSigned' },
    releaseCreated: false,
    windowsDesktopManualAcceptance: 'pending',
    installedTest: { status: 'not-run' },
    bundledPlugins: records,
  }
  await writeFile(path.join(payload, 'manifest.json'), JSON.stringify(manifest))
  await writeFile(
    path.join(payload, 'README.txt'),
    'Contract fixture; real Windows acceptance is not claimed.',
  )
  await writeFile(
    path.join(payload, 'SHA256SUMS.txt'),
    [installerRecord, ...records].map((entry) => `${entry.sha256}  ${entry.name}`).join('\n'),
  )
  return { source, payload, commit, manifest, records }
}

test('validates the exact six-file inventory and rejects unexpected files, altered bytes and metadata', async (t) => {
  const f = await payloadFixture(t)
  assert.equal((await verifyOfflinePayload(f.source, f.payload, f.commit)).files.length, 6)
  await writeFile(path.join(f.payload, 'secret.txt'), 'unexpected')
  await assert.rejects(verifyOfflinePayload(f.source, f.payload, f.commit), /six reviewed/)
  await rm(path.join(f.payload, 'secret.txt'))
  await writeFile(path.join(f.payload, f.records[0].name), 'tampered')
  await assert.rejects(verifyOfflinePayload(f.source, f.payload, f.commit), /size changed/)
})
test('rejects an incorrect checksum manifest and offline mode substitution', async (t) => {
  const f = await payloadFixture(t)
  f.manifest.webviewInstallMode = 'downloadBootstrapper'
  await writeFile(path.join(f.payload, 'manifest.json'), JSON.stringify(f.manifest))
  await assert.rejects(verifyOfflinePayload(f.source, f.payload, f.commit))
  f.manifest.webviewInstallMode = 'offlineInstaller'
  await writeFile(path.join(f.payload, 'manifest.json'), JSON.stringify(f.manifest))
  await writeFile(path.join(f.payload, 'SHA256SUMS.txt'), 'forged')
  await assert.rejects(verifyOfflinePayload(f.source, f.payload, f.commit))
})
test('rejects payload beyond the raw-file ceiling before reading its content', async (t) => {
  const f = await payloadFixture(t)
  await truncate(path.join(f.payload, 'README.txt'), PAYLOAD_LIMIT)
  await assert.rejects(verifyOfflinePayload(f.source, f.payload, f.commit), /255 MiB/)
})
test('rejects extra plugins and changed permissions rather than widening the approved inventory', async (t) => {
  const f = await payloadFixture(t)
  const record = JSON.parse(await readFile(path.join(f.source, 'plugins/updates/plugin.json')))
  record.permissions.push('file:write')
  await writeFile(path.join(f.source, 'plugins/updates/plugin.json'), JSON.stringify(record))
  await assert.rejects(readPluginInventory(f.source))
})

test('rejects a missing independent plugin build/test proof', async (t) => {
  const f = await payloadFixture(t)
  f.manifest.publicSdkVerification.plugins.pop()
  await writeFile(path.join(f.payload, 'manifest.json'), JSON.stringify(f.manifest))
  await assert.rejects(verifyOfflinePayload(f.source, f.payload, f.commit))
})

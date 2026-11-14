import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { appendFile, lstat, readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

export const OFFLINE_BRANCH = 'refs/heads/dot/milkup-v2-product-completion-phase1'
export const OFFLINE_BASELINE = 'c2f7445ee4f84b46c9044f7df52c876c5449fa0d'
export const OFFLINE_REQUEST_ID = 'windows-plugin-offline-2026-10-15-01'
export const OFFLINE_REQUEST_PATH = 'scripts/ci/windows-v2-plugin-offline-request.json'
export const PAYLOAD_LIMIT = 255 * 1024 * 1024
export const ARTIFACT_LIMIT = 256 * 1024 * 1024
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex')
const json = async (file) => JSON.parse(await readFile(file, 'utf8'))

export function validateOfflineRequest(request, context) {
  assert.equal(context.repository, 'Auto-Plugin/milkup', 'Unexpected repository')
  assert.equal(context.ref, OFFLINE_BRANCH, 'Unexpected branch')
  assert.equal(context.isPrivate, false, 'Only a public-repository standard runner is authorized')
  assert.equal(context.runAttempt, '1', 'One upload only: no rerun')
  assert.equal(request.enabled, true, 'Request is disabled pending final validation')
  assert.equal(request.uploadConsumed, false, 'Upload budget already consumed')
  assert.equal(request.requestId, OFFLINE_REQUEST_ID, 'Unexpected request ID')
  assert.equal(request.baselineSha, OFFLINE_BASELINE, 'Unexpected reviewed baseline')
  assert.equal(request.finalCodeValidationPassed, true, 'Final source validation is required')
  assert.match(request.reviewedSourceSha ?? '', /^[0-9a-f]{40}$/, 'Reviewed source SHA is required')
  for (const flag of [
    'publicArtifactsAccepted',
    'unsignedTestPackageAccepted',
    'storageBudgetApproved',
    'offlineEvergreenTermsAccepted',
  ])
    assert.equal(request[flag], true, `${flag} must be approved`)
  assert.equal(request.deliveryMode, 'user-trial-package')
  assert.equal(request.webviewInstallMode, 'offlineInstaller')
  assert.equal(request.artifactLimitBytes, ARTIFACT_LIMIT)
  assert.equal(request.payloadLimitBytes, PAYLOAD_LIMIT)
  assert.equal(request.artifactRetentionDays, 1)
  assert.equal(request.maxExtraStorageCostUsd, 0.01)
  assert.equal(request.taxIncluded, false)
  assert.equal(request.maxArtifactUploads, 1)
  assert.match(request.approvalSource ?? '', /latest explicit user approval/i)
  assert.ok(
    context.commitMessage.includes('[windows-v2-plugin-offline-delivery]'),
    'Missing delivery marker',
  )
  assert.ok(
    context.commitMessage.includes(`[upload:${OFFLINE_REQUEST_ID}]`),
    'Missing unique approval marker',
  )
  assert.equal(context.head, context.sha, 'Checkout SHA mismatch')
  assert.equal(context.clean, true, 'Dirty checkout')
  assert.equal(context.baselineAncestor, true, 'Source must descend from the exact baseline')
  assert.equal(context.reviewedAncestor, true, 'Reviewed source must be an ancestor of the trigger')
  assert.deepEqual(
    context.changedSinceReview,
    [OFFLINE_REQUEST_PATH],
    'Only the request may change after final code validation',
  )
}

export async function readPluginInventory(root) {
  const distribution = await json(path.join(root, 'release/bundled-plugins.json'))
  assert.equal(distribution.length, 2, 'This delivery approves exactly two plugins')
  const approved = new Map([
    ['plugins/outline', ['document:read']],
    ['plugins/updates', ['app:updates']],
  ])
  const records = []
  for (const entry of distribution) {
    assert.ok(approved.has(entry.directory), 'Unapproved bundled plugin directory')
    assert.deepEqual(
      entry.permissions,
      approved.get(entry.directory),
      'Unapproved plugin permissions',
    )
    approved.delete(entry.directory)
    const manifest = await json(path.join(root, entry.directory, 'plugin.json'))
    assert.equal(
      manifest.id,
      entry.directory === 'plugins/outline' ? 'milkup.outline' : 'milkup.updates',
    )
    assert.match(manifest.version, /^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/)
    assert.equal(manifest.host, 'worker')
    assert.equal(manifest.main, './dist/plugin.js')
    assert.deepEqual(manifest.permissions, entry.permissions)
    assert.equal(manifest.engines.pluginSdk, '^0.2.0')
    records.push({
      directory: entry.directory,
      name: `${manifest.id}-${manifest.version}.milkup-plugin`,
      id: manifest.id,
      version: manifest.version,
      permissions: entry.permissions,
    })
  }
  assert.equal(approved.size, 0)
  return records.sort((a, b) => a.name.localeCompare(b.name))
}

export async function verifyOfflinePayload(root, directory, expectedSha) {
  assert.match(expectedSha, /^[0-9a-f]{40}$/)
  const inventory = await readPluginInventory(root)
  const installerName = `milkup-v2-test-windows-x64-${expectedSha}.exe`
  const expected = [
    installerName,
    'manifest.json',
    'SHA256SUMS.txt',
    'README.txt',
    ...inventory.map((entry) => entry.name),
  ].sort()
  const names = (await readdir(directory)).sort()
  assert.deepEqual(names, expected, 'Exactly the six reviewed payload files are allowed')
  let bytes = 0
  for (const name of names) {
    const stat = await lstat(path.join(directory, name))
    assert.ok(stat.isFile() && !stat.isSymbolicLink(), 'Payload entries must be regular files')
    bytes += stat.size
  }
  assert.ok(
    bytes <= PAYLOAD_LIMIT,
    'Raw payload exceeds 255 MiB; reserve 1 MiB for artifact framing',
  )
  const manifest = await json(path.join(directory, 'manifest.json'))
  assert.equal(manifest.status, 'built-for-user-trial')
  assert.equal(manifest.commitSha, expectedSha)
  assert.equal(manifest.webviewInstallMode, 'offlineInstaller')
  assert.equal(manifest.pluginSdkVersion, '0.2.0')
  assert.equal(manifest.publicSdkVerification.status, 'passed')
  assert.equal(manifest.publicSdkVerification.sdkVersion, '0.2.0')
  assert.match(manifest.publicSdkVerification.sdkSha256, /^[a-f0-9]{64}$/)
  assert.deepEqual(
    manifest.publicSdkVerification.plugins.map((entry) => entry.name).sort(),
    inventory.map((entry) => entry.name),
  )
  for (const entry of manifest.publicSdkVerification.plugins) {
    assert.equal(entry.build, 'passed')
    assert.equal(entry.tests, 'passed')
    assert.match(entry.sha256, /^[a-f0-9]{64}$/)
  }
  assert.equal(manifest.installer.deliveredName, installerName)
  assert.equal(manifest.installer.signature, 'NotSigned')
  assert.equal(manifest.binary.signature, 'NotSigned')
  assert.equal(manifest.releaseCreated, false)
  assert.equal(manifest.windowsDesktopManualAcceptance, 'pending')
  assert.equal(manifest.installedTest.status, 'not-run')
  assert.deepEqual(
    manifest.bundledPlugins.map((record) => record.name).sort(),
    inventory.map((entry) => entry.name),
  )
  const hashRecords = [
    { name: installerName, sha256: manifest.installer.sha256, bytes: manifest.installer.bytes },
    ...manifest.bundledPlugins,
  ]
  const checksums = []
  for (const record of hashRecords) {
    const data = await readFile(path.join(directory, record.name))
    assert.equal(data.length, record.bytes, 'Payload size changed after build')
    assert.equal(sha(data), record.sha256, 'Payload hash changed after build')
    checksums.push(`${record.sha256}  ${record.name}`)
  }
  assert.deepEqual(
    (await readFile(path.join(directory, 'SHA256SUMS.txt'), 'utf8'))
      .replace(/^\uFEFF/, '')
      .trim()
      .split(/\r?\n/)
      .sort(),
    checksums.sort(),
  )
  for (const entry of inventory) {
    const archive = await json(path.join(directory, entry.name))
    assert.equal(archive.format, 'milkup-plugin')
    assert.equal(archive.version, 1)
    assert.deepEqual(archive.manifest, await json(path.join(root, entry.directory, 'plugin.json')))
    assert.equal(archive.files.length, 1)
    assert.equal(archive.files[0].path, 'dist/plugin.js')
    assert.equal(archive.files[0].encoding, 'utf8')
    assert.equal(typeof archive.files[0].content, 'string')
  }
  return { status: 'passed', bytes, files: names, artifactLimitBytes: ARTIFACT_LIMIT }
}

async function main() {
  const [mode, rootArgument, output, expectedSha] = process.argv.slice(2)
  const root = path.resolve(rootArgument ?? '.')
  if (mode === 'inventory') {
    await writeFile(output, `${JSON.stringify(await readPluginInventory(root), null, 2)}\n`)
    return
  }
  if (mode === 'payload') {
    console.log(JSON.stringify(await verifyOfflinePayload(root, output, expectedSha)))
    return
  }
  assert.equal(mode, 'request', 'Expected request, inventory or payload mode')
  const request = await json(path.join(root, OFFLINE_REQUEST_PATH))
  const event = await json(process.env.GITHUB_EVENT_PATH)
  const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim()
  const ancestor = (commit) => {
    try {
      git('merge-base', '--is-ancestor', commit, 'HEAD')
      return true
    } catch {
      return false
    }
  }
  validateOfflineRequest(request, {
    repository: process.env.GITHUB_REPOSITORY,
    ref: process.env.GITHUB_REF,
    isPrivate: event.repository.private,
    runAttempt: process.env.GITHUB_RUN_ATTEMPT,
    commitMessage: event.head_commit.message,
    head: git('rev-parse', 'HEAD'),
    sha: process.env.GITHUB_SHA,
    clean: git('status', '--porcelain') === '',
    baselineAncestor: ancestor(OFFLINE_BASELINE),
    reviewedAncestor: request.reviewedSourceSha ? ancestor(request.reviewedSourceSha) : false,
    changedSinceReview: request.reviewedSourceSha
      ? git('diff', '--name-only', request.reviewedSourceSha, 'HEAD').split('\n').filter(Boolean)
      : [],
  })
  await appendFile(process.env.GITHUB_OUTPUT, 'approved=true\n')
  console.log(
    `Approved exactly one offline delivery for ${request.requestId}; source ${process.env.GITHUB_SHA}`,
  )
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href)
  await main()

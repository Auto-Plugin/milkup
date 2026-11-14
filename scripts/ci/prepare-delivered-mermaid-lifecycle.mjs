import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
const hash = (b) => createHash('sha256').update(b).digest('hex')
export const PIN = Object.freeze({
  source: 'd06d31486b349c51a183d022378b04138aa2ba16',
  run: '42569506864',
  installer: '0e6f44631600c420d0517ae6d6f3822f87271ca2721a818c73c6f7a274d3bee2',
  compiled: '4e5d7c1b97bdc160ee571def39944c14e24359502e08fe38a07c9331072a96fc',
  installed: 'e00dba6947c58711613548f2cdd2163b0ae7f45108ff87036e3f7ba87fc78088',
})
export function recoverComparisonInput(installed, expected) {
  assert(installed.length <= 64 * 1024 * 1024 && installed.length === expected.bytes)
  assert.equal(hash(installed), expected.installedSha)
  const nss = Buffer.from('__TAURI_BUNDLE_TYPE_VAR_NSS'),
    unk = Buffer.from('__TAURI_BUNDLE_TYPE_VAR_UNK')
  const offset = installed.indexOf(nss)
  assert(offset >= 0 && offset === expected.markerOffset)
  assert.equal(installed.indexOf(nss, offset + 1), -1)
  assert.equal(installed.indexOf(unk), -1)
  const comparison = Buffer.from(installed)
  unk.copy(comparison, offset)
  assert.equal(
    hash(comparison),
    expected.compiledSha,
    'Reconstructed bytes must match the original compiled digest',
  )
  return comparison
}
async function plain(file, limit = 128 * 1024 * 1024) {
  const stat = await lstat(file)
  assert(stat.isFile() && !stat.isSymbolicLink() && stat.size <= limit)
  const b = await readFile(file)
  assert.equal(b.length, stat.size)
  return b
}
async function files(root) {
  const out = []
  async function walk(dir) {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      assert(!e.isSymbolicLink())
      const p = path.join(dir, e.name)
      if (e.isDirectory()) await walk(p)
      else {
        assert(e.isFile())
        out.push(p)
      }
    }
  }
  await walk(root)
  return out
}
export async function prepare(delivery, inspection, extracted, output) {
  const json = async (p) => JSON.parse((await plain(p)).toString('utf8').replace(/^\uFEFF/, ''))
  const manifest = await json(path.join(delivery, 'manifest.json'))
  assert.equal(manifest.candidateSha, PIN.source)
  assert.equal(manifest.runId, PIN.run)
  assert.equal(manifest.deliveryReady, true)
  assert.equal(manifest.status, 'verified-for-user-trial')
  assert.equal(manifest.rendererMode, 'frontend')
  assert.equal(manifest.releaseCreated, false)
  const inventory = (await plain(path.join(delivery, 'SHA256SUMS.txt'), 65536))
    .toString()
    .trim()
    .split('\n')
  const names = new Set()
  for (const line of inventory) {
    const m = /^([a-f0-9]{64})  ([A-Za-z0-9_.\/-]+)$/.exec(line)
    assert(m)
    assert(!m[2].split('/').some((x) => x === '' || x === '.' || x === '..'))
    assert(!names.has(m[2]))
    names.add(m[2])
    assert.equal(hash(await plain(path.join(delivery, m[2]))), m[1])
  }
  assert.deepEqual(
    (await files(delivery))
      .map((p) => path.relative(delivery, p).replaceAll('\\', '/'))
      .filter((n) => n !== 'SHA256SUMS.txt')
      .sort(),
    [...names].sort(),
  )
  assert.equal(manifest.installer.sha256, PIN.installer)
  const installer = path.join(delivery, manifest.installer.deliveredName)
  const original = await plain(installer)
  assert.equal(hash(original), PIN.installer)
  const inputPath = path.join(inspection, 'installer-input.json'),
    input = await json(inputPath)
  assert.equal(input.candidateSha, PIN.source)
  assert.equal(input.rendererMode, 'frontend')
  assert.equal(input.builtBinarySha256, PIN.compiled)
  assert.equal(input.expectedInstalledBinarySha256, PIN.installed)
  assert.equal(manifest.compiledApplication.sha256, PIN.compiled)
  assert.equal(manifest.extractedApplication.sha256, PIN.installed)
  const matches = []
  for (const file of await files(extracted)) {
    const b = await plain(file)
    if (hash(b) === PIN.installed) matches.push({ file, bytes: b })
  }
  assert.equal(matches.length, 1, 'Exactly one pinned extracted image required')
  const comparison = recoverComparisonInput(matches[0].bytes, {
    installedSha: PIN.installed,
    compiledSha: PIN.compiled,
    bytes: manifest.compiledApplication.bytes,
    markerOffset: manifest.verification.embedded.markerOffset,
  })
  await mkdir(output)
  const binary = path.join(output, 'milkup-desktop.exe')
  await writeFile(binary, comparison, { flag: 'wx' })
  assert.deepEqual(await plain(installer), original, 'Original installer unchanged')
  assert.deepEqual(await plain(matches[0].file), matches[0].bytes, 'Extracted image unchanged')
  const receipt = {
    schema: 1,
    status: 'passed',
    applicationCandidateSha: PIN.source,
    sourceRunId: PIN.run,
    installer: { path: installer, sha256: PIN.installer },
    binary: {
      path: binary,
      sha256: PIN.compiled,
      role: 'reconstructedComparisonInput',
      executed: false,
    },
    packageManifest: { path: inputPath, sha256: hash(await plain(inputPath)) },
    installedSha256: PIN.installed,
    compiledInThisRun: false,
    installerModified: false,
    comparisonScope:
      'Only reverse the unique NSS marker on a COPY; verify full original compiled hash; never launch this comparison input',
    verifiedDeliveryFiles: names.size,
  }
  await writeFile(
    path.join(output, 'reuse-receipt.json'),
    JSON.stringify(receipt, null, 2) + '\n',
    { flag: 'wx' },
  )
  return receipt
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  assert.equal(process.argv.length, 6)
  console.log(JSON.stringify(await prepare(...process.argv.slice(2))))
}

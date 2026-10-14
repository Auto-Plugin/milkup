// Isolated-profile proof of the offline, retaining directory migration runbook.
// Never deletes a checkpoint, working buffer, archive, or pre-existing directory.
import assert from 'node:assert/strict'
import { mkdir, writeFile, readFile, readdir, lstat, rename } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { startProduction } from '../helpers/native-production.mjs'
import { ownedApplication } from '../helpers/native-owned-process.mjs'
const root = path.resolve(process.env.MILKUP_NATIVE_EVIDENCE_DIR)
const profile = path.resolve(process.env.MILKUP_RECOVERY_PROFILE)
await mkdir(root, { recursive: true })
const hash = (b) => createHash('sha256').update(b).digest('hex')
async function inventory(dir, prefix = '') {
  const result = []
  for (const name of (await readdir(dir)).sort()) {
    const relative = path.join(prefix, name),
      file = path.join(dir, name),
      info = await lstat(file)
    assert(
      !info.isSymbolicLink() && (info.isDirectory() || info.isFile()),
      'links and special files require separate review',
    )
    if (info.isDirectory()) result.push(...(await inventory(file, relative)))
    else result.push({ path: relative, bytes: info.size, sha256: hash(await readFile(file)) })
  }
  return result
}
async function moveNew(from, to) {
  assert.equal(
    await lstat(to).then(
      () => true,
      (e) => {
        if (e.code === 'ENOENT') return false
        throw e
      },
    ),
    false,
    'never overwrite an archive',
  )
  await rename(from, to) // same parent/filesystem; operator must have stopped every app using this profile
}
const results = []
let app
try {
  async function checkpoint(name, text) {
    const file = path.join(root, name + '.md')
    await writeFile(file, 'original\r\n', { flag: 'wx' })
    app = await startProduction(file, root)
    await app.focus('.milkup-input-proxy')
    await app.text(text)
    await app.until(
      () => app.execute('return document.querySelector("#app").dataset.recoveryPhase==="ready"'),
      'checkpoint',
    )
    let record
    for (const id of await readdir(profile)) {
      try {
        const r = JSON.parse(await readFile(path.join(profile, id, 'manifest.json'), 'utf8'))
        if (r.originalPath === file) record = r
      } catch {}
    }
    assert(record)
    const payload = await readFile(path.join(profile, record.id, record.payload))
    assert(payload.equals(Buffer.from(text + 'original\r\n')))
    const owner = await ownedApplication(app.application, file)
    const termination = await owner.signal('SIGKILL')
    await app.close()
    await app.until(
      async () =>
        !(await readFile(`/proc/${owner.identity.pid}/cmdline`, 'utf8').catch(() => ''))
          .split('\0')
          .includes(file),
      'owned app stopped',
    )
    app = undefined
    results.push({
      kind: 'checkpoint',
      name,
      recordId: record.id,
      payloadSha256: hash(payload),
      termination,
    })
    return { file, record, payload }
  }
  const old = await checkpoint('old', 'RETAINED19')
  const oldInventory = await inventory(profile)
  const archive = profile + '-retained-phase19'
  await moveNew(profile, archive)
  assert.deepEqual(await inventory(archive), oldInventory)
  const fresh = await checkpoint('fresh', 'NEW19')
  const freshInventory = await inventory(profile)
  const freshArchive = profile + '-new-retained-phase19'
  await moveNew(profile, freshArchive)
  await moveNew(archive, profile)
  assert.deepEqual(await inventory(profile), oldInventory)
  assert.deepEqual(await inventory(freshArchive), freshInventory)
  results.push({
    kind: 'offline-roundtrip',
    oldInventory,
    freshInventory,
    freshArchive,
    activeRoot: profile,
    retainedAllBytes: true,
    freedFilesystemBytes: 0,
  })
  app = await startProduction(old.file, root)
  await app.until(
    () =>
      app.execute(
        'return !!document.querySelector(arguments[0])',
        `[data-recovery-restore="${old.record.id}"]`,
      ),
    'old record available after directory return',
  )
  await app.shot('retained-directory-returned')
  await app.click(`[data-recovery-restore="${old.record.id}"]`)
  await app.until(
    async () => (await app.probe()).path.includes('/copies/recovered-'),
    'restored copy',
  )
  const restoredPath = (await app.probe()).path
  assert((await readFile(restoredPath)).equals(old.payload))
  assert.equal(await readFile(old.file, 'utf8'), 'original\r\n')
  assert(
    (await readFile(path.join(profile, old.record.id, old.record.payload))).equals(old.payload),
  )
  assert.deepEqual(await inventory(freshArchive), freshInventory)
  assert(
    (await readFile(path.join(freshArchive, fresh.record.id, fresh.record.payload))).equals(
      fresh.payload,
    ),
  )
  await app.shot('retained-copy-restored')
  results.push({
    kind: 'restore-old-keep-new',
    restoredPath,
    sha256: hash(old.payload),
    originalUnchanged: true,
    newArchiveUnchanged: true,
  })
} catch (error) {
  results.push({ kind: 'failure', error: String(error) })
  await app?.shot('failure').catch(() => {})
  throw error
} finally {
  await writeFile(path.join(root, 'results.json'), JSON.stringify(results, null, 2))
  await app?.close()
}

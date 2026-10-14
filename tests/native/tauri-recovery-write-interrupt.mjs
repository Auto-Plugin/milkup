// Production crash while a new recovery payload is only partially written.
// Wait for the owned process to exit after SIGKILL, then verify the strict prefix.
// Sending SIGSTOP alone is not an acknowledgement that every thread has stopped.
import assert from 'node:assert/strict'
import { mkdir, copyFile, readFile, writeFile, readdir, stat } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { startProduction } from '../helpers/native-production.mjs'
import { ownedApplication } from '../helpers/native-owned-process.mjs'
const root = path.resolve(process.env.MILKUP_NATIVE_EVIDENCE_DIR)
const profile = path.resolve(process.env.MILKUP_RECOVERY_PROFILE)
assert(process.env.MILKUP_SEARCH_FIXTURE)
await mkdir(root, { recursive: true })
const file = path.join(root, 'partial-write.md')
await copyFile(process.env.MILKUP_SEARCH_FIXTURE, file)
const original = await readFile(file),
  first = Buffer.concat([Buffer.from('BASE21'), original]),
  next = Buffer.concat([Buffer.from('BASE21NEXT21'), original])
const hash = (b) => createHash('sha256').update(b).digest('hex')
const evidence = { original: { bytes: original.length, sha256: hash(original) }, events: [] }
let app, owner
try {
  app = await startProduction(file, root)
  await app.focus('.milkup-input-proxy')
  await app.text('BASE21')
  await app.until(
    () => app.execute('return document.querySelector("#app").dataset.recoveryPhase==="ready"'),
    'first durable point',
  )
  let record
  for (const id of await readdir(profile)) {
    try {
      const r = JSON.parse(await readFile(path.join(profile, id, 'manifest.json'), 'utf8'))
      if (r.originalPath === file) record = r
    } catch {}
  }
  assert(record)
  const dir = path.join(profile, record.id),
    manifest = path.join(dir, 'manifest.json')
  assert((await readFile(path.join(dir, record.payload))).equals(first))
  evidence.before = record
  owner = await ownedApplication(app.application, file)
  await app.text('NEXT21')
  const deadline = Date.now() + 15000
  let unpublished, partial
  while (Date.now() < deadline && !unpublished) {
    const latest = JSON.parse(await readFile(manifest, 'utf8'))
    assert.equal(
      latest.payload,
      record.payload,
      'publication already completed; do not claim this crash boundary',
    )
    for (const name of await readdir(dir)) {
      if (!/^snapshot-\d+$/.test(name) || name === record.payload || name === record.previous)
        continue
      const size = (await stat(path.join(dir, name))).size
      if (size > 0 && size < next.length) {
        unpublished = name
        break
      }
    }
    if (!unpublished) await app.delay(2)
  }
  assert(unpublished, 'partial uncommitted payload observed within existing functional budget')
  evidence.events.push({
    kind: 'partial-size-observed',
    wall: Date.now(),
    payload: unpublished,
    bytes: (await stat(path.join(dir, unpublished))).size,
  })
  evidence.events.push(await owner.signal('SIGKILL'))
  await app.until(async () => {
    try {
      const value = await readFile(`/proc/${owner.identity.pid}/stat`, 'utf8')
      const fields = value.slice(value.lastIndexOf(')') + 2).split(' ')
      return fields[19] !== owner.identity.birth || fields[0] === 'Z'
    } catch (error) {
      if (error.code === 'ENOENT') return true
      throw error
    }
  }, 'owned killed process exited')
  await app.close()
  app = undefined
  assert.equal(JSON.parse(await readFile(manifest, 'utf8')).payload, record.payload)
  partial = await readFile(path.join(dir, unpublished))
  assert(partial.length > 0 && partial.length < next.length, 'process exited during partial write')
  assert(partial.equals(next.subarray(0, partial.length)))
  assert((await readFile(file)).equals(original))
  evidence.unpublished = {
    payload: unpublished,
    bytes: partial.length,
    sha256: hash(partial),
    expectedCompleteBytes: next.length,
    manifestStillPrevious: true,
  }
  app = await startProduction(file, root)
  await app.until(
    () =>
      app.execute(
        'return !!document.querySelector(arguments[0])',
        `[data-recovery-restore="${record.id}"]`,
      ),
    'previous completed point offered',
  )
  await app.shot('previous-point-after-interrupted-publication')
  await app.click(`[data-recovery-restore="${record.id}"]`)
  await app.until(
    async () => (await app.probe()).path.includes('/copies/recovered-'),
    'verified recovery copy',
  )
  const restored = (await app.probe()).path
  assert((await readFile(restored)).equals(first))
  assert((await readFile(path.join(dir, unpublished))).equals(partial))
  assert((await readFile(path.join(dir, record.payload))).equals(first))
  assert((await readFile(file)).equals(original))
  evidence.restored = { path: restored, bytes: first.length, sha256: hash(first) }
  evidence.ok = true
  await app.shot('previous-point-restored')
} catch (error) {
  evidence.ok = false
  evidence.error = String(error)
  throw error
} finally {
  await writeFile(path.join(root, 'results.json'), JSON.stringify(evidence, null, 2))
  await app?.close()
}

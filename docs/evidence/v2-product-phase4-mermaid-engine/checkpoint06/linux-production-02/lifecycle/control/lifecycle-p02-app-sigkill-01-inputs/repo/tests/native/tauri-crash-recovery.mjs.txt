import assert from 'node:assert/strict'
import { mkdir, writeFile, readFile, readdir, copyFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { startProduction } from '../helpers/native-production.mjs'
import { ownedApplication } from '../helpers/native-owned-process.mjs'
const root = process.env.MILKUP_NATIVE_EVIDENCE_DIR ?? '/tmp/milkup-v2-phase17/native-recovery'
const profile =
  process.env.MILKUP_RECOVERY_PROFILE ??
  '/tmp/milkup-v2-phase17/runtime/data/app.milkup.desktop/recovery-v1'
await mkdir(root, { recursive: true })
const results = []
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex')
async function records() {
  const output = []
  for (const name of await readdir(profile).catch(() => [])) {
    if (name === 'copies') continue
    try {
      const record = JSON.parse(await readFile(path.join(profile, name, 'manifest.json'), 'utf8'))
      output.push({ ...record, directory: path.join(profile, name) })
    } catch {}
  }
  return output
}
async function screenshot(app, dir, name) {
  await app.delay(250)
  execFileSync('import', ['-window', 'root', path.join(dir, name + '.png')], {
    env: { ...process.env, DISPLAY: process.env.DISPLAY ?? ':99' },
  })
}
async function recoveryReady(app) {
  return app.until(
    () =>
      app.execute(
        'return document.querySelector("#app").dataset.recoveryPhase==="ready" && Number(document.querySelector("#app").dataset.recoveryVersion)===Number(document.querySelector("[data-stat=version]").textContent)',
      ),
    'durable checkpoint',
  )
}
async function modal(app) {
  await app.until(
    () => app.execute('return !document.querySelector(".recovery-overlay").hidden'),
    'recovery prompt',
  )
}
async function restore(app, record) {
  await app.click(`[data-recovery-restore="${record.id}"]`)
  await app.until(async () => {
    const p = await app.probe()
    return p.path.includes('/copies/recovered-') && p.loading === 'ready'
  }, 'recovery copy opened')
  const recovered = (await app.probe()).path
  return { recovered, bytes: await readFile(recovered) }
}
for (const kind of ['untitled', 'existing', 'large', 'utf16']) {
  if (process.env.MILKUP_NATIVE_CASE && process.env.MILKUP_NATIVE_CASE !== kind) continue
  const dir = path.join(root, kind)
  await mkdir(dir, { recursive: true })
  const file = path.join(dir, 'original.md')
  const original =
    kind === 'utf16'
      ? Buffer.concat([
          Buffer.from([255, 254]),
          Buffer.from(
            'BASE\r\n' + '中文😀 abcdefghijklmnopqrstuvwxyz\r\n'.repeat(40000),
            'utf16le',
          ),
        ])
      : Buffer.from(
          kind === 'large'
            ? 'BASE\r\n' + 'row 中文😀 abcdefghijklmnopqrstuvwxyz\r\n'.repeat(60000)
            : 'ORIGINAL\r\n',
        )
  await writeFile(file, original)
  let app = await startProduction(file, dir)
  const entry = { kind, originalSha256: sha(original) }
  try {
    await app.delay(350)
    if (await app.execute('return !document.querySelector(".recovery-overlay").hidden'))
      await app.click('[data-recovery-close]')
    if (kind === 'untitled') {
      await app.key('ctrl+n')
      await app.until(
        () => app.execute('return document.querySelector("[data-title]").textContent==="未命名"'),
        'untitled',
      )
    }
    await app.text('CHECKPOINT17')
    await app.until(async () => (await app.probe()).dirty, 'accepted input')
    await recoveryReady(app)
    const [record] = (await records())
      .filter(
        (r) =>
          r.disposition === 'pending' &&
          (kind === 'untitled' ? r.originalPath === null : r.originalPath === file),
      )
      .sort((a, b) => b.createdAt - a.createdAt)
    assert(record)
    const expected =
      kind === 'utf16'
        ? Buffer.concat([
            original.subarray(0, 2),
            Buffer.from('CHECKPOINT17', 'utf16le'),
            original.subarray(2),
          ])
        : kind === 'untitled'
          ? Buffer.from('CHECKPOINT17')
          : Buffer.concat([Buffer.from('CHECKPOINT17'), original])
    assert.deepEqual(await readFile(path.join(record.directory, record.payload)), expected)
    entry.checkpoint = { ...record }
    entry.expectedSha256 = sha(expected)
    await screenshot(app, dir, 'checkpoint-before-kill')
    const owner = await ownedApplication(app.application, file)
    entry.termination = await owner.signal('SIGKILL')
    await app.close()
    app = await startProduction(file, dir)
    await modal(app)
    await screenshot(app, dir, 'restart-prompt')
    if (kind === 'existing') {
      // The original changes independently while the recovery point remains immutable.
      await writeFile(file, 'EXTERNAL NEW CONTENT\r\n')
    }
    const recovered = await restore(app, record)
    assert.deepEqual(recovered.bytes, expected)
    entry.recoveredPath = recovered.recovered
    entry.recoveredSha256 = sha(recovered.bytes)
    assert.deepEqual(
      await readFile(file),
      kind === 'existing' ? Buffer.from('EXTERNAL NEW CONTENT\r\n') : original,
    )
    await screenshot(app, dir, 'restored-copy')
    await app.close()
    app = await startProduction(file, dir)
    await app.delay(350)
    assert(
      await app.execute(`return !document.querySelector('[data-recovery-restore="${record.id}"]')`),
      'restored record is archived, not prompted repeatedly',
    )
    assert.deepEqual(await readFile(path.join(record.directory, record.payload)), expected)
    entry.ok = true
  } catch (error) {
    entry.ok = false
    entry.error = String(error)
    await screenshot(app, dir, 'failure').catch(() => {})
    throw error
  } finally {
    results.push(entry)
    await writeFile(path.join(root, 'results.json'), JSON.stringify(results, null, 2) + '\n')
    await app.close()
  }
}
console.log(JSON.stringify(results.map((r) => ({ kind: r.kind, ok: r.ok }))))

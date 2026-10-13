import assert from 'node:assert/strict'
import { mkdir, writeFile, readFile, readdir, copyFile, stat } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { startProduction } from '../helpers/native-production.mjs'
import { ownedApplication } from '../helpers/native-owned-process.mjs'
const root = process.env.MILKUP_NATIVE_EVIDENCE_DIR ?? '/tmp/milkup-v2-phase17/lifecycle'
const profile =
  process.env.MILKUP_RECOVERY_PROFILE ??
  '/tmp/milkup-v2-phase17/runtime/data/app.milkup.desktop/recovery-v1'
const runtimeTmp = '/tmp/milkup-v2-phase17/runtime/tmp'
await mkdir(root, { recursive: true })
const results = []
const hash = (b) => createHash('sha256').update(b).digest('hex')
async function recordFor(file) {
  const records = []
  for (const id of await readdir(profile)) {
    try {
      const r = JSON.parse(await readFile(path.join(profile, id, 'manifest.json'), 'utf8'))
      if (r.originalPath === file) records.push(r)
    } catch {}
  }
  return records.sort((a, b) => b.createdAt - a.createdAt)[0]
}
async function closePrompt(app) {
  await app.delay(300)
  if (await app.execute('return !document.querySelector(".recovery-overlay").hidden'))
    await app.click('[data-recovery-close]')
}
async function ready(app) {
  await app.until(
    () => app.execute('return document.querySelector("#app").dataset.recoveryPhase==="ready"'),
    'checkpoint',
  )
}
async function menu(app) {
  await app.click('[data-menu-toggle]')
  await app.click('[data-open-recovery]')
  await app.until(
    () => app.execute('return !document.querySelector(".recovery-overlay").hidden'),
    'recovery menu',
  )
}
async function run(kind, fn) {
  const dir = path.join(root, kind)
  await mkdir(dir, { recursive: true })
  const file = path.join(dir, 'original.md')
  let app
  const entry = { kind }
  try {
    await fn({ dir, file, entry, setApp: (v) => (app = v) })
    entry.ok = true
  } catch (error) {
    entry.ok = false
    entry.error = String(error)
    await app?.shot('failure').catch(() => {})
    throw error
  } finally {
    results.push(entry)
    await writeFile(path.join(root, 'results.json'), JSON.stringify(results, null, 2))
    await app?.close()
  }
}
if (!process.env.MILKUP_NATIVE_CASE || process.env.MILKUP_NATIVE_CASE === 'lifecycle')
  await run('lifecycle', async ({ dir, file, entry, setApp }) => {
    await writeFile(file, 'original\r\n')
    let app = await startProduction(file, dir)
    setApp(app)
    await closePrompt(app)
    await app.text('DURABLE')
    await ready(app)
    const r = await recordFor(file),
      payload = path.join(profile, r.id, r.payload),
      expected = await readFile(payload)
    await menu(app)
    assert(
      await app.execute(`return !document.querySelector('[data-recovery-restore="${r.id}"]')`),
      'active owner is not offered',
    )
    await app.click('[data-recovery-close]')
    const owner = await ownedApplication(app.application, file)
    await app.text('NOTCHECKPOINTED')
    entry.lastObserved = await app.probe()
    entry.termination = await owner.signal('SIGKILL')
    await app.close()
    app = await startProduction(file, dir)
    setApp(app)
    await app.until(
      () => app.execute(`return !!document.querySelector('[data-recovery-restore="${r.id}"]')`),
      'pending record',
    )
    assert.deepEqual(await readFile(payload), expected)
    const backgroundPath = (await app.probe()).path
    for (let n = 0; n < 4; n++) {
      await app.key('Tab')
      assert(
        await app.execute('return !!document.activeElement.closest(".recovery-overlay")'),
        'modal retains keyboard focus',
      )
    }
    await app.key('ctrl+n')
    assert.equal((await app.probe()).path, backgroundPath)
    entry.retainedSha256 = hash(expected)
    entry.lossBoundary = 'last completed checkpoint; suffix typed immediately before kill absent'
    await app.shot('pending-after-kill')
    await app.click('[data-recovery-close]')
    await app.close()
    app = await startProduction(file, dir)
    setApp(app)
    await app.until(
      () => app.execute(`return !!document.querySelector('[data-recovery-dismiss="${r.id}"]')`),
      'pending again',
    )
    // Corruption is confined to our isolated checkpoint, retaining its original bytes separately.
    await copyFile(payload, path.join(dir, 'payload-before-corruption.bin'))
    await writeFile(payload, Buffer.concat([expected, Buffer.from('CORRUPT')]))
    await app.click(`[data-recovery-restore="${r.id}"]`)
    await app.until(
      async () => (await app.probe()).notice.includes('校验失败'),
      'visible checksum failure',
    )
    assert.equal(await readFile(file, 'utf8'), 'original\r\n')
    assert.equal((await recordFor(file)).disposition, 'pending')
    await app.shot('checksum-error')
    await writeFile(payload, expected)
    await menu(app)
    await app.click(`[data-recovery-dismiss="${r.id}"]`)
    await app.until(async () => (await recordFor(file)).disposition === 'dismissed', 'archived')
    assert.deepEqual(await readFile(payload), expected)
    await app.click('[data-recovery-close]')
    await app.close()
    app = await startProduction(file, dir)
    setApp(app)
    await closePrompt(app)
    await menu(app)
    await app.until(
      () => app.execute(`return !!document.querySelector('[data-recovery-restore="${r.id}"]')`),
      'archived available',
    )
    await app.click(`[data-recovery-restore="${r.id}"]`)
    await app.until(
      async () => (await app.probe()).path.includes('/copies/recovered-'),
      'restored archived',
    )
    assert.deepEqual(await readFile((await app.probe()).path), expected)
    await app.shot('archived-restored')
  })
if (process.env.MILKUP_NATIVE_CASE === 'large-pending')
  await run('large-pending', async ({ dir, file, entry, setApp }) => {
    assert(process.env.MILKUP_SEARCH_FIXTURE)
    await copyFile(process.env.MILKUP_SEARCH_FIXTURE, file)
    const original = await readFile(file)
    let app = await startProduction(file, dir)
    setApp(app)
    await closePrompt(app)
    await app.text('CHECKPOINT17')
    await ready(app)
    const owner = await ownedApplication(app.application, file)
    await app.text('NEXT')
    // Observe a real full checkpoint occupying the native document lock, then
    // deliver system keys while the WebView remains responsive.
    await app.until(
      () => app.execute('return document.querySelector("#app").dataset.recoveryPhase==="writing"'),
      'real checkpoint writing',
    )
    await app.text('PENDINGBATCH')
    entry.visibleBeforeKill = await app.until(
      () =>
        app.execute(
          'const line=document.querySelector(".milkup-line")?.textContent;return line?.includes("CHECKPOINT17NEXTP")?{line,version:document.querySelector("[data-stat=version]")?.textContent,recovery:document.querySelector("#app").dataset.recoveryPhase}:null',
        ),
      'visible prefix of submitted keyboard sequence',
    )
    assert(entry.visibleBeforeKill.line?.includes('CHECKPOINT17NEXTP'))
    entry.submittedKeys = 'PENDINGBATCH'
    entry.stop = await owner.signal('SIGSTOP')
    let r, expected
    try {
      const addName = (await readdir(dir)).find(
        (n) => n.includes(`.milkup-large.${owner.identity.pid}.`) && n.endsWith('.add.work'),
      )
      assert(addName, 'owned add buffer exists')
      const add = await readFile(path.join(dir, addName), 'utf8')
      entry.acceptedAddBuffer = add
      assert(
        !add.includes('PENDINGBATCH'),
        'the whole submitted keyboard sequence has not committed in the backend',
      )
      r = await recordFor(file)
      expected = await readFile(path.join(profile, r.id, r.payload))
      entry.checkpoint = r
      assert(!expected.subarray(0, 100).includes(Buffer.from('PENDINGBATCH')))
      execFileSync('import', ['-window', 'root', path.join(dir, 'pending-backend-batch.png')], {
        env: { ...process.env, DISPLAY: process.env.DISPLAY ?? ':99' },
      })
      entry.termination = await owner.signal('SIGKILL')
    } finally {
      if (!entry.termination) await owner.signal('SIGCONT')
    }
    entry.checkpointBeforeKill = r
    r = await recordFor(file)
    expected = await readFile(path.join(profile, r.id, r.payload))
    entry.checkpointAfterKill = r
    entry.expectedSha256 = hash(expected)
    await writeFile(path.join(dir, 'interruption.json'), JSON.stringify(entry, null, 2))
    await app.close()
    assert((await readFile(file)).equals(original), 'original bytes unchanged')
    app = await startProduction(file, dir)
    setApp(app)
    await app.until(
      () => app.execute(`return !!document.querySelector('[data-recovery-restore="${r.id}"]')`),
      'pending batch recovery',
    )
    await app.click(`[data-recovery-restore="${r.id}"]`)
    await app.until(
      async () => {
        const p = await app.probe()
        return p.path.includes('/copies/recovered-') && p.loading === 'ready'
      },
      'checkpoint copy',
      20000,
    )
    const actual = await readFile((await app.probe()).path)
    entry.recoveredSha256 = hash(actual)
    await writeFile(
      path.join(dir, 'comparison.json'),
      JSON.stringify(
        {
          expectedBytes: expected.length,
          actualBytes: actual.length,
          expectedSha256: hash(expected),
          actualSha256: hash(actual),
        },
        null,
        2,
      ),
    )
    assert(actual.equals(expected), 'complete restored bytes equal published checkpoint')
    entry.expectedSha256 = hash(expected)
    entry.recoveredSha256 = hash(actual)
    entry.lossBoundary =
      'submitted keyboard sequence was only partly processed; restore returns only the published checkpoint'
    await app.shot('pending-batch-restarted')
  })
for (const kind of ['save-interrupt', 'replace-interrupt']) {
  if (process.env.MILKUP_NATIVE_CASE && process.env.MILKUP_NATIVE_CASE !== kind) continue
  await run(kind, async ({ dir, file, entry, setApp }) => {
    const fixture = process.env.MILKUP_SEARCH_FIXTURE
    assert(fixture)
    await copyFile(fixture, file)
    const original = await readFile(file)
    entry.originalBytes = original.length
    entry.originalSha256 = hash(original)
    let app = await startProduction(file, dir)
    setApp(app)
    await closePrompt(app)
    await app.text('CHECKPOINT17')
    await ready(app)
    const r = await recordFor(file),
      expected = Buffer.concat([Buffer.from('CHECKPOINT17'), original])
    assert.deepEqual(await readFile(path.join(profile, r.id, r.payload)), expected)
    const owner = await ownedApplication(app.application, file)
    if (kind === 'replace-interrupt') {
      await app.key('ctrl+f')
      await app.focus('[data-search-input]')
      await app.text('tailneedle')
      await app.until(
        async () => {
          const p = await app.probe()
          return !p.searching && p.count === '1/1' && !p.replaceDisabled
        },
        'complete full fixture search',
        125000,
      )
      await app.focus('[data-replace-input]')
      await app.text('REPLACED')
    }
    let stopped = false
    const watch = (async () => {
      const started = Date.now()
      while (Date.now() - started < 15000) {
        let candidate
        if (kind === 'save-interrupt')
          candidate = (await readdir(dir)).find((n) => n.endsWith('.save-as.tmp'))
        else {
          for (const n of await readdir(runtimeTmp)) {
            if (!n.startsWith(`milkup-search-${owner.identity.pid}-`)) continue
            const f = path.join(runtimeTmp, n, 'before.utf8')
            if (await stat(f).catch(() => null)) {
              candidate = f
              break
            }
          }
        }
        if (candidate) {
          entry.stop = await owner.signal('SIGSTOP')
          stopped = true
          const target = path.isAbsolute(candidate) ? candidate : path.join(dir, candidate)
          entry.interruptedArtifact = { path: target, size: (await stat(target)).size }
          entry.termination = await owner.signal('SIGKILL')
          return
        }
        await new Promise((r) => setTimeout(r, 2))
      }
      throw Error('No real preparation artifact observed within existing budget')
    })()
    watch.catch(() => {})
    try {
      if (kind === 'save-interrupt') await app.key('ctrl+s')
      else await app.click('[data-replace-all]')
      await watch
    } finally {
      if (stopped && !entry.termination) await owner.signal('SIGCONT')
    }
    await app.close()
    assert.deepEqual(await readFile(file), original)
    app = await startProduction(file, dir)
    setApp(app)
    await app.until(
      () => app.execute(`return !!document.querySelector('[data-recovery-restore="${r.id}"]')`),
      'interrupted operation recovery',
    )
    await app.shot('restart-prompt')
    await app.click(`[data-recovery-restore="${r.id}"]`)
    await app.until(
      async () => {
        const p = await app.probe()
        return p.path.includes('/copies/recovered-') && p.loading === 'ready'
      },
      'recovered full file',
      20000,
    )
    const actual = await readFile((await app.probe()).path)
    assert.deepEqual(actual, expected)
    entry.recoveredSha256 = hash(actual)
    entry.expectedSha256 = hash(expected)
    assert.deepEqual(await readFile(file), original)
    await app.shot('restored')
  })
}
console.log(JSON.stringify(results))

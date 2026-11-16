// Next same-package installed acceptance. Real native read + ordinary system keys;
// only response delivery is delayed by a bounded, explicitly recorded test gate.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, readlink, realpath, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { startProduction } from '../helpers/native-production.mjs'
import { installNativeReloadGate } from '../helpers/native-reload-gate.mjs'
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex')
const x = (...args) => execFileSync('xdotool', args, { encoding: 'utf8', timeout: 10000 }).trim()
const birth = async (pid) =>
  (await readFile(`/proc/${pid}/stat`, 'utf8')).split(') ').at(-1).split(' ')[19]
// No implicit paths or mutation of an existing profile/document.
for (const key of [
  'RUNNER_TEMP',
  'DISPLAY',
  'TAURI_APP_PATH',
  'MILKUP_NATIVE_PROFILE_ROOT',
  'MILKUP_NATIVE_EVIDENCE_DIR',
  'MILKUP_NATIVE_PACKAGE_MANIFEST',
  'MILKUP_NATIVE_EXTRACTED_APP',
  'MILKUP_NATIVE_EXPECTED_BINARY_SHA256',
  'MILKUP_NATIVE_CLOSE_HELPER',
])
  assert(process.env[key], key)
assert.equal(process.platform, 'linux')
assert.notEqual(process.getuid(), 0)
assert.equal(process.env.MILKUP_NATIVE_EXCLUSIVE_DISPLAY, '1')
for (const key of [
  'WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS',
  'LD_LIBRARY_PATH',
  'LD_PRELOAD',
  'MILKUP_RESEARCH_RUNTIME_PREFIX',
])
  assert(!process.env[key], 'Default installed runtime: ' + key)
const temporary = await realpath(process.env.RUNNER_TEMP)
const profile = await realpath(process.env.MILKUP_NATIVE_PROFILE_ROOT)
assert(profile.startsWith(temporary + path.sep))
for (const key of [
  'XDG_DATA_HOME',
  'XDG_CONFIG_HOME',
  'XDG_CACHE_HOME',
  'XDG_STATE_HOME',
  'XDG_RUNTIME_DIR',
])
  assert((await realpath(process.env[key])).startsWith(profile + path.sep), key)
const evidence = await realpath(process.env.MILKUP_NATIVE_EVIDENCE_DIR)
assert(evidence.startsWith(temporary + path.sep))
const out = path.join(evidence, 'external-reload')
await mkdir(out, { recursive: false })
const report = {
  schema: 1,
  status: 'running',
  nativePassed: false,
  schedule: 'real native read; test-only delayed delivery, no editor mutation',
  cases: [],
  errors: [],
}
const persist = () => writeFile(path.join(out, 'result.json'), JSON.stringify(report, null, 2))
const application = await realpath(process.env.TAURI_APP_PATH)
let app, owned, row
async function verifyOwned() {
  assert(owned)
  assert.equal(await birth(owned.pid), owned.birth)
  assert.equal(await readlink(`/proc/${owned.pid}/exe`), application)
  assert.equal(Number(x('getwindowpid', owned.window)), owned.pid)
}
async function observe() {
  await verifyOwned()
  return {
    ...(await app.probe()),
    ...(await app.execute(`return {
    visible:document.querySelector('.milkup-editor-content')?.textContent,
    external:document.querySelector('[data-stat="external"]')?.textContent,
    at:performance.now(), gate:window.__reloadAcceptanceGate?{
      calls:window.__reloadAcceptanceGate.calls,received:window.__reloadAcceptanceGate.received,
      delivered:window.__reloadAcceptanceGate.delivered,timedOut:window.__reloadAcceptanceGate.timedOut,
      events:window.__reloadAcceptanceGate.events}:null}`)),
  }
}
async function normalClose(failureCleanup = false) {
  await verifyOwned()
  const before = await observe()
  row.close = { ...owned, before, failureCleanup, forced: false, processGone: false }
  await persist()
  row.close.request = JSON.parse(
    execFileSync(process.env.MILKUP_NATIVE_CLOSE_HELPER, [owned.window, String(owned.pid)], {
      encoding: 'utf8',
      timeout: 5000,
    }),
  )
  if (before.dirty) {
    await app.until(
      () =>
        app.execute(
          'return !document.querySelector("[data-close-confirm]")?.hidden && !!document.querySelector("[data-close-confirm-action=discard]")',
        ),
      'synthetic close confirmation',
    )
    await app.click('[data-close-confirm-action=discard]')
    row.close.explicitlyDiscardedOnlySyntheticUnsavedText = true
  }
  const expected = { ...owned }
  await app.until(
    async () => {
      try {
        return (await birth(expected.pid)) !== expected.birth
      } catch (e) {
        if (e.code === 'ENOENT') return true
        throw e
      }
    },
    'exact process normal exit',
    20000,
  )
  row.close.processGone = true
  owned = null
  await app.close()
  app = null
  await persist()
}
try {
  await persist()
  const manifestPath = process.env.MILKUP_NATIVE_PACKAGE_MANIFEST
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  assert(/^[a-f0-9]{40}$/.test(manifest.sourceSha))
  assert.equal(path.basename(manifest.installer.name), manifest.installer.name)
  const bytes = await readFile(path.join(path.dirname(manifestPath), manifest.installer.name))
  assert.equal(bytes.length, manifest.installer.bytes)
  assert.equal(hash(bytes), manifest.installer.sha256)
  const binaryHash = hash(await readFile(application))
  assert.equal(binaryHash, process.env.MILKUP_NATIVE_EXPECTED_BINARY_SHA256)
  assert.equal(binaryHash, hash(await readFile(process.env.MILKUP_NATIVE_EXTRACTED_APP)))
  report.package = manifest
  report.binarySha256 = binaryHash
  for (const kind of ['normal', 'late-edit', 'switch-document']) {
    row = { kind, status: 'running' }
    report.cases.push(row)
    await persist()
    const dir = path.join(out, kind)
    await mkdir(dir)
    const file = path.join(dir, 'synthetic.md')
    const original = 'ORIGINAL-' + kind,
      external = 'EXTERNAL-' + kind
    await writeFile(file, original, { flag: 'wx' })
    app = await startProduction(file, dir, { diagnostics: false })
    const windows = x('search', '--onlyvisible', '--class', 'milkup-desktop').split('\n')
    assert.equal(windows.length, 1, 'exclusive test display')
    const window = windows[0],
      pid = Number(x('getwindowpid', window))
    owned = { window, pid, birth: await birth(pid) }
    row.owner = owned
    await verifyOwned()
    await app.key('ctrl+1')
    await app.until(
      async () => (await observe()).visible === original,
      'original entire source text',
    )
    await writeFile(file, external)
    await app.until(
      async () => (await observe()).external === 'modified-clean',
      'real external watcher notification',
    )
    await app.execute(`return (${installNativeReloadGate.toString()})(arguments[0])`, file)
    await app.focus('.milkup-input-proxy')
    await app.key('ctrl+r')
    await app.until(async () => (await observe()).gate?.received, 'real native result held')
    row.received = await observe()
    await persist()
    if (kind === 'late-edit') {
      await app.focus('.milkup-input-proxy')
      await app.key('ctrl+End')
      await app.text('-UNSAVED')
      await app.until(async () => {
        const s = await observe()
        return s.dirty && s.visible === original + '-UNSAVED'
      }, 'late real edit')
    } else if (kind === 'switch-document') {
      await app.key('ctrl+n')
      await app.until(async () => {
        const s = await observe()
        return s.path !== file && s.visible === ''
      }, 'new document')
      await app.focus('.milkup-input-proxy')
      await app.text('OTHER-DOCUMENT-UNSAVED')
      await app.until(async () => {
        const s = await observe()
        return s.dirty && s.visible === 'OTHER-DOCUMENT-UNSAVED'
      }, 'other document edit')
    }
    row.beforeDelivery = await observe()
    await persist()
    await app.execute(
      'window.__reloadAcceptanceGate.release(); requestAnimationFrame(()=>requestAnimationFrame(()=>window.__reloadAcceptanceSettled=true)); return true',
    )
    await app.until(
      () => app.execute('return window.__reloadAcceptanceSettled===true'),
      'post-delivery layout',
    )
    row.afterDelivery = await observe()
    await persist()
    const after = row.afterDelivery
    assert.equal(after.gate.calls, 1)
    assert.equal(after.gate.delivered, true)
    assert.equal(after.gate.timedOut, false)
    assert.deepEqual(
      after.gate.events.map((e) => e.phase),
      ['invoked', 'native-result', 'delivered'],
    )
    assert(
      after.gate.events[1].at <= row.beforeDelivery.at &&
        row.beforeDelivery.at <= after.gate.events[2].at,
    )
    if (kind === 'normal') {
      assert.equal(after.visible, external)
      assert.equal(after.dirty, false)
      assert.equal(after.path, file)
      assert.equal(after.external, 'none')
    } else {
      assert.equal(after.visible, row.beforeDelivery.visible)
      assert.equal(after.path, row.beforeDelivery.path)
      assert.equal(after.version, row.beforeDelivery.version)
      assert.equal(after.dirty, true)
    }
    assert.equal(await readFile(file, 'utf8'), external, 'disk version never overwritten')
    row.diskSha256 = hash(await readFile(file))
    await app.shot('after-delivery')
    await app.execute('window.__reloadAcceptanceGate.restore(); return true')
    await normalClose()
    assert.equal(await readFile(file, 'utf8'), external, 'normal close preserves external bytes')
    row.status = 'passed'
    await persist()
  }
} catch (error) {
  report.errors.push(String(error))
  if (row) row.status = 'failed-or-blocked'
  if (app) {
    report.failure = await observe().catch((e) => ({ error: String(e) }))
    await app.shot('failure').catch(() => {})
  }
} finally {
  await persist()
  if (app && owned) {
    try {
      await app.execute('window.__reloadAcceptanceGate?.restore(); return true')
      await normalClose(true)
    } catch (error) {
      report.errors.push('normal cleanup: ' + String(error))
      await persist()
    }
  }
  report.nativePassed =
    report.errors.length === 0 &&
    report.cases.length === 3 &&
    report.cases.every(
      (c) =>
        c.status === 'passed' && c.close?.processGone && !c.close.failureCleanup && !c.close.forced,
    )
  report.status = report.nativePassed ? 'passed-native-installed' : 'failed-or-blocked'
  await persist()
  if (!report.nativePassed) process.exitCode = 1
}

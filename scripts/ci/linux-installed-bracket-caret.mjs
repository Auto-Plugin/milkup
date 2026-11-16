// Installed-product, ordinary X11 keyboard regression; no injected editor changes.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFile, writeFile, mkdir, readlink, realpath } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { startProduction } from '../../tests/helpers/native-production.mjs'
import { bracketFixture, delayedBracket } from '../../tests/helpers/native-bracket-caret.mjs'
const out = path.join(path.resolve(process.env.MILKUP_NATIVE_EVIDENCE_DIR), 'issue-255')
await mkdir(out, { recursive: false })
const record = { schema: 1, status: 'running', nativePassed: false, harnessSha: process.env.GITHUB_SHA, launches: [], closes: [], errors: [], case: {}, autosave: 'existing isolated-profile setting; on/off comparison not tested' }
const persist = () => writeFile(path.join(out, 'result.json'), JSON.stringify(record, null, 2))
const sha = value => createHash('sha256').update(value).digest('hex')
const x = (...args) => execFileSync('xdotool', args, { encoding: 'utf8', timeout: 20000 }).trim()
const birth = async pid => (await readFile(`/proc/${pid}/stat`, 'utf8')).split(') ').at(-1).split(' ')[19]
const application = process.env.TAURI_APP_PATH
const fixture = bracketFixture('ISSUE255-' + (process.env.GITHUB_RUN_ID ?? 'LOCAL'))
const file = path.join(out, 'brackets.md')
let app, owned
async function verifyOwned() {
  assert(owned, 'Known owned process required')
  assert.equal(await birth(owned.pid), owned.birth, 'same owned process birth identity')
  assert.equal(await readlink(`/proc/${owned.pid}/exe`), application)
  assert.equal(Number(x('getwindowpid', owned.window)), owned.pid)
}
async function start() {
  app = await startProduction(file, out, { diagnostics: false })
  const windows = x('search', '--onlyvisible', '--class', 'milkup-desktop').split('\n')
  assert.equal(windows.length, 1, 'One application on exclusive test display')
  const window = windows[0], pid = Number(x('getwindowpid', window))
  owned = { pid, birth: await birth(pid), window }; await verifyOwned()
  record.launches.push({ ...owned, at: new Date().toISOString(), binarySha256: sha(await readFile(application)) })
  const origin = JSON.parse(await readFile(path.join(out, 'production-origin.json'), 'utf8'))
  await writeFile(path.join(out, `origin-${record.launches.length}.json`), JSON.stringify(origin, null, 2))
  await persist()
}
async function snapshot() {
  await verifyOwned()
  const dom = await app.execute('const e=document.querySelector(".milkup-editor"),p=document.querySelector(".milkup-input-proxy"),c=document.querySelector(".milkup-cursor");return {position:c?Number(c.dataset.position):null,editorFocused:!!p&&(document.activeElement===p||p.contains(document.activeElement)),mode:e?.dataset.mode,scrollTop:e?.scrollTop,scrollLeft:e?.scrollLeft}')
  return { ...dom, nativeFocus: x('getwindowfocus') }
}
async function close(failureCleanup = false) {
  await verifyOwned()
  const row = { ...owned, method: 'WM_DELETE_WINDOW', failureCleanup, forced: false, processGone: false }
  record.closes.push(row); await persist()
  const state = await app.probe()
  if (!failureCleanup) assert.equal(state.dirty, false, 'Clean normal close')
  row.request = JSON.parse(execFileSync(process.env.MILKUP_NATIVE_CLOSE_HELPER, [owned.window, String(owned.pid)], { encoding: 'utf8', timeout: 5000 }))
  if (failureCleanup && state.dirty) {
    // Only this synthetic document, with the failure snapshot persisted first.
    await app.until(() => app.execute('return !document.querySelector("[data-close-confirm]")?.hidden && !!document.querySelector("[data-close-confirm-action=discard]")'), 'synthetic failure close prompt')
    await app.focus('[data-close-confirm-action=discard]'); await app.key('Return')
    row.discardedSyntheticFailureEdits = true
  }
  const expected = { ...owned }
  await app.until(async () => { try { return await birth(expected.pid) !== expected.birth } catch (e) { if (e.code === 'ENOENT') return true; throw e } }, 'exact owned process normal exit', 20000)
  row.processGone = true; owned = null
  await app.close(); app = null; await persist()
}
try {
  await persist()
  assert(process.platform === 'linux' && process.getuid() !== 0)
  assert(process.env.MILKUP_NATIVE_EXCLUSIVE_DISPLAY === '1' && process.env.DISPLAY)
  for (const name of ['WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS', 'LD_LIBRARY_PATH', 'LD_PRELOAD', 'MILKUP_RESEARCH_RUNTIME_PREFIX']) assert(!process.env[name], 'Default installed runtime required: ' + name)
  const profile = await realpath(process.env.MILKUP_NATIVE_PROFILE_ROOT)
  assert(profile.startsWith(path.resolve(process.env.RUNNER_TEMP) + path.sep))
  for (const key of ['XDG_DATA_HOME', 'XDG_CONFIG_HOME', 'XDG_CACHE_HOME', 'XDG_STATE_HOME', 'XDG_RUNTIME_DIR']) assert((await realpath(process.env[key])).startsWith(profile + path.sep))
  const packageRoot = path.join(process.env.RUNNER_TEMP, 'milkup-candidate/deliverable')
  const manifestPath = process.env.MILKUP_NATIVE_PACKAGE_MANIFEST ?? path.join(packageRoot, 'manifest.json')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  assert(/^[a-f0-9]{40}$/.test(manifest.sourceSha)); assert(/^[a-f0-9]{64}$/.test(manifest.installer.sha256))
  assert.equal(path.basename(manifest.installer.name), manifest.installer.name)
  const packageFile = path.join(path.dirname(manifestPath), manifest.installer.name)
  const bytes = await readFile(packageFile); assert.equal(bytes.length, manifest.installer.bytes); assert.equal(sha(bytes), manifest.installer.sha256)
  const binaryHash = sha(await readFile(application))
  assert.equal(binaryHash, process.env.MILKUP_NATIVE_EXPECTED_BINARY_SHA256)
  assert.equal(binaryHash, sha(await readFile(process.env.MILKUP_NATIVE_EXTRACTED_APP ?? path.join(process.env.RUNNER_TEMP, 'milkup-package-extracted/usr/bin/milkup-desktop'))))
  record.sourceSha = manifest.sourceSha; record.package = { ...manifest.installer }; record.binarySha256 = binaryHash
  await writeFile(file, fixture.original, { flag: 'wx' }); record.originalSha256 = sha(fixture.original); record.expectedSha256 = sha(fixture.expected); await persist()
  await start()
  await delayedBracket({
    now: () => performance.now(), persist, delay: ms => app.delay(ms), snapshot,
    place: async position => {
      await verifyOwned(); x('windowfocus', '--sync', owned.window); await app.focus('.milkup-input-proxy'); await app.key('ctrl+Home')
      assert(position > 0 && position < 1024); x('key', '--clearmodifiers', '--delay', '1', ...Array(position).fill('Right'))
      await app.until(async () => (await snapshot()).position === position, 'native initial caret inside line-middle brackets')
    },
    type: async value => { await verifyOwned(); assert(/^[A-Za-z0-9]+$/.test(value)); await app.text(value) },
    ready: async position => { await app.until(async () => (await snapshot()).position === position, 'actual native insertion offset'); return snapshot() },
    save: async expected => {
      await verifyOwned(); await app.key('ctrl+s')
      await app.until(async () => await readFile(file, 'utf8') === expected, 'entire exact file saved', 15000)
      await app.until(async () => !(await app.probe()).dirty, 'clean saved revision')
      record.savedSha256 = sha(await readFile(file)); await app.shot('saved-bracket'); await persist()
    },
    reopen: async expected => {
      await close(); await start(); assert.equal(await readFile(file, 'utf8'), expected)
      assert.equal((await app.probe()).path, file)
      await app.focus('.milkup-input-proxy'); await app.key('ctrl+Home')
      x('key', '--clearmodifiers', '--delay', '1', ...Array(fixture.position + 5).fill('Right'))
      await app.until(() => app.execute('return document.querySelector(".milkup-editor-content")?.textContent.includes("前文 (Ab12Z) 后缀")'), 'reopened actual bracket insertion')
      await app.key('ctrl+End')
      await app.until(() => app.execute('return document.querySelector(".milkup-editor-content")?.textContent.includes(arguments[0])', fixture.id + '-DOCUMENT-END'), 'reopened distant suffix accessible')
      assert.equal(await readFile(file, 'utf8'), expected)
      record.reopenedSha256 = sha(await readFile(file)); await app.shot('reopened-bracket'); await persist()
    },
  }, fixture, record.case)
} catch (e) {
  record.errors.push(String(e))
  if (app) {
    record.failureProbe = await app.probe().catch(error => ({ error: String(error) }))
    record.failureVisibleText = await app.execute('return document.querySelector(".milkup-editor-content")?.textContent').catch(() => null)
    await app.shot('failure').catch(() => {})
  }
} finally {
  await persist()
  if (app && owned) { try { await close(record.errors.length > 0) } catch (e) { record.errors.push('close: ' + String(e)); await persist() } }
  record.nativePassed = record.case.status === 'contract-passed' && record.errors.length === 0 && record.closes.length === 2 && record.closes.every(c => c.processGone && !c.failureCleanup && !c.forced)
  record.status = record.nativePassed ? 'passed-native-installed' : 'failed-or-blocked'
  await persist(); console.log(JSON.stringify(record, null, 2)); if (!record.nativePassed) process.exitCode = 1
}

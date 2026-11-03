// Independent Linux normal-window-close acceptance. All actions use XTest/GTK.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile, writeFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { startProduction } from '/workspace/milkup-mermaid-rebuild/tests/helpers/native-production.mjs'
import { beta5Fixture } from '/workspace/milkup-mermaid-rebuild/tests/helpers/native-beta5-fixture.mjs'
import { ownedApplication } from '/workspace/milkup-mermaid-rebuild/tests/helpers/native-owned-process.mjs'

const evidence = process.env.MILKUP_NATIVE_EVIDENCE_DIR
const binary = process.env.MILKUP_OBSERVED_BINARY
const expected = process.env.MILKUP_OBSERVED_SHA256
const temp = process.env.MILKUP_NATIVE_TEMP_ROOT
const display = process.env.DISPLAY
const fixture = path.join(evidence, 'normal-close.md')
const source = '# Normal GTK close 中文\r\n\r\n```mermaid\r\nflowchart LR\r\nA[Normal close 草稿] --> B[Owned cleanup 完成]\r\n```\r\n\r\nOutside diagram\r\n'
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex')
const x = (...args) => execFileSync('xdotool', args, { encoding: 'utf8', timeout: 5000 }).trim()
const xprop = (...args) => execFileSync('xprop', args, { encoding: 'utf8', timeout: 5000 }).trim()
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const json = async (file) => JSON.parse(await readFile(file, 'utf8'))
const report = {
  candidateSha: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  binarySha256: expected,
  startedAt: new Date().toISOString(),
  status: 'running',
  inputs: [],
  scope: 'One fresh profile, enabled decoded Mermaid, real Alt+F4 under existing xfwm4, observed child exit status before session cleanup',
  forbiddenCloseSubstitutesUsed: false,
}
let app, owner, failure, natural = false
const persist = () => writeFile(path.join(evidence, 'normal-close.json'), JSON.stringify(report, null, 2) + '\n')
const relevantProcesses = async () => {
  const rows = []
  for (const name of await readdir('/proc')) {
    if (!/^\d+$/.test(name)) continue
    try {
      const raw = await readFile(`/proc/${name}/stat`, 'utf8')
      const fields = raw.slice(raw.lastIndexOf(')') + 2).split(' ')
      const argv = (await readFile(`/proc/${name}/cmdline`, 'utf8')).split('\0').filter(Boolean)
      if (fields[0] === 'Z') continue
      if (argv[0] === binary || argv.some((arg) => arg.startsWith('--milkup-internal-')) ||
          /WebKit(Web|Network|GPU)Process$/.test(argv[0] ?? ''))
        rows.push({ pid: Number(name), birth: fields[19], state: fields[0], argv })
    } catch (error) {
      if (!['ENOENT', 'ESRCH'].includes(error.code)) throw error
    }
  }
  return rows
}
try {
  assert.equal(process.env.MILKUP_NORMAL_CLOSE_RUN, '1')
  assert.equal(report.candidateSha, '0e3912db3f2cc4d77dd73513ce73d5440ec36f54')
  assert.equal(execFileSync('git', ['status', '--porcelain=v1'], { encoding: 'utf8' }), '')
  assert(!process.env.WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS && !process.env.LD_PRELOAD)
  assert.equal(hash(await readFile(binary)), expected)
  await writeFile(fixture, source, { flag: 'wx' })
  report.fixture = { path: fixture, bytes: Buffer.byteLength(source), sha256: hash(source) }
  report.harnessSha256 = hash(await readFile(new URL(import.meta.url)))
  report.wm = { rootProperty: xprop('-root', '_NET_SUPPORTING_WM_CHECK') }
  const wm = /0x[0-9a-f]+/i.exec(report.wm.rootProperty)?.[0]
  assert(wm, 'Real owned window manager is installed on the exclusive display')
  report.wm.name = xprop('-id', wm, '_NET_WM_NAME')
  assert(report.wm.name.includes('Xfwm4'), 'The prepared existing xfwm4 owns the display')
  app = await startProduction(fixture, evidence, { diagnostics: false })
  owner = await ownedApplication(binary, fixture)
  report.owner = owner.identity
  report.launcher = await json(process.env.MILKUP_OBSERVED_START_RECORD)
  assert.equal(report.launcher.pid, owner.identity.pid)
  assert.equal(report.launcher.birth, owner.identity.birth)
  const ui = beta5Fixture(app)
  const window = ui.windowId()
  report.window = { id: window, pidProperty: xprop('-id', window, '_NET_WM_PID') }
  assert(report.window.pidProperty.endsWith('= ' + owner.identity.pid))
  x('windowsize', window, '1280', '800')
  await app.key('ctrl+0')
  await ui.position(source, 0)
  await ui.list()
  const selector = '.plugin-summary-card[data-plugin-id="milkup.diagrams"] [role="switch"]'
  await app.until(() => app.execute('const e=document.querySelector(arguments[0]);return !!e&&e.getAttribute("aria-checked")==="false"&&!e.disabled', selector), 'Fresh disabled Diagrams card')
  report.inputs.push({ kind: 'XTest-pointer', selector, at: new Date().toISOString() })
  await ui.pointer(selector)
  await app.until(() => app.execute('const e=document.querySelector(arguments[0]);return !!e&&e.getAttribute("aria-checked")==="true"&&!e.disabled', selector), 'Single actual plugin enable')
  await ui.closeMenu()
  await app.until(() => app.execute('return [...document.querySelectorAll("[data-document-presentation] img")].some(e=>e.complete&&e.naturalWidth>0&&e.getBoundingClientRect().height>0)'), 'Actual decoded Mermaid PNG', 30000)
  report.beforeClose = await app.probe()
  assert.equal(report.beforeClose.dirty, false)
  assert.equal(report.beforeClose.path, fixture)
  assert((await readFile(fixture)).equals(Buffer.from(source)))
  report.image = await app.execute('return [...document.querySelectorAll("[data-document-presentation] img")].map(e=>({src:e.currentSrc,width:e.naturalWidth,height:e.naturalHeight,rect:e.getBoundingClientRect().toJSON()}))')
  report.runtime = await app.execute('return {userAgent:navigator.userAgent,protocol:location.protocol,hostname:location.hostname,diagnostics:typeof window.__productionDiagnostics,developmentProbe:typeof window.__searchProbe}')
  assert.equal(report.runtime.diagnostics, 'undefined')
  assert.equal(report.runtime.developmentProbe, 'undefined')
  const catalogPath = path.join(process.env.XDG_DATA_HOME, 'app.milkup.desktop/plugins/catalog-v1.json')
  report.catalogBefore = await json(catalogPath)
  const entry = report.catalogBefore.payload.entries.find((item) => item.id === 'milkup.diagrams')
  assert.equal(entry.enabled, true)
  assert.equal(entry.active.verified, true)
  report.nativeProcessesBeforeClose = await relevantProcesses()
  report.privateDirectoriesBeforeClose = (await readdir(temp)).filter((name) => name.startsWith('milkup-mermaid-'))
  await app.shot('01-enabled-before-normal-close-webview')
  execFileSync('/usr/bin/import', ['-display', display, '-window', 'root', path.join(evidence, '01-enabled-before-normal-close-system.png')], { timeout: 10000 })
  x('windowactivate', '--sync', window)
  assert.equal(x('getactivewindow'), String(Number(window)))
  await persist()
  report.closeStartedMonotonicNs = process.hrtime.bigint().toString()
  report.inputs.push({ kind: 'XTest-key', value: 'alt+F4', at: new Date().toISOString() })
  await app.key('alt+F4')
  const limit = BigInt(report.closeStartedMonotonicNs) + 15_000_000_000n
  let exited
  while (process.hrtime.bigint() <= limit) {
    try { exited = await json(process.env.MILKUP_OBSERVED_EXIT_RECORD); break }
    catch (error) { if (error.code !== 'ENOENT') throw error }
    await pause(50)
  }
  assert(exited, 'Owned application reports actual exit within the single close budget')
  assert.equal(exited.pid, owner.identity.pid)
  assert.equal(exited.birth, owner.identity.birth)
  assert.equal(exited.binarySha256, expected)
  assert.equal(exited.returnCode, 0)
  assert.equal(exited.exitCode, 0)
  assert.equal(exited.signal, null)
  assert.equal(exited.terminationRequestedByObserver, false)
  assert.equal(exited.stdioCompleted, true)
  assert.equal(exited.capture.overflow, false)
  assert(BigInt(exited.exitObservedMonotonicNs) >= BigInt(report.closeStartedMonotonicNs))
  assert(BigInt(exited.exitObservedMonotonicNs) <= limit)
  report.normalExit = exited
  report.nativeProcessesAfterExit = await relevantProcesses()
  assert.deepEqual(report.nativeProcessesAfterExit, [], 'No active product/helper/WebKit process after actual normal exit')
  report.privateDirectoriesAfterExit = (await readdir(temp)).filter((name) => name.startsWith('milkup-mermaid-'))
  assert.deepEqual(report.privateDirectoriesAfterExit, [], 'All native Mermaid private roots removed')
  report.catalogAfter = await json(catalogPath)
  assert.deepEqual(report.catalogAfter, report.catalogBefore, 'Normal close preserves plugin preference/catalog bytes')
  assert((await readFile(fixture)).equals(Buffer.from(source)))
  assert.equal(hash(await readFile(binary)), expected)
  const log = await readFile(process.env.MILKUP_OBSERVED_APP_LOG, 'utf8')
  report.nativePhases = Object.fromEntries(['rendered', 'guardian-exited-clean', 'private-directory-clean'].map((phase) => [phase, log.split('MILKUP_FIXED_MERMAID ' + phase + '\n').length - 1]))
  assert(report.nativePhases['guardian-exited-clean'] >= 1)
  assert.equal(report.nativePhases['private-directory-clean'], report.nativePhases['guardian-exited-clean'])
  execFileSync('/usr/bin/import', ['-display', display, '-window', 'root', path.join(evidence, '02-after-normal-close-system.png')], { timeout: 10000 })
  natural = true
  report.status = 'passed'
} catch (error) {
  failure = error
  report.status = 'failed'
  report.failure = { message: String(error), stack: error.stack }
  try { execFileSync('/usr/bin/import', ['-display', display, '-window', 'root', path.join(evidence, 'failure-system.png')], { timeout: 10000 }) } catch {}
} finally {
  report.normalExitProvedBeforeSessionCleanup = natural
  if (natural) {
    report.sessionCleanupStartedAt = new Date().toISOString()
    await app?.close().catch((error) => { report.cleanupError = String(error); report.status = 'failed'; failure ??= error })
  } else {
    // A failed/unknown natural exit remains a failure. The outer runner owns
    // teardown of only this fresh process group/namespace and records it.
    report.sessionCleanupSkipped = 'No successful normal exit; outer owned namespace cleanup only'
  }
  report.finishedAt = new Date().toISOString()
  await persist()
}
console.log(JSON.stringify({ status: report.status, normalExit: report.normalExit, nativePhases: report.nativePhases, failure: report.failure }, null, 2))
if (failure) throw failure

// P1 production acceptance: every installed optional plugin is inactive together.
// Use a dedicated fresh driver/profile. No injected actions, plugin APIs or IPC.
// MILKUP_P1_BINARY_CONFIRMED=1 is required after the parent confirms the new build.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { startProduction } from '../helpers/native-production.mjs'
import { ownedApplication } from '../helpers/native-owned-process.mjs'
import { action, nativeFixture, x } from '../helpers/native-updates-fixture.mjs'

assert.equal(
  process.env.MILKUP_P1_BINARY_CONFIRMED,
  '1',
  'Wait for confirmation of this turn’s production baseline build',
)
assert(process.env.TAURI_APP_PATH, 'Set the confirmed production binary explicitly')
assert(process.env.MILKUP_RECOVERY_PROFILE, 'Set the dedicated profile recovery directory')
const output =
  process.env.MILKUP_NATIVE_EVIDENCE_DIR ||
  '/workspace/milkup-workspace-phase2-evidence/p1-all-disabled/run'
await mkdir(output, { recursive: true })
const launchFile = path.join(output, 'launcher.md')
const file = path.join(output, 'host-only.md')
const original =
  '# Host-only 文档 👩🏽‍💻\r\n\r\n' +
  Array.from({ length: 30 }, (_, index) => `第 ${index + 1} 行 — é 中文完整保留。\r\n`).join('')
await writeFile(launchFile, '# Plugin lifecycle launcher\r\n')
await writeFile(file, original)
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')
const binary = path.resolve(process.env.TAURI_APP_PATH)
await writeFile(
  path.join(output, 'provenance.json'),
  JSON.stringify(
    {
      binary,
      binarySha256: sha256(await readFile(binary)),
      sourceHead: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
      branch: execFileSync('git', ['branch', '--show-current'], { encoding: 'utf8' }).trim(),
      driver: process.env.TAURI_DRIVER_URL,
      display: process.env.DISPLAY,
      recoveryProfile: process.env.MILKUP_RECOVERY_PROFILE,
      restrictions:
        'Linux production only; no Windows packaging/runtime, upload, release, deployment, merge, credentials, commit or push',
    },
    null,
    2,
  ) + '\n',
)
let app
let activeLaunchFile
let installedIds = []
let expected = original
const ui = nativeFixture(() => app)
const results = []
const registry = () =>
  app.execute(
    `return (JSON.parse(localStorage.getItem('milkup.desktop.plugins.registry.v1')||'{"records":[]}').records).map(r=>({id:r.manifest.id,version:r.manifest.version,enabled:r.enabled,state:r.state})).sort((a,b)=>a.id.localeCompare(b.id))`,
  )
const observe = () =>
  app.execute(`return {
  pluginUiCount:document.querySelectorAll('[data-plugin-ui]').length,
  pluginCommandCount:document.querySelectorAll('[data-plugin-action="command"]').length,
  openUiCount:document.querySelectorAll('[data-plugin-action="open-ui"]').length,
  cards:[...document.querySelectorAll('[data-plugin-action="details"]')].map(e=>e.dataset.pluginId).sort(),
  detail:document.querySelector('[data-plugin-manager]')?.textContent,
  editorText:document.querySelector('.milkup-editor')?.innerText.slice(0,250),
  windowed:!!document.querySelector('.milkup-source-document-view'),
  activeTag:document.activeElement?.tagName,
  activeAction:document.activeElement?.getAttribute('data-plugin-action'),
  diagnostics:window.__productionDiagnostics,
}`)
async function record(name, extra = {}) {
  results.push({
    name,
    at: new Date().toISOString(),
    ...extra,
    registry: await registry(),
    dom: await observe(),
    document: await app.probe(),
  })
  await writeFile(path.join(output, 'results.json'), JSON.stringify(results, null, 2) + '\n')
  console.log(name)
}
async function capture(name, extra = {}) {
  await app.delay(1000)
  await app.shot(name + '-webview')
  execFileSync('import', ['-window', 'root', path.join(output, name + '-x11.png')], {
    env: process.env,
  })
  await record(name, extra)
}
async function start(target) {
  activeLaunchFile = target
  app = await startProduction(target, output)
  await app.key('ctrl+0')
  x('windowsize', ui.windowId(), '1100', '760')
}
async function assertAllInactive(label) {
  const records = await registry()
  assert.deepEqual(
    records.map((r) => r.id),
    installedIds,
    `${label}: every installed identity preserved`,
  )
  assert(
    records.every((r) => r.enabled === false),
    `${label}: all persisted enabled flags false`,
  )
  const state = await observe()
  assert.equal(state.pluginUiCount, 0, `${label}: no plugin UI mounted`)
  assert.equal(state.pluginCommandCount, 0, `${label}: no contributed plugin commands`)
  assert.equal(state.openUiCount, 0, `${label}: no contributed UI entry`)
  return records
}
async function auditDetails(label) {
  await ui.list()
  assert.deepEqual((await observe()).cards, installedIds)
  for (const id of installedIds) {
    await ui.details(id)
    assert(await ui.exists(action('enable', id)), `${id}: enable button proves currently inactive`)
    assert(!(await ui.exists(action('disable', id))), `${id}: no enabled-state control`)
    await assertAllInactive(label)
    await capture(`${label}-${id.replaceAll('.', '-')}`)
  }
  await ui.closeMenu()
}
async function openThroughPicker(target) {
  await app.key('ctrl+o')
  await ui.picker(target)
  await app.until(async () => {
    const state = await app.probe()
    return state.path === target && state.loading === 'ready'
  }, 'normal GTK document open')
}
async function source() {
  await ui.closeMenu()
  await app.key('ctrl+1')
  await app.until(async () => (await app.probe()).mode === 'source', 'source editor ready')
  await app.focus('.milkup-input-proxy')
}
async function closeNormally() {
  const id = ui.windowId()
  execFileSync(
    'python3',
    [
      '-c',
      `import ctypes,sys
x=ctypes.CDLL('libX11.so.6')
x.XOpenDisplay.restype=ctypes.c_void_p
x.XInternAtom.argtypes=[ctypes.c_void_p,ctypes.c_char_p,ctypes.c_int];x.XInternAtom.restype=ctypes.c_ulong
class E(ctypes.Structure):
 _fields_=[('type',ctypes.c_int),('serial',ctypes.c_ulong),('send_event',ctypes.c_int),('display',ctypes.c_void_p),('window',ctypes.c_ulong),('message_type',ctypes.c_ulong),('format',ctypes.c_int),('data',ctypes.c_long*5),('pad',ctypes.c_long*12)]
d=x.XOpenDisplay(None);e=E();e.type=33;e.display=d;e.window=int(sys.argv[1]);e.message_type=x.XInternAtom(d,b'WM_PROTOCOLS',0);e.format=32;e.data[0]=x.XInternAtom(d,b'WM_DELETE_WINDOW',0)
x.XSendEvent.argtypes=[ctypes.c_void_p,ctypes.c_ulong,ctypes.c_int,ctypes.c_long,ctypes.c_void_p];x.XFlush.argtypes=[ctypes.c_void_p]
x.XSendEvent(d,e.window,0,0,ctypes.byref(e));x.XFlush(d)
`,
      id,
    ],
    { env: process.env },
  )
  await app.until(
    () => {
      try {
        x('getwindowgeometry', id)
        return false
      } catch {
        return true
      }
    },
    'normal OS close completed',
    30000,
  )
  await app.close()
  app = undefined
}
try {
  await start(launchFile)
  await ui.list()
  await ui.ready(action('details', 'milkup.outline'))
  await ui.ready(action('details', 'milkup.updates'))
  installedIds = (await observe()).cards
  assert(installedIds.includes('milkup.outline') && installedIds.includes('milkup.updates'))
  if (process.env.MILKUP_EXPECT_PLUGIN_IDS)
    assert.deepEqual(installedIds, process.env.MILKUP_EXPECT_PLUGIN_IDS.split(',').sort())
  await capture('00-installed-baseline')
  for (const id of installedIds) {
    await ui.details(id)
    if (await ui.exists(action('disable', id))) {
      await ui.click(action('disable', id))
      await ui.ready(action('enable', id))
    }
  }
  // A never-approved bundled updater already has enabled=false. Keep it inactive;
  // do not grant update capability just to manufacture an enabled->disabled cycle.
  await assertAllInactive('after-disable')
  await auditDetails('01-all-disabled')
  await openThroughPicker(file)
  await source()
  assert.equal(
    (await observe()).windowed,
    false,
    'this combination covers the ordinary editor path',
  )
  assert.equal(await readFile(file, 'utf8'), original)
  await assertAllInactive('normal-open')
  await capture('02-host-normal-open')
  await app.key('ctrl+Home')
  await app.text('HOST-')
  await app.until(
    async () => (await app.probe()).cursor === 5 && (await app.probe()).dirty,
    'source typing completed',
  )
  await capture('03-source-edited')
  await app.key('ctrl+z')
  await app.until(
    async () =>
      (await app.probe()).cursor === 0 && !(await observe()).editorText?.includes('HOST-'),
    'undo cursor returned',
  )
  assert.equal(await readFile(file, 'utf8'), original, 'unsaved edit and undo never changed disk')
  await capture('04-source-undo')
  await app.key('ctrl+shift+z')
  await app.until(async () => (await app.probe()).cursor === 5, 'redo cursor restored')
  await app.key('ctrl+s')
  expected = 'HOST-' + original
  await app.until(
    async () => !(await app.probe()).dirty && (await readFile(file, 'utf8')) === expected,
    'complete byte-exact host save',
  )
  assert.deepEqual(await readFile(file), Buffer.from(expected))
  await assertAllInactive('saved')
  await capture('05-host-saved', {
    bytes: Buffer.byteLength(expected),
    sha256: sha256(Buffer.from(expected)),
  })
  await closeNormally()
  await start(file)
  assert.equal(await readFile(file, 'utf8'), expected)
  await assertAllInactive('normal-reopen')
  await auditDetails('06-disabled-after-normal-reopen')
  await source()
  await capture('07-host-normal-reopened')
  await app.key('ctrl+Home')
  await app.text('RECOVER-')
  await app.until(
    async () => (await app.probe()).dirty && (await app.probe()).cursor === 8,
    'unsaved crash-recovery edit completed',
  )
  await app.until(
    () =>
      app.execute(
        'return document.querySelector("#app").dataset.recoveryPhase==="ready"&&Number(document.querySelector("#app").dataset.recoveryVersion)===Number(document.querySelector("[data-stat=version]").textContent)',
      ),
    'durable host checkpoint with all plugins inactive',
    30000,
  )
  const candidates = []
  for (const name of await readdir(process.env.MILKUP_RECOVERY_PROFILE)) {
    try {
      const directory = path.join(process.env.MILKUP_RECOVERY_PROFILE, name)
      const manifest = JSON.parse(await readFile(path.join(directory, 'manifest.json'), 'utf8'))
      if (manifest.originalPath === file && manifest.disposition === 'pending')
        candidates.push({ ...manifest, directory })
    } catch {}
  }
  const checkpoint = candidates.sort((a, b) => b.createdAt - a.createdAt)[0]
  assert(checkpoint, 'host published a pending recovery checkpoint')
  assert.deepEqual(
    await readFile(path.join(checkpoint.directory, checkpoint.payload)),
    Buffer.from('RECOVER-' + expected),
  )
  assert.deepEqual(await readFile(file), Buffer.from(expected))
  await assertAllInactive('before-crash')
  await capture('08-host-checkpoint-before-crash', { checkpoint: checkpoint.id })
  const owner = await ownedApplication(app.application, activeLaunchFile)
  const termination = await owner.signal('SIGKILL')
  await app.close()
  app = undefined
  await start(file)
  await ui.ready(`[data-recovery-restore="${checkpoint.id}"]`)
  await capture('09-host-recovery-offered', { checkpoint: checkpoint.id, termination })
  await assertAllInactive('recovery-offered')
  await ui.click(`[data-recovery-restore="${checkpoint.id}"]`)
  await app.until(
    async () => {
      const state = await app.probe()
      return state.path.includes('/copies/recovered-') && state.loading === 'ready'
    },
    'restore through existing host recovery action',
    30000,
  )
  const recovered = (await app.probe()).path
  assert.deepEqual(await readFile(recovered), Buffer.from('RECOVER-' + expected))
  assert.deepEqual(
    await readFile(file),
    Buffer.from(expected),
    'host recovery preserves original bytes',
  )
  await assertAllInactive('after-recovery')
  await capture('10-host-recovered-copy', {
    recovered,
    originalSha256: sha256(await readFile(file)),
    recoveredSha256: sha256(await readFile(recovered)),
  })
  await auditDetails('11-disabled-after-crash-recovery')
  await record('PASS', {
    installedIds,
    allEnabledFlagsFalse: true,
    originalPreserved: true,
    recovered,
  })
  console.log(
    'PASS P1 production: all installed optional plugins inactive; normal GTK open, source edit/undo/redo/save, normal close/reopen and SIGKILL host recovery with original bytes preserved',
  )
} catch (error) {
  if (app) await capture('FAIL', { error: String(error), stack: error.stack }).catch(() => {})
  throw error
} finally {
  if (app) await app.close()
}

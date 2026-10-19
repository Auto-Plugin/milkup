// P7 production acceptance with all bundled plugins inactive.
// Native catalog is observed from disk; the active-only localStorage mirror is auxiliary.
// Dedicated fresh profile/display only. UI writes only; no plugin APIs or IPC.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { access, mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { startProduction } from '../helpers/native-production.mjs'
import { ownedApplication } from '../helpers/native-owned-process.mjs'
import { action, nativeFixture, x } from '../helpers/native-updates-fixture.mjs'

const required = (name) => (assert(process.env[name], `Set ${name}`), process.env[name])
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')
const repo = fileURLToPath(new URL('../../', import.meta.url))
const binary = await realpath(required('TAURI_APP_PATH'))
const binarySha256 = sha256(await readFile(binary))
assert.equal(binarySha256, required('MILKUP_NATIVE_EXPECTED_BINARY_SHA256'))
assert(!binary.includes('/target/'), 'Use a frozen production binary copy')
assert(!process.env.WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS && !process.env.LD_PRELOAD)
const proofFile = await realpath(required('MILKUP_P7_CANDIDATE_PROOF'))
const proofBytes = await readFile(proofFile)
const proof = JSON.parse(proofBytes)
assert.equal(proof.exitCode, 0)
assert.deepEqual(proof.inputDrift, [])
assert.equal(proof.baselineUnchanged, true)
assert.equal(proof.sourceHead, proof.headAfter)
assert.equal(await realpath(proof.artifact.path), binary)
assert.equal(proof.artifact.sha256, binarySha256)
const output = path.resolve(required('MILKUP_NATIVE_EVIDENCE_DIR'))
await mkdir(output, { recursive: true })
await writeFile(path.join(output, 'p7-run.lock'), new Date().toISOString(), { flag: 'wx' })
const frozenInputs = path.join(output, 'inputs')
await mkdir(frozenInputs)
await writeFile(path.join(frozenInputs, 'candidate-proof.json'), proofBytes, { flag: 'wx' })
const bundles = []
for (const [relative, expectedInput] of Object.entries(proof.inputs)) {
  if (!/^apps\/desktop\/src\/bundled-plugins\/[^/]+\.milkup-plugin$/.test(relative)) continue
  const bytes = await readFile(path.join(repo, relative))
  assert.equal(sha256(bytes), expectedInput.sha256, `${relative}: frozen candidate input changed`)
  assert.equal(bytes.length, expectedInput.bytes)
  const archive = JSON.parse(bytes)
  assert.equal(archive.format, 'milkup-plugin')
  assert.equal(archive.version, 1)
  assert.equal(typeof archive.manifest.id, 'string')
  assert.equal(typeof archive.manifest.version, 'string')
  const frozen = path.join(frozenInputs, path.basename(relative))
  await writeFile(frozen, bytes, { flag: 'wx' })
  bundles.push({
    id: archive.manifest.id,
    version: archive.manifest.version,
    relative,
    frozen,
    sha256: sha256(bytes),
  })
}
bundles.sort((a, b) => a.id.localeCompare(b.id))
assert(bundles.length > 0, 'Candidate proof must include embedded bundle inputs')
const installedIds = bundles.map((bundle) => bundle.id)
assert.equal(new Set(installedIds).size, installedIds.length)
const inputs = []
for (const url of [
  import.meta.url,
  ...[
    'native-production.mjs',
    'native-startup.mjs',
    'native-owned-process.mjs',
    'native-updates-fixture.mjs',
  ].map((name) => new URL('../helpers/' + name, import.meta.url)),
]) {
  const file = fileURLToPath(url),
    bytes = await readFile(file)
  await writeFile(path.join(frozenInputs, path.basename(file)), bytes, { flag: 'wx' })
  inputs.push({ file, sha256: sha256(bytes) })
}
const launchFile = path.join(output, 'launcher.md')
const file = path.join(output, 'host-only.md')
const original =
  '# Host-only 文档 👩🏽‍💻\r\n\r\n' +
  Array.from({ length: 30 }, (_, index) => `第 ${index + 1} 行 — é 中文完整保留。\r\n`).join('')
await writeFile(launchFile, '# Plugin lifecycle launcher\r\n', { flag: 'wx' })
await writeFile(file, original, { flag: 'wx' })
const preparedOnly = process.argv.includes('--preflight')
await writeFile(
  path.join(output, 'provenance.json'),
  JSON.stringify(
    {
      binary,
      binarySha256,
      candidateProof: proofFile,
      candidateProofSha256: sha256(proofBytes),
      candidateSourceHead: proof.sourceHead,
      sourceHead: execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: repo,
        encoding: 'utf8',
      }).trim(),
      branch: execFileSync('git', ['branch', '--show-current'], {
        cwd: repo,
        encoding: 'utf8',
      }).trim(),
      bundles,
      inputs,
      installedIds,
      originalSha256: sha256(Buffer.from(original)),
      preparedOnly,
      driver: process.env.TAURI_DRIVER_URL,
      display: process.env.DISPLAY,
      boundaries: [
        'Linux production WebKit/X11 only; no Windows or real IME claim.',
        'All source edits, save, disable and recovery actions use UI. Fixture creation precedes launch.',
        'Native catalog disk reads are authority observations; localStorage is only an active runtime mirror.',
        'Prepared unapproved candidates remain unapproved. No capability grant is manufactured for this test.',
        'Helper focus is setup assistance, not keyboard traversal. diagnostics:false preserves Worker constructor.',
      ],
    },
    null,
    2,
  ) + '\n',
  { flag: 'wx' },
)
if (preparedOnly) {
  console.log('P7 ALL-OFF PREPARED; no driver/application started')
  process.exit(0)
}
assert.equal(required('MILKUP_P7_BINARY_CONFIRMED'), '1')
assert.equal(required('MILKUP_NATIVE_EXCLUSIVE_DISPLAY'), '1')
required('DISPLAY')
required('TAURI_DRIVER_URL')
const profile = await realpath(required('MILKUP_NATIVE_PROFILE_ROOT'))
for (const name of ['XDG_DATA_HOME', 'XDG_CONFIG_HOME', 'XDG_CACHE_HOME']) {
  assert(
    (await realpath(required(name))).startsWith(profile + path.sep),
    `${name} must be inside dedicated profile`,
  )
}
const appData = path.join(await realpath(process.env.XDG_DATA_HOME), 'app.milkup.desktop')
const catalogFile = path.join(appData, 'plugins', 'catalog-v1.json')
const recoveryProfile = path.join(appData, 'recovery-v1')
try {
  await access(catalogFile)
  assert.fail('All-off acceptance requires a fresh profile without a preexisting catalog')
} catch (error) {
  if (error.code !== 'ENOENT') throw error
}
let launches = 0
let approvalBaseline
async function catalog() {
  const bytes = await readFile(catalogFile)
  const envelope = JSON.parse(bytes)
  assert.match(envelope.sha256, /^[a-f0-9]{64}$/)
  assert.equal(envelope.payload.version, 1)
  assert(Array.isArray(envelope.payload.entries))
  // The envelope checksum is recorded, not reinterpreted as JS canonical JSON.
  return {
    file: catalogFile,
    rawSha256: sha256(bytes),
    envelopeSha256: envelope.sha256,
    ...envelope.payload,
  }
}
const approvals = (state) =>
  state.entries
    .flatMap((entry) =>
      [entry.active, entry.previous, entry.pending?.generation]
        .filter(Boolean)
        .map((generation) => ({
          id: entry.id,
          generationId: generation.id,
          approvedFingerprint: generation.approvedFingerprint,
        })),
    )
    .sort((a, b) => (a.id + a.generationId).localeCompare(b.id + b.generationId))
let app
let activeLaunchFile
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
    catalog: await catalog(),
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
  const launchOutput = path.join(output, `launch-${++launches}`)
  await mkdir(launchOutput)
  app = await startProduction(target, launchOutput, { diagnostics: false })
  await app.key('ctrl+0')
  x('windowsize', ui.windowId(), '1100', '760')
}
async function assertAllInactive(label) {
  const native = await catalog()
  assert.deepEqual(
    native.entries.map((entry) => entry.id).sort(),
    installedIds,
    `${label}: all candidate bundle identities preserved`,
  )
  for (const entry of native.entries) {
    assert.equal(entry.enabled, false, `${label}: ${entry.id} native enabled=false`)
    assert.equal(entry.startAttempt, null, `${label}: ${entry.id} no activation in progress`)
    assert.equal(entry.tombstone, false, `${label}: ${entry.id} not removed`)
    assert(
      entry.pending === null || entry.pending.phase === 'prepared',
      `${label}: ${entry.id} no trial`,
    )
  }
  assert.deepEqual(
    approvals(native),
    approvalBaseline,
    `${label}: no approval was added or expanded`,
  )
  const records = await registry()
  assert(
    records.every((record) => installedIds.includes(record.id) && record.enabled === false),
    `${label}: active-only mirror has no enabled plugin`,
  )
  const state = await observe()
  assert.equal(state.pluginUiCount, 0, `${label}: no plugin UI mounted`)
  assert.equal(state.pluginCommandCount, 0, `${label}: no contributed plugin commands`)
  assert.equal(state.openUiCount, 0, `${label}: no contributed UI entry`)
  return records
}
async function auditDetails(label) {
  await ui.list()
  await app.until(
    async () => JSON.stringify((await observe()).cards) === JSON.stringify(installedIds),
    'all plugin detail cards ready',
    30000,
  )
  assert.deepEqual((await observe()).cards, installedIds)
  for (const id of installedIds) {
    await ui.details(id)
    const entry = (await catalog()).entries.find((item) => item.id === id)
    assert(
      entry.active || entry.pending?.phase === 'prepared',
      `${id}: retained active generation or prepared candidate`,
    )
    assert(
      (await ui.exists(action('enable', id))) ||
        (entry.pending?.phase === 'prepared' && (await ui.exists(action('approve', id)))),
      `${id}: inactive detail exposes enable or candidate approval`,
    )
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
  await app.until(
    async () => {
      return JSON.stringify((await observe()).cards) === JSON.stringify(installedIds)
    },
    'every frozen candidate bundle has a details card',
    30000,
  )
  await app.until(
    async () => {
      const state = await catalog()
      return (
        state.entries.length === installedIds.length &&
        state.entries.every(
          (entry) =>
            entry.startAttempt === null && (!entry.pending || entry.pending.phase === 'prepared'),
        )
      )
    },
    'initial native catalog provisioning settled',
    30000,
  )
  const initial = await catalog()
  for (const bundle of bundles) {
    const entry = initial.entries.find((item) => item.id === bundle.id)
    assert.equal(
      (entry.pending?.generation ?? entry.active)?.manifest.version,
      bundle.version,
      `${bundle.id}: frozen bundle version`,
    )
  }
  approvalBaseline = approvals(initial)
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
  for (const name of await readdir(recoveryProfile)) {
    try {
      const directory = path.join(recoveryProfile, name)
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
  assert.equal(launches, 3, 'initial launch + normal reopen + crash recovery reopen')
  await writeFile(
    path.join(output, 'completion.json'),
    JSON.stringify(
      {
        passed: true,
        launches,
        installedIds,
        originalSha256: sha256(await readFile(file)),
        recoveredSha256: sha256(await readFile(recovered)),
      },
      null,
      2,
    ) + '\n',
  )
  console.log(
    'PASS P7 production: all installed optional plugins inactive; normal GTK open, source edit/undo/redo/save, normal close/reopen and SIGKILL host recovery with original bytes preserved',
  )
} catch (error) {
  await writeFile(
    path.join(output, 'completion.json'),
    JSON.stringify({ passed: false, launches, error: String(error), stack: error.stack }, null, 2) +
      '\n',
  )
  if (app) await capture('FAIL', { error: String(error), stack: error.stack }).catch(() => {})
  throw error
} finally {
  if (app) await app.close()
}

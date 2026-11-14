// Failed pending DOM 1.1.1 -> exact delivered Worker 1.2.0 recovery acceptance.
// --prepare copies a bounded synthetic profile without starting an application.
// Normal mode requires an exclusively reserved display and matching driver profile.
// Never uninstalls or edits catalog records, never starts displays/drivers or builds.
// Required: MILKUP_NATIVE_BETA6_DIAGRAMS_RUN=1, MILKUP_NATIVE_EXCLUSIVE_DISPLAY=1,
// MILKUP_NATIVE_DIAGRAMS_MODE=failed-pending-dom-to-delivered-worker, TAURI_APP_PATH,
// MILKUP_NATIVE_EXPECTED_BINARY_SHA256, TAURI_DRIVER_URL, DISPLAY,
// MILKUP_NATIVE_PROFILE_ROOT, MILKUP_NATIVE_DRIVER_ENV_RECORD,
// MILKUP_NATIVE_EVIDENCE_DIR, and isolated XDG_CONFIG/CACHE/DATA/RUNTIME_HOME.
// MILKUP_NATIVE_DIAGRAMS_ARCHIVE must point
// at the exact beta.6 delivered archive; its fixed digest is checked below.
// All input is native XTest/GTK. execute() observes DOM only. node --check is safe.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import {
  copyFile,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  unlink,
  writeFile,
} from 'node:fs/promises'
import path from 'node:path'
import { startProduction } from '../helpers/native-production.mjs'
import { beta5Fixture, observeBeta5 } from '../helpers/native-beta5-fixture.mjs'
import { ownedApplication } from '../helpers/native-owned-process.mjs'
import { x } from '../helpers/native-updates-fixture.mjs'

const required = (name) => (assert(process.env[name], 'Set ' + name), process.env[name])
const hash = (value) => createHash('sha256').update(value).digest('hex')
const id = 'milkup.diagrams'
const toggle = `.plugin-summary-card[data-plugin-id="${id}"] [role="switch"]`
const expectedVersion = process.env.MILKUP_NATIVE_EXPECTED_APP_VERSION ?? '2.0.0-beta.6'
const deliveredSha256 = 'b1c2b8490da465f1c38f4f3886e7fa926978d2e6e2c5081bca4d716659c4acc1'
const canonicalTmp = async (value) => {
  const result = await realpath(value)
  assert(result.startsWith('/tmp/'), 'Dedicated /tmp path required')
  assert.equal(result, path.resolve(value), 'No symlink aliases')
  return result
}
const sourceRun = '/tmp/milkup-beta6-linux-product/run-default-dom'
const sourceProfile = path.join(sourceRun, 'profile')
const catalogRelative = 'data/app.milkup.desktop/plugins/catalog-v1.json'
const expectedFrozenBinary = 'f9f07885dd78d1252508ca9dd077b63dc9cf012440b6552f4cb8862aa4d15971'
const entryOf = (value) => value.payload.entries.find((entry) => entry.id === id)
const snapshot = async (root) => {
  const entries = []
  let bytes = 0
  const visit = async (relative = '') => {
    for (const name of (await readdir(path.join(root, relative))).sort()) {
      const file = path.join(relative, name),
        full = path.join(root, file),
        stat = await lstat(full)
      assert(!stat.isSymbolicLink(), 'No profile symlinks: ' + file)
      if (stat.isDirectory()) await visit(file)
      else {
        assert(stat.isFile(), 'No profile special files: ' + file)
        bytes += stat.size
        assert(bytes <= 32 * 1024 * 1024 && entries.length < 1024, 'Bounded synthetic seed profile')
        entries.push({ file, bytes: stat.size, sha256: hash(await readFile(full)) })
      }
    }
  }
  await visit()
  return entries
}
const requireFailedPending = (value) => {
  const entry = entryOf(value)
  assert(entry && !entry.tombstone && !entry.enabled && !entry.active && !entry.previous)
  assert.equal(entry.pending?.generation.manifest.version, '1.1.1')
  assert.equal(entry.pending?.generation.manifest.host, 'dom')
  assert.equal(entry.pending?.phase, 'prepared')
  assert(entry.diagnostics.some((text) => text.includes('Restricted plugin activation timed out')))
  return entry
}
async function prepare() {
  await canonicalTmp(sourceProfile)
  const destination = path.resolve(required('MILKUP_NATIVE_PROFILE_ROOT'))
  const parent = await canonicalTmp(path.dirname(destination))
  assert(
    destination.startsWith('/tmp/') &&
      parent !== sourceRun &&
      !destination.startsWith(sourceRun + path.sep),
  )
  await mkdir(destination, { recursive: false })
  const before = await snapshot(sourceProfile)
  const seed = JSON.parse(await readFile(path.join(sourceProfile, catalogRelative)))
  requireFailedPending(seed)
  for (const dir of ['config', 'cache', 'data'])
    await mkdir(path.join(destination, dir), { recursive: true })
  for (const item of before) {
    await mkdir(path.dirname(path.join(destination, item.file)), { recursive: true })
    await copyFile(path.join(sourceProfile, item.file), path.join(destination, item.file))
  }
  assert.deepEqual(await snapshot(destination), before, 'Exact profile copy')
  assert.deepEqual(await snapshot(sourceProfile), before, 'Source evidence unchanged')
  const sourceEvidence = path.join(sourceRun, 'evidence/diagrams.json')
  const evidence = JSON.parse(await readFile(sourceEvidence))
  assert.equal(evidence.binarySha256, expectedFrozenBinary)
  assert.equal(evidence.mode, 'default-dom')
  assert(evidence.failure)
  await writeFile(
    path.join(parent, 'profile-seed.json'),
    JSON.stringify(
      {
        sourceProfile,
        destination,
        preparedAt: new Date().toISOString(),
        files: before,
        sourceEvidence,
        sourceEvidenceSha256: hash(await readFile(sourceEvidence)),
        seedEntry: entryOf(seed),
      },
      null,
      2,
    ) + '\n',
    { flag: 'wx' },
  )
  console.log('PREPARED exact synthetic failed-pending profile copy:', destination)
}
const graph = {
  flowchart: ['flowchart TD', 'A[Start] --> B[End]'],
  sequence: [
    'sequenceDiagram',
    'participant A as Alice',
    'participant B as Bob',
    'A->>B: Hello',
    'B-->>A: Reply',
  ],
}
const original = {}
for (const size of ['ordinary', 'windowed'])
  for (const kind of ['flowchart', 'sequence']) {
    const name = size + '-' + kind
    original[name] =
      ['# ' + name + ' 中文😀', '', '```mermaid', ...graph[kind], '```', '', 'Outside', ''].join(
        '\r\n',
      ) +
      (size === 'windowed'
        ? Array.from(
            { length: 20_000 },
            (_, index) => 'retained ' + String(index).padStart(5, '0') + ' é 👩🏽‍💻 中文😀\r\n',
          ).join('') + 'TAIL 中文😀\r\n'
        : '')
    assert(!/(^|[^\r])\n/.test(original[name]))
    if (size === 'windowed') assert(Buffer.byteLength(original[name]) > 256 * 1024)
  }

async function main() {
  const harnessBytes = await readFile(new URL(import.meta.url))
  const harnessSha256 = hash(harnessBytes)
  const fixedCandidate = process.env.MILKUP_NATIVE_UPGRADE_CANDIDATE === '1'
  assert.equal(expectedVersion, fixedCandidate ? '2.0.0-beta.7' : '2.0.0-beta.6')
  assert.equal(required('MILKUP_NATIVE_BETA6_DIAGRAMS_RUN'), '1')
  assert.equal(required('MILKUP_NATIVE_EXCLUSIVE_DISPLAY'), '1')
  assert(!process.env.WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS && !process.env.LD_PRELOAD)
  const mode = 'failed-pending-dom-to-delivered-worker'
  assert.equal(required('MILKUP_NATIVE_DIAGRAMS_MODE'), mode)
  if (process.env.MILKUP_NATIVE_EXPECTED_APP_VERSION)
    assert.equal(process.env.MILKUP_NATIVE_EXPECTED_APP_VERSION, expectedVersion)
  const display = required('DISPLAY')
  assert(/^:\d+(?:\.\d+)?$/.test(display))
  const driver = new URL(required('TAURI_DRIVER_URL'))
  assert(driver.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(driver.hostname))
  assert(driver.port && driver.pathname === '/' && !driver.username && !driver.password)
  const binary = await canonicalTmp(required('TAURI_APP_PATH'))
  assert(!binary.includes('/target/'), 'Frozen application copy required')
  const binarySha256 = required('MILKUP_NATIVE_EXPECTED_BINARY_SHA256')
  assert(/^[a-f0-9]{64}$/.test(binarySha256))
  if (!fixedCandidate) assert.equal(binarySha256, expectedFrozenBinary)
  assert.equal(hash(await readFile(binary)), binarySha256)
  const profile = await canonicalTmp(required('MILKUP_NATIVE_PROFILE_ROOT'))
  const seedReceiptPath = path.join(path.dirname(profile), 'profile-seed.json')
  const seedReceipt = JSON.parse(await readFile(seedReceiptPath))
  assert.equal(seedReceipt.sourceProfile, sourceProfile)
  assert.equal(seedReceipt.destination, profile)
  assert.deepEqual(
    await snapshot(profile),
    seedReceipt.files,
    'Unchanged prepared profile before first launch',
  )
  assert.deepEqual(
    await snapshot(sourceProfile),
    seedReceipt.files,
    'Original source evidence retained',
  )
  requireFailedPending(JSON.parse(await readFile(path.join(profile, catalogRelative))))
  const envKeys = [
    'XDG_CONFIG_HOME',
    'XDG_CACHE_HOME',
    'XDG_DATA_HOME',
    'XDG_RUNTIME_DIR',
    'DISPLAY',
  ]
  for (const key of envKeys.filter((key) => key !== 'DISPLAY')) {
    const dir = await canonicalTmp(required(key))
    if (key !== 'XDG_RUNTIME_DIR') {
      assert(dir.startsWith(profile + path.sep), 'Dedicated profile ' + key)
    }
  }
  const driverRecordPath = await canonicalTmp(required('MILKUP_NATIVE_DRIVER_ENV_RECORD'))
  const driverBytes = await readFile(driverRecordPath)
  const driverRecord = JSON.parse(driverBytes)
  for (const key of envKeys) assert.equal(driverRecord.environment?.[key], process.env[key])
  if (driverRecord.driverPort !== undefined)
    assert.equal(Number(driverRecord.driverPort), Number(driver.port))
  await mkdir(required('MILKUP_NATIVE_EVIDENCE_DIR'), { recursive: true })
  const output = await canonicalTmp(process.env.MILKUP_NATIVE_EVIDENCE_DIR)
  const paths = Object.fromEntries(
    Object.keys(original).map((name) => [name, path.join(output, name + '.md')]),
  )
  let archive
  {
    const file = await canonicalTmp(required('MILKUP_NATIVE_DIAGRAMS_ARCHIVE'))
    const bytes = await readFile(file)
    const pkg = JSON.parse(bytes)
    assert.equal(hash(bytes), deliveredSha256, 'Exact beta.6 delivered Worker archive')
    assert.equal(pkg.manifest.id, id)
    assert.equal(pkg.manifest.version, '1.2.0')
    assert.equal(pkg.manifest.host, 'worker')
    archive = { file, sha256: hash(bytes), manifest: pkg.manifest }
  }
  const catalogPath = path.join(
    process.env.XDG_DATA_HOME,
    'app.milkup.desktop/plugins/catalog-v1.json',
  )
  const catalog = async () => {
    try {
      const bytes = await readFile(catalogPath)
      return { path: catalogPath, sha256: hash(bytes), data: JSON.parse(bytes) }
    } catch (error) {
      if (error.code === 'ENOENT') return null
      throw error
    }
  }
  const rows = [],
    inputs = [],
    locks = [],
    token = randomUUID(),
    startedAt = new Date().toISOString()
  let app,
    ui,
    owner,
    failure,
    processEnvironment,
    reportOwned = false,
    active = 'ordinary-flowchart'
  const persist = async () => {
    if (!reportOwned) return
    await writeFile(
      path.join(output, 'diagrams-upgrade.json'),
      JSON.stringify(
        {
          startedAt,
          mode,
          binary,
          binarySha256,
          expectedVersion,
          fixedCandidate,
          profile,
          display,
          driverRecord: { path: driverRecordPath, sha256: hash(driverBytes), record: driverRecord },
          harnessSha256,
          owner: owner?.identity,
          sessions,
          processEnvironment,
          archive,
          seedReceipt,
          fixtures: Object.fromEntries(
            Object.entries(original).map(([name, text]) => [
              name,
              {
                path: paths[name],
                sha256: hash(text),
                bytes: Buffer.byteLength(text),
              },
            ]),
          ),
          boundaries: [
            'Failed prepared candidate replacement and restart lifecycle; actual passed rows remain authoritative.',
            'Linux production UI only; no Windows execution, installer, system DPI, or IME claim.',
            'Exact copy of a retained failed pending DOM 1.1.1 catalog; UI imports Worker 1.2.0 without uninstall or catalog editing. No active DOM upgrade claim.',
            'No Worker 1.1.x archive exists in the inspected local evidence; active Worker 1.1.x upgrade is not tested.',
            'Actual native ordinary/windowed files; real XTest and GTK input. DOM only observed; diagnostic injection disabled.',
            'Decoded image dimensions and vector labels do not establish visual quality; screenshot pixels require separate review.',
            'Only the claimed Worker flowchart/sequence output is covered. This is not the full official Mermaid grammar matrix.',
          ],
          inputs,
          rows,
          failure,
        },
        null,
        2,
      ) + '\n',
    )
  }
  const state = async () => ({
    ...(await observeBeta5(app)),
    probe: await app.probe(),
    visuals: await app.execute(`
const editor=document.querySelector('.milkup-editor'),bounds=editor?.getBoundingClientRect();
const visible=e=>{const r=e.getBoundingClientRect(),c=getComputedStyle(e);return c.display!=='none'&&c.visibility!=='hidden'&&Number(c.opacity)>0&&r.width>0&&r.height>0&&r.right>Math.max(0,bounds?.left??0)&&r.left<Math.min(innerWidth,bounds?.right??innerWidth)&&r.bottom>Math.max(0,bounds?.top??0)&&r.top<Math.min(innerHeight,bounds?.bottom??innerHeight)};
return {images:[...document.querySelectorAll('[data-document-presentation] img')].map(e=>({visible:visible(e),complete:e.complete,width:e.naturalWidth,height:e.naturalHeight,src:e.currentSrc,rect:e.getBoundingClientRect().toJSON()})),vectors:[...document.querySelectorAll('[data-document-presentation] svg')].map(e=>({visible:visible(e),labels:[...e.querySelectorAll('text')].map(t=>t.textContent),rect:e.getBoundingClientRect().toJSON()})),pluginText:document.querySelector('.plugin-manager')?.textContent?.slice(0,12000),body:document.body.textContent?.slice(0,16000)};`),
    catalog: await catalog(),
    file: { path: paths[active], sha256: hash(await readFile(paths[active])) },
  })
  const wait = (test, label, timeout = 15_000) =>
    app.until(async () => test(await state()), label, timeout)
  const screenshot = async (name) => {
    await app.shot(name + '-webview')
    await copyFile(
      path.join(sessions.at(-1).output, name + '-webview.png'),
      path.join(output, name + '-webview.png'),
    )
    execFileSync(
      '/usr/bin/import',
      ['-display', display, '-window', 'root', path.join(output, name + '-system.png')],
      { env: process.env, timeout: 10_000 },
    )
    return Promise.all(
      ['webview', 'system'].map(async (kind) => {
        const file = name + '-' + kind + '.png'
        return {
          file,
          sha256: hash(await readFile(path.join(output, file))),
          visuallyReviewed: false,
        }
      }),
    )
  }
  const step = async (label, run) => {
    const row = {
      name: String(rows.length + 1).padStart(2, '0') + '-' + label,
      startedAt: new Date().toISOString(),
      passed: false,
    }
    rows.push(row)
    try {
      row.before = await state()
      await run(row)
      row.after = await state()
      assert.equal(row.after.probe.path, paths[active])
      assert.equal(
        row.after.windowed,
        active.startsWith('windowed-'),
        'Actual native document path',
      )
      assert.equal(
        (await readFile(`/proc/${owner.identity.pid}/cmdline`, 'utf8')).split('\0')[0],
        binary,
      )
      row.screenshots = await screenshot(row.name)
      row.passed = true
    } catch (error) {
      row.error = String(error)
      row.stack = error.stack
      row.after = await state().catch(() => null)
      row.screenshots = await screenshot(row.name + '-failure').catch(() => [])
      throw error
    } finally {
      row.finishedAt = new Date().toISOString()
      await persist()
      console.log(row.passed ? 'PASS' : 'FAIL', row.name)
    }
  }
  const save = async (expected = original[active]) => {
    await app.key('ctrl+s')
    await app.until(
      async () => {
        const s = await app.probe()
        return (
          !s.dirty && !s.saving && (await readFile(paths[active])).equals(Buffer.from(expected))
        )
      },
      'Native save exact complete CRLF/Unicode bytes',
      30_000,
    )
    rows.at(-1).saved = {
      sha256: hash(expected),
      bytes: Buffer.byteLength(expected),
      probe: await app.probe(),
    }
  }
  const open = async (name) => {
    await ui.closeMenu()
    await app.key('ctrl+o')
    await ui.picker(paths[name])
    active = name
    await wait(
      (s) => s.probe.path === paths[name] && s.probe.loading === 'ready',
      'Open ' + name,
      30_000,
    )
  }
  const rendered = async (yes, edited = false) =>
    wait(
      (s) => {
        const labels = active.endsWith('flowchart')
          ? [edited ? 'XStart' : 'Start', 'End']
          : ['Alice', 'Bob', edited ? 'XHello' : 'Hello', 'Reply']
        const output = s.visuals.vectors.some(
          (v) => v.visible && labels.every((label) => v.labels.includes(label)),
        )
        return yes
          ? s.mode === 'live' && output
          : s.previews.length === 0 &&
              s.visuals.images.length === 0 &&
              s.visuals.vectors.length === 0
      },
      yes ? 'Actual visible decoded diagram' : 'Source without diagram',
      20_000,
    )
  const switchPlugin = async (enabled) => {
    await ui.list()
    const before = await state(),
      card = before.cards.find((c) => c.id === id)
    assert(card)
    assert.notEqual(card.checked, String(enabled), 'Actual switch transition')
    await ui.pointer(toggle)
    await wait(
      (s) =>
        s.cards.find((c) => c.id === id)?.checked === String(enabled) &&
        s.cards.find((c) => c.id === id)?.busy !== 'true',
      'Switch settles ' + enabled,
      25_000,
    )
    const after = await state()
    assert.deepEqual(
      after.cards.map((c) => c.id),
      before.cards.map((c) => c.id),
      'Stable card order',
    )
    assert.equal(after.menuScroll, before.menuScroll, 'Stable plugin scroll')
    assert.equal(
      after.cards.find((c) => c.id === id).rect.top,
      card.rect.top,
      'Stable card position',
    )
    assert.equal(after.cards.find((c) => c.id === id).focus, true, 'Switch keeps keyboard focus')
    assert.equal(after.probe.version, before.probe.version)
    assert.equal(after.probe.dirty, before.probe.dirty)
  }
  const sessions = []
  const launch = async () => {
    const sessionOutput = path.join(output, 'session-' + String(sessions.length + 1))
    await mkdir(sessionOutput)
    app = await startProduction(paths[active], sessionOutput, { diagnostics: false })
    owner = await ownedApplication(binary, paths[active])
    sessions.push({ identity: owner.identity, output: sessionOutput })
    const key = app.key,
      text = app.text
    app.key = async (value) => {
      inputs.push({ at: new Date().toISOString(), kind: 'XTest-key', value })
      return key(value)
    }
    app.text = async (value) => {
      assert(/^[\x20-\x7e]*$/.test(value))
      inputs.push({ at: new Date().toISOString(), kind: 'XTest-text', value })
      return text(value)
    }
    ui = beta5Fixture(app)
    const pointer = ui.pointer
    ui.pointer = async (selector, options) => {
      inputs.push({ at: new Date().toISOString(), kind: 'XTest-pointer', selector })
      return pointer(selector, options)
    }
    const runtime = await app.execute(
      'return {protocol:location.protocol,hostname:location.hostname,diagnostics:typeof window.__productionDiagnostics,developmentProbe:typeof window.__searchProbe}',
    )
    assert(
      (runtime.protocol === 'tauri:' && runtime.hostname === 'localhost') ||
        (['http:', 'https:'].includes(runtime.protocol) && runtime.hostname === 'tauri.localhost'),
    )
    assert.equal(runtime.diagnostics, 'undefined')
    assert.equal(runtime.developmentProbe, 'undefined')
    try {
      const env = (await readFile(`/proc/${owner.identity.pid}/environ`, 'utf8')).split('\0')
      for (const key of envKeys)
        assert.equal(
          env.find((e) => e.startsWith(key + '='))?.slice(key.length + 1),
          process.env[key],
        )
      processEnvironment = { verified: true, method: 'read-only /proc/environ' }
    } catch (error) {
      if (error.code !== 'EACCES') throw error
      processEnvironment = {
        verified: false,
        method: 'matching driver launch record; indirect only',
        error: String(error),
      }
    }
  }
  try {
    for (const lock of [
      path.join(profile, 'beta6-diagrams.lock'),
      `/tmp/milkup-beta6-diagrams-display-${/^:(\d+)/.exec(display)[1]}.lock`,
    ]) {
      await writeFile(lock, JSON.stringify({ pid: process.pid, token, startedAt, output }) + '\n', {
        flag: 'wx',
      })
      locks.push(lock)
    }
    let existing = ''
    try {
      existing = x('search', '--class', 'milkup-desktop')
    } catch (error) {
      if (error.status !== 1) throw error
    }
    assert.equal(existing, '', 'Exclusive display has no existing application')
    await writeFile(path.join(output, 'diagrams-upgrade.json'), '{}\n', { flag: 'wx' })
    reportOwned = true
    await writeFile(path.join(output, 'harness-startup-source.mjs'), harnessBytes, { flag: 'wx' })
    for (const [name, text] of Object.entries(original))
      await writeFile(paths[name], text, { flag: 'wx' })
    await launch()
    await step('reopen-retained-failed-pending-dom-not-active-upgrade', async (row) => {
      x('windowsize', ui.windowId(), '1280', '800')
      await app.key('ctrl+0')
      await ui.menu()
      await ui.click('[data-menu-section="about"]')
      await wait((s) => s.appVersion === expectedVersion, 'Exact beta.6 About version')
      await ui.details(id)
      row.initialCatalog = await catalog()
      const entry = requireFailedPending(row.initialCatalog.data)
      assert.equal(entry.pending.generation.id, seedReceipt.seedEntry.pending.generation.id)
      assert.equal(entry.pending.transactionId, seedReceipt.seedEntry.pending.transactionId)
      assert((await state()).visuals.pluginText.includes('1.1.1'))
      assert((await state()).visuals.pluginText.includes('Restricted plugin activation timed out'))
      await ui.closeMenu()
      await ui.position(original[active], 0)
      await rendered(false)
    })
    await step('ui-import-delivered-worker-without-removal', async (row) => {
      await ui.list()
      row.beforeImport = await state()
      await ui.click('[data-plugin-action="install"]')
      await ui.picker(archive.file)
      await wait(
        (s) => {
          const entry = entryOf(s.catalog.data)
          return (
            entry.pending?.generation.manifest.version === '1.2.0' ||
            s.visuals.pluginText?.includes('resolve existing candidate/startup first') ||
            s.probe.notice?.includes('resolve existing candidate/startup first') ||
            s.visuals.body?.includes('resolve existing candidate/startup first')
          )
        },
        'Import completes or exposes exact retained-pending refusal',
        20_000,
      )
      const current = await catalog(),
        entry = entryOf(current.data)
      row.importResult = { catalog: current, state: await state() }
      if (entry.pending?.generation.manifest.version !== '1.2.0') {
        row.refusedWithoutDataLoss = true
        assert.deepEqual(
          entry,
          seedReceipt.seedEntry,
          'Import refusal retains exact failed candidate',
        )
        throw Error(
          'Production UI import refused while failed pending DOM 1.1.1 remains: resolve existing candidate/startup first; no uninstall or catalog edit performed',
        )
      }
      assert.equal(entry.active, null)
      assert.equal(entry.tombstone, false)
      assert.equal(entry.pending.generation.manifest.host, 'worker')
      assert.equal(entry.pending.generation.sourcePath, archive.file)
      assert(entry.revision > seedReceipt.seedEntry.revision)
      await ui.ready('[data-plugin-action="back"]')
      await ui.list()
      assert.deepEqual(
        (await state()).cards.map((c) => c.id),
        row.beforeImport.cards.map((c) => c.id),
      )
      assert.equal((await state()).cards.find((c) => c.id === id)?.checked, 'false')
      await ui.closeMenu()
    })
    for (const size of ['ordinary', 'windowed']) {
      for (const kind of ['flowchart', 'sequence']) {
        const name = size + '-' + kind,
          source = original[name],
          word = kind === 'flowchart' ? 'Start' : 'Hello',
          offset = source.indexOf(word)
        await step(name + '-open-existing-source', async () => {
          if (active !== name) await open(name)
          await ui.position(source, 0)
          await rendered(false)
        })
        await step(name + '-enable-and-return-real-render', async () => {
          await switchPlugin(true)
          await ui.closeMenu()
          await rendered(true)
          await save()
        })
        const edited = source.slice(0, offset) + 'X' + source.slice(offset)
        await step(name + '-edit-source-and-render-new-output', async () => {
          await ui.position(source, offset, 'source')
          const version = (await app.probe()).version
          await app.text('X')
          await wait((s) => s.probe.version === version + 1, 'One typed source change')
          await save(edited)
          await ui.position(edited, 0)
          await rendered(true, true)
        })
        await step(name + '-undo-and-restore-original-bytes', async () => {
          await ui.position(edited, 0, 'source')
          const version = (await app.probe()).version
          await app.key('ctrl+z')
          await wait((s) => s.probe.version === version + 1, 'Undo source change')
          await save()
          await ui.position(source, 0)
          await rendered(true)
        })
        await step(name + '-disable-removes-render-immediately', async () => {
          await switchPlugin(false)
          await ui.closeMenu()
          await rendered(false)
          await save()
        })
        await step(name + '-reenable-without-document-reopen', async () => {
          await switchPlugin(true)
          await ui.closeMenu()
          await rendered(true)
          await save()
        })
        await step(name + '-leave-disabled-with-original-bytes', async () => {
          await switchPlugin(false)
          await ui.closeMenu()
          await rendered(false)
          await save()
        })
      }
    }
    await step('enable-and-save-before-application-restart', async () => {
      await switchPlugin(true)
      await ui.closeMenu()
      await ui.position(original[active], 0)
      await rendered(true)
      await save()
    })
    const activeBeforeRestart = entryOf((await catalog()).data)
    assert(activeBeforeRestart.enabled && activeBeforeRestart.active?.manifest.version === '1.2.0')
    assert.equal(activeBeforeRestart.pending, null)
    const firstIdentity = owner.identity
    await app.close()
    await app.until(async () => {
      try {
        const stat = await readFile(`/proc/${firstIdentity.pid}/stat`, 'utf8')
        return stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19] !== firstIdentity.birth
      } catch (error) {
        if (error.code === 'ENOENT') return true
        throw error
      }
    }, 'Prior owned application has exited before restart')
    app = undefined
    await launch()
    assert.notDeepEqual(owner.identity, firstIdentity, 'Different owned process instance')
    await step('restart-restores-same-active-worker-and-visible-output', async (row) => {
      await ui.position(original[active], 0)
      await rendered(true)
      await ui.list()
      assert.equal((await state()).cards.find((c) => c.id === id)?.checked, 'true')
      const entry = entryOf((await catalog()).data)
      assert(entry.enabled && !entry.pending && !entry.tombstone)
      assert.equal(entry.active.id, activeBeforeRestart.active.id)
      row.activeGeneration = entry.active.id
      await ui.closeMenu()
      await rendered(true)
      await save()
    })
    for (const [name, value] of Object.entries(original))
      assert(
        (await readFile(paths[name])).equals(Buffer.from(value)),
        'Final original bytes ' + name,
      )
    assert.equal(hash(await readFile(binary)), binarySha256)
  } catch (error) {
    failure = { message: String(error), stack: error.stack, at: new Date().toISOString() }
    if (app && !rows.at(-1)?.error) {
      failure.state = await state().catch(() => null)
      failure.screenshots = await screenshot('unhandled-failure').catch(() => [])
    }
    throw error
  } finally {
    let cleanupError
    for (const cleanup of [
      persist,
      async () => app?.close(),
      async () =>
        assert.deepEqual(
          await snapshot(sourceProfile),
          seedReceipt.files,
          'Original failure evidence unchanged after test',
        ),
      ...locks.map((lock) => async () => {
        if (JSON.parse(await readFile(lock)).token === token) await unlink(lock)
      }),
    ]) {
      try {
        await cleanup()
      } catch (error) {
        cleanupError ??= error
        console.error('Test cleanup failure:', error)
      }
    }
    if (!failure && cleanupError) throw cleanupError
  }
}

if (process.argv.includes('--prepare')) await prepare()
else await main()

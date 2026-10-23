// Dedicated Linux production acceptance; never starts a display/driver or builds.
// Required: MILKUP_NATIVE_BETA6_DIAGRAMS_RUN=1, MILKUP_NATIVE_EXCLUSIVE_DISPLAY=1,
// MILKUP_NATIVE_DIAGRAMS_MODE=default-dom|delivered-worker, TAURI_APP_PATH,
// MILKUP_NATIVE_EXPECTED_BINARY_SHA256, TAURI_DRIVER_URL, DISPLAY,
// MILKUP_NATIVE_PROFILE_ROOT, MILKUP_NATIVE_DRIVER_ENV_RECORD,
// MILKUP_NATIVE_EVIDENCE_DIR, and isolated XDG_CONFIG/CACHE/DATA/RUNTIME_HOME.
// delivered-worker additionally requires MILKUP_NATIVE_DIAGRAMS_ARCHIVE pointing
// at the exact beta.6 delivered archive; its fixed digest is checked below.
// Optional MILKUP_NATIVE_DIAGRAMS_SCOPE=activation stops after the first actual
// flowchart render and exact save; it never claims the full lifecycle matrix.
// All input is native XTest/GTK. execute() observes DOM only. node --check is safe.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, realpath, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { startProduction } from '../helpers/native-production.mjs'
import { beta5Fixture, observeBeta5 } from '../helpers/native-beta5-fixture.mjs'
import { ownedApplication } from '../helpers/native-owned-process.mjs'
import { action, x } from '../helpers/native-updates-fixture.mjs'

const required = (name) => (assert(process.env[name], 'Set ' + name), process.env[name])
const hash = (value) => createHash('sha256').update(value).digest('hex')
const id = 'milkup.diagrams'
const toggle = `.plugin-summary-card[data-plugin-id="${id}"] [role="switch"]`
const expectedVersion = '2.0.0-beta.6'
const deliveredSha256 = 'b1c2b8490da465f1c38f4f3886e7fa926978d2e6e2c5081bca4d716659c4acc1'
const canonicalTmp = async (value) => {
  const result = await realpath(value)
  assert(result.startsWith('/tmp/'), 'Dedicated /tmp path required')
  assert.equal(result, path.resolve(value), 'No symlink aliases')
  return result
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
  invalid: ['unknownBetaSixDiagram', 'A --> B'],
}
const original = {}
for (const size of ['ordinary', 'windowed'])
  for (const kind of ['flowchart', 'sequence', 'invalid']) {
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
  // Capture once before the run. Re-reading our file during persist() would
  // mislabel an already-loaded module if another agent edits the on-disk source.
  const harnessSource = await readFile(new URL(import.meta.url))
  const harnessSha256 = hash(harnessSource)
  const harnessCapturedAt = new Date().toISOString()
  assert.equal(required('MILKUP_NATIVE_BETA6_DIAGRAMS_RUN'), '1')
  assert.equal(required('MILKUP_NATIVE_EXCLUSIVE_DISPLAY'), '1')
  assert(!process.env.WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS && !process.env.LD_PRELOAD)
  const mode = required('MILKUP_NATIVE_DIAGRAMS_MODE')
  assert(['default-dom', 'delivered-worker'].includes(mode))
  const scope = process.env.MILKUP_NATIVE_DIAGRAMS_SCOPE ?? 'lifecycle'
  assert(['activation', 'lifecycle'].includes(scope))
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
  assert.equal(hash(await readFile(binary)), binarySha256)
  const profile = await canonicalTmp(required('MILKUP_NATIVE_PROFILE_ROOT'))
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
      assert.equal((await readdir(dir)).length, 0, 'Fresh empty profile ' + key)
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
  if (mode === 'delivered-worker') {
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
      path.join(output, 'diagrams.json'),
      JSON.stringify(
        {
          startedAt,
          mode,
          scope,
          binary,
          binarySha256,
          expectedVersion,
          profile,
          display,
          driverRecord: { path: driverRecordPath, sha256: hash(driverBytes), record: driverRecord },
          harnessSha256,
          harnessCapturedAt,
          harnessSnapshot: 'harness-startup-source.mjs',
          owner: owner?.identity,
          processEnvironment,
          archive,
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
            scope === 'activation'
              ? 'Activation smoke only: first ordinary flowchart rendered and saved; other lifecycle/windowed/sequence cases not executed.'
              : 'Full declared flowchart/sequence lifecycle matrix requested; actual passed rows remain authoritative.',
            'Linux production UI only; no Windows execution, installer, system DPI, or IME claim.',
            mode === 'default-dom'
              ? 'Fresh bundled DOM 1.1.1, no import or uninstall.'
              : 'Fresh profile; UI removal of DOM then independent import of exact delivered Worker 1.2.0. This is not an upgrade or migration test.',
            'Actual native ordinary/windowed files; real XTest and GTK input. DOM only observed; diagnostic injection disabled.',
            'Decoded image dimensions and vector labels do not establish visual quality; screenshot pixels require separate review.',
            'Only flowchart/sequence and explicit invalid syntax are covered. This is not the full official Mermaid grammar matrix.',
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
        const output =
          mode === 'default-dom'
            ? s.visuals.images.some((i) => i.visible && i.complete && i.width > 0 && i.height > 0)
            : s.visuals.vectors.some(
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
    assert.equal(after.probe.version, before.probe.version)
    assert.equal(after.probe.dirty, before.probe.dirty)
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
    await writeFile(path.join(output, 'diagrams.json'), '{}\n', { flag: 'wx' })
    reportOwned = true
    await writeFile(path.join(output, 'harness-startup-source.mjs'), harnessSource, { flag: 'wx' })
    for (const [name, text] of Object.entries(original))
      await writeFile(paths[name], text, { flag: 'wx' })
    app = await startProduction(paths[active], output, { diagnostics: false })
    owner = await ownedApplication(binary, paths[active])
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
    await step('exact-beta6-and-default-dom-candidate', async (row) => {
      x('windowsize', ui.windowId(), '1280', '800')
      await app.key('ctrl+0')
      await ui.menu()
      await ui.click('[data-menu-section="about"]')
      await wait((s) => s.appVersion === expectedVersion, 'Exact beta.6 About version')
      await ui.details(id)
      const details = (await state()).visuals.pluginText
      assert(details?.includes('1.1.1'), 'Bundled Linux DOM version displayed')
      row.initialCatalog = await catalog()
      const raw = JSON.stringify(row.initialCatalog)
      assert(raw.includes('milkup.diagrams-1.1.1.milkup-plugin'))
      assert(raw.includes('"host":"dom"'))
      await ui.list()
      assert.equal((await state()).cards.find((c) => c.id === id)?.checked, 'false')
      await ui.closeMenu()
      await ui.position(original[active], 0)
      await rendered(false)
    })
    if (archive)
      await step('ui-remove-dom-and-import-delivered-worker-not-upgrade', async (row) => {
        await ui.list()
        await ui.pointer(`.plugin-summary-card[data-plugin-id="${id}"] summary`)
        await ui.pointer(action('remove', id))
        await wait((s) => !s.cards.some((c) => c.id === id), 'Default candidate removed through UI')
        await ui.click('[data-plugin-action="install"]')
        await ui.picker(archive.file)
        await ui.ready('[data-plugin-action="back"]')
        row.details = (await state()).visuals.pluginText
        assert(row.details.includes('1.2.0'))
        await ui.list()
        await wait(
          (s) => s.cards.find((c) => c.id === id)?.checked === 'false',
          'Imported Worker disabled',
        )
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
        if (scope === 'activation') return
        await step(name + '-source-mode-preserves-fence-and-caret', async (row) => {
          await ui.position(source, offset, 'source')
          await rendered(false)
          const s = await state()
          assert(
            s.lines.some((line) => line.text === '```mermaid'),
            'Source opening fence visible',
          )
          assert(
            s.lines.some((line) => line.text === '```'),
            'Source closing fence visible',
          )
          assert.equal(s.cursor, offset)
          row.sourceLines = s.lines
          await save()
        })
        await step(name + '-caret-inside-plugin-page-return', async (row) => {
          await app.key('ctrl+2')
          await rendered(false)
          await ui.list()
          await rendered(true)
          row.blurred = await state()
          await ui.closeMenu()
          await rendered(true)
          assert.equal((await state()).cursor, offset, 'Menu did not move source caret')
        })
        const edited = source.slice(0, offset) + 'X' + source.slice(offset)
        await step(name + '-edit-source-and-render-new-output', async (row) => {
          await ui.position(source, offset, 'source')
          const version = (await app.probe()).version
          const prior = row.before.visuals.images.map((i) => i.src)
          await app.text('X')
          await wait((s) => s.probe.version === version + 1, 'One typed source change')
          await save(edited)
          await ui.position(edited, 0)
          await rendered(true, true)
          if (mode === 'default-dom')
            assert(
              (await state()).visuals.images.some((i) => !prior.includes(i.src)),
              'Changed source yields changed image bytes',
            )
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
      await step(size + '-invalid-syntax-visible-diagnostic', async () => {
        await open(size + '-invalid')
        await ui.position(original[active], 0)
        await switchPlugin(true)
        await ui.closeMenu()
        await wait(
          (s) => s.notices.some((n) => n.visible && n.text.trim()),
          'Invalid syntax visible diagnostic',
          20_000,
        )
        assert.equal((await state()).visuals.images.length, 0)
        assert.equal((await state()).visuals.vectors.length, 0)
        await save()
      })
      await step(size + '-invalid-disable-preserves-source', async () => {
        await switchPlugin(false)
        await ui.closeMenu()
        await rendered(false)
        await save()
      })
    }
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
    await persist()
    await app?.close()
    for (const lock of locks) {
      if (JSON.parse(await readFile(lock)).token === token) await unlink(lock)
    }
  }
}

await main()

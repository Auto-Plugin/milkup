// Prepared separately from the ordinary-document acceptance. Run only after its
// display is released and the final product fix has a NEW frozen binary SHA.
// Required: MILKUP_NATIVE_WINDOWED_RUN=1, MILKUP_NATIVE_EXCLUSIVE_DISPLAY=1,
// TAURI_APP_PATH, MILKUP_NATIVE_EXPECTED_BINARY_SHA256, TAURI_DRIVER_URL, DISPLAY,
// MILKUP_NATIVE_PROFILE_ROOT, MILKUP_NATIVE_DRIVER_ENV_RECORD, XDG_* directories,
// and a new MILKUP_NATIVE_EVIDENCE_DIR. The existing test profile must already
// enable Diagrams Worker 1.2.0 and Formatting Worker 1.0.1 through normal UI.
// No installation, profile seeding, diagnostics injection, or server startup.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, realpath, stat, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { startProduction } from '../helpers/native-production.mjs'
import { ownedApplication } from '../helpers/native-owned-process.mjs'
import {
  beta5Fixture,
  observeBeta5,
  readNativeClipboard,
} from '../helpers/native-beta5-fixture.mjs'

const required = (name) => (assert(process.env[name], `Set ${name}`), process.env[name])
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex')
const nativeX = (...args) =>
  execFileSync('xdotool', args, { encoding: 'utf8', env: process.env, timeout: 10000 }).trim()
const inside = (directory, file) => file.startsWith(directory + path.sep)
const canonicalTmp = async (value) => {
  const resolved = await realpath(value)
  assert(resolved.startsWith('/tmp/'), 'Dedicated /tmp path required: ' + resolved)
  assert.equal(path.resolve(value), resolved, 'Use a canonical path without symlinks')
  return resolved
}
const environmentKeys = [
  'XDG_CONFIG_HOME',
  'XDG_CACHE_HOME',
  'XDG_DATA_HOME',
  'XDG_RUNTIME_DIR',
  'DISPLAY',
]
const expectedPlugins = { 'milkup.diagrams': '1.2.0', 'milkup.formatting': '1.0.1' }
const formatting = '[data-plugin-ui="milkup.formatting:formatting-modal"]'
const unsupportedContext = '无法确认完整语法上下文，请选择更小的完整段落后重试。'
const switchFor = (id) => `.plugin-summary-card[data-plugin-id="${id}"] [role="switch"]`
const prefix =
  [
    '# Beta5 windowed integrity',
    '',
    'FLOW-SAMPLE',
    '```mermaid',
    'flowchart TD',
    'A[Start] --> B[End]',
    '```',
    '',
    'SEQUENCE-SAMPLE',
    '```mermaid',
    'sequenceDiagram',
    'participant A as Alice',
    'participant B as Bob',
    'A->>B: Hello',
    'B-->>A: Reply',
    '```',
    '',
    'CODE-SAMPLE',
    '```js title="beta5"',
    'const 名 = "😀"; // CRLF',
    'console.log(名)',
    '```',
    '',
    'TABLE-SAMPLE',
    '| Name | Value |',
    '| --- | --- |',
    '| Alpha | 1 |',
    '| Beta | 2 |',
    '',
    'OUTSIDE-SAMPLE',
    '',
  ].join('\r\n') + '\r\n'
const tail = 'TAIL 中文 é 👩🏽‍💻 😀\r\n'
const original =
  prefix +
  Array.from(
    { length: 30000 },
    (_, i) => `retained ${String(i).padStart(5, '0')} 中文 é 👩🏽‍💻\r\n\r\n`,
  ).join('') +
  tail
const originalBytes = Buffer.from(original)
const lineCount = original.split('\r\n').length
assert(lineCount > 60000)
assert(originalBytes.length >= 256 * 1024 && originalBytes.length < 8 * 1024 * 1024)
assert(!/(^|[^\r])\n/.test(original))
const diagrams = [
  { name: 'flow', marker: 'FLOW-SAMPLE', body: 'flowchart TD', labels: ['Start', 'End'] },
  {
    name: 'sequence',
    marker: 'SEQUENCE-SAMPLE',
    body: 'sequenceDiagram',
    labels: ['Alice', 'Bob', 'Hello', 'Reply'],
  },
].map((sample) => {
  const from = original.indexOf('```mermaid', original.indexOf(sample.marker))
  return { ...sample, from, to: original.indexOf('\r\n```', from + 3) + 5 }
})

async function main() {
  assert.equal(required('MILKUP_NATIVE_WINDOWED_RUN'), '1', 'Explicit follow-up run gate')
  assert.equal(required('MILKUP_NATIVE_EXCLUSIVE_DISPLAY'), '1')
  assert(!process.env.WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS && !process.env.LD_PRELOAD)
  const display = required('DISPLAY')
  assert(/^:\d+(?:\.\d+)?$/.test(display), 'Explicit local dedicated X11 display')
  const displayNumber = Number(/^:(\d+)/.exec(display)[1])
  assert(Number.isSafeInteger(displayNumber), 'Valid X11 display number')
  const driver = new URL(required('TAURI_DRIVER_URL'))
  assert(driver.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(driver.hostname))
  assert(driver.port && driver.pathname === '/' && !driver.username && !driver.password)
  const binary = await canonicalTmp(required('TAURI_APP_PATH'))
  assert(!binary.includes('/target/'), 'Use a frozen copy outside shared Cargo targets')
  const binarySha256 = required('MILKUP_NATIVE_EXPECTED_BINARY_SHA256')
  assert(/^[a-f0-9]{64}$/.test(binarySha256))
  assert.equal(hash(await readFile(binary)), binarySha256, 'Exact approved frozen binary')
  const profile = await canonicalTmp(required('MILKUP_NATIVE_PROFILE_ROOT'))
  assert(!profile.includes('beta5-baseline'), 'Use the enabled beta5 test profile')
  for (const key of environmentKeys.filter((key) => key !== 'DISPLAY')) {
    const directory = await canonicalTmp(required(key))
    if (key !== 'XDG_RUNTIME_DIR') assert(inside(profile, directory), key + ' under test profile')
    assert((await stat(directory)).isDirectory())
  }
  const driverRecordPath = await canonicalTmp(required('MILKUP_NATIVE_DRIVER_ENV_RECORD'))
  const driverRecordBytes = await readFile(driverRecordPath)
  const driverRecord = JSON.parse(driverRecordBytes)
  for (const key of environmentKeys)
    assert.equal(driverRecord.environment?.[key], process.env[key], 'Recorded driver ' + key)
  if (driverRecord.driverPort !== undefined)
    assert.equal(Number(driverRecord.driverPort), Number(driver.port))
  const harness = await Promise.all(
    [
      import.meta.url,
      new URL('../helpers/native-production.mjs', import.meta.url),
      new URL('../helpers/native-beta5-fixture.mjs', import.meta.url),
      new URL('../helpers/native-updates-fixture.mjs', import.meta.url),
      new URL('../helpers/native-owned-process.mjs', import.meta.url),
    ].map(async (url) => ({
      file: new URL(url).pathname,
      sha256: hash(await readFile(new URL(url))),
    })),
  )
  const catalogPath = await realpath(
    path.join(process.env.XDG_DATA_HOME, 'app.milkup.desktop/plugins/catalog-v1.json'),
  )
  assert(inside(profile, catalogPath), 'Existing catalog belongs to the selected profile')
  const beforeCatalogBytes = await readFile(catalogPath)
  const checkCatalog = (bytes) => {
    const catalog = JSON.parse(bytes)
    for (const [id, version] of Object.entries(expectedPlugins)) {
      const entry = catalog.payload.entries.find((entry) => entry.id === id)
      assert(
        entry?.enabled && entry.active && !entry.pending,
        'Already-enabled active package: ' + id,
      )
      assert.equal(entry.active.manifest.id, id)
      assert.equal(entry.active.manifest.version, version)
      assert.equal(entry.active.manifest.host, 'worker')
    }
    return catalog
  }
  checkCatalog(beforeCatalogBytes)
  // The ordinary run retains this evidence lock. Never overlap a live owner or
  // remove its lock; a completed owner's record remains intact.
  try {
    const prior = JSON.parse(
      await readFile(path.join(profile, 'beta5-native-acceptance.lock'), 'utf8'),
    )
    assert(Number.isSafeInteger(prior.pid) && prior.pid > 0)
    let alive = true
    try {
      process.kill(prior.pid, 0)
    } catch (error) {
      if (error.code === 'ESRCH') alive = false
      else throw error
    }
    assert(!alive, 'Ordinary native acceptance must finish before this follow-up')
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  const requestedOutput = path.resolve(required('MILKUP_NATIVE_EVIDENCE_DIR'))
  assert(requestedOutput.startsWith('/tmp/'))
  await mkdir(requestedOutput, { recursive: true })
  const output = await canonicalTmp(requestedOutput)
  assert.notEqual(output, profile)
  assert.deepEqual(
    await readdir(output),
    [],
    'Use a new evidence directory; preserve previous runs',
  )
  const lockToken = randomUUID(),
    locks = []
  const rows = [],
    inputs = []
  const startedAt = new Date().toISOString(),
    deadline = Date.now() + 8 * 60_000
  const file = path.join(output, 'windowed-integrity.md')
  let app, ui, owner, processEnvironment, failure
  const report = async () =>
    writeFile(
      path.join(output, 'windowed.json'),
      JSON.stringify(
        {
          startedAt,
          binary,
          binarySha256,
          profile,
          display,
          driver: driver.href,
          harness,
          plannedSteps: 30,
          budgetMinutes: 8,
          driverLaunch: {
            path: driverRecordPath,
            sha256: hash(driverRecordBytes),
            record: driverRecord,
          },
          processEnvironment,
          owner: owner?.identity,
          beforeCatalogSha256: hash(beforeCatalogBytes),
          fixture: {
            path: file,
            bytes: originalBytes.length,
            utf16Length: original.length,
            lineCount,
            sha256: hash(originalBytes),
            prefix,
            tail,
          },
          expectedPlugins,
          failure,
          inputs,
          rows,
          boundaries: [
            'One frozen Linux production session and an already-enabled synthetic test profile; no install/upgrade or Windows claim.',
            'Native keys/pointer and raw GTK clipboard; DOM observations only; diagnostics:false.',
            'Local selections fit the loaded source window. No unsupported full-document clipboard claim.',
            'Formatting succeeds only with trusted front-of-document context; a distant-tail command must visibly reject without editing.',
            'Wide/narrow native window sizes and 100/200% application zoom; no OS DPI or IME claim. Screenshots await visual review.',
          ],
        },
        null,
        2,
      ) + '\n',
    )
  const budget = () => assert(Date.now() < deadline, 'Bounded eight-minute native follow-up budget')
  const state = async () => ({
    ...(await observeBeta5(app)),
    probe: await app.probe(),
    editorBusy: await app.execute(
      'return document.querySelector("[data-editor-host]")?.getAttribute("aria-busy")',
    ),
  })
  const until = (predicate, label, limit = 10000) =>
    app.until(
      async () => {
        budget()
        return predicate(await state())
      },
      label,
      limit,
    )
  const fileEquals = async (text) => {
    const bytes = await readFile(file)
    assert.deepEqual(bytes, Buffer.from(text), 'Complete file bytes, including Unicode and CRLF')
    assert(!/(^|[^\r])\n/.test(bytes.toString('utf8')))
    return { bytes: bytes.length, sha256: hash(bytes) }
  }
  const save = async (text = original) => {
    await app.key('ctrl+s')
    await app.until(
      async () => {
        budget()
        const probe = await app.probe()
        return !probe.dirty && !probe.saving && (await readFile(file)).equals(Buffer.from(text))
      },
      'normal Save: exact complete windowed document',
      30000,
    )
    return fileEquals(text)
  }
  const source = async (expected = original) => {
    await app.key('ctrl+1')
    const lines = expected.split('\r\n'),
      offsets = []
    let offset = 0
    for (const line of lines) {
      offsets.push(offset)
      offset += line.length + 2
    }
    const current = await until(
      (s) =>
        s.mode === 'source' &&
        !s.previews.length &&
        !s.pickers.length &&
        s.lines.length > 0 &&
        s.lines.every((line) => {
          const index = Number(line.line) - 1
          return (
            line.from === offsets[index] &&
            line.to === offsets[index] + lines[index]?.length &&
            line.text === (lines[index] || '\u200b')
          )
        }) &&
        s,
      'source mode with exact mounted global ranges and text',
    )
    assert(current.windowed && current.lines.length > 0 && current.lines.length < 512)
    for (const line of current.lines) {
      const index = Number(line.line) - 1
      assert.equal(line.from, offsets[index], 'Global source mapping start for line ' + line.line)
      assert.equal(
        line.to,
        offsets[index] + lines[index].length,
        'Global source mapping end for line ' + line.line,
      )
      assert.equal(line.text, lines[index] || '\u200b', 'Exact mounted source line ' + line.line)
    }
    assert.equal(current.notices.length, 0)
    return current
  }
  const visibleInEditor = (rect, s) =>
    rect &&
    rect.width > 0 &&
    rect.height > 0 &&
    rect.bottom > Math.max(s.editor.top, 0) &&
    rect.top < Math.min(s.editor.bottom, s.height) &&
    rect.right > Math.max(s.editor.left, 0) &&
    rect.left < Math.min(s.editor.right, s.width)
  const diagram = async (sample, visible = true, limit = 10000) => {
    const current = await until(
      (s) => {
        const preview = s.previews.find((p) => p.from === sample.from && p.to === sample.to)
        return (
          (visible
            ? preview && sample.labels.every((label) => s.vector.includes(label))
            : !preview) && s
        )
      },
      sample.name + (visible ? ' supported preview in open window' : ' preview removed'),
      limit,
    )
    assert(current.windowed)
    assert.equal(current.notices.length, 0, 'Supported diagram cannot silently fall back')
    if (visible) {
      for (const label of current.vectorColors)
        assert.equal(label.fill, label.color, 'Default graph text inherits the host foreground')
      const preview = current.previews.find((p) => p.from === sample.from)
      assert(visibleInEditor(preview.rect, current), 'Graph intersects actual visible editor')
      assert(preview.label)
      assert(
        preview.rect.left >= current.editor.left - 1 &&
          preview.rect.right <= Math.min(current.editor.right, current.width) + 1,
      )
    }
    return current
  }
  const code = async (expected = original) => {
    const from = expected.indexOf('```js'),
      to = expected.indexOf('\r\n```', from + 3) + 5
    const current = await until(
      (s) =>
        s.mode === 'live' &&
        s.code.filter((line) => line.from >= from && line.to <= to).length === 4 &&
        s,
      'mapped JavaScript code window',
    )
    const mapped = current.code.filter((line) => line.from >= from && line.to <= to)
    const fences = mapped.filter((line) => line.text.startsWith('```'))
    assert(current.windowed)
    assert.equal(fences.length, 2)
    assert(fences.every((line) => line.hidden && line.display === 'none' && line.rect.height === 0))
    assert.equal(fences[1].lineRect.height, 0, 'No visible closing-fence blank row')
    for (const line of mapped)
      assert.equal(line.text, expected.slice(line.from, line.to), 'Exact live code source mapping')
    assert.equal(current.imagesInCode, 0)
    const picker = current.pickers.find((picker) => picker.value === 'javascript')
    assert(picker?.visible && visibleInEditor(picker.rect, current), 'Language picker is visible')
    assert(
      picker.rect.left >= current.editor.left - 1 &&
        picker.rect.right <= Math.min(current.editor.right, current.width) + 1,
    )
    return current
  }
  const copy = async (expected, row) => {
    await app.key('ctrl+c')
    const actual = Buffer.from(readNativeClipboard())
    assert.deepEqual(actual, Buffer.from(expected), 'Real clipboard exact UTF-8 bytes')
    row.clipboard = {
      bytes: actual.length,
      sha256: hash(actual),
      text: expected,
      transport: 'native Ctrl+C / X11 UTF8_STRING / independent GTK reader',
    }
  }
  const step = async (name, run) => {
    budget()
    const row = {
      name: String(rows.length + 1).padStart(2, '0') + '-' + name,
      startedAt: new Date().toISOString(),
      passed: false,
    }
    rows.push(row)
    try {
      row.before = await state()
      await run(row)
      row.after = await state()
      assert(row.after.windowed, 'Every acceptance step stays windowed')
      assert.equal(row.after.probe.path, file)
      const argv = (await readFile(`/proc/${owner.identity.pid}/cmdline`, 'utf8')).split('\0')
      assert.equal(argv[0], binary)
      assert(argv.includes(file), 'Same owned production session')
      await app.shot(row.name)
      execFileSync(
        '/usr/bin/import',
        ['-display', display, '-window', 'root', path.join(output, row.name + '-system.png')],
        { env: process.env, timeout: 10000 },
      )
      row.screenshots = [row.name + '.png', row.name + '-system.png']
      row.visualReviewRequired = true
      row.passed = true
    } catch (error) {
      row.error = String(error)
      row.after = await state().catch(() => null)
      await app.shot(row.name + '-failure').catch(() => {})
      throw error
    } finally {
      row.finishedAt = new Date().toISOString()
      await report()
      console.log(row.passed ? 'PASS' : 'FAIL', row.name)
    }
  }
  const modal = async () => {
    await ui.list()
    await ui.pointer(
      `[data-plugin-action="open-ui"][data-plugin-id="milkup.formatting"][data-plugin-ui-id="formatting-modal"]`,
    )
    await ui.ready(formatting + ' [data-plugin-command="formatting.bold"]')
  }
  const closeModal = async () => {
    await app.key('Escape')
    await app.until(
      () => app.execute('return !document.querySelector(arguments[0])', formatting),
      'Formatting modal closed',
    )
    await ui.closeMenu()
  }
  try {
    for (const lock of [
      path.join(profile, 'beta5-windowed-acceptance.lock'),
      `/tmp/milkup-beta5-native-display-${displayNumber}.lock`,
    ]) {
      await writeFile(
        lock,
        JSON.stringify({ pid: process.pid, token: lockToken, startedAt, output }) + '\n',
        { flag: 'wx' },
      )
      locks.push(lock)
    }
    let existing = ''
    try {
      existing = nativeX('search', '--class', 'milkup-desktop')
    } catch (error) {
      if (error.status !== 1) throw error
    }
    assert.equal(existing, '', 'Selected display must be free of every Milkup window')
    await writeFile(file, originalBytes, { flag: 'wx' })
    assert.equal(await realpath(file), file)
    await writeFile(path.join(output, 'before-catalog.json'), beforeCatalogBytes, { flag: 'wx' })
    await report()
    app = await startProduction(file, output, { diagnostics: false })
    const rawKey = app.key,
      rawText = app.text,
      rawExecute = app.execute
    app.key = async (key) => {
      budget()
      inputs.push({ kind: 'key', key })
      return rawKey(key)
    }
    app.text = async (text) => {
      budget()
      inputs.push({ kind: 'text', text })
      return rawText(text)
    }
    app.execute = (script, ...args) => {
      budget()
      return rawExecute(script, ...args)
    }
    ui = beta5Fixture(app)
    owner = await ownedApplication(binary, file)
    const runtime = await app.execute(
      'return {url:location.href,diagnostics:typeof window.__productionDiagnostics,developmentProbe:typeof window.__searchProbe}',
    )
    const origin = new URL(runtime.url)
    assert(
      (origin.protocol === 'tauri:' && origin.hostname === 'localhost') ||
        (['http:', 'https:'].includes(origin.protocol) && origin.hostname === 'tauri.localhost'),
    )
    assert.equal(runtime.diagnostics, 'undefined')
    assert.equal(runtime.developmentProbe, 'undefined')
    try {
      const env = (await readFile(`/proc/${owner.identity.pid}/environ`, 'utf8')).split('\0')
      for (const key of environmentKeys)
        assert.equal(
          env.find((entry) => entry.startsWith(key + '='))?.slice(key.length + 1),
          process.env[key],
        )
      processEnvironment = { verified: true, method: 'read-only /proc/environ' }
    } catch (error) {
      if (error.code !== 'EACCES') throw error
      processEnvironment = {
        verified: false,
        method: 'driver launch record and existing profile/catalog; indirect only',
        error: String(error),
      }
    }
    await step('frozen-beta5-and-already-enabled-windowed-profile', async (row) => {
      nativeX('windowsize', ui.windowId(), '1280', '800')
      const recovery = await app.execute(
        'const e=document.querySelector(".recovery-overlay");return e&&!e.hidden?{text:e.textContent,paths:[...e.querySelectorAll(".recovery-record h3")].map(n=>n.textContent)}:null',
      )
      if (recovery) {
        assert(recovery.paths.length && recovery.paths.every((item) => item === file))
        row.preexistingRecovery = recovery
        await app.shot('initial-retained-recovery-dialog')
        execFileSync(
          '/usr/bin/import',
          [
            '-display',
            display,
            '-window',
            'root',
            path.join(output, 'initial-retained-recovery-dialog-system.png'),
          ],
          { env: process.env, timeout: 10000 },
        )
        await ui.pointer('[data-recovery-close]')
        await app.until(
          () => app.execute('return document.querySelector(".recovery-overlay")?.hidden===true'),
          'native postpone recovery closes the dialog without removing records',
        )
      }
      await app.key('ctrl+0')
      await until(
        (s) => s.zoom === 1 && s.width === 1280 && s.height === 800,
        'initial native window and zoom settle before pointer input',
      )
      await ui.menu()
      await ui.pointer('[data-menu-section="about"]')
      await until((s) => s.appVersion === '2.0.0-beta.5', 'frozen beta5 version')
      await ui.list()
      for (const id of Object.keys(expectedPlugins))
        await until(
          (s) =>
            s.cards.some(
              (card) => card.id === id && card.checked === 'true' && card.busy !== 'true',
            ),
          'existing enabled ' + id,
        )
      await ui.position(original, 0, 'source')
      await source()
      await fileEquals(original)
    })
    for (const sample of diagrams) {
      await step(sample.name + '-supported-renderer-before-disable', async () => {
        await ui.position(original, original.indexOf(sample.marker), 'live')
        await diagram(sample)
      })
      for (const enabled of [false, true])
        await step(sample.name + (enabled ? '-hot-enable' : '-hot-disable'), async (row) => {
          await ui.list()
          const before = await app.probe()
          await ui.pointer(switchFor('milkup.diagrams'))
          await until(
            (s) =>
              s.cards.some(
                (card) =>
                  card.id === 'milkup.diagrams' &&
                  card.checked === String(enabled) &&
                  card.busy !== 'true',
              ),
            'card transition settles',
          )
          await ui.closeMenu()
          const started = performance.now()
          await diagram(sample, enabled, 2500)
          row.rendererSettledMs = Math.round(performance.now() - started)
          const after = await app.probe()
          assert.equal(after.version, before.version)
          assert.equal(after.dirty, before.dirty)
          if (!enabled) assert.equal((await state()).previews.length, 0)
          await fileEquals(original)
        })
    }
    const codeFrom = original.indexOf('```js'),
      codeTo = original.indexOf('\r\n```', codeFrom + 3) + 5
    const body = 'const 名 = "😀"; // CRLF',
      bodyFrom = original.indexOf(body)
    await step('code-source-retains-fences-and-all-mounted-mappings', async () => {
      await ui.position(original, original.indexOf('CODE-SAMPLE'), 'source')
      await source()
    })
    await step('code-live-hides-fences-with-exact-bounded-copy', async (row) => {
      await ui.position(original, codeFrom, 'source')
      for (let i = 0; i < 3; i++) await app.key('shift+Down')
      await app.key('shift+End')
      await app.key('ctrl+2')
      await code()
      await copy(original.slice(codeFrom, codeTo), row)
      await fileEquals(original)
    })
    await step('code-unicode-body-selection-survives-source-live', async (row) => {
      await ui.position(original, bodyFrom, 'source')
      await app.key('shift+End')
      await app.key('ctrl+2')
      await until(
        (s) => s.selection.some((r) => r.from === bodyFrom && r.to === bodyFrom + body.length),
        'exact body selection',
      )
      await code()
      await copy(body, row)
    })
    const edited = original.replace(body, 'windowed_native_edit')
    await step('windowed-edit-saves-entire-file-exactly', async (row) => {
      await app.text('windowed_native_edit')
      row.disk = await save(edited)
      await code(edited)
      await source(edited)
    })
    for (const [name, key, expected] of [
      ['undo-original', 'ctrl+z', original],
      ['redo-edited', 'ctrl+shift+z', edited],
      ['final-undo-original', 'ctrl+z', original],
    ])
      await step('windowed-' + name, async (row) => {
        await app.key(key)
        row.disk = await save(expected)
        await source(expected)
      })
    await step('front-table-bounded-formatting-command', async (row) => {
      await ui.position(original, original.indexOf('Alpha'), 'live')
      const target =
        '[data-plugin-ui="milkup.formatting:formatting-toolbar"] [data-plugin-command="formatting.tableAddRow"]'
      const expectedVersion = (await app.probe()).version
      let previousSignature, stableSince
      row.toolbarReadiness = []
      const ready = await until(async (s) => {
        const button = await app.execute(
          'const e=document.querySelector(arguments[0]),r=e?.getBoundingClientRect();return e?{html:e.outerHTML,disabled:e.disabled,visible:!!r&&r.width>0&&r.height>0&&getComputedStyle(e).display!=="none",rect:r.toJSON()}:null',
          target,
        )
        const tableLine = s.lines.find((line) => line.line === '27')
        const valid =
          s.probe.path === file &&
          s.probe.version === expectedVersion &&
          s.mode === 'live' &&
          s.cursor === original.indexOf('Alpha') &&
          s.focus.editor &&
          s.editorBusy === 'false' &&
          s.previews.length === 2 &&
          tableLine?.text === '| Alpha | 1 |' &&
          visibleInEditor(tableLine.rect, s) &&
          button?.visible &&
          !button.disabled
        const signature = valid
          ? JSON.stringify({
              button,
              table: tableLine.rect,
              previews: s.previews,
              editor: s.editor,
            })
          : undefined
        if (!signature || signature !== previousSignature) stableSince = Date.now()
        previousSignature = signature
        const stableMs = signature ? Date.now() - stableSince : 0
        row.toolbarReadiness.push({
          at: new Date().toISOString(),
          version: s.probe.version,
          cursor: s.cursor,
          editorBusy: s.editorBusy,
          button,
          tableLine,
          previews: s.previews,
          valid: Boolean(valid),
          stableMs,
        })
        return signature && stableMs >= 300 && s
      }, 'current Live table context and target geometry continuously stable before one click')
      row.commandBefore = ready.probe
      inputs.push({ kind: 'pointer', selector: target, version: ready.probe.version })
      await ui.pointer(target)
      const expected = original.replace('| Beta | 2 |', '|  |  |\r\n| Beta | 2 |')
      const blankFrom = expected.indexOf('|  |  |'),
        betaFrom = expected.indexOf('| Beta | 2 |')
      // The Worker command can still be in transit when the native click returns.
      // Observe its one committed edit before issuing the one normal Save key.
      const applied = await until(
        (s) =>
          s.probe.version === row.commandBefore.version + 1 &&
          s.probe.dirty &&
          s.editorBusy === 'false' &&
          s.lines.some(
            (line) =>
              line.line === '28' &&
              line.from === blankFrom &&
              line.to === blankFrom + '|  |  |'.length &&
              line.text === '|  |  |',
          ) &&
          s.lines.some(
            (line) =>
              line.line === '29' &&
              line.from === betaFrom &&
              line.to === betaFrom + '| Beta | 2 |'.length &&
              line.text === '| Beta | 2 |',
          ) &&
          s,
        'one Worker table edit committed with exact current source rows before Save',
      )
      row.commandApplied = {
        probe: applied.probe,
        editorBusy: applied.editorBusy,
        rows: applied.lines.filter((line) => line.line === '28' || line.line === '29'),
      }
      row.disk = await save(expected)
      await ui.editorFocus()
      await app.key('ctrl+z')
      row.undoDisk = await save()
      await source()
    })
    await step('tail-navigation-and-unicode-crlf-copy', async (row) => {
      await ui.editorFocus()
      await app.key('ctrl+End')
      await until((s) => s.cursor === original.length, 'exact remote EOF cursor')
      await app.key('Up')
      await app.key('Home')
      await until((s) => s.cursor === original.length - tail.length, 'tail line start')
      await app.key('ctrl+shift+End')
      await source()
      await copy(tail, row)
    })
    await step('distant-formatting-explicit-safe-refusal', async (row) => {
      const before = await app.probe()
      await modal()
      await ui.pointer(formatting + ' [data-plugin-command="formatting.bold"]')
      await app.until(
        () =>
          app.execute(
            'return [...document.querySelectorAll(arguments[0]+" [role=alert]")].some(e=>e.getClientRects().length>0&&e.textContent===arguments[1])',
            formatting,
            unsupportedContext,
          ),
        'visible bounded-context refusal',
      )
      row.visibleRefusal = unsupportedContext
      const after = await app.probe()
      assert.equal(after.version, before.version)
      assert.equal(after.dirty, before.dirty)
      await fileEquals(original)
      await app.shot('tail-formatting-visible-refusal')
      await closeModal()
      await ui.editorFocus()
      row.disk = await save()
    })
    for (const [width, height] of [
      [1280, 800],
      [760, 520],
    ])
      for (const zoom of [1, 2]) {
        nativeX('windowsize', ui.windowId(), String(width), String(height))
        await app.key('ctrl+0')
        await until((s) => s.zoom === 1, 'native application zoom reset')
        if (zoom === 2)
          for (const target of [1.25, 1.5, 2]) {
            await app.key('ctrl+equal')
            await until((s) => s.zoom === target, 'native zoom increment')
          }
        for (const sample of [...diagrams, { name: 'code', marker: 'CODE-SAMPLE' }])
          await step(`layout-${width}x${height}-${zoom * 100}-${sample.name}`, async (row) => {
            await ui.position(original, original.indexOf(sample.marker), 'live')
            // The mode flag precedes the asynchronous Worker presentation. Wait
            // for its actual target before reading geometry for native scrolling.
            await until(
              (s) =>
                s.mode === 'live' &&
                (sample.name === 'code'
                  ? s.pickers.some((picker) => picker.value === 'javascript')
                  : s.previews.some(
                      (preview) => preview.from === sample.from && preview.to === sample.to,
                    )),
              'layout target mounted after switching to Live',
            )
            // Caret navigation keeps the preceding marker visible; in a short
            // viewport the expanded graph or picker can still start below it.
            // Reveal that target with real wheel input before checking its layout.
            row.viewportReveal = []
            for (let attempt = 0; attempt < 8; attempt++) {
              const observed = await state()
              const rect =
                sample.name === 'code'
                  ? observed.pickers.find((picker) => picker.value === 'javascript')?.rect
                  : observed.previews.find((preview) => preview.from === sample.from)?.rect
              assert(rect, 'Mounted layout target before native scrolling')
              row.viewportReveal.push({ rect, editor: observed.editor })
              if (visibleInEditor(rect, observed)) break
              const window = ui.windowId()
              const geometry = nativeX('getwindowgeometry', '--shell', window)
              const scale = Number(/WIDTH=(\d+)/.exec(geometry)[1]) / observed.width
              const direction = rect.bottom <= observed.editor.top ? '4' : '5'
              inputs.push({ kind: 'wheel', direction, target: sample.name })
              nativeX(
                'mousemove',
                '--window',
                window,
                String(Math.round((observed.editor.left + 8) * scale)),
                String(Math.round(((observed.editor.top + observed.editor.bottom) / 2) * scale)),
                'click',
                direction,
              )
              await app.delay(150)
            }
            const current = sample.name === 'code' ? await code() : await diagram(sample)
            assert.equal(current.zoom, zoom)
            assert(current.editor.top >= current.header.bottom - 1)
            await until(
              (s) => !s.toolbar.visible && s.toolbar.rect.height === 0,
              'no toolbar outside table',
            )
            row.nativeGeometry = nativeX('getwindowgeometry', '--shell', ui.windowId())
            assert.equal(Number(/WIDTH=(\d+)/.exec(row.nativeGeometry)[1]), width)
            assert.equal(Number(/HEIGHT=(\d+)/.exec(row.nativeGeometry)[1]), height)
            await fileEquals(original)
          })
      }
    await step('final-original-bytes-build-and-enabled-profile', async (row) => {
      row.disk = await save()
      assert.equal(hash(await readFile(binary)), binarySha256)
      checkCatalog(await readFile(catalogPath))
      await ui.position(original, original.indexOf('CODE-SAMPLE'), 'source')
      await source()
      row.oneNativeSession = true
    })
    assert.equal(rows.length, 30, 'Fixed bounded acceptance plan')
  } catch (error) {
    failure = { message: String(error), stack: error.stack }
    throw error
  } finally {
    await report().catch(() => {})
    await app?.close()
    for (const lock of locks) {
      const record = JSON.parse(await readFile(lock, 'utf8'))
      assert.equal(record.token, lockToken, 'Only release this script’s own lock')
      await unlink(lock)
    }
  }
  console.log('BETA5 WINDOWED PASS', rows.length, 'steps; screenshots require visual review')
}

await main()

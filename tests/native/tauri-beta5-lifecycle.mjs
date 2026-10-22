// One frozen beta.5 build, one native session, continuous evidence. Caller launches
// the isolated driver; this script neither builds nor changes production assets.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, realpath, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { startProduction } from '../helpers/native-production.mjs'
import { action, x } from '../helpers/native-updates-fixture.mjs'
import { ownedApplication } from '../helpers/native-owned-process.mjs'
import {
  beta5Fixture,
  observeBeta5,
  readNativeClipboard,
} from '../helpers/native-beta5-fixture.mjs'

const required = (name) => (assert(process.env[name], `Set ${name}`), process.env[name])
const sha = (value) => createHash('sha256').update(value).digest('hex')
const underTmp = async (value) => {
  const resolved = await realpath(value)
  assert(resolved.startsWith('/tmp/'), 'Dedicated /tmp path required: ' + resolved)
  return resolved
}
const binary = await realpath(required('TAURI_APP_PATH'))
const binarySha256 = required('MILKUP_NATIVE_EXPECTED_BINARY_SHA256')
assert.equal(sha(await readFile(binary)), binarySha256, 'Frozen binary hash')
assert(!binary.includes('/target/'), 'Freeze the new binary outside shared Cargo targets')
assert.equal(required('MILKUP_NATIVE_EXCLUSIVE_DISPLAY'), '1')
assert(!process.env.WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS && !process.env.LD_PRELOAD)
const profile = await underTmp(required('MILKUP_NATIVE_PROFILE_ROOT'))
assert(!profile.includes('beta5-baseline'), 'Use a new beta.5 profile, not the beta.4 baseline')
const environmentKeys = [
  'XDG_CONFIG_HOME',
  'XDG_CACHE_HOME',
  'XDG_DATA_HOME',
  'XDG_RUNTIME_DIR',
  'DISPLAY',
]
const environmentEvidence = {
  expected: Object.fromEntries(environmentKeys.map((key) => [key, required(key)])),
  beforeLaunch: [],
  processEnvironmentVerified: false,
  status: 'not-read',
}
for (const name of ['XDG_CONFIG_HOME', 'XDG_CACHE_HOME', 'XDG_DATA_HOME']) {
  const directory = await realpath(required(name))
  assert(directory.startsWith(profile + path.sep), name + ' must be isolated')
  const entries = await readdir(directory)
  assert.deepEqual(entries, [], name + ' must be empty before launching the application')
  environmentEvidence.beforeLaunch.push({
    key: name,
    directory,
    entries,
    at: new Date().toISOString(),
  })
}
await underTmp(required('XDG_RUNTIME_DIR'))
if (process.env.MILKUP_NATIVE_DRIVER_ENV_RECORD) {
  const recordPath = await realpath(process.env.MILKUP_NATIVE_DRIVER_ENV_RECORD)
  const recordBytes = await readFile(recordPath),
    record = JSON.parse(recordBytes)
  for (const key of environmentKeys)
    assert.equal(
      record.environment?.[key],
      process.env[key],
      'Driver launch record matches requested ' + key,
    )
  if (record.driverPort !== undefined)
    assert.equal(
      Number(record.driverPort),
      Number(new URL(required('TAURI_DRIVER_URL')).port),
      'Recorded driver endpoint',
    )
  environmentEvidence.driverLaunchRecord = {
    path: recordPath,
    sha256: sha(recordBytes),
    record,
    capturedBeforeApplicationLaunch: true,
  }
}
await writeFile(
  path.join(profile, 'beta5-native-acceptance.lock'),
  JSON.stringify({ pid: process.pid, at: new Date().toISOString() }) + '\n',
  { flag: 'wx' },
)
await mkdir(required('MILKUP_NATIVE_EVIDENCE_DIR'), { recursive: true })
const output = await underTmp(process.env.MILKUP_NATIVE_EVIDENCE_DIR)
await writeFile(path.join(output, 'lifecycle.json'), '{}\n', { flag: 'wx' })
const archiveInputs = [
  { id: 'milkup.diagrams', version: '1.2.0', env: 'MILKUP_NATIVE_DIAGRAMS_ARCHIVE' },
]
const archives = []
for (const input of archiveInputs) {
  const archive = await realpath(required(input.env)),
    bytes = await readFile(archive),
    bundle = JSON.parse(bytes)
  assert.equal(bundle.format, 'milkup-plugin')
  assert.equal(bundle.manifest.id, input.id)
  assert.equal(bundle.manifest.version, input.version)
  assert.equal(bundle.manifest.host, 'worker')
  assert(
    !archive.startsWith(path.resolve('apps/desktop') + path.sep),
    'Independent package required',
  )
  archives.push({ ...input, archive, sha256: sha(bytes), manifest: bundle.manifest })
}
const bundledFormattingPath = path.resolve(
  'apps/desktop/src/bundled-plugins/milkup.formatting-1.0.1.milkup-plugin',
)
const bundledFormattingBytes = await readFile(bundledFormattingPath)
const bundledFormattingManifest = JSON.parse(bundledFormattingBytes).manifest
assert.equal(bundledFormattingManifest.id, 'milkup.formatting')
assert.equal(bundledFormattingManifest.version, '1.0.1')
assert.equal(bundledFormattingManifest.host, 'worker')
const bundledFormatting = {
  path: bundledFormattingPath,
  sha256: sha(bundledFormattingBytes),
  manifest: bundledFormattingManifest,
}
const documents = {
  flowchart:
    '# Flowchart hot lifecycle\n\n```mermaid\nflowchart TD\nA[Start] --> B[End]\n```\n\nOutside flowchart\n',
  sequence:
    '# Sequence hot lifecycle\n\n```mermaid\nsequenceDiagram\nparticipant A as Alice\nparticipant B as Bob\nA->>B: Hello\nB-->>A: Reply\n```\n\nOutside sequence\n',
  unknown:
    '# Unsupported Mermaid\n\n```mermaid\nunknownBetaFiveDiagram\nA --> B\n```\n\nOutside unsupported\n',
  table:
    '# Table toolbar\n\nOutside before table\n\n| Name | Value |\n| --- | --- |\n| Alpha | 1 |\n| Beta | 2 |\n\nOutside after table\n',
  plain: '# Separate plain document\n\nNo table in this document.\n',
  code: '# Code selection\r\n\r\n```js title="demo"\r\nconst 名 = "😀 <img src=x>"; // 原文保持\r\nconsole.log(名)\r\n```\r\n\r\nAfter code\r\n',
}
const unknownDiagramNotice =
  '受限流程图与时序图：exactly one diagram header is required。已保留完整源码。'
for (const [name, text] of Object.entries(documents))
  await writeFile(path.join(output, name + '.md'), text, { flag: 'wx' })
const paths = Object.fromEntries(
  Object.keys(documents).map((name) => [name, path.join(output, name + '.md')]),
)
const expectedVersion = process.env.MILKUP_NATIVE_EXPECTED_APP_VERSION ?? '2.0.0-beta.5'
assert.equal(expectedVersion, '2.0.0-beta.5', 'Beta.4 baseline cannot qualify as fixed acceptance')
const rows = [],
  inputs = [],
  startedAt = new Date().toISOString()
let app,
  ui,
  owner,
  active = 'flowchart',
  sequence = 0
const state = async () => ({
  ...(await observeBeta5(app)),
  probe: await app.probe(),
  file: {
    path: paths[active],
    sha256: sha(await readFile(paths[active])),
    bytes: (await readFile(paths[active])).length,
  },
})
const persist = async () =>
  writeFile(
    path.join(output, 'lifecycle.json'),
    JSON.stringify(
      {
        startedAt,
        binary,
        binarySha256,
        expectedVersion,
        profile,
        environmentEvidence,
        display: process.env.DISPLAY,
        owner: owner?.identity,
        archives,
        bundledFormatting,
        fixtures: Object.fromEntries(
          Object.entries(documents).map(([name, text]) => [
            name,
            { path: paths[name], source: text, sha256: sha(text) },
          ]),
        ),
        boundaries: [
          'Linux packaged Tauri/WebKit/X11 production build; one native application session.',
          'All interactions are actual native pointer/keyboard/GTK picker actions. DOM execution observes only; diagnostics injection is disabled.',
          'This fresh synthetic profile removes the Linux Diagrams DOM candidate and imports the independent Diagrams Worker through normal UI. Formatting 1.0.1 is activated from the current bundle. It is not a Windows migration or historical Formatting upgrade test.',
          'Small ordinary documents, live/source, native app zoom and window widths. Screenshots still need visual review. No Windows OS DPI, IME, large/windowed-document or update/rollback claim.',
        ],
        inputs,
        rows,
      },
      null,
      2,
    ) + '\n',
  )
async function shot(name) {
  await app.shot(name + '-webview')
  execFileSync(
    '/usr/bin/import',
    ['-display', process.env.DISPLAY, '-window', 'root', path.join(output, name + '-system.png')],
    { env: process.env, timeout: 10000 },
  )
  return Promise.all(
    ['webview', 'system'].map(async (kind) => {
      const file = name + '-' + kind + '.png',
        bytes = await readFile(path.join(output, file))
      return { file, sha256: sha(bytes), bytes: bytes.length, visuallyReviewed: false }
    }),
  )
}
async function step(label, run) {
  const name = String(++sequence).padStart(3, '0') + '-' + label
  const row = { name, startedAt: new Date().toISOString(), passed: false }
  rows.push(row)
  try {
    row.before = await state()
    const beforeAt = performance.now()
    await run(row)
    row.elapsedMs = Math.round(performance.now() - beforeAt)
    row.after = await state()
    assert.equal(
      (await readFile(`/proc/${owner.identity.pid}/cmdline`, 'utf8')).split('\0')[0],
      binary,
      'Same frozen application remains alive',
    )
    row.screenshots = await shot(name)
    row.passed = true
  } catch (error) {
    row.error = String(error)
    row.stack = error.stack
    row.after = await state().catch(() => null)
    row.screenshots = await shot(name + '-failure').catch(() => [])
    throw error
  } finally {
    row.finishedAt = new Date().toISOString()
    await persist()
    console.log(row.passed ? 'PASS' : 'FAIL', name)
  }
}
const unchanged = async (name = active) =>
  assert.equal(await readFile(paths[name], 'utf8'), documents[name], 'Exact source bytes: ' + name)
const settle = (test, label, limit = 2500) =>
  app.until(async () => test(await state()), label, limit)
async function save(expected = documents[active]) {
  await app.key('ctrl+s')
  await app.until(
    async () => {
      const probe = await app.probe()
      return !probe.dirty && !probe.saving && (await readFile(paths[active], 'utf8')) === expected
    },
    'normal Save preserves complete expected source',
    10000,
  )
}
async function open(name) {
  await ui.closeMenu()
  await app.key('ctrl+o')
  await ui.picker(paths[name])
  active = name
  await app.until(
    async () => {
      const probe = await app.probe()
      return probe.path === paths[name] && probe.loading === 'ready'
    },
    'normal GTK open ' + name,
    20000,
  )
}
const toggle = (id) => `.plugin-summary-card[data-plugin-id="${id}"] [role="switch"]`
async function togglePlugin(id, enabled, label) {
  await step(label, async (row) => {
    await ui.list()
    await ui.ready(toggle(id))
    // Reveal by native pointer-safe wheel BEFORE recording stable card geometry.
    await ui.pointer(`.plugin-summary-card[data-plugin-id="${id}"] .plugin-card-title`)
    const initial = await state(),
      target = initial.cards.find((card) => card.id === id)
    assert(target)
    assert.notEqual(
      target.checked,
      String(enabled),
      'This step must perform a real enable/disable transition',
    )
    row.samples = [initial]
    await ui.pointer(toggle(id))
    await app.until(
      async () => {
        const sample = await state(),
          card = sample.cards.find((card) => card.id === id)
        row.samples.push(sample)
        assert.deepEqual(
          sample.cards.map((item) => item.id),
          initial.cards.map((item) => item.id),
          'Card order stays stable through pending/active states',
        )
        assert(
          Math.abs(card.rect.top - target.rect.top) <= 1,
          'Toggled card does not jump vertically',
        )
        assert(
          Math.abs(card.rect.left - target.rect.left) <= 1,
          'Toggled card does not jump horizontally',
        )
        assert.equal(
          sample.menuScroll,
          initial.menuScroll,
          'Plugin panel scroll position stays fixed',
        )
        assert.equal(
          sample.probe.path,
          initial.probe.path,
          'Toggle keeps the already-open document',
        )
        assert.equal(
          sample.probe.version,
          initial.probe.version,
          'Toggle cannot change source version',
        )
        assert.equal(sample.probe.dirty, initial.probe.dirty, 'Toggle cannot make an editor change')
        return card.checked === String(enabled) && card.busy !== 'true'
      },
      'plugin toggle settled',
      15000,
    )
    await unchanged()
  })
}
async function importIndependent(input) {
  await step('prepare-independent-' + input.id, async (row) => {
    await ui.list()
    if (await ui.exists(toggle(input.id))) {
      row.removedSyntheticCandidate = (await state()).cards.find((card) => card.id === input.id)
      await ui.click(`.plugin-summary-card[data-plugin-id="${input.id}"] summary`)
      await ui.click(action('remove', input.id))
      await app.until(
        async () => !(await ui.exists(toggle(input.id))),
        'synthetic profile old candidate removed',
      )
    }
    await ui.click('[data-plugin-action="install"]')
    await ui.picker(input.archive)
    await app.until(
      () => ui.exists('[data-plugin-action="back"]'),
      'independent package information displayed',
    )
    row.details = await app.execute('return document.querySelector(".plugin-manager")?.textContent')
    assert(row.details.includes(input.version), 'Imported exact package version is visible')
    await ui.list()
    await app.until(
      async () => (await state()).cards.some((card) => card.id === input.id),
      'imported card',
    )
    assert.equal(
      (await state()).cards.find((card) => card.id === input.id).checked,
      'false',
      'Imported package starts disabled',
    )
    await ui.closeMenu()
    await unchanged()
  })
}
const diagramExpected = {
  flowchart: ['Start', 'End'],
  sequence: ['Alice', 'Bob', 'Hello', 'Reply'],
}
async function diagram(visible, { focused } = {}) {
  await settle(
    (s) =>
      visible
        ? diagramExpected[active].every((label) => s.vector.includes(label)) &&
          s.previews.length === 1
        : s.vector.length === 0 && s.previews.length === 0,
    visible ? 'immediate diagram in already-open document' : 'immediate source without diagram',
  )
  const current = await state()
  if (focused !== undefined) assert.equal(current.focus.editor, focused)
  if (visible)
    for (const label of current.vectorColors)
      assert.equal(label.fill, label.color, 'Default diagram labels follow the host text color')
  assert.equal(current.probe.path, paths[active])
  assert.equal(current.notices.length, 0, 'Supported syntax has no fallback warning')
  await unchanged()
}
async function exactSourceDOM(expected) {
  await settle(
    (s) => s.mode === 'source' && s.previews.length === 0 && s.pickers.length === 0,
    'complete source mode',
  )
  const current = await state()
  assert.equal(current.mode, 'source')
  assert.equal(current.previews.length, 0)
  assert.equal(current.notices.length, 0, 'Source mode clears presentation diagnostics')
  assert.equal(current.pickers.length, 0)
  assert.equal(
    current.lines.length,
    expected.split('\n').length,
    'Entire small document is mounted',
  )
  for (const line of current.lines) {
    const exact = expected.slice(line.from, line.to)
    assert.equal(line.text, exact || '\u200b', 'Exact source line and range ' + line.line)
  }
}
async function tableToolbar(visible) {
  await settle(
    (s) =>
      visible
        ? s.toolbar.formattingVisible &&
          s.toolbar.commands.some(
            (item) => item.command === 'formatting.tableAddRow' && !item.disabled && item.visible,
          )
        : !s.toolbar.formattingVisible && !s.toolbar.visible && s.toolbar.rect.height === 0,
    visible ? 'table toolbar follows current cell' : 'toolbar and empty host row disappear',
  )
  if (!visible) assert.equal((await state()).toolbar.display, 'none', 'No empty toolbar row')
}
async function codeLive(expected) {
  await settle(
    (s) => s.mode === 'live' && s.pickers.length === 1 && s.pickers[0].visible,
    'live code language picker remains visible',
  )
  const current = await state(),
    fences = current.code.filter((line) => /^`{3}/.test(line.text))
  assert.equal(fences.length, 2, 'Both original delimiters remain in mapped DOM')
  assert(
    fences.every((line) => line.hidden && line.display === 'none' && line.rect.height === 0),
    'Neither fence/info string is visible in Live',
  )
  assert.equal(fences[1].lineRect.height, 0, 'Closing delimiter leaves no blank code line')
  for (const line of current.code)
    assert.equal(line.text, expected.slice(line.from, line.to), 'Code source mapping stays exact')
  assert.equal(current.imagesInCode, 0, 'Code markup remains literal')
  assert.equal(current.windowed, false, 'Actual ordinary editor copy path')
}
async function clipboard(expected, row) {
  await app.key('ctrl+c')
  // Reading the external selection request waits for the real copy event to finish.
  const copied = readNativeClipboard()
  row.clipboard = {
    transport: 'real Ctrl+C -> X11 CLIPBOARD -> raw UTF8_STRING via independent GTK reader',
    text: copied,
    bytes: Buffer.byteLength(copied),
    sha256: sha(copied),
  }
  assert.equal(copied, expected, 'Actual system clipboard preserves exact source text')
}
try {
  app = await startProduction(paths.flowchart, output, { diagnostics: false })
  ui = beta5Fixture(app)
  const runtime = new URL(await app.execute('return location.href'))
  assert(
    (runtime.protocol === 'tauri:' && runtime.hostname === 'localhost') ||
      (['http:', 'https:'].includes(runtime.protocol) && runtime.hostname === 'tauri.localhost'),
    'Packaged Tauri origin only',
  )
  owner = await ownedApplication(binary, paths.flowchart)
  try {
    const environment = (await readFile(`/proc/${owner.identity.pid}/environ`, 'utf8')).split('\0')
    for (const key of environmentKeys)
      assert.equal(
        environment.find((entry) => entry.startsWith(key + '='))?.slice(key.length + 1),
        process.env[key],
        'Actual native process inherits dedicated ' + key,
      )
    environmentEvidence.status = 'verified-by-proc-read'
    environmentEvidence.processEnvironmentVerified = true
  } catch (error) {
    if (error.code !== 'EACCES') throw error
    environmentEvidence.status = 'proc-read-denied-indirect-profile-evidence-only'
    environmentEvidence.procReadError = {
      code: error.code,
      path: error.path,
      message: error.message,
    }
    environmentEvidence.boundary =
      'Application /proc/environ was not readable across the existing user namespace. The driver launch record and new application files in previously empty XDG paths are indirect evidence only; actual process environment is not directly verified. No namespace or sandbox change was made.'
    await persist()
    assert(
      environmentEvidence.driverLaunchRecord,
      'EACCES fallback requires MILKUP_NATIVE_DRIVER_ENV_RECORD with the frozen driver launch environment',
    )
    environmentEvidence.createdApplicationFiles = []
    for (const relative of [
      'plugins/catalog-v1.json',
      'localstorage/tauri_localhost_0.localstorage',
    ]) {
      const file = path.join(process.env.XDG_DATA_HOME, 'app.milkup.desktop', relative)
      const observed = await app.until(
        async () => {
          try {
            const resolved = await realpath(file)
            assert(
              resolved.startsWith(profile + path.sep),
              'New application file remains under the dedicated profile',
            )
            const info = await stat(resolved),
              bytes = await readFile(resolved)
            assert(info.isFile(), 'Expected application evidence is a regular file')
            return bytes.length > 0
              ? {
                  path: resolved,
                  bytes: bytes.length,
                  sha256: sha(bytes),
                  mtime: info.mtime.toISOString(),
                  observedAt: new Date().toISOString(),
                }
              : false
          } catch (error) {
            if (error.code === 'ENOENT') return false
            throw error
          }
        },
        'application creates isolated profile evidence ' + relative,
        15000,
      )
      environmentEvidence.createdApplicationFiles.push(observed)
    }
  }
  await persist()
  const nativeKey = app.key
  app.key = async (key) => {
    inputs.push({ at: new Date().toISOString(), kind: 'native-key', key })
    await nativeKey(key)
  }
  await step('frozen-beta5-open-document', async (row) => {
    x('windowsize', ui.windowId(), '1280', '800')
    await app.key('ctrl+0')
    await ui.menu()
    await ui.click('[data-menu-section="about"]')
    await settle((s) => s.appVersion === expectedVersion, 'new beta.5 application version', 10000)
    row.appVersion = (await state()).appVersion
    await ui.list()
    await app.until(
      async () =>
        (await ui.exists(toggle('milkup.diagrams'))) &&
        (await ui.exists(toggle('milkup.formatting'))),
      'bundled catalog initialization',
      15000,
    )
    row.bundledCards = (await state()).cards
    await ui.closeMenu()
    await ui.position(documents.flowchart, 0, 'source')
    await exactSourceDOM(documents.flowchart)
    await unchanged()
  })
  for (const input of archives) await importIndependent(input)
  await step('bundled-formatting-1-0-1-is-discoverable', async (row) => {
    await ui.details('milkup.formatting')
    row.details = await app.execute('return document.querySelector(".plugin-manager")?.textContent')
    assert(row.details.includes('1.0.1'), 'Current bundled Formatting version is visible')
    await ui.list()
    assert.equal(
      (await state()).cards.find((card) => card.id === 'milkup.formatting')?.checked,
      'false',
      'Privileged bundled Formatting starts disabled',
    )
    await ui.closeMenu()
    await unchanged()
  })
  for (const name of ['flowchart', 'sequence']) {
    await step(name + '-already-open-before-enable', async () => {
      if (active !== name) await open(name)
      await ui.position(documents[name], 0)
      await diagram(false, { focused: true })
    })
    await togglePlugin('milkup.diagrams', true, name + '-enable-card-position-stable')
    await step(name + '-return-immediate-preview', async () => {
      await ui.closeMenu()
      await diagram(true)
    })
    await togglePlugin('milkup.diagrams', false, name + '-disable-card-position-stable')
    await step(name + '-return-immediate-source', async () => {
      await ui.closeMenu()
      await diagram(false)
      await save()
    })
    await step(name + '-focused-inside-before-enable', async () => {
      await ui.position(
        documents[name],
        documents[name].indexOf(name === 'flowchart' ? 'flowchart TD' : 'sequenceDiagram'),
      )
      await diagram(false, { focused: true })
    })
    await togglePlugin('milkup.diagrams', true, name + '-enable-from-inside-caret')
    await step(name + '-blurred-inside-caret-renders', async (row) => {
      row.caretBeforeReturn = (await state()).cursor
      await diagram(true, { focused: false })
      await ui.closeMenu()
      row.editorFocusRestored = (await state()).focus.editor
      // Native button-focus policy can differ. A genuinely restored editing
      // focus protects the same inside caret; a blurred collapsed caret renders.
      await diagram(!row.editorFocusRestored, { focused: row.editorFocusRestored })
      assert.equal((await state()).cursor, row.caretBeforeReturn, 'Menu does not move source caret')
    })
    const source = documents[name],
      blockFrom = source.indexOf('```'),
      blockTo = source.indexOf('\n```', blockFrom + 3) + 5
    for (const [label, offset, visible] of [
      ['block-start', blockFrom, false],
      ['body', source.indexOf(name === 'flowchart' ? 'A[Start]' : 'A->>B'), false],
      ['closing-fence', blockTo - 4, false],
      ['exclusive-block-end', blockTo, true],
      ['outside', source.indexOf('Outside'), true],
    ])
      await step(name + '-focused-' + label, async () => {
        await ui.position(source, offset)
        await diagram(visible, { focused: true })
        assert.equal(
          (await state()).cursor,
          offset,
          'Presentation preserves focused caret at ' + label,
        )
      })
    await step(name + '-source-mode-complete', async () => {
      await app.key('ctrl+1')
      await exactSourceDOM(source)
      await save()
    })
    await step(name + '-source-to-live-immediate', async () => {
      await app.key('ctrl+2')
      await diagram(true, { focused: true })
    })
    if (name === 'flowchart') {
      await togglePlugin('milkup.diagrams', false, 'flowchart-disable-before-sequence-open')
      await ui.closeMenu()
    }
  }
  await step('noncollapsed-diagram-selection-stays-source', async () => {
    await ui.position(documents.sequence, documents.sequence.indexOf('A->>B'), 'source')
    await app.key('shift+End')
    const before = (await state()).selection
    assert(before.length > 0)
    await app.key('ctrl+2')
    await diagram(false, { focused: true })
    await ui.list()
    await diagram(false, { focused: false })
    await ui.closeMenu()
    assert.deepEqual((await state()).selection, before, 'Menu preserves noncollapsed selection')
    await save()
  })
  await step('unknown-mermaid-explicit-diagnostic', async () => {
    await open('unknown')
    await ui.position(documents.unknown, 0)
    await settle(
      (s) => s.notices.some((notice) => notice.text === unknownDiagramNotice && notice.visible),
      'explicit unsupported Mermaid explanation',
    )
    const current = await state()
    assert.equal(current.vector.length, 0)
    assert.equal(current.previews.length, 0)
    assert(current.notices.some((notice) => notice.visible))
    await save()
  })
  await step('unknown-diagnostic-survives-inside-selection-and-blur', async () => {
    await ui.position(
      documents.unknown,
      documents.unknown.indexOf('unknownBetaFiveDiagram'),
      'source',
    )
    await app.key('shift+End')
    await app.key('ctrl+2')
    await settle(
      (s) => s.notices.some((notice) => notice.text === unknownDiagramNotice && notice.visible),
      'selection must not suppress error notice',
    )
    await ui.list()
    await ui.closeMenu()
    const current = await state()
    assert(current.selection.length > 0)
    assert(current.notices.some((notice) => notice.text === unknownDiagramNotice && notice.visible))
    assert.equal(current.vector.length, 0)
    assert.equal(current.previews.length, 0)
    await save()
  })
  await step('unknown-source-is-byte-exact', async () => {
    await app.key('ctrl+1')
    await exactSourceDOM(documents.unknown)
    await save()
  })
  await step('table-open-outside-before-formatting-enable', async () => {
    await open('table')
    await ui.position(documents.table, 0)
    await tableToolbar(false)
  })
  await togglePlugin('milkup.formatting', true, 'formatting-enable-card-position-stable')
  await step('formatting-outside-no-toolbar-or-blank-row', async () => {
    await ui.closeMenu()
    await tableToolbar(false)
    await unchanged()
  })
  const tablePosition = documents.table.indexOf('Alpha')
  const tableWithRow = documents.table.replace('| Beta | 2 |', '|  |  |\n| Beta | 2 |')
  await step('formatting-enter-table-context', async () => {
    await ui.position(documents.table, tablePosition)
    await tableToolbar(true)
  })
  await step('formatting-add-row-real-toolbar-command', async () => {
    await ui.click(
      '[data-plugin-ui="milkup.formatting:formatting-toolbar"] [data-plugin-command="formatting.tableAddRow"]',
    )
    await save(tableWithRow)
    await tableToolbar(true)
  })
  await step('formatting-add-row-undo', async () => {
    await app.key('ctrl+z')
    await save()
    await tableToolbar(true)
  })
  await step('formatting-leave-table-no-empty-row', async () => {
    await app.key('ctrl+Home')
    await tableToolbar(false)
    await save()
  })
  await step('formatting-reenter-table', async () => {
    await ui.position(documents.table, tablePosition)
    await tableToolbar(true)
  })
  await step('formatting-switch-document-clears-context', async () => {
    await open('plain')
    await tableToolbar(false)
    await save()
  })
  await step('formatting-return-document-recaptures-context', async () => {
    await open('table')
    await ui.position(documents.table, tablePosition)
    await tableToolbar(true)
  })
  await togglePlugin('milkup.formatting', false, 'formatting-disable-with-active-table')
  await step('formatting-disabled-clears-toolbar-immediately', async () => {
    await ui.closeMenu()
    await tableToolbar(false)
    await save()
  })
  await togglePlugin('milkup.formatting', true, 'formatting-reenable-with-current-table')
  await step('formatting-reenabled-restores-current-context', async () => {
    await ui.closeMenu()
    await tableToolbar(true)
    await save()
  })
  await step('formatting-source-mode-outside-clears-context', async () => {
    await ui.position(documents.table, 0, 'source')
    await tableToolbar(false)
    await exactSourceDOM(documents.table)
  })
  await step('code-source-complete-before-live', async () => {
    await open('code')
    await ui.position(documents.code, 0, 'source')
    await exactSourceDOM(documents.code)
  })
  await step('code-live-picker-without-visible-fences', async () => {
    await app.key('ctrl+2')
    await codeLive(documents.code)
    await tableToolbar(false)
  })
  await step('code-live-full-selection-real-system-copy', async (row) => {
    assert((await state()).focus.editor)
    await app.key('ctrl+a')
    assert((await state()).selection.length > 0)
    await clipboard(documents.code, row)
    await codeLive(documents.code)
    await unchanged()
  })
  const body = 'const 名 = "😀 <img src=x>"; // 原文保持',
    bodyFrom = documents.code.indexOf(body)
  await step('code-live-body-selection-real-system-copy', async (row) => {
    await ui.position(documents.code, bodyFrom, 'source')
    await app.key('shift+End')
    await app.key('ctrl+2')
    const current = await state()
    assert(
      current.selection.some(
        (selection) => selection.from === bodyFrom && selection.to === bodyFrom + body.length,
      ),
      'Native exact body selection',
    )
    await clipboard(body, row)
    await codeLive(documents.code)
  })
  const replacedCode = documents.code.replace(body, 'native_selection_edit')
  await step('code-selection-edit-preserves-surrounding-source', async () => {
    await app.text('native_selection_edit')
    await save(replacedCode)
    await codeLive(replacedCode)
  })
  const consoleLine = 'console.log(名)',
    tailProbe = ' // native_tail_probe',
    probedCode = replacedCode.replace(consoleLine, consoleLine + tailProbe)
  await step('code-reused-line-native-pointer-edit-hits-current-source', async () => {
    // Stay in the same Live DOM: a source/live switch would rebuild it and hide
    // stale offset bugs. The real pointer, End key and edit must use current data.
    await ui.pointer('.milkup-line[data-line="5"] .milkup-code-source', { left: true })
    await app.key('End')
    await settle(
      (s) => s.cursor === replacedCode.indexOf(consoleLine) + consoleLine.length,
      'native pointer and End use the rebased source line',
    )
    await app.delay(600)
    await app.text(tailProbe)
    await save(probedCode)
    await codeLive(probedCode)
  })
  await step('code-native-pointer-edit-undo-restores-shortened-body', async () => {
    await app.key('ctrl+z')
    await save(replacedCode)
    await codeLive(replacedCode)
  })
  await step('code-selection-edit-undo-restores-source', async () => {
    await app.key('ctrl+z')
    await save()
    await codeLive(documents.code)
  })
  await step('code-language-picker-native-change', async () => {
    await ui.pointer('.milkup-code-language')
    await app.key('Home')
    // GTK versions differ: Home may commit immediately and the product then
    // focuses inputDOM. Do not send Return into that restored editor focus.
    await app.delay(100)
    if (!(await state()).focus.editor) await app.key('Return')
    await settle(
      (s) => s.pickers[0]?.value === '' && s.focus.editor,
      'native language picker committed',
    )
    await save(documents.code.replace('```js title=', '```text title='))
    await codeLive(documents.code.replace('```js title=', '```text title='))
    assert.equal((await state()).pickers[0].value, '')
  })
  await step('code-language-change-undo', async () => {
    await app.key('ctrl+z')
    await save()
    await codeLive(documents.code)
    assert.equal((await state()).pickers[0].value, 'javascript')
  })
  await step('code-language-change-redo', async () => {
    await app.key('ctrl+shift+z')
    await save(documents.code.replace('```js title=', '```text title='))
    await codeLive(documents.code.replace('```js title=', '```text title='))
  })
  await step('code-final-undo-and-source-complete', async () => {
    await app.key('ctrl+z')
    await save()
    await app.key('ctrl+1')
    await exactSourceDOM(documents.code)
  })
  // Width and app-zoom probes are in this same process/build after the full state
  // sequence. They do not claim OS DPI or pixel review; both screenshots are kept.
  await togglePlugin('milkup.preferences', true, 'preferences-enable-for-native-theme-matrix')
  for (const theme of ['light', 'dark']) {
    await step('matrix-native-theme-' + theme, async (row) => {
      await ui.closeMenu()
      await app.key('ctrl+0')
      x('windowsize', ui.windowId(), '1280', '800')
      await ui.list()
      await ui.click(action('open-ui', 'milkup.preferences'))
      const panel = '[data-plugin-ui="milkup.preferences:preferences-panel"]'
      const control = panel + ' [data-plugin-field-control="appearance.theme"]'
      await ui.ready(control)
      const options = await app.execute(
        'return [...document.querySelector(arguments[0]).options].map(e=>e.value)',
        control,
      )
      assert(options.includes(theme))
      await ui.pointer(control)
      await app.key('Home')
      for (let i = 0; i < options.indexOf(theme); i++) await app.key('Down')
      await app.key('Return')
      await app.key('Tab')
      await ui.click(panel + ' button[aria-label="保存"]')
      await app.until(
        () =>
          app.execute(
            'return document.querySelector(arguments[0])?.textContent.includes("偏好已保存")',
            panel,
          ),
        'preferences saved through native UI',
      )
      await ui.click(panel + ' .plugin-ui-close')
      await ui.closeMenu()
      await settle((s) => s.theme === theme && s.zoom === 1, 'native theme applied')
      row.theme = theme
      await unchanged()
    })
    for (const name of ['flowchart', 'sequence', 'code']) {
      await step('matrix-' + theme + '-' + name + '-open-wide-100', async () => {
        await open(name)
        await app.key('ctrl+0')
        x('windowsize', ui.windowId(), '1280', '800')
        await ui.position(documents[name], 0)
        if (name === 'code') await codeLive(documents.code)
        else await diagram(true, { focused: true })
      })
      for (const [zoomSteps, zoom] of [1, 1.25, 1.5, 2].entries()) {
        await step(
          'matrix-' + theme + '-' + name + '-narrow-' + Math.round(zoom * 100),
          async (row) => {
            x('windowsize', ui.windowId(), '760', '520')
            await app.key('ctrl+0')
            await settle((s) => s.zoom === 1, 'matrix zoom reset')
            for (let i = 0; i < zoomSteps; i++) {
              await app.key('ctrl+equal')
              await settle((s) => s.zoom === [1.25, 1.5, 2][i], 'native zoom increment')
            }
            await settle(
              (s) => s.zoom === zoom && s.theme === theme,
              'native matrix theme and zoom',
            )
            row.nativeGeometry = x('getwindowgeometry', '--shell', ui.windowId())
            assert.equal(Number(/WIDTH=(\d+)/.exec(row.nativeGeometry)[1]), 760)
            assert.equal(Number(/HEIGHT=(\d+)/.exec(row.nativeGeometry)[1]), 520)
            if (name === 'code') await codeLive(documents.code)
            else await diagram(true)
            await unchanged()
          },
        )
      }
    }
  }
  await step('final-all-original-files-and-build-unchanged', async (row) => {
    for (const name of Object.keys(documents)) await unchanged(name)
    assert.equal(sha(await readFile(binary)), binarySha256)
    for (const archive of archives)
      assert.equal(sha(await readFile(archive.archive)), archive.sha256)
    row.oneNativeSession = true
    row.pid = owner.identity.pid
    row.visualReviewRequired = true
  })
} catch (error) {
  await writeFile(
    path.join(output, 'failure.json'),
    JSON.stringify(
      {
        error: String(error),
        stack: error.stack,
        active,
        completedSteps: rows.filter((row) => row.passed).length,
      },
      null,
      2,
    ) + '\n',
  )
  await persist()
  throw error
} finally {
  await app?.close()
}
console.log(
  'BETA5 NATIVE LIFECYCLE PASS',
  rows.length,
  'continuous steps; screenshots require visual review',
)

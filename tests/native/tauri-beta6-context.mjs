// One frozen Linux production process; caller owns the isolated display/driver.
// Required: MILKUP_NATIVE_BETA6_CONTEXT_RUN=1, MILKUP_NATIVE_EXCLUSIVE_DISPLAY=1,
// TAURI_APP_PATH, MILKUP_NATIVE_EXPECTED_BINARY_SHA256, TAURI_DRIVER_URL, DISPLAY,
// MILKUP_NATIVE_PROFILE_ROOT, MILKUP_NATIVE_DRIVER_ENV_RECORD, XDG_CONFIG_HOME,
// XDG_CACHE_HOME, XDG_DATA_HOME, XDG_RUNTIME_DIR, MILKUP_NATIVE_EVIDENCE_DIR.
// Optional: MILKUP_NATIVE_EXPECTED_APP_VERSION (defaults to repository version).
// This prepares its own fixtures, never builds/seeds profiles/starts a driver.
// Run `node --check tests/native/tauri-beta6-context.mjs` without native effects.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, realpath, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { startProduction } from '../helpers/native-production.mjs'
import {
  beta5Fixture,
  observeBeta5,
  readNativeClipboard,
} from '../helpers/native-beta5-fixture.mjs'
import { ownNativeClipboard } from '../helpers/native-clipboard.mjs'
import { ownedApplication } from '../helpers/native-owned-process.mjs'
import { action, x } from '../helpers/native-updates-fixture.mjs'

const required = (key) => (assert(process.env[key], `Set ${key}`), process.env[key])
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex')
const canonicalTmp = async (value) => {
  const resolved = await realpath(value)
  assert(resolved.startsWith('/tmp/'), 'Dedicated /tmp path required: ' + resolved)
  assert.equal(resolved, path.resolve(value), 'Use canonical paths without symlinks')
  return resolved
}
const commandSelector = (id) => `[data-host-context-command="${id}"]`
const formattingId = 'milkup.formatting'
const formattingToggle = `.plugin-summary-card[data-plugin-id="${formattingId}"] [role="switch"]`
const basicCommands = ['copy', 'cut', 'paste', 'select-all', 'undo', 'redo'].map(
  (id) => 'host.' + id,
)
const prefix = (name) =>
  [
    `Beta6 ${name} 中文😀`,
    '',
    'Outside before table',
    '',
    '| Name | Value |',
    '| --- | --- |',
    '| Alpha | 1 |',
    '| Beta | 2 |',
    '',
    'Outside after table',
    '',
  ].join('\r\n') + '\r\n'
const originals = {
  ordinary: prefix('ordinary'),
  windowed:
    prefix('windowed') +
    Array.from(
      { length: 20_000 },
      (_, index) => `retained ${String(index).padStart(5, '0')} é 👩🏽‍💻 中文😀\r\n`,
    ).join('') +
    'TAIL 中文😀\r\n',
}
assert(Buffer.byteLength(originals.windowed) > 256 * 1024)
assert(Buffer.byteLength(originals.windowed) < 8 * 1024 * 1024)
assert(Object.values(originals).every((text) => !/(^|[^\r])\n/.test(text)))

async function main() {
  assert.equal(required('MILKUP_NATIVE_BETA6_CONTEXT_RUN'), '1', 'Explicit production run gate')
  assert.equal(required('MILKUP_NATIVE_EXCLUSIVE_DISPLAY'), '1')
  assert(!process.env.WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS && !process.env.LD_PRELOAD)
  const display = required('DISPLAY')
  assert(/^:\d+(?:\.\d+)?$/.test(display), 'Dedicated local X11 display')
  const driver = new URL(required('TAURI_DRIVER_URL'))
  assert(driver.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(driver.hostname))
  assert(driver.port && driver.pathname === '/' && !driver.username && !driver.password)
  const binary = await canonicalTmp(required('TAURI_APP_PATH'))
  assert(!binary.includes('/target/'), 'Use an approved frozen copy outside Cargo targets')
  const binarySha256 = required('MILKUP_NATIVE_EXPECTED_BINARY_SHA256')
  assert(/^[a-f0-9]{64}$/.test(binarySha256))
  assert.equal(hash(await readFile(binary)), binarySha256)
  const profile = await canonicalTmp(required('MILKUP_NATIVE_PROFILE_ROOT'))
  const environmentKeys = [
    'XDG_CONFIG_HOME',
    'XDG_CACHE_HOME',
    'XDG_DATA_HOME',
    'XDG_RUNTIME_DIR',
    'DISPLAY',
  ]
  for (const key of environmentKeys.filter((key) => key !== 'DISPLAY')) {
    const directory = await canonicalTmp(required(key))
    if (key !== 'XDG_RUNTIME_DIR')
      assert(directory.startsWith(profile + path.sep), key + ' is isolated')
  }
  const driverRecordPath = await canonicalTmp(required('MILKUP_NATIVE_DRIVER_ENV_RECORD'))
  const driverBytes = await readFile(driverRecordPath),
    driverRecord = JSON.parse(driverBytes)
  for (const key of environmentKeys)
    assert.equal(driverRecord.environment?.[key], process.env[key], 'Driver launch ' + key)
  if (driverRecord.driverPort !== undefined)
    assert.equal(Number(driverRecord.driverPort), Number(driver.port))
  await mkdir(required('MILKUP_NATIVE_EVIDENCE_DIR'), { recursive: true })
  const output = await canonicalTmp(process.env.MILKUP_NATIVE_EVIDENCE_DIR)
  const expectedVersion =
    process.env.MILKUP_NATIVE_EXPECTED_APP_VERSION ??
    JSON.parse(await readFile(new URL('../../package.json', import.meta.url))).version
  const paths = Object.fromEntries(
    Object.keys(originals).map((name) => [name, path.join(output, name + '-crlf.md')]),
  )
  const catalogPath = path.join(
    process.env.XDG_DATA_HOME,
    'app.milkup.desktop/plugins/catalog-v1.json',
  )
  const locks = [],
    token = randomUUID(),
    rows = [],
    inputs = [],
    startedAt = new Date().toISOString()
  const harness = await Promise.all(
    [
      import.meta.url,
      new URL('../helpers/native-production.mjs', import.meta.url),
      new URL('../helpers/native-beta5-fixture.mjs', import.meta.url),
      new URL('../helpers/native-clipboard.mjs', import.meta.url),
    ].map(async (url) => ({
      file: new URL(url).pathname,
      sha256: hash(await readFile(new URL(url))),
    })),
  )
  let app,
    ui,
    owner,
    active = 'ordinary',
    failure,
    processEnvironment,
    stopClipboard,
    reportOwned = false
  const persist = async () => {
    if (!reportOwned) return
    await writeFile(
      path.join(output, 'context.json'),
      JSON.stringify(
        {
          startedAt,
          binary,
          binarySha256,
          expectedVersion,
          profile,
          display,
          owner: owner?.identity,
          driverRecord: { path: driverRecordPath, sha256: hash(driverBytes), record: driverRecord },
          processEnvironment,
          harness,
          fixtures: Object.fromEntries(
            Object.entries(originals).map(([name, text]) => [
              name,
              {
                path: paths[name],
                bytes: Buffer.byteLength(text),
                utf16Length: text.length,
                sha256: hash(text),
              },
            ]),
          ),
          boundaries: [
            'Internal beta6 source candidate; displayed package version is independently recorded and may remain beta5. No Windows package, installer, OS DPI, IME, or Mermaid upgrade claim.',
            'One frozen Linux Tauri/WebKit process with ordinary and actual native windowed files. All product input uses real X11/GTK gestures; DOM execution only observes shipped UI.',
            'Clipboard input is owned by an independent GTK process and read back through native UTF8_STRING. No synthetic ClipboardEvent, navigator patch, permission override, or injected editor state.',
            'An explicitly reported clipboard API permission/platform failure is recorded as unavailable, never as clipboard success. Missing success or an explicit error fails this run.',
            'Screenshots are continuous evidence and still require visual review. Native application zoom is not Windows system DPI.',
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
    extra: await app.execute(`
const visible=e=>!!e&&!e.hidden&&getComputedStyle(e).display!=='none'&&e.getClientRects().length>0;
const rect=e=>e?.getBoundingClientRect().toJSON()??null;
const menu=document.querySelector('[data-editor-context-menu]'),host=menu?.querySelector('[data-host-context-menu]'),editor=document.querySelector('.milkup-editor'),toolbar=document.querySelector('[data-plugin-slot="document-toolbar"]');
const cursor=Number(document.querySelector('.milkup-cursor')?.dataset.position);
const cell=[...editor?.querySelectorAll('.milkup-table-cell')??[]].find(e=>Number(e.dataset.from)<=cursor&&Number(e.dataset.to)>=cursor);
return {menu:{visible:visible(menu),busy:menu?.getAttribute('aria-busy'),rect:rect(menu),top:[...host?.children??[]].filter(e=>e.matches('button')).map(e=>({id:e.dataset.hostContextCommand,disabled:e.disabled,svg:!!e.querySelector('svg[aria-hidden="true"]'),text:e.textContent})),pluginCommands:[...menu?.querySelectorAll('[data-plugin-command]')??[]].map(e=>e.dataset.pluginCommand)},focusCommand:document.activeElement?.dataset.hostContextCommand,scrollTop:editor?.scrollTop,scrollLeft:editor?.scrollLeft,toolbarPosition:toolbar?getComputedStyle(toolbar).position:null,liveCell:cell?{text:cell.textContent,rect:rect(cell),row:rect(cell.closest('.milkup-line')),from:Number(cell.dataset.from),to:Number(cell.dataset.to)}:null,busy:document.querySelector('[data-editor-host]')?.getAttribute('aria-busy'),clipboardAPI:{read:typeof navigator.clipboard?.readText,write:typeof navigator.clipboard?.write,ClipboardItem:typeof ClipboardItem}};`),
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
        const file = `${name}-${kind}.png`,
          bytes = await readFile(path.join(output, file))
        return { file, sha256: hash(bytes), visuallyReviewed: false }
      }),
    )
  }
  const step = async (label, run) => {
    const row = {
      name: `${String(rows.length + 1).padStart(2, '0')}-${label}`,
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
        active === 'windowed',
        'Actual ordinary/native windowed path',
      )
      assert.equal(
        (await readFile(`/proc/${owner.identity.pid}/cmdline`, 'utf8')).split('\0')[0],
        binary,
        'Same frozen process remains alive',
      )
      row.screenshots = await screenshot(row.name)
      row.passed = true
    } catch (error) {
      row.error = String(error)
      row.after = await state().catch(() => null)
      row.screenshots = await screenshot(row.name + '-failure').catch(() => [])
      throw error
    } finally {
      row.finishedAt = new Date().toISOString()
      await persist()
      console.log(row.passed ? 'PASS' : 'FAIL', row.name)
    }
  }
  const save = async (expected = originals[active]) => {
    await app.key('ctrl+s')
    await app.until(
      async () => {
        const probe = await app.probe()
        return (
          !probe.dirty &&
          !probe.saving &&
          (await readFile(paths[active])).equals(Buffer.from(expected))
        )
      },
      'one native Save writes exact complete CRLF/Unicode bytes',
      20_000,
    )
    const row = rows.at(-1)
    if (row) {
      row.saves ??= []
      row.saves.push({
        at: new Date().toISOString(),
        path: paths[active],
        sha256: hash(expected),
        bytes: Buffer.byteLength(expected),
        probe: await app.probe(),
      })
    }
  }
  const open = async (name) => {
    await ui.closeMenu()
    await app.key('ctrl+o')
    await ui.picker(paths[name])
    active = name
    await wait(
      (s) => s.probe.path === paths[name] && s.probe.loading === 'ready',
      'GTK open ' + name,
      30_000,
    )
  }
  const openContext = async () => {
    await app.key('shift+F10')
    await wait((s) => s.extra.menu.visible, 'trusted keyboard context menu')
  }
  const host = async (id) => {
    if (!(await state()).extra.menu.visible) await openContext()
    await ui.pointer(commandSelector(id), { scroll: false })
  }
  const committed = (version) =>
    wait(
      (s) => s.probe.version === version + 1 && s.extra.busy !== 'true',
      'one completed host history/edit',
    )
  const history = async (direction, expected) => {
    const before = await app.probe()
    await host('host.' + direction)
    await committed(before.version)
    await save(expected)
  }
  const table = async (visible) =>
    wait(
      (s) =>
        visible
          ? s.mode === 'live' &&
            s.toolbar.visible &&
            s.toolbar.formattingVisible &&
            s.toolbar.commands.some(
              (c) => c.command === 'formatting.tableAddRow' && c.visible && !c.disabled,
            ) &&
            s.extra.busy !== 'true'
          : !s.toolbar.visible,
      visible ? 'current Live table floating toolbar' : 'floating toolbar hidden',
    )
  const stableEditor = (before, after) => {
    for (const field of ['left', 'top', 'width', 'height'])
      assert(
        Math.abs(before.editor[field] - after.editor[field]) <= 1,
        'Floating UI preserves editor ' + field,
      )
    assert.equal(
      after.extra.scrollTop,
      before.extra.scrollTop,
      'Floating UI preserves editor scrollTop',
    )
    assert.equal(
      after.extra.scrollLeft,
      before.extra.scrollLeft,
      'Floating UI preserves editor scrollLeft',
    )
    assert.equal(after.cursor, before.cursor, 'Floating UI preserves actual source caret')
    assert.deepEqual(after.selection, before.selection, 'Floating UI preserves selection overlays')
    assert.equal(after.probe.version, before.probe.version)
    assert.equal(after.probe.dirty, before.probe.dirty)
  }
  const boundedLiveToolbar = (s) => {
    assert(
      s.extra.liveCell?.rect.width > 0 && s.extra.liveCell.rect.height > 0,
      'Real Live table cell is rendered',
    )
    assert.equal(s.extra.toolbarPosition, 'fixed')
    const bar = s.toolbar.rect,
      cell = s.extra.liveCell.rect
    assert(bar.width > 0 && bar.height > 0)
    assert(
      bar.left >= Math.max(0, s.editor.left) - 1 &&
        bar.right <= Math.min(s.width, s.editor.right) + 1,
    )
    assert(
      bar.top >= Math.max(0, s.editor.top) - 1 &&
        bar.bottom <= Math.min(s.height, s.editor.bottom) + 1,
    )
    const above = cell.top - Math.max(0, s.editor.top),
      below = Math.min(s.height, s.editor.bottom) - cell.bottom
    if (Math.max(above, below) >= bar.height + 8)
      assert(
        bar.bottom <= cell.top + 1 || bar.top >= cell.bottom - 1,
        'Toolbar avoids active Live cell when space exists',
      )
  }
  const toggleFormatting = async (enabled) => {
    await ui.list()
    await ui.pointer(formattingToggle)
    await wait(
      (s) =>
        s.cards.find((card) => card.id === formattingId)?.checked === String(enabled) &&
        s.cards.find((card) => card.id === formattingId)?.busy !== 'true',
      'Formatting toggle ' + enabled,
    )
    await ui.closeMenu()
  }
  const selectCopyRange = async () => {
    await ui.position(originals[active], 0, 'source')
    await app.key('shift+End')
    await app.key('shift+Right')
    const selected = originals[active].slice(0, originals[active].indexOf('\r\n') + 2)
    await wait(
      (s) => s.selection.some((range) => range.from === 0 && range.to >= selected.length - 2),
      'real native Unicode selection',
    )
    return selected
  }
  const clipboardCase = async (kind, row) => {
    const selected = kind === 'paste' ? 'Pasted é 👩🏽‍💻 😀\r\n' : await selectCopyRange()
    if (kind === 'paste') await ui.position(originals[active], 0, 'source')
    stopClipboard = await ownNativeClipboard(
      kind === 'paste' ? selected : 'prior clipboard ' + token,
    )
    const before = await app.probe()
    try {
      await host('host.' + kind)
      const notice = kind === 'paste' ? /读取系统剪贴板失败/ : /写入系统剪贴板失败/
      const finished = await wait(
        (s) =>
          s.extra.menu.busy !== 'true' &&
          (!s.extra.menu.visible || notice.test(s.probe.notice)) &&
          s,
        'clipboard commits or explicitly reports platform refusal',
        12_000,
      )
      if (notice.test(finished.probe.notice)) {
        assert.equal(
          finished.probe.version,
          before.version,
          'Denied clipboard operation never modifies source',
        )
        assert.equal(finished.probe.dirty, before.dirty)
        row.clipboard = {
          status: 'explicit-platform-failure',
          kind,
          notice: finished.probe.notice,
          api: finished.extra.clipboardAPI,
        }
        row.clipboard.screenshots = await screenshot(row.name + '-clipboard-refused')
        await app.key('Escape')
        await save()
      } else {
        if (kind !== 'paste')
          assert.equal(
            readNativeClipboard(),
            selected,
            'Independent GTK raw clipboard bytes match the source',
          )
        row.clipboard = {
          status: 'native-success',
          kind,
          bytes: Buffer.byteLength(selected),
          sha256: hash(selected),
          api: finished.extra.clipboardAPI,
        }
        if (kind === 'copy') {
          assert.equal(finished.probe.version, before.version)
          await save()
        } else {
          await committed(before.version)
          const expected =
            kind === 'cut' ? originals[active].slice(selected.length) : selected + originals[active]
          await save(expected)
          await history('undo', originals[active])
        }
      }
    } finally {
      stopClipboard?.()
      stopClipboard = undefined
    }
  }

  try {
    for (const lock of [
      path.join(profile, 'beta6-context.lock'),
      `/tmp/milkup-beta6-context-display-${/^:(\d+)/.exec(display)[1]}.lock`,
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
    assert.equal(existing, '', 'Dedicated display must have no existing Milkup application')
    await writeFile(path.join(output, 'context.json'), '{}\n', { flag: 'wx' })
    reportOwned = true
    for (const [name, text] of Object.entries(originals))
      await writeFile(paths[name], text, { flag: 'wx' })
    app = await startProduction(paths.ordinary, output, { diagnostics: false })
    owner = await ownedApplication(binary, paths.ordinary)
    const nativeKey = app.key
    app.key = async (key) => {
      inputs.push({ at: new Date().toISOString(), kind: 'native-key', key })
      return nativeKey(key)
    }
    ui = beta5Fixture(app)
    const pointer = ui.pointer
    ui.pointer = async (selector, options) => {
      inputs.push({ at: new Date().toISOString(), kind: 'native-pointer', selector })
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
      const entries = (await readFile(`/proc/${owner.identity.pid}/environ`, 'utf8')).split('\0')
      for (const key of environmentKeys)
        assert.equal(
          entries.find((entry) => entry.startsWith(key + '='))?.slice(key.length + 1),
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
    await step('frozen-candidate-and-all-plugins-disabled', async (row) => {
      x('windowsize', ui.windowId(), '1280', '800')
      await app.key('ctrl+0')
      await ui.menu()
      await ui.click('[data-menu-section="about"]')
      await wait((s) => s.appVersion === expectedVersion, 'recorded package version')
      await ui.list()
      await ui.ready(formattingToggle)
      row.catalogBefore = JSON.parse(await readFile(catalogPath, 'utf8'))
      for (const card of (await state()).cards.filter((card) => card.checked === 'true')) {
        await ui.pointer(`.plugin-summary-card[data-plugin-id="${card.id}"] [role="switch"]`)
        await wait(
          (s) =>
            s.cards.find((item) => item.id === card.id)?.checked === 'false' &&
            s.cards.find((item) => item.id === card.id)?.busy !== 'true',
          'disable ' + card.id,
        )
      }
      assert((await state()).cards.every((card) => card.checked === 'false'))
      await ui.closeMenu()
    })
    for (const name of ['ordinary', 'windowed']) {
      if (active !== name) await open(name)
      await step(name + '-host-menu-without-plugins', async (row) => {
        await ui.position(originals[name], 0, 'source')
        await ui.pointer('.milkup-line[data-line="1"]', { left: true })
        const before = await state()
        x('click', '3')
        inputs.push({ at: new Date().toISOString(), kind: 'native-pointer', button: 'right' })
        await wait((s) => s.extra.menu.visible, 'real native right-click context menu')
        const s = await state()
        assert.equal(s.cursor, before.cursor, 'Opening the pointer menu retains the caret')
        assert.deepEqual(s.selection, before.selection)
        row.pointerBefore = before
        assert.deepEqual(
          s.extra.menu.top.map((item) => item.id),
          [...basicCommands, 'host.insert'],
        )
        assert(
          s.extra.menu.top.every((item) => item.svg),
          'Every basic item has a real SVG icon',
        )
        assert.deepEqual(s.extra.menu.pluginCommands, [])
      })
      await app.key('Escape')
      await step(name + '-keyboard-nested-insert-history-and-exact-save', async () => {
        await ui.position(originals[name], 0, 'source')
        const before = await app.probe()
        await openContext()
        for (const [key, focus] of [
          ['End', 'host.insert'],
          ['Right', 'host.insert.heading'],
          ['Right', 'host.insert.heading-1'],
          ['Down', 'host.insert.heading-2'],
        ]) {
          await app.key(key)
          await wait((s) => s.extra.focusCommand === focus, 'keyboard menu focus ' + focus)
        }
        await app.key('Return')
        await committed(before.version)
        await save('## ' + originals[name])
        await history('undo', originals[name])
        await history('redo', '## ' + originals[name])
        await history('undo', originals[name])
      })
      await step(name + '-select-all-without-scrolling-or-document-write', async (row) => {
        await ui.position(originals[name], 0, 'source')
        const before = await state()
        await host('host.select-all')
        await wait(
          (s) => !s.extra.menu.visible && s.selection.length > 0,
          'host selects actual source document',
        )
        const selected = await state()
        assert.equal(selected.probe.version, before.probe.version)
        assert.equal(selected.extra.scrollTop, before.extra.scrollTop)
        assert.deepEqual(selected.editor, before.editor)
        if (name === 'windowed') {
          await host('host.copy')
          await wait(
            (s) => /有界编辑范围/.test(s.probe.notice) && s.extra.menu.busy !== 'true',
            'large copy is explicitly bounded',
          )
          row.boundedNotice = (await app.probe()).notice
          await app.key('Escape')
        }
        await app.key('Right')
        await wait(
          (s) => s.probe.cursor === originals[name].length,
          'selection collapses at exact UTF-16 document end',
        )
        await save()
      })
      for (const kind of ['copy', 'cut', 'paste'])
        await step(name + '-real-system-' + kind, (row) => clipboardCase(kind, row))
    }

    await open('ordinary')
    await step('ordinary-live-enable-preserves-selection-and-editor-geometry', async (row) => {
      await ui.position(originals.ordinary, originals.ordinary.indexOf('Alpha'))
      const before = await state()
      assert(!before.toolbar.visible)
      await toggleFormatting(true)
      await table(true)
      const after = await state()
      stableEditor(before, after)
      boundedLiveToolbar(after)
      row.catalog = JSON.parse(await readFile(catalogPath, 'utf8'))
      const entry = row.catalog.payload.entries.find((entry) => entry.id === formattingId)
      assert.equal(entry.active.manifest.version, '1.0.1')
      assert.match(entry.active.sourcePath, /^bundled:/)
    })
    for (const name of ['ordinary', 'windowed']) {
      if (active !== name) await open(name)
      await step(name + '-live-cell-floating-command-save-and-undo', async () => {
        await ui.position(originals[name], originals[name].indexOf('Alpha'))
        await table(true)
        boundedLiveToolbar(await state())
        const before = await app.probe()
        await ui.pointer(
          '[data-plugin-slot="document-toolbar"] [data-plugin-command="formatting.tableAddRow"]',
        )
        await committed(before.version)
        await save(originals[name].replace('| Alpha | 1 |\r\n', '| Alpha | 1 |\r\n|  |  |\r\n'))
        await history('undo', originals[name])
      })
      // Four native zoom values, both wide and narrow windows, spread over the
      // ordinary/windowed flows instead of repeating the old 99-step suite.
      for (const [zoomSteps, zoom] of [1, 1.25, 1.5, 2].entries()) {
        const width = (name === 'ordinary') === (zoomSteps % 2 === 0) ? 1280 : 760
        await step(name + '-live-geometry-' + width + '-' + Math.round(zoom * 100), async (row) => {
          x('windowsize', ui.windowId(), String(width), '800')
          await app.key('ctrl+0')
          await wait((s) => s.zoom === 1, 'native application zoom reset')
          for (let index = 0; index < zoomSteps; index++) {
            await app.key('ctrl+equal')
            await wait((s) => s.zoom === [1.25, 1.5, 2][index], 'native application zoom increment')
          }
          await wait((s) => s.zoom === zoom, 'real native application zoom')
          await ui.position(originals[name], originals[name].indexOf('Alpha'))
          await table(true)
          const before = await state()
          boundedLiveToolbar(before)
          await ui.menu()
          await table(false)
          stableEditor(before, await state())
          await ui.closeMenu()
          await table(true)
          const after = await state()
          stableEditor(before, after)
          boundedLiveToolbar(after)
          row.nativeWindow = x('getwindowgeometry', '--shell', ui.windowId())
          row.liveCell = after.extra.liveCell
          assert.equal(Number(/WIDTH=(\d+)/.exec(row.nativeWindow)[1]), width)
        })
      }
      await app.key('ctrl+0')
      await wait((s) => s.zoom === 1, 'native application zoom reset')
      x('windowsize', ui.windowId(), '1280', '800')
      await step(name + '-disable-removes-floating-content-without-edit', async () => {
        await ui.position(originals[name], originals[name].indexOf('Alpha'))
        await table(true)
        const before = await state()
        await toggleFormatting(false)
        await table(false)
        const after = await state()
        stableEditor(before, after)
        assert.equal(after.toolbar.commands.length, 0)
        await save()
      })
      await toggleFormatting(true)
      await table(true)
    }
    await step('uninstall-formatting-clears-floating-and-retains-host-menu', async () => {
      const before = await state()
      await ui.list()
      await ui.pointer(`.plugin-summary-card[data-plugin-id="${formattingId}"] summary`)
      await ui.pointer(action('remove', formattingId))
      await app.until(
        async () => !(await ui.exists(formattingToggle)),
        'normal UI removes Formatting',
      )
      await ui.closeMenu()
      await table(false)
      const after = await state()
      stableEditor(before, after)
      assert.equal(after.toolbar.commands.length, 0)
      await openContext()
      assert.deepEqual(
        (await state()).extra.menu.top.map((item) => item.id),
        [...basicCommands, 'host.insert'],
      )
      await app.key('Escape')
      await save()
    })
    await step('final-original-bytes-and-frozen-build', async (row) => {
      for (const name of Object.keys(originals))
        assert.deepEqual(await readFile(paths[name]), Buffer.from(originals[name]))
      assert.equal(hash(await readFile(binary)), binarySha256)
      row.clipboardOutcomes = rows
        .filter((row) => row.clipboard)
        .map((row) => ({ step: row.name, ...row.clipboard }))
      row.allClipboardOperationsSucceeded = row.clipboardOutcomes.every(
        (result) => result.status === 'native-success',
      )
      row.catalog = JSON.parse(await readFile(catalogPath, 'utf8'))
    })
  } catch (error) {
    failure = { message: String(error), stack: error.stack }
    throw error
  } finally {
    stopClipboard?.()
    await persist().catch(() => {})
    await app?.close()
    for (const lock of locks) {
      assert.equal(
        JSON.parse(await readFile(lock, 'utf8')).token,
        token,
        'Release only this run’s lock',
      )
      await unlink(lock)
    }
  }
  console.log(
    'BETA6 CONTEXT CANDIDATE PASS',
    rows.length,
    'steps; inspect clipboard outcomes and review screenshots',
  )
}

await main()

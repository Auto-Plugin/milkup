// Native production list typing acceptance. Never starts a display, driver or WM.
// Opt in with MILKUP_NATIVE_BETA7_LIST_RUN=1 on a root-reserved exclusive display.
// All input is XTest; execute() only observes shipped DOM. No injected state/IPC,
// synthetic composition, clipboard substitution, build, upload or installation.
// Required env matches tauri-beta7-appearance-check.mjs except the opt-in above.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, realpath, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { startProduction } from '../helpers/native-production.mjs'
import { beta5Fixture, observeBeta5 } from '../helpers/native-beta5-fixture.mjs'
import { ownedApplication } from '../helpers/native-owned-process.mjs'
import { x } from '../helpers/native-updates-fixture.mjs'

const required = (name) => (assert(process.env[name], 'Set ' + name), process.env[name])
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex')
const canonicalTmp = async (value) => {
  const result = await realpath(value)
  assert(result.startsWith('/tmp/'), 'Dedicated /tmp path required')
  assert.equal(result, path.resolve(value), 'No symlink aliases')
  return result
}
const fixture = (windowed) =>
  [
    '# Native list 中文😀',
    '',
    ...(windowed
      ? Array.from(
          { length: 6000 },
          (_, i) => 'P' + String(i).padStart(5, '0') + ' ' + 'a'.repeat(52),
        )
      : ['Ordinary paragraph 中文']),
    '',
    '```text',
    '- [ ] Code literal',
    '```',
    '',
    'TAIL 中文😀 é 👩🏽‍💻',
    '',
    '',
  ].join('\r\n')

async function main() {
  const harnessSource = await readFile(new URL(import.meta.url))
  const harnessSha256 = hash(harnessSource)
  const capturedAt = new Date().toISOString()
  const helperNames = [
    'native-production.mjs',
    'native-startup.mjs',
    'native-beta5-fixture.mjs',
    'native-owned-process.mjs',
    'native-updates-fixture.mjs',
  ]
  const helperSources = await Promise.all(
    helperNames.map(async (name) => ({
      name,
      bytes: await readFile(new URL('../helpers/' + name, import.meta.url)),
    })),
  )
  assert.equal(required('MILKUP_NATIVE_BETA7_LIST_RUN'), '1')
  assert.equal(required('MILKUP_NATIVE_EXCLUSIVE_DISPLAY'), '1')
  assert(!process.env.WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS && !process.env.LD_PRELOAD)
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
  const expectedVersion = required('MILKUP_NATIVE_EXPECTED_APP_VERSION')
  assert(/^2\.0\.0-beta\.\d+$/.test(expectedVersion), 'Exact candidate About version')
  const sourceSha = required('MILKUP_NATIVE_EXPECTED_SOURCE_SHA')
  assert(/^[a-f0-9]{40}$/.test(sourceSha))
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
      assert(dir.startsWith(profile + path.sep), 'Private profile ' + key)
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
  assert(
    output !== profile && !output.startsWith(profile + path.sep),
    'Evidence separate from app profile',
  )
  const fixtures = [false, true].map((windowed) => ({
    kind: windowed ? 'windowed' : 'ordinary',
    windowed,
    original: fixture(windowed),
    path: path.join(output, (windowed ? 'windowed' : 'ordinary') + '-列表 中文.md'),
  }))
  for (const f of fixtures) {
    assert(!/(^|[^\r])\n/.test(f.original), 'CRLF fixture')
    assert.equal(Buffer.byteLength(f.original) > 256 * 1024, f.windowed)
    assert.equal(f.original.length > 256 * 1024, f.windowed)
    f.base = f.original.length
    f.line = f.original.split('\n').length
  }
  const startedAt = new Date().toISOString(),
    token = randomUUID()
  const rows = [],
    inputs = [],
    locks = [],
    sessions = [],
    cleanup = []
  let app,
    ui,
    owner,
    failure,
    reportOwned = false,
    launchTrackingActive = false,
    generation = 0
  let current = fixtures[0],
    documentPath = current.path,
    expectedText = current.original
  const launchProcesses = new Map()
  const persist = async () => {
    if (!reportOwned) return
    await writeFile(
      path.join(output, 'list-input.json'),
      JSON.stringify(
        {
          startedAt,
          finishedAt: new Date().toISOString(),
          expectedVersion,
          sourceSha,
          sourceShaBoundary:
            'Supplied build provenance; binary hash and displayed About version checked independently.',
          binary,
          binarySha256,
          profile,
          display,
          driverRecord: { path: driverRecordPath, sha256: hash(driverBytes), record: driverRecord },
          harnessSha256,
          capturedAt,
          harnessSnapshot: 'harness-startup-source.mjs',
          helpers: helperSources.map(({ name, bytes }) => ({ name, sha256: hash(bytes) })),
          fixtures: fixtures.map((f) => ({
            kind: f.kind,
            path: f.path,
            originalPath: f.kind + '-original.md',
            bytes: Buffer.byteLength(f.original),
            sha256: hash(f.original),
            tailOffset: f.base,
            tailLine: f.line,
          })),
          boundaries: [
            'Linux production native XTest only; not Windows, installation, system DPI or real Chinese IME validation.',
            'No application state or event injection. DOM is observation-only; every edited phase also requires complete saved CRLF/Unicode bytes.',
            'Static loaded empty-task compatibility is unchanged. An active undelimited task prefix stays literal until its trailing separator.',
            'Screenshots require separate pixel review; no upload, commit or publishing action is performed.',
          ],
          sessions,
          launchProcesses: [...launchProcesses.values()],
          inputs,
          rows,
          cleanup,
          failure,
        },
        null,
        2,
      ) + '\n',
    )
  }
  const state = async () => {
    const observed = await observeBeta5(app)
    const details = await app.execute(`
const root=document.querySelector('.milkup-editor'),cursor=root?.querySelector('.milkup-cursor');
const rect=e=>e?.getBoundingClientRect().toJSON()??null;
const entry=e=>({text:e.textContent,classes:e.className,from:Number(e.dataset.from),to:Number(e.dataset.to),rect:rect(e),display:getComputedStyle(e).display,visibility:getComputedStyle(e).visibility,checked:e.getAttribute('aria-checked'),disabled:!!e.disabled});
return {editor:rect(root),cursor:rect(cursor),focus:document.activeElement?.matches('.milkup-input-proxy'),focusedTask:document.activeElement?.matches('.milkup-task-marker[role="checkbox"]')?Number(document.activeElement.dataset.from):null,lines:[...root.querySelectorAll('.milkup-line')].map(e=>({line:Number(e.dataset.line),from:Number(e.dataset.from),to:Number(e.dataset.to),text:e.textContent,classes:e.className,rect:rect(e),markers:[...e.querySelectorAll('.milkup-list-marker')].map(entry),tasks:[...e.querySelectorAll('[role="checkbox"]')].map(entry)}))};`)
    const bytes = await readFile(documentPath)
    return {
      ...observed,
      details,
      probe: await app.probe(),
      file: { path: documentPath, sha256: hash(bytes), bytes: bytes.length },
    }
  }
  const wait = (test, label, timeout = 15000) =>
    app.until(
      async () => {
        const observed = await state()
        return test(observed) ? observed : false
      },
      label,
      timeout,
    )
  const screen = async (name) => {
    await app.shot(name + '-webview')
    execFileSync(
      '/usr/bin/import',
      ['-display', display, '-window', 'root', path.join(output, name + '-system.png')],
      { env: process.env, timeout: 10000 },
    )
    return Promise.all(
      ['webview', 'system'].map(async (kind) => ({
        file: name + '-' + kind + '.png',
        sha256: hash(await readFile(path.join(output, name + '-' + kind + '.png'))),
        visuallyReviewed: false,
      })),
    )
  }
  const step = async (name, run) => {
    const row = {
      name: String(rows.length + 1).padStart(2, '0') + '-' + current.kind + '-' + name,
      startedAt: new Date().toISOString(),
      passed: false,
      phases: [],
    }
    rows.push(row)
    try {
      row.before = await state()
      await run(row)
      row.after = await state()
      assert.equal(row.after.probe.path, documentPath)
      assert.equal(row.after.windowed, current.windowed, 'Expected actual document route')
      assert.equal(row.after.file.sha256, hash(expectedText), 'Whole fixture saved bytes')
      row.screenshots = await screen(row.name)
      row.passed = true
    } catch (error) {
      row.error = String(error)
      row.stack = error.stack
      row.after = await state().catch(() => null)
      row.screenshots = await screen(row.name + '-failure').catch(() => [])
      throw error
    } finally {
      row.finishedAt = new Date().toISOString()
      await persist()
      console.log(row.passed ? 'PASS' : 'FAIL', row.name)
    }
  }
  const alive = async (identity) => {
    if (!identity) return false
    try {
      const stat = await readFile(`/proc/${identity.pid}/stat`, 'utf8')
      const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ')
      if (['Z', 'X'].includes(fields[0])) {
        identity.observedExitedState = fields[0]
        return false
      }
      return fields[19] === identity.birth
    } catch (error) {
      if (['ENOENT', 'ESRCH'].includes(error.code)) return false
      throw error
    }
  }
  const findExactLaunchProcesses = async () => {
    const matches = []
    for (const leaf of await readdir('/proc')) {
      if (!/^\d+$/.test(leaf)) continue
      try {
        const argv = (await readFile(`/proc/${leaf}/cmdline`, 'utf8')).split('\0')
        if (argv[0] !== binary || !argv.includes(documentPath)) continue
        const stat = await readFile(`/proc/${leaf}/stat`, 'utf8')
        matches.push({
          pid: Number(leaf),
          argv,
          birth: stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19],
        })
      } catch (error) {
        if (!['ENOENT', 'ESRCH', 'EACCES', 'EPERM'].includes(error.code)) throw error
      }
    }
    return matches
  }
  const rememberLaunchProcesses = async () => {
    if (!launchTrackingActive) return
    for (const identity of await findExactLaunchProcesses()) {
      const key = identity.pid + ':' + identity.birth
      if (!launchProcesses.has(key))
        launchProcesses.set(key, { ...identity, generation, observedAt: new Date().toISOString() })
    }
  }
  const signalExactLaunch = async (identity, signal) => {
    try {
      if (!(await alive(identity))) return
      const argv = (await readFile(`/proc/${identity.pid}/cmdline`, 'utf8')).split('\0')
      if (!(await alive(identity))) return
      assert.deepEqual(argv, identity.argv, 'Recheck exact owned launch argv before signalling')
      assert.equal(argv[0], binary)
      assert(argv.includes(documentPath))
      process.kill(identity.pid, signal)
      cleanup.push({
        pid: identity.pid,
        birth: identity.birth,
        signal,
        at: new Date().toISOString(),
      })
    } catch (error) {
      if (!['ENOENT', 'ESRCH'].includes(error.code)) throw error
    }
  }
  const closeSession = async () => {
    // Track exact binary+fixture argv while startup is pending as well as after
    // a window exists; a pre-window startup failure must not orphan the app.
    const errors = []
    try {
      await rememberLaunchProcesses()
    } catch (error) {
      errors.push(error)
      cleanup.push({ phase: 'cleanup-process-snapshot', error: String(error) })
    }
    try {
      await app?.close()
    } catch (error) {
      errors.push(error)
      cleanup.push({ phase: 'session-close', error: String(error) })
    }
    for (const identity of launchProcesses.values()) {
      try {
        if (!(await alive(identity))) continue
        await signalExactLaunch(identity, 'SIGTERM')
        const start = Date.now()
        while ((await alive(identity)) && Date.now() - start < 4000)
          await new Promise((resolve) => setTimeout(resolve, 100))
        if (await alive(identity)) {
          await signalExactLaunch(identity, 'SIGKILL')
          const killedAt = Date.now()
          while ((await alive(identity)) && Date.now() - killedAt < 2000)
            await new Promise((resolve) => setTimeout(resolve, 100))
          assert(!(await alive(identity)), 'Owned application generation exited after cleanup')
        }
      } catch (error) {
        errors.push(error)
        cleanup.push({
          phase: 'owned-generation-cleanup',
          pid: identity.pid,
          birth: identity.birth,
          error: String(error),
        })
      }
    }
    app = undefined
    ui = undefined
    owner = undefined
    launchTrackingActive = false
    if (errors.length) throw new AggregateError(errors, 'Application cleanup incomplete')
  }
  const launch = async () => {
    assert.equal(hash(await readFile(binary)), binarySha256)
    generation++
    const sessionOutput = path.join(output, 'session-' + generation)
    await mkdir(sessionOutput, { recursive: false })
    assert.deepEqual(
      await findExactLaunchProcesses(),
      [],
      'No pre-existing matching application process',
    )
    // A rejected pre-existing process must never be adopted by final cleanup.
    // Begin tracking only after the baseline is empty and this launch starts.
    launchTrackingActive = true
    let settled = false,
      trackingFailure
    const pending = startProduction(documentPath, sessionOutput, { diagnostics: false })
    pending.then(
      () => {
        settled = true
      },
      () => {
        settled = true
      },
    )
    while (!settled) {
      try {
        await rememberLaunchProcesses()
      } catch (error) {
        trackingFailure ??= error
      }
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
    app = await pending
    await rememberLaunchProcesses()
    if (trackingFailure) throw trackingFailure
    owner = await ownedApplication(binary, documentPath)
    const nativeKey = app.key,
      nativeText = app.text,
      nativeShot = app.shot
    app.key = async (value) => {
      inputs.push({ at: new Date().toISOString(), generation, kind: 'XTest-key', value })
      return nativeKey(value)
    }
    app.text = async (value) => {
      assert(/^[\x20-\x7e]*$/.test(value))
      inputs.push({ at: new Date().toISOString(), generation, kind: 'XTest-text', value })
      return nativeText(value)
    }
    // startProduction screenshots go to the generation directory; copy only our
    // requested image into the root evidence directory for stable report links.
    app.shot = async (name) => {
      await nativeShot(name)
      await writeFile(
        path.join(output, name + '.png'),
        await readFile(path.join(sessionOutput, name + '.png')),
      )
    }
    ui = beta5Fixture(app)
    const pointer = ui.pointer
    ui.pointer = async (...args) => {
      inputs.push({
        at: new Date().toISOString(),
        generation,
        kind: 'XTest-pointer',
        selector: args[0],
      })
      return pointer(...args)
    }
    const runtime = await app.execute(
      'return {url:location.href,diagnostics:typeof window.__productionDiagnostics,developmentProbe:typeof window.__searchProbe}',
    )
    assert.equal(runtime.diagnostics, 'undefined')
    assert.equal(runtime.developmentProbe, 'undefined')
    const session = {
      generation,
      owner: owner.identity,
      runtime,
      startedAt: new Date().toISOString(),
    }
    try {
      const env = (await readFile(`/proc/${owner.identity.pid}/environ`, 'utf8')).split('\0')
      for (const key of envKeys)
        assert.equal(
          env.find((v) => v.startsWith(key + '='))?.slice(key.length + 1),
          process.env[key],
        )
      session.environment = { verified: true, method: 'read-only /proc/environ' }
    } catch (error) {
      if (error.code !== 'EACCES') throw error
      session.environment = {
        verified: false,
        method: 'matching driver launch record; indirect only',
        error: String(error),
      }
    }
    sessions.push(session)
    x('windowsize', '--sync', ui.windowId(), '1280', '800')
    await app.key('ctrl+0')
    await wait(
      (s) => s.probe.loading === 'ready' && s.appVersion === expectedVersion,
      'Ready exact About version',
    )
  }
  const tailEnd = async (mode = 'live') => {
    await ui.editorFocus()
    await app.key('ctrl+End')
    await wait((s) => s.cursor === expectedText.length, 'Native Ctrl+End reaches exact tail')
    if (mode === 'live') await app.key('ctrl+2')
    await wait(
      (s) => s.mode === mode && s.cursor === expectedText.length && s.details.focus,
      'Tail editing mode ' + mode,
    )
  }
  const savedPhase = async (
    row,
    label,
    suffix,
    { mode = 'live', caret = current.base + suffix.length, taskFocus = false } = {},
  ) => {
    const expected = current.original + suffix
    const phase = {
      label,
      suffix,
      mode,
      expectedFocusBeforeSave: taskFocus ? 'task-checkbox' : 'editor-input',
      expectedFocusAfterSave: 'editor-input',
      expectedCursor: caret,
      expectedBytes: Buffer.byteLength(expected),
      expectedSha256: hash(expected),
      passed: false,
    }
    row.phases.push(phase)
    if (taskFocus) {
      const beforeSave = await wait(
        (s) =>
          s.details.focusedTask === current.base + 2 &&
          s.details.lines
            .find((line) => line.line === current.line)
            ?.tasks.some(
              (task) =>
                task.from === current.base + 2 &&
                task.checked === String(suffix[3] !== ' ') &&
                !task.disabled,
            ),
        'Native checkbox activation preserves its accessible focus before Save',
      )
      phase.beforeSave = {
        focusedTask: beforeSave.details.focusedTask,
        cursor: beforeSave.cursor,
        line: beforeSave.details.lines.find((line) => line.line === current.line),
      }
      assert.equal(beforeSave.cursor, caret, 'Checkbox activation preserves the original caret')
    }
    // Commit and inspect the actual complete file before accepting visual success.
    // The existing Save command deliberately restores editor input focus.
    await app.key('ctrl+s')
    await app.until(
      async () => {
        const p = await app.probe()
        return !p.dirty && !p.saving && (await readFile(documentPath)).equals(Buffer.from(expected))
      },
      'Exact saved whole fixture ' + label,
      30000,
    )
    expectedText = expected
    const s = await wait(
      (s) => s.mode === mode && s.cursor === caret,
      'Caret remains exact after ' + label,
    )
    const line = s.details.lines.find((l) => l.line === current.line)
    assert(line, 'Tail line is actually rendered')
    phase.actualSha256 = s.file.sha256
    phase.actualBytes = s.file.bytes
    phase.observed = {
      cursor: s.cursor,
      selection: s.selection,
      line,
      caret: s.details.cursor,
      editor: s.details.editor,
    }
    assert.equal(s.file.sha256, phase.expectedSha256)
    assert.equal(s.windowed, current.windowed)
    assert(!/(^|[^\r])\n/.test((await readFile(documentPath)).toString()), 'No CRLF normalization')
    assert(s.details.focus, 'Explicit Save restores or retains editor input focus')
    const r = s.details.cursor,
      bounds = s.details.editor
    assert(r && bounds && r.width > 0 && r.height > 0, 'Visible caret geometry')
    assert(
      r.left >= Math.max(0, bounds.left) - 1 &&
        r.right <= Math.min(s.width, bounds.right) + 1 &&
        r.top >= Math.max(0, bounds.top) - 1 &&
        r.bottom <= Math.min(s.height, bounds.bottom) + 1,
      'Caret stays inside visible editor',
    )
    if (suffix === '') {
      // Both views use a zero-width placeholder to give an empty source line
      // geometry. Accept it only for an independently saved empty source range.
      assert.equal(line.from, current.base)
      assert.equal(line.to, current.base)
      assert(['', '\u200b'].includes(line.text), 'Empty line contains only its layout placeholder')
      assert.equal(line.markers.length, 0)
      assert.equal(line.tasks.length, 0)
      assert(!line.classes.includes('milkup-block-list'))
    } else if (mode === 'source') {
      assert.equal(line.text, suffix, 'Source prefix is literal')
      assert.equal(line.markers.length, 0)
      assert.equal(line.tasks.length, 0)
    } else if (suffix.length < 2) {
      assert.equal(line.text, suffix, 'Bare bullet remains visible source')
      assert(
        !line.classes.includes('milkup-block-list'),
        'Uncommitted bullet is not styled as a list',
      )
      assert.equal(line.markers.length, 0)
      assert.equal(line.tasks.length, 0)
    } else {
      assert.equal(line.markers.length, 1)
      assert.equal(line.markers[0].text, '•')
      const task = /^[-+*] \[[ xX]\] /.test(suffix)
      assert.equal(line.tasks.length, task ? 1 : 0, 'Task appears only with trailing separator')
      if (task) {
        assert.equal(line.tasks[0].checked, String(suffix[3] !== ' '))
        assert.equal(line.tasks[0].from, current.base + 2)
        assert.equal(line.tasks[0].to, current.base + 6)
        assert(
          line.markers[0].classes.includes('milkup-marker-hidden'),
          'Task does not show a second bullet',
        )
      } else {
        assert(!line.markers[0].classes.includes('milkup-marker-hidden'))
        assert(line.markers[0].rect.width > 0, 'Committed bullet visible')
        if (suffix.length > 2)
          assert(line.text.includes(suffix.slice(2)), 'Incomplete brackets remain visible')
      }
    }
    phase.passed = true
    await persist()
    console.log('  PHASE', current.kind, label, JSON.stringify(suffix))
    return s
  }
  const resetTailInSource = async () => {
    await tailEnd('source')
    await app.key('Home')
    await app.key('shift+End')
    await app.key('BackSpace')
    await app.key('ctrl+s')
    await app.until(
      async () => {
        const p = await app.probe()
        return (
          !p.dirty &&
          !p.saving &&
          (await readFile(documentPath)).equals(Buffer.from(current.original))
        )
      },
      'Source line removal restores complete original bytes',
      30000,
    )
    expectedText = current.original
    await tailEnd()
  }
  try {
    for (const lock of [
      path.join(profile, 'beta7-list-input.lock'),
      `/tmp/milkup-beta7-list-display-${/^:(\d+)/.exec(display)[1]}.lock`,
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
    assert.equal(existing, '', 'Reserved display has no existing application')
    const wm = execFileSync('xprop', ['-root', '_NET_SUPPORTING_WM_CHECK'], {
      env: process.env,
      encoding: 'utf8',
      timeout: 5000,
    })
    assert(/0x[1-9a-f][0-9a-f]*/i.test(wm), 'Existing WM required; harness never starts one')
    await writeFile(path.join(output, 'list-input.json'), '{}\n', { flag: 'wx' })
    reportOwned = true
    await writeFile(path.join(output, 'harness-startup-source.mjs'), harnessSource, { flag: 'wx' })
    await mkdir(path.join(output, 'helpers-startup'), { recursive: false })
    for (const { name, bytes } of helperSources)
      await writeFile(path.join(output, 'helpers-startup', name), bytes, { flag: 'wx' })
    for (const f of fixtures) {
      await writeFile(f.path, f.original, { flag: 'wx' })
      await writeFile(path.join(output, f.kind + '-original.md'), f.original, { flag: 'wx' })
    }
    await persist()
    for (const f of fixtures) {
      current = f
      documentPath = f.path
      expectedText = f.original
      await launch()
      await step('six-native-prefix-keys', async (row) => {
        await tailEnd()
        let suffix = ''
        for (const character of '- [ ] ') {
          await app.text(character)
          suffix += character
          await savedPhase(row, 'type-' + suffix.length, suffix)
        }
      })
      await step('checkbox-click-source-undo-redo', async (row) => {
        await ui.pointer('.milkup-line[data-line="' + current.line + '"] [role="checkbox"]')
        await savedPhase(row, 'pointer-toggle', '- [x] ', { taskFocus: true })
        // Checkbox focus is intentional for accessible repeated activation. Use
        // real input to return to the same tail before issuing editor shortcuts.
        await tailEnd()
        await app.key('ctrl+z')
        await savedPhase(row, 'undo-toggle', '- [ ] ')
        await app.key('ctrl+shift+z')
        await savedPhase(row, 'redo-toggle', '- [x] ')
        await app.key('ctrl+z')
        await savedPhase(row, 'undo-before-source', '- [ ] ')
        await app.key('ctrl+1')
        await savedPhase(row, 'source-keeps-task-markdown', '- [ ] ', { mode: 'source' })
        await app.key('ctrl+2')
        await savedPhase(row, 'live-restores-task', '- [ ] ')
      })
      await step('backspace-prefix-and-history', async (row) => {
        // Preserve established empty-task Backspace behavior; explicitly select
        // only its final separator before testing the incomplete prefixes.
        await app.key('shift+Left')
        await app.key('BackSpace')
        await savedPhase(row, 'remove-selected-task-separator', '- [ ]')
        for (const suffix of ['- [ ', '- [', '- ', '']) {
          await app.key('BackSpace')
          await savedPhase(row, 'backspace-to-' + suffix.length, suffix)
        }
        await app.key('ctrl+z')
        await savedPhase(row, 'undo-empty-list-exit', '- ')
        await app.key('ctrl+shift+z')
        await savedPhase(row, 'redo-empty-list-exit', '')
      })
      await step('plus-star-same-input-rule', async (row) => {
        for (const bullet of ['+', '*']) {
          await app.text(bullet)
          await savedPhase(row, 'bare-' + bullet, bullet)
          await app.text(' ')
          await savedPhase(row, 'committed-' + bullet, bullet + ' ')
          await app.key('BackSpace')
          await savedPhase(row, 'exit-' + bullet, '')
        }
      })
      await step('source-input-stays-literal', async (row) => {
        await tailEnd('source')
        let suffix = ''
        for (const character of '- [ ] ') {
          await app.text(character)
          suffix += character
          await savedPhase(row, 'source-type-' + suffix.length, suffix, { mode: 'source' })
        }
        await resetTailInSource()
        await savedPhase(row, 'source-removal-original', '')
      })
      await step('code-block-literal-and-original-byte-roundtrip', async (row) => {
        // Only a few native arrows from Ctrl+End, even on a large windowed file.
        await tailEnd('source')
        const codeLine =
          current.original.split('\n').findIndex((line) => line === '- [ ] Code literal\r') + 1
        assert(codeLine > 0)
        const distance = current.line - codeLine
        assert(distance > 0 && distance < 10)
        for (let i = 0; i < distance; i++) await app.key('Up')
        await app.key('Home')
        const offset = current.original.indexOf('- [ ] Code literal')
        await wait((s) => s.cursor === offset, 'Native caret reaches code literal')
        await app.key('ctrl+2')
        const s = await wait(
          (s) =>
            s.mode === 'live' &&
            s.cursor === offset &&
            s.details.lines.some((l) => l.line === codeLine),
          'Live code line visible',
        )
        const line = s.details.lines.find((l) => l.line === codeLine)
        assert(line.classes.includes('milkup-block-code'), 'Actually inside fenced code')
        assert(line.text.includes('- [ ] Code literal'), 'Code task-looking text visible')
        assert.equal(line.tasks.length, 0)
        assert.equal(line.markers.length, 0)
        row.code = { line, offset }
        await app.key('ctrl+s')
        await app.until(
          async () => {
            const p = await app.probe()
            return (
              !p.dirty &&
              !p.saving &&
              (await readFile(documentPath)).equals(Buffer.from(current.original))
            )
          },
          'Final exact original bytes',
          30000,
        )
        row.final = {
          sha256: hash(await readFile(documentPath)),
          originalSha256: hash(current.original),
          bytes: Buffer.byteLength(current.original),
        }
        assert.equal(row.final.sha256, row.final.originalSha256)
      })
      await closeSession()
    }
    assert.equal(hash(await readFile(binary)), binarySha256)
  } catch (error) {
    failure = { message: String(error), stack: error.stack, at: new Date().toISOString() }
    if (app) {
      failure.state = await state().catch(() => null)
      failure.screenshots = await screen('unhandled-failure').catch(() => [])
    }
    throw error
  } finally {
    // Evidence failure must never bypass app/clipboard/owned-lock cleanup.
    try {
      await persist()
    } catch (error) {
      cleanup.push({ phase: 'persist-before-cleanup', error: String(error) })
      console.error(error)
    }
    try {
      await closeSession()
    } catch (error) {
      cleanup.push({ phase: 'application-cleanup', error: String(error) })
      console.error(error)
    }
    for (const lock of locks) {
      try {
        if (JSON.parse(await readFile(lock)).token === token) await unlink(lock)
      } catch (error) {
        cleanup.push({ phase: 'owned-lock-cleanup', lock, error: String(error) })
        console.error(error)
      }
    }
    try {
      await persist()
    } catch (error) {
      cleanup.push({ phase: 'persist-after-cleanup', error: String(error) })
      console.error('Final evidence persistence failed', error)
    }
    if (!failure && cleanup.some((entry) => entry.error)) {
      throw new Error('Acceptance cleanup/evidence failed: ' + JSON.stringify(cleanup))
    }
  }
}

await main()

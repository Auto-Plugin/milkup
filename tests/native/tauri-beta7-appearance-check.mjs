// Prepared acceptance harness only: never builds or starts a display/driver/WM.
// Run only after root reserves the existing exclusive X11/xfwm4 session.
// Required: MILKUP_NATIVE_BETA7_APPEARANCE_RUN=1, MILKUP_NATIVE_EXCLUSIVE_DISPLAY=1,
// TAURI_APP_PATH, MILKUP_NATIVE_EXPECTED_BINARY_SHA256,
// MILKUP_NATIVE_EXPECTED_APP_VERSION, MILKUP_NATIVE_EXPECTED_SOURCE_SHA,
// TAURI_DRIVER_URL, DISPLAY, MILKUP_NATIVE_PROFILE_ROOT,
// MILKUP_NATIVE_DRIVER_ENV_RECORD, MILKUP_NATIVE_EVIDENCE_DIR and private XDG homes.
// All evidence stays in the supplied /tmp directory; no upload/commit is performed.
// Input is XTest/GTK; execute() only reads shipped DOM. No iframe DOM access,
// native API invocation, CSS injection, document mutation or diagnostic injection.
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdir, readFile, readdir, realpath, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { startProduction } from '../helpers/native-production.mjs'
import { beta5Fixture, observeBeta5 } from '../helpers/native-beta5-fixture.mjs'
import { ownedApplication } from '../helpers/native-owned-process.mjs'
import { ownNativeClipboard } from '../helpers/native-clipboard.mjs'
import { verifyNativeTitlebarMenu } from '../helpers/native-titlebar-menu.mjs'
import { x } from '../helpers/native-updates-fixture.mjs'

const required = (name) => (assert(process.env[name], 'Set ' + name), process.env[name])
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex')
const canonicalTmp = async (value) => {
  const result = await realpath(value)
  assert(result.startsWith('/tmp/'), 'Dedicated /tmp path required')
  assert.equal(result, path.resolve(value), 'No symlink aliases')
  return result
}
const original = [
  '# 外观验收 中文😀',
  '',
  'Alpha 中文 👩🏽‍💻 é Omega',
  '',
  '- [ ] 保留任务',
  '- [x] 已完成',
  '',
  '| L | C | R |',
  '| :--- | :---: | ---: |',
  '| a | 完成 | 123.45 |',
  '',
  '```js',
  'const label = "中文😀";',
  'console.log(label);',
  '```',
  '',
  '```mermaid',
  'flowchart TD',
  'A[Start] --> B[End]',
  '```',
  '',
  '> quote 中文',
  '',
  'TAIL 中文😀',
  '',
].join('\r\n')
assert(!/(^|[^\r])\n/.test(original))
const goodCss = [
  '/* 自建受限主题：只用固定颜色与统一编辑器字号，不使用资源或逐行几何。 */',
  ':root { --panel-bg:#fff4da; --text:#234567; --chrome-bg:#eee0bd; --code-bg:#f0e5cf; --code-text:#663399; }',
  ':root[data-theme="dark"] { --panel-bg:#15283b; --text:#d9edff; --chrome-bg:#102031; --code-bg:#203449; --code-text:#f0c9ff; }',
  '.milkup-editor { font-family:serif; font-size:18px; line-height:27px; color:var(--text); background:var(--panel-bg); }',
  '.milkup-block-heading { color:var(--text); font-weight:700; }',
  '.milkup-block-code { color:var(--code-text); background:var(--code-bg); }',
  '.milkup-table-cell { border-color:var(--text); }',
  '',
].join('\n')
const badCss = {
  url: '.milkup-editor{background:u\\72l("https://example.invalid/theme-probe")}',
  import: '@import "file:///milkup-synthetic-never-read.css";\n.milkup-editor{color:red}',
}

async function main() {
  const harnessSource = await readFile(new URL(import.meta.url))
  const harnessSha256 = hash(harnessSource)
  const capturedAt = new Date().toISOString()
  const helperNames = [
    'native-production.mjs',
    'native-startup.mjs',
    'native-beta5-fixture.mjs',
    'native-owned-process.mjs',
    'native-clipboard.mjs',
    'native-titlebar-menu.mjs',
    'native-updates-fixture.mjs',
  ]
  const helperSources = await Promise.all(
    helperNames.map(async (name) => ({
      name,
      bytes: await readFile(new URL('../helpers/' + name, import.meta.url)),
    })),
  )
  assert.equal(required('MILKUP_NATIVE_BETA7_APPEARANCE_RUN'), '1')
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
  assert(!output.startsWith(profile + path.sep), 'Evidence stays separate from app profile')
  const documentPath = path.join(output, '外观 验收 #&.md')
  const cssPaths = {
    good: path.join(output, '海蓝 主题 #&.css'),
    url: path.join(output, '拒绝 URL 中文 #&.css'),
    import: path.join(output, '拒绝 import 中文 #&.css'),
  }
  const themeRoot = path.join(
    process.env.XDG_DATA_HOME,
    'app.milkup.desktop',
    'appearance-themes-v1',
  )
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
    expectedText = original,
    generation = 0
  let defaultStyleHash, importedStyleHash, importedRecord, importedCopyPath, stopClipboard
  const launchProcesses = new Map()
  const themeDisk = async () => {
    let names
    try {
      names = await readdir(themeRoot)
    } catch (error) {
      if (error.code === 'ENOENT') return null
      throw error
    }
    const files = []
    for (const name of names.sort()) {
      if (!/^(?:default\.css|theme-v1\.json|theme-[a-f0-9]{64}(?:-copy\d+)?\.css)$/.test(name))
        continue
      const file = path.join(themeRoot, name),
        stat = await lstat(file)
      assert(stat.isFile() && !stat.isSymbolicLink(), 'Private theme evidence is a regular file')
      const bytes = await readFile(file)
      files.push({
        name,
        path: file,
        bytes: bytes.length,
        sha256: hash(bytes),
        ...(name === 'theme-v1.json' ? { envelope: JSON.parse(bytes) } : {}),
      })
    }
    return { root: themeRoot, files }
  }
  const persist = async () => {
    if (!reportOwned) return
    await writeFile(
      path.join(output, 'appearance.json'),
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
          fixtures: {
            document: {
              path: documentPath,
              sha256: hash(original),
              bytes: Buffer.byteLength(original),
            },
            themes: Object.entries(cssPaths).map(([name, file]) => ({
              name,
              path: file,
              sha256: hash(name === 'good' ? goodCss : badCss[name]),
            })),
          },
          boundaries: [
            'Linux production native input and private fixtures only; not Windows/WebView2, real installation, system DPI or IME verification.',
            'DOM observations only; opaque preview iframe contents are never accessed. Screenshots need actual pixel review.',
            'No external resources, plugin installation, CSS injection, IPC invocation or user files are used. The existing bundled Diagrams candidate is enabled through its ordinary card switch.',
            'Only the fixture flowchart is checked under the imported light/dark theme. Actual decoded output, screenshot OCR labels and connecting ink are required; this is not full Mermaid grammar coverage or visual-quality approval.',
            'Open-current-theme exercises the existing OS association without changing it. Request acceptance is not proof an editor GUI opened.',
            'System mode is observed against the existing OS preference; no OS theme or security setting is changed.',
            'Evidence remains under /tmp; no commit, upload, CI or publishing action is performed.',
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
    const detail = await app.execute(`
const panel=document.querySelector('[data-menu-panel="appearance"]'),style=document.querySelector('style[data-appearance-theme]'),editor=document.querySelector('.milkup-editor'),menu=document.querySelector('[data-app-menu]');
const rect=e=>e?.getBoundingClientRect().toJSON()??null;
const computed=e=>{if(!e)return null;const c=getComputedStyle(e);return {fontSize:c.fontSize,lineHeight:c.lineHeight,fontFamily:c.fontFamily,color:c.color,background:c.backgroundColor,outline:c.outline}};
return {phase:menu?.dataset.phase,menuHidden:menu?.hidden,panelHidden:panel?.hidden,name:panel?.querySelector('[data-theme-name]')?.textContent,feedback:panel?.querySelector('[data-theme-feedback]')?.textContent,feedbackError:panel?.querySelector('[data-theme-feedback]')?.dataset.error,currentPath:panel?.querySelector('[data-theme-open]')?.title,
controls:[...panel?.querySelectorAll('button')??[]].map(e=>({mode:e.dataset.themeMode??null,import:e.hasAttribute('data-theme-import'),reset:e.hasAttribute('data-theme-reset'),open:e.hasAttribute('data-theme-open'),disabled:e.disabled,pressed:e.getAttribute('aria-pressed'),rect:rect(e)})),
previews:[...panel?.querySelectorAll('iframe[data-preview]')??[]].map(e=>({mode:e.dataset.preview,sandbox:e.getAttribute('sandbox'),src:e.getAttribute('src'),srcdoc:e.getAttribute('srcdoc'),rect:rect(e)})),style:style?.textContent??null,editorComputed:computed(editor),heading:computed(document.querySelector('.milkup-block-heading')),code:computed(document.querySelector('.milkup-block-code')),cursorRect:rect(document.querySelector('.milkup-cursor')),inputRect:rect(document.querySelector('.milkup-input-proxy')),osDark:matchMedia('(prefers-color-scheme:dark)').matches,focusInert:!!document.activeElement?.closest('[hidden],[inert]')};`)
    detail.styleHash = detail.style === null ? null : hash(detail.style)
    for (const frame of detail.previews) {
      frame.srcdocSha256 = hash(frame.srcdoc ?? '')
      frame.srcdocBytes = Buffer.byteLength(frame.srcdoc ?? '')
      delete frame.srcdoc
    }
    delete detail.style
    return {
      ...observed,
      probe: await app.probe(),
      appearance: detail,
      disk: await themeDisk(),
      file: { path: documentPath, sha256: hash(await readFile(documentPath)) },
    }
  }
  const wait = (test, label, timeout = 15000) =>
    app.until(async () => test(await state()), label, timeout)
  const bodyVisuals = () =>
    app.execute(`
const editor=document.querySelector('.milkup-editor'),bounds=editor?.getBoundingClientRect(),menu=document.querySelector('[data-app-menu]');
const rect=e=>e?.getBoundingClientRect().toJSON()??null;
const visible=e=>{if(!e||!bounds||!menu?.hidden||editor.closest('[inert]'))return false;const r=e.getBoundingClientRect(),c=getComputedStyle(e);if(c.display==='none'||c.visibility==='hidden'||Number(c.opacity)===0||r.width<=0||r.height<=0||r.left<Math.max(0,bounds.left)||r.right>Math.min(innerWidth,bounds.right)||r.top<Math.max(0,bounds.top)||r.bottom>Math.min(innerHeight,bounds.bottom))return false;const hit=document.elementFromPoint((r.left+r.right)/2,(r.top+r.bottom)/2);return !!hit&&(e===hit||e.contains(hit));};
const style=e=>{const c=getComputedStyle(e);return {color:c.color,background:c.backgroundColor,align:c.textAlign,paddingLeft:parseFloat(c.paddingLeft),paddingRight:parseFloat(c.paddingRight),borderLeft:parseFloat(c.borderLeftWidth),borderRight:parseFloat(c.borderRightWidth)}};
const ink=e=>{const walker=document.createTreeWalker(e,NodeFilter.SHOW_TEXT),nodes=[];let n;while(n=walker.nextNode())if(/\\S/.test(n.textContent))nodes.push(n);if(!nodes.length)return null;const first=nodes[0],last=nodes.at(-1),r=document.createRange();r.setStart(first,first.textContent.search(/\\S/));r.setEnd(last,last.textContent.search(/\\s*$/));return r.getBoundingClientRect().toJSON()};
return {width:innerWidth,height:innerHeight,menuHidden:menu?.hidden,editor:rect(editor),
tables:[...editor.querySelectorAll('.milkup-block-table')].map(row=>({rect:rect(row),cells:[...row.querySelectorAll('.milkup-table-cell')].map(e=>({text:e.textContent.trim(),visible:visible(e),rect:rect(e),ink:ink(e),style:style(e)}))})),
code:[...editor.querySelectorAll('.milkup-code-source')].map(e=>({text:e.textContent,visible:visible(e),rect:rect(e),style:style(e),blockStyle:style(e.closest('.milkup-block-code')??e),tokens:[...e.querySelectorAll('[class*="milkup-code-token-"]')].map(t=>({text:t.textContent,classes:t.className,visible:visible(t),style:style(t)}))})),
pickers:[...editor.querySelectorAll('.milkup-code-language')].map(e=>({value:e.value,visible:visible(e),disabled:e.disabled,rect:rect(e)})),
images:[...editor.querySelectorAll('[data-document-presentation] img')].map(e=>({visible:visible(e),complete:e.complete,width:e.naturalWidth,height:e.naturalHeight,rect:rect(e),srcKind:e.currentSrc?.split(':')[0]})),
vectors:[...editor.querySelectorAll('[data-document-presentation] svg')].map(e=>({visible:visible(e),rect:rect(e),labels:[...e.querySelectorAll('text')].map(t=>t.textContent),edges:[...e.querySelectorAll('path,line,polyline')].filter(p=>getComputedStyle(p).stroke!=='none'&&parseFloat(getComputedStyle(p).strokeWidth)>0).length}))};`)
  const screen = async (name) => {
    await app.shot(name + '-webview')
    execFileSync(
      '/usr/bin/import',
      ['-display', display, '-window', 'root', path.join(output, name + '-system.png')],
      { env: process.env, timeout: 10000 },
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
  const step = async (name, run) => {
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
      assert.equal(row.after.probe.path, documentPath)
      assert.equal(row.after.windowed, false, 'Ordinary document route')
      assert.equal(row.after.file.sha256, hash(expectedText), 'Complete expected document bytes')
      assert(!/(^|[^\r])\n/.test((await readFile(documentPath)).toString()), 'CRLF remains intact')
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
      (s) =>
        s.probe.loading === 'ready' && s.appearance.styleHash && s.appVersion === expectedVersion,
      'Ready exact About version and theme',
    )
  }
  const openAppearance = async () => {
    const s = await state()
    if (s.appearance.menuHidden) await ui.pointer('[data-menu-toggle]')
    await wait((s) => s.appearance.phase === 'open', 'Menu fully open')
    await ui.pointer('[data-menu-section="appearance"]')
    await wait(
      (s) =>
        s.appearance.panelHidden === false &&
        s.appearance.controls.length >= 6 &&
        s.appearance.controls.every((c) => !c.disabled),
      'Appearance controls ready',
    )
  }
  const closeMenu = async () => {
    if (!(await state()).appearance.menuHidden) await ui.pointer('[data-menu-toggle]')
    await wait(
      (s) => s.appearance.menuHidden && s.appearance.phase === 'closed',
      'Menu closed before editor input',
    )
  }
  const mode = async (value) => {
    await openAppearance()
    await ui.pointer(`[data-theme-mode="${value}"]`)
    await wait(
      (s) =>
        s.appearance.controls.find((c) => c.mode === value)?.pressed === 'true' &&
        s.appearance.controls.every((c) => !c.disabled) &&
        s.theme === (value === 'system' ? (s.appearance.osDark ? 'dark' : 'light') : value),
      'Native theme mode ' + value,
    )
  }
  const gtkDialog = () => {
    try {
      return (
        x('search', '--onlyvisible', '--name', '^Open File$')
          .split('\n')
          .find((id) => {
            const prop = execFileSync('xprop', ['-id', id, '_NET_WM_PID'], {
              encoding: 'utf8',
              env: process.env,
              timeout: 5000,
            })
            return Number(/= (\d+)/.exec(prop)?.[1]) === owner.identity.pid
          }) ?? null
      )
    } catch (error) {
      if (error.status === 1) return null
      throw error
    }
  }
  const picker = async (file) => {
    const id = await app.until(gtkDialog, 'Owned normal GTK Open File picker')
    await app.delay(1200)
    x('windowfocus', '--sync', id, 'key', '--clearmodifiers', 'ctrl+l')
    await app.delay(350)
    x('key', '--clearmodifiers', 'ctrl+a')
    stopClipboard = await ownNativeClipboard(file)
    try {
      inputs.push({
        at: new Date().toISOString(),
        generation,
        kind: 'GTK-clipboard-path-and-XTest-paste',
        file,
        dialog: id,
      })
      x('key', '--clearmodifiers', 'ctrl+v')
      await app.delay(700)
      x('key', '--clearmodifiers', 'Return')
      await app.delay(600)
      if (gtkDialog()) x('windowfocus', '--sync', id, 'key', '--clearmodifiers', 'Return')
      await app.until(() => !gtkDialog(), 'Owned GTK picker closed')
    } finally {
      stopClipboard?.()
      stopClipboard = undefined
    }
    x('windowfocus', '--sync', ui.windowId())
    await wait(
      (s) => s.appearance.controls.every((c) => !c.disabled),
      'Theme operation completed',
      20000,
    )
  }
  const importTheme = async (file) => {
    await openAppearance()
    await ui.pointer('[data-theme-import]')
    await picker(file)
    await wait(
      (s) =>
        s.appearance.controls.every((c) => !c.disabled) &&
        (file === cssPaths.good
          ? s.appearance.name === '海蓝 主题 #&' && s.appearance.feedbackError === 'false'
          : s.appearance.feedbackError === 'true' &&
            s.appearance.feedback.includes('主题 CSS 未应用') &&
            (file === cssPaths.url
              ? /url/i.test(s.appearance.feedback)
              : /@import|规则缺少花括号/.test(s.appearance.feedback))),
      'Selected theme has a fresh visible success or rejection result',
      20000,
    )
  }
  const assertPreviews = (s) => {
    assert.equal(s.appearance.controls.filter((c) => c.mode).length, 3, 'Three mode cards')
    assert.equal(s.appearance.previews.length, 4, 'Light/dark/system split preview frames')
    assert.deepEqual(
      s.appearance.previews.map((f) => f.mode),
      ['light', 'dark', 'light', 'dark'],
    )
    for (const frame of s.appearance.previews) {
      assert.equal(frame.sandbox, '', 'Opaque sandbox with no allowances')
      assert(!frame.src, 'No external frame URL')
      assert(frame.srcdocBytes > 1000 && frame.rect.width > 0 && frame.rect.height > 0)
    }
  }
  const assertImported = async () => {
    const s = await state()
    assert.equal(s.appearance.name, '海蓝 主题 #&')
    assert.equal(s.appearance.feedbackError, 'false', s.appearance.feedback)
    assert.equal(s.appearance.editorComputed.fontSize, '18px')
    assert.equal(s.appearance.editorComputed.lineHeight, '27px')
    assert(s.appearance.editorComputed.fontFamily.includes('serif'))
    assert.equal(
      s.appearance.editorComputed.background,
      s.theme === 'dark' ? 'rgb(21, 40, 59)' : 'rgb(255, 244, 218)',
    )
    assert.equal(
      s.appearance.editorComputed.color,
      s.theme === 'dark' ? 'rgb(217, 237, 255)' : 'rgb(35, 69, 103)',
    )
    if (importedStyleHash) assert.equal(s.appearance.styleHash, importedStyleHash)
    return s
  }
  const revealBody = async (selector) => {
    // Wheel input reveals output without moving the caret into a graph's source.
    // A DOM scrollIntoView/scrollTop assignment would not be native input.
    await closeMenu()
    for (let attempt = 0; attempt < 32; attempt++) {
      const target = await app.execute(
        `const e=document.querySelector(arguments[0]),root=document.querySelector('.milkup-editor');if(!e||!root)return null;const r=e.getBoundingClientRect(),b=root.getBoundingClientRect();return {rect:r.toJSON(),editor:b.toJSON(),width:innerWidth,height:innerHeight,scrollTop:root.scrollTop};`,
        selector,
      )
      assert(target && target.rect.height > 0, 'Rendered native wheel target: ' + selector)
      const top = Math.max(0, target.editor.top) + 4,
        bottom = Math.min(target.height, target.editor.bottom) - 4
      assert(target.rect.height < bottom - top, 'Target fits the actual editor viewport')
      if (target.rect.top >= top && target.rect.bottom <= bottom) {
        await app.delay(200)
        const stable = await app.execute(
          'const r=document.querySelector(arguments[0])?.getBoundingClientRect();return !!r&&Math.abs(r.top-arguments[1])<0.5&&Math.abs(r.bottom-arguments[2])<0.5',
          selector,
          target.rect.top,
          target.rect.bottom,
        )
        if (stable) return target
        continue
      }
      const geometry = x('getwindowgeometry', '--shell', ui.windowId()),
        scale = Number(/WIDTH=(\d+)/.exec(geometry)[1]) / target.width,
        direction = target.rect.top < top ? '4' : '5'
      assert(Number.isFinite(scale) && scale > 0)
      inputs.push({
        at: new Date().toISOString(),
        generation,
        kind: 'XTest-body-wheel',
        selector,
        direction,
        before: target,
      })
      x(
        'mousemove',
        '--window',
        ui.windowId(),
        String(Math.round(((target.editor.left + target.editor.right) / 2) * scale)),
        String(Math.round(((top + bottom) / 2) * scale)),
        'click',
        direction,
      )
      await app.delay(160)
    }
    assert.fail('Native wheel could not reveal complete body target ' + selector)
  }
  const enableExistingDiagrams = async () => {
    await closeMenu()
    await ui.position(original, 0, 'live')
    await ui.list()
    const before = await state(),
      card = before.cards.find((c) => c.id === 'milkup.diagrams')
    assert(card, 'Existing bundled Diagrams card is present')
    assert.equal(card.checked, 'false', 'Fresh profile begins disabled')
    await ui.pointer('.plugin-summary-card[data-plugin-id="milkup.diagrams"] [role="switch"]')
    await wait(
      (s) => {
        const current = s.cards.find((c) => c.id === 'milkup.diagrams')
        return current?.checked === 'true' && current.busy !== 'true'
      },
      'Existing Diagrams switch enables without restart',
      25000,
    )
    const after = await state()
    assert.deepEqual(
      after.cards.map((c) => c.id),
      before.cards.map((c) => c.id),
    )
    assert.equal(after.probe.version, before.probe.version)
    assert.equal(after.probe.dirty, before.probe.dirty)
    await closeMenu()
    await app.until(
      async () => {
        const body = await bodyVisuals()
        return (
          body.images.some((i) => i.complete && i.width > 0 && i.height > 0) ||
          body.vectors.some((v) => ['Start', 'End'].every((label) => v.labels.includes(label)))
        )
      },
      'Live document receives decoded Diagrams output after the UI switch',
      25000,
    )
    const catalogPath = path.join(
        process.env.XDG_DATA_HOME,
        'app.milkup.desktop/plugins/catalog-v1.json',
      ),
      catalogBytes = await readFile(catalogPath),
      entry = JSON.parse(catalogBytes).payload.entries.find((e) => e.id === 'milkup.diagrams')
    assert(
      entry?.enabled && entry.active && !entry.pending,
      'Native catalog committed the UI-enabled candidate',
    )
    return {
      before: card,
      after: after.cards.find((c) => c.id === 'milkup.diagrams'),
      catalog: { path: catalogPath, sha256: hash(catalogBytes), entry },
    }
  }
  const graphPixels = async (name, visual, viewport) => {
    // Inspect the actual WebView screenshot, not a fetched Blob or fabricated
    // canvas. Existing local OCR/graphics tools are test-only dependencies.
    const screenshotName = name + '-graph-source'
    await app.shot(screenshotName)
    const source = path.join(output, screenshotName + '.png'),
      crop = path.join(output, name + '-graph-crop.png'),
      ocrImage = path.join(output, name + '-graph-ocr.png'),
      normalizedOcrImage = path.join(output, name + '-graph-ocr-normalized.png')
    const dimensions = (file) =>
      execFileSync('/usr/bin/identify', ['-format', '%w %h', file], {
        encoding: 'utf8',
        timeout: 10000,
      })
        .trim()
        .split(' ')
        .map(Number)
    const [width, height] = dimensions(source),
      scaleX = width / viewport.width,
      scaleY = height / viewport.height,
      r = visual.rect
    assert(Math.abs(scaleX - scaleY) < 0.02, 'Screenshot has uniform WebView scale')
    assert(scaleX > 0 && r.left >= 0 && r.top >= 0)
    const left = Math.floor(r.left * scaleX),
      top = Math.floor(r.top * scaleY),
      cropWidth = Math.ceil(r.right * scaleX) - left,
      cropHeight = Math.ceil(r.bottom * scaleY) - top
    assert(left + cropWidth <= width && top + cropHeight <= height, 'Whole graph is in screenshot')
    execFileSync(
      '/usr/bin/convert',
      [source, '-crop', `${cropWidth}x${cropHeight}+${left}+${top}`, '+repage', crop],
      { timeout: 10000 },
    )
    execFileSync('/usr/bin/convert', [crop, '-resize', '300%', ocrImage], { timeout: 10000 })
    // Tesseract's adaptive binarization treated the pale node frames as connected
    // regions and returned no words on the real light-theme screenshot. A fixed
    // luminance threshold removes that low-contrast frame without moving pixels.
    // Keep the original color image for all connector assertions and evidence.
    const backgroundLuminance = Number(
      execFileSync(
        '/usr/bin/convert',
        [ocrImage, '-crop', '1x1+0+0', '-colorspace', 'Gray', '-format', '%[fx:mean]', 'info:'],
        { encoding: 'utf8', timeout: 10000 },
      ),
    )
    assert(
      Number.isFinite(backgroundLuminance) && backgroundLuminance >= 0 && backgroundLuminance <= 1,
    )
    const invertForOcr = backgroundLuminance < 0.5
    // In the recorded dark output the mid-gray frame becomes about 53% gray
    // after inversion, while the light glyph cores become about 20%. Retaining
    // everything below 60% also retained that frame; 40% separates the two.
    const ocrThreshold = invertForOcr ? '40%' : '60%'
    execFileSync(
      '/usr/bin/convert',
      [
        ocrImage,
        '-colorspace',
        'Gray',
        ...(invertForOcr ? ['-negate'] : []),
        '-threshold',
        ocrThreshold,
        normalizedOcrImage,
      ],
      { timeout: 10000 },
    )
    assert.deepEqual(
      dimensions(normalizedOcrImage),
      dimensions(ocrImage),
      'OCR keeps exact pixel coordinates',
    )
    const ocr = spawnSync(
      '/usr/bin/tesseract',
      [normalizedOcrImage, 'stdout', '-l', 'eng', '--psm', '11', 'tsv'],
      { encoding: 'utf8', timeout: 15000, maxBuffer: 1024 * 1024 },
    )
    const tsv = ocr.stdout ?? ''
    await writeFile(path.join(output, name + '-graph-ocr.tsv'), tsv, { flag: 'wx' })
    await writeFile(path.join(output, name + '-graph-ocr.stderr.txt'), ocr.stderr ?? '', {
      flag: 'wx',
    })
    assert.equal(ocr.status, 0, 'Screenshot OCR completed: ' + String(ocr.error ?? ocr.stderr))
    const words = tsv
      .trim()
      .split('\n')
      .slice(1)
      .map((line) => line.split('\t'))
      .filter((fields) => fields[0] === '5' && fields[11]?.trim())
      .map((fields) => ({
        text: fields.slice(11).join('\t').trim(),
        x: Number(fields[6]),
        y: Number(fields[7]),
        width: Number(fields[8]),
        height: Number(fields[9]),
        confidence: Number(fields[10]),
      }))
    const start = words.find((word) => word.text === 'Start'),
      end = words.find((word) => word.text === 'End')
    assert(start && end, 'Actual screenshot OCR contains both Start and End labels')
    assert(start.y + start.height < end.y, 'Top-down graph labels appear in the requested order')
    const [pixelWidth, pixelHeight] = dimensions(ocrImage)
    assert(pixelWidth * pixelHeight <= 16_000_000, 'Bounded screenshot pixel analysis')
    const rgb = execFileSync('/usr/bin/convert', [ocrImage, '-depth', '8', 'rgb:-'], {
      timeout: 10000,
      maxBuffer: 48_000_000,
    })
    assert.equal(rgb.length, pixelWidth * pixelHeight * 3)
    const middleY = Math.floor((start.y + start.height + end.y) / 2),
      middleX = Math.round((start.x + start.width / 2 + end.x + end.width / 2) / 2),
      radius = Math.max(6, Math.floor(pixelWidth / 8))
    assert(middleY - 3 > start.y + start.height && middleY + 3 < end.y)
    const differsFromBackground = (px, py) => {
      const offset = (py * pixelWidth + px) * 3,
        background = (py * pixelWidth + 1) * 3
      return (
        Math.abs(rgb[offset] - rgb[background]) +
          Math.abs(rgb[offset + 1] - rgb[background + 1]) +
          Math.abs(rgb[offset + 2] - rgb[background + 2]) >
        90
      )
    }
    const connectorColumns = []
    for (
      let px = Math.max(0, middleX - radius);
      px <= Math.min(pixelWidth - 1, middleX + radius);
      px++
    ) {
      if (
        Array.from({ length: 7 }, (_, i) => middleY - 3 + i).every((py) =>
          differsFromBackground(px, py),
        )
      )
        connectorColumns.push(px)
    }
    assert(connectorColumns.length > 0, 'Actual screenshot contains connecting ink between labels')
    return {
      screenshot: { file: path.basename(source), sha256: hash(await readFile(source)) },
      crop: { file: path.basename(crop), sha256: hash(await readFile(crop)) },
      ocrImage: { file: path.basename(ocrImage), sha256: hash(await readFile(ocrImage)) },
      normalizedOcrImage: {
        file: path.basename(normalizedOcrImage),
        sha256: hash(await readFile(normalizedOcrImage)),
        backgroundLuminance,
        inverted: invertForOcr,
        threshold: ocrThreshold,
        connectorUsesOriginalPixels: true,
      },
      ocr: { file: name + '-graph-ocr.tsv', sha256: hash(tsv), words },
      connector: { middleY, middleX, connectorColumns },
      visuallyReviewed: false,
      boundary:
        'OCR and connecting pixels establish visible fixture labels/ink, not complete graph semantics or visual quality.',
    }
  }
  const save = async (text) => {
    await app.key('ctrl+s')
    await app.until(
      async () => {
        const p = await app.probe()
        return !p.dirty && !p.saving && (await readFile(documentPath)).equals(Buffer.from(text))
      },
      'Complete native save CRLF/Unicode bytes',
      30000,
    )
    expectedText = text
  }
  const responsiveGeometry = (selector) =>
    app.execute(
      `const panel=document.querySelector('[data-menu-panel="appearance"]'),target=document.querySelector(arguments[0]),toggle=document.querySelector('[data-menu-toggle]');
const rect=e=>e?.getBoundingClientRect().toJSON()??null;
const interactive=target?.closest('button')??target,r=target?.getBoundingClientRect();
const x=r?(r.left+r.right)/2:0,y=r?(r.top+r.bottom)/2:0,hit=document.elementFromPoint(x,y);
return {width:innerWidth,height:innerHeight,dpr:devicePixelRatio,cssZoom:getComputedStyle(document.documentElement).zoom,documentScrollWidth:document.documentElement.scrollWidth,zoom:Number(document.querySelector('#app').dataset.appearanceZoom),
panel:{rect:rect(panel),scrollTop:panel.scrollTop,scrollWidth:panel.scrollWidth,clientWidth:panel.clientWidth,scrollHeight:panel.scrollHeight,clientHeight:panel.clientHeight},
toggle:{rect:rect(toggle),expanded:toggle.getAttribute('aria-expanded'),label:toggle.getAttribute('aria-label'),disabled:toggle.disabled},
target:target?{rect:rect(target),x,y,hit:!!hit&&interactive.contains(hit),disabled:!!interactive.disabled}:null,
items:[...panel.querySelectorAll('button,.theme-preview')].map(e=>({kind:e.dataset.themeMode??(e.hasAttribute('data-theme-import')?'import':e.hasAttribute('data-theme-open')?'open':e.hasAttribute('data-theme-reset')?'reset':'preview'),rect:rect(e),scrollWidth:e.scrollWidth,clientWidth:e.clientWidth}))};`,
      selector,
    )
  const revealAppearanceControl = async (selector) => {
    // Vertical scrolling is allowed, including cards taller than the viewport.
    // Reach the target's center through native wheel input; never assign scrollTop.
    for (let attempt = 0; attempt < 48; attempt++) {
      const observed = await responsiveGeometry(selector)
      const target = observed.target,
        bounds = observed.panel.rect
      assert(target?.rect.width > 0 && target.rect.height > 0 && bounds.height > 0)
      assert(!target.disabled, 'Responsive control enabled')
      const top = Math.max(0, bounds.top) + 3,
        bottom = Math.min(observed.height, bounds.bottom) - 3
      const geometry = x('getwindowgeometry', '--shell', ui.windowId()),
        scale = Number(/WIDTH=(\d+)/.exec(geometry)[1]) / observed.width
      assert(Number.isFinite(scale) && scale > 0)
      if (target.hit && target.y >= top && target.y <= bottom) {
        await app.delay(160)
        const stable = await responsiveGeometry(selector)
        if (!stable.target?.hit || Math.abs(stable.target.y - target.y) > 0.5) continue
        x(
          'mousemove',
          '--window',
          ui.windowId(),
          String(Math.round(target.x * scale)),
          String(Math.round(target.y * scale)),
        )
        const pointer = x('getmouselocation', '--shell')
        const coordinate = (text, key) =>
          Number(new RegExp('^' + key + '=(-?\\d+)$', 'm').exec(text)?.[1])
        const actualX = (coordinate(pointer, 'X') - coordinate(geometry, 'X')) / scale,
          actualY = (coordinate(pointer, 'Y') - coordinate(geometry, 'Y')) / scale
        assert(Number.isFinite(actualX) && Number.isFinite(actualY))
        assert(
          await app.execute(
            'const e=document.querySelector(arguments[0]),r=e?.getBoundingClientRect(),button=e?.closest("button")??e,hit=document.elementFromPoint(arguments[1],arguments[2]);return !!r&&arguments[1]>=r.left&&arguments[1]<=r.right&&arguments[2]>=r.top&&arguments[2]<=r.bottom&&!!hit&&button.contains(hit)',
            selector,
            actualX,
            actualY,
          ),
          'Actual native pointer reaches responsive target',
        )
        stable.actualPointer = { x: actualX, y: actualY }
        inputs.push({
          at: new Date().toISOString(),
          generation,
          kind: 'XTest-responsive-control-hover',
          selector,
        })
        return stable
      }
      const direction = target.y < top ? '4' : '5'
      inputs.push({
        at: new Date().toISOString(),
        generation,
        kind: 'XTest-responsive-panel-wheel',
        selector,
        direction,
        scrollTop: observed.panel.scrollTop,
      })
      x(
        'mousemove',
        '--window',
        ui.windowId(),
        String(Math.round(((bounds.left + bounds.right) / 2) * scale)),
        String(Math.round(((top + bottom) / 2) * scale)),
        'click',
        direction,
      )
      await app.delay(140)
    }
    assert.fail('Native wheel could not reach appearance control ' + selector)
  }
  const assertResponsiveWidth = (observed) => {
    assert(Number(observed.cssZoom) === 1, 'Use native WebView zoom, never CSS zoom')
    assert(observed.documentScrollWidth <= observed.width + 1, 'No document horizontal overflow')
    assert(
      observed.panel.scrollWidth <= observed.panel.clientWidth + 1,
      'Appearance panel needs no horizontal scrolling',
    )
    const left = Math.max(0, observed.panel.rect.left),
      right = Math.min(observed.width, observed.panel.rect.right)
    for (const item of observed.items) {
      assert(
        item.rect.width > 0 && item.rect.left >= left - 1 && item.rect.right <= right + 1,
        'No horizontally clipped appearance ' + item.kind,
      )
      if (item.kind !== 'preview')
        assert(
          item.scrollWidth <= item.clientWidth + 1,
          'Button content fits horizontally: ' + item.kind,
        )
    }
    const back = observed.toggle
    assert(!back.disabled && back.expanded === 'true' && back.label === '返回正文')
    assert(
      back.rect.left >= 0 &&
        back.rect.right <= observed.width &&
        back.rect.top >= 0 &&
        back.rect.bottom <= observed.height,
      'Titlebar Back remains within the real viewport',
    )
  }
  const setAcceptanceZoom = async (target) => {
    await app.key('ctrl+0')
    await wait((s) => s.zoom === 1, 'Responsive native zoom reset')
    for (const level of [1.25, 1.5, 2].filter((value) => value <= target)) {
      await app.key('ctrl+plus')
      await wait((s) => s.zoom === level, 'Responsive native zoom ' + level)
    }
  }
  const signature = (s) => ({
    style: s.appearance.styleHash,
    name: s.appearance.name,
    record: s.disk?.files.find((f) => f.name === 'theme-v1.json')?.sha256 ?? null,
    cssFiles: s.disk?.files.filter((f) => f.name.endsWith('.css')).map((f) => [f.name, f.sha256]),
  })
  try {
    for (const lock of [
      path.join(profile, 'beta7-appearance.lock'),
      `/tmp/milkup-beta7-appearance-display-${/^:(\d+)/.exec(display)[1]}.lock`,
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
    assert(/0x[1-9a-f][0-9a-f]*/i.test(wm), 'An existing WM is required; harness never starts one')
    await writeFile(path.join(output, 'appearance.json'), '{}\n', { flag: 'wx' })
    reportOwned = true
    await writeFile(path.join(output, 'harness-startup-source.mjs'), harnessSource, { flag: 'wx' })
    await mkdir(path.join(output, 'helpers-startup'), { recursive: false })
    for (const { name, bytes } of helperSources)
      await writeFile(path.join(output, 'helpers-startup', name), bytes, { flag: 'wx' })
    await writeFile(documentPath, original, { flag: 'wx' })
    for (const [name, file] of Object.entries(cssPaths))
      await writeFile(file, name === 'good' ? goodCss : badCss[name], { flag: 'wx' })
    await launch()
    await step('default-three-mode-preview-screenshots', async (row) => {
      await openAppearance()
      const s = await state()
      assertPreviews(s)
      assert.equal(s.appearance.name, '系统默认主题')
      assert.equal(s.appearance.feedbackError, 'false', s.appearance.feedback)
      assert(s.disk.files.some((f) => f.name === 'default.css'))
      defaultStyleHash = s.appearance.styleHash
      row.previewPixelReviewRequired = true
    })
    await step('titlebar-native-drag-and-menu-rapid-toggle', async (row) => {
      row.titlebar = await verifyNativeTitlebarMenu({
        app,
        ui,
        windowId: ui.windowId(),
        pid: owner.identity.pid,
      })
      const before = await state()
      const point = await app.execute(
        'const r=document.querySelector("[data-menu-toggle]").getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,width:innerWidth}',
      )
      const geometry = x('getwindowgeometry', '--shell', ui.windowId())
      const scale = Number(/WIDTH=(\d+)/.exec(geometry)[1]) / point.width
      x(
        'mousemove',
        '--window',
        ui.windowId(),
        String(Math.round(point.x * scale)),
        String(Math.round(point.y * scale)),
      )
      for (let i = 0; i < 6; i++) {
        x('click', '1')
        inputs.push({
          at: new Date().toISOString(),
          generation,
          kind: 'XTest-rapid-menu-click',
          index: i,
        })
        await app.delay(35)
      }
      await wait(
        (s) =>
          s.appearance.phase === 'closed' && s.appearance.menuHidden && !s.appearance.focusInert,
        'Rapid even toggles settle closed',
      )
      const after = await state()
      assert.equal(after.probe.version, before.probe.version)
      assert.deepEqual(after.editor, before.editor)
    })
    for (const value of ['light', 'dark', 'system']) {
      await step(value + '-native-mode-apply', async (row) => {
        await mode(value)
        assertPreviews(await state())
        row.requestedMode = value
      })
      await step(value + '-mode-survives-real-restart', async () => {
        await closeSession()
        await launch()
        await openAppearance()
        const s = await state()
        assert.equal(s.appearance.controls.find((c) => c.mode === value)?.pressed, 'true')
        assert.equal(s.theme, value === 'system' ? (s.appearance.osDark ? 'dark' : 'light') : value)
        assert.equal(s.appearance.styleHash, defaultStyleHash)
      })
    }
    await step('real-os-default-css-association-request', async (row) => {
      await openAppearance()
      const before = await state(),
        file = before.appearance.currentPath
      assert.equal(file, path.join(themeRoot, 'default.css'))
      row.file = { path: file, sha256: hash(await readFile(file)) }
      row.windowsBefore = execFileSync('xwininfo', ['-root', '-tree'], {
        env: process.env,
        encoding: 'utf8',
        timeout: 5000,
      })
      await ui.pointer('[data-theme-open]')
      await app.delay(250)
      await wait(
        (s) => s.appearance.controls.every((c) => !c.disabled),
        'OS association request settled',
        20000,
      )
      const after = await state()
      row.outcome =
        after.appearance.feedbackError === 'true'
          ? 'request-failed-visible'
          : 'native-pointer-attempt-no-visible-error-execution-unverified'
      row.requestExecutionVerified = after.appearance.feedbackError === 'true'
      row.feedback = after.appearance.feedback
      row.guiOpenedVerified = false
      row.processBoundary =
        'Existing OS association may launch a separate editor; no arbitrary editor/launcher is claimed owned or killed by this harness.'
      row.windowsAfter = execFileSync('xwininfo', ['-root', '-tree'], {
        env: process.env,
        encoding: 'utf8',
        timeout: 5000,
      })
      assert.deepEqual(signature(after), signature(before), 'Opening CSS never alters theme')
      x('windowfocus', '--sync', ui.windowId())
    })
    await step('import-unicode-special-path-preserves-selection', async (row) => {
      await mode('light')
      await closeMenu()
      const offset = original.indexOf('Alpha')
      await ui.position(original, offset, 'source')
      x('key', '--clearmodifiers', '--repeat', '5', '--delay', '20', 'shift+Right')
      await wait(
        (s) => s.selection.some((r) => r.from === offset && r.to === offset + 5),
        'Real source selection before theme import',
      )
      row.selectionBefore = (await state()).selection
      const before = await state()
      await importTheme(cssPaths.good)
      const after = await assertImported()
      assertPreviews(after)
      assert.notEqual(after.appearance.styleHash, defaultStyleHash)
      assert.deepEqual(after.selection, row.selectionBefore)
      assert.equal(after.probe.version, before.probe.version)
      assert.equal(after.probe.dirty, before.probe.dirty)
      assert.notDeepEqual(
        after.appearance.previews.map((f) => f.srcdocSha256),
        before.appearance.previews.map((f) => f.srcdocSha256),
      )
      importedStyleHash = after.appearance.styleHash
      importedRecord = after.disk.files.find((f) => f.name === 'theme-v1.json')
      assert(importedRecord)
      importedCopyPath = path.join(themeRoot, importedRecord.envelope.record.leaf)
      assert.notEqual(importedCopyPath, cssPaths.good)
      assert(
        (await readFile(importedCopyPath)).equals(Buffer.from(goodCss)),
        'Native store copies exact selected CSS',
      )
      assert.equal(after.appearance.currentPath, importedCopyPath)
    })
    await step('imported-theme-live-and-source-exact-edit-undo-redo', async (row) => {
      await closeMenu()
      await ui.position(original, original.indexOf('Alpha'), 'source')
      const offset = original.indexOf('Alpha'),
        edited = original.slice(0, offset) + 'EDIT ' + original.slice(offset)
      await app.text('EDIT ')
      await save(edited)
      await app.key('ctrl+z')
      await save(original)
      await app.key('ctrl+shift+z')
      await save(edited)
      await app.key('ctrl+z')
      await save(original)
      await assertImported()
      await ui.position(original, 0, 'live')
      await wait(
        (s) => s.mode === 'live' && s.code.length > 0 && s.pickers.some((p) => p.visible),
        'Live code widget visible under theme',
      )
      row.live = await state()
      await save(original)
    })
    await step('existing-diagrams-card-enables-current-document', async (row) => {
      row.activation = await enableExistingDiagrams()
      await save(original)
    })
    for (const value of ['light', 'dark']) {
      await step(value + '-imported-body-table-alignment-visible', async (row) => {
        await mode(value)
        await assertImported()
        await closeMenu()
        await ui.position(original, 0, 'live')
        await revealBody('.milkup-table-delimiter + .milkup-block-table')
        const body = await bodyVisuals(),
          table = body.tables.find(
            (table) => table.cells.map((cell) => cell.text).join('|') === 'a|完成|123.45',
          )
        assert(
          table && table.cells.every((cell) => cell.visible),
          'All actual table cells are unobscured in the editor viewport',
        )
        assert.deepEqual(
          table.cells.map((cell) => cell.style.align),
          ['left', 'center', 'right'],
        )
        for (const [index, cell] of table.cells.entries()) {
          assert(cell.ink?.width > 0 && cell.ink.height > 0)
          const left = cell.rect.left + cell.style.paddingLeft + cell.style.borderLeft,
            right = cell.rect.right - cell.style.paddingRight - cell.style.borderRight,
            center = (cell.ink.left + cell.ink.right) / 2
          assert(
            cell.ink.left >= left - 1 && cell.ink.right <= right + 1,
            'Table text remains in its own cell',
          )
          if (index === 0)
            assert(center < left + (right - left) / 3, 'Left-aligned actual text position')
          if (index === 1)
            assert(
              Math.abs(center - (left + right) / 2) <= Math.max(8, (right - left) / 20),
              'Centered actual text position',
            )
          if (index === 2)
            assert(center > right - (right - left) / 3, 'Right-aligned actual text position')
        }
        row.body = body
      })
      await step(value + '-imported-body-code-highlighting-and-picker-visible', async (row) => {
        await revealBody('.milkup-line:has(.milkup-code-token-keyword)')
        const body = await bodyVisuals(),
          code = body.code.find((line) => line.text === 'const label = "中文😀";'),
          keyword = code?.tokens.find((token) => token.text === 'const'),
          literal = code?.tokens.find((token) => token.classes.includes('milkup-code-token-string'))
        assert(
          code?.visible && keyword?.visible && literal?.visible,
          'Code and highlighted tokens are actually visible',
        )
        assert(
          body.pickers.some(
            (picker) => picker.value === 'javascript' && picker.visible && !picker.disabled,
          ),
          'Visible JavaScript language chooser',
        )
        assert.notEqual(keyword.style.color, code.style.color)
        assert.notEqual(literal.style.color, code.style.color)
        assert.notEqual(keyword.style.color, code.blockStyle.background)
        assert.notEqual(literal.style.color, code.blockStyle.background)
        assert.equal(
          code.blockStyle.background,
          value === 'dark' ? 'rgb(32, 52, 73)' : 'rgb(240, 229, 207)',
        )
        assert(
          body.code.filter((line) => /^```/.test(line.text)).every((line) => !line.visible),
          'Live code fences are not painted',
        )
        row.body = body
      })
      await step(value + '-imported-body-flowchart-visible-labels-and-connector', async (row) => {
        await app.until(
          async () => {
            const body = await bodyVisuals()
            return (
              body.images.some((image) => image.complete && image.width > 0 && image.height > 0) ||
              body.vectors.length > 0
            )
          },
          'Theme refresh has actual decoded graph output',
          25000,
        )
        await revealBody('[data-document-presentation] img, [data-document-presentation] svg')
        const body = await bodyVisuals(),
          image = body.images.find(
            (image) => image.visible && image.complete && image.width > 0 && image.height > 0,
          ),
          vector = body.vectors.find((vector) => vector.visible)
        assert(image || vector, 'Actual graph output is wholly visible with the menu closed')
        if (vector) {
          assert(['Start', 'End'].every((label) => vector.labels.includes(label)))
          assert(vector.edges > 0, 'Visible vector has a stroked connection')
        }
        row.body = body
        row.graphPixels = await graphPixels(row.name, image ?? vector, body)
        await save(original)
        row.saved = {
          sha256: hash(await readFile(documentPath)),
          bytes: Buffer.byteLength(original),
          exact: (await readFile(documentPath)).equals(Buffer.from(original)),
        }
        assert(
          row.saved.exact,
          'Rendering and theme changes preserve complete original CRLF/Unicode bytes',
        )
      })
    }
    await step('imported-theme-dark-mode-and-previews', async () => {
      await mode('dark')
      await assertImported()
      assertPreviews(await state())
    })
    await step('native-responsive-menu-two-windows-four-zooms-light-dark', async (row) => {
      row.boundary =
        'Native application WebView zoom only; operating-system DPI remains untested. Vertical scrolling is expected and is exercised with XTest wheel input.'
      row.configurations = []
      let matrixFailure
      try {
        for (const [width, height] of [
          [760, 520],
          [1280, 800],
        ]) {
          x('windowsize', '--sync', ui.windowId(), String(width), String(height))
          inputs.push({
            at: new Date().toISOString(),
            generation,
            kind: 'X11-window-resize',
            width,
            height,
          })
          const geometry = x('getwindowgeometry', '--shell', ui.windowId())
          assert.equal(Number(/WIDTH=(\d+)/.exec(geometry)[1]), width)
          assert.equal(Number(/HEIGHT=(\d+)/.exec(geometry)[1]), height)
          for (const zoom of [1, 1.25, 1.5, 2]) {
            await setAcceptanceZoom(zoom)
            for (const value of ['light', 'dark']) {
              const config = { width, height, zoom, theme: value, passed: false }
              row.configurations.push(config)
              await openAppearance()
              const selector = `[data-theme-mode="${value}"]`
              await revealAppearanceControl(selector)
              await ui.pointer(selector, { scroll: false })
              await wait(
                (s) => s.theme === value && s.appearance.controls.every((c) => !c.disabled),
                'Responsive theme ' + value,
              )
              await assertImported()
              config.preview = await revealAppearanceControl(selector + ' .theme-preview')
              assert.equal(config.preview.zoom, zoom)
              assertResponsiveWidth(config.preview)
              assertPreviews(await state())
              const name = `${row.name}-${width}x${height}-${zoom * 100}-${value}`
              config.previewScreenshots = await screen(name + '-preview')
              config.importControl = await revealAppearanceControl('[data-theme-import]')
              assertResponsiveWidth(config.importControl)
              config.openControl = await revealAppearanceControl('[data-theme-open]')
              assertResponsiveWidth(config.openControl)
              config.actionScreenshots = await screen(name + '-actions')
              const beforeEdit = await state()
              assert.equal(beforeEdit.file.sha256, hash(original))
              assert.equal(beforeEdit.probe.dirty, false)
              await ui.pointer('[data-menu-toggle]', { scroll: false })
              await wait(
                (s) =>
                  s.appearance.menuHidden &&
                  s.appearance.phase === 'closed' &&
                  !s.appearance.focusInert,
                'Responsive Back returns to document',
              )
              await ui.editorFocus()
              await app.key('ctrl+End')
              await wait(
                (s) => s.cursor === original.length && s.focus.editor,
                'Responsive editor accepts native caret input',
              )
              await app.text('R')
              await save(original + 'R')
              await app.key('ctrl+z')
              await save(original)
              config.editorAfterUndo = await state()
              assert.equal(config.editorAfterUndo.probe.path, documentPath)
              assert.equal(config.editorAfterUndo.file.sha256, hash(original))
              assert.equal(config.editorAfterUndo.probe.dirty, false)
              config.passed = true
              await persist()
            }
          }
        }
      } catch (error) {
        matrixFailure = error
        row.matrixFailure = { message: String(error), stack: error.stack }
        throw error
      } finally {
        try {
          x('windowsize', '--sync', ui.windowId(), '1280', '800')
          await setAcceptanceZoom(1)
          row.restored = await state()
        } catch (error) {
          row.restorationFailure = { message: String(error), stack: error.stack }
          if (!matrixFailure) throw error
        }
      }
      await openAppearance()
      await assertImported()
      assert.equal((await state()).theme, 'dark')
    })
    await step('picker-cancel-preserves-current-theme', async () => {
      await openAppearance()
      const before = signature(await state())
      await ui.pointer('[data-theme-import]')
      const dialog = await app.until(gtkDialog, 'Owned GTK chooser for cancellation')
      inputs.push({ at: new Date().toISOString(), generation, kind: 'XTest-picker-cancel', dialog })
      x('windowfocus', '--sync', dialog, 'key', '--clearmodifiers', 'Escape')
      await app.until(() => !gtkDialog(), 'GTK chooser cancelled')
      x('windowfocus', '--sync', ui.windowId())
      await wait((s) => s.appearance.controls.every((c) => !c.disabled), 'Cancelled import settled')
      assert.deepEqual(signature(await state()), before)
    })
    for (const kind of ['url', 'import'])
      await step('unsafe-' + kind + '-css-rejected-preserves-good-theme', async (row) => {
        await openAppearance()
        const before = signature(await state())
        await importTheme(cssPaths[kind])
        const after = await state()
        assert.equal(after.appearance.feedbackError, 'true')
        assert(after.appearance.feedback.includes('主题 CSS 未应用'))
        assert.deepEqual(signature(after), before)
        row.rejection = after.appearance.feedback
      })
    await step('source-css-disappears-copied-theme-remains-after-restart', async () => {
      assert((await readFile(cssPaths.good)).equals(Buffer.from(goodCss)))
      await unlink(cssPaths.good) // Only this harness-created fixture; never the app-owned theme copy.
      assert((await readFile(importedCopyPath)).equals(Buffer.from(goodCss)))
      await closeSession()
      await launch()
      await openAppearance()
      await assertImported()
      assert.equal((await state()).theme, 'dark')
      assert.equal(
        (await state()).disk.files.find((f) => f.name === 'theme-v1.json').sha256,
        importedRecord.sha256,
      )
    })
    await step('restore-default-preserves-document-and-imported-evidence', async () => {
      await openAppearance()
      await ui.pointer('[data-theme-reset]')
      await wait(
        (s) =>
          s.appearance.name === '系统默认主题' && s.appearance.controls.every((c) => !c.disabled),
        'Default restored',
      )
      const s = await state()
      assert.equal(s.appearance.styleHash, defaultStyleHash)
      assert.equal(s.appearance.feedbackError, 'false', s.appearance.feedback)
      assert(
        (await readFile(importedCopyPath)).equals(Buffer.from(goodCss)),
        'Reset does not delete prior theme',
      )
      assertPreviews(s)
      await closeMenu()
      await save(original)
    })
    await step('restored-default-survives-restart-and-reopen', async () => {
      await closeSession()
      await launch()
      await openAppearance()
      const s = await state()
      assert.equal(s.appearance.name, '系统默认主题')
      assert.equal(s.appearance.styleHash, defaultStyleHash)
      assert.equal(s.theme, 'dark')
      assertPreviews(s)
      await closeMenu()
      await ui.position(original, original.indexOf('TAIL'), 'source')
      await save(original)
      assert((await readFile(documentPath)).equals(Buffer.from(original)))
    })
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
      stopClipboard?.()
    } catch (error) {
      cleanup.push({ phase: 'clipboard-close', error: String(error) })
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

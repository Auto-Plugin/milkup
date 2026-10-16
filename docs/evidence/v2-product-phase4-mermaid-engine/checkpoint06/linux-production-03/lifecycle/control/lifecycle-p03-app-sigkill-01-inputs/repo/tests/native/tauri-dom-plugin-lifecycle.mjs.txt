// Prepared production-only harness. Run one case per fresh driver/XDG profile.
// Real GTK package installation + XTest controls; no private runtime/IPC hooks.
import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createInterface } from 'node:readline'
import { mkdir, readFile, writeFile, stat, readlink, realpath } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { startProduction } from '../helpers/native-production.mjs'
import { ownedApplication } from '../helpers/native-owned-process.mjs'

const output = process.env.MILKUP_NATIVE_EVIDENCE_DIR
const testCase = process.env.MILKUP_DOM_CASE
const appLog = process.env.MILKUP_NATIVE_APP_LOG
const expectedBinarySha = process.env.MILKUP_NATIVE_EXPECTED_BINARY_SHA256
assert(
  /^[a-f0-9]{64}$/.test(expectedBinarySha ?? '') && process.env.TAURI_APP_PATH,
  'Supply frozen application path and reviewed SHA256',
)
const frozenBinary = await realpath(process.env.TAURI_APP_PATH)
assert(
  !frozenBinary.includes('/target/'),
  'Run an immutable evidence copy, never a concurrently rebuilt shared Cargo target',
)
process.env.TAURI_APP_PATH = frozenBinary
assert(
  output && appLog && process.env.XDG_DATA_HOME,
  'Set evidence, actual app/driver stderr log and dedicated XDG_DATA_HOME',
)
assert(
  ['timeout', 'disable', 'remove', 'wm-close', 'app-sigkill'].includes(testCase),
  'Choose one MILKUP_DOM_CASE per fresh profile',
)
assert.equal(
  process.env.MILKUP_DOM_DIAGNOSTICS,
  '1',
  'Enable native diagnostic phases in driver/application environment',
)
const profileRoot = process.env.MILKUP_NATIVE_PROFILE_ROOT
assert(
  profileRoot && path.isAbsolute(profileRoot) && path.resolve(profileRoot) !== '/',
  'Explicit disposable native profile root required',
)
for (const key of ['XDG_DATA_HOME', 'XDG_CONFIG_HOME', 'XDG_CACHE_HOME']) {
  const directory = process.env[key]
  assert(
    directory && path.resolve(directory).startsWith(path.resolve(profileRoot) + path.sep),
    `${key} must be confined to the disposable profile root`,
  )
}
const here = path.dirname(fileURLToPath(import.meta.url))
await mkdir(output, { recursive: false })
const pluginId = `test.dom.lifecycle.${testCase}`
const language = `dom-probe-${testCase}`
const manifest = {
  id: pluginId,
  name: 'Generic DOM lifecycle fixture',
  version: '1.0.0',
  description: 'Test-only layout and non-cooperative renderer fixture',
  host: 'dom',
  main: 'main.js',
  permissions: ['document:read'],
  contributes: {
    documentRenderers: [{ id: 'layout', contexts: ['fence'], fenceLanguages: [language] }],
  },
}
const source = await readFile(path.join(here, '../fixtures/dom-plugin-lifecycle/main.js'), 'utf8')
const archive = {
  format: 'milkup-plugin',
  version: 1,
  manifest,
  files: [{ path: 'main.js', encoding: 'utf8', content: source }],
}
const archivePath = path.join(output, 'fixture.milkup-plugin')
await writeFile(archivePath, JSON.stringify(archive, null, 2) + '\n')
const documentPath = path.join(output, 'document.md')
const markdown = (body) => `Header\n\n\`\`\`${language}\n${body}\n\`\`\`\n\nTail\n`
const safeText = markdown('SAFE_LAYOUT')
const loopText = markdown('LOOP_FOREVER')
await writeFile(documentPath, safeText)
const packagePath = path.join(
  process.env.XDG_DATA_HOME,
  'app.milkup.desktop',
  'plugins',
  pluginId,
  'package',
)
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex')
const exists = async (name) =>
  stat(name).then(
    () => true,
    () => false,
  )
assert(!(await exists(packagePath)), 'Fixture must not already be installed in this profile')
const initialLogSize = (await stat(appLog)).size
assert.equal(
  hash(await readFile(frozenBinary)),
  expectedBinarySha,
  'Frozen application SHA256 before launch',
)
const events = []
let app,
  appIdentity,
  windowId,
  observer,
  bound,
  busyRequest,
  responseLatency,
  verdict = false
const x = (...args) => {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return execFileSync('xdotool', args, { encoding: 'utf8', env: process.env }).trim()
    } catch (error) {
      if (
        args[0] !== 'search' ||
        !/Bad(Window|Drawable)/.test(String(error.stderr)) ||
        attempt === 2
      )
        throw error
      events.push({
        name: 'x11-query-race',
        wall: Date.now(),
        args,
        attempt,
        error: String(error.stderr),
      })
    }
  }
}
const record = async (name, details = {}) => {
  events.push({
    name,
    wall: Date.now(),
    monotonicMs: performance.now(),
    monotonicNs: Number(process.hrtime.bigint()),
    ...details,
  })
  await writeFile(path.join(output, 'events.json'), JSON.stringify(events, null, 2) + '\n')
}
const selector = (action) => `[data-plugin-action="${action}"][data-plugin-id="${pluginId}"]`
async function click(target) {
  await app.until(
    () =>
      app.execute(
        'const e=document.querySelector(arguments[0]);if(!e)return false;const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&!e.disabled',
        target,
      ),
    `visible enabled public control ${target}`,
  )
  x('windowfocus', '--sync', windowId)
  await app.focus(target)
  const observation = await app.execute(
    'const e=document.querySelector(arguments[0]),r=e.getBoundingClientRect();return {focused:document.activeElement===e,x:r.x,y:r.y,width:r.width,height:r.height}',
    target,
  )
  assert(observation.focused, `Public control must have keyboard focus: ${target}`)
  await record('xtest-control', {
    target,
    method: 'public DOM focus then native Return',
    observation,
  })
  await app.key('Return')
}

async function menu() {
  if (
    !(await app.execute(
      'return document.querySelector("[data-menu-toggle]").getAttribute("aria-expanded")==="true"',
    ))
  )
    await click('[data-menu-toggle]')
  await app.until(
    () =>
      app.execute(
        'return document.querySelector("[data-menu-toggle]").getAttribute("aria-expanded")==="true"',
      ),
    'menu visibly open',
  )
  await click('[data-menu-section="plugins"]')
  await app.until(
    () => app.execute('return !document.querySelector("[data-menu-panel=plugins]").hidden'),
    'plugin panel visible',
  )
}
async function details() {
  await menu()
  if (await app.execute('return !!document.querySelector(arguments[0])', selector('details')))
    await click(selector('details'))
  await app.until(
    () => app.execute('return !!document.querySelector(arguments[0])', selector('reload')),
    'exact fixture details',
  )
}
async function closeMenu() {
  if (
    await app.execute(
      'return document.querySelector("[data-menu-toggle]").getAttribute("aria-expanded")==="true"',
    )
  )
    await click('[data-menu-close]')
  await app.until(
    () =>
      app.execute(
        'return document.querySelector("[data-menu-toggle]").getAttribute("aria-expanded")==="false"',
      ),
    'menu visibly closed',
  )
}
async function picker(file) {
  const observe = () =>
    JSON.parse(
      execFileSync(
        '/usr/bin/python3',
        [
          path.join(here, '../helpers/native-gtk-picker-observer.py'),
          '--pid',
          String(appIdentity.pid),
          '--birth',
          String(appIdentity.birth),
          '--evidence',
          output,
        ],
        { encoding: 'utf8', env: process.env, timeout: 5000 },
      ),
    )
  const dialog = () => {
    let ids
    try {
      ids = x('search', '--onlyvisible', '--name', '^Open File$').split('\n')
    } catch (error) {
      if (
        error.status === 1 &&
        !String(error.stdout ?? '').trim() &&
        !String(error.stderr ?? '').trim()
      )
        return null
      throw error
    }
    ids = ids.filter((id) => Number(x('getwindowpid', id)) === appIdentity.pid)
    assert(ids.length <= 1, 'One native picker for the exact app PID')
    return ids[0] ?? null
  }
  const id = await app.until(dialog, 'GTK package picker')
  const shot = (name) =>
    execFileSync(
      'import',
      ['-display', process.env.DISPLAY, '-window', id, path.join(output, name)],
      {
        env: process.env,
        timeout: 5000,
      },
    )
  const ready = (node) =>
    node.states.SHOWING &&
    node.states.ENABLED &&
    node.states.SENSITIVE &&
    node.rect?.width > 0 &&
    node.rect?.height > 0
  try {
    x('windowfocus', '--sync', id)
    await app.until(() => x('getwindowfocus') === id, 'exact GTK picker focus')
    shot('picker-focused-before-readiness.png')
    let initial
    await app.until(() => {
      initial = observe()
      return (
        initial.dialogPresent &&
        initial.nodes.some(
          (node) => node.isPushButton === true && node.name === 'Cancel' && ready(node),
        )
      )
    }, 'native picker controls ready')
    await record('native-picker-before-input', { windowId: id, observation: initial })
    shot('picker-before-input.png')
    x('key', '--clearmodifiers', 'ctrl+l')
    await app.until(
      () =>
        observe().nodes.some((node) => node.states.EDITABLE && node.states.FOCUSED && ready(node)),
      'native location entry focused and ready',
    )
    x('key', '--clearmodifiers', 'ctrl+a')
    x('type', '--clearmodifiers', '--delay', '1', '--', file)
    let typed, button
    await app.until(() => {
      typed = observe()
      const entry = typed.nodes.find(
        (node) => node.states.EDITABLE && node.states.FOCUSED && ready(node),
      )
      button = typed.nodes.find(
        (node) => node.isPushButton === true && node.name === 'Open' && ready(node),
      )
      return entry?.value === file && button
    }, 'actual GTK location text and enabled Open button')
    await record('native-picker-after-input', {
      windowId: id,
      expectedPath: file,
      observation: typed,
    })
    shot('picker-after-input.png')
    const box = button.rect
    x(
      'mousemove',
      String(Math.round(box.x + box.width / 2)),
      String(Math.round(box.y + box.height / 2)),
      'click',
      '1',
    )
    await app.until(() => !dialog(), 'package picker closed')
  } catch (error) {
    await record('native-picker-failure', {
      windowId: id,
      error: String(error),
      focus: x('getwindowfocus'),
    })
    if (dialog()) shot('picker-failure-native.png')
    throw error
  }
  x('windowfocus', '--sync', windowId)
}
function processObserver(identity) {
  const child = spawn(
    'python3',
    [
      path.join(here, '../helpers/native-dom-process-observer.py'),
      '--output',
      path.join(output, 'process-observer'),
    ],
    { stdio: ['pipe', 'pipe', 'pipe'] },
  )
  const pending = new Map()
  let sequence = 0,
    stderr = ''
  child.stderr.on('data', (data) => {
    stderr += data.toString()
  })
  const lines = createInterface({ input: child.stdout })
  lines.on('line', (line) => {
    const message = JSON.parse(line),
      waiter = pending.get(message.id)
    if (!waiter) return
    pending.delete(message.id)
    clearTimeout(waiter.timer)
    if (message.ok) waiter.resolve(message.value)
    else waiter.reject(new Error(message.error))
  })
  child.on('exit', (code) => {
    for (const waiter of pending.values()) {
      clearTimeout(waiter.timer)
      waiter.reject(new Error(`Observer exited ${code}: ${stderr}`))
    }
    pending.clear()
  })
  const command = (name, body = {}) =>
    new Promise((resolve, reject) => {
      const id = ++sequence
      const timer = setTimeout(() => {
        pending.delete(id)
        reject(new Error(`Observer ${name} timed out`))
      }, 5000)
      pending.set(id, { resolve, reject, timer })
      child.stdin.write(JSON.stringify({ id, command: name, ...body }) + '\n')
    })
  return {
    command,
    ready: command('root', { identity }),
    async finish() {
      const value = await command('finish')
      child.stdin.end()
      await writeFile(path.join(output, 'observer-stderr.log'), stderr)
      return value
    },
  }
}
async function disableOtherPlugins() {
  // Dedicated disposable profile only; use ordinary controls, never registry edits.
  await menu()
  const bundled = JSON.parse(await readFile(path.join(here, '../../release/bundled-plugins.json')))
  await app.until(
    async () => {
      // Bundled first-run installs can open their new details while the menu is
      // visible. Wait for the whole shipped catalog before taking the baseline.
      if (await app.execute('return !!document.querySelector("[data-plugin-action=back]")'))
        await click('[data-plugin-action="back"]')
      return app.execute(
        'return document.querySelectorAll("[data-plugin-action=details]").length === arguments[0]',
        bundled.length,
      )
    },
    'complete bundled plugin card list before fixture isolation',
    30000,
  )
  const ids = await app.execute(
    'return [...document.querySelectorAll("[data-plugin-action=details]")].map(e=>e.dataset.pluginId)',
  )
  for (const id of ids) {
    const control = (action) => `[data-plugin-action="${action}"][data-plugin-id="${id}"]`
    await click(control('details'))
    await app.until(
      () =>
        app.execute(
          'return !!document.querySelector(arguments[0]) || !!document.querySelector(arguments[1])',
          control('enable'),
          control('disable'),
        ),
      `exact plugin details for ${id}`,
    )
    if (await app.execute('return !!document.querySelector(arguments[0])', control('disable'))) {
      await click(control('disable'))
      await app.until(
        () => app.execute('return !!document.querySelector(arguments[0])', control('enable')),
        'baseline plugin disabled through UI',
      )
    }
    await click('[data-plugin-action="back"]')
    await app.until(
      () => app.execute('return !!document.querySelector(arguments[0])', control('details')),
      `plugin list after ${id}`,
    )
  }
  await record('isolated-fixture-profile', { existingPluginsDisabledThroughUi: ids })
  await closeMenu()
}
async function installAndEnable() {
  await menu()
  await click('[data-plugin-action="install"]')
  await picker(archivePath)
  await app.until(
    () =>
      app.execute(
        'return !!document.querySelector(arguments[0]) || !!document.querySelector(arguments[1])',
        selector('details'),
        selector('enable'),
      ),
    'installed fixture card',
  )
  await details()
  if (await app.execute('return !!document.querySelector(arguments[0])', selector('approve')))
    await click(selector('approve'))
  await click(selector('enable'))
  await app.until(
    () => app.execute('return !!document.querySelector(arguments[0])', selector('disable')),
    'enabled fixture',
  )
  await closeMenu()
  await app.key('ctrl+2')
  await app.focus('.milkup-input-proxy')
  await app.key('ctrl+Home')
  await app.until(
    () =>
      app.execute(
        'return [...document.querySelectorAll("[data-document-presentation]")].some(e=>e.textContent.includes("DOM lifecycle ready"))',
      ),
    'real safe fixture presentation',
  )
  const installed = JSON.parse(await readFile(path.join(packagePath, 'plugin.json'), 'utf8'))
  assert.equal(installed.host, 'dom')
  assert.deepEqual(installed.permissions, ['document:read'])
  assert.equal(hash(await readFile(path.join(packagePath, 'main.js'))), hash(source))
  bound = await observer.command('bind')
  await record('installed-enabled-real-layout', {
    packagePath,
    manifest: installed,
    binding: bound,
  })
  await app.shot('01-safe-preview')
}
async function startMonitor() {
  await app.execute(`
    const observation = window.__domLifecycleObservation = {origin:performance.timeOrigin,timers:[],frames:[],keys:[],input:null};
    let timer=performance.now(),frame=timer;
    setInterval(()=>{const t=performance.now();if(observation.timers.length<10000)observation.timers.push({at:t,gap:t-timer});timer=t},20);
    const raf=t=>{if(observation.frames.length<10000)observation.frames.push({at:t,gap:t-frame});frame=t;requestAnimationFrame(raf)};requestAnimationFrame(raf);
    addEventListener('keydown',e=>{observation.keys.push({at:performance.now(),key:e.key,trusted:e.isTrusted,target:e.target.className});if(e.key==='q'&&!e.ctrlKey&&!e.metaKey)observation.input={at:performance.now(),trusted:e.isTrusted}},true);
    const check=()=>{const i=observation.input;if(!i||i.dom!==undefined)return;const c=document.querySelector('.milkup-cursor');if(Number(c?.dataset.position)!==1)return;i.dom=performance.now();requestAnimationFrame(()=>requestAnimationFrame(()=>{i.twoFrames=performance.now()}))};
    new MutationObserver(check).observe(document.querySelector('#app'),{subtree:true,childList:true,characterData:true,attributes:true});
  `)
}
async function startBusy() {
  await app.key('ctrl+1')
  await app.until(async () => (await app.probe()).mode === 'source', 'source mode')
  await app.focus('.milkup-input-proxy')
  await app.key('ctrl+a')
  await app.text(loopText)
  await app.key('ctrl+s')
  await app.until(
    async () => (await readFile(documentPath, 'utf8')) === loopText && !(await app.probe()).dirty,
    'loop source saved before execution',
  )
  await app.key('ctrl+Home')
  await startMonitor()
  await app.delay(100)
  await record('observation-instrumentation-baseline', {
    observation: await app.execute('return window.__domLifecycleObservation'),
    note: 'Page observation listeners/MutationObserver/timers and external process sampler add overhead; no product runtime hooks or timing subtraction.',
  })
  const baseline = await observer.command('status')
  await record('activate-loop-view', { baseline })
  await app.key('ctrl+2')
  const ticks = new Map(
    baseline.members.filter((p) => p.name.startsWith('WebKitWebPro')).map((p) => [p.pid, p]),
  )
  assert(ticks.size > 0, 'Actual fixture WebKit process exists')
  const began = performance.now()
  let busy
  while (performance.now() - began < 1000) {
    const sample = await observer.command('status')
    busy = sample.members.find(
      (p) =>
        ticks.get(p.pid)?.birth === p.birth &&
        p.state === 'R' &&
        p.ticks - ticks.get(p.pid).ticks >= Math.max(5, Math.ceil(observer.clockTicks * 0.1)),
    )
    if (busy) break
    await app.delay(25)
  }
  assert(busy, 'Must observe actual WebKit CPU growth before acting; no retry')
  const raw = (await readFile(appLog)).subarray(initialLogSize).toString()
  busyRequest = [...raw.matchAll(/DOM_NATIVE_TIMING (\{[^\n]+\})/g)]
    .map((m) => JSON.parse(m[1]))
    .filter((t) => t.instanceId === bound.selectedGuardian.instanceId && t.phase === 'dispatch')
    .at(-1)
  assert(busyRequest, 'Original busy request dispatch must be observed before editing/cancellation')
  await record('actual-webkit-busy', { busy, originalDispatch: busyRequest })
}
async function inputAndSave() {
  await closeMenu()
  await app.focus('.milkup-input-proxy')
  await app.key('ctrl+Home')
  await app.key('q')
  await app.until(
    () => app.execute('return window.__domLifecycleObservation?.input?.twoFrames'),
    'trusted editing input reaches DOM and two animation frames',
  )
  const observation = await app.execute('return window.__domLifecycleObservation')
  assert(observation.input.trusted)
  const latency = {
    domMs: observation.input.dom - observation.input.at,
    twoFramesMs: observation.input.twoFrames - observation.input.at,
  }
  await record('editing-response', {
    latency,
    targetMs: 200,
    overTarget: latency.twoFramesMs > 200,
  })
  await app.key('ctrl+s')
  await app.until(
    async () =>
      (await readFile(documentPath, 'utf8')) === 'q' + loopText && !(await app.probe()).dirty,
    'exact saved bytes after edit',
  )
  await writeFile(
    path.join(output, 'ui-observation.json'),
    JSON.stringify(await app.execute('return window.__domLifecycleObservation'), null, 2) + '\n',
  )
  responseLatency = latency
}
async function cleanupObserved(requireAppExit = false) {
  const started = performance.now()
  let row
  do {
    row = await observer.command('status')
    if (!row.members.length && !row.privateDirectoryExists && (!requireAppExit || !row.appAlive)) {
      await record('owned-context-cleared', {
        elapsedMs: performance.now() - started,
        observation: row,
      })
      return row
    }
    await app.delay(25)
  } while (performance.now() - started < 4500)
  throw new Error(
    `Owned renderer did not clear before observer/namespace teardown: ${JSON.stringify(row)}`,
  )
}
function closeNormally() {
  execFileSync(
    'python3',
    [
      '-c',
      `import ctypes,sys
x=ctypes.CDLL('libX11.so.6');x.XOpenDisplay.restype=ctypes.c_void_p
x.XInternAtom.argtypes=[ctypes.c_void_p,ctypes.c_char_p,ctypes.c_int];x.XInternAtom.restype=ctypes.c_ulong
class E(ctypes.Structure):
 _fields_=[('type',ctypes.c_int),('serial',ctypes.c_ulong),('send_event',ctypes.c_int),('display',ctypes.c_void_p),('window',ctypes.c_ulong),('message_type',ctypes.c_ulong),('format',ctypes.c_int),('data',ctypes.c_long*5),('pad',ctypes.c_long*12)]
d=x.XOpenDisplay(None);e=E();e.type=33;e.display=d;e.window=int(sys.argv[1]);e.message_type=x.XInternAtom(d,b'WM_PROTOCOLS',0);e.format=32;e.data[0]=x.XInternAtom(d,b'WM_DELETE_WINDOW',0)
x.XSendEvent.argtypes=[ctypes.c_void_p,ctypes.c_ulong,ctypes.c_int,ctypes.c_long,ctypes.c_void_p];x.XFlush.argtypes=[ctypes.c_void_p]
x.XSendEvent(d,e.window,0,0,ctypes.byref(e));x.XFlush(d)`,
      windowId,
    ],
    { env: process.env },
  )
}
try {
  app = await startProduction(documentPath, output, { diagnostics: false })
  const owner = await ownedApplication(app.application, documentPath)
  appIdentity = owner.identity
  const windows = x('search', '--onlyvisible', '--class', 'milkup-desktop').split('\n')
  windowId = windows
    .map((id) => ({
      id,
      pid: Number(
        /= (\d+)/.exec(
          execFileSync('xprop', ['-id', id, '_NET_WM_PID'], { encoding: 'utf8', env: process.env }),
        )?.[1],
      ),
      geometry: x('getwindowgeometry', '--shell', id),
    }))
    .filter((w) => w.pid === owner.identity.pid)
    .sort(
      (a, b) =>
        Number(/WIDTH=(\d+)/.exec(b.geometry)[1]) * Number(/HEIGHT=(\d+)/.exec(b.geometry)[1]) -
        Number(/WIDTH=(\d+)/.exec(a.geometry)[1]) * Number(/HEIGHT=(\d+)/.exec(a.geometry)[1]),
    )[0]?.id
  assert(windowId, 'Exact app window')
  await disableOtherPlugins()
  observer = processObserver(owner.identity)
  observer.clockTicks = (await observer.ready).clockTicks
  await writeFile(
    path.join(output, 'provenance.json'),
    JSON.stringify(
      {
        case: testCase,
        binary: app.application,
        binarySha256: expectedBinarySha,
        frozenBinary,
        packageSha256: hash(await readFile(archivePath)),
        moduleSha256: hash(source),
        appIdentity: owner.identity,
        appLog,
        initialLogSize,
        pidNamespace: await readlink('/proc/self/ns/pid'),
      },
      null,
      2,
    ) + '\n',
  )
  await installAndEnable()
  await startBusy()
  if (testCase === 'timeout') {
    await inputAndSave()
    await cleanupObserved()
    await details()
    await app.until(
      () =>
        app.execute(
          'return !!document.querySelector(arguments[0]) && document.querySelector(".plugin-state")?.dataset.state==="failed"',
          selector('enable'),
        ),
      'timeout becomes terminal plugin failure',
    )
    assert(await exists(packagePath))
    await app.shot('02-timeout-failed-card')
  } else if (testCase === 'disable' || testCase === 'remove') {
    await details()
    await record('busy-action-click', { action: testCase })
    await click(selector(testCase))
    await inputAndSave()
    await cleanupObserved()
    if (testCase === 'disable') await details()
    else await menu()
    if (testCase === 'disable') {
      await app.until(
        () =>
          app.execute(
            'return !!document.querySelector(arguments[0]) && document.querySelector(".plugin-state")?.dataset.state==="disabled"',
            selector('enable'),
          ),
        'disabled control',
      )
      assert(await exists(packagePath), 'Disable preserves installed package')
    } else {
      await app.until(
        async () => !(await exists(packagePath)),
        'uninstall removes exact installed package',
      )
      assert(
        !(await app.execute('return !!document.querySelector(arguments[0])', selector('details'))),
      )
    }
    await app.shot('02-lifecycle-complete')
  } else {
    await record('fault-action', { action: testCase })
    if (testCase === 'wm-close') closeNormally()
    else await record('exact-app-sigkill', await observer.command('kill-app'))
    const cleared = await cleanupObserved(true)
    assert(!cleared.appAlive, 'Real app must exit, not only renderer')
    assert.equal(await readFile(documentPath, 'utf8'), loopText, 'Saved source survives exit/fault')
  }
  const log = (await readFile(appLog)).subarray(initialLogSize).toString()
  await writeFile(path.join(output, 'native-app.log'), log)
  const traces = [...log.matchAll(/DOM_NATIVE_TIMING (\{[^\n]+\})/g)]
    .map((m) => JSON.parse(m[1]))
    .filter((t) => t.instanceId === bound.selectedGuardian.instanceId)
  assert(
    traces.some((t) => t.phase === 'kill-start'),
    'Actual fixture guardian kill diagnostic',
  )
  const cleanupTrace = traces.find((t) => t.phase === 'cleanup-complete')
  if (testCase === 'app-sigkill') {
    // The terminal trace uses a best-effort asynchronous queue. The guardian's
    // successful return requires ECHILD, so its natural exit is a reliable upper
    // bound even when that final diagnostic has not reached stderr before exit.
    const run = process.env.MILKUP_NATIVE_RUN
    assert(/^lifecycle-[a-z0-9-]+$/.test(run ?? ''))
    const control = path.resolve(output, '../../control')
    const driverOwner = JSON.parse(await readFile(path.join(control, `${run}-driver-owner.json`)))
    assert.equal(driverOwner.ancestorRole, 'subreaper wait-only, no signals or directory deletion')
    assert.equal(driverOwner.endedUtc, undefined, 'Driver remains alive until the verdict')
    const reaps = JSON.parse(await readFile(path.join(control, `${run}-ancestor-reaps.json`)))
    const guardian = bound.selectedGuardian
    const exactReaps = reaps.filter(
      (entry) =>
        entry.identity.pid === guardian.pid &&
        String(entry.identity.birth) === String(guardian.birth),
    )
    assert.equal(exactReaps.length, 1, 'Exact guardian was naturally reaped once')
    const reaped = exactReaps[0]
    assert.equal(reaped.identity.parent, driverOwner.ancestorPid)
    assert.equal(reaped.exitCode, 0, 'Guardian returned successfully after ECHILD')
    assert.equal(reaped.noSignalSent, true)
    assert(reaped.waitpidCompletedMonotonicNs >= reaped.exitedObservedMonotonicNs)
    await stat(`/proc/${driverOwner.ancestorPid}`)
    await stat(`/proc/${driverOwner.pid}`)
    await record('guardian-natural-exit-proof', {
      reaped,
      exactEchildMonotonicNs: cleanupTrace?.monotonicNs ?? null,
      echildCompletedUpperBoundMonotonicNs: reaped.exitedObservedMonotonicNs,
      terminalDiagnostic: cleanupTrace
        ? 'observed'
        : 'unobservable: best-effort asynchronous trace',
      functionalCleanup:
        'All tracked PID/birth identities and private directory cleared within original 4.5s observer bound',
    })
  } else if (testCase === 'wm-close') {
    const guardian = bound.selectedGuardian
    const killStarted = traces.find(
      (entry) => entry.phase === 'kill-start' && entry.pid === guardian.pid,
    )
    const confirmed = traces.find(
      (entry) =>
        entry.phase === 'cleanup-confirmed' &&
        entry.pid === appIdentity.pid &&
        entry.instanceId === guardian.instanceId,
    )
    assert(
      killStarted && confirmed,
      'Exact guardian kill and App successful Child wait confirmation',
    )
    assert(killStarted.monotonicNs >= busyRequest.monotonicNs)
    assert(confirmed.monotonicNs >= killStarted.monotonicNs)
    if (cleanupTrace) assert.equal(cleanupTrace.pid, guardian.pid)
    await record('guardian-app-wait-proof', {
      guardian,
      appIdentity,
      killStarted,
      confirmed,
      exactEchildMonotonicNs: cleanupTrace?.monotonicNs ?? null,
      echildCompletedUpperBoundMonotonicNs: confirmed.monotonicNs,
      upperBoundSource:
        'Exact App Child.try_wait success, then cleanup-confirmed for bound instance',
      terminalDiagnostic: cleanupTrace
        ? 'observed'
        : 'unobservable: best-effort asynchronous trace',
    })
  } else assert(cleanupTrace, 'Actual fixture guardian ECHILD diagnostic')
  if (testCase === 'timeout') {
    const observed = traces.find((t) => t.phase === 'deadline-observed')
    assert(observed, 'Native deadline was authoritative')
    assert.equal(
      observed.requestId,
      busyRequest.requestId,
      'Typing/source-version cancellation must retain the original native task deadline',
    )
    assert.equal(
      traces.filter(
        (t) =>
          t.phase === 'dispatch' &&
          t.monotonicNs > busyRequest.monotonicNs &&
          t.monotonicNs < observed.monotonicNs,
      ).length,
      0,
      'No replacement dispatch may hide/reset the active render deadline',
    )
    const dispatch = traces.find(
      (t) => t.phase === 'dispatch' && t.requestId === observed.requestId,
    )
    const emitted = traces.find(
      (t) => t.phase === 'control-emitted' && t.requestId === observed.requestId,
    )
    const complete = traces.find((t) => t.phase === 'cleanup-complete')
    assert(dispatch && emitted && complete && emitted.monotonicNs >= complete.monotonicNs)
    const seconds = (observed.monotonicNs - dispatch.monotonicNs) / 1e9
    assert(seconds >= 2 && seconds < 2.25, `Deadline observation scheduling: ${seconds}s`)
  }
  await writeFile(path.join(output, 'native-traces.json'), JSON.stringify(traces, null, 2) + '\n')
  if (!['wm-close', 'app-sigkill'].includes(testCase))
    await writeFile(
      path.join(output, 'ui-observation-final.json'),
      JSON.stringify(await app.execute('return window.__domLifecycleObservation'), null, 2) + '\n',
    )
  if (responseLatency)
    assert(
      responseLatency.twoFramesMs <= 200,
      'Warm trusted input exceeded 200 ms; original sample retained',
    )
  assert.equal(
    hash(await readFile(frozenBinary)),
    expectedBinarySha,
    'Frozen binary unchanged after execution',
  )
  verdict = true
  await record('verdict', {
    status: 'passed',
    scope: 'One full-editor generic DOM lifecycle case; official renderer acceptance separate',
  })
} catch (error) {
  await record('verdict', { status: 'failed', error: String(error), stack: error.stack })
  await readFile(appLog)
    .then((bytes) => writeFile(path.join(output, 'native-app.log'), bytes.subarray(initialLogSize)))
    .catch(() => {})
  if (app && !['wm-close', 'app-sigkill'].includes(testCase)) {
    await app
      .execute('return window.__domLifecycleObservation')
      .then((value) =>
        writeFile(
          path.join(output, 'ui-observation-failure.json'),
          JSON.stringify(value, null, 2) + '\n',
        ),
      )
      .catch(() => {})
    await app.shot('failure-original').catch(() => {})
  }
  throw error
} finally {
  // Never use driver/test cleanup as success evidence; verdict is already fixed.
  if (observer)
    await record(
      'observer-final',
      await observer.finish().catch((error) => ({ error: String(error) })),
    )
  await record('test-cleanup-after-verdict', { productPassed: verdict })
  if (app) await app.close()
}

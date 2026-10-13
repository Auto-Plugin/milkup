import {
  nativeRequestTimeout,
  waitForNativeWindow,
  beginNativeStartup,
  cleanupNativeApplication,
} from '../helpers/native-startup.mjs'
// Real Tauri/WebKit + real disk regression. Start tauri-driver and the Vite
// desktop server first; file picker paths are supplied through the existing
// native test seam. This does NOT claim OS file-picker or system IME coverage.
import assert from 'node:assert/strict'
import { outlineRegistry } from '../helpers/outline-fixture.mjs'
import { execFileSync } from 'node:child_process'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import path from 'node:path'

const base = process.env.TAURI_DRIVER_URL ?? 'http://127.0.0.1:4444'
const output =
  process.env.MILKUP_NATIVE_EVIDENCE_DIR ?? `/tmp/milkup-native-navigation-${Date.now()}`
const application =
  process.env.TAURI_APP_PATH ?? path.resolve('apps/desktop/src-tauri/target/debug/milkup-desktop')
await mkdir(output, { recursive: true })
const results = []
let sid
let nativeWindowId
function x11Windows() {
  return execFileSync('xwininfo', ['-root', '-tree'], {
    encoding: 'utf8',
    env: { ...process.env, DISPLAY: process.env.DISPLAY ?? ':99' },
  })
}
async function req(method, route, body) {
  if (process.env.MILKUP_NATIVE_TRACE)
    console.log(new Date().toISOString(), method, route, body?.script?.slice(0, 100) ?? '')
  const r = await fetch(base + route, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(nativeRequestTimeout(method, route)),
  }).catch((error) => {
    throw Error(`${method} ${route}: ${error}`)
  })
  const j = await r.json()
  if (!r.ok || (j.value?.error && !('ok' in j.value))) throw Error(JSON.stringify(j))
  return 'value' in j ? j.value : j
}
const execute = (script, ...args) => req('POST', `/session/${sid}/execute/sync`, { script, args })
const delay = (ms) => new Promise((r) => setTimeout(r, ms))
async function until(fn, label) {
  for (let i = 0; i < 100; i++) {
    const value = await fn()
    if (value) return value
    await delay(100)
  }
  throw Error(`Timeout: ${label}`)
}
async function key(...values) {
  await req('POST', `/session/${sid}/actions`, {
    actions: [
      {
        type: 'key',
        id: 'keyboard',
        actions: values.flatMap((value) => [
          { type: 'keyDown', value },
          { type: 'keyUp', value },
        ]),
      },
    ],
  })
}
async function chord(...values) {
  // Exercise the X11 key path as well as WebDriver: WebKitGTK reports
  // ISO_Left_Tab as key=Unidentified with code=Tab on both paths.
  if (process.platform === 'linux' && values.join(',') === '\uE008,\uE004') {
    execFileSync(
      'python3',
      [
        '-c',
        `
import ctypes
x=ctypes.CDLL('libX11.so.6'); t=ctypes.CDLL('libXtst.so.6')
x.XOpenDisplay.restype=ctypes.c_void_p
x.XKeysymToKeycode.argtypes=[ctypes.c_void_p,ctypes.c_ulong]
x.XFlush.argtypes=[ctypes.c_void_p]
x.XCloseDisplay.argtypes=[ctypes.c_void_p]
t.XTestFakeKeyEvent.argtypes=[ctypes.c_void_p,ctypes.c_uint,ctypes.c_int,ctypes.c_ulong]
d=x.XOpenDisplay(None)
assert d
shift=x.XKeysymToKeycode(d,0xffe1); tab=x.XKeysymToKeycode(d,0xff09)
for code,down in [(shift,1),(tab,1),(tab,0),(shift,0)]: t.XTestFakeKeyEvent(d,code,down,0)
x.XFlush(d); x.XCloseDisplay(d)
`,
      ],
      { env: { ...process.env, DISPLAY: process.env.DISPLAY ?? ':99' } },
    )
    await delay(150)
    return
  }
  await req('POST', `/session/${sid}/actions`, {
    actions: [
      {
        type: 'key',
        id: 'keyboard',
        actions: [
          ...values.map((value) => ({ type: 'keyDown', value })),
          ...values.toReversed().map((value) => ({ type: 'keyUp', value })),
        ],
      },
    ],
  })
}
const shortcut = (char) => chord('\uE009', char)
const text = (value) => key(...value)
const editor = () =>
  execute(
    'return (document.querySelector(".milkup-editor-content")?.textContent ?? "").replace(/\\u200b/g, "")',
  )
const confirming = () => execute('return !document.querySelector("[data-close-confirm]").hidden')
const focus = () => execute('document.querySelector(".milkup-input-proxy")?.focus()')
async function choose(action) {
  await execute(
    'document.querySelector(arguments[0]).focus()',
    `.dialog-button[data-close-confirm-action="${action}"]`,
  )
  await key('\uE007')
}
async function paths(open, saveAs) {
  await execute(
    'localStorage.setItem("milkup.desktop.nativeTestPaths", JSON.stringify(arguments[0]))',
    { open, saveAs },
  )
}
async function ready() {
  await until(
    () =>
      execute(
        'return ["idle", "ready"].includes(document.querySelector("#app").dataset.loading) && document.querySelector("#app").dataset.saving !== "true"',
      ),
    'idle document workflow',
  )
}
async function fresh() {
  await ready()
  await focus()
  await shortcut('n')
  await delay(200)
  if (await confirming()) await choose('discard')
  await until(async () => (await editor()) === '', 'fresh draft')
  await ready()
  await focus()
}
async function shot(name) {
  // DOM assertions can become true before WebKit's compositor presents a frame.
  await req('POST', `/session/${sid}/execute/async`, {
    script:
      'const done = arguments[arguments.length - 1]; requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(done, 200)))',
    args: [],
  })
  await writeFile(
    path.join(output, `${name}.png`),
    Buffer.from(await req('GET', `/session/${sid}/screenshot`), 'base64'),
  )
  if (process.env.MILKUP_NATIVE_X11_SCREENSHOT === '1')
    execFileSync('import', ['-window', 'root', path.join(output, `${name}-x11.png`)], {
      env: { ...process.env, DISPLAY: process.env.DISPLAY ?? ':99' },
    })
}
async function check(name, action) {
  if (process.env.MILKUP_NATIVE_CASE && !name.includes(process.env.MILKUP_NATIVE_CASE)) return
  try {
    await action()
  } catch (error) {
    await shot('failure').catch(() => {})
    console.log(
      'FAIL diagnostics',
      await execute(
        'return {keys: window.__blockKeys, active: document.activeElement?.outerHTML, text: document.querySelector(".milkup-editor-content")?.textContent, cursor: document.querySelector(".milkup-cursor")?.dataset.position}',
      ).catch(() => ({})),
    )
    throw error
  }
  results.push({ name, result: 'PASS' })
  console.log(`PASS ${name}`)
}
async function start() {
  const started = beginNativeStartup()
  const session = await req('POST', '/session', {
    capabilities: { alwaysMatch: { browserName: 'wry', 'tauri:options': { application } } },
  })
  sid = session.sessionId
  await waitForNativeWindow(started)
  await until(
    () => execute('return !!document.querySelector(".milkup-input-proxy")'),
    'native editor',
  )
  nativeWindowId = undefined
  if (process.platform === 'linux') {
    await until(() => {
      const matches = [...x11Windows().matchAll(/(0x[0-9a-f]+) "milkup": \("milkup-desktop"/g)]
      if (matches.length !== 1) return false
      nativeWindowId = matches[0][1]
      return true
    }, 'one native X11 window')
  }
}
const cursor = () => execute('return document.querySelector(".milkup-cursor")?.dataset.position')
let currentFile
async function openFixture(name, content, mode) {
  await fresh()
  currentFile = path.join(output, `${mode}-${name}.md`)
  await writeFile(currentFile, content)
  await paths(currentFile, undefined)
  await shortcut('o')
  await until(
    () =>
      execute(
        'return document.querySelector("[data-title-path]")?.textContent===arguments[0] && document.querySelector("[data-title]")?.textContent===arguments[1]',
        path.dirname(currentFile),
        path.basename(currentFile, '.md'),
      ),
    'fixture path',
  )
  await ready()
  await shortcut(mode === 'source' ? '1' : '2')
  await focus()
}
async function place(position) {
  await shortcut('a')
  await key('\uE012')
  if (position) await key(...Array.from({ length: position }, () => '\uE014'))
  await until(async () => Number(await cursor()) === position, 'cursor position')
}
async function saved(expected) {
  await shortcut('s')
  await until(
    () =>
      execute(
        'return document.querySelector("[data-stat=saved]").textContent===document.querySelector("[data-stat=version]").textContent && document.querySelector("#app").dataset.saving!=="true"',
      ),
    'saved revision',
  )
  await until(
    async () => (await readFile(currentFile, 'utf8')) === expected,
    'saved exact document',
  )
  await focus()
}
async function activate(selector) {
  await execute('document.querySelector(arguments[0]).focus()', selector)
  await key('\uE007')
}
async function fill(selector, value) {
  await execute('document.querySelector(arguments[0]).focus()', selector)
  await shortcut('a')
  await key('\uE003')
  if (value) await text(value)
}
async function search(value, count) {
  await shortcut('f')
  await fill('[data-search-input]', value)
  await countIs(count)
}
async function countIs(value) {
  await until(
    () =>
      execute(
        'return document.querySelector("[data-search-result-count]").textContent === arguments[0]',
        value,
      ),
    `search count ${value}`,
  )
}
async function editorFocused() {
  await until(
    () =>
      execute('return document.activeElement === document.querySelector(".milkup-input-proxy")'),
    'editor focus',
  )
}
const info = () =>
  execute(`return { count:document.querySelector('[data-search-result-count]').textContent,
  status:document.querySelector('[data-search-message]').textContent, cursor:document.querySelector('.milkup-cursor')?.dataset.position,
  outline:Array.from(document.querySelectorAll('[data-plugin-ui="milkup.outline:outline-panel"] .plugin-list-item')).map(e=>({text:e.textContent,current:e.getAttribute('aria-current'),class:e.className})) }`)
let previousRegistry
let registryCaptured = false
try {
  await start()
  previousRegistry = await execute(
    'return localStorage.getItem("milkup.desktop.plugins.registry.v1")',
  )
  registryCaptured = true
  await execute(
    'localStorage.setItem("milkup.desktop.plugins.registry.v1",arguments[0])',
    outlineRegistry(),
  )
  await req('POST', `/session/${sid}/refresh`, {})
  await until(
    () => execute('return !!document.querySelector(".milkup-input-proxy")'),
    'reloaded editor',
  )
  await check(
    'native find keyboard loop, literal queries, focus and disk edit at selected hit',
    async () => {
      const original = 'alpha target beta target\n[ literal .*'
      await openFixture('find', original, 'live')
      await search('target', '1/2')
      assert.equal(
        await execute('return document.activeElement.matches("[data-search-input]")'),
        true,
      )
      await key('\uE007')
      await countIs('2/2')
      await chord('\uE008', '\uE007')
      await countIs('1/2')
      await key('\uE033') // F3
      await countIs('2/2')
      await chord('\uE008', '\uE033')
      await countIs('1/2')
      await key('\uE00C')
      await editorFocused()
      await text('changed')
      await saved('alpha changed beta target\n[ literal .*')
      await search('[', '1/1')
      await fill('[data-search-input]', 'missing')
      await countIs('0/0')
      await until(
        () =>
          execute(
            'return document.querySelector("[data-search-message]").textContent === "没有匹配结果"',
          ),
        'empty result',
      )
      await shot('native-search-empty')
      await key('\uE00C')
    },
  )
  await check(
    'native Unicode replacement, case switch, all deletion and isolated undo on real disk',
    async () => {
      const original = 'İ foo 😀 FOO\n.* .*'
      await openFixture('replace', original, 'source')
      await search('foo', '1/2')
      await activate('[data-search-case]')
      await countIs('1/1')
      await fill('[data-replace-input]', '$1中')
      await activate('[data-replace-one]')
      await countIs('0/0')
      await key('\uE00C')
      await saved('İ $1中 😀 FOO\n.* .*')
      await shortcut('z')
      await saved(original)
      await chord('\uE009', '\uE008', 'z')
      await saved('İ $1中 😀 FOO\n.* .*')
      await search('.*', '1/2')
      await fill('[data-replace-input]', '')
      await activate('[data-replace-all]')
      await countIs('0/0')
      await key('\uE00C')
      await saved('İ $1中 😀 FOO\n ')
      await shortcut('z')
      await saved('İ $1中 😀 FOO\n.* .*')
    },
  )
  await check(
    'native edit refresh preserves insertion point and document switch discards old results',
    async () => {
      await openFixture('refresh', 'target target', 'live')
      await search('target', '1/2')
      await focus()
      await text('changed')
      await countIs('1/1')
      await text('!')
      await saved('changed! target')
      await openFixture('next-document', 'other document', 'live')
      await countIs('0/0')
      assert.equal(
        await execute('return document.querySelectorAll(".milkup-search-highlight").length'),
        0,
      )
      await key('\uE00C')
    },
  )
  await check(
    'native outline hierarchy, heading rename, keyboard activation and document switch',
    async () => {
      await openFixture('outline', '# First\nbody\n### Child\ntext\n## Second\nbody', 'live')
      if (
        await execute('return document.querySelector("#app").dataset.sidebarCollapsed === "true"')
      )
        await activate('[data-sidebar-toggle]')
      const first = '[aria-label="跳转到 First，第 1 行"]'
      await until(
        () => execute('return !!document.querySelector(arguments[0])', first),
        'first heading',
      )
      await activate(first)
      await editorFocused()
      await key('\uE010') // End
      await text(' renamed')
      await until(
        () =>
          execute(
            'return !!document.querySelector("[aria-label=\\"跳转到 First renamed，第 1 行\\"]")',
          ),
        'renamed outline',
      )
      await key('\uE011') // Home
      assert.equal(Number(await cursor()), 0)
      await chord('\uE008', '\uE010') // Shift+End
      assert.equal(Number(await cursor()), '# First renamed'.length)
      const child = '[aria-label="跳转到 Child，第 3 行"]'
      await activate(child)
      await editorFocused()
      await until(
        () =>
          execute(
            'return document.querySelector(arguments[0])?.getAttribute("aria-current") === "location"',
            child,
          ),
        'active child',
      )
      assert.match(
        await execute('return document.querySelector(arguments[0]).className', child),
        /plugin-list-level-3/,
      )
      await shot('native-outline-hierarchy')
      await saved('# First renamed\nbody\n### Child\ntext\n## Second\nbody')
      await openFixture('outline-next', '# Replacement\nbody', 'live')
      await until(
        () =>
          execute(
            'return !!document.querySelector("[aria-label=\\"跳转到 Replacement，第 1 行\\"]")',
          ),
        'new document outline',
      )
      assert.equal(
        (await info()).outline.some((item) => item.text.includes('First')),
        false,
      )
    },
  )
  await check(
    'native narrow window search layout and repeated source/live inline-code styles',
    async () => {
      await openFixture('narrow', '# Heading\ntext `code` tail\n### Child\nbody', 'live')
      await req('POST', `/session/${sid}/window/rect`, { width: 760, height: 520 })
      await search('code', '1/1')
      assert.equal(
        await execute('return document.querySelector("[data-replace-cancel]").hidden'),
        true,
      )
      const bounds = await execute(
        `const s=document.querySelector('[data-floating-search]').getBoundingClientRect(), e=document.querySelector('[data-editor-host]').getBoundingClientRect();return {width:innerWidth,right:s.right,bottom:s.bottom,editorTop:e.top,editorHeight:e.height,overflow:document.documentElement.scrollWidth>innerWidth,controls:Array.from(document.querySelectorAll('[data-floating-search] button,[data-floating-search] input')).filter(n=>n.getClientRects().length>0).every(n=>{const r=n.getBoundingClientRect();return r.left>=s.left&&r.right<=s.right})}`,
      )
      assert.ok(
        bounds.right <= bounds.width &&
          bounds.bottom <= bounds.editorTop &&
          !bounds.overflow &&
          bounds.controls &&
          bounds.editorHeight >= 200,
        JSON.stringify(bounds),
      )
      const narrowChild = '[aria-label="跳转到 Child，第 3 行"]'
      await until(
        () => execute('return !!document.querySelector(arguments[0])', narrowChild),
        'narrow outline',
      )
      const outlineGeometry = await execute(
        'const e=document.querySelector(arguments[0]);return {class:e.className,paddingLeft:getComputedStyle(e).paddingLeft}',
        narrowChild,
      )
      assert.match(outlineGeometry.class, /plugin-list-level-3/)
      assert.equal(outlineGeometry.paddingLeft, '32px')
      await writeFile(
        path.join(output, 'narrow-outline.json'),
        JSON.stringify(outlineGeometry, null, 2),
      )
      await shot('native-narrow-search-live')
      await key('\uE00C')
      for (let i = 0; i < 3; i++) {
        await shortcut('1')
        await until(
          () =>
            execute('return document.querySelector(".milkup-editor").dataset.mode === "source"'),
          'source mode',
        )
        assert.equal(
          await execute(
            'return Array.from(document.querySelector(".milkup-line[data-line=\\"2\\"]").querySelectorAll("*")).every(e=>getComputedStyle(e).backgroundColor === "rgba(0, 0, 0, 0)" && getComputedStyle(e).borderWidth === "0px")',
          ),
          true,
        )
        await shortcut('2')
      }
      await shortcut('1')
      await shot('native-narrow-source')
      await req('POST', `/session/${sid}/window/rect`, { width: 1100, height: 760 })
      await writeFile(path.join(output, 'narrow-layout.json'), JSON.stringify(bounds, null, 2))
    },
  )
  await check(
    'native windowed search selects exact Unicode offsets and outline moves the editing cursor',
    async () => {
      const first = '# First\r\n'
      const middle = 'body line\r\n'.repeat(60000)
      const tail = '# Distant\r\nİ target 😀\r\n'
      const original = first + middle + tail + 'body line\r\n'.repeat(40000)
      await openFixture('windowed', original, 'source')
      assert.equal(
        await execute('return !!document.querySelector(".milkup-source-document-view")'),
        true,
      )
      await search('target', '1/1')
      const expected = original.indexOf('target')
      await until(
        async () => Number(await cursor()) === expected + 6,
        'exact windowed match cursor',
      )
      assert.equal(
        await execute('return document.querySelector("[data-replace-one]").disabled'),
        false,
      )
      assert.doesNotMatch((await info()).status, /大文件模式暂不支持替换/)
      await shot('native-windowed-search')
      await key('\uE00C')
      await text('changed')
      await saved(original.replace('target', 'changed'))
      await until(
        () =>
          execute(
            'return !!document.querySelector("[aria-label=\\"跳转到 Distant，第 60002 行\\"]")',
          ),
        'windowed heading scan',
      )
      await activate('[aria-label="跳转到 Distant，第 60002 行"]')
      await editorFocused()
      await until(
        async () => Number(await cursor()) === original.indexOf('# Distant'),
        'outline cursor exact line',
      )
      await shot('native-windowed-outline')
    },
  )
  await writeFile(path.join(output, 'navigation-state.json'), JSON.stringify(await info(), null, 2))
} finally {
  await writeFile(path.join(output, 'results.json'), JSON.stringify({ results }, null, 2))
  if (sid) {
    await execute(
      'localStorage.removeItem("milkup.desktop.nativeTestPaths");if(arguments[1]&&arguments[0]===null)localStorage.removeItem("milkup.desktop.plugins.registry.v1");else if(arguments[1])localStorage.setItem("milkup.desktop.plugins.registry.v1",arguments[0])',
      previousRegistry,
      registryCaptured,
    ).catch(() => {})
    await req('DELETE', `/session/${sid}`).catch(() => {})
    cleanupNativeApplication(application)
  }
}

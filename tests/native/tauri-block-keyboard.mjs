// Real Tauri/WebKit + real disk regression. Start tauri-driver and the Vite
// desktop server first; file picker paths are supplied through the existing
// native test seam. This does NOT claim OS file-picker or system IME coverage.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import path from 'node:path'

const base = process.env.TAURI_DRIVER_URL ?? 'http://127.0.0.1:4444'
const output = process.env.MILKUP_NATIVE_EVIDENCE_DIR ?? `/tmp/milkup-native-blocks-${Date.now()}`
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
  if (process.env.MILKUP_NATIVE_TRACE) console.log(method, route, body?.script?.slice(0, 100) ?? '')
  const r = await fetch(base + route, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
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
}
async function check(name, action) {
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
  const session = await req('POST', '/session', {
    capabilities: { alwaysMatch: { browserName: 'wry', 'tauri:options': { application } } },
  })
  sid = session.sessionId
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
try {
  await start()
  await execute(
    'window.__blockKeys=[]; window.addEventListener("keydown", e => {window.__blockKeys.push({key:e.key,code:e.code,keyCode:e.keyCode,shift:e.shiftKey,ctrl:e.ctrlKey,target:e.target.className});window.__blockKeys=window.__blockKeys.slice(-25)},true)',
  )
  for (const mode of ['source', 'live']) {
    await check(`${mode}: list nesting, empty exit, history and mode-switch caret`, async () => {
      await openFixture('list', '- item', mode)
      await place(6)
      await key('\uE004')
      await saved('  - item')
      assert.equal(await cursor(), '8')
      await shot(`${mode}-nested-list`)
      await shortcut(mode === 'source' ? '2' : '1')
      assert.equal(await cursor(), '8')
      await shortcut(mode === 'source' ? '1' : '2')
      assert.equal(await cursor(), '8')
      await chord('\uE008', '\uE004')
      await saved('- item')
      await shortcut('z')
      await saved('  - item')
      await shortcut('z')
      await saved('- item')
      await key('\uE007')
      await saved('- item\n- ')
      await key('\uE007')
      await saved('- item\n')
      await shortcut('z')
      await saved('- item\n- ')
      await key('\uE003')
      await saved('- item\n')
      await openFixture('nested-empty', '- parent\n  - ', mode)
      await place(13)
      await key('\uE007')
      await saved('- parent\n- ')
      await key('\uE007')
      await saved('- parent\n')
    })
    await check(
      `${mode}: multiline selection indent/outdent preserves source and undo`,
      async () => {
        await openFixture('selection', '- a\n- b\nend', mode)
        await place(0)
        for (let i = 0; i < 7; i++) await chord('\uE008', '\uE014')
        await key('\uE004')
        await saved('  - a\n  - b\nend')
        assert.equal(await cursor(), '11')
        await chord('\uE008', '\uE004')
        await saved('- a\n- b\nend')
        await shortcut('z')
        await saved('  - a\n  - b\nend')
        await shortcut('z')
        await saved('- a\n- b\nend')
      },
    )
    await check(
      `${mode}: code literal lists, indentation, blank lines, fence exit and history`,
      async () => {
        const code = '```js\n- literal\n  value\n```'
        await openFixture('code', code, mode)
        await place(code.indexOf('\n  value'))
        await key('\uE007')
        await saved(code.replace('- literal\n', '- literal\n\n'))
        await shortcut('z')
        await saved(code)
        await place(code.indexOf('  value') + 2)
        await key('\uE003')
        await saved(code.replace('  value', 'value'))
        await shortcut('z')
        await saved(code)
        await place(code.indexOf('  value'))
        await key('\uE004')
        await saved(code.replace('  value', '    value'))
        await chord('\uE008', '\uE004')
        await saved(code)
        await place(code.lastIndexOf('\n'))
        await key('\uE007')
        await saved(code.replace('  value\n', '  value\n  \n'))
        await shot(`${mode}-code-blank-line`)
        await shortcut('z')
        await saved(code)
        await place(code.length)
        await key('\uE007')
        await text('plain')
        await saved(code + '\nplain')
      },
    )
  }
  await check('issue 255: native bracket caret remains after 2.5 seconds', async () => {
    await openFixture('brackets', '()tail', 'live')
    await place(1)
    await text('abc123')
    await delay(2500)
    assert.equal(await cursor(), '7')
    await text('X')
    await saved('(abc123X)tail')
  })
  await check('issue 255: image followed by a single-space heading', async () => {
    await openFixture('headings', '', 'live')
    await text('![alt](missing.png)')
    await key('\uE007')
    await text('## 3')
    await key('\uE007')
    await saved('![alt](missing.png)\n## 3\n')
    assert.equal(
      await execute('return document.querySelector(".milkup-heading-content")?.textContent'),
      '3',
    )
    await shot('live-image-heading')
  })
} finally {
  await writeFile(path.join(output, 'results.json'), JSON.stringify({ results }, null, 2))
  if (sid) {
    await execute('localStorage.removeItem("milkup.desktop.nativeTestPaths")').catch(() => {})
    await req('DELETE', `/session/${sid}`).catch(() => {})
  }
}

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
import { execFileSync } from 'node:child_process'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import path from 'node:path'

const base = process.env.TAURI_DRIVER_URL ?? 'http://127.0.0.1:4444'
const output =
  process.env.MILKUP_NATIVE_EVIDENCE_DIR ?? `/tmp/milkup-native-windowed-blocks-${Date.now()}`
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
async function findText(query) {
  await shortcut('f')
  await execute('document.querySelector("[data-search-input]").focus()')
  await shortcut('a')
  await key('\uE003')
  await text(query)
  await until(
    () =>
      execute('return document.querySelector("[data-search-result-count]").textContent==="1/1"'),
    'unique search match',
  )
  const expected = (await readFile(currentFile, 'utf8')).indexOf(query) + query.length
  await until(async () => Number(await cursor()) === expected, 'exact search selection')
  await key('\uE00C')
  await until(
    () => execute('return document.activeElement===document.querySelector(".milkup-input-proxy")'),
    'search returns native editor focus',
  )
}
const prefix = '# Windowed\r\n' + 'before body\r\n'.repeat(128)
// Keep the native >1 MiB path while isolating block editing from the separately
// tracked 100,000-line full-scan search performance gap.
const suffix = '\r\n' + ('body ' + 'x'.repeat(508) + '\r\n').repeat(2048)
try {
  await start()
  for (const mode of ['source', 'live']) {
    await check(
      `${mode}: native windowed list continuation, empty exit and cursor history`,
      async () => {
        const original = prefix + '- uniqueItem' + suffix
        const end = prefix.length + '- uniqueItem'.length
        await openFixture('list', original, mode)
        assert.equal(
          await execute('return !!document.querySelector(".milkup-source-document-view")'),
          true,
        )
        await findText('uniqueItem')
        await key('\uE010')
        await key('\uE007')
        const continued = original.slice(0, end) + '\r\n- ' + original.slice(end)
        await saved(continued)
        assert.equal(Number(await cursor()), end + 4)
        await key('\uE004')
        const nested = original.slice(0, end) + '\r\n  - ' + original.slice(end)
        await saved(nested)
        await key('\uE007')
        await saved(continued)
        await key('\uE007')
        await saved(original.slice(0, end) + '\r\n' + original.slice(end))
        for (const expected of [continued, nested, continued, original]) {
          await shortcut('z')
          await saved(expected)
        }
        assert.equal(Number(await cursor()), end)
        await shortcut('y')
        await saved(continued)
        assert.equal(Number(await cursor()), end + 4)
        await shot(`${mode}-windowed-list-history`)
      },
    )
    await check(`${mode}: offscreen opening fence, CRLF and code indentation`, async () => {
      const body =
        '```md\r\n' + 'literal body\r\n'.repeat(80) + '- uniqueLiteral\r\n  uniqueCode\r\n```'
      const original = prefix + body + suffix
      const end = original.indexOf('- uniqueLiteral') + '- uniqueLiteral'.length
      await openFixture('code', original, mode)
      await findText('uniqueLiteral')
      await key('\uE010', '\uE007')
      await saved(original.slice(0, end) + '\r\n' + original.slice(end))
      await shortcut('z')
      await saved(original)
      assert.equal(Number(await cursor()), end)
      await findText('uniqueCode')
      await key('\uE011', '\uE014', '\uE014', '\uE003')
      await saved(original.replace('  uniqueCode', 'uniqueCode'))
      await shortcut('z')
      await saved(original)
      await key('\uE010', '\uE007')
      const at = original.indexOf('  uniqueCode') + '  uniqueCode'.length
      await saved(original.slice(0, at) + '\r\n  ' + original.slice(at))
      await shot(`${mode}-windowed-code-blank-line`)
    })
    await check(
      `${mode}: reverse selection crosses render windows, one indent transaction and undo`,
      async () => {
        const lines = Array.from(
          { length: 40 },
          (_, i) => '- selectedItem' + String(i).padStart(2, '0'),
        )
        const body = lines.join('\r\n'),
          original = prefix + body + suffix
        await openFixture('selection', original, mode)
        await findText('selectedItem39')
        await key('\uE010')
        for (let i = 0; i < 39; i++) await chord('\uE008', '\uE013')
        await chord('\uE008', '\uE011')
        assert.equal(Number(await cursor()), prefix.length)
        await key('\uE004')
        const indented = prefix + lines.map((x) => '  ' + x).join('\r\n') + suffix
        await saved(indented)
        assert.equal(Number(await cursor()), prefix.length + 2)
        await shortcut('z')
        await saved(original)
        assert.equal(Number(await cursor()), prefix.length)
        await shortcut('y')
        await saved(indented)
        assert.equal(Number(await cursor()), prefix.length + 2)
        await chord('\uE008', '\uE004')
        await saved(original)
        assert.equal(Number(await cursor()), prefix.length)
        await shot(`${mode}-windowed-reverse-selection`)
      },
    )
  }
} finally {
  await writeFile(path.join(output, 'results.json'), JSON.stringify({ results }, null, 2))
  if (sid) {
    await execute('localStorage.removeItem("milkup.desktop.nativeTestPaths")').catch(() => {})
    await req('DELETE', `/session/${sid}`).catch(() => {})
    cleanupNativeApplication(application)
  }
}

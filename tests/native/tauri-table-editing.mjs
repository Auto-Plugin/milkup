// Real Tauri/WebKit + real disk regression. Start tauri-driver and the Vite
// desktop server first; file picker paths are supplied through the existing
// native test seam. This does NOT claim OS file-picker or system IME coverage.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import path from 'node:path'

const base = process.env.TAURI_DRIVER_URL ?? 'http://127.0.0.1:4444'
const output = process.env.MILKUP_NATIVE_EVIDENCE_DIR ?? `/tmp/milkup-native-tables-${Date.now()}`
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
function readClipboard() {
  return JSON.parse(
    execFileSync(
      'python3',
      [
        '-c',
        `
import ctypes as c, json, base64
g=c.CDLL('libgtk-3.so.0'); d=c.CDLL('libgdk-3.so.0')
g.gtk_init_check.argtypes=[c.c_void_p,c.c_void_p]
assert g.gtk_init_check(None,None)
d.gdk_atom_intern_static_string.argtypes=[c.c_char_p]; d.gdk_atom_intern_static_string.restype=c.c_void_p
g.gtk_clipboard_get.argtypes=[c.c_void_p];g.gtk_clipboard_get.restype=c.c_void_p
g.gtk_clipboard_wait_for_contents.argtypes=[c.c_void_p,c.c_void_p];g.gtk_clipboard_wait_for_contents.restype=c.c_void_p
g.gtk_selection_data_get_length.argtypes=[c.c_void_p];g.gtk_selection_data_get_data.argtypes=[c.c_void_p];g.gtk_selection_data_get_data.restype=c.c_void_p
g.gtk_selection_data_free.argtypes=[c.c_void_p]
clip=g.gtk_clipboard_get(d.gdk_atom_intern_static_string(b'CLIPBOARD'))
result={}
for target in [b'text/plain',b'UTF8_STRING',b'text/html']:
 data=g.gtk_clipboard_wait_for_contents(clip,d.gdk_atom_intern_static_string(target))
 if data:
  size=g.gtk_selection_data_get_length(data)
  if size>=0: result[target.decode()]=c.string_at(g.gtk_selection_data_get_data(data),size).decode('utf-8').rstrip('\\x00')
  g.gtk_selection_data_free(data)
print(json.dumps(result))
`,
      ],
      { encoding: 'utf8', env: { ...process.env, DISPLAY: process.env.DISPLAY ?? ':99' } },
    ),
  )
}
const table = '| 名称 | Value |\n| :--- | ---: |\n| A & <x> | **1**<br>two |\n'
const basic = '| Name | Value |\n| --- | --- |\n| A | 1 |\n| B | 2 |'
async function action(name) {
  await execute('document.querySelector(arguments[0]).focus()', `[data-table-action="${name}"]`)
  await key('\uE007')
}
async function copiedText() {
  await shortcut('c')
  const data = readClipboard()
  return data.UTF8_STRING ?? data['text/plain']
}
async function clickCell(row, column) {
  const rect = await execute(
    'const e=document.querySelectorAll(`.milkup-line[data-line="${arguments[0]}"] .milkup-table-cell`)[arguments[1]];const r=e.getBoundingClientRect();return {x:r.x+12,y:r.y+12}',
    row,
    column,
  )
  await req('POST', `/session/${sid}/actions`, {
    actions: [
      {
        type: 'pointer',
        id: 'mouse',
        parameters: { pointerType: 'mouse' },
        actions: [
          { type: 'pointerMove', x: Math.round(rect.x), y: Math.round(rect.y), origin: 'viewport' },
          { type: 'pointerDown', button: 0 },
          { type: 'pointerUp', button: 0 },
        ],
      },
    ],
  })
}
try {
  await start()
  await check(
    'native OS clipboard has HTML table, Unicode Markdown and a rich editable paste',
    async () => {
      await openFixture('clipboard', table, 'live')
      await shortcut('a')
      await shortcut('c')
      const clipboard = readClipboard()
      await writeFile(path.join(output, 'clipboard.json'), JSON.stringify(clipboard, null, 2))
      assert.equal(clipboard.UTF8_STRING, table)
      assert.match(clipboard['text/html'] ?? '', /<table[ >]/)
      assert.match(clipboard['text/html'], /<thead>/)
      assert.match(clipboard['text/html'], /A &amp; &lt;x&gt;/)
      assert.match(clipboard['text/html'], /<strong>1<\/strong><br>two/)
      await execute(
        'const e=document.createElement("div");e.id="native-rich-sink";e.contentEditable="true";e.style="position:fixed;inset:100px;background:white;z-index:99";document.body.append(e);e.focus()',
      )
      await shortcut('v')
      await until(
        () => execute('return document.querySelectorAll("#native-rich-sink table tr").length===2'),
        'native HTML paste creates editable table',
      )
      assert.equal(
        await execute('return document.querySelector("#native-rich-sink td").textContent'),
        'A & <x>',
      )
      await execute('document.querySelector("#native-rich-sink").remove()')
      await focus()
      await shot('live-table-copy')
    },
  )
  await check(
    'source copy stays plain, live cut carries HTML and undo restores disk bytes',
    async () => {
      await shortcut('1')
      await shortcut('a')
      await shortcut('c')
      const plain = readClipboard()
      assert.equal(plain.UTF8_STRING, table)
      assert.equal(plain['text/html'], undefined)
      await shortcut('2')
      await shortcut('x')
      assert.match(readClipboard()['text/html'] ?? '', /<table[ >]/)
      await saved('')
      await shortcut('z')
      await saved(table)
    },
  )
  await check('real cell click, Tab/Shift+Tab, Enter, replacement and undo', async () => {
    await openFixture('navigation', basic, 'live')
    await clickCell(3, 0)
    await action('select-cell')
    assert.equal(await copiedText(), 'A')
    await key('\uE004')
    assert.equal(await copiedText(), '1')
    await text('x')
    await saved(basic.replace('1', 'x'))
    await shortcut('z')
    await saved(basic)
    await chord('\uE008', '\uE004')
    assert.equal(await copiedText(), 'A')
    await key('\uE007')
    assert.equal(await copiedText(), 'B')
    await shortcut('1')
    await shortcut('2')
    assert.equal(await copiedText(), 'B')
    await shot('live-table-navigation')
  })
  await check('cell line break, literal pipe, multiline native paste and history', async () => {
    await openFixture('multiline', basic, 'live')
    await place(basic.indexOf('A') + 1)
    await chord('\uE008', '\uE007')
    await text('next|part')
    await saved(basic.replace('A', 'A<br>next\\|part'))
    await shot('live-table-multiline')
    await shortcut('z')
    await saved(basic.replace('A', 'A<br>'))
    await shortcut('z')
    await saved(basic)
    await execute(
      'const e=document.createElement("textarea");e.id="native-copy-fixture";e.value="one\\ntwo|three";document.body.append(e);e.focus();e.select()',
    )
    await shortcut('c')
    await execute('document.querySelector("#native-copy-fixture").remove()')
    await focus()
    await shortcut('v')
    await saved(basic.replace('A', 'Aone<br>two\\|three'))
    await shortcut('z')
    await saved(basic)
  })
  await check('toolbar row/column edits, protections and independent undo', async () => {
    await openFixture('structure', basic, 'live')
    await place(basic.indexOf('A'))
    await action('add-column')
    const wider = '| Name |  | Value |\n| --- | --- | --- |\n| A |  | 1 |\n| B |  | 2 |'
    await saved(wider)
    const geometry = await execute(
      `const cell=document.querySelectorAll('.milkup-line[data-line="3"] .milkup-table-cell')[1].getBoundingClientRect();const caret=document.querySelector('.milkup-cursor').getBoundingClientRect();return {cellLeft:cell.left,cellRight:cell.right,caretLeft:caret.left}`,
    )
    await writeFile(
      path.join(output, 'empty-cell-geometry.json'),
      JSON.stringify(geometry, null, 2),
    )
    assert.ok(
      geometry.caretLeft >= geometry.cellLeft && geometry.caretLeft < geometry.cellRight,
      JSON.stringify(geometry),
    )
    await shot('live-table-columns')
    await action('delete-column')
    await saved(basic)
    await shortcut('z')
    await saved(wider)
    await shortcut('z')
    await saved(basic)
    await action('add-row')
    const taller = basic.replace('| B |', '|  |  |\n| B |')
    await saved(taller)
    await text('new')
    await saved(taller.replace('|  |  |', '|  new|  |'))
    await action('delete-row')
    await saved(basic)
    await shortcut('z')
    await saved(taller.replace('|  |  |', '|  new|  |'))
    await shortcut('z')
    await saved(taller)
    await shortcut('z')
    await saved(basic)
    await place(2)
    assert.equal(
      await execute('return document.querySelector("[data-table-action=delete-row]").disabled'),
      true,
    )
    assert.equal(
      await execute('return document.querySelector("[data-table-action=delete-column]").disabled'),
      true,
    )
  })
  await check('last-cell expansion, table selection, copy and paragraph exit', async () => {
    await openFixture('exit', basic, 'live')
    await place(basic.lastIndexOf('2'))
    await key('\uE004')
    await saved(basic + '\n|  |  |')
    await shortcut('z')
    await saved(basic)
    await action('select-table')
    assert.equal(await copiedText(), basic)
    await place(basic.indexOf('A'))
    await key('\uE00C')
    await text('after')
    await saved(basic + '\n\nafter')
    await shot('live-table-exit')
    await shortcut('z')
    await saved(basic + '\n\n')
    await shortcut('z')
    await saved(basic)
    await place(2)
    await chord('\uE008', '\uE004')
    await saved('\n' + basic)
  })
  await check('trailing empty paragraph remains outside table editing', async () => {
    await openFixture('trailing', basic + '\n', 'live')
    await place(basic.length + 1)
    assert.equal(await execute('return document.querySelector("[data-table-tools]").hidden'), true)
    await key('\uE007')
    await saved(basic + '\n\n')
  })
} finally {
  await writeFile(path.join(output, 'results.json'), JSON.stringify({ results }, null, 2))
  if (sid) {
    await execute('localStorage.removeItem("milkup.desktop.nativeTestPaths")').catch(() => {})
    await req('DELETE', `/session/${sid}`).catch(() => {})
  }
}

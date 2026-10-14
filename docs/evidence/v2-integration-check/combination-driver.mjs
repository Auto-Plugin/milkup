// Production-only contract: normal GTK package/document pickers, XTest input,
// read-only DOM observations. Run with a dedicated clean driver profile/display.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { startProduction } from '/workspace/milkup/tests/helpers/native-production.mjs'
import { ownedApplication } from '/workspace/milkup/tests/helpers/native-owned-process.mjs'
import { checkPluginVisualCombination } from '/workspace/milkup/tests/helpers/native-plugin-visual-combination.mjs'
const output = process.env.MILKUP_NATIVE_EVIDENCE_DIR
const archivePath = process.env.MILKUP_PLUGIN_ARCHIVE
assert(output && archivePath, 'Set MILKUP_NATIVE_EVIDENCE_DIR and MILKUP_PLUGIN_ARCHIVE')
await mkdir(output, { recursive: true })
const fixture = path.join(output, 'outline.md')
const original =
  '# Guide\nIntro 中文。\n\n## Getting started\nBody\n### Install\nBody\n#### Configure\nBody\n##### Details\nBody\n###### Deep heading\nBody\n\n## Usage\nBody\n\n# Second chapter\n```md\n# Fenced pseudo heading\n```\nTail\n'
await writeFile(fixture, original)
const other =
  '# Other document\n## Other child\nContent\n\nSetext one\n===\n\nSetext two\n---\n\n## Duplicate\n## Duplicate\n'
await writeFile(path.join(output, 'other.md'), other)
await writeFile(path.join(output, 'empty.md'), '')
const large =
  Array.from({ length: 40000 }, (_, n) => {
    const line = n + 1
    return line === 1
      ? '# Large start'
      : line === 100
        ? '```md'
        : line === 5000
          ? '```'
          : line % 4 === 0
            ? `## Heading ${line}`
            : `Body ${line} ${'x'.repeat(850)}`
  }).join('\n') + '\n'
await writeFile(path.join(output, 'large.md'), large)
const results = []
let app, windowId
const x = (...args) => execFileSync('xdotool', args, { encoding: 'utf8', env: process.env }).trim()
const observe = () =>
  app.execute(
    `return {items:[...document.querySelectorAll('.plugin-list-item')].map(x=>({text:x.textContent,current:x.getAttribute('aria-current'),title:x.title})),tree:[...document.querySelectorAll('.plugin-tree-row')].map(x=>({level:x.getAttribute('aria-level'),expanded:x.getAttribute('aria-expanded')})),summary:document.querySelector('.plugin-list-summary')?.textContent,panel:document.querySelector('[data-plugin-ui]')?.textContent,manager:document.querySelector('[data-plugin-manager]')?.textContent,virtual:document.querySelector('[data-virtual-list]')?.dataset,diagnostics:window.__productionDiagnostics}`,
  )
const resources = () =>
  execFileSync(
    'ps',
    ['-C', 'milkup-desktop', '-C', 'WebKitWebProcess', '-o', 'pid,stat,rss,pcpu,comm'],
    { encoding: 'utf8' },
  )
const temporary = () =>
  app.execute(
    `return new Promise((resolve,reject)=>{const r=indexedDB.open('milkup-plugin-temporary-v1',1);r.onerror=()=>reject(String(r.error));r.onsuccess=()=>{const db=r.result;const q=db.transaction('meta','readonly').objectStore('meta').getAll();q.onsuccess=()=>{resolve(q.result);db.close()};q.onerror=()=>reject(String(q.error))}})`,
  )
async function closeNormally() {
  execFileSync(
    'python3',
    [
      '-c',
      `import ctypes,sys
x=ctypes.CDLL('libX11.so.6')
x.XOpenDisplay.restype=ctypes.c_void_p
x.XInternAtom.argtypes=[ctypes.c_void_p,ctypes.c_char_p,ctypes.c_int]; x.XInternAtom.restype=ctypes.c_ulong
class E(ctypes.Structure):
 _fields_=[('type',ctypes.c_int),('serial',ctypes.c_ulong),('send_event',ctypes.c_int),('display',ctypes.c_void_p),('window',ctypes.c_ulong),('message_type',ctypes.c_ulong),('format',ctypes.c_int),('data',ctypes.c_long*5),('pad',ctypes.c_long*12)]
d=x.XOpenDisplay(None);e=E();e.type=33;e.display=d;e.window=int(sys.argv[1]);e.message_type=x.XInternAtom(d,b'WM_PROTOCOLS',0);e.format=32;e.data[0]=x.XInternAtom(d,b'WM_DELETE_WINDOW',0)
x.XSendEvent.argtypes=[ctypes.c_void_p,ctypes.c_ulong,ctypes.c_int,ctypes.c_long,ctypes.c_void_p];x.XFlush.argtypes=[ctypes.c_void_p]
x.XSendEvent(d,e.window,0,0,ctypes.byref(e));x.XFlush(d)
`,
      windowId,
    ],
    { env: process.env },
  )
  await app.until(
    () => {
      try {
        x('getwindowgeometry', windowId)
        return false
      } catch {
        return true
      }
    },
    'native close cleanup',
    30000,
  )
}
async function record(name, extra = {}) {
  const value = {
    name,
    at: new Date().toISOString(),
    state: await app.probe(),
    outline: await observe(),
    ...extra,
  }
  results.push(value)
  await writeFile(path.join(output, 'results.json'), JSON.stringify(results, null, 2) + '\n')
  console.log(name)
  return value
}
async function shot(name) {
  await app.delay(350)
  execFileSync('import', ['-window', 'root', path.join(output, name + '-x11.png')], {
    env: process.env,
    timeout: 10000,
  })
  await app.shot(name + '-webview')
  return record(name)
}
async function click(selector) {
  const r = await app.execute(
    'return document.querySelector(arguments[0]).getBoundingClientRect().toJSON()',
    selector,
  )
  assert(r.width > 0 && r.height > 0, `Visible ${selector}`)
  x('windowfocus', '--sync', windowId)
  x(
    'mousemove',
    '--window',
    windowId,
    String(Math.round(r.x + r.width / 2)),
    String(Math.round(r.y + r.height / 2)),
    'click',
    '1',
  )
  await app.delay(180)
}
const dialog = () => {
  try {
    return x('search', '--onlyvisible', '--name', '^Open File$').split('\n').at(-1)
  } catch {
    return null
  }
}
async function picker(file) {
  const id = await app.until(() => dialog(), 'GTK Open File')
  x('windowfocus', '--sync', id, 'key', '--clearmodifiers', 'ctrl+l')
  await app.delay(300)
  x('key', '--clearmodifiers', 'ctrl+a')
  x('type', '--clearmodifiers', '--delay', '1', '--', path.resolve(file))
  await app.delay(300)
  x('key', '--clearmodifiers', 'Return')
  await app.delay(600)
  if (dialog()) {
    const geometry = x('getwindowgeometry', '--shell', id)
    const width = Number(/WIDTH=(\d+)/.exec(geometry)[1])
    const height = Number(/HEIGHT=(\d+)/.exec(geometry)[1])
    x('mousemove', '--window', id, String(width - 45), String(height - 24), 'click', '1')
  }
  await app.until(() => !dialog(), 'GTK picker closed')
  x('windowfocus', '--sync', windowId)
}
async function menu() {
  await click('[data-menu-toggle]')
  await click('[data-menu-section="plugins"]')
}
async function open(file) {
  await app.key('ctrl+o')
  await picker(file)
  await app.until(async () => {
    const s = await app.probe()
    return s.path === file && s.loading === 'ready'
  }, 'document open')
}
async function start() {
  app = await startProduction(fixture, output)
  windowId = x('search', '--onlyvisible', '--class', 'milkup-desktop')
    .split('\n')
    .map((id) => {
      const g = x('getwindowgeometry', '--shell', id)
      return { id, area: Number(/WIDTH=(\d+)/.exec(g)[1]) * Number(/HEIGHT=(\d+)/.exec(g)[1]) }
    })
    .sort((a, b) => b.area - a.area)[0].id
}
try {
  await start()
  await menu()
  assert((await observe()).manager.includes('0 个已安装'))
  await click('[data-plugin-action="install"]')
  await picker(archivePath)
  await app.until(
    () => app.execute('return !!document.querySelector("[data-plugin-action=enable]")'),
    'combined package installed',
  )
  await click('[data-plugin-action="enable"]')
  await app.key('Escape')
  await record('combined-normal-install-enabled')
  await checkPluginVisualCombination({
    getApp: () => app,
    restart: start,
    open,
    click,
    record,
    shot,
    output,
    launchFile: fixture,
  })
  await menu()
  await click('[data-plugin-action="remove"]')
  await app.until(
    async () => (await observe()).manager.includes('0 个已安装'),
    'combined uninstall',
  )
  await record('combined-plugin-removed', { retainedCrashStores: await temporary() })
  console.log('PASS production plugin visual combination')
} catch (error) {
  await shot('failure').catch(() => {})
  await record('FAIL', { error: String(error), stack: error.stack }).catch(() => {})
  throw error
} finally {
  await app?.close()
}

// Production-only contract: normal GTK package/document pickers, XTest input,
// read-only DOM observations. Run with a dedicated clean driver profile/display.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { startProduction } from '../helpers/native-production.mjs'
import { ownedApplication } from '../helpers/native-owned-process.mjs'
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
  assert.equal((await observe()).items.length, 0)
  await shot('01-host-without-plugin')
  await menu()
  assert((await observe()).manager.includes('0 个已安装'))
  await click('[data-plugin-action="install"]')
  await picker(archivePath)
  await app.until(
    async () => (await observe()).manager.includes('milkup.outline'),
    'installed archive',
  )
  await app.until(
    () => app.execute('return !!document.querySelector("[data-plugin-action=enable]")'),
    'installed enable control',
  )
  await record('normal-gtk-install')
  await click('[data-plugin-action="enable"]')
  await app.key('Escape')
  if (
    await app.execute('return document.querySelector("#app").dataset.sidebarCollapsed === "true"')
  )
    await click('[data-sidebar-toggle]')
  await app.until(async () => (await observe()).items.length === 8, 'H1-H6 headings')
  assert.deepEqual(
    (await observe()).tree.map((x) => x.level),
    ['1', '2', '3', '4', '5', '6', '2', '1'],
  )
  assert(!(await observe()).panel.includes('Fenced pseudo'))
  const layout = await app.execute(
    `const r=s=>document.querySelector(s).getBoundingClientRect().toJSON();return {summary:r('.plugin-list-summary'),first:r('.plugin-tree-row'),toolbar:r('.plugin-tree-toolbar'),buttons:[...document.querySelectorAll('.plugin-tree-toolbar button')].map(x=>({height:x.clientHeight,scroll:x.scrollWidth,width:x.clientWidth}))}`,
  )
  assert(layout.summary.bottom <= layout.first.top)
  assert(layout.buttons.every((x) => x.scroll <= x.width && x.height < 36))
  await shot('02-enabled-hierarchy')
  await click('[data-plugin-ui] [data-plugin-command="outline.collapseAll"]')
  await app.until(async () => (await observe()).items.length === 2, 'collapse all')
  await shot('03-collapsed')
  await click('[data-plugin-ui] [data-plugin-command="outline.expandAll"]')
  await app.until(async () => (await observe()).items.length === 8, 'expand all')
  await click('.plugin-list-item[title^="Deep heading"]')
  await app.until(
    async () =>
      (await observe()).items.some((x) => x.text === 'Deep heading' && x.current === 'location'),
    'active deep heading',
  )
  assert.equal((await app.probe()).cursor, original.indexOf('###### Deep heading'))
  await click('.plugin-tree-toggle[aria-label="折叠 Guide"]')
  await app.until(async () => (await observe()).items.length === 2, 'collapse node')
  assert.equal((await observe()).items[0].current, 'location')
  await click('[data-plugin-ui] [data-plugin-command="outline.expandAll"]')
  await app.key('ctrl+1')
  await app.until(async () => (await app.probe()).mode === 'source', 'source mode ready')
  await app.focus('.milkup-input-proxy')
  await app.key('ctrl+End')
  await app.text('# Added heading')
  await app.until(
    async () => (await observe()).items.some((x) => x.text === 'Added heading'),
    'edit update',
  )
  await app.key('ctrl+z')
  await app.until(
    async () => !(await observe()).items.some((x) => x.text === 'Added heading'),
    'undo update',
  )
  await app.key('ctrl+y')
  await app.until(
    async () => (await observe()).items.some((x) => x.text === 'Added heading'),
    'redo update',
  )
  await app.key('ctrl+s')
  await app.until(
    async () =>
      (await readFile(fixture, 'utf8')) === original + '# Added heading' &&
      !(await app.probe()).dirty,
    'saved bytes',
  )
  assert.equal(await readFile(fixture, 'utf8'), original + '# Added heading')
  await shot('04-source-edited-saved')
  await app.key('ctrl+2')
  await open(path.join(output, 'other.md'))
  await app.until(
    async () =>
      (await observe()).items.length === 6 && (await observe()).items[0].text === 'Other document',
    'document switch',
  )
  assert.deepEqual(
    (await observe()).tree.map((x) => x.level),
    ['1', '2', '1', '2', '2', '2'],
  )
  await click('.plugin-list-item[title="Duplicate（第 12 行）"]')
  await app.until(
    async () => (await app.probe()).cursor === other.lastIndexOf('## Duplicate'),
    'duplicate identity navigation',
  )
  await record('setext-duplicate-headings')
  await open(path.join(output, 'empty.md'))
  await app.until(async () => (await observe()).panel?.includes('文档无标题'), 'empty document')
  await shot('05-empty')
  if (process.env.MILKUP_PLUGIN_SKIP_LARGE !== '1') {
    const at = performance.now()
    await open(path.join(output, 'large.md'))
    await app.until(async () => (await observe()).items.length > 0, 'large headings', 30000)
    await record('large-initial', {
      elapsedMs: performance.now() - at,
      bytes: Buffer.byteLength(large),
    })
    assert((await observe()).items.length <= 500)
    await click('[data-plugin-ui] [data-plugin-command="outline.cancel"]')
    await app.until(async () => (await observe()).panel.includes('扫描已取消'), 'cancel full scan')
    await record('large-cancelled-partial')
    await click('[data-plugin-ui] [data-plugin-command="outline.retry"]')
    const indexAt = performance.now()
    await app.until(
      async () => (await observe()).summary?.startsWith('全文索引完成'),
      'whole document index',
      180000,
    )
    assert.equal(Number((await observe()).virtual.virtualTotal), 8775)
    await record('large-complete', {
      indexMs: performance.now() - indexAt,
      temporary: await temporary(),
      processes: resources(),
    })
    assert(!(await observe()).items.some((x) => /^Heading (?:[1-9]\d{2}|[1-4]\d{3})$/.test(x.text)))
    await app.key('ctrl+1')
    await app.until(async () => (await app.probe()).mode === 'source', 'source mode ready')
    await app.focus('.milkup-input-proxy')
    const navAt = performance.now()
    await app.key('ctrl+End')
    await app.until(
      async () => (await observe()).items.some((x) => x.text === 'Heading 40000'),
      'tail headings',
      30000,
    )
    await record('large-tail', {
      elapsedMs: performance.now() - navAt,
      processes: execFileSync(
        'ps',
        ['-C', 'milkup-desktop', '-C', 'WebKitWebProcess', '-o', 'pid,rss,pcpu,comm'],
        { encoding: 'utf8' },
      ),
    })
    assert((await observe()).items.length <= 500)
    await click('.plugin-list-item[title^="Heading 40000"]')
    await shot('06-large-tail')
    const navigationSamples = []
    for (let i = 0; i < 10; i++) {
      const tail = i % 2 === 1
      await app.focus('.milkup-input-proxy')
      const started = performance.now()
      await app.key(tail ? 'ctrl+End' : 'ctrl+Home')
      await app.until(
        async () =>
          (await observe()).items.some((x) => x.text === (tail ? 'Heading 40000' : 'Large start')),
        'repeated navigation',
        30000,
      )
      navigationSamples.push({
        target: tail ? 'tail' : 'head',
        elapsedMs: performance.now() - started,
        rendered: (await observe()).items.length,
      })
    }
    await record('large-navigation-distribution', { samples: navigationSamples })
    const listRect = await app.execute(
      "return document.querySelector('[data-virtual-list]').getBoundingClientRect().toJSON()",
    )
    x(
      'mousemove',
      '--window',
      windowId,
      String(Math.round(listRect.x + listRect.width / 2)),
      String(Math.round(listRect.top + listRect.height / 2)),
      'click',
      '--repeat',
      '1000',
      '--delay',
      '0',
      '4',
    )
    const middle = await app.until(
      () =>
        app.execute(
          `const list=document.querySelector('[data-virtual-list]'),r=list.getBoundingClientRect();return [...list.querySelectorAll('.plugin-list-item')].map(x=>({text:x.textContent,title:x.title,rect:x.getBoundingClientRect()})).find(x=>/^Heading /.test(x.text)&&x.rect.top>=r.top&&x.rect.bottom<=r.bottom&&Number(x.text.split(' ')[1])>10000&&Number(x.text.split(' ')[1])<35000)?.title`,
        ),
      'middle virtual wheel navigation',
      30000,
    )
    await click('.plugin-list-item[title=' + JSON.stringify(middle) + ']')
    const middleLine = Number(/^Heading (\d+)/.exec(middle)[1])
    await app.until(
      async () => (await app.probe()).cursor === large.indexOf('## Heading ' + middleLine + '\n'),
      'middle heading exact position',
    )
    await shot('06b-large-middle')
    const collapseAt = performance.now()
    await click('[data-plugin-ui] [data-plugin-command="outline.collapseAll"]')
    await app.until(
      async () =>
        Number((await observe()).virtual.virtualTotal) === 1 &&
        (await observe()).items.length === 1,
      'large collapse all',
      180000,
    )
    await record('large-collapse-all', { elapsedMs: performance.now() - collapseAt })
    await click('[data-plugin-ui] [data-plugin-command="outline.expandAll"]')
    await app.until(
      async () =>
        Number((await observe()).virtual.virtualTotal) === 8775 &&
        !(await observe()).panel.includes('正在更新折叠视图'),
      'large expand all',
      180000,
    )
    await record('large-after-navigation', { temporary: await temporary(), processes: resources() })
  }
  await open(fixture)
  await app.until(async () => (await observe()).items.length === 9, 'returned small index')
  const beforeClose = await temporary()
  await closeNormally()
  await app.close()
  await start()
  await app.until(
    async () => (await observe()).items.length === 9,
    'enabled plugin restored after restart',
  )
  if (
    await app.execute('return document.querySelector("#app").dataset.sidebarCollapsed === "true"')
  )
    await click('[data-sidebar-toggle]')
  const afterClose = await temporary()
  assert(!afterClose.some((row) => row.id && beforeClose.some((old) => old.id === row.id)))
  await record('normal-close-index-cleanup', { beforeClose, afterClose })
  await shot('07-restored')
  let retainedStores = 0
  if (process.env.MILKUP_PLUGIN_TEST_CRASH === '1') {
    const beforeCrash = await temporary()
    const owner = await ownedApplication(app.application, fixture)
    const termination = await owner.signal('SIGKILL')
    await app.close()
    await start()
    await app.until(async () => (await observe()).items.length === 9, 'plugin after forced exit')
    const afterCrash = await temporary()
    const oldIds = beforeCrash.filter((row) => row.id).map((row) => row.id)
    assert(oldIds.every((id) => afterCrash.some((row) => row.id === id)))
    assert(afterCrash.some((row) => row.id && !oldIds.includes(row.id)))
    retainedStores = oldIds.length
    await record('crash-retains-unknown-owner', { beforeCrash, afterCrash, termination })
  }

  await menu()
  await click('[data-plugin-action="disable"]')
  await app.until(async () => (await observe()).items.length === 0, 'disabled UI removed')
  assert((await observe()).manager.includes('命令 0'))
  assert.equal((await temporary()).find((row) => 'stores' in row)?.stores ?? 0, retainedStores)
  await record('disabled-contributions-removed')
  await click('[data-plugin-action="enable"]')
  await app.until(async () => (await observe()).items.length === 9, 'reenabled')
  await click('[data-plugin-action="remove"]')
  await app.until(async () => (await observe()).manager.includes('0 个已安装'), 'uninstalled')
  assert.equal((await observe()).items.length, 0)
  await app.key('Escape')
  await app.key('ctrl+1')
  await app.until(async () => (await app.probe()).mode === 'source', 'source mode ready')
  await app.focus('.milkup-input-proxy')
  await app.key('ctrl+End')
  await app.text(' after uninstall')
  await app.key('ctrl+s')
  await app.until(
    async () =>
      (await readFile(fixture, 'utf8')) === original + '# Added heading after uninstall' &&
      !(await app.probe()).dirty,
    'save after uninstall bytes',
  )
  const saved = await readFile(fixture)
  assert.equal(saved.toString(), original + '# Added heading after uninstall')
  await shot('08-uninstalled-editor-saved')
  await record('byte-integrity', {
    sha256: createHash('sha256').update(saved).digest('hex'),
    bytes: saved.length,
  })
  await app.close()
  await start()
  assert.equal((await observe()).items.length, 0)
  await record('uninstall-persists-after-restart')
  const renamedArchive = JSON.parse(await readFile(archivePath, 'utf8'))
  renamedArchive.manifest.id = 'example.independent-outline'
  renamedArchive.manifest.name = 'Independent outline identity proof'
  const renamedPath = path.join(output, 'renamed.milkup-plugin')
  await writeFile(renamedPath, JSON.stringify(renamedArchive))
  await menu()
  await click('[data-plugin-action="install"]')
  await picker(renamedPath)
  await app.until(
    async () => (await observe()).manager.includes('example.independent-outline'),
    'renamed installed',
  )
  await app.until(
    () => app.execute('return !!document.querySelector("[data-plugin-action=enable]")'),
    'renamed enable control',
  )
  await click('[data-plugin-action="enable"]')
  await app.key('Escape')
  await app.until(async () => (await observe()).items.length === 9, 'renamed plugin active')
  assert(
    await app.execute(
      'return !!document.querySelector(arguments[0])',
      '[data-plugin-ui="example.independent-outline:outline-panel"]',
    ),
  )
  if (
    await app.execute('return document.querySelector("#app").dataset.sidebarCollapsed === "true"')
  )
    await click('[data-sidebar-toggle]')
  await shot('09-renamed-independent-plugin')
  await menu()
  await click('[data-plugin-action="remove"]')
  await app.until(
    async () => (await observe()).manager.includes('0 个已安装'),
    'renamed uninstalled',
  )
  await record('renamed-plugin-removed')
  console.log('PASS production plugin system')
} catch (error) {
  try {
    execFileSync('import', ['-window', 'root', path.join(output, 'failure-desktop.png')], {
      env: process.env,
      timeout: 10000,
    })
  } catch {}
  if (app) await record('FAIL', { error: String(error), stack: error.stack }).catch(() => {})
  throw error
} finally {
  if (app) await app.close()
}

// Production-only contract: normal GTK package/document pickers, XTest input,
// read-only DOM observations. Run with a dedicated clean driver profile/display.
import assert from 'node:assert/strict'
import { appendFileSync } from 'node:fs'
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
const resourceSamples = []
let resourceTimer
if (process.env.MILKUP_OUTLINE_INDEX_ONLY === '1')
  resourceTimer = setInterval(() => {
    const sample = { at: new Date().toISOString(), processes: resources() }
    resourceSamples.push(sample)
    appendFileSync(path.join(output, 'resources.ndjson'), JSON.stringify(sample) + '\n')
  }, 1000)
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
async function click(selector, pause = 180) {
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
  await app.delay(pause)
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

const dense =
  Array.from({ length: 18000 }, (_, i) => {
    const within = i % 900
    const level = within === 0 ? 1 : within % 30 === 0 ? 2 : 3 + (within % 4)
    return (
      '#'.repeat(level) +
      ' ' +
      (i % 15 === 0 ? 'Duplicate' : `Dense ${i}`) +
      '\n' +
      ('body ' + 'x'.repeat(60))
    )
  }).join('\n') + '\n'
await writeFile(path.join(output, 'dense.md'), dense)
const installInstrumentation = () =>
  app.execute(`
 const stats=window.__outlinePerf={phase:'install',phases:{}};
 const add=(phase,name,ms,bytes=0)=>{const p=stats.phases[phase]??={};const s=p[name]??={count:0,ms:0,maxMs:0,bytes:0,buckets:{}};s.count++;s.ms+=ms;s.maxMs=Math.max(s.maxMs,ms);s.bytes+=bytes;const bucket=ms<=0?0:2**Math.ceil(Math.log2(ms));s.buckets[bucket]=(s.buckets[bucket]??0)+1;};
 const W=window.Worker;window.Worker=class extends W{constructor(...args){super(...args);const incoming=new Map(),outgoing=new Map();const stamp=m=>({at:performance.now(),phase:stats.phase,name:m.protocol+':'+m.method,bytes:(m.payload?.entries??[]).reduce((n,e)=>n+new TextEncoder().encode(e.value??'').length,0)});const done=(map,m)=>{const r=map.get(m.protocol+':'+m.id);if(r){map.delete(m.protocol+':'+m.id);add(r.phase,r.name,performance.now()-r.at,r.bytes)}};this.addEventListener('message',e=>{const m=e.data;if(m?.type==='request')incoming.set(m.protocol+':'+m.id,stamp(m));else if(m?.type==='response')done(outgoing,m);});const post=this.postMessage;this.postMessage=function(m,...rest){if(m?.type==='request')outgoing.set(m.protocol+':'+m.id,stamp(m));else if(m?.type==='response')done(incoming,m);return post.call(this,m,...rest)}}};
 const transaction=IDBDatabase.prototype.transaction;IDBDatabase.prototype.transaction=function(...args){const phase=stats.phase,at=performance.now(),tx=transaction.apply(this,args);tx.addEventListener('complete',()=>add(phase,'idb:'+tx.mode,performance.now()-at),{once:true});tx.addEventListener('abort',()=>add(phase,'idb:abort',performance.now()-at),{once:true});return tx;};
 `)
async function phase(name, action, ready) {
  await app.execute('window.__outlinePerf.phase=arguments[0]', name)
  const at = performance.now()
  await action()
  await app.until(ready, name, 300000)
  await record(name, {
    elapsedMs: performance.now() - at,
    metrics: await app.execute('return window.__outlinePerf.phases[arguments[0]]??{}', name),
    temporary: await temporary(),
    processes: resources(),
  })
}
const ready = async (total, roots) => {
  const o = await observe()
  return (
    o.summary?.startsWith('全文索引完成') &&
    Number(o.virtual?.virtualTotal) === total &&
    !o.panel.includes('正在更新折叠视图') &&
    (roots ? o.items.length === total : o.items.length > Math.min(total, 10))
  )
}
try {
  await start()
  await installInstrumentation()
  await menu()
  if (await app.execute('return !!document.querySelector("[data-plugin-action=remove]")')) {
    await click('[data-plugin-action="remove"]')
    await app.until(
      () => app.execute('return !document.querySelector("[data-plugin-action=remove]")'),
      'old removed',
    )
  }
  await click('[data-plugin-action="install"]')
  await picker(archivePath)
  await app.until(
    () => app.execute('return !!document.querySelector("[data-plugin-action=enable]")'),
    'enable available',
  )
  await app.execute("window.__outlinePerf.phase='index-ordinary'")
  const at = performance.now()
  await click('[data-plugin-action="enable"]')
  await app.key('Escape')
  if (await app.execute('return document.querySelector("#app").dataset.sidebarCollapsed==="true"'))
    await click('[data-sidebar-toggle]')
  await app.until(async () => ready(8, true), 'ordinary complete')
  await record('index-ordinary', {
    elapsedMs: performance.now() - at,
    metrics: await app.execute("return window.__outlinePerf.phases['index-ordinary']"),
    temporary: await temporary(),
  })
  for (const c of [
    { name: 'ordinary', total: 8, roots: 2 },
    { name: '8775', file: 'large.md', total: 8775, roots: 1 },
    { name: '18000', file: 'dense.md', total: 18000, roots: 20 },
  ].filter((c) => process.env.MILKUP_OUTLINE_DETAILS_ONLY !== '1' || c.name === '18000')) {
    if (c.file)
      await phase(
        'index-' + c.name,
        () => open(path.join(output, c.file)),
        () => ready(c.total, false),
      )
    if (process.env.MILKUP_OUTLINE_INDEX_ONLY !== '1')
      for (let i = 1; i <= 3; i++) {
        await phase(
          'collapse-' + c.name + '-' + i,
          () => click('[data-plugin-ui] [data-plugin-command="outline.collapseAll"]', 0),
          () => ready(c.roots, true),
        )
        await phase(
          'expand-' + c.name + '-' + i,
          () => click('[data-plugin-ui] [data-plugin-command="outline.expandAll"]', 0),
          () => ready(c.total, c.total <= 10),
        )
      }
  }
  if (
    process.env.MILKUP_OUTLINE_INDEX_ONLY === '1' &&
    process.env.MILKUP_OUTLINE_SKIP_REPEAT !== '1'
  )
    for (const c of [
      { name: '8775', file: 'large.md', total: 8775 },
      { name: '18000', file: 'dense.md', total: 18000 },
    ])
      await phase(
        'index-repeat-' + c.name,
        () => open(path.join(output, c.file)),
        () => ready(c.total, false),
      )
  if (process.env.MILKUP_OUTLINE_DETAILS === '1') {
    await app.key('ctrl+1')
    await app.until(async () => (await app.probe()).mode === 'source', 'source mode ready')
    for (let i = 0; i < 6; i++) {
      const tail = i % 2 === 1
      await app.focus('.milkup-input-proxy')
      await phase(
        'dense-navigation-' + i,
        () => app.key(tail ? 'ctrl+End' : 'ctrl+Home'),
        async () =>
          (await observe()).items.some(
            (x) =>
              x.title === (tail ? 'Dense 17999（第 35999 行）' : 'Duplicate（第 1 行）') &&
              x.current === 'location',
          ),
      )
    }
    await phase(
      'dense-collapse-for-duplicates',
      () => click('[data-plugin-ui] [data-plugin-command="outline.collapseAll"]', 0),
      () => ready(20, true),
    )
    const offset = dense.split('\n').slice(0, 1800).join('\n').length + 1
    await phase(
      'dense-second-duplicate',
      () => click('.plugin-list-item[title="Duplicate（第 1801 行）"]', 0),
      async () => (await app.probe()).cursor === offset,
    )
    await phase(
      'dense-expand-for-sparse',
      () => click('[data-plugin-ui] [data-plugin-command="outline.expandAll"]', 0),
      () => ready(18000, false),
    )
    const toggle = (title) =>
      '.plugin-tree-row:has(.plugin-list-item[title="' + title + '"]) .plugin-tree-toggle'
    for (let i = 1; i <= 3; i++) {
      await phase(
        'dense-root-collapse-' + i,
        () => click(toggle('Duplicate（第 1801 行）'), 0),
        () => ready(17101, false),
      )
      await phase(
        'dense-root-expand-' + i,
        () => click(toggle('Duplicate（第 1801 行）'), 0),
        () => ready(18000, false),
      )
    }
    await phase(
      'dense-nested-collapse',
      () => click(toggle('Dense 901（第 1803 行）'), 0),
      () => ready(17998, false),
    )
    await phase(
      'dense-nested-expand',
      () => click(toggle('Dense 901（第 1803 行）'), 0),
      () => ready(18000, false),
    )
    assert.equal(await readFile(path.join(output, 'dense.md'), 'utf8'), dense)
    await shot('dense-nested-complete')
  }
  await menu()
  await click('[data-plugin-action="remove"]')
  await app.until(async () => (await observe()).items.length === 0, 'removed')
  await app.key('Escape')
  await closeNormally()
  console.log('PASS outline cost profile')
} catch (error) {
  if (app) {
    await record('FAIL', {
      error: String(error),
      metrics: await app.execute('return window.__outlinePerf').catch(() => null),
    }).catch(() => {})
    await app.shot('failure').catch(() => {})
  }
  throw error
} finally {
  clearInterval(resourceTimer)
  await writeFile(
    path.join(output, 'resources.json'),
    JSON.stringify(resourceSamples, null, 2) + '\n',
  )
  if (app) await app.close()
}

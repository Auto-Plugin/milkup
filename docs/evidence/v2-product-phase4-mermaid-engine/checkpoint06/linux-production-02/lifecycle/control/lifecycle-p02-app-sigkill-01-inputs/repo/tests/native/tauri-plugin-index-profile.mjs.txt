// Same reviewed public scan plugin, fixture and production input path for both hosts.
// Instrumentation records timings/counts only; it does not change query results.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { startProduction } from '../helpers/native-production.mjs'
const output = process.env.MILKUP_NATIVE_EVIDENCE_DIR
const fixture = process.env.MILKUP_SEARCH_FIXTURE
const archive = process.env.MILKUP_PLUGIN_ARCHIVE
assert(output && fixture && archive)
await mkdir(output, { recursive: true })
const app = await startProduction(fixture, output)
const x = (...args) =>
  execFileSync('xdotool', args, { encoding: 'utf8', env: process.env, timeout: 10000 }).trim()
const windowId = x('search', '--onlyvisible', '--class', 'milkup-desktop')
  .split('\n')
  .map((id) => {
    const g = x('getwindowgeometry', '--shell', id)
    return { id, area: Number(/WIDTH=(\d+)/.exec(g)[1]) * Number(/HEIGHT=(\d+)/.exec(g)[1]) }
  })
  .sort((a, b) => b.area - a.area)[0].id
async function click(selector) {
  const r = await app.execute(
    'return document.querySelector(arguments[0]).getBoundingClientRect().toJSON()',
    selector,
  )
  assert(r.width > 0 && r.height > 0)
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
try {
  await app.execute(`
 window.__indexProfile={native:[],rpc:[]};
 const p=window.__indexProfile,invoke=window.__TAURI_INTERNALS__.invoke;
 window.__TAURI_INTERNALS__.invoke=function(command,args,...rest){const at=performance.now();return invoke.call(this,command,args,...rest).then(value=>{if(command==='read_large_text_file_line_window')p.native.push({from:args.fromLine,to:args.toLine,budget:args.maxTextLength??null,ms:performance.now()-at,utf16:value.text?.length??0,ok:true});return value},error=>{if(command==='read_large_text_file_line_window')p.native.push({from:args.fromLine,to:args.toLine,budget:args.maxTextLength??null,ms:performance.now()-at,ok:false,error:String(error)});throw error;});};
 const W=window.Worker;
 window.Worker=class extends W{constructor(...args){super(...args);const pending=new Map();this.addEventListener('message',e=>{const m=e.data;if(m?.protocol==='milkup.plugin.document.rpc.v1'&&m.type==='request')pending.set(m.id,{at:performance.now(),method:m.method});});const post=this.postMessage;this.postMessage=function(m,...rest){const v=pending.get(m?.id);if(v&&m?.protocol==='milkup.plugin.document.rpc.v1'&&m.type==='response'){p.rpc.push({method:v.method,ms:performance.now()-v.at,type:m.value?.type,items:m.value?.items?.length??0});pending.delete(m.id);}return post.call(this,m,...rest);};}}
 `)
  await click('[data-menu-toggle]')
  await click('[data-menu-section="plugins"]')
  if (await app.execute('return !!document.querySelector("[data-plugin-action=remove]")'))
    await click('[data-plugin-action="remove"]')
  await click('[data-plugin-action="install"]')
  const id = await app.until(() => dialog(), 'GTK picker')
  x('windowfocus', '--sync', id, 'key', '--clearmodifiers', 'ctrl+l')
  await app.delay(300)
  x('key', '--clearmodifiers', 'ctrl+a')
  x('type', '--clearmodifiers', '--delay', '1', '--', path.resolve(archive))
  await app.delay(300)
  x('key', '--clearmodifiers', 'Return')
  await app.delay(600)
  if (dialog()) x('key', '--clearmodifiers', 'Return')
  await app.until(() => !dialog(), 'picker closed')
  x('windowfocus', '--sync', windowId)
  await app.until(
    () => app.execute('return !!document.querySelector("[data-plugin-action=enable]")'),
    'installed probe',
  )
  await click('[data-plugin-action="enable"]')
  await app.key('Escape')
  if (
    await app.execute('return document.querySelector("#app").dataset.sidebarCollapsed === "true"')
  )
    await click('[data-sidebar-toggle]')
  for (let run = 1; run <= 3; run++) {
    if (run > 1) {
      await app.execute('window.__indexProfile.native.length=0;window.__indexProfile.rpc.length=0')
      await click('[data-plugin-ui] [data-plugin-command="measure.run"]')
    }
    const report = await app.until(
      async () =>
        app.execute(
          `const text=document.querySelector('[data-plugin-ui="example.scan-probe:probe"] .plugin-list-summary')?.textContent; if(!text)return null;const r=JSON.parse(text);return r.run===arguments[0]&&(r.status==='complete'||r.status==='failed'||r.status==='truncated')?r:null`,
          run,
        ),
      'full scan complete',
      60000,
    )
    const diagnostics = await app.execute('return window.__indexProfile')
    const bytes = await readFile(fixture)
    const result = {
      nativeInstrumentationAvailable: diagnostics.native.length > 0,
      report,
      diagnostics,
      fixture: { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') },
      resources: execFileSync(
        'ps',
        ['-C', 'milkup-desktop', '-C', 'WebKitWebProcess', '-o', 'pid,stat,rss,pcpu,comm'],
        { encoding: 'utf8' },
      ),
    }
    await writeFile(
      path.join(output, `profile-${run}.json`),
      JSON.stringify(result, null, 2) + '\n',
    )
    await app.shot('scan-complete')
    assert.equal(report.status, 'complete')
    assert.equal(report.scannedLines, 40001)
    assert.equal(report.items, 8775)
    console.log(
      JSON.stringify({
        report,
        nativeReads: diagnostics.native.length,
        nativeMs: diagnostics.native.reduce((s, x) => s + x.ms, 0),
        rpcRequests: diagnostics.rpc.length,
        rpcMs: diagnostics.rpc.reduce((s, x) => s + x.ms, 0),
      }),
    )
  }
} catch (error) {
  await app.shot('failure').catch(() => {})
  await writeFile(
    path.join(output, 'failure.json'),
    JSON.stringify({
      error: String(error),
      body: await app.execute('return document.body.innerText').catch(() => null),
    }),
  )
  throw error
} finally {
  await app.close()
}

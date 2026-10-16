// Production-only latency protocol. Input is XTest, observations do not import
// development modules or replace editor methods. Every sample, including misses,
// is retained. Two rAFs are a presentation proxy, not a physical display timestamp.
import assert from 'node:assert/strict'
import { mkdir, writeFile, readFile, stat } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { loadavg } from 'node:os'
import path from 'node:path'
import { startProduction } from '../helpers/native-production.mjs'
import { observeNativeMemory } from '../helpers/native-process-memory.mjs'
const root = path.resolve(
  process.env.MILKUP_NATIVE_EVIDENCE_DIR ?? '/workspace/.milkup-v2-phase19/pilot',
)
const bytes = Number(process.env.MILKUP_LATENCY_BYTES ?? 104857600)
const lineBytes = Number(process.env.MILKUP_LATENCY_LINE_BYTES ?? 4096)
const mode = process.env.MILKUP_LATENCY_MODE ?? 'live'
const cycles = Number(process.env.MILKUP_LATENCY_CYCLES ?? 4)
assert([179200, 1048576, 10485760, 104857600].includes(bytes))
assert([64, 4096].includes(lineBytes))
assert(['source', 'live'].includes(mode))
await mkdir(root, { recursive: true })
const header = Buffer.from('A👩🏽‍💻B\r\n'),
  line = Buffer.from('body ' + 'x'.repeat(lineBytes - 7) + '\r\n')
const repetitions = Math.ceil((bytes - header.length) / line.length)
const original = Buffer.concat([header, Buffer.from(line.toString().repeat(repetitions))])
const file = path.join(root, 'original.md'),
  utf16Length = 'A👩🏽‍💻B\r\n'.length + repetitions * lineBytes
await writeFile(file, original)
const hash = (b) => createHash('sha256').update(b).digest('hex')
const metadata = {
  bytes: original.length,
  sha256: hash(original),
  lines: repetitions + 2,
  lineBytes,
  utf16Length,
  mode,
  cycles,
  coldDefinition:
    'first distant target in a fresh process/view; OS page cache not flushed; fixture was just written',
  probeVersion: 2,
  presentation:
    'keydown to exact visible cursor/DOM, then two requestAnimationFrame callbacks; no physical display claim',
}
await writeFile(path.join(root, 'fixture.json'), JSON.stringify(metadata, null, 2))
const samples = [],
  resources = []
async function resource(label) {
  const memory = await readFile('/sys/fs/cgroup/memory.stat', 'utf8')
  const value = {
    label,
    wall: Date.now(),
    memoryCurrent: Number(await readFile('/sys/fs/cgroup/memory.current', 'utf8')),
    anonymous: Number(/^anon (\d+)$/m.exec(memory)?.[1] ?? 0),
    fileCache: Number(/^file (\d+)$/m.exec(memory)?.[1] ?? 0),
    cpu: await readFile('/sys/fs/cgroup/cpu.stat', 'utf8'),
    events: await readFile('/sys/fs/cgroup/memory.events', 'utf8'),
    load: loadavg(),
    runnerMemory: process.memoryUsage(),
  }
  resources.push(value)
  assert(value.anonymous < 8 * 1024 ** 3, 'resource guard: cgroup anonymous memory >= 8 GiB')
  return value
}
await resource('before-start')
const finishMemory = observeNativeMemory(),
  started = performance.now()
let app
try {
  app = await startProduction(file, root)
  samples.push({
    kind: 'open-to-ready',
    ms: performance.now() - started,
    scope: 'includes driver request and CLI file readiness, not cold disk',
  })
  await app.key(mode === 'source' ? 'ctrl+1' : 'ctrl+2')
  await app.until(
    () =>
      app.execute(
        'return document.querySelector(".milkup-editor").dataset.mode===arguments[0]',
        mode,
      ),
    'mode',
  )
  await app.focus('.milkup-input-proxy')
  await app.execute(`
 window.__latency={samples:[],armed:null,maxTimerGap:0,longTasks:[],ipc:[],frameGaps:[],longTaskSupported:(PerformanceObserver.supportedEntryTypes??[]).includes('longtask')};
 const invokeDescriptor=Object.getOwnPropertyDescriptor(window.__TAURI_INTERNALS__,'invoke');window.__latency.invokeDescriptor={writable:invokeDescriptor?.writable,configurable:invokeDescriptor?.configurable};
 let previousTimer=performance.now(),previousFrame=performance.now();
 setInterval(()=>{const t=performance.now();window.__latency.maxTimerGap=Math.max(window.__latency.maxTimerGap,t-previousTimer);previousTimer=t},20);
 const frame=t=>{const gap=t-previousFrame;if(gap>50)window.__latency.frameGaps.push({at:t,gap});previousFrame=t;requestAnimationFrame(frame)};requestAnimationFrame(frame);
 try{new PerformanceObserver(list=>window.__latency.longTasks.push(...list.getEntries().map(e=>({start:e.startTime,duration:e.duration})))).observe({entryTypes:['longtask']})}catch{}
 const check=()=>{const p=window.__latency.armed;if(!p||p.started===undefined||p.dom!==undefined)return;
 const cursor=document.querySelector('.milkup-cursor');if(!cursor||Number(cursor.dataset.position)!==p.expected)return;const editor=document.querySelector('.milkup-editor'),r=cursor.getBoundingClientRect(),v=editor.getBoundingClientRect();
 let complete=false;
 if(p.kind==='search')complete=document.querySelector('[data-search-input]').value===p.query&&document.querySelector('[data-search-loading]').hidden&&document.querySelector('[data-search-result-count]').textContent===p.count&&Number(cursor?.dataset.position)===p.expected;
 else complete=cursor&&Number(cursor.dataset.position)===p.expected&&r.height>0&&r.top>=v.top-1&&r.bottom<=v.bottom+1;
 if(!complete)return;
 p.dom=performance.now();p.cursor=Number(cursor?.dataset.position);p.renderedLines=document.querySelectorAll('.milkup-line').length;p.recovery=document.querySelector('#app').dataset.recoveryPhase;
 requestAnimationFrame(()=>requestAnimationFrame(()=>{p.twoFrames=performance.now();p.domMs=p.dom-p.started;p.frameMs=p.twoFrames-p.started;p.version=Number(document.querySelector('[data-stat=version]').textContent);window.__latency.samples.push({...p});if(window.__latency.armed===p)window.__latency.armed=null;}));};
 new MutationObserver(check).observe(document.querySelector('#app'),{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['data-position','style','hidden','data-recovery-phase']});
 window.addEventListener('keydown',e=>{const p=window.__latency.armed;if(p&&p.started===undefined&&e.key===p.key){p.started=performance.now();p.wall=Date.now();p.trusted=e.isTrusted;p.target=e.target.className;p.modifiers={ctrl:e.ctrlKey,meta:e.metaKey,alt:e.altKey};queueMicrotask(check)}},true);
 window.__latencyCheck=check;
 `)
  const observe = async (spec, key) => {
    const before = await app.execute('return window.__latency.samples.length')
    await app.execute('window.__latency.armed={...arguments[0]}', spec)
    const sent = performance.now()
    await app.key(key)
    await app.until(
      () => app.execute('return window.__latency.samples.length>arguments[0]', before),
      spec.kind + ' observed',
      spec.kind === 'search' ? 125000 : 15000,
    )
    const sample = await app.execute('return window.__latency.samples.at(-1)')
    assert(sample.trusted, 'input must be native trusted event')
    sample.externalCommandToObservedMs = performance.now() - sent
    if (spec.targetMs !== undefined) sample.overTarget = sample.frameMs > spec.targetMs
    samples.push(sample)
    await writeFile(
      path.join(root, 'samples.json'),
      JSON.stringify({ metadata, samples, resources }, null, 2),
    )
    return sample
  }
  for (let round = 0; round < cycles; round++) {
    await resource('clean-cycle-' + round)
    for (const [direction, expected, key] of [
      ['end', utf16Length, 'End'],
      ['home', 0, 'Home'],
    ]) {
      await observe(
        {
          kind: 'jump',
          round,
          direction,
          expected,
          key,
          temperature: round === 0 && direction === 'end' ? 'first-target' : 'unchanged-warm',
          targetMs: round === 0 && direction === 'end' ? 500 : 200,
        },
        'ctrl+' + key,
      )
    }
  }
  for (let round = 0; round < cycles; round++) {
    await resource('cycle-' + round)
    for (const [direction, expected, key] of [
      ['end', utf16Length, 'End'],
      ['home', 0, 'Home'],
    ]) {
      await observe(
        {
          kind: 'jump',
          round,
          direction,
          expected,
          key,
          temperature: round === 0 ? 'unchanged-warm' : 'after-edit',
          targetMs: 200,
        },
        'ctrl+' + key,
      )
    }
    await observe({ kind: 'input', round, expected: 1, key: 'q', targetMs: 200 }, 'q')
    await observe(
      { kind: 'delete', round, expected: 0, key: 'Backspace', targetMs: 200 },
      'BackSpace',
    )
    // This interval keeps the idle recovery path observable, rather than disabling it.
    await app.delay(800)
    const idle = await app.execute(
      'return {recovery:document.querySelector("#app").dataset.recoveryPhase,version:Number(document.querySelector("[data-stat=version]").textContent)}',
    )
    samples.push({ kind: 'checkpoint-state', round, ...idle })
  }
  const saveStarted = performance.now()
  await app.key('ctrl+s')
  await app.until(
    async () => {
      const p = await app.probe()
      return !p.saving && !p.dirty
    },
    'save complete',
    20000,
  )
  samples.push({ kind: 'save-to-ready', ms: performance.now() - saveStarted })
  assert((await readFile(file)).equals(original), 'exact file bytes after reversible inputs')
  // A occurs once in the unchanged header; complete search includes a full scan.
  await app.key('ctrl+f')
  await app.focus('[data-search-input]')
  await app.key('ctrl+a')
  await observe(
    {
      kind: 'search',
      expected: 1,
      query: 'A',
      count: '1/1',
      key: 'A',
      temperature: 'first-query',
      targetMs: 500,
    },
    'shift+a',
  )
  await app.key('Escape')
  await app.shot(mode + '-final')
  await resource('complete')
  await writeFile(
    path.join(root, 'diagnostics.json'),
    JSON.stringify(
      await app.execute(
        'return {invokeDescriptor:window.__latency.invokeDescriptor,longTaskSupported:window.__latency.longTaskSupported,maxTimerGap:window.__latency.maxTimerGap,longTasks:window.__latency.longTasks,frameGaps:window.__latency.frameGaps,backend:!!document.querySelector(".milkup-source-document-view"),kind:document.querySelector("[data-document-kind]").textContent,viewport:{width:innerWidth,height:innerHeight,dpr:devicePixelRatio},diagnostics:window.__productionDiagnostics}',
      ),
      null,
      2,
    ),
  )
  const summary = {
    metadata,
    samples,
    resources,
    complete: true,
    violations: samples.filter((s) => s.overTarget),
  }
  await writeFile(path.join(root, 'samples.json'), JSON.stringify(summary, null, 2))
  console.log(
    JSON.stringify({
      bytes: original.length,
      lineBytes,
      mode,
      samples: samples.length,
      violations: summary.violations.map((s) => ({
        kind: s.kind,
        round: s.round,
        direction: s.direction,
        ms: s.frameMs,
        target: s.targetMs,
      })),
    }),
  )
} catch (error) {
  await writeFile(
    path.join(root, 'failure.json'),
    JSON.stringify(
      {
        error: String(error),
        metadata,
        samples,
        resources,
        probe: await app?.probe().catch(() => null),
        pending: await app?.execute('return window.__latency').catch(() => null),
      },
      null,
      2,
    ),
  )
  throw error
} finally {
  await writeFile(path.join(root, 'memory.json'), JSON.stringify(await finishMemory(), null, 2))
  await app?.close()
}

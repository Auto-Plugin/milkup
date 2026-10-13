// Real Tauri/WebKit + real disk regression. Start tauri-driver and the Vite
// desktop server first; file picker paths are supplied through the existing
// native test seam. This does NOT claim OS file-picker or system IME coverage.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import path from 'node:path'

const base = process.env.TAURI_DRIVER_URL ?? 'http://127.0.0.1:4444'
const output =
  process.env.MILKUP_NATIVE_EVIDENCE_DIR ?? `/tmp/milkup-native-window-profile-${Date.now()}`
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
  await action()
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
const original = 'A👩🏽‍💻B\r\n' + 'body line\r\n'.repeat(100000)
const file = path.join(output, 'unicode-large.md')
await writeFile(file, original)
const samples = []
let failure
const call = (script, ...args) => req('POST', `/session/${sid}/execute/async`, { script, args })
try {
  await start()
  const attached = await call(
    `const done=arguments[arguments.length-1];
    Promise.all([import(arguments[0]),import('/src/large-document-source.ts')]).then(([{SourceDocumentView},{LargeDocumentSource}])=>{
      window.__windowProfile={ipc:[],render:[]};
      const read=LargeDocumentSource.prototype.readLineWindow;
      LargeDocumentSource.prototype.readLineWindow=async function(fromLine,toLine){
        const start=performance.now();window.__windowProfile.documentId=this.documentId;
        try{return await read.call(this,fromLine,toLine)}finally{
          window.__windowProfile.ipc.push({start,end:performance.now(),args:{documentId:this.documentId,fromLine,toLine}});
        }
      };
      const original=SourceDocumentView.prototype.renderVisibleWindow;
      SourceDocumentView.prototype.renderVisibleWindow=async function(...args){
        const start=performance.now();try{return await original.apply(this,args)}finally{
          window.__windowProfile.render.push({start,end:performance.now(),from:this.contentDOM.dataset.fromLine,to:this.contentDOM.dataset.toLine});
        }
      };
      done({ok:true});
    }).catch(error=>done({ok:false,error:String(error)}));`,
    '/@fs/' +
      path
        .resolve('packages/view-dom/src/source-document-view.ts')
        .replaceAll('\\', '/')
        .replace(/^\/+/, ''),
  )
  assert.equal(attached.ok, true, JSON.stringify(attached))
  for (const mode of ['source', 'live']) {
    await fresh()
    await paths(file, undefined)
    await shortcut('o')
    await until(
      () => execute('return !!document.querySelector(".milkup-source-document-view")'),
      'native source',
    )
    await ready()
    await shortcut(mode === 'source' ? '1' : '2')
    await until(
      () =>
        execute(
          'return document.querySelector(".milkup-editor-content").dataset.renderMode===arguments[0]',
          mode,
        ),
      'mode',
    )
    const control = await call(
      `const done=arguments[arguments.length-1];(async()=>{const samples=[];for(let i=0;i<3;i++){const t=performance.now();await window.__TAURI_INTERNALS__.invoke('bridge_status');samples.push(performance.now()-t)}return samples})().then(value=>done({ok:true,value}),error=>done({ok:false,error:String(error)}))`,
    )
    assert.equal(control.ok, true)
    samples.push({ mode, kind: 'empty-bridge-roundtrip-ms', values: control.value })
    for (let repeat = 0; repeat < (process.env.MILKUP_PROFILE_CONTROLS_ONLY ? 0 : 4); repeat++) {
      for (const direction of ['away', 'return']) {
        const sample = await call(
          `const top=arguments[0],far=arguments[1],done=arguments[arguments.length-1];
          const view=document.querySelector('.milkup-source-document-view'),content=document.querySelector('.milkup-editor-content'),profile=window.__windowProfile;
          profile.ipc=[];profile.render=[];
          const started=performance.now();let finished=false;
          const timer=setTimeout(()=>{if(!finished){finished=true;done({ok:false,error:'viewport timeout',ipc:profile.ipc,render:profile.render})}},15000);
          view.scrollTop=top;
          const check=()=>{if(finished)return;const from=Number(content.dataset.fromLine);
            if(far?from>1000:from===1) requestAnimationFrame(()=>requestAnimationFrame(()=>{
              if(finished)return;finished=true;clearTimeout(timer);
              const layoutStart=performance.now();const rect=content.getBoundingClientRect();const layoutMs=performance.now()-layoutStart;
              done({ok:true,start:started,end:performance.now(),elapsedMs:performance.now()-started,layoutProbeMs:layoutMs,height:rect.height,from:Number(content.dataset.fromLine),to:Number(content.dataset.toLine),renderedLines:content.querySelectorAll('.milkup-line').length,ipc:profile.ipc,render:profile.render});
            }));else requestAnimationFrame(check);
          };check();`,
          direction === 'away' ? 100000 : 0,
          direction === 'away',
        )
        assert.equal(sample.ok, true, JSON.stringify(sample))
        assert.ok(sample.renderedLines < 200)
        assert.ok(sample.render.length > 0, 'render instrumentation attached')
        if (mode === 'source')
          assert.ok(sample.ipc.length > 0, 'source window RPC instrumentation attached')
        samples.push({
          mode,
          kind: 'viewport',
          cache: repeat === 0 ? 'first-window-after-reopen' : 'repeated-window',
          repeat,
          direction,
          ...sample,
        })
        console.log(JSON.stringify(samples.at(-1)))
      }
    }
    if (!process.env.MILKUP_PROFILE_CONTROLS_ONLY) {
      const direct = await call(`const done=arguments[arguments.length-1];(async()=>{
      const values=[];for(let repeat=0;repeat<4;repeat++){const started=performance.now();const value=await window.__TAURI_INTERNALS__.invoke('read_large_text_file_line_window',{documentId:window.__windowProfile.documentId,fromLine:4738,toLine:4819});values.push({elapsedMs:performance.now()-started,lines:value.lines.length})}return values;
    })().then(value=>done({ok:true,value}),error=>done({ok:false,error:String(error)}));`)
      assert.equal(direct.ok, true, JSON.stringify(direct))
      samples.push({ mode, kind: 'direct-window-ipc-ms', values: direct.value })
    }
    const idle = await call(`const done=arguments[arguments.length-1];(async()=>{
      const frames=[];for(let i=0;i<6;i++){const started=performance.now();await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));frames.push(performance.now()-started)}
      const timers=[];for(let i=0;i<6;i++){const started=performance.now();await new Promise(resolve=>setTimeout(resolve,16));timers.push(performance.now()-started)}
      return {frames,timers,visibility:document.visibilityState,focused:document.hasFocus()};
    })().then(value=>done({ok:true,value}),error=>done({ok:false,error:String(error)}));`)
    assert.equal(idle.ok, true)
    samples.push({ mode, kind: 'idle-two-frames-and-16ms-timer', ...idle.value })
    await focus()
    await execute(`window.__inputTiming=undefined;
      document.querySelector('.milkup-input-proxy').addEventListener('keydown',function observe(event){
        if(event.key!=='x')return;this.removeEventListener('keydown',observe,true);const started=performance.now();
        const observer=new MutationObserver(()=>{if(document.querySelector('.milkup-line[data-line="1"]').textContent.startsWith('xA')){
          observer.disconnect();const domMs=performance.now()-started;
          requestAnimationFrame(()=>requestAnimationFrame(()=>window.__inputTiming={domMs,twoFramesMs:performance.now()-started}));
        }});
        observer.observe(document.querySelector('.milkup-editor-content'),{subtree:true,childList:true,characterData:true});
      },true);`)
    await key('x')
    const inputTiming = await until(
      () => execute('return window.__inputTiming'),
      'actual key timing',
    )
    assert.equal(
      await execute(
        'return document.querySelector(arguments[0]).textContent',
        '.milkup-line[data-line="1"]',
      ),
      'xA👩🏽‍💻B',
    )
    await key('\uE003')
    await until(
      () =>
        execute(
          'return document.querySelector(arguments[0]).textContent===arguments[1]',
          '.milkup-line[data-line="1"]',
          'A👩🏽‍💻B',
        ),
      'restore after actual key',
    )
    samples.push({ mode, kind: 'actual-x-key-to-content', ...inputTiming })
    await shot(`profile-${mode}`)
  }
} catch (error) {
  failure = String(error)
  throw error
} finally {
  await writeFile(
    path.join(output, 'profile.json'),
    JSON.stringify(
      {
        executionStatus: failure ? 'error' : 'completed',
        latencyTargetsMs: { firstAway: 500, warm: 200 },
        targetViolations: samples
          .filter(
            (sample) =>
              sample.kind === 'viewport' &&
              sample.elapsedMs > (sample.repeat === 0 && sample.direction === 'away' ? 500 : 200),
          )
          .map(({ mode, repeat, direction, elapsedMs }) => ({
            mode,
            repeat,
            direction,
            elapsedMs,
          })),
        ...(failure ? { error: failure } : {}),
        fixtureBytes: Buffer.byteLength(original),
        fixtureLines: 100002,
        cacheDefinition:
          'First target after reopening native registration/view; OS file cache is not forcibly dropped.',
        samples,
      },
      null,
      2,
    ),
  )
  if (sid) {
    await execute('localStorage.removeItem("milkup.desktop.nativeTestPaths")').catch(() => {})
    await req('DELETE', `/session/${sid}`).catch(() => {})
  }
}

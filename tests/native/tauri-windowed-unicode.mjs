// Real Tauri/WebKit + real disk regression. Start tauri-driver and the Vite
// desktop server first; file picker paths are supplied through the existing
// native test seam. This does NOT claim OS file-picker or system IME coverage.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import path from 'node:path'

const base = process.env.TAURI_DRIVER_URL ?? 'http://127.0.0.1:4444'
const output = process.env.MILKUP_NATIVE_EVIDENCE_DIR ?? `/tmp/milkup-native-windowed-${Date.now()}`
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
const lineText = (n) =>
  execute(
    'return document.querySelector(`.milkup-line[data-line="${arguments[0]}"]`)?.textContent.replace(/\\u200b/g, "")',
    n,
  )
const cursor = () => execute('return document.querySelector(".milkup-cursor")?.dataset.position')
const samples = []
const file = path.join(output, 'unicode-large.md')
const original = 'A👩🏽‍💻B\r\n' + 'body line\r\n'.repeat(100000)
await writeFile(file, original)
try {
  await start()
  for (const mode of ['source', 'live']) {
    await fresh()
    await paths(file, undefined)
    await shortcut('o')
    await until(async () => (await lineText(1)) === 'A👩🏽‍💻B', 'native large file')
    await ready()
    assert.equal(
      await execute('return !!document.querySelector(".milkup-source-document-view")'),
      true,
    )
    await shortcut(mode === 'source' ? '1' : '2')
    await focus()
    await check(`${mode}: whole grapheme movement, deletion, immediate undo and redo`, async () => {
      await key('\uE014', '\uE014')
      await until(async () => (await cursor()) === '8', 'whole emoji cursor')
      await key('\uE003')
      await until(async () => (await lineText(1)) === 'AB', 'emoji deleted')
      await shortcut('z')
      await until(async () => (await lineText(1)) === 'A👩🏽‍💻B', 'emoji undo')
      await chord('\uE009', '\uE008', 'z')
      await until(async () => (await lineText(1)) === 'AB', 'emoji redo')
      await shortcut('z')
      await until(async () => (await lineText(1)) === 'A👩🏽‍💻B', 'restore emoji')
    })
    await check(`${mode}: distant viewport and return preserve cursor`, async () => {
      const position = await cursor()
      const measurements = []
      for (let repeat = 0; repeat < 3; repeat++) {
        for (const direction of ['away', 'return']) {
          const measurement = await req('POST', `/session/${sid}/execute/async`, {
            script: `const top=arguments[0],far=arguments[1],done=arguments[arguments.length-1];
              const view=document.querySelector('.milkup-source-document-view');
              const content=document.querySelector('.milkup-editor-content');
              const started=performance.now();let finished=false;
              const finish=value=>{if(!finished){finished=true;done(value);}};
              const timer=setTimeout(()=>finish({ok:false,error:'viewport frame timeout'}),10000);
              view.scrollTop=top; view.dispatchEvent(new Event('scroll'));
              const check=()=>{
                if(finished)return;
                const from=Number(content.dataset.fromLine);
                if(far ? from>1000 : from===1) requestAnimationFrame(()=>requestAnimationFrame(()=>{
                  clearTimeout(timer);finish({ok:true,elapsedMs:performance.now()-started,renderedLines:content.querySelectorAll('.milkup-line').length});
                }));
                else requestAnimationFrame(check);
              };check();`,
            args: [direction === 'away' ? 100000 + repeat * 10000 : 0, direction === 'away'],
          })
          assert.equal(measurement.ok, true, JSON.stringify(measurement))
          assert.ok(measurement.renderedLines < 200)
          measurements.push({ direction, ...measurement })
        }
      }
      assert.equal(await cursor(), position)
      samples.push({ mode, kind: 'page-render-plus-two-frames-ms', measurements })
      await shot(`native-windowed-${mode}-unicode`)
    })
    await check(`${mode}: CRLF cross-line selection, delete, undo and disk save`, async () => {
      // Place at the first source offset of line 80 using a native pointer action.
      await execute(
        'const v=document.querySelector(".milkup-source-document-view");v.scrollTop=79*21;v.dispatchEvent(new Event("scroll"))',
      )
      await until(
        () =>
          execute('return !!document.querySelector(arguments[0])', '.milkup-line[data-line="80"]'),
        'line 80',
      )
      await execute(
        'document.querySelector(arguments[0]).scrollIntoView({block:"center"})',
        '.milkup-line[data-line="80"]',
      )
      // Scrolling replaces virtualized row elements. Read coordinates atomically
      // after frames settle instead of retaining a WebDriver element across renders.
      const rect = await req('POST', `/session/${sid}/execute/async`, {
        script: `const selector=arguments[0],done=arguments[arguments.length-1];
          requestAnimationFrame(()=>requestAnimationFrame(()=>{
            const rect=document.querySelector(selector).getBoundingClientRect();
            done({x:rect.x,y:rect.y,width:rect.width,height:rect.height});
          }));`,
        args: ['.milkup-line[data-line="80"]'],
      })
      await req('POST', `/session/${sid}/actions`, {
        actions: [
          {
            type: 'pointer',
            id: 'mouse',
            parameters: { pointerType: 'mouse' },
            actions: [
              {
                type: 'pointerMove',
                origin: 'viewport',
                x: Math.ceil(rect.x + 1),
                y: Math.ceil(rect.y + rect.height / 2),
              },
              { type: 'pointerDown', button: 0 },
              { type: 'pointerUp', button: 0 },
            ],
          },
        ],
      })
      const before = Number(await cursor())
      const expected = original.indexOf('body line', original.indexOf('\r\n') + 2) + 78 * 11
      assert.equal(before, expected)
      // Select the preceding CRLF and delete it; then undo and save exact bytes.
      await chord('\uE008', '\uE012')
      await key('\uE017')
      await until(() => lineText(79).then((t) => t === 'body linebody line'), 'join previous line')
      await shortcut('z')
      await until(() => lineText(79).then((t) => t === 'body line'), 'undo CRLF')
      await shortcut('s')
      await ready()
      await until(
        () =>
          execute(
            'return document.querySelector("[data-stat=saved]").textContent === document.querySelector("[data-stat=version]").textContent',
          ),
        'saved current revision',
      )
      await until(async () => (await readFile(file, 'utf8')) === original, 'unchanged disk bytes')
    })
    await shot(`native-windowed-${mode}`)
  }
  await execute('localStorage.removeItem("milkup.desktop.nativeTestPaths")')
  console.log(JSON.stringify({ results, fixtureBytes: Buffer.byteLength(original), samples }))
} finally {
  await writeFile(
    path.join(output, 'results.json'),
    JSON.stringify({ results, fixtureBytes: Buffer.byteLength(original), samples }, null, 2),
  )
  if (sid) {
    await execute('localStorage.removeItem("milkup.desktop.nativeTestPaths")').catch(() => {})
    await req('DELETE', `/session/${sid}`).catch(() => {})
  }
}

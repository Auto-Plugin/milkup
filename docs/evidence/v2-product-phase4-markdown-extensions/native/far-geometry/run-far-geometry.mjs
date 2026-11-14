// Linux production acceptance. Public DOM observations and control focus only;
// edits, authorization, navigation and commands use real native keyboard/pointer input.
// startProduction also attaches its existing diagnostic listeners/Worker observer.
// No private editor state, synthetic input events, plugin APIs or native IPC are injected.
// Write-only preparation is permitted with --preflight; UI requires an explicit SHA gate.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile, readdir, access } from 'node:fs/promises'
import path from 'node:path'
import { startProduction } from '/workspace/milkup/tests/helpers/native-production.mjs'
import { ownedApplication } from '/workspace/milkup/tests/helpers/native-owned-process.mjs'
import { ownNativeClipboard } from '/workspace/milkup/tests/helpers/native-clipboard.mjs'
import {
  action,
  nativeFixture,
  x,
} from '/workspace/milkup/tests/helpers/native-updates-fixture.mjs'

const evidence = '/workspace/milkup-markdown-extensions-phase4-evidence'
const output = path.resolve(process.env.MILKUP_NATIVE_EVIDENCE_DIR || path.join(evidence, 'native'))
const diagnosticInstall = process.env.MILKUP_NATIVE_DIAGNOSTIC_INSTALL === '1'
const traceEnabled = diagnosticInstall || process.env.MILKUP_NATIVE_RENDER_TRACE === '1'
const archives = process.env.MILKUP_MARKDOWN_ARCHIVES_JSON
  ? JSON.parse(process.env.MILKUP_MARKDOWN_ARCHIVES_JSON)
  : {
      'milkup.math': path.join(
        evidence,
        'math/external-crlf-final/dist/milkup.math-1.0.0.milkup-plugin',
      ),
      'milkup.diagrams': path.join(
        evidence,
        'diagrams/external/dist/milkup.diagrams-1.0.0.milkup-plugin',
      ),
      'milkup.footnotes': path.join(
        evidence,
        'footnotes/external-format-final/dist/milkup.footnotes-1.0.0.milkup-plugin',
      ),
    }
const expectedIds = [
  'outline',
  'updates',
  'workspace',
  'preferences',
  'shortcuts',
  'formatting',
  'images',
  'math',
  'diagrams',
  'footnotes',
]
  .map((x) => 'milkup.' + x)
  .sort()
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex')
const preferences = '[data-plugin-ui="milkup.preferences:preferences-panel"]'
const formatting = '[data-plugin-ui="milkup.formatting:formatting-modal"]'
const images = '[data-plugin-ui="milkup.images:images-panel"]'
const samples = [
  {
    id: 'root',
    marker: 'SAMPLE-ROOT',
    needle: '$\\frac{x_1^2}{\\sqrt[3]{y}}$',
    kind: 'math',
    tag: 'mroot',
  },
  {
    id: 'matrix',
    marker: 'SAMPLE-MATRIX',
    needle: '$$\r\n\\begin{pmatrix}',
    kind: 'math',
    tag: 'mtable',
  },
  {
    id: 'flow',
    marker: 'SAMPLE-FLOW',
    needle: '```mermaid\r\nflowchart',
    kind: 'vector',
    label: '开始',
  },
  {
    id: 'sequence',
    marker: 'SAMPLE-SEQUENCE',
    needle: '```mermaid\r\nsequenceDiagram',
    kind: 'vector',
    label: '请求',
  },
  { id: 'pie', marker: 'SAMPLE-PIE', needle: '```mermaid\r\npie', kind: 'vector', label: '甲' },
  { id: 'footnotes', marker: 'SAMPLE-FOOTNOTES', needle: '[^note]', kind: 'reference' },
]
const prefix = [
  '# Unicode 中文 é 👩🏽‍💻',
  '',
  'SAMPLE-ROOT',
  '公式 $\\frac{x_1^2}{\\sqrt[3]{y}}$ 和 $\\int_0^\\infty x\\,dx$。',
  '',
  'SAMPLE-MATRIX',
  '$$',
  '\\begin{pmatrix}a&b\\\\c&d\\end{pmatrix}',
  '$$',
  '',
  'SAMPLE-FLOW',
  '```mermaid',
  'flowchart TD',
  'A[开始] --> B{通过?}',
  'B -->|是| C(完成)',
  '```',
  '',
  'SAMPLE-SEQUENCE',
  '```mermaid',
  'sequenceDiagram',
  'actor A as 用户',
  'participant B as 服务',
  'A->>B: 请求',
  'B-->>A: 返回',
  '```',
  '',
  'SAMPLE-PIE',
  '```mermaid',
  'pie',
  'title 分布',
  '"甲": 2',
  '"乙": 1',
  '```',
  '',
  'SAMPLE-FOOTNOTES',
  '脚注引用[^note] 与再次引用[^note]。',
  '',
  '[^note]: 定义中文与 **强调**，原始 Unicode 保留。',
  '',
  'SAMPLE-ERRORS',
  '未知 $\\notACommand{x}$。',
  '```mermaid',
  'flowchart TD',
  'click A "https://example.invalid"',
  '```',
  '',
  'SAMPLE-CODE',
  '`$notMath$` 与 [目标](https://example.invalid/$notMath$)',
  '```text',
  '$notMath$',
  '```',
  '',
  'END-SAMPLES',
  '',
].join('\r\n')
const contents = new Map([
  ['ordinary', prefix],
  [
    'windowed',
    prefix +
      'retained 中文 é 👩🏽‍💻 body\r\n'.repeat(160000) +
      '\r\nSAMPLE-REMOTE-FOOTNOTE\r\n尾部第三次引用[^note]。\r\n',
  ],
])
const packages = []
for (const id of ['milkup.math', 'milkup.diagrams', 'milkup.footnotes']) {
  assert.equal(typeof archives[id], 'string', 'Missing independent archive ' + id)
  const archive = path.resolve(archives[id]),
    bytes = await readFile(archive),
    bundle = JSON.parse(bytes)
  assert.equal(bundle.format, 'milkup-plugin')
  assert.equal(bundle.manifest.id, id)
  assert.equal(bundle.manifest.host, 'worker')
  assert.deepEqual(bundle.manifest.permissions, ['document:read'])
  assert(bundle.manifest.engines.pluginSdk.includes('0.3.3'))
  assert(bundle.manifest.contributes.documentRenderers.length > 0)
  assert(
    !archive.startsWith(path.resolve('plugins') + path.sep),
    'Use the independently built external archive',
  )
  packages.push({ id, archive, sha256: hash(bytes), manifest: bundle.manifest })
}
const matrixCases = []
for (const name of ['ordinary', 'windowed'])
  for (const mode of ['source', 'live'])
    for (const theme of ['light', 'dark'])
      for (const zoom of [1, 1.25, 1.5, 2])
        for (const narrow of [false, true])
          matrixCases.push({
            name,
            mode,
            theme,
            zoom,
            narrow,
            key: `${name}-${mode}-${theme}-${zoom * 100}-${narrow ? 'narrow' : 'wide'}`,
          })
assert.equal(matrixCases.length, 64)
await mkdir(output, { recursive: true })
try {
  await access(path.join(output, 'results.json'))
  throw Error('Existing result evidence must be preserved; select a new output directory')
} catch (error) {
  if (error.code !== 'ENOENT') throw error
}
await writeFile(
  path.join(output, 'plan.json'),
  JSON.stringify(
    {
      matrixCases,
      samples,
      packages,
      expectedIds,
      uiStarted: false,
      windowsFonts: 'not-tested',
      matrixScreenshotsPerCase: samples.length,
    },
    null,
    2,
  ),
)
for (const [name, text] of contents) {
  assert((text.match(/\r\n/g) || []).length > 0)
  assert(!text.includes('\\r\\n'), 'Fixture must contain real CRLF, not literal escapes')
  if (name === 'windowed') assert(text.split('\r\n').length > 160000)
  await writeFile(path.join(output, name + '.md'), text)
}
const launcher = path.join(output, 'launcher.md')
await writeFile(launcher, '# Markdown extension acceptance\r\n')
if (process.argv.includes('--preflight')) {
  console.log(
    'PASS preflight: three external packages, real Unicode/CRLF fixtures and exact 64-case plan; no UI started',
  )
  process.exit(0)
}
assert.equal(
  process.env.MILKUP_MARKDOWN_BINARY_CONFIRMED,
  '1',
  'Wait for this turn’s frozen Linux candidate',
)
assert(
  process.env.TAURI_APP_PATH && process.env.MILKUP_MARKDOWN_BINARY_SHA256,
  'Set candidate binary and exact expected SHA',
)
assert(process.env.MILKUP_RECOVERY_PROFILE, 'Dedicated recovery-v1 profile is required')
const binary = path.resolve(process.env.TAURI_APP_PATH),
  binarySha256 = hash(await readFile(binary))
assert.equal(binarySha256, process.env.MILKUP_MARKDOWN_BINARY_SHA256)
const harnessSources = await Promise.all(
  [
    import.meta.url,
    new URL('/workspace/milkup/tests/helpers/native-production.mjs', import.meta.url).href,
    new URL('/workspace/milkup/tests/helpers/native-updates-fixture.mjs', import.meta.url).href,
    new URL('/workspace/milkup/tests/helpers/native-owned-process.mjs', import.meta.url).href,
    new URL('/workspace/milkup/tests/helpers/native-clipboard.mjs', import.meta.url).href,
  ].map(async (url) => ({
    file: new URL(url).pathname,
    sha256: hash(await readFile(new URL(url))),
  })),
)
await writeFile(
  path.join(output, 'provenance.json'),
  JSON.stringify(
    {
      binary,
      binarySha256,
      harnessSources,
      packages,
      display: process.env.DISPLAY,
      driver: process.env.TAURI_DRIVER_URL,
      profile: process.env.XDG_DATA_HOME,
      recoveryProfile: process.env.MILKUP_RECOVERY_PROFILE,
      head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
      windowsFonts: 'not-tested',
      input: 'Native XTest/GTK input, public DOM observation and focus; no private APIs',
      renderTrace: traceEnabled,
      diagnosticOnly: diagnosticInstall,
      segmentedCoverage: true,
      acceptance: false,
      overallP4Status: 'FAILED',
    },
    null,
    2,
  ),
)
let app, nativeWindow, activeFile, launchFile
const ui = nativeFixture(() => app),
  results = [],
  pointerAttempts = [],
  samplingMisses = []
const registry = () =>
  app.execute(
    `return JSON.parse(localStorage.getItem('milkup.desktop.plugins.registry.v1')||'{"records":[]}').records.map(r=>({id:r.manifest.id,enabled:r.enabled,state:r.state,sourcePath:r.sourcePath,errors:r.errors})).sort((a,b)=>a.id.localeCompare(b.id))`,
  )
const observe = () =>
  app.execute(`
const rect=e=>e.getBoundingClientRect().toJSON(),a=document.activeElement;
return {width:innerWidth,height:innerHeight,editorRect:rect(document.querySelector('.milkup-editor')),theme:document.documentElement.dataset.theme,zoom:Number(document.querySelector('#app')?.dataset.appearanceZoom),windowed:!!document.querySelector('.milkup-source-document-view'),focus:{tag:a?.tagName,field:a?.dataset.pluginFieldControl,visible:a?.matches(':focus-visible'),outline:a?getComputedStyle(a).outline:null},fonts:document.fonts.status,previews:[...document.querySelectorAll('[data-document-presentation]')].map(e=>({from:Number(e.dataset.presentationFrom),to:Number(e.dataset.presentationTo),layout:e.dataset.documentPresentation,label:e.getAttribute('aria-label'),rect:rect(e),scrollHeight:e.scrollHeight,clientHeight:e.clientHeight,scrollWidth:e.scrollWidth,clientWidth:e.clientWidth,math:[...e.querySelectorAll('math')].map(m=>({namespace:m.namespaceURI,rect:rect(m),font:getComputedStyle(m).fontFamily,roots:[...m.querySelectorAll('mroot,msqrt')].map(rect),fractions:[...m.querySelectorAll('mfrac')].map(rect),tables:[...m.querySelectorAll('mtable')].map(t=>({rect:rect(t),rows:[...t.querySelectorAll('mtr')].map(r=>({rect:rect(r),cells:[...r.children].map(rect)}))}))})),svg:[...e.querySelectorAll('svg')].map(s=>({namespace:s.namespaceURI,viewBox:s.getAttribute('viewBox'),rect:rect(s),texts:[...s.querySelectorAll('text')].map(t=>({text:t.textContent,rect:rect(t)})),unsafe:s.querySelectorAll('script,foreignObject,image,a,use,style').length})),references:[...e.querySelectorAll('.milkup-document-reference')].map(b=>({text:b.textContent,rect:rect(b)}))})),status:[...document.querySelectorAll('[data-document-presentation-status]')].map(e=>({state:e.dataset.documentPresentationStatus,text:e.textContent.slice(0,200)})),diagnostics:window.__productionDiagnostics}
`)
async function record(name, extra = {}) {
  results.push({
    name,
    at: new Date().toISOString(),
    ...extra,
    document: await app.probe(),
    dom: await observe(),
    registry: await registry(),
  })
  await writeFile(path.join(output, 'results.json'), JSON.stringify(results, null, 2))
  if (name.startsWith('matrix-complete-') || name === 'FAIL' || name === 'PASS')
    await writeFile(
      path.join(output, 'matrix-summary.json'),
      JSON.stringify(
        {
          binarySha256,
          diagnosticOnly: diagnosticInstall,
          plannedCases: 64,
          plannedSamples: 384,
          cases: matrixCases.map((combination) => ({
            ...combination,
            complete: results.some((r) => r.name === 'matrix-complete-' + combination.key),
            samples: results
              .filter((r) => r.combination?.key === combination.key && r.sample)
              .map((r) => ({
                sample: r.sample,
                success: true,
                sourceMarker: r.sourceMarker,
                sourceGeometry: r.sourceGeometry,
                viewport: { width: r.dom.width, height: r.dom.height, zoom: r.dom.zoom },
                geometry: r.preview,
                screenshots: r.screenshots,
                version: r.document.version,
                dirty: r.document.dirty,
              })),
          })),
        },
        null,
        2,
      ),
    )
  if (!name.startsWith('matrix-'))
    await writeFile(
      path.join(output, 'semantic-summary.json'),
      JSON.stringify(
        {
          binarySha256,
          diagnosticOnly: diagnosticInstall,
          steps: results
            .filter((r) => !r.name.startsWith('matrix-'))
            .map(({ dom, registry: plugins, document, ...details }) => ({
              ...details,
              document,
              plugins,
              diagnostics: dom.diagnostics,
            })),
        },
        null,
        2,
      ),
    )
  if (traceEnabled)
    await writeFile(
      path.join(output, 'render-trace.json'),
      JSON.stringify(await app.execute('return window.__renderTrace'), null, 2),
    )
  console.log('PASS ' + name)
}
async function shot(name, extra = {}) {
  await app.delay(400)
  await app.shot(name + '-webview')
  execFileSync('import', ['-window', 'root', path.join(output, name + '-x11.png')], {
    env: process.env,
  })
  const screenshots = await Promise.all(
    ['webview', 'x11'].map(async (kind) => {
      const file = `${name}-${kind}.png`,
        bytes = await readFile(path.join(output, file))
      return { kind, file, bytes: bytes.length, sha256: hash(bytes) }
    }),
  )
  await record(name, { ...extra, screenshots })
}

async function keyboardFocus(selector) {
  await ui.ready(selector)
  for (let i = 0; i < 160; i++) {
    if (await app.execute('return document.activeElement?.matches(arguments[0])', selector)) return
    const previous = await app.execute('return document.activeElement?.outerHTML')
    await app.key('Tab')
    await app.until(
      () => app.execute('return document.activeElement?.outerHTML!==arguments[0]', previous),
      'native focus movement',
    )
  }
  throw Error('Native keyboard did not reach ' + selector)
}
async function click(selector) {
  await ui.ready(selector)
  const sample = () =>
    app.execute(
      'const e=document.querySelector(arguments[0]);if(!e)return null;const r=e.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2,hit=document.elementFromPoint(x,y);return{x,y,w:innerWidth,h:innerHeight,rect:r.toJSON(),editor:document.querySelector(".milkup-editor")?.getBoundingClientRect().toJSON(),line:e.closest(".milkup-line")?.getBoundingClientRect().toJSON(),active:document.activeElement?.className,hitElement:{tag:hit?.tagName,className:hit?.getAttribute("class")},zoom:document.querySelector("#app")?.dataset.appearanceZoom,hit:e.contains(hit)}',
      selector,
    )
  let r, firstMissingAt, lastMissingAt
  let missingCount = 0
  const startedAt = Date.now()
  const present = (value) => {
    if (value) return true
    missingCount++
    firstMissingAt ??= Date.now()
    lastMissingAt = Date.now()
    return false
  }
  try {
    await app.until(async () => {
      const a = await sample()
      if (!present(a)) return false
      await app.delay(80)
      const b = await sample()
      if (!present(b)) return false
      if (JSON.stringify(a) !== JSON.stringify(b)) return false
      r = b
      return true
    }, 'stable click geometry')
  } finally {
    samplingMisses.push({
      selector,
      startedAt,
      elapsedMs: Date.now() - startedAt,
      missingCount,
      firstMissingAt,
      lastMissingAt,
      stable: !!r,
    })
    await writeFile(
      path.join(output, 'pointer-sampling.json'),
      JSON.stringify(samplingMisses, null, 2),
    )
  }
  const attempt = { selector, at: new Date().toISOString(), geometry: r, nativePointerSent: false }
  pointerAttempts.push(attempt)
  const saveAttempts = () =>
    writeFile(path.join(output, 'pointer-input.json'), JSON.stringify(pointerAttempts, null, 2))
  await saveAttempts()
  assert(
    r.hit && r.x >= 0 && r.x < r.w && r.y >= 0 && r.y < r.h,
    'Native pointer target must be visible and hit-testable: ' + selector,
  )
  const scale = Number(/WIDTH=(\d+)/.exec(x('getwindowgeometry', '--shell', nativeWindow))[1]) / r.w
  x(
    'mousemove',
    '--window',
    nativeWindow,
    String(Math.round(r.x * scale)),
    String(Math.round(r.y * scale)),
    'click',
    '1',
  )
  attempt.nativePointerSent = true
  await saveAttempts()
  await app.delay(100)
}
async function menu(section = 'plugins') {
  if (
    !(await app.execute(
      'return !!document.querySelector("[data-app-menu]")?.getClientRects().length',
    ))
  )
    await click('[data-menu-toggle]')
  await click(`[data-menu-section="${section}"]`)
}
async function list() {
  await menu()
  if (await ui.exists('[data-plugin-action="back"]')) await click('[data-plugin-action="back"]')
}
async function details(id) {
  await list()
  // The plugin list retains its own scroll position. Focus this public card
  // control to reveal it before the explicit pointer hit test; this is confined
  // to manager navigation and must never scroll document previews into view.
  await app.focus(action('details', id))
  await click(action('details', id))
  await ui.ready('#plugin-detail-title')
}
async function closeUI() {
  for (const selector of [formatting, images, preferences])
    if (await ui.exists(selector)) await click(`${selector} .plugin-ui-close`)
  if (
    await app.execute('return !!document.querySelector("[data-app-menu]")?.getClientRects().length')
  )
    await click('[data-menu-close]')
}
async function openUI(id, view) {
  await closeUI()
  await menu()
  const entry = `[data-plugin-menu-entry="${id}:${view}"]`
  if (await ui.exists(entry)) await click(entry)
  else {
    await details(id)
    await click(action('open-ui', id))
  }
  await ui.ready(`[data-plugin-ui="${id}:${view}"]`)
}
async function setField(panel, key, value) {
  const selector = `${panel} [data-plugin-field-control="${key}"]`
  await keyboardFocus(selector)
  const options = await app.execute(
    'const e=document.querySelector(arguments[0]);return e.tagName==="SELECT"?[...e.options].map(o=>o.value):null',
    selector,
  )
  if (options) {
    const n = options.indexOf(String(value))
    assert(n >= 0)
    await app.key('Home')
    for (let i = 0; i < n; i++) {
      await app.key('Down')
      await app.delay(80)
    }
    await app.key('Tab')
  } else {
    await app.key('ctrl+a')
    await app.text(String(value))
    await app.key('Tab')
  }
  await app.until(
    () =>
      app.execute(
        'return document.querySelector(arguments[0])?.value===arguments[1]',
        selector,
        String(value),
      ),
    'field settled ' + key,
  )
}

async function start(file = launcher) {
  app = await startProduction(file, output)
  if (traceEnabled)
    await app.execute(`
window.__renderTrace={events:[],drift:[],geometry:[],observationOnly:true};
const trace=window.__renderTrace,Base=window.Worker;
let last=performance.now();setInterval(()=>{const now=performance.now();trace.drift.push({at:now,wall:Date.now(),delta:now-last});last=now;if(trace.drift.length>4000)trace.drift.shift()},50);
const add=e=>{trace.events.push({at:performance.now(),wall:Date.now(),...e});if(trace.events.length>4000)trace.events.shift()};
const summary=value=>{
  const supervisor=value&&typeof value==='object'&&!Array.isArray(value)&&value.protocol==='milkup.plugin.worker-supervisor.v1';
  const forwarded=supervisor&&(value.type==='forward'||value.type==='child')&&Object.hasOwn(value,'message')&&Object.keys(value).every(key=>['protocol','type','message'].includes(key));
  // Observation only: unwrap exactly one layer. A child-supplied control-shaped
  // message stays child data and never becomes a supervisor control event.
  const m=forwarded?value.message:value;
  const control=supervisor&&value.type==='control'&&!Object.hasOwn(value,'message')&&Object.keys(value).every(key=>['protocol','type','event','id'].includes(key));
  return {outerProtocol:supervisor?value.protocol:undefined,outerType:supervisor?value.type:undefined,unwrapped:!!forwarded,supervisorControl:control?value.event:undefined,protocol:m?.protocol,type:m?.type,id:m?.id,method:m?.method,ok:m?.ok,error:m?.error,sourceLength:m?.payload?.request?.source?.length,blockCount:m?.payload?.request?.blocks?.length,fragments:m?.value?.fragments?.length,selection:m?.payload?.request?.selection};
};
window.Worker=class extends Base{constructor(...args){super(...args);this.traceName=args[1]?.name;add({kind:'new',worker:this.traceName});this.addEventListener('message',e=>add({kind:'receive',worker:this.traceName,...summary(e.data)}))}postMessage(...args){add({kind:'send',worker:this.traceName,...summary(args[0])});return super.postMessage(...args)}terminate(){add({kind:'terminate',worker:this.traceName});return super.terminate()}};
const rect=e=>e?.getBoundingClientRect().toJSON();window.__seekGeometry=stage=>{if(!window.__seekMarker)return;const editor=document.querySelector('.milkup-editor'),proxy=document.querySelector('.milkup-input-proxy'),lines=[...document.querySelectorAll('.milkup-line')].filter(e=>e.textContent.includes(window.__seekMarker));trace.geometry.push({at:performance.now(),wall:Date.now(),stage,marker:window.__seekMarker,scrollTop:editor?.scrollTop,editor:rect(editor),proxy:rect(proxy),active:document.activeElement?.className,lines:lines.map(e=>({text:e.textContent,rect:rect(e),dataset:{...e.dataset}})),previews:[...document.querySelectorAll('[data-document-presentation]')].map(e=>({from:e.dataset.presentationFrom,rect:rect(e)}))});if(trace.geometry.length>2000)trace.geometry.shift()};if (${diagnosticInstall}) setInterval(()=>window.__seekGeometry('interval'),50);
`)
  nativeWindow = await app.until(() => {
    try {
      return ui.windowId()
    } catch {
      return false
    }
  }, 'stable native main window')
  activeFile = file
  launchFile = file
  x('windowsize', nativeWindow, '1100', '760')
}
async function openDocument(name) {
  await closeUI()
  const file = path.join(output, name + '.md')
  await app.key('ctrl+o')
  await nativePicker(file)
  await app.until(
    async () => {
      const p = await app.probe()
      return p.path === file && p.loading === 'ready'
    },
    'GTK document open ' + name,
    30000,
  )
  activeFile = file
  assert.equal((await observe()).windowed, name === 'windowed')
}
async function editorFocus() {
  await closeUI()
  const p = await app.execute(
    'const r=document.querySelector(".milkup-editor").getBoundingClientRect();return{x:r.left+25,y:r.top+25,w:innerWidth}',
  )
  const scale = Number(/WIDTH=(\d+)/.exec(x('getwindowgeometry', '--shell', nativeWindow))[1]) / p.w
  x(
    'mousemove',
    '--window',
    nativeWindow,
    String(Math.round(p.x * scale)),
    String(Math.round(p.y * scale)),
    'click',
    '1',
  )
  await app.until(
    () => app.execute('return document.activeElement?.matches(".milkup-input-proxy")'),
    'editor native focus',
  )
}
async function selectAt(mode, kind) {
  await editorFocus()
  await app.key('ctrl+1')
  await app.until(async () => (await app.probe()).mode === 'source', 'source mode')
  await app.key('ctrl+Home')
  await app.until(async () => (await app.probe()).cursor === 0, 'CtrlHome settled')
  if (kind === 'word') {
    for (let i = 0; i < 5; i++) await app.key('shift+Right')
  }
  if (kind === 'cell') {
    for (let i = 0; i < 4; i++) await app.key('Down')
    await app.key('Home')
    await app.key('Right')
    await app.key('Right')
  }
  if (kind === 'end') await app.key('ctrl+End')
  if (mode === 'live') {
    await app.key('ctrl+2')
    await app.until(async () => (await app.probe()).mode === 'live', 'live mode')
  }
}
async function saved(expected) {
  await closeUI()
  await app.key('ctrl+s')
  await app.until(
    async () =>
      !(await app.probe()).dirty && (await readFile(activeFile)).equals(Buffer.from(expected)),
    'complete byte save',
    30000,
  )
}

async function appearance(theme, zoom) {
  await closeUI()
  const current = await observe()
  const physical = Number(/WIDTH=(\d+)/.exec(x('getwindowgeometry', '--shell', nativeWindow))[1])
  if (current.theme !== theme || current.zoom !== zoom) {
    await openUI('milkup.preferences', 'preferences-panel')
    if (current.theme !== theme) await setField(preferences, 'appearance.theme', theme)
    if (current.zoom !== zoom) await setField(preferences, 'appearance.zoom', zoom)
    await app.until(
      () =>
        app.execute(
          'return document.documentElement.dataset.theme===arguments[0]&&Number(document.querySelector("#app")?.dataset.appearanceZoom)===arguments[1]&&Math.abs(innerWidth*arguments[1]-arguments[2])<=2',
          theme,
          zoom,
          physical,
        ),
      'preferences applied to native geometry',
    )
    await click(`${preferences} button[aria-label="保存"]`)
    await app.until(
      () =>
        app.execute(
          'return document.querySelector(arguments[0])?.textContent.includes("偏好已保存")',
          preferences,
        ),
      'appearance preferences saved',
    )
    await closeUI()
  }
  await app.until(
    () =>
      app.execute(
        'return document.documentElement.dataset.theme===arguments[0]&&Number(document.querySelector("#app")?.dataset.appearanceZoom)===arguments[1]&&Math.abs(innerWidth*arguments[1]-arguments[2])<=2',
        theme,
        zoom,
        physical,
      ),
    'host and WebView appearance geometry',
  )
}

function nativeWindowVisible(id) {
  try {
    return /Map State:\s+IsViewable/.test(
      execFileSync('xwininfo', ['-id', id], {
        encoding: 'utf8',
        env: process.env,
        stdio: ['ignore', 'pipe', 'ignore'],
      }),
    )
  } catch {
    return false
  }
}
async function dismissGtkReadError(tag) {
  const shotPath = path.join(output, `gtk-${tag}-${Date.now()}-x11.png`)
  execFileSync('import', ['-window', 'root', shotPath], { env: process.env })
  const words = execFileSync('tesseract', [shotPath, 'stdout', 'tsv'], {
    encoding: 'utf8',
    env: process.env,
    stdio: ['ignore', 'pipe', 'ignore'],
  })
  await writeFile(shotPath + '.tsv', words)
  const rows = words.split('\n').map((row) => row.split('\t'))
  const text = rows.map((row) => row.at(-1)).join(' ')
  if (
    !/Bad\s+address|Could\s+not\s+read|folder\s+contents\s+could\s+not\s+be\s+displayed|do\s+not\s+have\s+access\s+to\s+the\s+specified\s+folder/i.test(
      text,
    )
  )
    return false
  const ok = rows.find((row) => row.at(-1)?.trim().toUpperCase() === 'OK')
  assert(ok, 'Observed GTK folder read error must expose its real OK button')
  x(
    'mousemove',
    String(Number(ok[6]) + Number(ok[8]) / 2),
    String(Number(ok[7]) + Number(ok[9]) / 2),
    'click',
    '1',
  )
  await app.delay(500)
  await record('gtk-folder-read-error-dismissed', { screenshot: shotPath, ocr: text })
  return true
}
async function nativePicker(file) {
  try {
    await ui.picker(file)
  } catch (error) {
    if (!String(error).includes('Timeout: normal GTK picker closed')) throw error
    const id = x('search', '--onlyvisible', '--name', '^Open File$').split('\n').at(-1)
    assert(nativeWindowVisible(id), 'Timed out picker is still the real Open File dialog')
    await record('gtk-open-picker-confirmation-retry', { file, error: String(error), window: id })
    await dismissGtkReadError('open-confirmation')
    for (let attempt = 0; attempt < 3 && nativeWindowVisible(id); attempt++) {
      const geometry = x('getwindowgeometry', '--shell', id)
      const width = Number(/WIDTH=(\d+)/.exec(geometry)[1])
      const height = Number(/HEIGHT=(\d+)/.exec(geometry)[1])
      x(
        'windowfocus',
        '--sync',
        id,
        'mousemove',
        '--window',
        id,
        String(width - 45),
        String(height - 24),
        'click',
        '1',
      )
      await app.delay(800)
      if (nativeWindowVisible(id)) await dismissGtkReadError('open-after-confirmation')
    }
    await app.until(() => !nativeWindowVisible(id), 'real GTK Open confirmation completed')
  }
}

async function closeNormally() {
  const id = ui.windowId()
  execFileSync(
    'python3',
    [
      '-c',
      `import ctypes,sys
x=ctypes.CDLL('libX11.so.6')
x.XOpenDisplay.restype=ctypes.c_void_p
x.XInternAtom.argtypes=[ctypes.c_void_p,ctypes.c_char_p,ctypes.c_int];x.XInternAtom.restype=ctypes.c_ulong
class E(ctypes.Structure):
 _fields_=[('type',ctypes.c_int),('serial',ctypes.c_ulong),('send_event',ctypes.c_int),('display',ctypes.c_void_p),('window',ctypes.c_ulong),('message_type',ctypes.c_ulong),('format',ctypes.c_int),('data',ctypes.c_long*5),('pad',ctypes.c_long*12)]
d=x.XOpenDisplay(None);e=E();e.type=33;e.display=d;e.window=int(sys.argv[1]);e.message_type=x.XInternAtom(d,b'WM_PROTOCOLS',0);e.format=32;e.data[0]=x.XInternAtom(d,b'WM_DELETE_WINDOW',0)
x.XSendEvent.argtypes=[ctypes.c_void_p,ctypes.c_ulong,ctypes.c_int,ctypes.c_long,ctypes.c_void_p];x.XFlush.argtypes=[ctypes.c_void_p]
x.XSendEvent(d,e.window,0,0,ctypes.byref(e));x.XFlush(d)
`,
      id,
    ],
    { env: process.env },
  )
  await app.until(
    () => {
      try {
        x('getwindowgeometry', id)
        return false
      } catch {
        return true
      }
    },
    'normal OS close completed',
    30000,
  )
  await app.close()
  app = undefined
}
async function installExternal() {
  await app.until(
    async () => (await registry()).length === expectedIds.length,
    'all ten distribution plugins registered',
    30000,
  )
  const installed = await registry()
  assert.deepEqual(
    installed.map((r) => r.id),
    expectedIds,
    'Production contains all ten plugins',
  )
  await shot('00-installed-distribution')
  for (const { id, archive } of packages) {
    await list()
    if (await ui.exists(action('details', id))) {
      await details(id)
      if (await ui.exists(action('disable', id))) await click(action('disable', id))
      await click(action('remove', id))
      await app.until(
        async () => !(await registry()).some((r) => r.id === id),
        'remove bundled ' + id,
      )
    }
    await list()
    await click('[data-plugin-action="install"]')
    await nativePicker(archive)
    await app.until(
      async () => (await registry()).some((r) => r.id === id && r.sourcePath === archive),
      'external install ' + id,
      30000,
    )
    await details(id)
    await shot('installed-' + id, { archive })
    if (await ui.exists(action('approve', id))) await click(action('approve', id))
    await click(action('enable', id))
    await ui.ready(action('disable', id))
    await shot('enabled-' + id)
  }
  await details('milkup.preferences')
  if (await ui.exists(action('approve', 'milkup.preferences')))
    await click(action('approve', 'milkup.preferences'))
  if (await ui.exists(action('enable', 'milkup.preferences')))
    await click(action('enable', 'milkup.preferences'))
  await closeUI()
}
async function seek(marker, mode) {
  await closeUI()
  await app.focus('.milkup-input-proxy')
  await app.key(mode === 'live' ? 'ctrl+2' : 'ctrl+1')
  await app.until(async () => (await app.probe()).mode === mode, 'mode ' + mode)
  const geometry = async (stage) => {
    if (traceEnabled)
      await app.execute(
        'window.__seekMarker=arguments[0];window.__seekGeometry(arguments[1])',
        marker,
        stage,
      )
  }
  await geometry('before-search')
  await app.key('ctrl+f')
  await ui.ready('[data-search-input]')
  await app.focus('[data-search-input]')
  await app.key('ctrl+a')
  await app.text(marker)
  await app.until(
    async () => {
      const p = await app.probe()
      return p.query === marker && !p.searching && /1/.test(p.count || '')
    },
    'unique sample search ' + marker,
    30000,
  )
  await geometry('before-escape')
  await app.key('Escape')
  await app.until(
    () =>
      app.execute('return !document.querySelector("[data-search-input]")?.getClientRects().length'),
    'search closed',
  )
  await geometry('after-escape')
  await app.focus('.milkup-input-proxy')
  await geometry('after-focus')
  // A selected marker immediately before a sample keeps its formula/graph inactive.
  await app.delay(200)
}
function matching(dom, sample, text) {
  const start = text.indexOf(sample.needle)
  return dom.previews.find((p) => p.from <= start && p.to > start)
}
function intersectsEditor(rect, dom) {
  const editor = dom.editorRect
  return (
    rect.bottom > Math.max(0, editor.top) &&
    rect.top < Math.min(dom.height, editor.bottom) &&
    rect.right > Math.max(0, editor.left) &&
    rect.left < Math.min(dom.width, editor.right)
  )
}
async function assertSample(sample, mode, text) {
  if (mode === 'source') {
    const dom = await observe()
    assert.equal(dom.previews.length, 0, 'Source never replaces Markdown')
    const sourceGeometry = await app.execute(
      'return [...document.querySelectorAll(".milkup-line")].filter(e=>e.textContent.includes(arguments[0])).map(e=>({text:e.textContent,rect:e.getBoundingClientRect().toJSON()}))',
      sample.marker,
    )
    assert(
      sourceGeometry.some(({ rect }) => intersectsEditor(rect, dom)),
      'Source marker intersects the actual editor viewport',
    )
    return { mode, sourceMarker: sample.marker, sourceGeometry }
  }
  let dom, preview
  await app.until(
    async () => {
      dom = await observe()
      preview = matching(dom, sample, text)
      return (
        preview &&
        (sample.kind === 'math'
          ? preview.math.some((m) => (sample.tag === 'mtable' ? m.tables.length : m.roots.length))
          : sample.kind === 'vector'
            ? preview.svg.length
            : preview.references.length)
      )
    },
    'live ' + sample.id + ' presentation',
    30000,
  )
  assert(preview.rect.width > 0 && preview.rect.height > 0)
  assert(intersectsEditor(preview.rect, dom), 'Preview intersects the actual editor viewport')
  assert(preview.label, 'Preview has accessible description')
  if (sample.kind === 'math')
    for (const math of preview.math) {
      assert.equal(math.namespace, 'http://www.w3.org/1998/Math/MathML')
      assert(math.rect.width > 0 && math.rect.height > 0)
      for (const root of math.roots) assert(root.width > 0 && root.height > 0)
      for (const table of math.tables) {
        assert.equal(table.rows.length, 2, 'Expected two real MathML matrix rows')
        for (const row of table.rows) {
          assert.equal(row.cells.length, 2)
          assert(row.cells.every((c) => c.width > 0 && c.height > 0))
          assert(row.cells[0].right <= row.cells[1].left + 1, 'Matrix columns do not overlap')
        }
        assert(table.rows[0].rect.top < table.rows[1].rect.top, 'MathML matrix row order')
      }
    }
  if (sample.kind === 'vector')
    for (const svg of preview.svg) {
      assert.equal(svg.namespace, 'http://www.w3.org/2000/svg')
      assert.equal(svg.unsafe, 0)
      assert(svg.texts.some((t) => t.text.includes(sample.label)))
      assert(
        svg.texts.every((t) => t.rect.width > 0 && t.rect.height > 0),
        'Real SVG text has glyph geometry',
      )
    }
  return { preview, fonts: dom.fonts }
}
async function visualMatrix() {
  for (const combination of matrixCases) {
    const { name, mode, theme, zoom, narrow, key } = combination
    await openDocument(name)
    x('windowsize', nativeWindow, narrow ? '760' : '1100', narrow ? '520' : '760')
    await appearance(theme, zoom)
    const before = await app.probe(),
      captures = []
    for (const sample of samples) {
      await seek(sample.marker, mode)
      const evidence = await assertSample(sample, mode, contents.get(name))
      const shotName = `matrix-${key}-${sample.id}`
      await shot(shotName, { combination, sample: sample.id, ...evidence })
      captures.push(shotName)
    }
    assert.equal((await app.probe()).version, before.version, 'Visual traversal does not edit')
    assert.deepEqual(
      (await observe()).diagnostics.errors,
      [],
      'No unhandled production errors during matrix case',
    )
    assert.deepEqual(await readFile(activeFile), Buffer.from(contents.get(name)))
    await record('matrix-complete-' + key, { combination, captures })
  }
  assert.equal(results.filter((r) => r.name.startsWith('matrix-complete-')).length, 64)
  assert.equal(
    results.filter((r) => r.name.startsWith('matrix-') && !r.name.startsWith('matrix-complete-'))
      .length,
    384,
  )
}
async function editHistory(name, mode, tag = 'editing') {
  await openDocument(name)
  await selectAt(mode, 'start')
  await app.key('ctrl+Home')
  const before = contents.get(name),
    insertion = 'EDIT-中文é🙂-'
  const release = await ownNativeClipboard(insertion)
  try {
    await app.key('ctrl+v')
    await app.until(async () => (await app.probe()).dirty, 'native Unicode edit')
  } finally {
    release()
  }
  await saved(insertion + before)
  await shot(`${tag}-${name}-${mode}-saved`, {
    bytes: Buffer.byteLength(insertion + before),
    sha256: hash(Buffer.from(insertion + before)),
  })
  await app.focus('.milkup-input-proxy')
  await app.key('ctrl+z')
  await saved(before)
  await shot(`${tag}-${name}-${mode}-undo`, { byteExact: true })
  await app.key('ctrl+shift+z')
  await saved(insertion + before)
  await shot(`${tag}-${name}-${mode}-redo`, { byteExact: true })
  await app.key('ctrl+z')
  await saved(before)
}
async function semantics(name) {
  await openDocument(name)
  await appearance('light', 1)
  x('windowsize', nativeWindow, '1100', '760')
  const text = contents.get(name)
  for (const id of ['root', 'flow']) {
    const sample = samples.find((s) => s.id === id)
    await seek(sample.marker, 'live')
    await assertSample(sample, 'live', text)
    const start = text.indexOf(sample.needle),
      selector = `[data-document-presentation][data-presentation-from="${start}"]`
    const version = (await app.probe()).version
    await click(selector)
    await app.until(
      () => app.execute('return !document.querySelector(arguments[0])', selector),
      'click preview reveals editable source',
    )
    if (diagnosticInstall && process.env.MILKUP_NATIVE_DIAGNOSTIC_SOURCE === '1') {
      const geometry = async () =>
        app.execute(`
const rect=e=>e?.getBoundingClientRect().toJSON(),editor=document.querySelector('.milkup-editor');
return {editor:{rect:rect(editor),clientTop:editor.clientTop,clientHeight:editor.clientHeight,scrollTop:editor.scrollTop},lines:[...document.querySelectorAll('.milkup-line')].filter(e=>e.textContent.includes('frac')).map(e=>({rect:rect(e),text:e.textContent,dataset:{...e.dataset},lineHeight:getComputedStyle(e).lineHeight,padding:getComputedStyle(e).padding})),cursor:[...document.querySelectorAll('.milkup-cursor')].map(e=>({rect:rect(e),dataset:{...e.dataset}})),selection:[...document.querySelectorAll('.milkup-selection')].map(e=>({rect:rect(e),dataset:{...e.dataset}})),proxy:rect(document.querySelector('.milkup-input-proxy')),active:document.activeElement?.className}
`)
      const immediate = await geometry()
      await app.delay(1000)
      const settled = await geometry()
      await writeFile(
        path.join(output, 'source-reveal-geometry.json'),
        JSON.stringify({ immediate, settled }, null, 2),
      )
      await shot(`${name}-${id}-source-reveal-diagnostic`)
      return
    }
    assert.equal((await app.probe()).version, version)
    let sourceGeometry
    if (id === 'root') {
      await app.delay(200)
      sourceGeometry = await app.execute(
        `
const rect=e=>e.getBoundingClientRect().toJSON(),editor=document.querySelector('.milkup-editor');
return {editor:rect(editor),line:[...document.querySelectorAll('.milkup-line')].filter(e=>Number(e.dataset.from)<=arguments[0]&&Number(e.dataset.to)>arguments[0]).map(e=>({rect:rect(e),text:e.textContent})),cursor:[...document.querySelectorAll('.milkup-cursor')].map(rect),selection:[...document.querySelectorAll('.milkup-selection')].map(rect)}
`,
        start,
      )
      const inside = (r) =>
        r.top >= sourceGeometry.editor.top - 0.5 &&
        r.bottom <= sourceGeometry.editor.bottom + 0.5 &&
        r.left >= sourceGeometry.editor.left - 0.5 &&
        r.right <= sourceGeometry.editor.right + 0.5
      assert(
        sourceGeometry.line.length > 0 &&
          sourceGeometry.line.every((l) => l.rect.height <= 128 && inside(l.rect)),
        'Short revealed formula source line must be fully visible in editor',
      )
      assert(
        sourceGeometry.cursor.length > 0 && sourceGeometry.cursor.every(inside),
        'Revealed formula caret must be fully visible in editor',
      )
      assert(
        sourceGeometry.selection.every(inside),
        'Revealed formula selection must be fully visible in editor',
      )
    }
    await shot(`${name}-${id}-source-revealed`, {
      start,
      versionUnchanged: true,
      activation: 'native-pointer',
      sourceGeometry,
    })
    await seek(sample.marker, 'live')
    await assertSample(sample, 'live', text)
    if (id === 'flow') {
      await app.focus(selector)
      await app.key('Tab')
      await app.key('shift+Tab')
      await app.until(
        () => app.execute('return document.activeElement?.matches(arguments[0])', selector),
        'native keyboard returns to graph',
      )
      await shot(`${name}-graph-keyboard-focus`)
      await app.key('Return')
      await app.until(
        () => app.execute('return !document.querySelector(arguments[0])', selector),
        'Enter reveals graph source',
      )
      assert.equal((await app.probe()).version, version)
    }
  }
  await seek('SAMPLE-FOOTNOTES', 'live')
  await assertSample(samples.at(-1), 'live', text)
  const version = (await app.probe()).version,
    reference = text.indexOf('[^note]'),
    definition = text.indexOf('[^note]:')
  const refSelector = `[data-document-presentation][data-presentation-from="${reference}"] .milkup-document-reference`
  await app.focus(refSelector)
  await app.key('Tab')
  await app.key('shift+Tab')
  await app.until(
    () => app.execute('return document.activeElement?.matches(arguments[0])', refSelector),
    'native Tab returns to footnote reference',
  )
  await shot(`${name}-footnote-keyboard-focus`)
  await app.key('Return')
  await app.until(async () => {
    const p = await app.probe()
    return p.cursor >= definition && p.cursor <= definition + 150
  }, 'footnote definition navigation')
  assert.equal((await app.probe()).version, version)
  await shot(`${name}-footnote-definition`)
  await app.key('Right')
  await app.key('Down')
  const back = `[data-document-presentation][data-presentation-from="${definition}"] .milkup-document-reference`
  await ui.ready(back)
  await click(back)
  await app.until(async () => {
    const p = await app.probe()
    return p.cursor >= reference && p.cursor <= reference + 8
  }, 'footnote return navigation')
  assert.equal((await app.probe()).version, version)
  await shot(`${name}-footnote-return`)
  await seek('SAMPLE-ERRORS', 'live')
  await app.until(
    () =>
      app.execute(
        'return document.querySelector(".milkup-editor").textContent.includes("notACommand")',
      ),
    'invalid formula retains source',
  )
  assert.equal((await app.probe()).version, version)
  await shot(`${name}-invalid-source-fallback`)
  await seek('SAMPLE-CODE', 'live')
  const state = await observe(),
    codeStart = text.indexOf('`$notMath$`')
  assert(
    !state.previews.some((p) => p.from >= codeStart),
    'Opaque code/link destinations remain literal',
  )
  await shot(`${name}-opaque-context-source`)
  assert.deepEqual(await readFile(activeFile), Buffer.from(text))
}
async function remoteFootnote() {
  const name = 'windowed',
    text = contents.get(name)
  await openDocument(name)
  await app.execute(
    await readFile(
      '/workspace/milkup-markdown-extensions-phase4-evidence/native/far-geometry/install-observer.js',
      'utf8',
    ),
  )
  await app.execute('window.__armFarGeometry()')
  await seek('SAMPLE-REMOTE-FOOTNOTE', 'live')
  const reference = text.lastIndexOf('[^note]'),
    definition = text.indexOf('[^note]:')
  assert(reference > 4_000_000, 'Reference must use the actual distant UTF-16 path')
  const refSelector = `[data-document-presentation][data-presentation-from="${reference}"] .milkup-document-reference`
  await app.until(
    () => app.execute('return !!document.querySelector(arguments[0])', refSelector),
    'far reference prepared after bounded index/context scans',
    90000,
  )
  const before = await app.probe()
  assert.equal(before.dirty, false)
  await app.focus(refSelector)
  await app.key('Tab')
  await app.key('shift+Tab')
  await app.until(
    () => app.execute('return document.activeElement?.matches(arguments[0])', refSelector),
    'far reference native keyboard focus',
  )
  await shot('windowed-far-reference-ready', {
    reference,
    definition,
    distance: reference - definition,
  })
  await app.key('Return')
  await app.until(
    async () => {
      const p = await app.probe()
      return p.cursor >= definition && p.cursor <= definition + 150
    },
    'far reference navigates to first definition',
    90000,
  )
  assert.equal((await app.probe()).version, before.version)
  await shot('windowed-far-reference-definition')
  await app.key('Right')
  await app.key('Down')
  const group = `[data-document-presentation][data-presentation-from="${definition}"]`
  await app.until(
    () =>
      app.execute(
        'return [...document.querySelectorAll(arguments[0]+" .milkup-document-reference")].some(b=>b.textContent==="返回引用 3")',
        group,
      ),
    'third return link available',
    90000,
  )
  const returns = await app.execute(
    'return [...document.querySelectorAll(arguments[0]+" .milkup-document-reference")].map(b=>b.textContent)',
    group,
  )
  assert.deepEqual(returns, ['返回引用 1', '返回引用 2', '返回引用 3'])
  const back = group + ' .milkup-document-reference:nth-of-type(3)'
  await click(back)
  await app.until(
    async () => {
      const p = await app.probe()
      return p.cursor >= reference && p.cursor <= reference + 8
    },
    'third return navigates back to far tail',
    90000,
  )
  assert.equal((await app.probe()).version, before.version)
  assert.equal((await app.probe()).dirty, false)
  assert.deepEqual(await readFile(activeFile), Buffer.from(text))
  await shot('windowed-far-reference-return', {
    reference,
    definition,
    versionUnchanged: true,
    byteExact: true,
    sha256: hash(Buffer.from(text)),
  })
  // The following source/live editHistory tests one undo/redo transaction against
  // these same full bytes; navigation must not create a competing undo entry.
}
async function allDisabled(label) {
  const records = await registry()
  assert.deepEqual(
    records.map((r) => r.id),
    expectedIds,
  )
  assert(
    records.every((r) => r.enabled === false && r.state !== 'active'),
    label + ': all ten disabled',
  )
  assert.equal((await observe()).previews.length, 0, label + ': no document plugin previews')
}
async function disableAndRecover() {
  await appearance('light', 1)
  x('windowsize', nativeWindow, '1100', '760')
  for (const id of expectedIds) {
    await details(id)
    if (await ui.exists(action('disable', id))) await click(action('disable', id))
  }
  await closeUI()
  await allDisabled('disabled')
  await shot('all-ten-disabled')
  for (const name of ['ordinary', 'windowed']) await editHistory(name, 'source', 'all-disabled')
  await openDocument('ordinary')
  await closeNormally()
  await start(path.join(output, 'ordinary.md'))
  await allDisabled('after normal reopen')
  await shot('all-ten-disabled-reopened')
  await selectAt('source', 'start')
  await app.key('ctrl+Home')
  await app.text('RECOVER-')
  await app.until(
    () =>
      app.execute(
        'return document.querySelector("#app").dataset.recoveryPhase==="ready"&&Number(document.querySelector("#app").dataset.recoveryVersion)===Number(document.querySelector("[data-stat=version]").textContent)',
      ),
    'durable recovery checkpoint',
    30000,
  )
  const file = activeFile,
    before = contents.get('ordinary'),
    candidates = []
  for (const name of await readdir(process.env.MILKUP_RECOVERY_PROFILE))
    try {
      const directory = path.join(process.env.MILKUP_RECOVERY_PROFILE, name),
        manifest = JSON.parse(await readFile(path.join(directory, 'manifest.json'), 'utf8'))
      if (manifest.originalPath === file && manifest.disposition === 'pending')
        candidates.push({ ...manifest, directory })
    } catch {}
  const checkpoint = candidates.sort((a, b) => b.createdAt - a.createdAt)[0]
  assert(checkpoint)
  assert.deepEqual(
    await readFile(path.join(checkpoint.directory, checkpoint.payload)),
    Buffer.from('RECOVER-' + before),
  )
  assert.deepEqual(await readFile(file), Buffer.from(before))
  await shot('all-ten-disabled-before-sigkill', { checkpoint: checkpoint.id })
  const owner = await ownedApplication(app.application, launchFile),
    termination = await owner.signal('SIGKILL')
  await app.close()
  app = undefined
  await start(file)
  await allDisabled('after SIGKILL')
  const restore = `[data-recovery-restore="${checkpoint.id}"]`
  await ui.ready(restore)
  await shot('all-ten-disabled-recovery-offered', { termination })
  await click(restore)
  await app.until(
    async () => {
      const p = await app.probe()
      return p.loading === 'ready' && p.path.includes('/copies/recovered-')
    },
    'host recovered copy',
    30000,
  )
  const recovered = (await app.probe()).path
  assert.deepEqual(await readFile(recovered), Buffer.from('RECOVER-' + before))
  assert.deepEqual(await readFile(file), Buffer.from(before))
  await allDisabled('recovered')
  await shot('all-ten-disabled-recovered', {
    recovered,
    originalPreserved: true,
    recoveredSha256: hash(await readFile(recovered)),
  })
}
try {
  await start()
  await installExternal()
  await remoteFootnote()
  await record('FAR-GEOMETRY-DIAGNOSTIC-COMPLETE', { diagnosticOnly: true, acceptance: false })
} catch (error) {
  await writeFile(
    path.join(output, 'failure.json'),
    JSON.stringify({ error: String(error), stack: error.stack }, null, 2),
  )
  if (app) await shot('FAIL', { error: String(error) }).catch(() => {})
  throw error
} finally {
  if (app) {
    await writeFile(
      path.join(output, 'far-geometry.json'),
      JSON.stringify(
        await app
          .execute('return window.__farGeometry')
          .catch((error) => ({ error: String(error) })),
        null,
        2,
      ),
    )
    await app.close()
  }
}

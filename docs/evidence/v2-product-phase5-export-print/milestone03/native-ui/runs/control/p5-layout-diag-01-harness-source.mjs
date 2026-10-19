// P5 production acceptance. Reuses the P4 native harness; never dispatches private IPC.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { access, mkdir, readFile, writeFile, realpath } from 'node:fs/promises'
import path from 'node:path'
import { startProduction } from '../helpers/native-production.mjs'
import { nativeFixture, action, writeLogoFixture, x } from '../helpers/native-updates-fixture.mjs'

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex')
const output = path.resolve(process.env.MILKUP_NATIVE_EVIDENCE_DIR || '')
assert(process.env.MILKUP_NATIVE_EVIDENCE_DIR, 'Set a fresh P5 evidence directory')
assert(process.env.MILKUP_P5_ARCHIVE, 'Supply an independent output plugin archive')
const archive = await realpath(process.env.MILKUP_P5_ARCHIVE)
const archiveBytes = await readFile(archive)
assert.equal(hash(archiveBytes), process.env.MILKUP_P5_ARCHIVE_SHA256, 'Reviewed archive hash')
const bundle = JSON.parse(archiveBytes)
assert.equal(bundle.manifest.id, 'milkup.export-print')
assert.equal(bundle.manifest.version, '1.0.0')
assert.equal(bundle.manifest.engines.pluginSdk, '^0.3.5')
assert.deepEqual(bundle.manifest.permissions, ['document:read', 'document:output'])
assert(!archive.startsWith(path.resolve('plugins') + path.sep), 'Use the independent build')
const stage = process.env.MILKUP_P5_STAGE || 'html'
assert(
  [
    'html',
    'pdf',
    'cancel',
    'selection',
    'disable',
    'print-cancel',
    'print-file',
    'overwrite',
    'large',
  ].includes(stage),
)
const rich = ['html', 'pdf', 'print-file'].includes(stage)
const bundledRich = rich && process.env.MILKUP_P5_BUNDLED_RICH === '1'
const diagramArchive =
  '/workspace/milkup-mermaid-engine-evidence/research/renderer-exact-memo-product-integration-01/artifacts/milkup.diagrams-1.1.1.milkup-plugin'
const diagramSha256 = '2351692438a2083a72bcb8cddce28c7a530a8557734926992a3a2e3120c68a19'
if (rich && !bundledRich)
  assert.equal(hash(await readFile(diagramArchive)), diagramSha256, 'Reviewed renderer archive')
await mkdir(output, { recursive: true })
const fixture = await readFile(
  new URL('../fixtures/p5-output/rich-document.md', import.meta.url),
  'utf8',
)
const source =
  stage === 'pdf' || stage === 'print-file'
    ? fixture +
      '\n\n' +
      Array.from(
        { length: 100 },
        (_, i) =>
          `第 ${i + 1} 段分页检查 P5-PAGE-${i + 1}：中文排版、表格与代码之后的正文需要保持可读。\n\n`,
      ).join('')
    : stage === 'large'
      ? fixture + '\n\n大文档中文行 P5-LARGE-LINE\n'.repeat(60000)
      : fixture
const sourcePath = path.join(output, 'source.md')
const launcherPath = path.join(output, 'launcher.md')
await writeFile(launcherPath, '# P5 output installation\n', { flag: 'wx' })
await writeFile(sourcePath, source, { flag: 'wx' })
await writeLogoFixture(output)
await mkdir(path.join(output, 'assets'), { recursive: true })
await writeFile(
  path.join(output, 'assets', 'logo-fixture.png'),
  await readFile(path.join(output, 'logo-fixture.png')),
)
const originalHash = hash(Buffer.from(source))
const plan = {
  preparedOnly: process.argv.includes('--preflight'),
  stage,
  sourcePath,
  sourceSha256: originalHash,
  sourceBytes: Buffer.byteLength(source),
  sourceUtf16: source.length,
  sourceLines: source.split('\n').length,
  archive,
  archiveSha256: hash(archiveBytes),
  manifest: bundle.manifest,
  rendererMode: rich
    ? bundledRich
      ? 'bundled 1.1.0 (independent 1.1.1 failure tracked separately)'
      : 'independent 1.1.1'
    : 'disabled fallback',
  richRenderers: rich
    ? {
        diagramArchive,
        diagramSha256,
        required: ['milkup.math', 'milkup.footnotes', 'milkup.diagrams'],
      }
    : 'explicitly disabled source fallback',
  cases: [
    'html offline with images',
    'html omitted images',
    'actual A4 and Letter PDF',
    'native print-to-file PDF',
    'chooser and print cancellation',
    'source overwrite refusal',
    'existing output overwrite refusal/confirmation',
    'selection and captured version',
    'disabled plugin edit/undo/save',
    'large file',
  ],
  limitations: [
    'Snapshots of GTK dialogs do not prove PDF output quality.',
    'Selection stage attempts genuine foreground edits while the independent chooser is open; its recorded result determines native race coverage.',
    'Formula/Mermaid rendering and pagination need inspection of actual output, not marker presence.',
  ],
}
await writeFile(path.join(output, 'plan.json'), JSON.stringify(plan, null, 2) + '\n')
if (process.argv.includes('--preflight')) {
  console.log('PREPARED P5 fixture and plan; no native application or driver started')
  process.exit(0)
}
assert.equal(
  process.env.MILKUP_P5_BINARY_CONFIRMED,
  '1',
  'Wait for Root-confirmed integrated Linux build',
)
assert(process.env.TAURI_APP_PATH && process.env.TAURI_DRIVER_URL && process.env.DISPLAY)
assert.equal(process.env.MILKUP_NATIVE_EXCLUSIVE_DISPLAY, '1')
assert(process.env.MILKUP_NATIVE_PROFILE_ROOT, 'Use a disposable native profile')
for (const key of ['XDG_DATA_HOME', 'XDG_CONFIG_HOME', 'XDG_CACHE_HOME'])
  assert(
    process.env[key]?.startsWith(process.env.MILKUP_NATIVE_PROFILE_ROOT + '/'),
    `${key} is outside the test profile`,
  )
const binary = await realpath(process.env.TAURI_APP_PATH)
assert(!binary.includes('/target/'), 'Use a frozen binary copy')
assert.equal(hash(await readFile(binary)), process.env.MILKUP_NATIVE_EXPECTED_BINARY_SHA256)
await writeFile(
  path.join(output, 'provenance.json'),
  JSON.stringify(
    {
      ...plan,
      preparedOnly: false,
      binary,
      binarySha256: process.env.MILKUP_NATIVE_EXPECTED_BINARY_SHA256,
      display: process.env.DISPLAY,
      driver: process.env.TAURI_DRIVER_URL,
      profile: process.env.MILKUP_NATIVE_PROFILE_ROOT,
      sourceHead: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    },
    null,
    2,
  ) + '\n',
)

const id = 'milkup.export-print',
  panel = '[data-plugin-ui="milkup.export-print:export-print-panel"]'
let app
let layoutStatus = 'not-run'
const ui = nativeFixture(() => app),
  results = []
const panelText = () =>
  app.execute('return document.querySelector(arguments[0])?.textContent || ""', panel)
async function record(name, extra = {}) {
  assert.equal(hash(await readFile(sourcePath)), originalHash, 'Source file unchanged')
  results.push({
    name,
    at: new Date().toISOString(),
    sourceSha256: originalHash,
    sourceBytes: Buffer.byteLength(source),
    sourceUtf16: source.length,
    sourceLines: source.split('\n').length,
    document: await app.probe(),
    registry: await app.execute(
      "return JSON.parse(localStorage.getItem('milkup.desktop.plugins.registry.v1')||'{\"records\":[]}').records.filter(r=>['milkup.math','milkup.footnotes','milkup.diagrams','milkup.export-print'].includes(r.manifest.id)).map(r=>({id:r.manifest.id,version:r.manifest.version,state:r.state,enabled:r.enabled,sourcePath:r.sourcePath}))",
    ),
    panel: await panelText(),
    ...extra,
  })
  await writeFile(path.join(output, 'results.json'), JSON.stringify(results, null, 2) + '\n')
  await app.shot(name)
  console.log('PASS ' + name)
}
const visibleWindow = (title) => {
  try {
    return x('search', '--onlyvisible', '--name', '^' + title + '$')
      .split('\n')
      .at(-1)
  } catch {
    return null
  }
}
async function waitDialog(title) {
  const window = await app.until(() => visibleWindow(title), title, 45000)
  x('windowfocus', '--sync', window)
  await app.delay(500)
  return window
}
async function savePath(file) {
  const window = await waitDialog('Choose output destination')
  const pid = x('getwindowpid', window).trim()
  execFileSync('import', ['-window', window, path.join(output, 'save-dialog.png')])
  x('key', '--clearmodifiers', 'ctrl+l')
  await app.delay(150)
  x('key', '--clearmodifiers', 'ctrl+a')
  x('type', '--clearmodifiers', '--delay', '2', '--', file)
  await app.delay(250)
  execFileSync('import', ['-window', window, path.join(output, 'save-path-entered.png')])
  const geometry = x('getwindowgeometry', '--shell', window)
  const width = Number(/WIDTH=(\d+)/.exec(geometry)[1]),
    height = Number(/HEIGHT=(\d+)/.exec(geometry)[1])
  x('mousemove', '--window', window, String(width - 50), String(height - 24), 'click', '1')
  await app.until(() => !visibleWindow('Choose output destination'), 'output picker closed')
  return { pid }
}
async function confirmOverwrite(pid, accept) {
  const window = await app.until(() => {
    try {
      return x('search', '--onlyvisible', '--pid', pid).trim().split('\n').at(-1)
    } catch {
      return null
    }
  }, 'native overwrite confirmation')
  x('windowfocus', '--sync', window)
  execFileSync('import', [
    '-window',
    window,
    path.join(output, accept ? 'overwrite-confirm-yes.png' : 'overwrite-confirm-no.png'),
  ])
  x('key', '--clearmodifiers', accept ? 'alt+y' : 'alt+n')
}

async function pointerClick(selector) {
  const sample = () =>
    app.execute(
      'const e=document.querySelector(arguments[0]),r=e.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2,w:innerWidth,h:innerHeight,hit:e.contains(document.elementFromPoint(r.left+r.width/2,r.top+r.height/2))}',
      selector,
    )
  let r = await sample()
  if (!r.hit || r.x < 0 || r.y < 0 || r.x >= r.w || r.y >= r.h) {
    await app.focus(selector)
    r = await sample()
  }
  assert(
    r.hit && r.x >= 0 && r.y >= 0 && r.x < r.w && r.y < r.h,
    'Visible native pointer target ' + selector,
  )
  const window = ui.windowId(),
    scale = Number(/WIDTH=(\d+)/.exec(x('getwindowgeometry', '--shell', window))[1]) / r.w
  x(
    'mousemove',
    '--window',
    window,
    String(Math.round(r.x * scale)),
    String(Math.round(r.y * scale)),
    'click',
    '1',
  )
}
async function openDocument(file) {
  await ui.closeMenu()
  await ui.click('[data-menu-toggle]')
  await ui.click('[data-menu-section="file"]')
  await ui.click('[data-command="open-sample"]')
  await ui.picker(file)
  await app.until(async () => (await app.probe()).path === file, 'opened document ' + file)
}

async function openPanel() {
  await ui.closeMenu()
  if (
    !(await app.execute(
      'return document.querySelector("[data-sidebar-toggle]")?.getAttribute("aria-pressed")==="true"',
    ))
  )
    await ui.click('[data-sidebar-toggle]')
  await app.until(
    () => app.execute('return document.querySelector("#app")?.dataset.sidebarCollapsed==="false"'),
    'sidebar opened',
  )
  const toggle = panel + ' .plugin-ui-panel-toggle'
  await ui.ready(toggle)
  if (
    await app.execute(
      'return document.querySelector(arguments[0])?.getAttribute("aria-expanded")==="false"',
      toggle,
    )
  )
    await ui.click(toggle)
  await ui.ready(panel + ' [data-plugin-command="exportPrint.start"]')
}

async function setField(key, value) {
  const selector = `${panel} [data-plugin-field-control="${key}"]`
  await ui.ready(selector)
  await app.focus(selector)
  const options = await app.execute(
    'return [...document.querySelector(arguments[0]).options].map(o=>o.value)',
    selector,
  )
  const index = options.indexOf(value)
  assert(index >= 0)
  await app.key('Home')
  for (let i = 0; i < index; i++) await app.key('Down')
  await app.key('Tab')
  await app.until(
    () =>
      app.execute(
        'return document.querySelector(arguments[0])?.value===arguments[1]',
        selector,
        value,
      ),
    'field ' + key,
  )
}
async function startOutput() {
  const retry = `${panel} [data-plugin-command="exportPrint.retry"]`
  await ui.click(
    (await ui.exists(retry)) ? retry : `${panel} [data-plugin-command="exportPrint.start"]`,
  )
}
async function done() {
  await app.until(
    async () => {
      const text = await panelText()
      const error = await app.execute(
        'return document.querySelector(arguments[0]+" [role=alert]")?.textContent || ""',
        panel,
      )
      if (error) throw Error('Visible output error: ' + error)
      return /已保存|已提交打印/.test(text)
    },
    'output committed',
    stage === 'large' ? 180000 : 90000,
  )
}
async function verifyHtml(file, includeImages = true, selection = false) {
  const bytes = await readFile(file),
    html = bytes.toString('utf8')
  assert.match(html, /<!doctype html>/i)
  assert.match(html, /中文/)
  assert(!/<script\b|<iframe\b|\bon(?:load|error)\s*=/i.test(html))
  assert(
    !/(?:src|href)=["']https?:/i.test(html),
    'Offline artifact does not reference remote resources',
  )
  assert((await panelText()).includes('版本'), 'Captured version remains visible')
  if (selection) assert(!html.includes('P5-END-MARKER'))
  else {
    assert(
      /图片.*(省略|缺失|内嵌)|省略图片/.test(await panelText()),
      'Resource warnings remain visible',
    )
    for (const marker of [
      'P5-ORIGINAL-BODY',
      'P5-CODE-MARKER',
      'P5-FOOTNOTE-MARKER',
      'P5-END-MARKER',
    ])
      assert(html.includes(marker), marker)
    assert.match(html, /<table\b/)
    assert.match(html, /<pre\b/)
    if (rich) {
      assert((html.match(/<math\b/g) ?? []).length >= 2, 'Actual inline and display MathML')
      assert.match(html, /<svg\b[^>]*viewBox=/, 'Actual inert diagram SVG')
      assert.match(html, /id="export-svg-/, 'Diagram uses isolated export SVG IDs')
      assert(!/<foreignObject\b/i.test(html), 'No active foreign object in portable SVG')
      const references = [...html.matchAll(/href="#source-(\d+)"/g)]
      assert(references.length >= 2, 'Footnote forward and back links')
      for (const ref of references)
        assert(html.includes(`id="source-${ref[1]}"`), 'Footnote anchor resolves')
      assert(!html.includes('flowchart LR'), 'Diagram is not source fallback')
    } else {
      assert(html.includes('flowchart LR'), 'Disabled renderer preserves readable source')
      assert(!html.includes('<math'), 'Fallback is not advertised as rendered math')
    }
    assert.equal(/data:image\/png;base64,/.test(html), includeImages)
  }
  await record(path.basename(file), { file, sha256: hash(bytes), bytes: bytes.length })
}
async function verifyPdf(file, landscape) {
  const bytes = await readFile(file)
  assert(bytes.subarray(0, 5).equals(Buffer.from('%PDF-')))
  assert(bytes.subarray(-1024).includes(Buffer.from('%%EOF')))
  const info = execFileSync('pdfinfo', [file], { encoding: 'utf8' })
  const rawText = execFileSync('pdftotext', ['-layout', file, '-'], { encoding: 'utf8' })
  const text = rawText.normalize('NFKC')
  await writeFile(file + '.info.txt', info)
  await writeFile(file + '.text.txt', rawText)
  await writeFile(file + '.normalized.txt', text)
  const pages = Number(/^Pages:\s+(\d+)/m.exec(info)?.[1])
  assert(pages >= 2, 'Actual multipage PDF')
  assert.match(text, /中文/)
  assert(text.includes('P5-END-MARKER'))
  assert(text.includes('P5-CODE-MARKER'))
  if (rich) {
    await writeFile(
      file + '.diagram-text.json',
      JSON.stringify(
        {
          complete: text.includes('中文输入') && text.includes('冻结内容'),
          expected: ['中文输入', '冻结内容'],
          visibleDiagramReview:
            'pending actual PDF page review; text extraction is not a pixel assertion',
          knownBoundary:
            'Native PDF01 all-page review confirmed complete visible labels despite incomplete ToUnicode extraction',
        },
        null,
        2,
      ) + '\n',
    )
    assert(text.includes('P5-FOOTNOTE-MARKER'))
  }
  const textChecks = {
    diagramLabels: !rich || (text.includes('中文输入') && text.includes('冻结内容')),
    codeQuotes: text.includes("const message = '中文代码 P5-CODE-MARKER'"),
    emoji: text.includes('👩🏽‍💻'),
  }
  await writeFile(
    file + '.copy-search.json',
    JSON.stringify(
      {
        passed: Object.values(textChecks).every(Boolean),
        checks: textChecks,
        normalization: 'NFKC only for compatibility glyphs; missing glyphs are not repaired',
        visualReview: 'independent',
      },
      null,
      2,
    ) + '\n',
  )
  const dims = /^Page size:\s+([\d.]+) x ([\d.]+)/m.exec(info)
  assert(dims)
  assert.equal(Number(dims[1]) > Number(dims[2]), landscape)
  const expectedSize = landscape ? [792, 612] : [595.28, 841.89]
  assert(
    Math.abs(Number(dims[1]) - expectedSize[0]) < 1 &&
      Math.abs(Number(dims[2]) - expectedSize[1]) < 1,
    'Requested A4/Letter physical page size',
  )
  execFileSync('pdftoppm', [
    '-f',
    '1',
    '-singlefile',
    '-scale-to',
    '1400',
    '-png',
    file,
    file + '-first',
  ])
  execFileSync('pdftoppm', [
    '-f',
    String(pages),
    '-singlefile',
    '-scale-to',
    '1400',
    '-png',
    file,
    file + '-last',
  ])
  await record(path.basename(file), {
    file,
    sha256: hash(bytes),
    bytes: bytes.length,
    pages,
    visualReview: 'pending actual first/last page and document review',
  })
}

async function observeNativeErrors() {
  if (!rich) return
  // Root-authorized observation only: exact original calls, arguments and callbacks are forwarded.
  await app.execute(`
const api=window.__TAURI_INTERNALS__, records=[]; window.__p5NativeErrors=records;
const record=(kind,value)=>{if(records.length<100) records.push({kind,value,time:Date.now()})};
const invoke=api.invoke;
api.invoke=function(...args){let result;try{result=Reflect.apply(invoke,this,args)}catch(error){record('invoke-throw',{command:args[0],error});throw error}return result.catch(error=>{record('invoke-reject',{command:args[0],error});throw error})};
const transform=api.transformCallback;
api.transformCallback=function(callback,...rest){return Reflect.apply(transform,this,[function(...args){try{const text=JSON.stringify(args);if(args[0]?.event==='milkup-plugin-dom-message'&&/error|fail|denied/i.test(text))record('callback',text.slice(0,8000))}catch{}return Reflect.apply(callback,this,args)},...rest])};
`)
}
async function setTheme(theme) {
  await ui.details('milkup.preferences')
  if (await ui.exists(action('approve', 'milkup.preferences')))
    await ui.click(action('approve', 'milkup.preferences'))
  if (await ui.exists(action('enable', 'milkup.preferences')))
    await ui.click(action('enable', 'milkup.preferences'))
  await ui.click(action('open-ui', 'milkup.preferences'))
  const preferences = '[data-plugin-ui="milkup.preferences:preferences-panel"]'
  const selector = preferences + ' [data-plugin-field-control="appearance.theme"]'
  await ui.ready(selector)
  await app.focus(selector)
  const options = await app.execute(
    'return [...document.querySelector(arguments[0]).options].map(o=>o.value)',
    selector,
  )
  const index = options.indexOf(theme)
  assert(index >= 0)
  await app.key('Home')
  for (let i = 0; i < index; i++) await app.key('Down')
  await app.key('Tab')
  await app.until(
    () =>
      app.execute(
        'return document.querySelector(arguments[0])?.value===arguments[1]',
        selector,
        theme,
      ),
    'theme option applied',
  )
  await app.delay(300)
  await app.focus(preferences + ' button[aria-label="保存"]')
  await app.key('Return')
  await app.until(
    () =>
      app.execute(
        'return document.querySelector(arguments[0])?.textContent.includes("偏好已保存")',
        preferences,
      ),
    'theme saved',
  )
  await ui.click(preferences + ' .plugin-ui-close')
  await app.until(
    () => app.execute('return document.documentElement.dataset.theme===arguments[0]', theme),
    'theme applied',
  )
}

async function controlBounds(selector) {
  return app.execute(
    `const e=document.querySelector(arguments[0]),r=e.getBoundingClientRect(),inset=Math.min(10,r.width/4,r.height/4),points=[[r.left+inset,r.top+inset],[r.right-inset,r.top+inset],[r.left+inset,r.bottom-inset],[r.right-inset,r.bottom-inset],[r.right-inset,r.top+r.height/2]],nodes=points.map(([x,y])=>document.elementFromPoint(x,y)),hits=nodes.map(n=>e.contains(n)),ancestors=[];
for(let p=e.parentElement;p;p=p.parentElement){const c=getComputedStyle(p);if(/auto|scroll|hidden|clip/.test(c.overflowX+' '+c.overflowY))ancestors.push({tag:p.tagName,className:p.className,rect:p.getBoundingClientRect().toJSON(),clientWidth:p.clientWidth,offsetWidth:p.offsetWidth,scrollWidth:p.scrollWidth,scrollLeft:p.scrollLeft,clientHeight:p.clientHeight,scrollHeight:p.scrollHeight,scrollTop:p.scrollTop,overflowX:c.overflowX,overflowY:c.overflowY})}
return {selector:arguments[0],focused:document.activeElement===e,rect:r.toJSON(),viewport:{width:innerWidth,height:innerHeight},visualViewport:visualViewport?{width:visualViewport.width,height:visualViewport.height,offsetLeft:visualViewport.offsetLeft,offsetTop:visualViewport.offsetTop,scale:visualViewport.scale}:null,cornerHits:hits,cornerElements:nodes.map(n=>n?{tag:n.tagName,className:n.className,id:n.id,rect:n.getBoundingClientRect().toJSON()}:null),clippingAncestors:ancestors,visible:r.width>0&&r.height>0&&r.left>=-2&&r.top>=-2&&r.right<=innerWidth+2&&r.bottom<=innerHeight+2&&hits.every(Boolean)}`,
    selector,
  )
}
async function exerciseNativeSelect(selector, name) {
  const initial = await controlBounds(selector)
  const state = await app.execute(
    'const e=document.querySelector(arguments[0]);return {value:e.value,options:[...e.options].map(o=>o.value)}',
    selector,
  )
  const geometry = x('getwindowgeometry', '--shell', ui.windowId()),
    width = Number(/WIDTH=(\d+)/.exec(geometry)[1]),
    height = Number(/HEIGHT=(\d+)/.exec(geometry)[1])
  x('mousemove', '--window', ui.windowId(), String(width - 30), String(height - 80))
  await app.delay(1400)
  const settled = await controlBounds(selector)
  await app.shot(name + '-focused')
  const scale = width / settled.viewport.width
  x(
    'mousemove',
    '--window',
    ui.windowId(),
    String(Math.round((settled.rect.right - 18) * scale)),
    String(Math.round((settled.rect.top + settled.rect.height / 2) * scale)),
    'click',
    '1',
  )
  await app.delay(200)
  execFileSync('import', ['-window', 'root', path.join(output, name + '-native-dropdown.png')])
  const target = state.value === state.options.at(-1) ? state.options[0] : state.options.at(-1)
  await app.key(target === state.options[0] ? 'Home' : 'End')
  await app.key('Return')
  await app.until(
    () =>
      app.execute(
        'return document.querySelector(arguments[0])?.value===arguments[1]',
        selector,
        target,
      ),
    'native select changed',
  )
  await app.shot(name + '-changed')
  await app.focus(selector)
  await app.key('Home')
  for (let i = 0; i < state.options.indexOf(state.value); i++) await app.key('Down')
  await app.key('Tab')
  await app.until(
    () =>
      app.execute(
        'return document.querySelector(arguments[0])?.value===arguments[1]',
        selector,
        state.value,
      ),
    'native select restored',
  )
  const result = {
    initial,
    settled,
    original: state.value,
    changed: target,
    restored: true,
    document: await app.probe(),
  }
  await writeFile(path.join(output, name + '.json'), JSON.stringify(result, null, 2) + '\n')
  return result
}

async function layoutMatrix() {
  const before = await app.probe(),
    rows = []
  const diagnostic = process.env.MILKUP_P5_LAYOUT_DIAG === '1'
  const themes = diagnostic ? ['light'] : ['light', 'dark'],
    sizes = diagnostic
      ? [[760, 520]]
      : [
          [1280, 900],
          [760, 520],
        ],
    zooms = diagnostic ? [2] : [1, 1.25, 1.5, 2],
    modes = diagnostic ? ['source'] : ['source', 'live']
  const initialFields = await app.execute(
    'return [...document.querySelectorAll(arguments[0]+" [data-plugin-field-control]")].map(e=>[e.dataset.pluginFieldControl,e.value])',
    panel,
  )
  for (const theme of themes) {
    x('windowsize', ui.windowId(), '1280', '900')
    await app.focus('.milkup-input-proxy')
    await app.key('ctrl+0')
    await setTheme(theme)
    for (const [width, height] of sizes)
      for (const zoom of zooms)
        for (const mode of modes) {
          await ui.closeMenu()
          if (
            await app.execute(
              'return document.querySelector("[data-sidebar-toggle]")?.getAttribute("aria-pressed")==="true"',
            )
          )
            await ui.click('[data-sidebar-toggle]')
          await app.focus('.milkup-input-proxy')
          await app.key('ctrl+0')
          await app.until(
            () =>
              app.execute(
                'return Number(document.querySelector("#app").dataset.appearanceZoom)===1',
              ),
            'native zoom reset',
          )
          for (let steps = 0; steps < 8; steps++) {
            const current = await app.execute(
              'return Number(document.querySelector("#app").dataset.appearanceZoom)',
            )
            if (current === zoom) break
            assert(current < zoom)
            await app.key('ctrl+equal')
            await app.until(
              () =>
                app.execute(
                  'return Number(document.querySelector("#app").dataset.appearanceZoom)!==arguments[0]',
                  current,
                ),
              'native zoom step',
            )
          }
          x('windowsize', ui.windowId(), String(width), String(height))
          await app.delay(200)
          x('windowfocus', '--sync', ui.windowId())
          await app.focus('.milkup-input-proxy')
          await app.key(mode === 'source' ? 'ctrl+1' : 'ctrl+2')
          await app.until(async () => (await app.probe()).mode === mode, 'layout mode ' + mode)
          await openPanel()
          const controls = await app.execute(
            'return [...document.querySelectorAll(arguments[0]+" [data-plugin-field-control], "+arguments[0]+" [data-plugin-command]")].filter(e=>!e.disabled).map(e=>({field:e.dataset.pluginFieldControl,command:e.dataset.pluginCommand}))',
            panel,
          )
          const selectors = controls.map((e) =>
            e.field
              ? `[data-plugin-field-control=${JSON.stringify(e.field)}]`
              : `[data-plugin-command=${JSON.stringify(e.command)}]`,
          )
          const bounds = []
          for (const selector of selectors) {
            await app.focus(panel + ' ' + selector)
            const bound = await controlBounds(panel + ' ' + selector)
            bounds.push(bound)
            const name = `layout-${theme}-${width}-${height}-${zoom * 100}-${mode}-control-${bounds.length}`
            if (!bound.visible || !bound.focused) await app.shot(name)
            if (diagnostic && selector.startsWith('[data-plugin-field-control='))
              await exerciseNativeSelect(panel + ' ' + selector, name + '-exercise')
          }
          const controlsPassed = bounds.every((row) => row.focused && row.visible)
          const geometry = await app.execute(
            'return {width:innerWidth,height:innerHeight,zoom:Number(document.querySelector("#app").dataset.appearanceZoom),fields:[...document.querySelectorAll(arguments[0]+" [data-plugin-field-control]")].map(e=>[e.dataset.pluginFieldControl,e.value])}',
            panel,
          )
          assert.equal(geometry.zoom, zoom)
          assert(Math.abs(geometry.width * zoom - width) <= 2, 'Actual WebKit zoom geometry')
          assert.deepEqual(geometry.fields, initialFields)
          assert.equal((await app.probe()).version, before.version)
          const name = `layout-${theme}-${width}-${height}-${zoom * 100}-${mode}`
          await app.shot(name)
          rows.push({ name, theme, geometry, bounds, controlsPassed })
          await writeFile(
            path.join(output, 'layout-matrix.json'),
            JSON.stringify(rows, null, 2) + '\n',
          )
        }
  }
  await writeFile(
    path.join(output, 'layout-completion.json'),
    JSON.stringify(
      {
        passed: rows.every((row) => row.controlsPassed),
        cases: rows.length,
        themes,
        sizes,
        zooms,
        modes,
        diagnostic,
      },
      null,
      2,
    ) + '\n',
  )
  return rows.every((row) => row.controlsPassed)
}

async function configureRenderers() {
  await app.until(
    () =>
      app.execute(
        "const r=JSON.parse(localStorage.getItem('milkup.desktop.plugins.registry.v1')||'{\"records\":[]}').records;return ['milkup.math','milkup.footnotes','milkup.diagrams'].every(id=>r.some(p=>p.manifest.id===id&&p.state==='enabled'))",
      ),
    'bundled renderer installation and enable completed',
    45000,
  )
  await app.delay(300)
  for (const provider of ['milkup.math', 'milkup.footnotes', 'milkup.diagrams']) {
    await ui.details(provider)
    if (bundledRich) {
      await ui.ready(action('disable', provider))
      continue
    }
    if (await ui.exists(action('disable', provider))) await ui.click(action('disable', provider))
    await ui.ready(action('enable', provider))
    if (!rich) continue
    if (provider === 'milkup.diagrams') {
      await ui.click(action('remove', provider))
      await app.until(
        () =>
          app.execute(
            "return !JSON.parse(localStorage.getItem('milkup.desktop.plugins.registry.v1')||'{\"records\":[]}').records.some(r=>r.manifest.id===arguments[0])",
            provider,
          ),
        'old diagram package removed',
      )
      await ui.list()
      await ui.click('[data-plugin-action="install"]')
      await ui.picker(diagramArchive)
      await app.until(
        () =>
          app.execute(
            "return JSON.parse(localStorage.getItem('milkup.desktop.plugins.registry.v1')||'{\"records\":[]}').records.some(r=>r.manifest.id===arguments[0]&&r.sourcePath===arguments[1])",
            provider,
            diagramArchive,
          ),
        'independent diagrams installed',
        30000,
      )
      await ui.details(provider)
      assert(
        await ui.exists(action('approve', provider)),
        'Independent DOM package starts unapproved',
      )
    }
    if (await ui.exists(action('approve', provider))) await ui.click(action('approve', provider))
    await ui.click(action('enable', provider))
    await ui.ready(action('disable', provider))
  }
  await record(rich ? 'rich-renderers-approved-enabled' : 'renderers-disabled-fallback-boundary')
}

async function install() {
  await ui.list()
  assert(!(await ui.exists(action('details', id))), 'Fresh profile expected')
  await ui.click('[data-plugin-action="install"]')
  await ui.picker(archive)
  await app.until(
    () =>
      app.execute(
        "return JSON.parse(localStorage.getItem('milkup.desktop.plugins.registry.v1')||'{\"records\":[]}').records.some(r=>r.manifest.id===arguments[0])",
        id,
      ),
    'plugin installed',
    30000,
  )
  await ui.details(id)
  await ui.ready(action('approve', id))
  await record('installed-unapproved')
  await ui.click(action('approve', id))
  await ui.click(action('enable', id))
  await ui.ready(action('disable', id))
  await openPanel()
  await record('approved-enabled-sidebar')
}
async function editor() {
  await ui.closeMenu()
  await app.focus('.milkup-input-proxy')
  await app.key('ctrl+1')
  await app.until(async () => (await app.probe()).mode === 'source', 'source mode')
}
try {
  app = await startProduction(launcherPath, output, { diagnostics: false })
  app.click = pointerClick
  x('windowsize', ui.windowId(), '1280', '900')
  await observeNativeErrors()
  await configureRenderers()
  await install()
  await openDocument(sourcePath)
  await app.until(async () => (await app.probe()).path === sourcePath, 'rich fixture opened')
  await record('fixture-opened')
  if (stage === 'html' || stage === 'large') {
    const file = path.join(output, 'complete.html')
    const exportStarted = Date.now()
    await startOutput()
    await savePath(file)
    await done()
    await verifyHtml(file)
    await writeFile(
      path.join(output, 'export-timing.json'),
      JSON.stringify(
        {
          elapsedMs: Date.now() - exportStarted,
          sourceBytes: Buffer.byteLength(source),
          sourceUtf16: source.length,
          sourceLines: source.split('\n').length,
          rss: 'not sampled',
        },
        null,
        2,
      ) + '\n',
    )
    if (stage === 'html') {
      await setField('resources', 'omit')
      const omitted = path.join(output, 'without-images.html')
      await startOutput()
      await savePath(omitted)
      await done()
      await verifyHtml(omitted, false)
    }
    if (stage === 'html' || process.env.MILKUP_P5_LAYOUT === '1') {
      try {
        layoutStatus = (await layoutMatrix()) ? 'passed' : 'failed'
      } catch (error) {
        layoutStatus = 'failed'
        await writeFile(
          path.join(output, 'layout-failure.json'),
          JSON.stringify({ error: String(error), stack: error.stack }, null, 2) + '\n',
        )
        await app.shot('layout-failure')
      }
    }
  } else if (stage === 'pdf') {
    await setField('format', 'pdf')
    for (const [paper, orientation] of [
      ['a4', 'portrait'],
      ['letter', 'landscape'],
    ]) {
      await setField('pageSize', paper)
      await setField('orientation', orientation)
      const file = path.join(output, `${paper}-${orientation}.pdf`)
      await startOutput()
      await savePath(file)
      await done()
      await verifyPdf(file, orientation === 'landscape')
    }
  } else if (stage === 'cancel') {
    await startOutput()
    await waitDialog('Choose output destination')
    x('key', '--clearmodifiers', 'Escape')
    await app.until(async () => (await panelText()).includes('已取消'), 'cancel displayed')
    await record('save-picker-cancelled')
    const file = path.join(output, 'retry.html')
    await startOutput()
    await savePath(file)
    await done()
    await verifyHtml(file)
  } else if (stage === 'selection') {
    await editor()
    await app.key('ctrl+Home')
    await app.key('shift+End')
    assert((await app.probe()).selection.length > 0)
    await setField('scope', 'selection')
    const file = path.join(output, 'selection.html')
    await startOutput()
    const chooser = await waitDialog('Choose output destination')
    const capturedVersion = (await panelText()).match(/版本 (\d+)/)?.[1]
    x('windowfocus', '--sync', ui.windowId())
    await app.focus('.milkup-input-proxy')
    await app.key('ctrl+End')
    await app.text(' P5-DURING-CAPTURE-EDIT')
    await app.delay(250)
    const editedDuringChooser = (await app.probe()).dirty
    await writeFile(
      path.join(output, 'capture-edit-attempt.json'),
      JSON.stringify(
        { chooser, capturedVersion, editedDuringChooser, document: await app.probe() },
        null,
        2,
      ) + '\n',
    )
    await savePath(file)
    await done()
    await verifyHtml(file, false, true)
    assert(
      !(await readFile(file, 'utf8')).includes('P5-DURING-CAPTURE-EDIT'),
      'In-flight output excludes later edit',
    )
    const captured = hash(await readFile(file))
    await editor()
    await app.key('ctrl+End')
    if (!editedDuringChooser) await app.text(' P5-LATER-EDIT')
    assert.equal(hash(await readFile(file)), captured, 'Previous captured output remains immutable')
    await app.until(async () => (await app.probe()).dirty, 'later edit applied')
    await setField('scope', 'document')
    const later = path.join(output, 'later-version.html')
    await startOutput()
    await savePath(later)
    await done()
    assert(
      (await readFile(later, 'utf8')).includes(
        editedDuringChooser ? 'P5-DURING-CAPTURE-EDIT' : 'P5-LATER-EDIT',
      ),
      'Fresh capture includes later edit',
    )
    assert.equal(hash(await readFile(file)), captured, 'Older capture remains unchanged')
    await editor()
    await app.key('ctrl+z')
    await app.key('ctrl+s')
    await app.until(async () => !(await app.probe()).dirty, 'save restored document after undo')
    assert.equal(
      hash(await readFile(sourcePath)),
      originalHash,
      'Undo restored exact original bytes',
    )
    await record('captured-selection-unchanged-after-edit-undo')
  } else if (stage === 'disable') {
    await ui.details(id)
    await ui.click(action('disable', id))
    await ui.ready(action('enable', id))
    await editor()
    await app.key('ctrl+End')
    await app.text(' P5-DISABLED-EDIT')
    await app.until(async () => (await app.probe()).dirty, 'disabled plugin still permits editing')
    await app.key('ctrl+z')
    await app.key('ctrl+s')
    await app.until(
      async () => !(await app.probe()).dirty,
      'normal save after disabled edit and undo',
    )
    await record('disabled-edit-undo-save')
  } else if (stage === 'overwrite') {
    await startOutput()
    await savePath(sourcePath)
    await app.until(
      () =>
        app.execute(
          'return document.querySelector(arguments[0]+" [role=alert]")?.textContent',
          panel,
        ),
      'source overwrite visibly rejected',
    )
    await record('source-overwrite-refused')
    const existing = path.join(output, 'existing.html')
    const original = Buffer.from('P5-EXISTING-OUTPUT-MUST-SURVIVE-CANCEL')
    await writeFile(existing, original)
    await startOutput()
    const declined = await savePath(existing)
    await confirmOverwrite(declined.pid, false)
    await app.until(async () => (await panelText()).includes('已取消'), 'overwrite declined')
    assert.deepEqual(await readFile(existing), original)
    await record('existing-overwrite-declined')
    await startOutput()
    const accepted = await savePath(existing)
    await confirmOverwrite(accepted.pid, true)
    await done()
    await verifyHtml(existing)
    await writeFile(
      path.join(output, 'other-open-document-status.json'),
      JSON.stringify(
        {
          status: 'not-covered',
          reason:
            'File > Open replaces the active document; the previous file is no longer open. Multiple simultaneously open windows are covered by native boundary tests, not this UI stage.',
        },
        null,
        2,
      ) + '\n',
    )
  } else {
    await setField('format', 'print')
    await startOutput()
    const window = await waitDialog('Print document')
    execFileSync('import', ['-window', window, path.join(output, 'print-dialog.png')])
    if (stage === 'print-cancel') {
      x('key', '--clearmodifiers', 'Escape')
      await app.until(async () => (await panelText()).includes('已取消'), 'print cancellation')
      await record('native-print-cancelled')
    } else {
      // GTK's Print to File page exposes Name and Save in folder mnemonics.
      // Verify the real file after interaction; a screenshot never satisfies this case.
      x('mousemove', '--window', window, '110', '87', 'click', '1')
      await app.delay(500)
      execFileSync('import', ['-window', window, path.join(output, 'print-file-settings.png')])
      const printerPid = x('getwindowpid', window).trim()
      x('mousemove', '--window', window, '164', '294', 'click', '1')
      const fileDialog = await app.until(() => {
        try {
          return x('search', '--onlyvisible', '--pid', printerPid)
            .trim()
            .split('\n')
            .filter((id) => id !== window)
            .at(-1)
        } catch {
          return null
        }
      }, 'GTK print filename chooser')
      x('windowfocus', '--sync', fileDialog)
      execFileSync('import', [
        '-window',
        fileDialog,
        path.join(output, 'print-filename-dialog.png'),
      ])
      await writeFile(path.join(output, 'print-filename-title.txt'), x('getwindowname', fileDialog))
      x('key', '--clearmodifiers', 'ctrl+l')
      await app.delay(150)
      x('key', '--clearmodifiers', 'ctrl+a')
      x('type', '--clearmodifiers', '--delay', '2', '--', path.join(output, 'printed.pdf'))
      x('key', '--clearmodifiers', 'Return')
      await app.delay(600)
      x('windowfocus', '--sync', window)
      execFileSync('import', ['-window', window, path.join(output, 'print-selected-target.png')])
      const geometry = x('getwindowgeometry', '--shell', window)
      const width = Number(/WIDTH=(\d+)/.exec(geometry)[1]),
        height = Number(/HEIGHT=(\d+)/.exec(geometry)[1])
      x('mousemove', '--window', window, String(width - 55), String(height - 29), 'click', '1')
      await done()
      await access(path.join(output, 'printed.pdf'))
      await verifyPdf(path.join(output, 'printed.pdf'), false)
    }
  }
  await writeFile(
    path.join(output, 'completion.json'),
    JSON.stringify(
      {
        stage,
        passed: true,
        checked: results.map((r) => r.name),
        visualReview: 'pending',
        layoutStatus,
        scope:
          'UI interactions and file structure; visual review and PDF text extraction are independent statuses',
        sourceSha256: hash(await readFile(sourcePath)),
      },
      null,
      2,
    ) + '\n',
  )
} catch (error) {
  await writeFile(
    path.join(output, 'failure.json'),
    JSON.stringify({ stage, error: String(error), stack: error.stack, results }, null, 2) + '\n',
  )
  if (app) {
    await app.shot('failure').catch(() => {})
    await writeFile(
      path.join(output, 'failure-ui-bounds.json'),
      JSON.stringify(
        await app
          .execute(
            'return {sidebar:document.querySelector("#app")?.dataset.sidebarCollapsed,toggle:document.querySelector("[data-sidebar-toggle]")?.outerHTML,panels:[...document.querySelectorAll("[data-plugin-ui]")].map(e=>({id:e.dataset.pluginUi,rect:e.getBoundingClientRect().toJSON()}))}',
          )
          .catch(() => null),
        null,
        2,
      ) + '\n',
    )
    const registry = await app
      .execute(
        "return JSON.parse(localStorage.getItem('milkup.desktop.plugins.registry.v1')||'{\"records\":[]}').records.map(r=>({id:r.manifest.id,state:r.state,enabled:r.enabled,errors:r.errors,sourcePath:r.sourcePath}))",
      )
      .catch(() => null)
    await writeFile(
      path.join(output, 'failure-native-errors.json'),
      JSON.stringify(
        await app.execute('return window.__p5NativeErrors ?? []').catch(() => []),
        null,
        2,
      ) + '\n',
    )
    await writeFile(
      path.join(output, 'failure-registry.json'),
      JSON.stringify(registry, null, 2) + '\n',
    )
  }
  throw error
} finally {
  await app?.close()
}

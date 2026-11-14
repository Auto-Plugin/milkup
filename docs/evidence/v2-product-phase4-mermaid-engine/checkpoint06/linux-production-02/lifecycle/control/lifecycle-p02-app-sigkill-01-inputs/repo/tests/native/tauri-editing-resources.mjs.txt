// Production P4 acceptance: normal GTK grants and native pointer/keyboard input.
// execute() observes shipped DOM only; it never dispatches commands or installs state.
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { startProduction } from '../helpers/native-production.mjs'
import { ownedApplication } from '../helpers/native-owned-process.mjs'
import { action, nativeFixture, writeLogoFixture, x } from '../helpers/native-updates-fixture.mjs'

const output =
  process.env.MILKUP_NATIVE_EVIDENCE_DIR ||
  '/workspace/milkup-editing-resources-phase4-evidence/native'
const archives = {
  'milkup.formatting':
    process.env.MILKUP_FORMATTING_ARCHIVE ||
    '/workspace/milkup-editing-resources-phase4-evidence/sdk/public-build-seven-final/milkup.formatting/dist/milkup.formatting-1.0.0.milkup-plugin',
  'milkup.images':
    process.env.MILKUP_IMAGES_ARCHIVE ||
    '/workspace/milkup-editing-resources-phase4-evidence/sdk/public-build-seven-final/milkup.images/dist/milkup.images-1.0.0.milkup-plugin',
}
if (
  !['cancel', 'tail', 'clipboard'].includes(process.env.MILKUP_P4_STAGE) &&
  process.env.MILKUP_P4_SKIP_MATRIX !== '1'
)
  archives['milkup.preferences'] =
    '/workspace/milkup-editing-resources-phase4-evidence/sdk/public-build-seven-final/milkup.preferences/dist/milkup.preferences-1.0.0.milkup-plugin'
const preferences = '[data-plugin-ui="milkup.preferences:preferences-panel"]'
const formatting = '[data-plugin-ui="milkup.formatting:formatting-modal"]'
const images = '[data-plugin-ui="milkup.images:images-panel"]'
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex')
await mkdir(output, { recursive: true })
const packages = []
for (const [id, archive] of Object.entries(archives)) {
  const bytes = await readFile(archive),
    bundle = JSON.parse(bytes)
  assert.equal(bundle.manifest.id, id)
  assert(
    (id === 'milkup.preferences' ? ['^0.3.1'] : ['^0.3.2', '>=0.3.2 <0.4.0']).includes(
      bundle.manifest.engines.pluginSdk,
    ),
  )
  assert(
    bundle.manifest.permissions.includes(
      id === 'milkup.preferences' ? 'settings:write' : 'document:write',
    ),
  )
  assert(!archive.startsWith(path.resolve('apps/desktop') + path.sep))
  packages.push({ id, archive, sha256: hash(bytes), manifest: bundle.manifest })
}
if (process.argv.includes('--preflight')) {
  console.log('PASS independent P4 archive preflight; no application started')
  process.exit(0)
}
assert.equal(
  process.env.MILKUP_P4_BINARY_CONFIRMED,
  '1',
  'Wait for the confirmed final Linux production artifact',
)
const binary = process.env.TAURI_APP_PATH
assert(binary, 'Set an isolated TAURI_APP_PATH')
assert(process.env.MILKUP_RECOVERY_PROFILE, 'Set the dedicated profile recovery-v1 directory')
await writeFile(
  path.join(output, 'provenance.json'),
  JSON.stringify(
    {
      binary,
      binarySha256: hash(await readFile(binary)),
      productionDebSha256: process.env.MILKUP_P4_DEB_PATH
        ? hash(await readFile(process.env.MILKUP_P4_DEB_PATH))
        : '78eb939fefbc42313282b947467dd3fe31385f499407ba193b760539f5d67e51',
      releaseBinarySha256:
        process.env.MILKUP_P4_RELEASE_SHA ??
        'e30b11dc692e6d29bc958be21df613b5d2be07f7c1f7c1706182fc277eec6f29',
      packagingDifference:
        process.env.MILKUP_P4_PACKAGING_NOTE ??
        'The DEB binary differs only in the three-byte Tauri package type marker UNK to DEB at byte offset 2396127; size 19659344 and ELF BuildID 73aa331ecaf76e9504d55be17fb4c4d966b5f411 match. Root independently verified the extracted binary SHA.',
      packages,
      display: process.env.DISPLAY,
      profile: process.env.XDG_DATA_HOME,
      pixbufCache: process.env.GDK_PIXBUF_MODULE_FILE,
      prootNoSeccomp: process.env.PROOT_NO_SECCOMP ?? null,
      reusedInstalled: process.env.MILKUP_P4_REUSE_INSTALLED === '1',
      matrixCase: process.env.MILKUP_P4_MATRIX_CASE ?? null,
      driver: process.env.TAURI_DRIVER_URL,
      sourceHead: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
      input:
        'XTest keyboard/pointer; GTK image picker and clipboard owner; read-only shipped DOM observations',
    },
    null,
    2,
  ),
)
const table = '| A | B | C |\r\n| --- | --- | --- |\r\n| cell | b | c |\r\n'
const prefix = 'Alpha 中文😀\r\n\r\n' + table + '\r\nend\r\n'
const contents = new Map([
  ['ordinary', prefix],
  ['windowed', prefix + 'retained 中文 é 👩🏽‍💻 body\r\n'.repeat(160000)],
])
for (const [name, text] of contents) await writeFile(path.join(output, name + '.md'), text)
const launcher = path.join(output, 'launcher.md')
await writeFile(launcher, '# Editing resources acceptance\r\n')
await writeLogoFixture(output)
const imageFile = path.join(output, 'logo-fixture.png')
let app,
  nativeWindow,
  activeFile = launcher,
  launchFile = launcher,
  clipboard
const ui = nativeFixture(() => app),
  results = []
const observe = () =>
  app.execute(`
const e=document.querySelector('.milkup-editor'), a=document.activeElement;
return {width:innerWidth,height:innerHeight,theme:document.documentElement.dataset.theme,zoom:Number(document.querySelector('#app')?.dataset.appearanceZoom),windowed:!!document.querySelector('.milkup-source-document-view'),editor:e?.getBoundingClientRect().toJSON(),cursor:document.querySelector('.milkup-cursor')?.getBoundingClientRect().toJSON(),focus:{tag:a?.tagName,field:a?.dataset.pluginFieldControl,command:a?.dataset.pluginCommand},images:[...document.querySelectorAll('.milkup-image-preview')].map(i=>({src:i.getAttribute('src'),complete:i.complete,alt:i.alt,width:i.naturalWidth,height:i.naturalHeight,rect:i.getBoundingClientRect().toJSON()})),tables:[...document.querySelectorAll('.milkup-block-table')].map(e=>({text:e.textContent,rect:e.getBoundingClientRect().toJSON()})),modal:[...document.querySelectorAll('[data-plugin-slot="modal"]')].map(e=>({id:e.dataset.pluginUi,text:e.textContent,rect:e.getBoundingClientRect().toJSON()})),registry:JSON.parse(localStorage.getItem('milkup.desktop.plugins.registry.v1')||'{"records":[]}').records.map(r=>({id:r.manifest.id,state:r.state,enabled:r.enabled})),diagnostics:window.__productionDiagnostics}
`)
async function record(name, extra = {}) {
  results.push({
    name,
    at: new Date().toISOString(),
    ...extra,
    document: await app.probe(),
    dom: await observe(),
  })
  await writeFile(path.join(output, 'results.json'), JSON.stringify(results, null, 2))
  console.log('PASS ' + name)
}
async function shot(name, extra = {}) {
  await app.delay(150)
  await app.shot(name + '-webview')
  execFileSync('import', ['-window', 'root', path.join(output, name + '-x11.png')], {
    env: process.env,
  })
  await record(name, extra)
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
      'const e=document.querySelector(arguments[0]),r=e.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2;return{x,y,w:innerWidth,h:innerHeight,zoom:document.querySelector("#app")?.dataset.appearanceZoom,hit:e.contains(document.elementFromPoint(x,y))}',
      selector,
    )
  let r
  await app.until(async () => {
    const a = await sample()
    await app.delay(80)
    const b = await sample()
    if (JSON.stringify(a) !== JSON.stringify(b)) return false
    r = b
    return true
  }, 'stable click geometry')
  if (!r.hit || r.x < 0 || r.x >= r.w || r.y < 0 || r.y >= r.h) {
    await keyboardFocus(selector)
    await app.key('Return')
  } else {
    const scale =
      Number(/WIDTH=(\d+)/.exec(x('getwindowgeometry', '--shell', nativeWindow))[1]) / r.w
    x(
      'mousemove',
      '--window',
      nativeWindow,
      String(Math.round(r.x * scale)),
      String(Math.round(r.y * scale)),
      'click',
      '1',
    )
  }
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
async function formatButton(title, fields = {}) {
  await openUI('milkup.formatting', 'formatting-modal')
  for (const [key, value] of Object.entries(fields)) await setField(formatting, key, value)
  await click(`${formatting} button[aria-label="${title}"]`)
  await app.until(
    () =>
      app.execute(
        'return document.querySelector(arguments[0])?.textContent.includes("已应用")',
        formatting,
      ),
    'format/table transaction',
  )
}
async function editRoundTrip(name, mode, title, kind, expected, fields = {}) {
  const before = contents.get(name)
  await selectAt(mode, kind)
  await formatButton(title, fields)
  await saved(expected)
  await editorFocus()
  await app.key('ctrl+z')
  await saved(before)
  await app.key('ctrl+shift+z')
  await saved(expected)
  await shot(`${name}-${mode}-${title}`, {
    beforeSha256: hash(Buffer.from(before)),
    afterSha256: hash(Buffer.from(expected)),
    oneUndo: true,
    oneRedo: true,
  })
  await app.key('ctrl+z')
  await saved(before)
}
async function imagePreview() {
  await app.key('ctrl+2')
  await app.until(
    async () => {
      const value = await observe()
      return value.images.some(
        (i) => i.complete && i.width === 64 && i.height === 64 && i.src.startsWith('blob:'),
      )
    },
    'local raster decoded',
    30000,
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
async function saveAsPicker(file) {
  const dialog = () => {
    try {
      return x('search', '--onlyvisible', '--name', '^(Save File|Save As|Save)$').split('\n').at(-1)
    } catch {
      return null
    }
  }
  const id = await app.until(dialog, 'normal GTK Save As picker', 30000)
  await app.delay(1500)
  await dismissGtkReadError('save-as')
  x('windowfocus', '--sync', id, 'mousemove', '--window', id, '220', '28', 'click', '1')
  await app.delay(200)
  x('key', '--clearmodifiers', 'ctrl+a')
  x('type', '--clearmodifiers', '--delay', '10', '--', file)
  await app.delay(600)
  x('key', '--clearmodifiers', 'ctrl+a')
  x('key', '--clearmodifiers', 'ctrl+c')
  await app.until(
    () =>
      execFileSync(
        '/usr/bin/python3',
        [
          '-c',
          "import gi;gi.require_version('Gtk','3.0');from gi.repository import Gtk,Gdk;print(Gtk.Clipboard.get(Gdk.SELECTION_CLIPBOARD).wait_for_text() or '',end='')",
        ],
        { env: process.env, encoding: 'utf8' },
      ) === file,
    'GTK Name contains exact intended path',
  )
  await writeFile(path.join(output, 'save-as-' + path.basename(file) + '-verified-name.txt'), file)
  x('key', '--clearmodifiers', 'End')
  execFileSync(
    'import',
    ['-window', 'root', path.join(output, 'save-as-' + path.basename(file) + '-before-x11.png')],
    { env: process.env },
  )
  x('key', '--clearmodifiers', 'Return')
  await app.delay(1000)
  if (nativeWindowVisible(id)) {
    const geometry = x('getwindowgeometry', '--shell', id)
    const width = Number(/WIDTH=(\d+)/.exec(geometry)[1]),
      height = Number(/HEIGHT=(\d+)/.exec(geometry)[1])
    x('mousemove', '--window', id, String(width - 45), String(height - 24), 'click', '1')
  }
  let nextObservation = 0,
    acknowledgements = 0
  await app.until(
    async () => {
      if (!nativeWindowVisible(id)) return true
      if (acknowledgements < 3 && Date.now() >= nextObservation) {
        nextObservation = Date.now() + 2000
        if (await dismissGtkReadError('save-as-after-confirm')) {
          acknowledgements++
          const geometry = x('getwindowgeometry', '--shell', id)
          const width = Number(/WIDTH=(\d+)/.exec(geometry)[1]),
            height = Number(/HEIGHT=(\d+)/.exec(geometry)[1])
          x('mousemove', '--window', id, String(width - 45), String(height - 24), 'click', '1')
        }
      }
      return false
    },
    'GTK Save As complete',
    30000,
  )
}
async function untitledImage(paste = false) {
  const tag = paste ? 'untitled-clipboard' : 'untitled-image'
  const expectedImageFile = paste ? path.join(output, 'clipboard-payload.png') : imageFile
  await closeUI()
  const previousPath = (await app.probe()).path
  await app.key('ctrl+n')
  await app.until(async () => {
    const p = await app.probe()
    return p.path !== previousPath && p.loading === 'ready' && !p.dirty && p.version === 0
  }, 'new untitled document committed')
  await editorFocus()
  await app.text('Untitled resource')
  await app.until(async () => {
    const p = await app.probe()
    return p.dirty && p.cursor === 17
  }, 'untitled typing settled')
  if (paste) await pasteImage()
  else {
    await openUI('milkup.images', 'images-panel')
    await click(`${images} button[aria-label="选择并插入图片"]`)
  }
  const file = path.join(output, tag + '.md')
  await saveAsPicker(file)
  if (!paste) await nativePicker(imageFile)
  await app.until(
    async () => {
      const p = await app.probe()
      return p.path === file && p.dirty
    },
    'untitled Save As then image insertion',
    30000,
  )
  activeFile = file
  await closeUI()
  await app.key('ctrl+s')
  await app.until(
    async () => {
      const p = await app.probe()
      return (
        !p.dirty &&
        !p.saving &&
        /!\[(?:\\.|[^\]\\])*\]\(([^)]+)\)/.test(await readFile(file, 'utf8'))
      )
    },
    'untitled image fully saved',
    30000,
  )
  const text = await readFile(file, 'utf8'),
    match = /!\[(?:\\.|[^\]\\])*\]\(([^)]+)\)/.exec(text)
  assert(match)
  assert(text.includes('Untitled resource'))
  const resource = path.resolve(output, decodeURIComponent(match[1]))
  assert.deepEqual(await readFile(resource), await readFile(expectedImageFile))
  await imagePreview()
  await shot(tag + '-save-as-before-image', {
    documentSha256: hash(await readFile(file)),
    resourceSha256: hash(await readFile(resource)),
  })
  // The managed resource follows a real document Save As, with the new Markdown
  // reference resolving after reopening. The original asset remains retained.
  const moved = path.join(output, 'saved-as', paste ? 'copied-clipboard.md' : 'copied-image.md')
  await mkdir(path.dirname(moved), { recursive: true })
  await closeUI()
  await app.key('ctrl+shift+s')
  await saveAsPicker(moved)
  await app.until(
    async () => {
      const p = await app.probe()
      return p.path === moved && !p.dirty
    },
    'resource-aware Save As',
    30000,
  )
  activeFile = moved
  const copied = await readFile(moved, 'utf8'),
    reference = /!\[(?:\\.|[^\]\\])*\]\(([^)]+)\)/.exec(copied)
  assert(reference)
  assert.deepEqual(
    await readFile(path.resolve(path.dirname(moved), decodeURIComponent(reference[1]))),
    await readFile(expectedImageFile),
  )
  await app.key('ctrl+o')
  await nativePicker(moved)
  await app.until(async () => (await app.probe()).loading === 'ready', 'reopen Save As resource')
  await imagePreview()
  await shot(tag + '-resource-save-as-reopen', { documentSha256: hash(await readFile(moved)) })
}
async function pasteImage() {
  await app.execute(
    `const readAsync=arguments[0];window.__nativePasteObservations=[]; window.__nativeClipboardRead={available:typeof navigator.clipboard?.read==='function'}; document.addEventListener('paste', e => {if(readAsync&&navigator.clipboard?.read) navigator.clipboard.read().then(items=>window.__nativeClipboardRead.types=items.map(i=>i.types),error=>window.__nativeClipboardRead.error=String(error));window.__nativePasteObservations.push({trusted:e.isTrusted,target:e.target?.tagName,types:[...(e.clipboardData?.types||[])],files:[...(e.clipboardData?.files||[])].map(f=>({name:f.name,type:f.type,size:f.size})),items:[...(e.clipboardData?.items||[])].map(i=>({kind:i.kind,type:i.type}))})},{capture:true,once:true})`,
    process.env.MILKUP_P4_CLIPBOARD_DIAGNOSTIC === '1',
  )
  clipboard = spawn(
    '/usr/bin/python3',
    [
      '-c',
      `import gi,sys\ngi.require_version('Gtk','3.0')\nfrom gi.repository import Gtk,Gdk,GdkPixbuf,GLib\nc=Gtk.Clipboard.get(Gdk.SELECTION_CLIPBOARD)\nc.set_image(GdkPixbuf.Pixbuf.new_from_file(sys.argv[1]))\nGdk.Display.get_default().flush()\nprint('clipboard-ready',flush=True)\nGLib.timeout_add_seconds(45,lambda:Gtk.main_quit())\nGtk.main()`,
      imageFile,
    ],
    { env: process.env, stdio: ['ignore', 'pipe', 'pipe'] },
  )
  await new Promise((resolve, reject) => {
    clipboard.stdout.once('data', resolve)
    clipboard.once('error', reject)
    clipboard.once('exit', (code) => {
      if (code) reject(Error('GTK clipboard owner failed ' + code))
    })
  })
  const clipboardReadback = execFileSync(
    '/usr/bin/python3',
    [
      '-c',
      `import gi,sys;gi.require_version('Gtk','3.0');from gi.repository import Gtk,Gdk;c=Gtk.Clipboard.get(Gdk.SELECTION_CLIPBOARD);print(c.wait_for_targets());i=c.wait_for_image();assert i is not None and i.get_width()==64 and i.get_height()==64;data=c.wait_for_contents(Gdk.Atom.intern('image/png',False));assert data is not None;open(sys.argv[1],'wb').write(data.get_data());print('verified PNG image 64x64')`,
      path.join(output, 'clipboard-payload.png'),
    ],
    { env: process.env, encoding: 'utf8' },
  )
  await writeFile(path.join(output, 'clipboard-readback.txt'), clipboardReadback)
  await app.key('ctrl+v')
  await app.delay(1000)
  await writeFile(
    path.join(output, 'paste-observations.json'),
    JSON.stringify(
      await app.execute(
        'return {events:window.__nativePasteObservations,asyncRead:window.__nativeClipboardRead}',
      ),
      null,
      2,
    ),
  )
}
async function imageRoundTrip(name, mode, paste = false) {
  const before = contents.get(name)
  const expectedImageFile = paste ? path.join(output, 'clipboard-payload.png') : imageFile
  await selectAt(mode, 'word')
  if (paste) {
    await pasteImage()
  } else {
    await openUI('milkup.images', 'images-panel')
    await setField(images, 'alt', 'left]right')
    await click(`${images} button[aria-label="选择并插入图片"]`)
    await nativePicker(imageFile)
  }
  await app.until(async () => (await app.probe()).dirty, 'image inserted', 30000)
  await closeUI()
  await app.key('ctrl+s')
  await app.until(
    async () => {
      const p = await app.probe()
      return (
        !p.dirty &&
        !p.saving &&
        /!\[(?:\\.|[^\]\\])*\]\(([^)]+)\)/.test(await readFile(activeFile, 'utf8'))
      )
    },
    'image Markdown fully saved',
    30000,
  )
  const after = await readFile(activeFile, 'utf8'),
    match = /!\[(?:\\.|[^\]\\])*\]\(([^)]+)\)/.exec(after)
  assert(match, 'Markdown contains a relative image resource')
  assert(!/^(?:\/|[a-z]+:)|\.\./i.test(match[1]))
  assert.equal(after.slice(match[0].length), before.slice(5), 'image replaces only selected Alpha')
  const resource = path.resolve(path.dirname(activeFile), decodeURIComponent(match[1]))
  assert.deepEqual(await readFile(resource), await readFile(expectedImageFile))
  await imagePreview()
  if (!paste)
    assert(
      (await observe()).images.some((image) => image.alt === 'left]right'),
      'image alt unescapes Markdown punctuation',
    )
  await shot(`${name}-${mode}-image-${paste ? 'clipboard' : 'picker'}`, {
    resource: path.relative(output, resource),
    resourceSha256: hash(await readFile(resource)),
  })
  await editorFocus()
  await app.key('ctrl+z')
  await saved(before)
  assert.deepEqual(
    await readFile(resource),
    await readFile(expectedImageFile),
    'undo keeps accepted assets',
  )
  await app.key('ctrl+shift+z')
  await saved(after)
  contents.set(name, after)
  clipboard?.kill()
  clipboard = undefined
  await openDocument(name)
  await imagePreview()
  await record(`${name}-${mode}-image-reopen`, { fullByteSha256: hash(await readFile(activeFile)) })
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
async function imageRecovery(origin) {
  if (origin) {
    await closeUI()
    await app.key('ctrl+o')
    await nativePicker(origin)
    await app.until(async () => {
      const p = await app.probe()
      return p.path === origin && p.loading === 'ready'
    }, 'open existing image recovery fixture')
    activeFile = origin
  } else await openDocument('ordinary')
  const file = activeFile,
    original = await readFile(file),
    text = original.toString('utf8')
  const reference = /!\[(?:\\.|[^\]\\])*\]\(([^)]+)\)/.exec(text)
  assert(reference)
  const originalResource = path.resolve(path.dirname(file), decodeURIComponent(reference[1]))
  const resourceBytes = await readFile(originalResource)
  await selectAt('source', 'word')
  await app.key('ctrl+Home')
  await app.until(async () => (await app.probe()).cursor === 0, 'recovery edit start')
  await app.text('RECOVERY-')
  await app.until(async () => {
    const p = await app.probe()
    return p.dirty && p.cursor === 9
  }, 'recovery edit applied')
  await app.until(
    () =>
      app.execute(
        'return document.querySelector("#app").dataset.recoveryPhase==="ready"&&Number(document.querySelector("#app").dataset.recoveryVersion)===Number(document.querySelector("[data-stat=version]").textContent)',
      ),
    'durable recovery checkpoint with image',
    30000,
  )
  const candidates = []
  for (const name of await readdir(process.env.MILKUP_RECOVERY_PROFILE)) {
    try {
      const directory = path.join(process.env.MILKUP_RECOVERY_PROFILE, name)
      const manifest = JSON.parse(await readFile(path.join(directory, 'manifest.json'), 'utf8'))
      if (manifest.originalPath === file && manifest.disposition === 'pending')
        candidates.push({ ...manifest, directory })
    } catch {}
  }
  const checkpoint = candidates.sort((a, b) => b.createdAt - a.createdAt)[0]
  assert(checkpoint, 'pending image recovery checkpoint exists')
  assert.deepEqual(
    await readFile(path.join(checkpoint.directory, checkpoint.payload)),
    Buffer.from('RECOVERY-' + text),
  )
  assert.deepEqual(await readFile(file), original)
  await shot('image-recovery-before-crash', {
    checkpoint: checkpoint.id,
    originalSha256: hash(original),
    resourceSha256: hash(resourceBytes),
  })
  const owner = await ownedApplication(app.application, launchFile)
  const termination = await owner.signal('SIGKILL')
  await app.close()
  app = undefined
  await start(file)
  await ui.ready(`[data-recovery-restore="${checkpoint.id}"]`)
  await shot('image-recovery-offered', { termination, checkpoint: checkpoint.id })
  await click(`[data-recovery-restore="${checkpoint.id}"]`)
  await app.until(
    async () => {
      const p = await app.probe()
      return (
        p.path.includes('/copies/recovered-') &&
        p.loading === 'ready' &&
        p.notice.includes('已打开恢复副本')
      )
    },
    'image recovery copy materialized',
    30000,
  )
  activeFile = (await app.probe()).path
  assert.deepEqual(await readFile(activeFile), Buffer.from('RECOVERY-' + text))
  const copiedResource = path.resolve(path.dirname(activeFile), decodeURIComponent(reference[1]))
  assert.deepEqual(await readFile(copiedResource), resourceBytes)
  assert.deepEqual(await readFile(file), original, 'recovery leaves original Markdown unchanged')
  assert.deepEqual(
    await readFile(originalResource),
    resourceBytes,
    'recovery leaves original image unchanged',
  )
  await imagePreview()
  await shot('image-recovery-copy-preview', {
    recovered: activeFile,
    originalSha256: hash(original),
    resourceSha256: hash(resourceBytes),
    copiedResource,
  })
}
async function remainingResources() {
  const seed = process.env.MILKUP_P4_RESOURCE_SEED
  assert(seed, 'Set the previous candidate02 native resource evidence directory')
  const provenance = JSON.parse(await readFile(path.join(seed, 'provenance.json'), 'utf8'))
  assert.equal(provenance.binarySha256, hash(await readFile(binary)))
  const originalFile = path.join(seed, 'untitled-clipboard.md')
  const originalBytes = await readFile(originalFile)
  const reference = /!\[(?:\\.|[^\]\\])*\]\(([^)]+)\)/.exec(originalBytes.toString('utf8'))
  assert(reference)
  const originalImage = await readFile(path.resolve(seed, decodeURIComponent(reference[1])))
  await closeUI()
  await app.key('ctrl+o')
  await nativePicker(originalFile)
  await app.until(async () => {
    const p = await app.probe()
    return p.path === originalFile && p.loading === 'ready'
  }, 'open existing clipboard image fixture')
  activeFile = originalFile
  await imagePreview()
  const target = path.join(output, 'migrated', 'copied-clipboard.md')
  await mkdir(path.dirname(target), { recursive: true })
  await app.key('ctrl+shift+s')
  await saveAsPicker(target)
  await app.until(
    async () => {
      const p = await app.probe()
      return p.path === target && !p.dirty && !p.saving
    },
    'clipboard resource migrated',
    30000,
  )
  activeFile = target
  assert.deepEqual(await readFile(target), originalBytes)
  assert.deepEqual(
    await readFile(path.resolve(path.dirname(target), decodeURIComponent(reference[1]))),
    originalImage,
  )
  assert.deepEqual(await readFile(originalFile), originalBytes)
  assert.deepEqual(
    await readFile(path.resolve(seed, decodeURIComponent(reference[1]))),
    originalImage,
  )
  await app.key('ctrl+o')
  await nativePicker(target)
  await app.until(async () => {
    const p = await app.probe()
    return p.path === target && p.loading === 'ready'
  }, 'reopen clipboard migration')
  await imagePreview()
  await shot('clipboard-resource-migration-reopen', {
    seed,
    documentSha256: hash(originalBytes),
    resourceSha256: hash(originalImage),
    originalUnchanged: true,
  })
  await imageRecovery(path.join(seed, 'ordinary.md'))
}
async function cancelledFirstSave() {
  await closeUI()
  const oldPath = (await app.probe()).path
  await app.key('ctrl+n')
  await app.until(async () => {
    const p = await app.probe()
    return p.path !== oldPath && p.version === 0 && !p.dirty && p.loading === 'ready'
  }, 'cancel fixture new document')
  await editorFocus()
  await app.key('ctrl+1')
  await app.until(async () => (await app.probe()).mode === 'source', 'cancel fixture source mode')
  const originalText = 'Cancel keeps 中文😀'
  // Use the platform text clipboard for non-BMP fixture input: WebKitDriver's
  // key-action transport duplicated the emoji in run-cancel01 before cancellation.
  const textClipboard = spawn(
    '/usr/bin/python3',
    [
      '-c',
      `import gi,sys\ngi.require_version('Gtk','3.0')\nfrom gi.repository import Gtk,Gdk,GLib\nc=Gtk.Clipboard.get(Gdk.SELECTION_CLIPBOARD)\nc.set_text(sys.argv[1],-1)\nGdk.Display.get_default().flush()\nprint('ready',flush=True)\nGLib.timeout_add_seconds(30,lambda:Gtk.main_quit())\nGtk.main()`,
      originalText,
    ],
    { env: process.env, stdio: ['ignore', 'pipe', 'pipe'] },
  )
  await new Promise((resolve, reject) => {
    textClipboard.stdout.once('data', resolve)
    textClipboard.once('error', reject)
  })
  await app.key('ctrl+v')
  await app.until(async () => {
    const p = await app.probe()
    return p.dirty && p.cursor === originalText.length
  }, 'cancel fixture text settled')
  textClipboard.kill()
  const before = await app.probe()
  const beforeText = await app.execute(
    'return document.querySelector(".milkup-editor-content").textContent',
  )
  const filesBefore = (await readdir(output)).sort()
  await pasteImage()
  const dialog = () => {
    try {
      return x('search', '--onlyvisible', '--name', '^(Save File|Save As|Save)$').split('\n').at(-1)
    } catch {
      return null
    }
  }
  const id = await app.until(dialog, 'first paste normal Save As')
  await app.delay(1500)
  await dismissGtkReadError('cancel-first-save')
  await shot('first-save-cancel-before', { before })
  x('windowfocus', '--sync', id, 'key', '--clearmodifiers', 'Escape')
  await app.until(() => !nativeWindowVisible(id), 'first Save As cancelled')
  await openUI('milkup.images', 'images-panel')
  await ui.ready(`${images} button[aria-label="选择并插入图片"]`)
  const after = await app.probe()
  assert.equal(after.path, before.path)
  assert.equal(after.version, before.version)
  assert.equal(after.dirty, before.dirty)
  assert.equal(
    await app.execute('return document.querySelector(".milkup-editor-content").textContent'),
    beforeText,
  )
  assert.equal(
    (await readdir(output)).filter((name) => name === 'assets' || name.endsWith('.assets')).length,
    0,
  )
  assert.equal(
    (await readdir(output)).filter((name) => name.endsWith('.md')).length,
    filesBefore.filter((name) => name.endsWith('.md')).length,
  )
  await shot('first-save-cancel-no-side-effects', {
    before,
    after,
    bodyText: beforeText,
    managedDirectoryCount: 0,
  })
  await closeUI()
  await editorFocus()
  await app.key('ctrl+End')
  await app.until(
    async () => (await app.probe()).cursor === originalText.length,
    'retry original caret',
  )
  await pasteImage()
  const target = path.join(output, 'cancel-retry.md')
  await saveAsPicker(target)
  await app.until(
    async () => {
      const p = await app.probe()
      return p.path === target && p.dirty
    },
    'retry grant inserts after Save As',
    30000,
  )
  activeFile = target
  await app.key('ctrl+s')
  await app.until(
    async () => {
      const p = await app.probe()
      return (
        !p.dirty &&
        !p.saving &&
        /!\[(?:\\.|[^\]\\])*\]\(([^)]+)\)/.test(await readFile(target, 'utf8'))
      )
    },
    'retry image fully saved',
    30000,
  )
  const afterText = await readFile(target, 'utf8')
  const reference = /!\[(?:\\.|[^\]\\])*\]\(([^)]+)\)/.exec(afterText)
  assert(reference)
  assert.equal(afterText.slice(0, reference.index), originalText)
  assert.deepEqual(
    await readFile(path.resolve(output, decodeURIComponent(reference[1]))),
    await readFile(path.join(output, 'clipboard-payload.png')),
  )
  await imagePreview()
  await shot('first-save-retry-success', { fullByteSha256: hash(Buffer.from(afterText)) })
  await editorFocus()
  await app.key('ctrl+z')
  await saved(originalText)
  await app.key('ctrl+shift+z')
  await saved(afterText)
  await shot('first-save-retry-isolated-history')
}
async function matrix() {
  for (const name of ['ordinary', 'windowed'])
    for (const mode of ['source', 'live'])
      for (const theme of ['light', 'dark'])
        for (const zoom of [1, 1.25, 1.5, 2])
          for (const narrow of [false, true]) {
            const caseName = `${name}-${mode}-${theme}-${zoom * 100}-${narrow ? 'narrow' : 'wide'}`
            if (
              process.env.MILKUP_P4_MATRIX_CASE &&
              !process.env.MILKUP_P4_MATRIX_CASE.split(',').includes(caseName)
            )
              continue
            const fixture = path.join(output, name + '.md')
            if (activeFile !== fixture || (await app.probe()).path !== fixture)
              await openDocument(name)
            x('windowsize', nativeWindow, narrow ? '760' : '1100', narrow ? '520' : '760')
            await appearance(theme, zoom)
            await selectAt(mode, 'cell')
            await openUI('milkup.formatting', 'formatting-modal')
            const selector = `${formatting} [data-plugin-field-control="cell"]`
            await keyboardFocus(selector)
            const observations = []
            let bounds, previousGeometry
            try {
              await app.until(
                async () => {
                  bounds = await app.execute(
                    'const a=document.activeElement,m=a.closest("[data-plugin-ui]"),r=a.getBoundingClientRect(),b=m.getBoundingClientRect();return{field:r.toJSON(),modal:b.toJSON(),metrics:{offsetHeight:m.offsetHeight,clientHeight:m.clientHeight,scrollTop:m.scrollTop,scrollHeight:m.scrollHeight,zoom:document.querySelector("#app")?.dataset.appearanceZoom},clip:{top:b.top+m.clientTop,bottom:b.top+m.clientTop+m.clientHeight,left:b.left+m.clientLeft,right:b.left+m.clientLeft+m.clientWidth}}',
                  )
                  observations.push({ at: Date.now(), ...bounds })
                  const geometry = JSON.stringify(bounds)
                  const stable = geometry === previousGeometry
                  previousGeometry = geometry
                  return (
                    stable &&
                    bounds.field.top - 4 >= bounds.clip.top &&
                    bounds.field.bottom + 4 <= bounds.clip.bottom &&
                    bounds.field.left - 4 >= bounds.clip.left &&
                    bounds.field.right + 4 <= bounds.clip.right
                  )
                },
                'stable full control and four-pixel focus ring inside modal',
                2000,
              )
            } finally {
              await writeFile(
                path.join(output, `bounds-${caseName}.json`),
                JSON.stringify({ bounds, observations }, null, 2),
              )
            }
            assert(
              bounds.field.top - 4 >= bounds.clip.top &&
                bounds.field.bottom + 4 <= bounds.clip.bottom &&
                bounds.field.left - 4 >= bounds.clip.left &&
                bounds.field.right + 4 <= bounds.clip.right,
              'focused field and ring fit modal: ' + JSON.stringify(bounds),
            )
            const before = await app.probe()
            await shot(
              `matrix-${name}-${mode}-${theme}-${zoom * 100}-${narrow ? 'narrow' : 'wide'}`,
              { bounds },
            )
            await closeUI()
            assert.equal((await app.probe()).version, before.version)
            assert.deepEqual(await readFile(activeFile), Buffer.from(contents.get(name)))
          }
}
try {
  await start()
  for (const [id, archive] of Object.entries(archives)) {
    if (process.env.MILKUP_P4_REUSE_INSTALLED === '1') {
      assert(
        await app.execute(
          `return JSON.parse(localStorage.getItem('milkup.desktop.plugins.registry.v1')||'{"records":[]}').records.some(r=>r.manifest.id===arguments[0]&&r.sourcePath===arguments[1])`,
          id,
          archive,
        ),
        'Previously installed external archive matches',
      )
      await details(id)
      await ui.ready(action('disable', id))
      await record('verified-existing-external-' + id)
      continue
    }
    await list()
    if (await ui.exists(action('details', id))) {
      await details(id)
      if (await ui.exists(action('disable', id))) await click(action('disable', id))
      await click(action('remove', id))
      await app.until(
        () =>
          app.execute(
            `return !JSON.parse(localStorage.getItem('milkup.desktop.plugins.registry.v1')||'{"records":[]}').records.some(r=>r.manifest.id===arguments[0])`,
            id,
          ),
        'plugin removal persisted',
      )
    }
    await list()
    await click('[data-plugin-action="install"]')
    await nativePicker(archive)
    await app.until(
      () =>
        app.execute(
          `return JSON.parse(localStorage.getItem('milkup.desktop.plugins.registry.v1')||'{"records":[]}').records.some(r=>r.manifest.id===arguments[0]&&r.sourcePath===arguments[1])`,
          id,
          archive,
        ),
      'external plugin installation persisted',
      30000,
    )
    if (!(await ui.exists('#plugin-detail-title'))) await details(id)
    await ui.ready('#plugin-detail-title')
    await shot('installed-' + id)
    if (await ui.exists(action('approve', id))) await click(action('approve', id))
    await click(action('enable', id))
    await ui.ready(action('disable', id))
  }
  await closeUI()
  if (['zoom-focus', 'focus-matrix'].includes(process.env.MILKUP_P4_STAGE)) {
    await openDocument('ordinary')
    await openUI('milkup.preferences', 'preferences-panel')
    const selector = `${preferences} [data-plugin-field-control="appearance.zoom"]`
    await keyboardFocus(selector)
    const trace = []
    const sample = async (phase) => {
      const state = await app.execute(
        'const a=document.activeElement,e=document.querySelector(arguments[0]);return{tag:a?.tagName,field:a?.dataset.pluginFieldControl,value:e?.value,disabled:e?.disabled,innerWidth,compact:matchMedia("(max-width: 760px)").matches,zoom:document.querySelector("#app")?.dataset.appearanceZoom}',
        selector,
      )
      trace.push({ at: Date.now(), phase, ...state })
      await writeFile(path.join(output, 'zoom-focus-trace.json'), JSON.stringify(trace, null, 2))
      return state
    }
    assert.equal((await sample('before')).field, 'appearance.zoom')
    await app.delay(300)
    assert.equal((await sample('before-settled')).field, 'appearance.zoom')
    const zoomKey = process.env.MILKUP_P4_ZOOM_KEY ?? 'End'
    const expectedZoom = await app.execute(
      'const e=document.querySelector(arguments[0]);return arguments[1]==="Home"?e.options[0].value:e.options[e.options.length-1].value',
      selector,
      zoomKey,
    )
    await app.key(zoomKey)
    for (let i = 0; i < 25; i++) {
      await sample('after-one-' + zoomKey)
      await app.delay(80)
    }
    const last = await sample('settled')
    await shot('zoom-single-key-focus', { trace })
    assert.equal(last.value, expectedZoom)
    assert.equal(last.zoom, expectedZoom)
    assert.equal(last.field, 'appearance.zoom', 'Single zoom change retains real keyboard focus')
    if (process.env.MILKUP_P4_STAGE === 'focus-matrix') {
      await closeUI()
      await matrix()
      assert.equal(results.filter((entry) => entry.name.startsWith('matrix-')).length, 64)
    }
  } else if (process.env.MILKUP_P4_STAGE === 'cancel') {
    await cancelledFirstSave()
  } else if (process.env.MILKUP_P4_STAGE === 'tail') {
    await remainingResources()
  } else if (process.env.MILKUP_P4_STAGE === 'matrix') {
    await matrix()
  } else {
    if (!['resources', 'clipboard'].includes(process.env.MILKUP_P4_STAGE))
      for (const name of ['ordinary', 'windowed'])
        for (const mode of ['source', 'live']) {
          await openDocument(name)
          const original = contents.get(name)
          await editRoundTrip(name, mode, '粗体', 'word', '**Alpha**' + original.slice(5))
          await editRoundTrip(name, mode, '删除线', 'word', '~~Alpha~~' + original.slice(5))
          await editRoundTrip(
            name,
            mode,
            '列居中',
            'cell',
            original.replace('| --- | --- | --- |', '| :---: | --- | --- |'),
          )
          await editRoundTrip(
            name,
            mode,
            '右侧加列',
            'cell',
            original
              .replace('| A | B | C |', '| A |  | B | C |')
              .replace('| --- | --- | --- |', '| --- | --- | --- | --- |')
              .replace('| cell | b | c |', '| cell |  | b | c |'),
          )
          await editRoundTrip(
            name,
            mode,
            '下方加行',
            'cell',
            original.replace('| cell | b | c |\r\n', '| cell | b | c |\r\n|  |  |  |\r\n'),
          )
          await editRoundTrip(
            name,
            mode,
            '替换单元格内容',
            'cell',
            original.replace('| cell | b | c |', '| edited \\| cell | b | c |'),
            { cell: 'edited | cell' },
          )
        }
    if (process.env.MILKUP_P4_STAGE !== 'clipboard') {
      await openDocument('ordinary')
      await imageRoundTrip('ordinary', 'source')
    }
    if (process.env.MILKUP_P4_SKIP_CLIPBOARD !== '1') {
      await openDocument('windowed')
      await imageRoundTrip('windowed', 'live', true)
    }
    await untitledImage()
    if (process.env.MILKUP_P4_SKIP_CLIPBOARD !== '1') await untitledImage(true)
    clipboard?.kill()
    clipboard = undefined
    await imageRecovery()
    if (process.env.MILKUP_P4_SKIP_MATRIX !== '1') await matrix()
    await closeUI()
    await appearance('light', 1)
    x('windowsize', nativeWindow, '1100', '760')
    for (const id of Object.keys(archives)) {
      await details(id)
      await click(action('disable', id))
    }
    await closeUI()
    await openDocument('ordinary')
    await selectAt('source', 'end')
    await app.text('DISABLED')
    await saved(contents.get('ordinary') + 'DISABLED')
    assert(!(await ui.exists('[data-plugin-ui="milkup.formatting:formatting-toolbar"]')))
    await shot('all-p4-disabled-host-editing')
    for (const id of Object.keys(archives)) {
      await details(id)
      await click(action('remove', id))
    }
    await closeUI()
    await shot('p4-plugins-uninstalled')
  }
  await writeFile(
    path.join(output, 'summary.json'),
    JSON.stringify(
      {
        status:
          process.env.MILKUP_P4_STAGE ||
          process.env.MILKUP_P4_SKIP_CLIPBOARD ||
          process.env.MILKUP_P4_SKIP_MATRIX
            ? 'PARTIAL_DIAGNOSTIC_PASS'
            : 'PASS',
        stage: process.env.MILKUP_P4_STAGE ?? 'complete',
        skippedClipboard: process.env.MILKUP_P4_SKIP_CLIPBOARD === '1',
        skippedMatrix: process.env.MILKUP_P4_SKIP_MATRIX === '1',
        records: results.length,
        matrix: results.filter((x) => x.name.startsWith('matrix-')).length,
        packages,
        binarySha256: hash(await readFile(binary)),
      },
      null,
      2,
    ),
  )
} catch (error) {
  if (app) {
    await app.shot('failure').catch(() => {})
    execFileSync('import', ['-window', 'root', path.join(output, 'failure-x11.png')], {
      env: process.env,
    })
    await writeFile(
      path.join(output, 'failure.json'),
      JSON.stringify(
        {
          error: String(error),
          stack: error.stack,
          document: await app.probe().catch(() => null),
          dom: await observe().catch(() => null),
        },
        null,
        2,
      ),
    )
    await writeFile(
      path.join(output, 'failure.html'),
      await app.execute('return document.documentElement.outerHTML').catch(() => ''),
    )
  }
  throw error
} finally {
  clipboard?.kill()
  if (app) await app.close()
  await writeFile(
    path.join(output, 'cleanup.json'),
    JSON.stringify(
      {
        at: new Date().toISOString(),
        application: binary,
        applicationClosed: true,
        clipboardOwnerStopped: true,
      },
      null,
      2,
    ),
  )
  const files = (await readdir(output)).filter((name) => name.endsWith('-x11.png')).sort()
  await writeFile(
    path.join(output, 'x11-manifest.json'),
    JSON.stringify(
      await Promise.all(
        files.map(async (name) => ({
          name,
          sha256: hash(await readFile(path.join(output, name))),
        })),
      ),
      null,
      2,
    ),
  )
}

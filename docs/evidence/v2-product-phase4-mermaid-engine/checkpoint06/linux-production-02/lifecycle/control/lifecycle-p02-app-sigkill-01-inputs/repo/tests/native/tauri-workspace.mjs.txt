// Independent production workspace plugin acceptance. Public DOM observation
// and control focus only; editing, authorization, and commands use native input,
// without private state or IPC. Requires the explicitly confirmed P2 binary.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { startProduction } from '../helpers/native-production.mjs'
import { action, nativeFixture, x } from '../helpers/native-updates-fixture.mjs'

const id = 'milkup.workspace'
const view = '[data-plugin-ui="milkup.workspace:workspace-panel"]'
const command = (name) => `${view} [data-plugin-command="workspace.${name}"]`
const treeitem = (name) => `${view} [role="treeitem"][aria-label=${JSON.stringify(name)}]`
const output =
  process.env.MILKUP_NATIVE_EVIDENCE_DIR ||
  '/workspace/milkup-workspace-phase2-evidence/workspace-native'
const archive =
  process.env.MILKUP_WORKSPACE_ARCHIVE ||
  '/workspace/milkup-workspace-phase2-evidence/workspace-external/dist/milkup.workspace-1.0.0.milkup-plugin'
const binary = process.env.TAURI_APP_PATH
const focusOnly = process.argv.includes('--focus-only')
await mkdir(output, { recursive: true })
const packageData = JSON.parse(await readFile(archive, 'utf8'))
assert.equal(packageData.manifest.id, id)
assert(
  packageData.files.some(
    (file) => file.path === packageData.manifest.icon && file.encoding === 'base64',
  ),
)
assert.equal(packageData.manifest.engines.pluginSdk, '^0.3.0')
if (process.argv.includes('--preflight')) {
  console.log('PASS workspace external archive preflight; no driver started')
  process.exit(0)
}
assert.equal(
  process.env.MILKUP_P2_BINARY_CONFIRMED,
  '1',
  'Wait for the confirmed current P2 production build',
)
assert(binary, 'Set the confirmed binary explicitly')
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex')
await writeFile(
  path.join(output, 'provenance.json'),
  JSON.stringify(
    {
      binary,
      binarySha256: hash(await readFile(binary)),
      archive,
      archiveSha256: hash(await readFile(archive)),
      driver: process.env.TAURI_DRIVER_URL,
      display: process.env.DISPLAY,
    },
    null,
    2,
  ),
)
const folder = path.join(output, 'Project Unicode')
const launcher = path.join(output, 'launcher.md')
const normal = '# Workspace 文档 👩🏽‍💻\r\n\r\n正文 é 保留。\r\n'
const large =
  'Windowed workspace\r\n\r\n' +
  Array.from(
    { length: 18000 },
    (_, index) =>
      `Line ${String(index).padStart(5, '0')} — 中文 👩🏽‍💻 é ${'preserved text '.repeat(8)}\r\n`,
  ).join('')
const content = new Map([
  ['ordinary.md', normal],
  ['windowed.md', large],
  ['destination.md', '# Destination\r\n保持目标完整。\r\n'],
])
for (const [name, text] of content) {
  const bytes = Buffer.from(text)
  assert(bytes.includes(Buffer.from([13, 10])), `${name}: genuine CRLF fixture`)
  assert(!bytes.includes(Buffer.from('\\r\\n')), `${name}: no literal escaped newlines`)
  assert(!/(^|[^\r])\n/.test(text), `${name}: every newline remains CRLF`)
}
assert.equal(large.split('\r\n').length - 1, 18002, 'large fixture has real windowed lines')
const longName = '目录中的长文件名-用于验证原生焦点与横向裁切-abcdefghijklmnopqrstuvwxyz.md'
await mkdir(path.join(folder, 'paged'), { recursive: true })
await mkdir(path.join(folder, 'nested'), { recursive: true })
await writeFile(launcher, '# Launch\r\n')
for (const [name, text] of content) await writeFile(path.join(folder, name), text)
await writeFile(path.join(folder, 'nested', longName), normal)
await writeFile(path.join(folder, 'plain.txt'), 'plain text\r\n')
for (let n = 0; n < 230; n++)
  await writeFile(path.join(folder, 'paged', `${String(n).padStart(3, '0')}.md`), `# ${n}\r\n`)
let app
const ui = nativeFixture(() => app)
const results = []
const snapshot = () =>
  app.execute(
    `return {
 width:innerWidth,height:innerHeight,ratio:devicePixelRatio,theme:document.documentElement.dataset.theme,zoom:document.querySelector('#app').dataset.appearanceZoom,cssZoom:getComputedStyle(document.documentElement).zoom,
 text:document.querySelector(arguments[0])?.textContent,tree:[...document.querySelectorAll(arguments[0]+' [role="treeitem"]')].map(e=>({label:e.getAttribute('aria-label'),level:e.getAttribute('aria-level'),expanded:e.getAttribute('aria-expanded'),current:e.getAttribute('aria-current'),tabIndex:e.tabIndex})),
 activeLabel:document.activeElement?.getAttribute('aria-label'),activeRole:document.activeElement?.getAttribute('role'),activeRect:document.activeElement?.getBoundingClientRect().toJSON(),
 focus:{document:document.hasFocus(),visibility:document.visibilityState,visible:document.activeElement?.matches(':focus-visible'),outlineStyle:getComputedStyle(document.activeElement).outlineStyle,outlineWidth:getComputedStyle(document.activeElement).outlineWidth,outlineColor:getComputedStyle(document.activeElement).outlineColor,background:getComputedStyle(document.activeElement).backgroundColor},
 navigation:[...document.querySelectorAll(arguments[0]+' .plugin-tree-list,'+arguments[0]+' .plugin-navigation-secondary-list')].map(e=>({className:e.className,rect:e.getBoundingClientRect().toJSON(),scrollHeight:e.scrollHeight,clientHeight:e.clientHeight})),
 windowed:!!document.querySelector('.milkup-source-document-view'),editor:document.querySelector('.milkup-editor')?.innerText.slice(0,200),
 registry:(JSON.parse(localStorage.getItem('milkup.desktop.plugins.registry.v1')||'{"records":[]}').records).map(r=>({id:r.manifest.id,enabled:r.enabled,state:r.state,approvals:r.approvals})),diagnostics:window.__productionDiagnostics
}`,
    view,
  )
async function record(name, extra = {}) {
  results.push({
    name,
    at: new Date().toISOString(),
    ...extra,
    dom: await snapshot(),
    document: await app.probe(),
  })
  await writeFile(path.join(output, 'results.json'), JSON.stringify(results, null, 2) + '\n')
  console.log(name)
}
async function shot(name, extra = {}) {
  await app.delay(1000)
  await app.shot(name + '-webview')
  execFileSync('import', ['-window', 'root', path.join(output, name + '-x11.png')], {
    env: process.env,
  })
  await record(name, extra)
}
async function start() {
  app = await startProduction(launcher, output)
  await app.key('ctrl+0')
  x('windowsize', ui.windowId(), '1100', '760')
}
async function openPanel() {
  await ui.closeMenu()
  if (
    await app.execute('return document.querySelector("#app").dataset.sidebarCollapsed === "true"')
  )
    await ui.click('[data-sidebar-toggle]')
  if (await ui.exists(`${view} .plugin-ui-panel-toggle[aria-expanded="false"]`))
    await ui.click(`${view} .plugin-ui-panel-toggle`)
  await ui.ready(command('choose'))
}
async function folderDialog(cancel = false) {
  const candidate = () => {
    try {
      return x(
        'search',
        '--onlyvisible',
        '--name',
        '^(Select Folder|Select a Folder|Open Folder|Open File)$',
      )
        .split('\n')
        .at(-1)
    } catch {
      return null
    }
  }
  const dialog = await app.until(candidate, 'normal GTK folder picker')
  await app.delay(1000)
  if (cancel) {
    x('windowfocus', '--sync', dialog, 'key', '--clearmodifiers', 'Escape')
    await app.until(() => !candidate(), 'cancelled folder picker closed')
    x('windowfocus', '--sync', ui.windowId())
    return
  }
  // GTK's Select Folder starts in Recent after the archive picker. Navigate to
  // the real Home location before entering a directory (Recent has no cwd).
  x('windowfocus', '--sync', dialog, 'key', '--clearmodifiers', 'alt+Home')
  await app.delay(1800)
  // Observe the real GTK error page before responding; it is embedded in the
  // chooser, so X11 focus alone cannot distinguish it from the location UI.
  const gtkShot = path.join(output, `gtk-home-${Date.now()}.png`)
  execFileSync('import', ['-window', 'root', gtkShot], { env: process.env })
  const words = execFileSync('tesseract', [gtkShot, 'stdout', 'tsv'], {
    encoding: 'utf8',
    env: process.env,
    stdio: ['ignore', 'pipe', 'ignore'],
  })
  await writeFile(gtkShot + '.tsv', words)
  if (
    /Bad\s+address|Could\s+not\s+read/.test(
      words
        .split('\n')
        .map((row) => row.split('\t').at(-1))
        .join(' '),
    )
  ) {
    const ok = words
      .split('\n')
      .map((row) => row.split('\t'))
      .find((columns) => columns.at(-1)?.trim().toUpperCase() === 'OK')
    assert(ok, 'GTK read error must expose a real OK action')
    x(
      'mousemove',
      String(Number(ok[6]) + Number(ok[8]) / 2),
      String(Number(ok[7]) + Number(ok[9]) / 2),
      'click',
      '1',
    )
    await app.delay(500)
  }
  x('windowfocus', '--sync', dialog, 'key', '--clearmodifiers', 'ctrl+l')
  await app.delay(700)
  x('key', '--clearmodifiers', 'ctrl+a')
  x('type', '--clearmodifiers', '--delay', '0', '--', folder + '/')
  await app.delay(900)
  x('key', '--clearmodifiers', 'Return')
  await app.delay(1200)
  if (candidate()) {
    x('windowfocus', '--sync', dialog, 'key', '--clearmodifiers', 'Return')
    await app.delay(1000)
  }
  if (candidate()) {
    const geometry = x('getwindowgeometry', '--shell', dialog)
    const width = Number(/WIDTH=(\d+)/.exec(geometry)[1]),
      height = Number(/HEIGHT=(\d+)/.exec(geometry)[1])
    x('mousemove', '--window', dialog, String(width - 45), String(height - 24), 'click', '1')
    await app.delay(700)
    if (candidate()) x('windowfocus', '--sync', dialog, 'key', '--clearmodifiers', 'Return')
  }
  await app.until(() => !candidate(), 'folder picker closed')
  x('windowfocus', '--sync', ui.windowId())
}
async function choose() {
  await mouse(command('choose'))
  await folderDialog()
  await ui.ready(treeitem('ordinary.md'))
  await app.until(
    async () => !(await snapshot()).text.includes('请选择要授权'),
    'root listing completed',
  )
}
async function loaded() {
  await app.until(async () => {
    const text = (await snapshot()).text
    return (
      text &&
      !text.includes('请选择要授权') &&
      !text.includes('正在加载') &&
      !text.includes('正在请求宿主')
    )
  }, 'workspace async operation complete')
}
async function mouse(selector) {
  await ui.ready(selector)
  const p = await app.execute(
    'const r=document.querySelector(arguments[0]).getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}',
    selector,
  )
  x(
    'mousemove',
    '--window',
    ui.windowId(),
    String(Math.round(p.x)),
    String(Math.round(p.y)),
    'click',
    '1',
  )
}
async function open(name, via = 'keyboard') {
  if (via === 'mouse') await mouse(treeitem(name))
  else await ui.click(treeitem(name))
  await app.until(
    async () => {
      const state = await app.probe()
      return state.path === path.join(folder, name) && state.loading === 'ready'
    },
    'trusted workspace file open ' + name,
    30000,
  )
  await loaded()
}
async function mode(name) {
  await app.key(name === 'source' ? 'ctrl+1' : 'ctrl+2')
  await app.until(async () => (await app.probe()).mode === name, name + ' mode')
  await app.focus('.milkup-input-proxy')
}
async function edit(prefix) {
  await app.focus('.milkup-input-proxy')
  await app.key('ctrl+Home')
  await app.text(prefix)
  await app.until(async () => {
    const state = await app.probe()
    return state.dirty && state.cursor === prefix.length
  }, 'typing applied')
}
async function closePrompt(choice) {
  await ui.click(
    `[data-close-confirm] .confirm-dialog-actions [data-close-confirm-action="${choice}"]`,
  )
}
async function appearance(theme, zoom) {
  await ui.menu()
  await ui.click('[data-menu-section="appearance"]')
  await app.focus('[data-appearance-theme]')
  await app.key(theme === 'dark' ? 'End' : 'Home')
  await app.delay(150)
  if (theme === 'light') await app.key('Down')
  await app.key('Tab')
  await app.until(
    () =>
      app.execute(
        'return document.documentElement.dataset.theme===arguments[0]&&!document.querySelector("[data-appearance-theme]").disabled',
        theme,
      ),
    'theme applied',
  )
  await app.key('ctrl+0')
  await app.until(
    () =>
      app.execute(
        'return document.querySelector("#app").dataset.appearanceZoom==="1"&&!document.querySelector("[data-appearance-zoom]").disabled',
      ),
    'zoom reset',
  )
  const levels = [1, 1.25, 1.5, 2]
  for (let n = 1; n <= levels.indexOf(zoom); n++) {
    await app.key('ctrl+plus')
    await app.until(
      () =>
        app.execute(
          'return Number(document.querySelector("#app").dataset.appearanceZoom)===arguments[0]&&!document.querySelector("[data-appearance-zoom]").disabled',
          levels[n],
        ),
      'native zoom applied',
    )
  }
  await ui.closeMenu()
}
try {
  await start()
  if (focusOnly) {
    await openPanel()
    await choose()
    await open('destination.md')
  } else {
    if (process.env.MILKUP_WORKSPACE_RESUME !== '1') {
      await ui.details(id)
      assert(await ui.exists(action('approve', id)))
      assert(await ui.exists(action('enable', id)))
      await shot('00-bundled-inactive')
      await ui.click(action('remove', id))
      await ui.list()
      await ui.click('[data-plugin-action="install"]')
      await ui.picker(archive)
      await ui.ready(action('approve', id))
      await app.until(
        () =>
          app.execute(
            'const i=document.querySelector(".plugin-detail [data-plugin-icon]");return i?.complete&&i.naturalWidth===96',
          ),
        'real PNG logo',
      )
      await shot('01-external-installed-logo')
      await ui.click(action('approve', id))
      await ui.ready(action('enable', id))
      await ui.click(action('enable', id))
      await ui.ready(action('disable', id))
    } else {
      await record('resumed-existing-external-install', {
        priorEvidence: process.env.MILKUP_WORKSPACE_PRIOR_EVIDENCE,
      })
    }
    await openPanel()
    assert((await snapshot()).text.includes('每次启动需重新选择'))
    await shot('02-active-without-authority')
    await choose()
    await shot('03-native-folder-authorized')
    const previousTree = (await snapshot()).tree
    await mouse(command('choose'))
    await folderDialog(true)
    await loaded()
    assert.deepEqual((await snapshot()).tree, previousTree)
    await shot('03b-cancelled-choice-keeps-root')
    await choose()
    await choose()
    await shot('03c-reselected-root')
    await ui.click(treeitem('paged'))
    await loaded()
    await app.until(
      async () => (await snapshot()).tree.filter((item) => item.level === '2').length === 100,
      'first directory page',
    )
    let tree = (await snapshot()).tree
    assert.equal(tree.filter((x) => x.level === '2').length, 100)
    await shot('04-first-page-only')
    while (await ui.exists(`${command('more')}[aria-label="paged：加载更多"]`)) {
      const count = (await snapshot()).tree.length
      await ui.click(`${command('more')}[aria-label="paged：加载更多"]`)
      await app.until(
        async () => (await snapshot()).tree.length > count,
        'next directory page appended',
      )
      await loaded()
    }
    assert.equal((await snapshot()).tree.filter((x) => x.level === '2').length, 230)
    await shot('05-pagination-complete')
    await ui.click(treeitem('paged'))
    assert(!(await snapshot()).tree.some((x) => x.label === 'plain.txt'))
    await writeFile(path.join(folder, 'added-after-refresh.md'), normal)
    await ui.click(command('refresh'))
    await ui.ready(treeitem('added-after-refresh.md'))
    await loaded()
    assert(!(await snapshot()).tree.some((x) => x.level === '2'))
    await shot('06-refresh-new-authority')
    await open('ordinary.md', 'mouse')
    await shot('07-mouse-open')
    for (const name of ['ordinary.md', 'windowed.md']) {
      if (name !== 'ordinary.md') await open(name)
      await mode('source')
      assert.equal((await snapshot()).windowed, name === 'windowed.md')
      await app.key('ctrl+Home')
      for (let i = 0; i < 3; i++) await app.key('Right')
      for (let i = 0; i < 5; i++) await app.key('shift+Right')
      await app.until(async () => {
        const p = await app.probe()
        return p.cursor === 8 && p.selection.some((r) => r.from === 3 && r.to === 8)
      }, 'native selection 3..8')
      await mode('live')
      await app.until(async () => {
        const p = await app.probe()
        return p.cursor === 8 && p.selection.some((r) => r.from === 3 && r.to === 8)
      }, 'selection survives mode switch')
      await shot(`08-${name}-selection`)
      for (const value of ['source', 'live']) {
        await mode(value)
        const prefix = value.toUpperCase() + '-'
        await edit(prefix)
        await app.key('ctrl+z')
        await app.until(async () => (await app.probe()).cursor === 0, 'undo cursor')
        await app.key('ctrl+shift+z')
        await app.until(async () => (await app.probe()).cursor === prefix.length, 'redo cursor')
        await app.key('ctrl+s')
        const expected = prefix + content.get(name)
        content.set(name, expected)
        await app.until(
          async () =>
            !(await app.probe()).dirty &&
            (await readFile(path.join(folder, name), 'utf8')) === expected,
          'byte exact ' + value + ' save',
          30000,
        )
        assert.deepEqual(await readFile(path.join(folder, name)), Buffer.from(expected))
        await shot(`09-${name}-${value}-saved`, {
          bytes: Buffer.byteLength(expected),
          sha256: hash(Buffer.from(expected)),
        })
      }
      await edit('DIRTY-')
      await ui.click(treeitem('destination.md'))
      await ui.ready(
        '[data-close-confirm] .confirm-dialog-actions [data-close-confirm-action="cancel"]',
      )
      await shot(`10-${name}-dirty-confirm`)
      await closePrompt('cancel')
      await loaded()
      assert.equal((await app.probe()).path, path.join(folder, name))
      assert((await app.probe()).dirty)
      assert((await snapshot()).editor.startsWith('DIRTY-'))
      await ui.click(treeitem('destination.md'))
      await closePrompt('save')
      content.set(name, 'DIRTY-' + content.get(name))
      await app.until(
        async () => (await app.probe()).path === path.join(folder, 'destination.md'),
        'saved transition',
      )
      assert.deepEqual(await readFile(path.join(folder, name)), Buffer.from(content.get(name)))
      await loaded()
      await shot(`11-${name}-save-switch`)
    }
    await open('ordinary.md')
    await mode('source')
    await edit('CONFLICT-DRAFT-')
    await writeFile(path.join(folder, 'ordinary.md'), 'EXTERNAL CHANGE\r\n')
    await ui.click(treeitem('destination.md'))
    await closePrompt('save')
    await app.until(
      () =>
        app.execute(
          'const e=document.querySelector("[data-transition-error]");return e&&!e.hidden&&e.textContent.length>0',
        ),
      'external conflict remains in protection prompt',
    )
    assert.equal((await app.probe()).path, path.join(folder, 'ordinary.md'))
    assert((await app.probe()).dirty)
    assert((await snapshot()).editor.startsWith('CONFLICT-DRAFT-'))
    assert.equal(await readFile(path.join(folder, 'ordinary.md'), 'utf8'), 'EXTERNAL CHANGE\r\n')
    await shot('12-conflict-preserves-draft')
    await closePrompt('cancel')
    await loaded()
    await ui.click(treeitem('destination.md'))
    await closePrompt('discard')
    await app.until(
      async () => (await app.probe()).path === path.join(folder, 'destination.md'),
      'explicit discard after evidenced conflict',
    )
    await loaded()
    await app.close()
    await start()
    await openPanel()
    assert((await snapshot()).text.includes('每次启动需重新选择'))
    assert.equal((await snapshot()).tree.length, 0)
    await shot('13-restart-needs-new-root')
    await choose()
    await ui.ready(`${command('recent')}[aria-label="最近文件：destination.md"]`)
    await ui.click(`${command('recent')}[aria-label="最近文件：destination.md"]`)
    await app.until(
      async () => (await app.probe()).path === path.join(folder, 'destination.md'),
      'recent resolves after new authorization',
    )
    await loaded()
    await shot('14-recent-persisted')
  }
  await ui.click(treeitem('nested'))
  await ui.ready(treeitem('nested/' + longName))
  await loaded()
  for (const theme of ['light', 'dark'])
    for (const zoom of focusOnly ? [1, 2] : [1, 1.25, 1.5, 2]) {
      await appearance(theme, zoom)
      for (const width of focusOnly ? [760] : [1100, 760]) {
        x('windowsize', ui.windowId(), String(width), width === 760 ? '520' : '760')
        await app.delay(300)
        await app.focus(treeitem('nested/' + longName))
        if (focusOnly) {
          await app.key('Tab')
          await app.until(
            async () => (await snapshot()).activeRole !== 'treeitem',
            'Tab leaves tree',
          )
          await app.key('shift+Tab')
          await app.until(
            async () => (await snapshot()).activeLabel === 'nested/' + longName,
            'Shift Tab returns to tree',
          )
        }
        await app.key('Up')
        await app.until(
          async () => (await snapshot()).activeLabel === 'nested',
          'Up moves to preceding tree item',
        )
        await app.key('Down')
        const dom = await app.until(async () => {
          const d = await snapshot()
          return d.activeLabel === 'nested/' + longName ? d : false
        }, 'keyboard tree focus preserved')
        assert.equal(dom.cssZoom, '1')
        assert.equal(dom.theme, theme)
        assert.equal(Number(dom.zoom), zoom)
        assert(dom.activeRect.top >= 0 && dom.activeRect.bottom <= dom.height)
        assert(dom.activeRect.left >= 0 && dom.activeRect.right <= dom.width)
        await shot(`matrix-${theme}-${width}-${zoom * 100}`)
        if (focusOnly) {
          assert(dom.focus.document, 'WebKit document has native keyboard focus')
          assert(dom.focus.visible, 'Keyboard tree item matches focus-visible')
          assert.notEqual(dom.focus.outlineStyle, 'none')
          assert(Number.parseFloat(dom.focus.outlineWidth) >= 2)
        }
      }
    }
  if (!focusOnly) {
    await appearance('light', 1)
    x('windowsize', ui.windowId(), '1100', '760')
    for (const lifecycle of ['disable', 'revoke-approval']) {
      await ui.details(id)
      await ui.click(action(lifecycle, id))
      await ui.ready(action('enable', id))
      assert(!(await ui.exists(view)))
      await shot(`15-${lifecycle}-removed-ui`)
      if (lifecycle === 'revoke-approval') {
        await ui.click(action('approve', id))
        await ui.ready(action('enable', id))
      }
      await ui.click(action('enable', id))
      await ui.ready(action('disable', id))
      await openPanel()
      assert.equal((await snapshot()).tree.length, 0)
      assert((await snapshot()).text.includes('每次启动需重新选择'))
      await choose()
    }
    await ui.details(id)
    await ui.click(action('remove', id))
    await ui.list()
    assert(!(await ui.exists(action('details', id))))
    await shot('16-uninstalled')
    await ui.click('[data-plugin-action="install"]')
    await ui.picker(archive)
    await ui.ready(action('approve', id))
    await ui.click(action('approve', id))
    await ui.click(action('enable', id))
    await ui.ready(action('disable', id))
    await openPanel()
    assert.equal((await snapshot()).tree.length, 0)
    await shot('17-reinstalled-no-old-handles')
  }
  await record(
    focusOnly ? 'FOCUS-PASS' : 'PASS',
    focusOnly
      ? { matrix: 4, nativeKeyboardFocus: true }
      : {
          externalInstall: true,
          realFolderPicker: true,
          ordinaryWindowedSourceLive: true,
          dirtyCancelSaveConflict: true,
          recentReauthorized: true,
          lifecycleRevoked: true,
          matrix: 16,
        },
  )
} catch (error) {
  if (app) await shot('FAIL', { error: String(error), stack: error.stack }).catch(() => {})
  throw error
} finally {
  if (app) await app.close()
}

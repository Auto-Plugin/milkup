// Production only: independent archive, normal GTK picker, explicit permissions,
// Worker/public broker -> real unconfigured native release IPC, no endpoint mocks.
// Use a dedicated fresh profile. Set MILKUP_RECOVERY_PROFILE to its recovery dir.
// --preflight validates inputs without connecting to WebDriver or starting the app.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, writeFile, readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { startProduction } from '../helpers/native-production.mjs'
import { ownedApplication } from '../helpers/native-owned-process.mjs'
import {
  action,
  evidenceRoot,
  nativeFixture,
  preflight,
  updateArchive,
  updateCheck,
  updateId,
  updateView,
  writeLogoFixture,
  x,
} from '../helpers/native-updates-fixture.mjs'

const output = process.env.MILKUP_NATIVE_EVIDENCE_DIR || path.join(evidenceRoot, 'updates-native')
const archive = path.resolve(process.env.MILKUP_UPDATES_ARCHIVE || updateArchive)
await preflight({ output, archive, id: updateId, permission: 'app:updates', recovery: true })
const logo = await writeLogoFixture(output)
if (process.argv.includes('--preflight')) {
  console.log('PASS updates native preflight; no app/driver started')
  process.exit(0)
}
await mkdir(output, { recursive: true })
const file = path.join(output, 'update-review.md')
const original = '# 更新验收\r\n\r\n保留正文 中文 👩🏽‍💻。\r\n'
await writeFile(file, original)
let expected = original
let app
const ui = nativeFixture(() => app)
const results = []
const observe = () =>
  app.execute(`
  const modal=document.querySelector('[data-plugin-ui="milkup.updates:updates-modal"]');
  const check=modal?.querySelector('[data-plugin-command="updates.check"]');
  return {
    width:innerWidth,height:innerHeight,ratio:devicePixelRatio,
    checkRect:check?.getBoundingClientRect().toJSON(),
    modalRect:modal?.getBoundingClientRect().toJSON(),
    modal:modal?.textContent,status:modal?.querySelector('[role="status"]')?.textContent,
    manager:document.querySelector('[data-plugin-manager]')?.textContent,
    cards:[...document.querySelectorAll('[data-plugin-action="details"]')].map(e=>({id:e.dataset.pluginId,text:e.textContent,children:[...e.children].map(c=>c.className)})),
    cssZoom:getComputedStyle(document.documentElement).zoom,
    theme:document.documentElement.dataset.theme,
    zoom:document.querySelector('#app').dataset.appearanceZoom,
    focus:document.activeElement?.outerHTML.slice(0,500),
    activeTag:document.activeElement?.tagName,
    activeCommand:document.activeElement?.getAttribute('data-plugin-command'),
    activeLabel:document.activeElement?.getAttribute('aria-label'),
    activeAction:document.activeElement?.getAttribute('data-plugin-action'),
    activePluginId:document.activeElement?.getAttribute('data-plugin-id'),
    updateRenderChanges:window.__nativeUpdateRenderChanges??0,
    legacyUpdateControls:!!document.querySelector('[data-update-check], [data-application-update]'),
    outlineRows:document.querySelectorAll('[data-plugin-ui="milkup.outline:outline-panel"] .plugin-list-item').length,
    diagnostics:window.__productionDiagnostics
  }`)
async function record(name, extra = {}) {
  results.push({ name, ...extra, dom: await observe(), document: await app.probe() })
  await writeFile(path.join(output, 'results.json'), JSON.stringify(results, null, 2) + '\n')
}
async function shot(name, extra = {}) {
  // DOM observations can precede WebKit's compositor frame on X11.
  await app.delay(650)
  await app.shot(name + '-webview')
  execFileSync('import', ['-window', 'root', path.join(output, name + '-x11.png')], {
    env: process.env,
  })
  await record(name, extra)
}
async function start() {
  app = await startProduction(file, output)
  x('windowfocus', '--sync', ui.windowId())
}
async function checkRelease() {
  // Observe real controlled-UI replacements. A previous terminal label can remain
  // visible until the new native key event has reached the Worker command.
  await app.execute(
    `window.__nativeUpdateMutationObserver?.disconnect();
    window.__nativeUpdateRenderChanges=0;
    window.__nativeUpdateMutationObserver=new MutationObserver(()=>window.__nativeUpdateRenderChanges++);
    window.__nativeUpdateMutationObserver.observe(document.querySelector(arguments[0]),{childList:true,subtree:true});`,
    updateView,
  )
  await ui.click(updateCheck)
  const state = await app.until(async () => {
    const snapshot = await observe()
    return snapshot.updateRenderChanges > 0 &&
      snapshot.status?.includes('尚未配置在线更新渠道') &&
      snapshot.modal.includes('当前版本：2.0.0-beta.1') &&
      snapshot.modal.includes('更新渠道：') &&
      snapshot.activeTag === 'BUTTON' &&
      snapshot.activeCommand === 'updates.check'
      ? snapshot
      : false
  }, 'real unconfigured release result')
  await app.execute('window.__nativeUpdateMutationObserver.disconnect()')
  assert(state.modal.includes('当前版本：2.0.0-beta.1'))
  assert(state.modal.includes('更新渠道：'))
  assert.equal(state.legacyUpdateControls, false)
  assert.equal(state.activeTag, 'BUTTON', 'focused command remains a button after async rendering')
  assert.equal(state.activeCommand, 'updates.check', 'focus restored across async Worker rendering')
}
async function openUpdates() {
  await ui.details()
  await ui.click(`${action('open-ui')}[data-plugin-ui-id="updates-modal"]`)
  await ui.ready(updateCheck)
}
async function appearance(theme, zoom) {
  await ui.closeModal()
  await ui.click('[data-menu-section="appearance"]')
  await ui.ready('[data-appearance-theme]')
  await app.focus('[data-appearance-theme]')
  await app.key(theme === 'dark' ? 'End' : 'Home')
  await app.until(
    () =>
      app.execute(
        'const e=document.querySelector("[data-appearance-theme]");return !e.disabled&&e.value===arguments[0]',
        theme === 'dark' ? 'dark' : 'system',
      ),
    'theme selector settled',
  )
  if (theme === 'light') {
    await app.focus('[data-appearance-theme]')
    await app.key('Down')
  }
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
    'native zoom reset',
  )
  const levels = [1, 1.25, 1.5, 2]
  for (let index = 1; index <= levels.indexOf(zoom); index++) {
    await app.key('ctrl+plus')
    await app.until(
      () =>
        app.execute(
          'return Number(document.querySelector("#app").dataset.appearanceZoom)===arguments[0]&&!document.querySelector("[data-appearance-zoom]").disabled',
          levels[index],
        ),
      'native zoom applied',
    )
  }
  await openUpdates()
}
async function editSave(prefix, mode) {
  await ui.closeMenu()
  await app.key(mode === 'source' ? 'ctrl+1' : 'ctrl+2')
  await app.until(async () => (await app.probe()).mode === mode, mode + ' ready')
  await app.focus('.milkup-input-proxy')
  await app.key('ctrl+Home')
  await app.text(prefix)
  await app.until(async () => (await app.probe()).dirty, 'edit marked dirty')
  await app.key('ctrl+z')
  await app.key('ctrl+shift+z')
  await app.key('ctrl+s')
  expected = prefix + expected
  await app.until(
    async () => !(await app.probe()).dirty && (await readFile(file, 'utf8')) === expected,
    'byte-exact save after plugin lifecycle',
  )
}
try {
  await start()
  await app.key('ctrl+0')
  x('windowsize', ui.windowId(), '1100', '760')
  if (process.env.MILKUP_UPDATES_RESUME !== '1') {
    await ui.list()
    await ui.ready(action('details', 'milkup.outline'))
    await ui.ready(action('details'))
    const cards = (await observe()).cards
    assert(cards.some((card) => card.id === 'milkup.outline'))
    assert(cards.some((card) => card.id === updateId))
    assert(
      cards.every((card) => !card.text.includes('app:updates')),
      'list cards show summaries, capabilities live in details',
    )
    await shot('01-bundled-summary-cards')
    await ui.click('[data-plugin-action="install"]')
    await ui.picker(logo.archive)
    await ui.ready(action('enable', logo.id))
    await app.until(
      () =>
        app.execute(
          'const e=document.querySelector(".plugin-detail [data-plugin-icon]");return !!e&&e.complete&&e.naturalWidth===64&&e.naturalHeight===64',
        ),
      'valid packaged PNG in details',
    )
    await shot('01b-normal-gtk-png-details')
    await ui.click('[data-plugin-action="back"]')
    await app.until(
      () =>
        app.execute(
          'const e=document.querySelector(arguments[0]);return !!e&&e.complete&&e.naturalWidth===64',
          `${action('details', logo.id)} [data-plugin-icon]`,
        ),
      'valid packaged PNG in summary card',
    )
    assert.equal((await observe()).activePluginId, logo.id, 'Back restores exact card focus')
    assert(
      await app.execute(
        'return !document.querySelector(arguments[0])',
        `${action('details')} [data-plugin-icon]`,
      ),
      'updates retains letter fallback logo',
    )
    await shot('01c-png-and-fallback-summary-cards')
    await ui.details(logo.id)
    await ui.click(action('remove', logo.id))
    await app.until(
      async () =>
        !(await ui.exists(action('details', logo.id))) &&
        (await ui.exists('[data-plugin-action="install"]')),
      'PNG fixture removed',
    )
    await shot('01d-png-fixture-uninstalled')
    await ui.details('milkup.outline')
    assert((await observe()).manager.includes('1.3.1'))
    assert(
      await ui.exists(action('disable', 'milkup.outline')),
      'bundled outline automatically active',
    )
    await ui.details()
    assert(await ui.exists(action('enable')), 'bundled privileged updates starts inactive')
    assert(await ui.exists(action('approve')), 'bundled updates requires explicit approval')
    assert(!(await ui.exists(action('open-ui'))))
    await shot('02-updates-awaiting-approval')
    // Remove the bundled copy, then install the actual externally built artifact.
    await ui.click(action('remove'))
    await app.until(() => ui.exists('[data-plugin-action="install"]'), 'bundled updates removed')
    await ui.click('[data-plugin-action="install"]')
    await ui.picker(archive)
    await ui.ready(action('approve'))
    assert((await observe()).manager.includes('app:updates'))
    assert(await ui.exists(action('enable')))
    assert(!(await ui.exists(updateView)))
    await shot('03-external-gtk-installed-inactive', { archive })
    await ui.click(action('approve'))
    await ui.ready(action('revoke-approval'))
    assert(await ui.exists(action('enable')), 'approval alone does not activate')
    await ui.click(action('enable'))
    await ui.ready(action('disable'))
    await ui.click(`${action('open-ui')}[data-plugin-ui-id="updates-modal"]`)
    await ui.ready(updateCheck)
    await checkRelease()
    await shot('04-real-native-release-unconfigured')
    // Modal keyboard containment and Escape use shipped handlers.
    await app.focus(`${updateView} .plugin-ui-close`)
    await app.key('shift+Tab')
    await app.until(
      async () => (await observe()).activeCommand === 'updates.check',
      'Shift Tab wraps to last plugin action',
    )
    await app.key('Tab')
    await app.until(
      async () =>
        (await observe()).activeTag === 'BUTTON' && (await observe()).activeLabel === '关闭',
      'Tab wraps to modal close',
    )
    await app.key('Escape')
    await app.until(async () => !(await ui.exists(updateView)), 'Escape closes generic modal')
    await app.until(
      async () => (await observe()).activeAction === 'open-ui',
      'modal close restores generic entry focus',
    )
    await openUpdates()
  } else {
    await openUpdates()
    await checkRelease()
    await shot('resumed-real-native-release-unconfigured', {
      resume: 'Installation, approval and PNG evidence retained in updates-native-final',
    })
  }
  for (const theme of ['light', 'dark']) {
    for (const zoom of [1, 1.25, 1.5, 2]) {
      await appearance(theme, zoom)
      for (const width of [1100, 760]) {
        x('windowsize', ui.windowId(), String(width), width === 760 ? '520' : '760')
        await app.delay(250)
        await checkRelease()
        const dom = await observe()
        assert.equal(dom.cssZoom, '1', 'uses native WebView scale')
        assert.equal(dom.theme, theme)
        assert.equal(Number(dom.zoom), zoom)
        assert(
          dom.checkRect.top >= 0 && dom.checkRect.bottom <= dom.height - 3,
          'focused action remains inside viewport',
        )
        assert(
          dom.checkRect.left >= 0 && dom.checkRect.right <= dom.width,
          'focused action fits narrow viewport',
        )
        await shot(`${theme}-${width}-${zoom * 100}`)
      }
    }
  }
  await ui.closeModal()
  await app.key('ctrl+0')
  x('windowsize', ui.windowId(), '1100', '760')
  await ui.details()
  await ui.click(action('disable'))
  await ui.ready(action('enable'))
  assert(!(await ui.exists(action('open-ui'))), 'disable removes contributed entry')
  assert(!(await ui.exists(updateView)))
  await shot('05-disabled-contributions-removed')
  await editSave('DISABLED-', 'source')
  await ui.details()
  await ui.click(action('remove'))
  await app.until(() => ui.exists('[data-plugin-action="install"]'), 'updates uninstalled')
  assert(!(await ui.exists(action('details'))))
  await editSave('UNINSTALLED-', 'live')
  await shot('06-editing-after-uninstall')
  await app.close()
  await start()
  await ui.list()
  assert(
    !(await ui.exists(action('details'))),
    'uninstalled bundled plugin stays absent after restart',
  )
  await ui.closeMenu()
  // Durable recovery is independent of the removed updates plugin.
  await app.key('ctrl+1')
  await app.until(async () => (await app.probe()).mode === 'source', 'source for recovery')
  await app.focus('.milkup-input-proxy')
  await app.key('ctrl+Home')
  await app.text('RECOVER-')
  await app.until(
    () =>
      app.execute(
        'return document.querySelector("#app").dataset.recoveryPhase==="ready"&&Number(document.querySelector("#app").dataset.recoveryVersion)===Number(document.querySelector("[data-stat=version]").textContent)',
      ),
    'durable checkpoint after uninstall',
    30000,
  )
  const checkpoints = []
  const profile = process.env.MILKUP_RECOVERY_PROFILE
  for (const name of await readdir(profile)) {
    try {
      const directory = path.join(profile, name)
      const value = JSON.parse(await readFile(path.join(directory, 'manifest.json'), 'utf8'))
      if (value.originalPath === file && value.disposition === 'pending')
        checkpoints.push({ ...value, directory })
    } catch {}
  }
  const checkpoint = checkpoints.sort((a, b) => b.createdAt - a.createdAt)[0]
  assert(checkpoint)
  assert.equal(
    await readFile(path.join(checkpoint.directory, checkpoint.payload), 'utf8'),
    'RECOVER-' + expected,
  )
  const owner = await ownedApplication(app.application, file)
  const termination = await owner.signal('SIGKILL')
  await app.close()
  await start()
  await app.until(
    () => ui.exists(`[data-recovery-restore="${checkpoint.id}"]`),
    'shipped recovery prompt',
  )
  await ui.click(`[data-recovery-restore="${checkpoint.id}"]`)
  await app.until(
    async () =>
      (await app.probe()).path.includes('/copies/recovered-') &&
      (await app.probe()).loading === 'ready',
    'recovered copy opened',
    30000,
  )
  const recovered = (await app.probe()).path
  assert.equal(await readFile(recovered, 'utf8'), 'RECOVER-' + expected)
  assert.equal(await readFile(file, 'utf8'), expected, 'recovery preserves original file')
  await shot('07-recovered-without-update-plugin', {
    checkpoint: checkpoint.id,
    recovered,
    termination,
  })
  await ui.list()
  assert(!(await ui.exists(action('details'))))
  await ui.closeMenu()
  assert.equal((await app.probe()).dirty, false)
  await record('PASS', {
    matrixCases: 16,
    bytes: Buffer.byteLength(expected),
    archive,
    resumed: process.env.MILKUP_UPDATES_RESUME === '1',
  })
  console.log(
    process.env.MILKUP_UPDATES_RESUME === '1'
      ? 'PASS resumed update plugin: Worker/native IPC, 16 visual cases, disable/remove, editing/save/recovery; install/approval evidence retained in prior run'
      : 'PASS independent update plugin: GTK install, approval, Worker/native IPC, 16 visual cases, disable/remove, editing/save/recovery',
  )
} catch (error) {
  if (app) await shot('FAIL', { error: String(error), stack: error.stack }).catch(() => {})
  throw error
} finally {
  if (app) await app.close()
}

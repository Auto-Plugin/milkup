// Linux production smoke: dedicated profile/display, native keys/pointer, read-only DOM observations.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { startProduction } from '../helpers/native-production.mjs'
import { action, nativeFixture, x } from '../helpers/native-updates-fixture.mjs'

const required = (name) => (assert(process.env[name], `Set ${name}`), process.env[name])
const binary = await realpath(required('TAURI_APP_PATH'))
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex')
assert.equal(sha(await readFile(binary)), required('MILKUP_NATIVE_EXPECTED_BINARY_SHA256'))
assert(!binary.includes('/target/'), 'Use the frozen current-source binary copy')
assert.equal(required('MILKUP_NATIVE_EXCLUSIVE_DISPLAY'), '1')
assert(!process.env.WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS && !process.env.LD_PRELOAD)
const profile = await realpath(required('MILKUP_NATIVE_PROFILE_ROOT'))
for (const name of ['XDG_CONFIG_HOME', 'XDG_CACHE_HOME', 'XDG_DATA_HOME'])
  assert((await realpath(required(name))).startsWith(profile + path.sep))
const output = required('MILKUP_NATIVE_EVIDENCE_DIR')
await mkdir(output, { recursive: true })
const file = path.join(output, 'beta3-feedback.md')
await writeFile(file, '# Beta3 feedback\n\n## Second heading\n\nNative fixture.\n', { flag: 'wx' })
const matrixOnly = process.argv.includes('--matrix-only')
const smokeOnly = process.argv.includes('--smoke-only')
assert(!(matrixOnly && smokeOnly))
const matrixZooms = process.env.MILKUP_NATIVE_ZOOMS?.split(',').map(Number) ?? [1, 1.25, 1.5, 2]
assert(matrixZooms.every((zoom) => [1, 1.25, 1.5, 2].includes(zoom)))
const results = []
let app
const ui = nativeFixture(() => app)
const observe = () =>
  app.execute(
    `const a=document.querySelector('#app'),m=document.querySelector('[data-app-menu]'),r=document.querySelector('[data-recovery-status]');return {url:location.href,mode:document.querySelector('.milkup-editor')?.dataset.mode,theme:document.documentElement.dataset.theme,zoom:Number(a.dataset.appearanceZoom),width:innerWidth,height:innerHeight,menuVisible:!!m?.getClientRects().length,menuRect:m?.getBoundingClientRect().toJSON(),modal:document.querySelector('.plugin-ui-modal')?.dataset.pluginUi??null,focus:document.activeElement?.outerHTML.slice(0,600),recovery:{phase:a.dataset.recoveryPhase,text:r?.textContent,hidden:r?.hidden},panels:[...document.querySelectorAll('.plugin-ui-sidebar-panel')].map(e=>({id:e.dataset.pluginUi,rect:e.getBoundingClientRect().toJSON()}))}`,
  )
async function screenshot(name) {
  await app.shot(name + '-webdriver')
  execFileSync(
    '/usr/bin/import',
    ['-display', process.env.DISPLAY, '-window', 'root', path.join(output, name + '-system.png')],
    { env: process.env, timeout: 10000 },
  )
}
async function record(name, run) {
  const row = { name, passed: false }
  try {
    await run(row)
    row.after = await observe()
    await screenshot(name)
    row.passed = true
  } catch (error) {
    row.error = String(error)
    row.stack = error.stack
    row.after = await observe().catch(() => null)
    await screenshot(name + '-failure').catch(() => {})
  }
  results.push(row)
  await writeFile(
    path.join(output, 'results.json'),
    JSON.stringify(
      {
        binary,
        binarySha256: sha(await readFile(binary)),
        display: process.env.DISPLAY,
        profile,
        boundaries: [
          'Linux WebKit/X11 only, not Windows or OS DPI.',
          'Small normal document in source/live modes; native UI zoom.',
          'Helper focus is setup, not proof of Tab navigation.',
          'Read-only DOM observations; UI actions only; no injected plugin or IPC state.',
        ],
        results,
      },
      null,
      2,
    ),
  )
  assert(row.passed, `${name}: ${row.error}`)
}
async function closeOverlays() {
  for (let i = 0; i < 3; i++) {
    const s = await observe()
    if (!s.modal && !s.menuVisible) break
    await app.key('Escape')
  }
}
async function activate(id) {
  await ui.details(id)
  if (await ui.exists(action('approve', id))) await ui.click(action('approve', id))
  if (await ui.exists(action('enable', id))) await ui.click(action('enable', id))
  await ui.ready(action('disable', id))
}
async function pointerPoint(selector) {
  const point = await app.execute(
    `const e=document.querySelector(arguments[0]);const r=e.getBoundingClientRect();return {x:(r.left+r.right)/2,y:(r.top+r.bottom)/2,zoom:Number(document.querySelector('#app').dataset.appearanceZoom),hit:e.contains(document.elementFromPoint((r.left+r.right)/2,(r.top+r.bottom)/2))}`,
    selector,
  )
  assert(point.hit, 'Native pointer target must be visible and unobscured')
  return {
    x: Math.round(point.x * point.zoom),
    y: Math.round(point.y * point.zoom),
    zoom: point.zoom,
  }
}
async function pointerClick(selector) {
  const p = await pointerPoint(selector)
  x('mousemove', '--window', ui.windowId(), String(p.x), String(p.y), 'click', '1')
  await app.delay(100)
}
async function theme(value) {
  await ui.details('milkup.preferences')
  await ui.click(action('open-ui', 'milkup.preferences'))
  const panel = '[data-plugin-ui="milkup.preferences:preferences-panel"]'
  const control = panel + ' [data-plugin-field-control="appearance.theme"]'
  await ui.ready(control)
  await app.focus(control)
  const options = await app.execute(
    'return [...document.querySelector(arguments[0]).options].map(e=>e.value)',
    control,
  )
  await app.key('Home')
  for (let n = 0; n < options.indexOf(value); n++) await app.key('Down')
  await app.key('Tab')
  await ui.click(panel + ' button[aria-label="保存"]')
  await app.until(
    () =>
      app.execute(
        'return document.querySelector(arguments[0]).textContent.includes("偏好已保存")',
        panel,
      ),
    'theme saved',
  )
  await closeOverlays()
  await app.until(
    () => app.execute('return document.documentElement.dataset.theme===arguments[0]', value),
    'theme applied',
  )
}
try {
  app = await startProduction(file, output, { diagnostics: false })
  for (const id of ['milkup.preferences', 'milkup.outline', 'milkup.workspace']) await activate(id)
  await closeOverlays()
  if (!matrixOnly) {
    await record('card-toggle-focus', async (row) => {
      await ui.list()
      const selector = '.plugin-summary-card[data-plugin-id="milkup.outline"] [role="switch"]'
      await ui.ready(selector)
      await app.focus(selector)
      row.transitions = []
      for (const checked of ['false', 'true']) {
        await app.key('Return')
        await app.until(
          () =>
            app.execute(
              'const e=document.querySelector(arguments[0]);return e.getAttribute("aria-checked")===arguments[1]&&e.getAttribute("aria-busy")!=="true"',
              selector,
              checked,
            ),
          'toggle completed',
        )
        const state = await app.execute(
          'const e=document.querySelector(arguments[0]);return {checked:e.getAttribute("aria-checked"),focus:document.activeElement===e,disabled:e.disabled,menu:!!document.querySelector("[data-app-menu]").getClientRects().length}',
          selector,
        )
        row.transitions.push(state)
        assert(state.focus && state.menu && !state.disabled)
      }
      await screenshot('card-toggle-active')
      await closeOverlays()
    })
    await record('sidebar-pointer', async (row) => {
      await app.key('ctrl+n')
      await app.key('ctrl+o')
      await ui.picker(file)
      await app.until(
        async () => (await app.probe()).path === file,
        'document remounted through native file picker',
      )
      await ui.click('[data-sidebar-toggle]')
      const panels = (await observe()).panels
      assert(panels.length >= 2)
      const selector = `[data-plugin-ui="${panels[0].id}"] .plugin-ui-panel-resize`
      const before = panels[0].rect.height
      const point = await pointerPoint(selector)
      x('mousemove', '--window', ui.windowId(), String(point.x), String(point.y), 'mousedown', '1')
      x('mousemove', '--window', ui.windowId(), String(point.x), String(point.y + 50))
      await app.delay(100)
      x('mouseup', '1')
      row.before = panels
      row.afterDrag = (await observe()).panels
      assert(Math.abs(row.afterDrag[0].rect.height - before - 50 / point.zoom) <= 2)
      await app.focus(selector)
      await app.key('Down')
      assert(
        Math.abs((await observe()).panels[0].rect.height - row.afterDrag[0].rect.height - 16) <= 2,
      )
      await screenshot('sidebar-pointer-open')
      await ui.click('[data-sidebar-toggle]')
    })
    for (const entry of ['details', 'group'])
      await record('modal-' + entry, async (row) => {
        await ui.details('milkup.preferences')
        let opener = action('open-ui', 'milkup.preferences')
        if (entry === 'group') {
          await ui.list()
          await pointerClick('[data-plugin-menu-group] > summary')
          opener = '[data-plugin-menu-entry="milkup.preferences:preferences-panel"]'
        }
        await pointerClick(opener)
        await app.until(
          () => app.execute('return !!document.querySelector(".plugin-ui-modal")'),
          'modal opened',
        )
        assert((await observe()).menuVisible)
        await pointerClick('.plugin-ui-modal [data-plugin-field-control="editor.fontSize"]')
        row.open = await observe()
        await screenshot('modal-' + entry + '-open')
        await app.key('Escape')
        assert((await observe()).menuVisible)
        assert(
          await app.execute(
            'return document.activeElement===document.querySelector(arguments[0])',
            opener,
          ),
        )
        await closeOverlays()
      })
  }
  for (const value of smokeOnly ? ['light'] : ['light', 'dark']) {
    await theme(value)
    for (const mode of smokeOnly ? ['live'] : ['source', 'live'])
      for (const width of smokeOnly ? [1280] : [1280, 760])
        for (const zoom of smokeOnly ? [1] : matrixZooms) {
          await record(`menu-${value}-${mode}-${width}-${zoom}`, async () => {
            await closeOverlays()
            await app.key(mode === 'source' ? 'ctrl+1' : 'ctrl+2')
            await app.key('ctrl+0')
            await app.until(
              () =>
                app.execute(
                  'return Number(document.querySelector("#app").dataset.appearanceZoom)===1',
                ),
              'zoom reset',
            )
            for (let step = 0; step < [1, 1.25, 1.5, 2].indexOf(zoom); step++) {
              await app.key('ctrl+equal')
              await app.until(
                () =>
                  app.execute(
                    'return Number(document.querySelector("#app").dataset.appearanceZoom)===arguments[0]',
                    [1.25, 1.5, 2][step],
                  ),
                'native zoom increment',
              )
            }
            x('windowsize', ui.windowId(), String(width), '800')
            await app.until(
              () =>
                app.execute(
                  'return Math.abs(innerWidth*arguments[0]-arguments[1])<3&&Number(document.querySelector("#app").dataset.appearanceZoom)===arguments[0]',
                  zoom,
                  width,
                ),
              'window and zoom',
            )
            await ui.menu()
            const state = await observe()
            assert.equal(state.mode, mode)
            assert.equal(state.theme, value)
            assert(Math.abs(state.menuRect.x) < 1 && Math.abs(state.menuRect.y) < 1)
            assert(
              Math.abs(state.menuRect.width - state.width) < 2 &&
                Math.abs(state.menuRect.height - state.height) < 2,
            )
          })
        }
  }
  if (!matrixOnly)
    await record('recovery-backup-not-save', async (row) => {
      await closeOverlays()
      await app.key('ctrl+0')
      x('windowsize', ui.windowId(), '1280', '800')
      await app.key('ctrl+1')
      await app.focus('.milkup-input-proxy')
      await app.text('Unsaved native recovery probe. ')
      await app.until(
        () =>
          app.execute(
            `const a=document.querySelector("#app");return a.dataset.recoveryPhase==="ready"&&Number(a.dataset.recoveryVersion)===Number(document.querySelector('[data-stat="version"]').textContent)`,
          ),
        'recovery backup complete',
        30000,
      )
      row.state = await observe()
      assert.equal(row.state.recovery.text, '')
      assert.equal(row.state.recovery.hidden, true)
      assert.equal((await app.probe()).dirty, true)
      assert.equal(
        await readFile(file, 'utf8'),
        '# Beta3 feedback\n\n## Second heading\n\nNative fixture.\n',
      )
      await app.key('ctrl+s')
      await app.until(async () => !(await app.probe()).dirty, 'explicit file save')
    })
} finally {
  await app?.close()
}
console.log(`BETA3 NATIVE ${results.length} checks passed`)

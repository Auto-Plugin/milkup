// Bounded Linux native continuation: an existing synthetic profile, no plugin imports.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { startProduction } from '../helpers/native-production.mjs'
import { action, nativeFixture, x } from '../helpers/native-updates-fixture.mjs'
const required = (name) => (assert(process.env[name], `Set ${name}`), process.env[name])
const binary = await realpath(required('TAURI_APP_PATH'))
const binarySha256 = createHash('sha256')
  .update(await readFile(binary))
  .digest('hex')
assert.equal(binarySha256, required('MILKUP_NATIVE_EXPECTED_BINARY_SHA256'))
assert.equal(required('MILKUP_NATIVE_EXCLUSIVE_DISPLAY'), '1')
assert(!process.env.WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS && !process.env.LD_PRELOAD)
const profile = await realpath(required('MILKUP_NATIVE_PROFILE_ROOT'))
for (const name of ['XDG_CONFIG_HOME', 'XDG_CACHE_HOME', 'XDG_DATA_HOME'])
  assert((await realpath(required(name))).startsWith(profile + path.sep))
const output = required('MILKUP_NATIVE_EVIDENCE_DIR')
await mkdir(output, { recursive: true })
const file = path.join(output, 'narrow-actions.md')
await writeFile(file, '# Native narrow actions\n', { flag: 'wx' })
const result = {
  binary,
  binarySha256,
  profile,
  passed: false,
  boundaries: [
    'Linux WebKit, native application zoom; not Windows or OS DPI.',
    'Initial switch focus is setup; subsequent navigation uses native Tab, Return, Escape and wheel.',
  ],
}
let app
const ui = nativeFixture(() => app)
const inspect = (selector) =>
  app.execute(
    `
  const e=document.querySelector(arguments[0]);if(!e)return null;
  const r=e.getBoundingClientRect(),hit=document.elementFromPoint((r.left+r.right)/2,(r.top+r.bottom)/2);
  const clips=[];for(let p=e.parentElement;p;p=p.parentElement){const s=getComputedStyle(p),q=p.getBoundingClientRect();if((s.overflowY!=='visible'&&(r.top<q.top||r.bottom>q.bottom))||(s.overflowX!=='visible'&&(r.left<q.left||r.right>q.right)))clips.push(p.className)}
  return {text:e.textContent,rect:r.toJSON(),focus:document.activeElement===e,hit:e.contains(hit),hitHtml:hit?.outerHTML.slice(0,400),clips,visible:r.width>0&&r.height>0&&r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight&&getComputedStyle(e).visibility==='visible',zoom:Number(document.querySelector('#app').dataset.appearanceZoom),width:innerWidth,height:innerHeight,theme:document.documentElement.dataset.theme};
`,
    selector,
  )
const visible = (r) => r && r.visible && r.hit && r.clips.length === 0
async function shot(name) {
  await app.shot(name + '-webdriver')
  execFileSync(
    '/usr/bin/import',
    ['-display', process.env.DISPLAY, '-window', 'root', path.join(output, name + '-system.png')],
    { env: process.env, timeout: 10000 },
  )
}
try {
  app = await startProduction(file, output, { diagnostics: false })
  await app.key('ctrl+2')
  await app.key('ctrl+0')
  await app.until(
    () => app.execute('return Number(document.querySelector("#app").dataset.appearanceZoom)===1'),
    'native zoom reset',
  )
  for (const zoom of [1.25, 1.5, 2]) {
    await app.key('ctrl+equal')
    await app.until(
      () =>
        app.execute(
          'return Number(document.querySelector("#app").dataset.appearanceZoom)===arguments[0]',
          zoom,
        ),
      'native zoom increment',
    )
  }
  x('windowsize', ui.windowId(), '760', '520')
  await app.until(
    () => app.execute('return innerWidth===380&&innerHeight===260'),
    '760x520 at 200 percent',
  )
  await ui.list()
  const toggle = '.plugin-summary-card[data-plugin-id="milkup.preferences"] [role="switch"]'
  const panel = action('open-ui', 'milkup.preferences')
  await ui.ready(toggle)
  assert.equal(
    await app.execute(
      'return document.querySelector(arguments[0]).getAttribute("aria-checked")',
      toggle,
    ),
    'true',
  )
  await app.focus(toggle)
  await app.key('Tab')
  await app.until(async () => {
    result.panelAction = await inspect(panel)
    return result.panelAction?.focus && visible(result.panelAction)
  }, 'native Tab reveals card panel action')
  await shot('card-panel-tab-focused')
  await app.key('Return')
  await app.until(
    () =>
      app.execute('return !!document.querySelector(".plugin-ui-modal")?.getClientRects().length'),
    'Return opens preferences modal',
  )
  await shot('card-panel-modal')
  await app.key('Escape')
  await app.until(async () => {
    result.returnedAction = await inspect(panel)
    return result.returnedAction?.focus && visible(result.returnedAction)
  }, 'Escape restores visible opener focus')
  assert.equal(await app.execute('return document.querySelectorAll(".plugin-ui-modal").length'), 0)
  await shot('card-panel-escape-focus')
  await ui.click('[data-menu-section="about"]')
  await app.key('Tab')
  const check = '[data-app-version] + [data-application-update-action="check"]'
  await app.until(async () => {
    result.checkAction = await inspect(check)
    return result.checkAction?.focus && visible(result.checkAction)
  }, 'native Tab reaches About check')
  await shot('about-check-tab-focused')
  await app.key('Return')
  const status = '[data-application-updates] .application-update-status'
  await app.until(
    () =>
      app.execute(
        'return document.querySelector(arguments[0])?.textContent.includes("尚未配置在线更新渠道")',
        status,
      ),
    'unconfigured status',
  )
  for (let step = 0; step < 6; step++) {
    result.aboutStatus = await inspect(status)
    if (visible(result.aboutStatus)) break
    x('mousemove', '--window', ui.windowId(), '420', '400', 'click', '5')
    await app.delay(150)
  }
  result.aboutStatus = await inspect(status)
  assert(visible(result.aboutStatus), 'Native wheel reveals the complete About status')
  await shot('about-unconfigured-native-wheel')
  result.passed = true
} catch (error) {
  result.error = String(error)
  result.stack = error.stack
  result.failureState = await app
    ?.execute(
      'return {zoom:document.querySelector("#app")?.dataset.appearanceZoom,width:innerWidth,height:innerHeight,focus:document.activeElement?.outerHTML.slice(0,500)}',
    )
    .catch(() => null)
  await shot('failure').catch(() => {})
} finally {
  await writeFile(path.join(output, 'results.json'), JSON.stringify(result, null, 2))
  await app?.close()
}
assert(result.passed, result.error)
console.log('BETA4 NATIVE NARROW ACTIONS passed')

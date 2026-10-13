// Extra production states; native file picker responses use the existing path seam.
// Diagnostic CSS magnification is not an implemented app zoom or OS DPI test.
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { startProduction } from '../helpers/native-production.mjs'
const root = process.env.MILKUP_NATIVE_EVIDENCE_DIR ?? '/tmp/milkup-v2-phase16/production-states'
await mkdir(root, { recursive: true })
const file = path.join(root, 'review.md')
await writeFile(file, '# 普通正文\n\n中文 English `code`\n')
const app = await startProduction(file, root)
const env = { ...process.env, DISPLAY: process.env.DISPLAY ?? ':99' },
  results = []
let previousPaths
const shot = async (name, wait = 500) => {
  await app.delay(wait)
  execFileSync('import', ['-window', 'root', path.join(root, name + '.png')], { env })
  results.push({
    name,
    state: await app.probe(),
    dom: await app.execute(
      `return {focus:document.activeElement.outerHTML.slice(0,300),width:innerWidth,height:innerHeight,zoom:getComputedStyle(document.documentElement).zoom,dialog:document.querySelector('.confirm-dialog').getBoundingClientRect().toJSON(),loading:!document.querySelector('[data-document-loading]').hidden}`,
    ),
  })
}
try {
  previousPaths = await app.execute('return localStorage.getItem("milkup.desktop.nativeTestPaths")')
  await app.click('[data-menu-toggle]')
  await app.click('[data-menu-section="appearance"]')
  await shot('appearance-support-boundary')
  await app.click('[data-menu-section="shortcuts"]')
  await shot('keyboard-help')
  await app.key('Escape')
  await app.until(
    () => app.execute('return document.activeElement.matches(".milkup-input-proxy")'),
    'editor focus',
  )
  await app.execute(
    'localStorage.setItem("milkup.desktop.nativeTestPaths",JSON.stringify({open:arguments[0]}))',
    path.join(root, 'missing.md'),
  )
  await app.key('ctrl+o')
  await app.until(async () => (await app.probe()).loading === 'failed', 'native open failure')
  await app.until(
    () => app.execute('return document.activeElement.matches("[data-loading-dismiss]")'),
    'failure dismiss focus',
  )
  await shot('native-open-error')
  await app.key('Escape')
  await app.until(
    () => app.execute('return document.activeElement.matches(".milkup-input-proxy")'),
    'error returns focus',
  )
  await app.text('X')
  await app.until(async () => (await app.probe()).dirty, 'edit')
  await app.key('ctrl+n')
  await app.until(
    () => app.execute('return !document.querySelector("[data-close-confirm]").hidden'),
    'dialog',
  )
  const id = execFileSync('xdotool', ['search', '--class', 'milkup-desktop'], {
    env,
    encoding: 'utf8',
  })
    .trim()
    .split('\n')
    .at(-1)
  execFileSync('xdotool', ['windowsize', id, '760', '520'], { env })
  await app.until(() => app.execute('return innerWidth===760'), 'resize')
  for (const scale of [1.25, 1.5, 2]) {
    await app.execute(
      `document.documentElement.style.zoom=arguments[0];document.querySelector('.desktop-shell').style.height=(innerHeight/arguments[0])+'px';document.querySelector('.desktop-shell').style.width=(innerWidth/arguments[0])+'px'`,
      scale,
    )
    await app.focus('.dialog-button[data-close-confirm-action="cancel"]')
    await app.key('Tab')
    await app.key('Tab')
    await app.until(
      () =>
        app.execute('return document.activeElement.matches("[data-close-confirm-action=save]")'),
      'save reachable',
    )
    await shot('diagnostic-narrow-dialog-' + scale)
    assert(
      await app.execute(
        'const r=document.querySelector(".confirm-dialog").getBoundingClientRect(),b=document.activeElement.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight+1&&b.top>=0&&b.bottom<=innerHeight+1',
      ),
    )
  }
  await app.execute(
    `document.documentElement.style.removeProperty('zoom');document.querySelector('.desktop-shell').style.removeProperty('height');document.querySelector('.desktop-shell').style.removeProperty('width')`,
  )
  await app.key('Escape')
  if (process.env.MILKUP_VISUAL_LOADING_FIXTURE) {
    await app.execute(
      'localStorage.setItem("milkup.desktop.nativeTestPaths",JSON.stringify({open:arguments[0]}))',
      process.env.MILKUP_VISUAL_LOADING_FIXTURE,
    )
    await app.key('ctrl+o')
    await app.until(
      () => app.execute('return !document.querySelector("[data-close-confirm]").hidden'),
      'discard prompt',
    )
    await app.execute(
      `window.__visualLoading=[];new MutationObserver(()=>window.__visualLoading.push({at:performance.now(),phase:document.querySelector('#app').dataset.loading,visible:!document.querySelector('[data-document-loading]').hidden})).observe(document.querySelector('#app'),{attributes:true,attributeFilter:['data-loading']})`,
    )
    await app.click('[data-close-confirm-action="discard"]')
    await app.until(async () => {
      const p = await app.probe()
      return p.loading === 'indexing' || p.path === process.env.MILKUP_VISUAL_LOADING_FIXTURE
    }, 'open started')
    await app.until(
      () =>
        app.execute(
          'return !document.querySelector("[data-document-loading]").hidden || document.querySelector("#app").dataset.loading==="ready"',
        ),
      'loading visibility or ready',
    )
    await shot('large-open-observed', 0)
    await app.until(
      async () => {
        const p = await app.probe()
        return p.path === process.env.MILKUP_VISUAL_LOADING_FIXTURE && p.loading === 'ready'
      },
      'large open ready',
      20000,
    )
    results.push({ loadingPhases: await app.execute('return window.__visualLoading') })
  }
  await writeFile(
    path.join(root, 'results.json'),
    JSON.stringify({ ok: true, results }, null, 2) + '\n',
  )
} catch (error) {
  await shot('failure').catch(() => {})
  await writeFile(
    path.join(root, 'results.json'),
    JSON.stringify({ ok: false, error: String(error), results }, null, 2) + '\n',
  )
  throw error
} finally {
  await app
    .execute(
      'if(arguments[0]===null)localStorage.removeItem("milkup.desktop.nativeTestPaths");else localStorage.setItem("milkup.desktop.nativeTestPaths",arguments[0])',
      previousPaths ?? null,
    )
    .catch(() => {})
  await app.close()
}

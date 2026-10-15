// Production binary only: real window keys, shipped controls and read-only DOM probes.
// It verifies the unconfigured release channel; no endpoint/key/IPC mock is injected.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import path from 'node:path'
import { startProduction } from '../helpers/native-production.mjs'

const output = process.env.MILKUP_NATIVE_EVIDENCE_DIR
assert(output)
await mkdir(output, { recursive: true })
const file = path.join(output, 'update-review.md')
const original = '# 更新验收\r\n\r\n保留正文 中文 👩🏽‍💻。\r\n'
await writeFile(file, original)
const app = await startProduction(file, output)
const results = []
const x = (...args) => execFileSync('xdotool', args, { encoding: 'utf8', env: process.env }).trim()
const windowId = x('search', '--class', 'milkup-desktop').split('\n').at(-1)
x('windowfocus', '--sync', windowId)
const observe = () =>
  app.execute(`return {
  width:innerWidth,height:innerHeight,ratio:devicePixelRatio,
  checkRect:document.querySelector('[data-update-check]')?.getBoundingClientRect().toJSON(),
  version:document.querySelector('[data-app-version]')?.textContent,
  status:document.querySelector('[data-update-status]')?.textContent,
  about:document.querySelector('[data-menu-panel="about"]')?.textContent,
  cssZoom:getComputedStyle(document.documentElement).zoom,
  focus:document.activeElement?.outerHTML.slice(0,200),
  panelScroll:document.querySelector('[data-menu-panel="about"]')?.scrollHeight,
  panelHeight:document.querySelector('[data-menu-panel="about"]')?.clientHeight
}`)
async function shot(name) {
  await app.delay(200)
  await app.shot(name + '-webview')
  execFileSync('import', ['-window', 'root', path.join(output, name + '-x11.png')], {
    env: process.env,
  })
  results.push({ name, dom: await observe(), document: await app.probe() })
  await writeFile(path.join(output, 'results.json'), JSON.stringify(results, null, 2) + '\n')
}
try {
  await app.click('[data-menu-toggle]')
  await app.click('[data-menu-section="about"]')
  if (process.env.MILKUP_UPDATE_BASELINE === '1') {
    assert((await observe()).about.includes('0.1.0'))
    await shot('baseline-about')
  } else {
    assert.equal((await observe()).version, '2.0.0-beta.1')
    await app.click('[data-update-check]')
    // XTest delivery is asynchronous; do not mistake the previous result for the new check.
    await app.delay(150)
    await app.until(
      async () => (await observe()).status.includes('尚未开放'),
      'honest unconfigured channel',
    )
    await shot('update-unavailable-wide')
    for (const theme of ['light', 'dark']) {
      for (const zoom of [1, 1.25, 1.5, 2]) {
        for (const width of [1100, 760]) {
          await app.click('[data-menu-section="appearance"]')
          await app.focus('[data-appearance-theme]')
          await app.key(theme === 'dark' ? 'End' : 'Home')
          await app.until(
            () =>
              app.execute(
                'return document.querySelector("[data-appearance-theme]").value===arguments[0]&&!document.querySelector("[data-appearance-theme]").disabled',
                theme === 'dark' ? 'dark' : 'system',
              ),
            'theme selection applied',
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
            'theme ready',
          )
          await app.key('ctrl+0')
          await app.until(
            () =>
              app.execute(
                'return document.querySelector("#app").dataset.appearanceZoom==="1"&&!document.querySelector("[data-appearance-zoom]").disabled',
              ),
            'reset zoom',
          )
          for (let n = 0; n < [1, 1.25, 1.5, 2].indexOf(zoom); n++) {
            await app.key('ctrl+plus')
            await app.until(
              () =>
                app.execute(
                  'return Number(document.querySelector("#app").dataset.appearanceZoom)===arguments[0]&&!document.querySelector("[data-appearance-zoom]").disabled',
                  [1.25, 1.5, 2][n],
                ),
              'native zoom applied',
            )
          }
          x('windowsize', windowId, String(width), width === 760 ? '520' : '760')
          await app.delay(200)
          await app.click('[data-menu-section="about"]')
          await app.click('[data-update-check]')
          // XTest delivery is asynchronous; do not mistake the previous result for the new check.
          await app.delay(150)
          await app.until(
            async () => (await observe()).status.includes('尚未开放'),
            'completed channel check',
          )
          const dom = await observe()
          assert.equal(dom.cssZoom, '1', 'uses native WebView scaling, not CSS zoom')
          assert(dom.status.includes('尚未开放'))
          assert(dom.focus.includes('data-update-check'))
          await shot(`${theme}-${width}-${zoom * 100}`)
          assert(
            dom.checkRect.top >= 0 && dom.checkRect.bottom <= dom.height - 4,
            'focused update button and focus ring must be fully visible',
          )
        }
      }
    }
    await app.key('Escape')
    await app.key('ctrl+0')
    for (const mode of ['source', 'live']) {
      await app.key(mode === 'source' ? 'ctrl+1' : 'ctrl+2')
      await app.focus('.milkup-input-proxy')
      await app.key('ctrl+Home')
      await app.text('SAFE-')
      await app.key('ctrl+z')
      await app.key('ctrl+shift+z')
      await app.key('ctrl+s')
      await app.until(
        async () => !(await app.probe()).dirty,
        'save remains usable after update check',
      )
    }
    assert.equal(await readFile(file, 'utf8'), 'SAFE-SAFE-' + original)
    await shot('editing-after-check')
  }
  assert.equal((await app.probe()).dirty, false)
  console.log('PASS production update UI and document preservation')
} finally {
  await app.close()
}

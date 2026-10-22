import assert from 'node:assert/strict'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { startProduction } from '../helpers/native-production.mjs'
import { nativeFixture, action } from '../helpers/native-updates-fixture.mjs'
const output = process.env.MILKUP_NATIVE_EVIDENCE_DIR
assert(output?.startsWith('/tmp/'))
await mkdir(output, { recursive: true })
const file = path.join(output, 'already-open.md')
const source = '# Hot lifecycle\n\n```mermaid\nflowchart TD\nA[Start] --> B[End]\n```\n\nOutside\n'
await writeFile(file, source, { flag: 'wx' })
assert.equal(
  createHash('sha256')
    .update(await readFile(process.env.TAURI_APP_PATH))
    .digest('hex'),
  process.env.MILKUP_NATIVE_EXPECTED_BINARY_SHA256,
)
let app
const ui = nativeFixture(() => app),
  rows = []
const toggle = '.plugin-summary-card[data-plugin-id="milkup.diagrams"] [role="switch"]'
const state = () =>
  app.execute(
    `return {mode:document.querySelector('.milkup-editor')?.dataset.mode,cursor:document.querySelector('.milkup-cursor')?.dataset.position,focus:document.activeElement?.outerHTML.slice(0,400),menu:!!document.querySelector('[data-app-menu]')?.getClientRects().length,vector:[...document.querySelectorAll('.milkup-document-presentation svg text')].map(e=>e.textContent),notice:document.querySelector('[data-document-presentation-notice]')?.textContent,source:[...document.querySelectorAll('.milkup-code-source')].map(e=>e.textContent),card:document.querySelector(arguments[0])?.outerHTML}`,
    toggle,
  )
async function record(name) {
  const row = { name, state: await state() }
  rows.push(row)
  await app.shot(name)
  await writeFile(
    path.join(output, 'lifecycle.json'),
    JSON.stringify(
      {
        binary: process.env.TAURI_APP_PATH,
        source,
        rows,
        boundary:
          'Linux production baseline, real Worker and native UI; read-only DOM observations; no Windows verification',
      },
      null,
      2,
    ) + '\n',
  )
  console.log(name, JSON.stringify(row.state))
}
async function change(enabled) {
  await ui.list()
  await ui.ready(toggle)
  const old = await app.execute(
    'return document.querySelector(arguments[0]).getAttribute("aria-checked")==="true"',
    toggle,
  )
  if (old !== enabled) await ui.click(toggle)
  await app.until(
    () =>
      app.execute(
        'const e=document.querySelector(arguments[0]);return e?.getAttribute("aria-checked")===arguments[1]&&e?.getAttribute("aria-busy")!=="true"',
        toggle,
        String(enabled),
      ),
    'toggle settled',
  )
}
try {
  app = await startProduction(file, output)
  await app.key('ctrl+2')
  await record('01-document-open-before-enable')
  // Replace only this isolated profile's bundled Linux DOM candidate, through shipped UI.
  await ui.list()
  if (await ui.exists(toggle)) {
    await ui.click('.plugin-summary-card[data-plugin-id="milkup.diagrams"] summary')
    await ui.click(action('remove', 'milkup.diagrams'))
    await app.until(async () => !(await ui.exists(toggle)), 'test-profile old candidate removed')
  }
  await ui.click('[data-plugin-action="install"]')
  await ui.picker(process.env.MILKUP_NATIVE_DIAGRAMS_ARCHIVE)
  await app.until(() => ui.exists('[data-plugin-action="back"]'), 'import details')
  await change(true)
  await ui.closeMenu()
  await app.delay(700)
  await record('02-enabled-with-caret-outside')
  assert.deepEqual((await state()).vector, ['Start', 'End'])
  await change(false)
  await ui.closeMenu()
  await app.delay(500)
  await record('03-disabled-without-restart')
  assert.equal((await state()).vector.length, 0)
  await app.focus('.milkup-input-proxy')
  await app.key('ctrl+Home')
  await app.key('Down')
  await app.key('Down')
  await app.key('Down')
  await record('04-caret-in-source-block')
  await change(true)
  await app.delay(700)
  await record('05-enabled-while-plugin-page-focused')
  await ui.closeMenu()
  await app.delay(700)
  await record('06-return-document-same-caret')
  await app.focus('.milkup-input-proxy')
  await app.key('ctrl+End')
  await app.delay(700)
  await record('07-move-outside-without-restart')
  assert.deepEqual((await state()).vector, ['Start', 'End'])
  assert.equal(await readFile(file, 'utf8'), source)
} finally {
  await app?.close()
}

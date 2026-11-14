// Production follow-up after tauri-application-update.mjs removed the updates
// plugin. Reuse its dedicated driver/profile; no mocked IPC or editor mutation.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { startProduction } from '../helpers/native-production.mjs'
import { action, evidenceRoot, nativeFixture, x } from '../helpers/native-updates-fixture.mjs'

const output =
  process.env.MILKUP_NATIVE_EVIDENCE_DIR || path.join(evidenceRoot, 'windowed-native-after')
await mkdir(output, { recursive: true })
const file = path.join(output, 'windowed-integrity.md')
const original =
  'Windowed native integrity\r\n\r\n' +
  Array.from(
    { length: 18000 },
    (_, index) =>
      `Line ${String(index).padStart(5, '0')} — 中文 👩🏽‍💻 é ${'preserved text '.repeat(8)}\r\n`,
  ).join('')
await writeFile(file, original)
let expected = original
const app = await startProduction(file, output)
const ui = nativeFixture(() => app)
const results = []
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex')
const state = async () => ({
  document: await app.probe(),
  dom: await app.execute(
    `return {windowed:!!document.querySelector('.milkup-source-document-view'),textRows:document.querySelectorAll('.milkup-line').length,updates:!!document.querySelector('[data-plugin-ui="milkup.updates:updates-modal"]'),diagnostics:window.__productionDiagnostics}`,
  ),
})
async function capture(name, extra = {}) {
  await app.delay(650)
  await app.shot(name + '-webview')
  execFileSync('import', ['-window', 'root', path.join(output, name + '-x11.png')], {
    env: process.env,
  })
  results.push({ name, ...extra, ...(await state()) })
  await writeFile(path.join(output, 'results.json'), JSON.stringify(results, null, 2) + '\n')
}
async function mode(value) {
  await app.key(value === 'source' ? 'ctrl+1' : 'ctrl+2')
  await app.until(async () => (await app.probe()).mode === value, value + ' mode ready')
  assert((await state()).dom.windowed, 'large document remains on the windowed branch')
}
const range = (probe) => ({
  cursor: probe.cursor,
  from: Math.min(...probe.selection.map((item) => item.from)),
  to: Math.max(...probe.selection.map((item) => item.to)),
})
try {
  await app.key('ctrl+0')
  x('windowsize', ui.windowId(), '1100', '760')
  await ui.list()
  assert(!(await ui.exists(action('details'))), 'updates remains uninstalled in reused profile')
  await ui.closeMenu()
  await mode('source')
  await app.focus('.milkup-input-proxy')
  await app.key('ctrl+Home')
  await app.key('Right')
  await app.key('Right')
  await app.key('Right')
  for (let index = 0; index < 5; index++) await app.key('shift+Right')
  const selection = await app.until(async () => {
    const selected = range(await app.probe())
    return selected.from === 3 && selected.to === 8 ? selected : false
  }, 'complete native keyboard selection')
  assert.equal(selection.from, 3)
  assert.equal(selection.to, 8)
  await capture('01-source-selection', { selection })
  await mode('live')
  await app.until(
    async () => JSON.stringify(range(await app.probe())) === JSON.stringify(selection),
    'selection and cursor preserved in live mode',
  )
  await capture('02-live-selection-preserved', { selection })
  await mode('source')
  await app.until(
    async () => JSON.stringify(range(await app.probe())) === JSON.stringify(selection),
    'selection and cursor preserved back in source mode',
  )
  for (const value of ['source', 'live']) {
    await mode(value)
    await app.focus('.milkup-input-proxy')
    await app.key('ctrl+Home')
    const prefix = value === 'source' ? 'SOURCE-' : 'LIVE-'
    await app.text(prefix)
    await app.until(async () => (await app.probe()).dirty, value + ' edit accepted')
    await app.key('ctrl+z')
    await app.key('ctrl+shift+z')
    await app.key('ctrl+s')
    expected = prefix + expected
    await app.until(
      async () => !(await app.probe()).dirty && (await readFile(file, 'utf8')) === expected,
      value + ' full byte-exact save',
      30000,
    )
    const bytes = await readFile(file)
    assert.deepEqual(bytes, Buffer.from(expected))
    assert(!/(^|[^\r])\n/.test(bytes.toString()), 'every line ending remains CRLF')
    await capture(`03-${value}-undo-redo-saved`, { bytes: bytes.length, sha256: hash(bytes) })
  }
  await app.focus('.milkup-input-proxy')
  await app.key('ctrl+End')
  await app.until(
    async () => (await app.probe()).cursor === expected.length,
    'windowed tail cursor reaches exact UTF-16 document length',
  )
  await capture('04-windowed-tail', { characters: expected.length })
  await ui.list()
  assert(!(await ui.exists(action('details'))))
  assert.equal(await readFile(file, 'utf8'), expected)
  console.log(
    'PASS production windowed source/live: plugin absent, selection/cursor preserved, undo/redo/save and complete Unicode/CRLF byte integrity',
  )
} catch (error) {
  await capture('FAIL', { error: String(error), stack: error.stack }).catch(() => {})
  throw error
} finally {
  await app.close()
}

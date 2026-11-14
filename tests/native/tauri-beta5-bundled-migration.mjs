// Linux-only real UI acceptance using an exact copy of the synthetic beta.4 profile.
import assert from 'node:assert/strict'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { startProduction } from '../helpers/native-production.mjs'
import { beta5Fixture, observeBeta5 } from '../helpers/native-beta5-fixture.mjs'
const root = process.env.MILKUP_NATIVE_PROFILE_ROOT,
  out = process.env.MILKUP_NATIVE_EVIDENCE_DIR
assert(root?.startsWith('/tmp/milkup-beta5-migration/'))
assert(out?.startsWith('/tmp/milkup-beta5-migration/'))
const sha = (b) => createHash('sha256').update(b).digest('hex')
assert.equal(
  sha(await readFile(process.env.TAURI_APP_PATH)),
  process.env.MILKUP_NATIVE_EXPECTED_BINARY_SHA256,
)
await mkdir(out, { recursive: true })
const source =
  '# Preserved test profile\n\n```mermaid\nflowchart TD\nA[Start] --> B[End]\n```\n\n| Name | Value |\n| --- | --- |\n| Alpha | 1 |\n\nOutside\n'
const file = path.join(out, 'migration.md')
await writeFile(file, source, { flag: 'wx' })
const catalogPath = path.join(
  process.env.XDG_DATA_HOME,
  'app.milkup.desktop/plugins/catalog-v1.json',
)
const readCatalog = async () => JSON.parse(await readFile(catalogPath, 'utf8'))
const entry = (d, id) => d.payload.entries.find((e) => e.id === id)
const initialBytes = await readFile(catalogPath),
  before = await readCatalog()
assert.equal(entry(before, 'milkup.formatting').pending.generation.manifest.version, '1.0.0')
assert.equal(
  entry(before, 'milkup.formatting').pending.generation.sourcePath,
  'bundled:milkup.formatting-1.0.0.milkup-plugin',
)
assert.equal(entry(before, 'milkup.diagrams').active.manifest.version, '1.2.0')
await writeFile(path.join(out, 'before-catalog.json'), initialBytes)
const rows = []
let app, ui
const card = '.plugin-summary-card[data-plugin-id="milkup.formatting"]'
const toggle = card + ' [role="switch"]'
const observe = async (name, details = {}) => {
  const bytes = await readFile(file)
  rows.push({
    name,
    ...details,
    state: await observeBeta5(app),
    probe: await app.probe(),
    disk: { bytes: bytes.length, sha256: sha(bytes) },
    catalog: await readCatalog(),
  })
  await app.shot(name)
  execFileSync(
    '/usr/bin/import',
    ['-display', process.env.DISPLAY, '-window', 'root', path.join(out, name + '-system.png')],
    { env: process.env, timeout: 10000 },
  )
  await writeFile(
    path.join(out, 'migration.json'),
    JSON.stringify(
      {
        binary: process.env.TAURI_APP_PATH,
        sha256: process.env.MILKUP_NATIVE_EXPECTED_BINARY_SHA256,
        beforeCatalogSha256: sha(initialBytes),
        source,
        rows,
        boundary:
          'Real Linux production UI using a copied synthetic beta4 profile. Historical bundled Formatting pending 1.0.0 -> 1.0.1, retained independently imported Diagrams Worker, restart and ordinary Live table edit/Save/undo/context/unload. Not a real Windows installer/DOM migration.',
      },
      null,
      2,
    ) + '\n',
  )
}
async function expectEnabled() {
  await app.until(
    () =>
      app.execute(
        'const e=document.querySelector(arguments[0]);return e?.getAttribute("aria-checked")==="true"&&e?.getAttribute("aria-busy")!=="true"',
        toggle,
      ),
    'formatting enabled',
  )
}
async function tableContext(visible) {
  let signature, stableSince
  return app.until(
    async () => {
      const state = await observeBeta5(app)
      if (!visible)
        return (
          !state.toolbar.formattingVisible &&
          !state.toolbar.visible &&
          state.toolbar.rect.height === 0 &&
          state.toolbar.display === 'none'
        )
      const ready =
        state.toolbar.formattingVisible &&
        state.toolbar.commands.some(
          (command) =>
            command.command === 'formatting.tableAddRow' && command.visible && !command.disabled,
        ) &&
        (await app.execute(
          'return document.querySelector("[data-editor-host]")?.getAttribute("aria-busy")==="false"',
        ))
      const next = ready ? JSON.stringify([state.toolbar, state.cursor, state.editor]) : undefined
      if (!next || next !== signature) stableSince = Date.now()
      signature = next
      return next && Date.now() - stableSince >= 300
    },
    visible ? 'stable current ordinary table toolbar' : 'table toolbar and empty host row hidden',
  )
}
async function saveExact(expected) {
  await app.key('ctrl+s')
  await app.until(async () => {
    const probe = await app.probe()
    return !probe.dirty && !probe.saving && (await readFile(file)).equals(Buffer.from(expected))
  }, 'one normal Save preserves exact ordinary document bytes')
}
async function committedEdit(beforeVersion, expected, hasInsertedRow) {
  return app.until(async () => {
    const state = await observeBeta5(app),
      probe = await app.probe()
    const inserted = state.lines.find((line) => line.text === '|  |  |')
    return (
      probe.version === beforeVersion + 1 &&
      probe.dirty &&
      Boolean(inserted) === hasInsertedRow &&
      (!inserted ||
        (inserted.from === expected.indexOf('|  |  |') &&
          inserted.to === inserted.from + '|  |  |'.length)) &&
      (await app.execute(
        'return document.querySelector("[data-editor-host]")?.getAttribute("aria-busy")==="false"',
      )) &&
      probe
    )
  }, 'one ordinary edit committed before the one Save key')
}
try {
  app = await startProduction(file, out, { diagnostics: false })
  ui = beta5Fixture(app)
  await ui.position(source, 0)
  await app.until(
    async () => (await observeBeta5(app)).vector.join('|') === 'Start|End',
    'retained enabled Worker renders existing document',
  )
  await ui.list()
  await observe('01-historical-pending-visible')
  // Enabled plugins legitimately persist startup attempts on launch. Compare
  // unrelated catalog entries across the upgrade itself, after startup settles.
  const beforeUpgrade = await readCatalog()
  assert.match(
    await app.execute('return document.querySelector(arguments[0]).textContent', card),
    /1\.0\.1/,
  )
  await ui.pointer(toggle)
  await expectEnabled()
  await observe('02-one-gesture-upgrade-enabled')
  let now = await readCatalog(),
    formatting = entry(now, 'milkup.formatting')
  assert.equal(formatting.active.manifest.version, '1.0.1')
  assert.equal(formatting.active.sourcePath, 'bundled:milkup.formatting-1.0.1.milkup-plugin')
  assert.equal(formatting.enabled, true)
  assert(!formatting.pending)
  assert.equal(entry(now, 'milkup.diagrams').active.id, entry(before, 'milkup.diagrams').active.id)
  for (const e of beforeUpgrade.payload.entries)
    if (e.id !== 'milkup.formatting') assert.deepEqual(entry(now, e.id), e)
  await ui.closeMenu()
  await ui.position(source, source.indexOf('Alpha'))
  await app.until(
    async () => (await observeBeta5(app)).toolbar.formattingVisible,
    'upgraded toolbar is live',
  )
  await observe('03-upgraded-table-context-live')
  await app.close()
  app = undefined
  app = await startProduction(file, out, { diagnostics: false })
  ui = beta5Fixture(app)
  await ui.list()
  await expectEnabled()
  await observe('04-restart-retains-upgrade-enabled')
  await ui.closeMenu()
  await ui.position(source, source.indexOf('Alpha'))
  await app.until(
    async () => (await observeBeta5(app)).toolbar.formattingVisible,
    'restart restores upgraded toolbar',
  )
  await observe('05-restart-table-context-live')
  await tableContext(true)
  const withRow = source.replace('| Alpha | 1 |\n', '| Alpha | 1 |\n|  |  |\n')
  const commandBefore = await app.probe()
  await ui.pointer(
    '[data-plugin-ui="milkup.formatting:formatting-toolbar"] [data-plugin-command="formatting.tableAddRow"]',
  )
  const commandApplied = await committedEdit(commandBefore.version, withRow, true)
  await saveExact(withRow)
  await observe('06-one-add-row-and-exact-save', { commandBefore, commandApplied })
  const undoBefore = await app.probe()
  await app.key('ctrl+z')
  await committedEdit(undoBefore.version, source, false)
  await saveExact(source)
  await observe('07-one-undo-restores-exact-original')
  await ui.position(source, source.indexOf('Outside'))
  await tableContext(false)
  await observe('08-leave-table-hides-toolbar-and-empty-row')
  await ui.position(source, source.indexOf('Alpha'))
  await tableContext(true)
  await observe('09-return-restores-current-table-context')
  await ui.list()
  await ui.pointer(toggle)
  await app.until(
    () =>
      app.execute(
        'return document.querySelector(arguments[0])?.getAttribute("aria-checked")==="false"&&document.querySelector(arguments[0])?.getAttribute("aria-busy")!=="true"',
        toggle,
      ),
    'Formatting disabled through normal switch',
  )
  await ui.closeMenu()
  await tableContext(false)
  assert.equal(entry(await readCatalog(), 'milkup.formatting').enabled, false)
  await observe('10-disable-unloads-current-table-toolbar')
  await ui.list()
  await ui.pointer(toggle)
  await expectEnabled()
  await ui.closeMenu()
  await tableContext(true)
  await observe('11-reenable-restores-context-for-windowed-followup')
  assert.equal(await readFile(file, 'utf8'), source)
  const final = await readCatalog()
  assert.equal(entry(final, 'milkup.formatting').active.manifest.version, '1.0.1')
  assert.equal(entry(final, 'milkup.formatting').enabled, true)
  assert.equal(entry(final, 'milkup.diagrams').enabled, true)
  console.log(
    'PASS historical pending upgrade, retained Worker, restart, one table edit/Save/undo, context and unload; 11 stages, exact original source',
  )
} catch (e) {
  if (app) await observe('failure', { error: String(e), stack: e.stack }).catch(() => {})
  throw e
} finally {
  await app?.close()
}

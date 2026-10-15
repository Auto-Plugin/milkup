// Run on the new production binary using a dedicated profile previously opened
// by the 0.1.0 build (outline 1.2.0). New installs use the normal GTK picker.
// --preflight validates artifacts without contacting WebDriver.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { writeFile, readFile } from 'node:fs/promises'
import path from 'node:path'
import { startProduction } from '../helpers/native-production.mjs'
import {
  action,
  evidenceRoot,
  nativeFixture,
  preflight,
  updateId,
  x,
} from '../helpers/native-updates-fixture.mjs'

const output = process.env.MILKUP_NATIVE_EVIDENCE_DIR || path.join(evidenceRoot, 'migration-native')
const archive = process.env.MILKUP_PLUGIN_ARCHIVE
assert(archive, 'Set MILKUP_PLUGIN_ARCHIVE to the independently built outline 1.3.1 archive')
const artifact = await preflight({
  output,
  archive: path.resolve(archive),
  id: 'milkup.outline',
  permission: 'document:read',
})
assert.equal(artifact.manifest.version, '1.3.1')
if (process.argv.includes('--preflight')) {
  console.log('PASS migration native preflight; no app/driver started')
  process.exit(0)
}
const file = path.join(output, 'migration.md')
const original = '# Migration 中文\r\n\r\n## Preserved 👩🏽‍💻\r\nBody\r\n'
await writeFile(file, original)
let app
const ui = nativeFixture(() => app)
const state = () =>
  app.execute(`return {
  manager:document.querySelector('[data-plugin-manager]')?.textContent,
  cards:[...document.querySelectorAll('[data-plugin-action="details"]')].map(e=>e.dataset.pluginId),
  items:[...document.querySelectorAll('[data-plugin-ui="milkup.outline:outline-panel"] .plugin-list-item')].map(e=>e.textContent),
  focus:document.activeElement?.outerHTML.slice(0,300),
  diagnostics:window.__productionDiagnostics
}`)
const results = []
async function capture(name) {
  results.push({ name, state: await state(), document: await app.probe() })
  await writeFile(path.join(output, 'results.json'), JSON.stringify(results, null, 2) + '\n')
  await app.shot(name + '-webview')
  execFileSync('import', ['-window', 'root', path.join(output, name + '-x11.png')], {
    env: process.env,
  })
}
try {
  app = await startProduction(file, output)
  await app.key('ctrl+0')
  x('windowsize', ui.windowId(), '1100', '760')
  await ui.details('milkup.outline')
  await app.until(
    async () => (await state()).manager.includes('Requires Milkup ^0.1.0'),
    'old plugin rejected by new host',
  )
  assert((await state()).manager.includes('1.2.0'))
  assert.equal((await state()).items.length, 0)
  await capture('01-old-outline-blocked-in-details')
  await ui.details(updateId)
  assert(
    await ui.exists(action('enable', updateId)),
    'new privileged bundled updates stays inactive on migration',
  )
  assert(await ui.exists(action('approve', updateId)))
  assert(!(await ui.exists(action('open-ui', updateId))))
  await capture('02-new-updates-awaits-approval')
  await ui.list()
  await ui.click('[data-plugin-action="install"]')
  await ui.picker(archive)
  // Replacing an existing identity preserves list navigation; enter its details.
  await ui.details('milkup.outline')
  await app.until(
    async () => (await state()).manager.includes('1.3.1'),
    'new independent outline archive installed',
  )
  assert(!(await state()).manager.includes('Requires Milkup ^0.1.0'))
  if (await ui.exists(action('approve', 'milkup.outline')))
    await ui.click(action('approve', 'milkup.outline'))
  if (await ui.exists(action('enable', 'milkup.outline')))
    await ui.click(action('enable', 'milkup.outline'))
  await ui.ready(action('disable', 'milkup.outline'))
  await ui.closeMenu()
  if (await app.execute('return document.querySelector("#app").dataset.sidebarCollapsed==="true"'))
    await ui.click('[data-sidebar-toggle]')
  await app.until(async () => (await state()).items.length === 2, 'replacement outline activated')
  await capture('03-new-outline-active')
  assert.equal(await readFile(file, 'utf8'), original)
  assert.equal((await app.probe()).dirty, false)
  // Existing enabled state and the new update capability default survive restart.
  await app.close()
  app = await startProduction(file, output)
  await app.until(
    async () => (await state()).items.length === 2,
    'replacement enablement persisted',
  )
  await ui.details('milkup.outline')
  assert((await state()).manager.includes('1.3.1'))
  await ui.details(updateId)
  assert(await ui.exists(action('enable', updateId)))
  assert(await ui.exists(action('approve', updateId)))
  await capture('04-migration-persists-after-restart')
  assert.equal(await readFile(file, 'utf8'), original)
  console.log(
    'PASS production migration: old outline blocked; independent 1.3.1 installed; updates inactive and unapproved; document bytes preserved',
  )
} catch (error) {
  if (app) await capture('FAIL').catch(() => {})
  throw error
} finally {
  if (app) await app.close()
}

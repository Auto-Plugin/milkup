// Run against the production 2.0 build and a dedicated profile previously opened
// by the 0.1.0 delivery build (bundled outline 1.2.0). Uses the normal GTK picker.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import path from 'node:path'
import { startProduction } from '../helpers/native-production.mjs'
const output = process.env.MILKUP_NATIVE_EVIDENCE_DIR
const archive = process.env.MILKUP_PLUGIN_ARCHIVE
assert(output && archive)
await mkdir(output, { recursive: true })
const file = path.join(output, 'migration.md')
const original = '# Migration 中文\r\n\r\n## Preserved 👩🏽‍💻\r\nBody\r\n'
await writeFile(file, original)
const app = await startProduction(file, output)
const x = (...args) => execFileSync('xdotool', args, { env: process.env, encoding: 'utf8' }).trim()
const state = () =>
  app.execute(
    `return {manager:document.querySelector('[data-plugin-manager]')?.textContent,items:[...document.querySelectorAll('.plugin-list-item')].map(e=>e.textContent)}`,
  )
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
  await app.key('ctrl+0')
  await app.click('[data-menu-toggle]')
  await app.click('[data-menu-section="plugins"]')
  await app.until(
    async () => (await state()).manager.includes('Requires Milkup ^0.1.0'),
    'old plugin rejected by new host',
  )
  assert((await state()).manager.includes('1.2.0'))
  assert.equal((await state()).items.length, 0)
  await capture('old-outline-blocked')
  await app.click('[data-plugin-action="install"]')
  const dialog = () => {
    try {
      return x('search', '--onlyvisible', '--name', '^Open File$').split('\n').at(-1)
    } catch {
      return null
    }
  }
  const id = await app.until(dialog, 'GTK plugin picker')
  x('windowfocus', '--sync', id, 'key', '--clearmodifiers', 'ctrl+l')
  await app.delay(250)
  x('key', '--clearmodifiers', 'ctrl+a')
  x('type', '--clearmodifiers', '--delay', '1', '--', path.resolve(archive))
  x('key', '--clearmodifiers', 'Return')
  await app.delay(600)
  if (dialog()) {
    const geometry = x('getwindowgeometry', '--shell', id)
    const width = Number(/WIDTH=(\d+)/.exec(geometry)[1]),
      height = Number(/HEIGHT=(\d+)/.exec(geometry)[1])
    x('mousemove', '--window', id, String(width - 45), String(height - 24), 'click', '1')
  }
  await app.until(() => !dialog(), 'picker closed')
  x(
    'windowfocus',
    '--sync',
    x('search', '--onlyvisible', '--class', 'milkup-desktop').split('\n').at(-1),
  )
  await app.until(async () => (await state()).manager.includes('1.3.0'), 'new archive installed')
  assert(!(await state()).manager.includes('Requires Milkup ^0.1.0'))
  await app.click('[data-plugin-action="enable"]')
  await app.key('Escape')
  if (await app.execute('return document.querySelector("#app").dataset.sidebarCollapsed==="true"'))
    await app.click('[data-sidebar-toggle]')
  await app.until(async () => (await state()).items.length === 2, 'new outline activated')
  await capture('new-outline-active')
  assert.equal(await readFile(file, 'utf8'), original)
  assert.equal((await app.probe()).dirty, false)
  console.log(
    'PASS production migration: incompatible old outline blocked, new archive installed and enabled; document bytes unchanged',
  )
} finally {
  await app.close()
}

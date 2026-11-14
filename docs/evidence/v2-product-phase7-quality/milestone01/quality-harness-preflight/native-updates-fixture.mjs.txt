// Helpers scoped to the independent updates/migration acceptance tests.
// All writes go through shipped UI and native input; execute() only observes DOM.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { deflateSync } from 'node:zlib'
import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

export const evidenceRoot = '/workspace/milkup-plugin-architecture-evidence'
export const updateArchive = path.join(
  evidenceRoot,
  'updater-external/dist/milkup.updates-1.0.0.milkup-plugin',
)
export const updateId = 'milkup.updates'
export const updateView = '[data-plugin-ui="milkup.updates:updates-modal"]'
export const action = (kind, id = updateId) =>
  `[data-plugin-action="${kind}"][data-plugin-id="${id}"]`
export const updateCheck = `${updateView} [data-plugin-command="updates.check"]`
export const x = (...args) =>
  execFileSync('xdotool', args, { encoding: 'utf8', env: process.env }).trim()

/** Small deterministic PNG fixture; no permissions or host-specific feature code. */
export async function writeLogoFixture(output) {
  const crc32 = (bytes) => {
    let crc = 0xffffffff
    for (const value of bytes) {
      crc ^= value
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
    }
    return (crc ^ 0xffffffff) >>> 0
  }
  const chunk = (name, bytes) => {
    const body = Buffer.concat([Buffer.from(name), bytes])
    const size = Buffer.alloc(4),
      crc = Buffer.alloc(4)
    size.writeUInt32BE(bytes.length)
    crc.writeUInt32BE(crc32(body))
    return Buffer.concat([size, body, crc])
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(64, 0)
  header.writeUInt32BE(64, 4)
  header[8] = 8
  header[9] = 6
  const pixels = Buffer.alloc(64 * (1 + 64 * 4))
  for (let row = 0; row < 64; row++)
    for (let col = 0; col < 64; col++) {
      const index = row * 257 + 1 + col * 4
      const white =
        (col >= 14 && col <= 24 && row >= 12 && row <= 50) ||
        (row >= 40 && row <= 50 && col >= 14 && col <= 50)
      pixels.set(white ? [255, 255, 255, 255] : [32, 104, 220, 255], index)
    }
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(pixels)),
    chunk('IEND', Buffer.alloc(0)),
  ])
  const id = 'example.logo-fixture'
  const archive = path.join(output, 'logo-fixture.milkup-plugin')
  await writeFile(
    archive,
    JSON.stringify(
      {
        format: 'milkup-plugin',
        version: 1,
        manifest: {
          id,
          name: 'Logo fixture',
          description: '独立 PNG 资源与通用插件详情验收',
          version: '1.0.0',
          host: 'worker',
          main: './dist/plugin.js',
          engines: { milkup: '^2.0.0-0', pluginSdk: '^0.2.0' },
          permissions: [],
          icon: 'assets/logo.png',
          resources: ['assets/logo.png'],
        },
        files: [
          {
            path: 'dist/plugin.js',
            encoding: 'utf8',
            content: 'export default { activate() { return { dispose() {} } } }',
          },
          { path: 'assets/logo.png', encoding: 'base64', content: png.toString('base64') },
        ],
      },
      null,
      2,
    ) + '\n',
  )
  await writeFile(path.join(output, 'logo-fixture.png'), png)
  return { id, archive }
}

export async function preflight({ output, archive, id, permission, recovery = false }) {
  await mkdir(output, { recursive: true })
  const bytes = await readFile(archive)
  const bundle = JSON.parse(bytes)
  assert.equal(bundle.format, 'milkup-plugin')
  assert.equal(bundle.manifest.id, id)
  assert.equal(bundle.manifest.host, 'worker')
  assert(bundle.manifest.permissions.includes(permission))
  assert(bundle.files.some((file) => './' + file.path === bundle.manifest.main))
  assert(
    !archive.startsWith(path.resolve('apps/desktop') + path.sep),
    'Use an independently built archive',
  )
  const application = path.resolve(
    process.env.TAURI_APP_PATH || 'apps/desktop/src-tauri/target/release/milkup-desktop',
  )
  await access(application)
  if (recovery)
    assert(
      process.env.MILKUP_RECOVERY_PROFILE,
      'Set MILKUP_RECOVERY_PROFILE to the dedicated profile recovery directory',
    )
  const report = {
    application,
    archive,
    manifest: bundle.manifest,
    archiveSha256: createHash('sha256').update(bytes).digest('hex'),
    recoveryProfile: process.env.MILKUP_RECOVERY_PROFILE || null,
    input: 'production binary; normal GTK picker; native keys; read-only DOM observations',
  }
  await writeFile(path.join(output, 'preflight.json'), JSON.stringify(report, null, 2) + '\n')
  return report
}

export function nativeFixture(getApp) {
  const app = () => getApp()
  const exists = (selector) =>
    app().execute('return !!document.querySelector(arguments[0])', selector)
  const ready = (selector) =>
    app().until(
      () =>
        app().execute(
          'const e=document.querySelector(arguments[0]);return !!e&&!e.disabled&&e.getClientRects().length>0',
          selector,
        ),
      `visible enabled control ${selector}`,
    )
  const click = async (selector) => {
    await ready(selector)
    await app().click(selector)
    await app().delay(100)
  }
  const windowId = () =>
    x('search', '--onlyvisible', '--class', 'milkup-desktop')
      .split('\n')
      .map((id) => {
        const geometry = x('getwindowgeometry', '--shell', id)
        return {
          id,
          area: Number(/WIDTH=(\d+)/.exec(geometry)[1]) * Number(/HEIGHT=(\d+)/.exec(geometry)[1]),
        }
      })
      .sort((a, b) => b.area - a.area)[0].id
  const dialog = () => {
    try {
      return x('search', '--onlyvisible', '--name', '^Open File$').split('\n').at(-1)
    } catch {
      return null
    }
  }
  const picker = async (file) => {
    const id = await app().until(dialog, 'normal GTK Open File picker')
    // A new GTK profile first populates its recent-files model asynchronously.
    // Wait before opening the location entry so completion does not consume Enter.
    await app().delay(1200)
    x('windowfocus', '--sync', id, 'key', '--clearmodifiers', 'ctrl+l')
    await app().delay(350)
    x('key', '--clearmodifiers', 'ctrl+a')
    x('type', '--clearmodifiers', '--delay', '3', '--', path.resolve(file))
    await app().delay(700)
    x('key', '--clearmodifiers', 'Return')
    await app().delay(600)
    if (dialog()) {
      const geometry = x('getwindowgeometry', '--shell', id)
      const width = Number(/WIDTH=(\d+)/.exec(geometry)[1])
      const height = Number(/HEIGHT=(\d+)/.exec(geometry)[1])
      x('mousemove', '--window', id, String(width - 45), String(height - 24), 'click', '1')
      await app().delay(700)
      if (dialog()) {
        x('windowfocus', '--sync', id, 'key', '--clearmodifiers', 'Return')
      }
    }
    await app().until(() => !dialog(), 'normal GTK picker closed')
    x('windowfocus', '--sync', windowId())
  }
  const menu = async () => {
    if (
      !(await app().execute(
        'return !!document.querySelector("[data-app-menu]")?.getClientRects().length',
      ))
    )
      await click('[data-menu-toggle]')
    await click('[data-menu-section="plugins"]')
  }
  const list = async () => {
    await menu()
    if (await exists('[data-plugin-action="back"]')) await click('[data-plugin-action="back"]')
  }
  const details = async (id = updateId) => {
    await list()
    await click(action('details', id))
    await ready('#plugin-detail-title')
  }
  const closeModal = async () => {
    await click(`${updateView} .plugin-ui-close`)
    await app().until(async () => !(await exists(updateView)), 'plugin modal removed')
  }
  const closeMenu = async () => {
    if (await exists(updateView)) await closeModal()
    if (
      await app().execute(
        'return !!document.querySelector("[data-app-menu]")?.getClientRects().length',
      )
    )
      await click('[data-menu-close]')
    await app().until(
      () =>
        app().execute('return !document.querySelector("[data-app-menu]")?.getClientRects().length'),
      'application menu closed',
    )
  }
  return { exists, ready, click, windowId, picker, menu, list, details, closeModal, closeMenu }
}

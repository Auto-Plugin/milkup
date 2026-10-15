import { expect, test, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { build } from 'esbuild'

async function fixture(page: Page, mode = 'valid') {
  // Real standalone Worker + real public SDK RPC. Only native transport is replaced.
  const manifest = JSON.parse(await readFile('plugins/updates/plugin.json', 'utf8'))
  const bundle = await build({
    entryPoints: ['plugins/updates/src/plugin.ts'],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'browser',
    alias: { '@milkup/plugin-sdk': resolve('packages/plugin-sdk/src/index.js') },
  })
  manifest.main = 'data:text/javascript,' + encodeURIComponent(bundle.outputFiles[0]!.text)
  await page.addInitScript(
    ({ manifest, mode }) => {
      const state = { mode, installs: 0, cancels: 0, downloads: 0 }
      const host = window as unknown as { releaseFixture: typeof state; releaseTransport: unknown }
      host.releaseFixture = state
      host.releaseTransport = {
        async check() {
          await new Promise((resolve) => setTimeout(resolve, 180))
          if (state.mode === 'offline') throw Error('检查失败：离线')
          return {
            configured: state.mode !== 'unconfigured',
            channel: 'beta',
            update: {
              token: 1,
              version: '2.0.0-beta.2',
              notes: '改进编辑\n<script>说明按纯文本展示</script>',
              date: null,
            },
          }
        },
        async download(_token: number, progress: (event: unknown) => void) {
          const run = ++state.downloads
          for (const received of [2048, 8192]) {
            progress({
              phase: 'downloading',
              received,
              total: state.mode === 'unknown' ? null : 8192,
            })
            await new Promise((resolve) => setTimeout(resolve, 300))
            if (state.cancels >= run) throw Error('下载取消')
          }
          progress({ phase: 'verifying', received: 8192, total: null })
          if (state.mode === 'signature') throw Error('签名校验失败')
        },
        async cancel() {
          state.cancels++
        },
        async install() {
          state.installs++
          throw Error('测试安装器失败：保留编辑器')
        },
      }
      const record = {
        manifest,
        manifestPath: '/plugins/updates/plugin.json',
        rootPath: '/plugins/updates',
        sourcePath: '/plugins/updates/plugin.json',
        state: 'installed',
        enabled: false,
        installedAt: 1,
        updatedAt: 1,
        trust: 'development',
        approvals: { permissions: [], hosts: ['worker'] },
        errors: [],
      }
      localStorage.setItem(
        'milkup.desktop.plugins.registry.v1',
        JSON.stringify({ version: 1, records: [record], auditRecords: [] }),
      )
    },
    { manifest, mode },
  )
  await page.route(/\/src\/plugin-release-service\.ts(?:\?|$)/, async (route) => {
    const response = await route.fetch()
    const body = (await response.text()).replace(
      'function nativeReleaseTransport() {',
      'function nativeReleaseTransport() { return window.releaseTransport;',
    )
    await route.fulfill({ response, body })
  })
  await page.goto('/')
}
async function open(page: Page) {
  await page.getByRole('button', { name: '菜单', exact: true }).click()
  await page.getByRole('button', { name: '插件', exact: true }).click()
  await page.getByRole('button', { name: 'Milkup Updates', exact: true }).click()
  await page.getByRole('button', { name: '批准能力', exact: true }).click()
  await page.getByRole('button', { name: '启用', exact: true }).click()
  await expect(page.locator('.plugin-state')).toHaveText('已启用')
  await page.getByRole('button', { name: '打开 软件更新', exact: true }).click()
  await expect(page.getByRole('dialog', { name: '软件更新', exact: true })).toBeVisible()
}
const modal = (page: Page) => page.getByRole('dialog', { name: '软件更新', exact: true })
const installCount = (page: Page) =>
  page.evaluate(
    () => (window as unknown as { releaseFixture: { installs: number } }).releaseFixture.installs,
  )
async function ready(page: Page) {
  await open(page)
  await modal(page).getByRole('button', { name: '检查更新', exact: true }).click()
  await modal(page).getByRole('button', { name: '下载更新', exact: true }).click()
  await expect(modal(page).getByRole('button', { name: '请求安装更新', exact: true })).toBeVisible()
}

test('host About has no update feature; public plugin requires approval and owns the UI', async ({
  page,
}) => {
  await fixture(page, 'unconfigured')
  await page.getByRole('button', { name: '菜单', exact: true }).click()
  await page.getByRole('button', { name: '关于', exact: true }).click()
  await expect(page.locator('[data-menu-panel="about"]')).toContainText('2.0.0-beta.1')
  await expect(page.locator('[data-menu-panel="about"]')).not.toContainText('检查更新')
  await page.keyboard.press('Escape')
  await open(page)
  await modal(page).getByRole('button', { name: '检查更新', exact: true }).click()
  await expect(modal(page)).toContainText('尚未配置')
  await expect(modal(page).getByRole('button', { name: '检查更新', exact: true })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(modal(page)).toHaveCount(0)
  await expect(page.getByRole('button', { name: '打开 软件更新', exact: true })).toBeFocused()
})

test('plugin shows plain notes and unknown progress; cancellation and retry use guarded release IDs', async ({
  page,
}) => {
  await fixture(page, 'unknown')
  await open(page)
  await modal(page).getByRole('button', { name: '检查更新', exact: true }).click()
  await expect(modal(page)).toContainText('<script>说明按纯文本展示</script>')
  await expect(modal(page).locator('script')).toHaveCount(0)
  await modal(page).getByRole('button', { name: '下载更新', exact: true }).click()
  await expect(modal(page)).toContainText('总大小未知')
  await modal(page).getByRole('button', { name: '取消下载', exact: true }).click()
  await expect(modal(page).getByRole('button', { name: '下载更新', exact: true })).toBeVisible()
  await modal(page).getByRole('button', { name: '下载更新', exact: true }).click()
  await expect(modal(page).getByRole('button', { name: '请求安装更新', exact: true })).toBeVisible()
  expect(await installCount(page)).toBe(0)
})

test('signature failure cannot install and plugin retry succeeds', async ({ page }) => {
  await fixture(page, 'signature')
  await open(page)
  await modal(page).getByRole('button', { name: '检查更新', exact: true }).click()
  await modal(page).getByRole('button', { name: '下载更新', exact: true }).click()
  await expect(modal(page).getByRole('alert')).toContainText('签名')
  await expect(modal(page).getByRole('button', { name: '请求安装更新', exact: true })).toHaveCount(
    0,
  )
  await page.evaluate(() => {
    ;(window as unknown as { releaseFixture: { mode: string } }).releaseFixture.mode = 'valid'
  })
  await modal(page).getByRole('button', { name: '下载更新', exact: true }).click()
  await expect(modal(page).getByRole('button', { name: '请求安装更新', exact: true })).toBeVisible()
})

test('even a clean document requires trusted host confirmation; cancel keeps editor and no install', async ({
  page,
}) => {
  await fixture(page)
  await ready(page)
  await modal(page).getByRole('button', { name: '请求安装更新', exact: true }).click()
  await expect(page.locator('[data-close-confirm]')).toBeVisible()
  await expect(page.locator('.dialog-button[data-close-confirm-action="cancel"]')).toBeFocused()
  await expect(page.locator('[data-close-confirm-action="discard"]')).toBeHidden()
  expect(await installCount(page)).toBe(0)
  await page.keyboard.press('Tab')
  await expect(page.locator('[data-close-confirm-action="save"]')).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(page.locator('[data-close-confirm]')).toBeHidden()
  await expect(modal(page).getByRole('button', { name: '请求安装更新', exact: true })).toBeVisible()
  expect(await installCount(page)).toBe(0)
})

for (const mode of ['source', 'live'])
  test(`disabled and uninstalled plugin leaves ${mode} editing/history and save functional`, async ({
    page,
  }) => {
    await fixture(page)
    await open(page)
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: '禁用', exact: true }).click()
    await expect(page.locator('.plugin-state')).toHaveText('已禁用')
    await expect(page.getByRole('button', { name: '打开 软件更新', exact: true })).toHaveCount(0)
    await page.getByRole('button', { name: '移除', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Milkup Updates', exact: true })).toHaveCount(0)
    await page.keyboard.press('Escape')
    await page.keyboard.press(mode === 'source' ? 'Control+1' : 'Control+2')
    await page.locator('.milkup-editor').click()
    await page.keyboard.type('preserve document')
    await page.keyboard.press('Control+z')
    await page.keyboard.press('Control+Shift+z')
    await page.keyboard.press('Control+s')
    await expect(page.locator('.milkup-editor')).toContainText('preserve document')
    await expect(page.locator('[data-save-dot]')).not.toHaveClass(/is-dirty/)
  })

for (const theme of ['light', 'dark'])
  for (const width of [1100, 760])
    test(`plugin update modal ${theme} ${width} has keyboard-accessible controls`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: width === 760 ? 520 : 760 })
      await page.addInitScript(
        (theme) =>
          localStorage.setItem('milkup.desktop.appearance.v1', JSON.stringify({ theme, zoom: 1 })),
        theme,
      )
      await fixture(page)
      await ready(page)
      const install = modal(page).getByRole('button', { name: '请求安装更新', exact: true })
      await install.focus()
      await page.keyboard.press('Tab')
      await expect(modal(page).getByRole('button', { name: '关闭', exact: true })).toBeFocused()
      await page.screenshot({ path: test.info().outputPath(`plugin-update-${theme}-${width}.png`) })
    })

for (const mode of ['source', 'live']) {
  test(`windowed ${mode} plugin install guard saves complete Unicode data before installer failure`, async ({
    page,
  }) => {
    await page.route(/\/src\/file-service\.ts(?:\?|$)/, async (route) => {
      const response = await route.fetch()
      const body = (await response.text()).replace(
        'function createDesktopFileService() {',
        `function createDesktopFileService() {
          const service = createMockFileService();
          const text = 'ORIGINAL 中文 👩🏽‍💻\\r\\n' + 'body line\\r\\n'.repeat(16000);
          window.updateOriginalText = text;
          service.getFileMetadata = async path => ({path,sizeBytes:text.length,readonly:false});
          service.openPath = async path => ({documentId:'update-windowed',file:{path},text,diskSnapshotHash:'initial'});
          const save = service.saveFile.bind(service);
          service.saveFile = async (session,text) => { window.updateSavedText = text; return save(session,text); };
          return service;`,
      )
      await route.fulfill({ response, body })
    })
    await fixture(page)
    await page.getByRole('button', { name: '菜单', exact: true }).click()
    await page.getByRole('button', { name: '打开', exact: true }).click()
    await expect(page.locator('.milkup-source-document-view')).toBeVisible()
    await page.keyboard.press(mode === 'source' ? 'Control+1' : 'Control+2')
    await page.locator('.milkup-input-proxy').focus()
    await page.keyboard.type('SAFE-')
    await ready(page)
    await modal(page).getByRole('button', { name: '请求安装更新', exact: true }).click()
    await expect(page.locator('[data-close-confirm]')).toBeVisible()
    expect(await installCount(page)).toBe(0)
    await page.locator('[data-close-confirm-action="save"]').click()
    await expect.poll(() => installCount(page)).toBe(1)
    await expect(modal(page).getByRole('alert')).toContainText('测试安装器失败')
    expect(
      await page.evaluate(() => {
        const state = window as unknown as { updateSavedText: string; updateOriginalText: string }
        return state.updateSavedText === 'SAFE-' + state.updateOriginalText
      }),
    ).toBe(true)
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: '关闭菜单', exact: true }).click()
    await page.locator('.milkup-input-proxy').focus()
    await page.keyboard.type('STILL-')
    await expect(page.locator('.milkup-source-document-view')).toContainText('STILL-')
  })
}

test('save failure prevents plugin installation and preserves editable draft', async ({ page }) => {
  await page.route(/\/src\/file-service\.ts(?:\?|$)/, async (route) => {
    const response = await route.fetch()
    const body = (await response.text()).replace(
      'async saveFile(session, text) {',
      'async saveFile(session, text) { throw Error("磁盘空间不足");',
    )
    await route.fulfill({ response, body })
  })
  await fixture(page)
  await page.locator('.milkup-editor').click()
  await page.keyboard.type('Never lose this')
  await ready(page)
  await modal(page).getByRole('button', { name: '请求安装更新', exact: true }).click()
  await page.locator('[data-close-confirm-action="save"]').click()
  await expect(page.locator('[data-transition-error]')).toContainText('磁盘空间不足')
  expect(await installCount(page)).toBe(0)
  await page.keyboard.press('Escape')
  await expect(page.locator('[data-close-confirm]')).toBeHidden()
  await page.keyboard.press('Escape')
  await expect(modal(page)).toHaveCount(0)
  await page.getByRole('button', { name: '关闭菜单', exact: true }).click()
  await page.locator('.milkup-editor').click()
  await page.keyboard.press('Control+End')
  await page.keyboard.type('!')
  await expect(page.locator('.milkup-editor')).toContainText('Never lose this!')
})

test('background download completion does not steal document focus', async ({ page }) => {
  await fixture(page)
  await open(page)
  await modal(page).getByRole('button', { name: '检查更新', exact: true }).click()
  await modal(page).getByRole('button', { name: '下载更新', exact: true }).click()
  await page.keyboard.press('Escape')
  await expect(modal(page)).toHaveCount(0)
  await page.getByRole('button', { name: '关闭菜单', exact: true }).click()
  await page.locator('.milkup-editor').click()
  await page.keyboard.type('editing while download completes')
  await expect(page.locator('.milkup-input-proxy')).toBeFocused()
  await page.getByRole('button', { name: '菜单', exact: true }).click()
  await page.getByRole('button', { name: '插件', exact: true }).click()
  await page.getByRole('button', { name: '打开 软件更新', exact: true }).click()
  await expect(modal(page).getByRole('button', { name: '请求安装更新', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: '关闭菜单', exact: true }).click()
  await expect(page.locator('.milkup-editor')).toContainText('editing while download completes')
  expect(await installCount(page)).toBe(0)
})

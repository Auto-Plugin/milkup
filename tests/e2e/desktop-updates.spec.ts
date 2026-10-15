import { expect, test, type Page } from '@playwright/test'

async function updateFixture(page: Page, mode = 'valid') {
  // Transport/installer substitute for browser interaction only. Actual minisign
  // verification and HTTP failures are tested against Rust's production downloader.
  await page.addInitScript((mode) => {
    const fixture = { mode, downloads: 0, installs: 0, cancel: false }
    const host = window as unknown as { updateFixture: typeof fixture; updateBackend: unknown }
    host.updateFixture = fixture
    host.updateBackend = {
      async check() {
        if (fixture.mode === 'offline') throw Error('离线：无法连接更新服务器')
        return {
          configured: fixture.mode !== 'unconfigured',
          channel: 'beta',
          update: {
            token: 1,
            version: '2.0.0-beta.2',
            date: null,
            notes: '改进 Markdown 编辑与文档保护。\n<script>这段说明只按文本显示</script>',
          },
        }
      },
      async download(_token: number, progress: (event: unknown) => void) {
        fixture.downloads++
        fixture.cancel = false
        for (const received of [1024, 4096]) {
          progress({
            phase: 'downloading',
            received,
            total: fixture.mode === 'unknown' ? null : 8192,
          })
          await new Promise((resolve) => setTimeout(resolve, 200))
          if (fixture.cancel) throw Error('cancelled')
        }
        progress({ phase: 'verifying', received: 8192, total: null })
        await new Promise((resolve) => setTimeout(resolve, 100))
        if (fixture.mode === 'signature-failure') throw Error('更新包签名校验失败')
      },
      async cancel() {
        fixture.cancel = true
      },
      async install() {
        fixture.installs++
        if (fixture.mode === 'install-failure') throw Error('安装器启动失败')
      },
    }
  }, mode)
  await page.route(/\/src\/application-update\.ts(?:\?|$)/, async (route) => {
    const response = await route.fetch()
    const body = (await response.text()).replace(
      'function nativeApplicationUpdateBackend() {',
      'function nativeApplicationUpdateBackend() { return window.updateBackend;',
    )
    await route.fulfill({ response, body })
  })
  await page.route(/\/src\/main\.ts(?:\?|$)/, async (route) => {
    const response = await route.fetch()
    const body = (await response.text()).replace(
      /renderApplicationUpdate\(appRoot, ([\w.]+), isTauriRuntime\(\)\)/g,
      'renderApplicationUpdate(appRoot, $1, true)',
    )
    await route.fulfill({ response, body })
  })
}
async function about(page: Page) {
  await page.getByRole('button', { name: '菜单', exact: true }).click()
  await page.getByRole('button', { name: '关于', exact: true }).click()
}
async function ready(page: Page) {
  await about(page)
  await page.locator('[data-update-check]').click()
  await expect(page.locator('[data-update-version]')).toHaveText('新版本 2.0.0-beta.2')
  await page.locator('[data-update-download]').click()
  await expect(page.locator('[data-update-install]')).toBeVisible()
}
const installCount = (page: Page) =>
  page.evaluate(
    () => (window as unknown as { updateFixture: { installs: number } }).updateFixture.installs,
  )

test('about uses the real build version and browser preview cannot install updates', async ({
  page,
}) => {
  await page.goto('/')
  await about(page)
  await expect(page.locator('[data-app-version]')).toHaveText('2.0.0-beta.1')
  await expect(page.locator('[data-update-check]')).toBeDisabled()
  await expect(page.locator('[data-update-status]')).toContainText('桌面版')
})

test('update download, progress, literal release notes, confirmation and cancellation are visible', async ({
  page,
}) => {
  await updateFixture(page, 'unknown')
  await page.goto('/')
  await about(page)
  await page.locator('[data-update-check]').click()
  await expect(page.locator('[data-update-check]')).toBeFocused()
  await expect(page.locator('[data-update-notes]')).toContainText('<script>')
  await expect(page.locator('[data-update-notes] script')).toHaveCount(0)
  await page.locator('[data-update-download]').click()
  await expect(page.locator('[data-update-bytes]')).toContainText('总大小未知')
  await page.locator('[data-update-cancel]').click()
  await expect(page.locator('[data-update-download]')).toBeVisible()
  await page.locator('[data-update-download]').click()
  await expect(page.locator('[data-update-install]')).toBeVisible()
  await expect(page.locator('[data-update-install]')).toBeFocused()
  expect(await installCount(page)).toBe(0)
  await page.locator('[data-update-install]').click()
  await expect(page.locator('[data-update-later]')).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.locator('[data-update-install]')).toBeFocused()
  expect(await installCount(page)).toBe(0)
})

test('signature failure is retryable and never offers installation', async ({ page }) => {
  await updateFixture(page, 'signature-failure')
  await page.goto('/')
  await about(page)
  await page.locator('[data-update-check]').click()
  await page.locator('[data-update-download]').click()
  await expect(page.locator('[data-update-error]')).toContainText('签名校验失败')
  await expect(page.locator('[data-update-install]')).toBeHidden()
  expect(await installCount(page)).toBe(0)
  await page.evaluate(() => {
    ;(window as unknown as { updateFixture: { mode: string } }).updateFixture.mode = 'valid'
  })
  await page.locator('[data-update-download]').click()
  await expect(page.locator('[data-update-install]')).toBeVisible()
})

test('unsaved document must save before install; cancellation preserves content and undo', async ({
  page,
}) => {
  await updateFixture(page)
  await page.goto('/')
  await page.locator('.milkup-editor').click()
  await page.keyboard.type('Keep this draft')
  await ready(page)
  await page.locator('[data-update-install]').click()
  await page.locator('[data-update-confirm]').click()
  await expect(page.locator('[data-close-confirm]')).toBeVisible()
  await expect(page.locator('[data-close-confirm-action="discard"]')).toBeHidden()
  expect(await installCount(page)).toBe(0)
  await page.keyboard.press('Escape')
  await expect(page.locator('[data-update-install]')).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(page.locator('.milkup-editor')).toContainText('Keep this draft')
  await page.keyboard.press('Control+z')
  await page.keyboard.press('Control+Shift+z')
  await expect(page.locator('.milkup-editor')).toContainText('Keep this draft')
  await about(page)
  await page.locator('[data-update-install]').click()
  await page.locator('[data-update-confirm]').click()
  await page.locator('[data-close-confirm-action="save"]').click()
  await expect.poll(() => installCount(page)).toBe(1)
  await expect(page.locator('[data-save-label]')).toContainText('已保存')
  await expect(page.locator('[data-update-status]')).toContainText('正在安装')
})

test('save failure blocks update installation and keeps the draft editable after cancelling', async ({
  page,
}) => {
  await updateFixture(page)
  await page.route(/\/src\/file-service\.ts(?:\?|$)/, async (route) => {
    const response = await route.fetch()
    const body = (await response.text()).replace(
      'async saveFile(session, text) {',
      'async saveFile(session, text) { throw Error("磁盘空间不足");',
    )
    await route.fulfill({ response, body })
  })
  await page.goto('/')
  await page.locator('.milkup-editor').click()
  await page.keyboard.type('Never lose this')
  await ready(page)
  await page.locator('[data-update-install]').click()
  await page.locator('[data-update-confirm]').click()
  await page.locator('[data-close-confirm-action="save"]').click()
  await expect(page.locator('[data-transition-error]')).toContainText('磁盘空间不足')
  expect(await installCount(page)).toBe(0)
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  await expect(page.locator('.milkup-editor')).toContainText('Never lose this')
  await page.keyboard.type('!')
  await expect(page.locator('.milkup-editor')).toContainText('Never lose this!')
})

test('unconfigured and offline checks are distinct and installation failure unlocks editing', async ({
  page,
}) => {
  await updateFixture(page, 'unconfigured')
  await page.goto('/')
  await about(page)
  await page.locator('[data-update-check]').click()
  await expect(page.locator('[data-update-status]')).toContainText('尚未开放')
  await page.evaluate(() => {
    ;(window as unknown as { updateFixture: { mode: string } }).updateFixture.mode = 'offline'
  })
  await page.locator('[data-update-check]').click()
  await expect(page.locator('[data-update-error]')).toContainText('离线')
  await page.evaluate(() => {
    ;(window as unknown as { updateFixture: { mode: string } }).updateFixture.mode =
      'install-failure'
  })
  await page.locator('[data-update-check]').click()
  await page.locator('[data-update-download]').click()
  await page.locator('[data-update-install]').click()
  await page.locator('[data-update-confirm]').click()
  await expect(page.locator('[data-update-error]')).toContainText('安装器启动失败')
  await page.keyboard.press('Escape')
  await page.locator('.milkup-editor').click()
  await page.keyboard.type('still works')
  await expect(page.locator('.milkup-editor')).toContainText('still works')
})

for (const mode of ['source', 'live']) {
  test(`windowed ${mode} update guard flushes edits and preserves complete saved Unicode data`, async ({
    page,
  }) => {
    await updateFixture(page, 'install-failure')
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
    await page.goto('/')
    await page.getByRole('button', { name: '菜单', exact: true }).click()
    await page.getByRole('button', { name: '打开', exact: true }).click()
    await expect(page.locator('.milkup-source-document-view')).toBeVisible()
    if (mode === 'source') await page.keyboard.press('Control+1')
    await page.locator('.milkup-input-proxy').focus()
    await page.keyboard.type('SAFE-')
    await ready(page)
    await page.locator('[data-update-install]').click()
    await page.locator('[data-update-confirm]').click()
    expect(await installCount(page)).toBe(0)
    await page.locator('[data-close-confirm-action="save"]').click()
    await expect.poll(() => installCount(page)).toBe(1)
    await expect(page.locator('[data-update-error]')).toContainText('安装器启动失败')
    expect(
      await page.evaluate(() => {
        const h = window as unknown as { updateSavedText: string; updateOriginalText: string }
        return h.updateSavedText === 'SAFE-' + h.updateOriginalText
      }),
    ).toBe(true)
  })
}

for (const theme of ['light', 'dark']) {
  for (const width of [1100, 760]) {
    test(`update panel ${theme} at ${width} keeps controls reachable`, async ({
      page,
    }, testInfo) => {
      await updateFixture(page)
      await page.addInitScript(
        (theme) =>
          localStorage.setItem('milkup.desktop.appearance.v1', JSON.stringify({ theme, zoom: 1 })),
        theme,
      )
      await page.setViewportSize({ width, height: width === 760 ? 520 : 760 })
      await page.goto('/')
      await ready(page)
      await page.locator('[data-update-install]').click()
      await expect(page.locator('[data-update-later]')).toBeFocused()
      await page.locator('[data-update-confirm]').scrollIntoViewIfNeeded()
      const box = await page.locator('[data-update-confirm]').boundingBox()
      expect(box!.x).toBeGreaterThanOrEqual(0)
      expect(box!.x + box!.width).toBeLessThanOrEqual(width)
      await page.screenshot({ path: testInfo.outputPath(`update-${theme}-${width}.png`) })
      await page.keyboard.press('Escape')
      await expect(page.locator('[data-app-menu]')).toBeHidden()
      expect(await installCount(page)).toBe(0)
    })
  }
}

test('a completed background download does not steal focus from document editing', async ({
  page,
}) => {
  await updateFixture(page)
  await page.goto('/')
  await about(page)
  await page.locator('[data-update-check]').click()
  await page.locator('[data-update-download]').click()
  await page.keyboard.press('Escape')
  await page.locator('.milkup-editor').click()
  await page.keyboard.type('editing during download')
  await expect(page.locator('[data-update-status]')).toContainText('已通过签名校验')
  await expect(page.locator('.milkup-input-proxy')).toBeFocused()
  await expect(page.locator('.milkup-editor')).toContainText('editing during download')
  expect(await installCount(page)).toBe(0)
})

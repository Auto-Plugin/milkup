import { expect, test, type Page } from '@playwright/test'
import { createHash } from 'node:crypto'

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex')
async function savedHash(page: Page): Promise<string | null> {
  return page.evaluate(async () => {
    const text = (window as unknown as { __appearanceSavedText?: string }).__appearanceSavedText
    if (text === undefined) return null
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
    return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('')
  })
}

async function openAppearance(page: Page): Promise<void> {
  await page.getByRole('button', { name: '菜单', exact: true }).click()
  await page.getByRole('button', { name: '外观', exact: true }).click()
  await expect(page.getByRole('button', { name: '深色', exact: true })).toBeEnabled()
}

test('built-in appearance uses canonical settings, real preview frames and explicit browser file limits', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 1000, height: 720 })
  await page.emulateMedia({ colorScheme: 'light' })
  await page.goto('/')
  await openAppearance(page)
  await expect(page.locator('[data-theme-name]')).toHaveText('系统默认主题')
  await expect(page.locator('[data-theme-feedback]')).toContainText(
    '浏览器预览无法导入或打开系统主题文件',
  )
  for (const action of ['import', 'open', 'reset'])
    await expect(page.locator(`[data-theme-${action}]`)).toBeDisabled()
  await expect(page.locator('[data-menu-panel="appearance"] iframe')).toHaveCount(4)
  const previews = page.locator('[data-menu-panel="appearance"] iframe')
  await expect(previews.nth(0).contentFrame().locator('.milkup-editor')).toHaveCSS(
    'background-color',
    'rgb(255, 255, 255)',
  )
  await expect(previews.nth(1).contentFrame().locator('.milkup-editor')).toHaveCSS(
    'background-color',
    'rgb(27, 34, 44)',
  )
  expect(
    await previews.nth(0).evaluate((frame) => (frame as HTMLIFrameElement).contentDocument),
  ).toBe(null)
  await page.getByRole('button', { name: '深色', exact: true }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await expect(page.getByRole('button', { name: '深色', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  expect(
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem('milkup.desktop.settings.v1')!).application.values[
          'appearance.theme'
        ],
    ),
  ).toBe('dark')
  await page.emulateMedia({ colorScheme: 'light' })
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await page.screenshot({ path: info.outputPath('host-appearance-dark.png') })
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await openAppearance(page)
  await page.getByRole('button', { name: '系统', exact: true }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await page.emulateMedia({ colorScheme: 'dark' })
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await page.getByRole('button', { name: '浅色', exact: true }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await page.setViewportSize({ width: 760, height: 520 })
  for (const label of ['浅色', '深色', '系统'])
    await expect(page.getByRole('button', { name: label, exact: true })).toBeVisible()
  await page.screenshot({ path: info.outputPath('host-appearance-light-narrow.png') })
})

test('a failed mode persistence rolls back the visible mode and permits normal retry', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const original = Storage.prototype.setItem
    Storage.prototype.setItem = function (key: string, value: string) {
      if (
        key === 'milkup.desktop.settings.v1' &&
        (window as unknown as { failAppearanceSave?: boolean }).failAppearanceSave
      )
        throw new Error('synthetic appearance storage failure')
      original.call(this, key, value)
    }
  })
  await page.emulateMedia({ colorScheme: 'light' })
  await page.goto('/')
  await openAppearance(page)
  await page.evaluate('window.failAppearanceSave = true')
  await page.getByRole('button', { name: '深色', exact: true }).click()
  await expect(page.locator('[data-theme-feedback]')).toContainText('外观操作未完成')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await expect(page.getByRole('button', { name: '系统', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await page.evaluate('window.failAppearanceSave = false')
  await page.getByRole('button', { name: '深色', exact: true }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await expect(page.locator('[data-theme-feedback]')).not.toContainText('外观操作未完成')
})

for (const windowed of [false, true])
  for (const mode of ['source', 'live'] as const) {
    test(`${windowed ? 'windowed' : 'ordinary'} ${mode} theme changes preserve input, selection, history and saved CRLF bytes`, async ({
      page,
    }) => {
      const text =
        '# 主题 中文😀\r\n\r\n- [ ] 保留任务\r\n\r\n```js\r\nconst keep = "é 👩🏽‍💻"\r\n```\r\n\r\n' +
        (windowed ? ('padding 中文 '.repeat(12) + '\r\n').repeat(2400) : '') +
        'TAIL\r\n'
      await page.route(/\/src\/file-service\.ts(?:\?|$)/, async (route) => {
        const response = await route.fetch()
        const body = (await response.text()).replace(
          'function createDesktopFileService() {',
          `function createDesktopFileService() {
        const service = createMockFileService(); const text = ${JSON.stringify(text)};
        service.getFileMetadata = async path => ({path,sizeBytes:new TextEncoder().encode(text).length,readonly:false});
        service.openPath = async path => ({documentId:'appearance-document',file:{path},text,diskSnapshotHash:'initial'});
        const save = service.saveFile.bind(service); service.saveFile = async (session, bytes) => {window.__appearanceSavedText=bytes; return save(session,bytes)};
        return service;`,
        )
        await route.fulfill({ response, body })
      })
      await page.goto('/')
      await page.getByRole('button', { name: '菜单', exact: true }).click()
      await page.getByRole('button', { name: '打开', exact: true }).click()
      await expect(page.locator('#app')).toHaveAttribute('data-loading', 'ready')
      await expect(page.locator('.milkup-source-document-view')).toHaveCount(windowed ? 1 : 0)
      const input = page.locator('.milkup-input-proxy')
      await page.keyboard.press(mode === 'source' ? 'Control+1' : 'Control+2')
      await input.focus()
      await page.keyboard.press('Control+End')
      await page.keyboard.type('X')
      await page.keyboard.press('Shift+ArrowLeft')
      // Windowed source publishes its session metrics after the async edit.
      // Capture the committed edit, not the previous frame's version label.
      await expect(page.locator('[data-stat="version"]')).toHaveText('1')
      const before = await page.evaluate(() => {
        const input = document.querySelector('.milkup-input-proxy')!
        Object.assign(window, { appearanceInput: input })
        return {
          version: document.querySelector('[data-stat="version"]')!.textContent,
          cursor: document.querySelector('.milkup-cursor')?.getAttribute('data-position'),
          selection: [...document.querySelectorAll<HTMLElement>('.milkup-selection')].map((e) => [
            e.dataset.from,
            e.dataset.to,
          ]),
        }
      })
      await openAppearance(page)
      await page.getByRole('button', { name: '深色', exact: true }).click()
      await expect(page.getByRole('button', { name: '深色', exact: true })).toBeEnabled()
      await page.getByRole('button', { name: '浅色', exact: true }).click()
      await expect(page.getByRole('button', { name: '浅色', exact: true })).toBeEnabled()
      await page.getByRole('button', { name: '返回正文', exact: true }).click()
      await expect(page.locator('[data-app-menu]')).toBeHidden()
      expect(
        await page.evaluate(
          () =>
            document.querySelector('.milkup-input-proxy') ===
            (window as unknown as { appearanceInput: Element }).appearanceInput,
        ),
      ).toBe(true)
      expect(
        await page.evaluate(() => ({
          version: document.querySelector('[data-stat="version"]')!.textContent,
          cursor: document.querySelector('.milkup-cursor')?.getAttribute('data-position'),
          selection: [...document.querySelectorAll<HTMLElement>('.milkup-selection')].map((e) => [
            e.dataset.from,
            e.dataset.to,
          ]),
        })),
      ).toEqual(before)
      await input.focus()
      await page.keyboard.press('Control+s')
      await expect(page.locator('[data-save-label]')).toContainText('已保存')
      expect(await savedHash(page)).toBe(sha256(text + 'X'))
      await page.keyboard.press('Control+z')
      await page.keyboard.press('Control+s')
      await expect.poll(() => savedHash(page)).toBe(sha256(text))
      await page.keyboard.press('Control+Shift+z')
      await page.keyboard.press('Control+s')
      await expect.poll(() => savedHash(page)).toBe(sha256(text + 'X'))
    })
  }

import { expect, test, type Page } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { formattingFixture } from '../helpers/formatting-plugin'

test.afterEach(async ({ page }, info) => {
  if (info.status !== info.expectedStatus) {
    await info.attach('page-state', {
      body: await page.locator('body').ariaSnapshot(),
      contentType: 'text/plain',
    })
    await page.screenshot({ path: info.outputPath('failure.png'), fullPage: true })
  }
})

const toolbar = (page: Page) => page.locator('[data-plugin-slot="document-toolbar"]')
const modal = (page: Page) => page.getByRole('dialog', { name: '格式与表格', exact: true })
async function seed(page: Page, text: string) {
  await page.keyboard.press('Control+1')
  await page.locator('.milkup-input-proxy').focus()
  await page.keyboard.insertText(text)
  await page.keyboard.press('Control+a')
}
async function open(page: Page) {
  await toolbar(page).getByRole('button', { name: '格式', exact: true }).click()
  await expect(modal(page)).toBeVisible()
  await expect(modal(page).getByRole('button', { name: '一级标题', exact: true })).toBeEnabled()
}
test('formatting Worker preserves Unicode selection and supports toolbar toggle, undo and save', async ({
  page,
}) => {
  await formattingFixture(page)
  await seed(page, '中文😀 text')
  const bold = toolbar(page).getByRole('button', { name: '粗体', exact: true })
  await expect(bold).toBeEnabled()
  await bold.click()
  await expect(page.locator('.milkup-line[data-line="1"]')).toHaveText('**中文😀 text**')
  await bold.click()
  await expect(page.locator('.milkup-line[data-line="1"]')).toHaveText('中文😀 text')
  await page.locator('.milkup-input-proxy').focus()
  await page.keyboard.press('Control+z')
  await expect(page.locator('.milkup-line[data-line="1"]')).toHaveText('**中文😀 text**')
  await page.keyboard.press('Control+s')
  await expect(page.locator('[data-save-dot]')).not.toHaveClass(/is-dirty/)
})
test('formatting modal applies headings and links through retained bounded snapshots', async ({
  page,
}) => {
  await formattingFixture(page)
  await seed(page, '标题中文')
  await open(page)
  await modal(page).getByRole('button', { name: '二级标题', exact: true }).click()
  await expect(modal(page)).toContainText('已应用格式')
  await expect(page.locator('.milkup-line[data-line="1"]')).toHaveText('## 标题中文')
  await modal(page).getByLabel('链接地址', { exact: true }).fill('https://example.com/a(b)')
  await modal(page).getByRole('button', { name: '应用链接', exact: true }).click()
  await expect(page.locator('.milkup-line[data-line="1"]')).toHaveText(
    '## [标题中文](https://example.com/a%28b%29)',
  )
  await modal(page).getByRole('button', { name: '取消链接', exact: true }).click()
  await expect(page.locator('.milkup-line[data-line="1"]')).toHaveText('## 标题中文')
  await page.screenshot({ path: test.info().outputPath('formatting-modal.png') })
})
test('formatting table UI performs real row, column and alignment edits with one-step undo', async ({
  page,
}) => {
  await formattingFixture(page)
  await seed(page, '| A | B |\n| --- | --- |\n| x | y |')
  await page.keyboard.press('Control+Home')
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowRight')
  await open(page)
  await expect(modal(page).getByRole('button', { name: '删除行', exact: true })).toBeDisabled()
  await expect(modal(page).getByRole('button', { name: '删除列', exact: true })).toBeDisabled()
  await modal(page).getByRole('button', { name: '右侧加列', exact: true }).click()
  await expect(page.locator('.milkup-line[data-line="1"]')).toHaveText('| A |  | B |')
  await modal(page).getByRole('button', { name: '列居中', exact: true }).click()
  await expect(page.locator('.milkup-line[data-line="2"]')).toHaveText('| --- | :---: | --- |')
  await modal(page).getByRole('button', { name: '下方加行', exact: true }).click()
  await expect(page.locator('.milkup-line')).toHaveCount(4)
  await page.keyboard.press('Escape')
  await page.locator('.milkup-input-proxy').focus()
  await page.keyboard.press('Control+z')
  await expect(page.locator('.milkup-line')).toHaveCount(3)
  await page.keyboard.press('Control+s')
  await expect(page.locator('[data-save-dot]')).not.toHaveClass(/is-dirty/)
})
test('disabling formatting removes its contributions and retains basic editing/history/save', async ({
  page,
}) => {
  await formattingFixture(page)
  await page.getByRole('button', { name: '菜单', exact: true }).click()
  await page.getByRole('button', { name: '插件', exact: true }).click()
  const card = page.getByRole('button', { name: 'Milkup Formatting 详情', exact: true })
  if (await card.isVisible()) await card.click()
  await page.getByRole('button', { name: '禁用', exact: true }).click()
  await expect(toolbar(page).getByRole('button', { name: '格式', exact: true })).toHaveCount(0)
  await page.locator('[data-menu-close]').click()
  await seed(page, 'without formatting')
  await page.keyboard.press('Control+z')
  await page.keyboard.press('Control+Shift+z')
  await page.keyboard.press('Control+s')
  await expect(page.locator('.milkup-line[data-line="1"]')).toHaveText('without formatting')
  await expect(page.locator('[data-save-dot]')).not.toHaveClass(/is-dirty/)
})
test('formatting context menu submits its command before hiding and restores editor focus on Escape', async ({
  page,
}) => {
  await formattingFixture(page)
  await seed(page, 'context 中文')
  await page.keyboard.press('Shift+F10')
  const menu = page.getByRole('menu', { name: '编辑操作', exact: true })
  await expect(menu).toBeVisible()
  await menu.getByRole('button', { name: '删除线', exact: true }).click()
  await expect(menu).toBeHidden()
  await expect(page.locator('.milkup-line[data-line="1"]')).toHaveText('~~context 中文~~')
  await page.locator('.milkup-input-proxy').focus()
  await page.keyboard.press('Shift+F10')
  await expect(menu).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(menu).toBeHidden()
  await expect(page.locator('.milkup-input-proxy')).toBeFocused()
})

// Native webview zoom reduces the CSS viewport. These browser cases exercise
// that equivalent layout; production OS screenshots verify actual native zoom.
for (const size of [
  { width: 1100, height: 760 },
  { width: 760, height: 520 },
])
  for (const theme of ['light', 'dark'])
    for (const zoom of [1, 1.25, 1.5, 2])
      test(`formatting toolbar geometry ${size.width}x${size.height} ${theme} ${zoom * 100}%`, async ({
        page,
      }) => {
        await page.addInitScript((theme) => {
          localStorage.setItem('milkup.desktop.appearance.v1', JSON.stringify({ theme, zoom: 1 }))
        }, theme)
        await formattingFixture(page)
        await seed(page, '| A | B |\n| --- | --- |\n| x | y |')
        await page.keyboard.press('Control+Home')
        await page.keyboard.press('ArrowDown')
        await page.keyboard.press('ArrowDown')
        await page.keyboard.press('Home')
        await page.keyboard.press('ArrowRight')
        await page.keyboard.press('ArrowRight')
        await expect(
          toolbar(page).getByRole('button', { name: '下方加行', exact: true }),
        ).toBeEnabled()
        await page.setViewportSize({
          width: Math.floor(size.width / zoom),
          height: Math.floor(size.height / zoom),
        })
        for (const platform of ['linux', 'windows']) {
          // Exercise both platform CSS layouts without invoking native APIs.
          await page.locator('#app').evaluate((app, platform) => {
            app.setAttribute('data-platform', platform)
            app.setAttribute('data-custom-chrome', String(platform === 'windows'))
          }, platform)
          const geometry = await page.evaluate(() => {
            const box = (selector: string) => {
              const r = document.querySelector(selector)!.getBoundingClientRect()
              return {
                left: r.left,
                right: r.right,
                top: r.top,
                bottom: r.bottom,
                width: r.width,
                height: r.height,
              }
            }
            return {
              title: box('.document-title'),
              menu: box('[data-menu-toggle]'),
              slot: box('[data-plugin-slot="document-toolbar"]'),
              controls: box('.window-controls'),
              width: innerWidth,
            }
          })
          await test.info().attach(`toolbar-${platform}-bounds`, {
            body: JSON.stringify(geometry, null, 2),
            contentType: 'application/json',
          })
          await writeFile(
            test.info().outputPath(`toolbar-${platform}-bounds.json`),
            JSON.stringify(geometry, null, 2),
          )
          expect(geometry.slot.top).toBeGreaterThanOrEqual(geometry.title.bottom)
          expect(geometry.slot.top).toBeGreaterThanOrEqual(geometry.menu.bottom)
          expect(geometry.slot.left).toBeGreaterThanOrEqual(0)
          expect(geometry.slot.right).toBeLessThanOrEqual(geometry.width)
          expect(geometry.title.left).toBeGreaterThanOrEqual(geometry.menu.right)
          if (platform === 'windows') {
            expect(geometry.controls.width).toBeGreaterThan(0)
            expect(geometry.title.right).toBeLessThanOrEqual(geometry.controls.left)
            expect(geometry.controls.right).toBeLessThanOrEqual(geometry.width)
            expect(geometry.slot.top).toBeGreaterThanOrEqual(geometry.controls.bottom)
          }
          const buttons = toolbar(page).locator('button:not([disabled])')
          const editorScroll = await page.locator('.milkup-editor').evaluate((editor) => ({
            top: editor.scrollTop,
            left: editor.scrollLeft,
            pageTop: window.scrollY,
            pageLeft: window.scrollX,
          }))
          await buttons.first().focus()
          const focusedBounds = []
          for (let i = 0; i < (await buttons.count()); i++) {
            if (i) await page.keyboard.press('Tab')
            await expect(buttons.nth(i)).toBeFocused()
            const button = await buttons.nth(i).boundingBox()
            focusedBounds.push({
              label: await buttons.nth(i).getAttribute('aria-label'),
              ...button,
            })
            // scrollLeft rounds to CSS pixels; retain >=3px of the 4px focus margin.
            expect(button!.x).toBeGreaterThanOrEqual(geometry.slot.left + 3)
            expect(button!.x + button!.width).toBeLessThanOrEqual(geometry.slot.right - 3)
          }
          await test.info().attach(`toolbar-${platform}-focused-bounds`, {
            body: JSON.stringify(focusedBounds, null, 2),
            contentType: 'application/json',
          })
          await writeFile(
            test.info().outputPath(`toolbar-${platform}-focused-bounds.json`),
            JSON.stringify(focusedBounds, null, 2),
          )
          expect(
            await page.locator('.milkup-editor').evaluate((editor) => ({
              top: editor.scrollTop,
              left: editor.scrollLeft,
              pageTop: window.scrollY,
              pageLeft: window.scrollX,
            })),
          ).toEqual(editorScroll)
        }
        await toolbar(page).getByRole('button', { name: '格式', exact: true }).click()
        await expect(modal(page)).toBeVisible()
        await page.keyboard.press('Escape')
        await expect(
          toolbar(page).getByRole('button', { name: '下方加行', exact: true }),
        ).toBeEnabled()
        await page.getByRole('button', { name: '菜单', exact: true }).click()
        await expect(page.locator('[data-app-menu]')).toBeVisible()
        await page.locator('[data-menu-close]').click()
        await page.screenshot({ path: test.info().outputPath('toolbar-geometry.png') })
      })

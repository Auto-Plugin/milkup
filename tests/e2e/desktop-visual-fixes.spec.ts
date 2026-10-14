import { expect, test, type Page } from '@playwright/test'

async function seed(page: Page, text: string) {
  await page.goto('/')
  await expect(page.locator('html')).toHaveAttribute('data-theme', /light|dark/)
  await page.keyboard.press('Control+1')
  await page.locator('.milkup-input-proxy').focus()
  await page.keyboard.insertText(text)
  await page.keyboard.press('Control+Home')
  await page.keyboard.press('Control+2')
}

for (const theme of ['light', 'dark']) {
  test.describe(`visual fixes ${theme}`, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize({ width: 760, height: 520 })
      await page.addInitScript((theme) => {
        localStorage.setItem('milkup.desktop.appearance.v1', JSON.stringify({ theme, zoom: 1 }))
      }, theme)
    })
    test('table delimiters align header and body', async ({ page }) => {
      await seed(page, '| L | C | R |\n| :--- | :---: | ---: |\n| a | 完成 | 123.45 |')
      const alignment = await page
        .locator('.milkup-table-cell')
        .evaluateAll((cells) => cells.map((cell) => getComputedStyle(cell).textAlign))
      expect(alignment).toEqual(['left', 'center', 'right', 'left', 'center', 'right'])
    })
    test('long unbroken table text stays inside its cell', async ({ page }) => {
      await seed(
        page,
        '| L | C | R |\n| :--- | :---: | ---: |\n| identifier_without_breaks_ABCDEFGHIJKLMNOPQRSTUVWXYZ_0123456789 | 完成 | 123.45 |',
      )
      const cell = page.locator('.milkup-line[data-line="3"] .milkup-table-cell').first()
      const measure = () =>
        cell.evaluate((cell) => {
          const bounds = cell.getBoundingClientRect(),
            range = document.createRange()
          range.selectNodeContents(cell)
          return {
            cell: { left: bounds.left, right: bounds.right },
            text: [...range.getClientRects()]
              .filter((r) => r.width > 0)
              .map((r) => ({ left: r.left, right: r.right })),
          }
        })
      for (const width of [760, 380]) {
        await page.setViewportSize({ width, height: 520 })
        const m = await measure()
        expect(m.text.length).toBeGreaterThan(0)
        expect(
          m.text.every((r) => r.left >= m.cell.left && r.right <= m.cell.right + 1),
          JSON.stringify(m),
        ).toBe(true)
      }
    })
    test('nested bold italic closes before mixed language tail', async ({ page }) => {
      await seed(page, '**粗体中的 *斜体*** tail 后文\n\n结束')
      await page.keyboard.press('Control+End')
      const line = page.locator('.milkup-line[data-line="1"]')
      const visible = await line.evaluate((el) => (el as HTMLElement).innerText)
      expect(visible).toBe('粗体中的 斜体 tail 后文')
      expect(
        await line
          .locator('.milkup-inline-emphasis')
          .evaluateAll((nodes) => nodes.map((n) => (n as HTMLElement).innerText)),
      ).toEqual(['斜体'])
    })
    test('code End reveals caret and shifted selection inside viewport', async ({ page }) => {
      await seed(page, '```js\nconsole.log("' + 'abcdefghijklmnopqrstuvwxyz'.repeat(8) + '")\n```')
      await page.locator('.milkup-line[data-line="2"]').click({ position: { x: 30, y: 10 } })
      await page.keyboard.press('End')
      const visible = async () =>
        page.locator('.milkup-cursor').evaluate((el) => {
          const c = el.getBoundingClientRect(),
            v = document.querySelector('.milkup-editor')!.getBoundingClientRect()
          return c.left >= v.left && c.right <= v.right && c.top >= v.top && c.bottom <= v.bottom
        })
      await expect.poll(visible).toBe(true)
      await page.keyboard.press('Shift+ArrowLeft')
      expect(await visible()).toBe(true)
      await expect(page.locator('.milkup-selection')).toHaveCount(1)
      await page.keyboard.insertText('Z')
      await page.keyboard.press('Control+z')
      await page.keyboard.press('Control+1')
      await expect(page.locator('.milkup-line[data-line="2"]')).toHaveText(
        'console.log("' + 'abcdefghijklmnopqrstuvwxyz'.repeat(8) + '")',
      )
    })
    test('editor focus is quiet while keyboard controls retain focus indication', async ({
      page,
    }) => {
      await seed(page, '输入 text')
      await page.locator('.milkup-input-proxy').focus()
      const style = await page.locator('.milkup-editor').evaluate((el) => ({
        shadow: getComputedStyle(el).boxShadow,
        outline: getComputedStyle(el).outlineStyle,
      }))
      expect(style.shadow).toBe('none')
      expect(style.outline).toBe('none')
      await page.getByRole('button', { name: '菜单', exact: true }).focus()
      await page.keyboard.press('Tab')
      expect(
        await page.evaluate(() =>
          parseFloat(getComputedStyle(document.activeElement!).outlineWidth),
        ),
      ).toBeGreaterThan(0)
    })
    test('task click changes source once and supports undo redo and keyboard', async ({ page }) => {
      const text = '- [ ] 中文 😀 task\n- plain\n- [X] done'
      await seed(page, text)
      const taskLine = page.locator('.milkup-line[data-line="1"]')
      expect(await taskLine.evaluate((el) => (el as HTMLElement).innerText)).not.toContain('•')
      await expect(page.locator('.milkup-line[data-line="2"] .milkup-list-marker')).toHaveText('•')
      await page.locator('.milkup-task-marker').first().click()
      await expect(page.locator('.milkup-task-marker').first()).toHaveAttribute(
        'data-checked',
        'true',
      )
      await page.locator('.milkup-input-proxy').focus()
      await page.keyboard.press('Control+1')
      await expect(taskLine).toHaveText('- [x] 中文 😀 task')
      await page.keyboard.press('Control+z')
      await expect(taskLine).toHaveText('- [ ] 中文 😀 task')
      await page.keyboard.press('Control+Shift+z')
      await expect(taskLine).toHaveText('- [x] 中文 😀 task')
      await page.keyboard.press('Control+2')
      await page.locator('.milkup-task-marker').first().focus()
      await page.keyboard.press('Space')
      await expect(page.locator('.milkup-task-marker').first()).toHaveAttribute(
        'data-checked',
        'false',
      )
    })
  })
}

for (const mode of ['source', 'live'])
  test(`${mode} horizontal caret reveal returns Home and preserves hit testing`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 760, height: 520 })
    const line = 'console.log("' + 'abcdefghijklmnopqrstuvwxyz'.repeat(8) + '")'
    await seed(page, '```js\n' + line + '\n```')
    if (mode === 'source') await page.keyboard.press('Control+1')
    await page.locator('.milkup-line[data-line="2"]').click({ position: { x: 30, y: 10 } })
    await page.keyboard.press('End')
    await expect
      .poll(() =>
        page.locator('.milkup-cursor').evaluate((el) => {
          const c = el.getBoundingClientRect(),
            v = document.querySelector('.milkup-editor')!.getBoundingClientRect()
          return c.left >= v.left && c.right <= v.right
        }),
      )
      .toBe(true)
    await page.keyboard.press('Home')
    await expect(page.locator('.milkup-cursor')).toHaveAttribute('data-position', '6')
    const rootScroll = await page.locator('.milkup-editor').evaluate((el) => el.scrollLeft)
    expect(rootScroll).toBeLessThanOrEqual(26)
    const homeCaret = await page.locator('.milkup-cursor').boundingBox()
    expect(homeCaret!.x).toBeGreaterThanOrEqual(0)
    expect(homeCaret!.x + homeCaret!.width).toBeLessThan(760)
  })

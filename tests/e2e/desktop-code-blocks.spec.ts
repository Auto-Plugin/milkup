import { expect, test } from '@playwright/test'

for (const windowed of [false, true])
  for (const theme of ['light', 'dark']) {
    test(`${windowed ? 'windowed' : 'ordinary'} ${theme} code language, source editing and bounded layout`, async ({
      page,
    }, info) => {
      const body = 'const 名 = "😀 <img src=x>"; // 注释'
      const long = 'console.log("' + 'long'.repeat(80) + '");'
      const text =
        '```js title="demo"\r\n' +
        body +
        '\r\n' +
        long +
        '\r\n```\r\n' +
        (windowed ? ('padding text '.repeat(8) + '\r\n').repeat(24000) : '')
      await page.setViewportSize({ width: 760, height: 520 })
      await page.addInitScript(
        (theme) =>
          localStorage.setItem('milkup.desktop.appearance.v1', JSON.stringify({ theme, zoom: 1 })),
        theme,
      )
      await page.route(/\/src\/file-service\.ts(?:\?|$)/, async (route) => {
        const response = await route.fetch()
        const body = (await response.text()).replace(
          'function createDesktopFileService() {',
          `function createDesktopFileService() {
          const service = createMockFileService(); const text = ${JSON.stringify(text)};
          service.getFileMetadata = async path => ({path,sizeBytes:new TextEncoder().encode(text).length,readonly:false});
          service.openPath = async path => ({documentId:'code-document',file:{path},text,diskSnapshotHash:'initial'});
          return service;`,
        )
        await route.fulfill({ response, body })
      })
      await page.goto('/')
      await page.getByRole('button', { name: '菜单', exact: true }).click()
      await page.getByRole('button', { name: '打开', exact: true }).click()
      await expect(page.locator('#app')).toHaveAttribute('data-loading', 'ready')
      await expect(page.locator('.milkup-source-document-view')).toHaveCount(windowed ? 1 : 0)
      await page.keyboard.press('Control+2')
      const picker = page.getByLabel('Code language', { exact: true })
      await expect(picker).toHaveValue('javascript')
      // Source spans remain available for exact mapping/copy, but neither fence
      // is painted beside the language control in Live mode.
      await expect(page.locator('.milkup-code-source').first()).toHaveText('```js title="demo"')
      await expect(page.locator('.milkup-code-source').first()).toBeHidden()
      await expect(page.locator('.milkup-line[data-line="4"] .milkup-code-source')).toHaveText(
        '```',
      )
      await expect(page.locator('.milkup-line[data-line="4"]')).toHaveCSS('height', '0px')
      await expect(page.locator('.milkup-code-token-keyword').first()).toHaveText('const')
      await expect(page.locator('.milkup-code-source').nth(1)).toHaveText(body)
      await expect(page.locator('.milkup-code-source img')).toHaveCount(0)
      await picker.selectOption('typescript')
      await expect(page.locator('.milkup-code-source').first()).toHaveText(
        '```typescript title="demo"',
      )
      await expect(page.locator('.milkup-code-source').first()).toBeHidden()
      // Changing the picker returns to the retained document selection, including history shortcuts.
      await page.keyboard.press('Control+z')
      await expect(page.locator('.milkup-code-source').first()).toHaveText('```js title="demo"')
      await page.keyboard.press('Control+Shift+z')
      await expect(page.locator('.milkup-code-source').first()).toHaveText(
        '```typescript title="demo"',
      )
      const keyword = page.locator('.milkup-code-token-keyword').first()
      await keyword.click({ position: { x: 1, y: 9 } })
      await page.keyboard.press('Home')
      await page.keyboard.insertText('新😀')
      await expect(page.locator('.milkup-code-source').nth(1)).toHaveText('新😀' + body)
      await page.keyboard.press('Control+z')
      await expect(page.locator('.milkup-code-source').nth(1)).toHaveText(body)
      for (const width of [760, 380]) {
        await page.setViewportSize({ width, height: 520 })
        await page.keyboard.press('Control+Home')
        const geometry = await picker.evaluate((picker) => {
          const p = picker.getBoundingClientRect(),
            e = document.querySelector('.milkup-editor')!.getBoundingClientRect()
          const token = document.querySelector('.milkup-code-token-keyword')!,
            code = document.querySelector('.milkup-code-source')!
          return {
            left: p.left,
            right: p.right,
            editorLeft: e.left,
            editorRight: e.right,
            width: p.width,
            tokenColor: getComputedStyle(token).color,
            sourceColor: getComputedStyle(code).color,
          }
        })
        expect(geometry.width).toBeGreaterThan(30)
        expect(geometry.left).toBeGreaterThanOrEqual(geometry.editorLeft)
        expect(geometry.right).toBeLessThanOrEqual(geometry.editorRight)
        expect(geometry.tokenColor).not.toBe(geometry.sourceColor)
        await page.screenshot({ path: info.outputPath(`code-${width}-language.png`) })
        await page.locator('.milkup-line[data-line="3"]').click({ position: { x: 24, y: 9 } })
        await page.keyboard.press('End')
        await expect
          .poll(() => page.locator('.milkup-line[data-line="3"]').evaluate((el) => el.scrollLeft))
          .toBeGreaterThan(0)
        const cursor = await page.locator('.milkup-cursor').evaluate((el) => {
          const c = el.getBoundingClientRect(),
            e = document.querySelector('.milkup-editor')!.getBoundingClientRect()
          return c.left >= e.left && c.right <= e.right
        })
        expect(cursor).toBe(true)
        await page.screenshot({ path: info.outputPath(`code-${width}.png`) })
      }
      await page.keyboard.press('Control+1')
      await expect(page.locator('.milkup-line[data-line="1"]')).toHaveText(
        '```typescript title="demo"',
      )
      await expect(page.locator('.milkup-line[data-line="2"]')).toHaveText(body)
      await expect(page.locator('.milkup-line[data-line="1"]')).toBeVisible()
      await expect(page.locator('.milkup-line[data-line="4"]')).toHaveText('```')
      await expect(page.locator('.milkup-line[data-line="4"]')).toBeVisible()
      await expect(page.locator('.milkup-code-language')).toHaveCount(0)
    })
  }

for (const windowed of [false, true]) {
  for (const [initial, selected, beforeCount, afterCount] of [
    ['', 'javascript', 0, 1],
    ['javascript', '', 1, 0],
    ['unknown', 'javascript', 0, 1],
  ] as const) {
    test(`${windowed ? 'windowed' : 'ordinary'} refreshes code body for ${initial || 'plain'} to ${selected || 'plain'} and history`, async ({
      page,
    }, info) => {
      const body = 'const 名 = "😀 <img src=x>"; // 原文保持'
      const text =
        '```' +
        initial +
        '\r\n' +
        body +
        '\r\n```\r\n' +
        (windowed ? ('padding text '.repeat(8) + '\r\n').repeat(24000) : '')
      await page.route(/\/src\/file-service\.ts(?:\?|$)/, async (route) => {
        const response = await route.fetch()
        const body = (await response.text()).replace(
          'function createDesktopFileService() {',
          `function createDesktopFileService() {
          const service = createMockFileService(); const text = ${JSON.stringify(text)};
          service.getFileMetadata = async path => ({path,sizeBytes:new TextEncoder().encode(text).length,readonly:false});
          service.openPath = async path => ({documentId:'code-refresh',file:{path},text,diskSnapshotHash:'initial'});
          return service;`,
        )
        await route.fulfill({ response, body })
      })
      await page.goto('/')
      await page.getByRole('button', { name: '菜单', exact: true }).click()
      await page.getByRole('button', { name: '打开', exact: true }).click()
      await expect(page.locator('#app')).toHaveAttribute('data-loading', 'ready')
      await expect(page.locator('.milkup-source-document-view')).toHaveCount(windowed ? 1 : 0)
      await page.keyboard.press('Control+2')
      const keywords = page.locator('.milkup-code-token-keyword')
      const codeBody = page.locator('.milkup-line[data-line="2"]')
      await expect(keywords).toHaveCount(beforeCount)
      await page.getByLabel('Code language', { exact: true }).selectOption(selected)
      await expect(keywords).toHaveCount(afterCount)
      await expect(codeBody).toHaveAttribute('data-code-language', selected)
      await expect(codeBody).toHaveText(body)
      await page.screenshot({ path: info.outputPath('selected.png') })
      await page.keyboard.press('Control+z')
      await expect(keywords).toHaveCount(beforeCount)
      await expect(codeBody).toHaveAttribute('data-code-language', initial)
      await expect(codeBody).toHaveText(body)
      await page.keyboard.press('Control+Shift+z')
      await expect(keywords).toHaveCount(afterCount)
      await expect(codeBody).toHaveAttribute('data-code-language', selected)
      await expect(codeBody).toHaveText(body)
      await page.keyboard.press('Control+1')
      await expect(page.locator('.milkup-line[data-line="1"]')).toHaveText('```' + selected)
      await expect(page.locator('.milkup-line[data-line="2"]')).toHaveText(body)
    })
  }
}

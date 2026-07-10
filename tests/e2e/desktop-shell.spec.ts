import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

async function runMenuCommand(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name: '菜单' }).click()
  await page.getByRole('button', { name, exact: true }).click()
}

async function runDeveloperCommand(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name: '菜单' }).click()
  await page.getByText('开发者面板').click()
  await page.getByRole('button', { name, exact: true }).click()
}

test('desktop shell loads editor and tracks dirty session state', async ({ page }) => {
  await page.goto('/')

  await expect(page.getByRole('heading', { name: '未命名' })).toBeVisible()
  await expect(page.locator('.milkup-editor')).toHaveAttribute('data-mode', 'live')
  await expect(page.locator('#app')).toHaveAttribute('data-sidebar-collapsed', 'true')
  await expect(page.locator('#app')).toHaveAttribute('data-empty-document', 'true')
  await expect(page.locator('[data-save-label]')).toContainText('已保存')
  await expect(page.locator('[data-title-path]')).toHaveText('未保存')
  await expect(page.locator('[data-stat="char-count"]')).toHaveText('0 字符')
  await expect(page.locator('[data-stat="notice"]')).toHaveCount(0)
  await expect(page.locator('[data-stat="version"]')).toHaveText('0')
  await expect(page.locator('[data-stat="saved"]')).toHaveText('0')
  await expect(page.locator('[data-stat="line-ending"]')).toHaveText('lf')

  await runMenuCommand(page, '打开')

  await expect(page.getByRole('heading', { name: 'sample' })).toBeVisible()
  await expect(page.locator('[data-title-path]')).toHaveText('D:/notes')
  await expect(page.locator('[data-save-label]')).toContainText('已保存')
  await expect(page.locator('[data-stat="document-id"]')).toHaveText('desktop-sample')
  await expect(page.locator('[data-stat="line-ending"]')).toHaveText('crlf')
  await expect(page.locator('[data-stat="version"]')).toHaveText('0')
  await expect(page.locator('[data-stat="saved"]')).toHaveText('0')

  await runMenuCommand(page, '在文件夹中显示')

  await expect(page.locator('[data-stat="document-id"]')).toHaveText('desktop-sample')

  await page.keyboard.type('hello')

  await expect(page.locator('[data-save-label]')).toContainText('未保存')
  await expect(page.locator('[data-stat="char-count"]')).toHaveText('66 字符')
  await expect(page.locator('[data-stat="version"]')).toHaveText('5')
  await expect(page.locator('[data-stat="saved"]')).toHaveText('0')

  await page.keyboard.press('Control+1')

  await expect(page.locator('.milkup-editor')).toHaveAttribute('data-mode', 'source')
  await page.getByRole('button', { name: '源码' }).click()
  await expect(page.locator('.milkup-editor')).toHaveAttribute('data-mode', 'live')
  await expect(page.locator('[data-save-label]')).toContainText('未保存')

  await runMenuCommand(page, '保存')

  await expect(page.locator('[data-save-label]')).toContainText('已保存')
  await expect(page.locator('[data-stat="version"]')).toHaveText('5')
  await expect(page.locator('[data-stat="saved"]')).toHaveText('5')
  await expect(page.locator('[data-stat="line-ending"]')).toHaveText('crlf')

  await page.keyboard.type('!')

  await expect(page.locator('[data-save-label]')).toContainText('未保存')
  await expect(page.locator('[data-stat="version"]')).toHaveText('6')
  await expect(page.locator('[data-stat="saved"]')).toHaveText('5')

  await runMenuCommand(page, '另存为')

  await expect(page.locator('[data-save-label]')).toContainText('已保存')
  await expect(page.locator('[data-title-path]')).toHaveText('D:/notes')
  await expect(page.locator('[data-stat="version"]')).toHaveText('6')
  await expect(page.locator('[data-stat="saved"]')).toHaveText('6')

  await runDeveloperCommand(page, '模拟外部修改')

  await expect(page.locator('[data-stat="external"]')).toHaveText('modified-clean')
  await expect(page.locator('[data-save-label]')).toContainText('已保存')

  await runMenuCommand(page, '重新载入外部更改')

  await expect(page.getByRole('heading', { name: 'sample' })).toBeVisible()
  await expect(page.locator('[data-stat="external"]')).toHaveText('none')
  await expect(page.locator('[data-save-label]')).toContainText('已保存')
  await expect(page.locator('[data-stat="version"]')).toHaveText('7')
  await expect(page.locator('[data-stat="saved"]')).toHaveText('7')
  await expect(page.locator('[data-stat="line-ending"]')).toHaveText('crlf')

  await runDeveloperCommand(page, '模拟外部删除')

  await expect(page.locator('[data-stat="external"]')).toHaveText('deleted-clean')
  await expect(page.locator('[data-save-label]')).toContainText('已保存')
  await runMenuCommand(page, '保存')

  await expect(page.locator('[data-stat="external"]')).toHaveText('deleted-clean')

  await page.keyboard.type('?')

  await expect(page.locator('[data-save-label]')).toContainText('未保存')
  await expect(page.locator('[data-stat="external"]')).toHaveText('conflict')
  await runMenuCommand(page, '关闭标签')

  await expect(page.locator('[data-save-label]')).toContainText('未保存')
  await expect(page.locator('[data-stat="document-id"]')).toHaveText('desktop-sample')

  await runDeveloperCommand(page, '模拟外部修改')

  await expect(page.locator('[data-stat="external"]')).toHaveText('conflict')
  await runMenuCommand(page, '保存')

  await expect(page.locator('[data-save-label]')).toContainText('未保存')
  await expect(page.locator('[data-stat="external"]')).toHaveText('conflict')

  await runMenuCommand(page, '新建')
  await runMenuCommand(page, '在文件夹中显示')

  await expect(page.getByRole('heading', { name: '未命名' })).toBeVisible()
  await expect(page.locator('[data-stat="document-id"]')).toContainText('desktop-untitled')
})

test('desktop shell imports pasted image files through asset provider', async ({ page }) => {
  await page.goto('/')
  await runMenuCommand(page, '打开')

  await page.evaluate(() => {
    const dataTransfer = new DataTransfer()
    dataTransfer.items.add(
      new File([new Uint8Array([1, 2, 3])], 'Diagram Final.PNG', { type: 'image/png' }),
    )
    const input = document.querySelector<HTMLTextAreaElement>('.milkup-input-proxy')

    if (!input) {
      throw new Error('Editor input proxy was not found')
    }

    input.dispatchEvent(
      new ClipboardEvent('paste', {
        clipboardData: dataTransfer,
        bubbles: true,
        cancelable: true,
      }),
    )
  })

  await expect(page.locator('.milkup-editor-content')).toContainText(
    '![diagram-final](assets/diagram-final.png)',
  )
  await expect(page.locator('[data-save-label]')).toContainText('未保存')
  await expect(page.locator('[data-stat="version"]')).toHaveText('1')
})

test('desktop search highlights matches and moves the active result', async ({ page }) => {
  await page.goto('/')
  await page.keyboard.type('alpha target beta target')
  await page.keyboard.press('Control+F')

  const search = page.getByRole('searchbox', { name: '搜索' })
  await search.fill('target')
  await search.press('Enter')

  await expect(page.locator('[data-search-result-count]')).toHaveText('1/2')
  await expect(page.locator('.milkup-search-highlight')).toHaveCount(2)
  await expect(page.locator('.milkup-search-highlight.is-active')).toHaveAttribute(
    'data-index',
    '0',
  )

  await page.getByRole('button', { name: '下一个结果' }).click()
  await expect(page.locator('[data-search-result-count]')).toHaveText('2/2')
  await expect(page.locator('.milkup-search-highlight.is-active')).toHaveAttribute(
    'data-index',
    '1',
  )
})

test('closing search cancels the active scan and clears highlights', async ({ page }) => {
  await page.goto('/')
  await page.keyboard.type('alpha target beta target')
  await page.keyboard.press('Control+F')

  await page.evaluate(() => {
    const input = document.querySelector<HTMLInputElement>('[data-search-input]')
    const close = document.querySelector<HTMLButtonElement>('[data-search-close]')

    if (!input || !close) {
      throw new Error('Search controls are unavailable')
    }

    input.value = 'target'
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    close.click()
  })

  await expect(page.locator('[data-floating-search]')).toBeHidden()
  await expect(page.locator('[data-search-loading]')).toBeHidden()
  await expect(page.locator('[data-search-idle-icon]')).not.toHaveAttribute('hidden', '')
  await expect(page.locator('.milkup-search-highlight')).toHaveCount(0)
  await page.waitForTimeout(100)
  await expect(page.locator('.milkup-search-highlight')).toHaveCount(0)
})

test('desktop shell routes primary shortcuts through active document actions', async ({ page }) => {
  await page.goto('/')

  await page.keyboard.press('Control+O')
  await expect(page.getByRole('heading', { name: 'sample' })).toBeVisible()
  await expect(page.locator('[data-title-path]')).toHaveText('D:/notes')

  await page.keyboard.type('shortcut-save-token')
  await expect(page.locator('[data-save-label]')).toContainText('未保存')

  await page.keyboard.press('Control+S')
  await expect(page.locator('[data-save-label]')).toContainText('已保存')

  await page.keyboard.type(' shortcut-save-as-token')
  await page.keyboard.press('Control+Shift+S')
  await expect(page.locator('[data-save-label]')).toContainText('已保存')

  await page.keyboard.press('Control+2')
  await expect(page.locator('.milkup-editor')).toHaveAttribute('data-mode', 'live')
  await page.keyboard.press('Control+1')
  await expect(page.locator('.milkup-editor')).toHaveAttribute('data-mode', 'source')
  await page.keyboard.press('Control+/')
  await expect(page.locator('.milkup-editor')).toHaveAttribute('data-mode', 'live')
  await page.keyboard.press('Control+/')
  await expect(page.locator('.milkup-editor')).toHaveAttribute('data-mode', 'source')
  await page.keyboard.press('Control+/')
  await expect(page.locator('.milkup-editor')).toHaveAttribute('data-mode', 'live')

  await page.keyboard.press('Control+F')
  await expect(page.getByRole('searchbox', { name: '搜索' })).toBeVisible()
  await page.getByRole('button', { name: '关闭搜索' }).click()
  await expect(page.getByRole('searchbox', { name: '搜索' })).toBeHidden()

  await page.keyboard.type(' shortcut-undo-token')
  await expect(page.locator('.milkup-editor-content')).toContainText('shortcut-undo-token')
  await page.keyboard.press('Control+Z')
  await expect(page.locator('.milkup-editor-content')).not.toContainText('shortcut-undo-token')
  await page.keyboard.press('Control+Y')
  await expect(page.locator('.milkup-editor-content')).toContainText('shortcut-undo-token')

  await page.keyboard.press('Control+A')
  const cutText = await page.evaluate(() => {
    const input = document.querySelector<HTMLTextAreaElement>('.milkup-input-proxy')

    if (!input) {
      throw new Error('Editor input proxy was not found')
    }

    const clipboardData = new DataTransfer()
    const event = new ClipboardEvent('cut', {
      bubbles: true,
      cancelable: true,
    })

    Object.defineProperty(event, 'clipboardData', {
      value: clipboardData,
    })
    input.dispatchEvent(event)

    return clipboardData.getData('text/plain')
  })

  expect(cutText).toContain('shortcut-undo-token')
  await expect(page.locator('.milkup-editor-content')).not.toContainText('shortcut-undo-token')
  await expect(page.locator('[data-save-label]')).toContainText('未保存')

  await page.keyboard.press('Control+W')
  await expect(page.locator('[data-save-label]')).toContainText('未保存')

  await page.keyboard.press('Control+S')
  await expect(page.locator('[data-save-label]')).toContainText('已保存')
  await page.keyboard.press('Control+W')
  await expect(page.getByRole('heading', { name: '未命名' })).toBeVisible()

  await page.keyboard.press('Control+N')
  await expect(page.getByRole('heading', { name: '未命名' })).toBeVisible()
})

test('desktop shell confirms before closing a dirty window', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'platform', {
      value: 'Win32',
    })
  })
  await page.goto('/')

  await page.keyboard.type('dirty')
  await expect(page.locator('[data-save-label]')).toContainText('未保存')

  await page.locator('#app').evaluate((app) => {
    app.setAttribute('data-custom-chrome', 'true')
  })
  await page.locator('[data-window-control="close"]').click()

  const dialog = page.getByRole('dialog', { name: '文档尚未保存' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('button', { name: '取消' })).toBeVisible()
  await expect(dialog.getByRole('button', { name: '保存并退出', exact: true })).toBeVisible()
  await expect(dialog.getByRole('button', { name: '不保存并退出' })).toBeVisible()

  await dialog.getByRole('button', { name: '取消' }).click()
  await expect(dialog).toBeHidden()
  await expect(page.locator('[data-save-label]')).toContainText('未保存')

  await page.locator('[data-window-control="close"]').click()
  await dialog.getByRole('button', { name: '保存并退出', exact: true }).click()
  await expect(dialog).toBeHidden()
  await expect(page.locator('[data-save-label]')).toContainText('已保存')
})


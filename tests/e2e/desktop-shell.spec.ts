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
  await expect(page.locator('[data-session-state]')).toContainText('已保存')
  await expect(page.locator('[data-stat="version"]')).toHaveText('0')
  await expect(page.locator('[data-stat="saved"]')).toHaveText('0')
  await expect(page.locator('[data-stat="path"]')).toHaveText('未保存')
  await expect(page.locator('[data-stat="line-ending"]')).toHaveText('lf')

  await runMenuCommand(page, '打开')

  await expect(page.getByRole('heading', { name: 'D:/notes/sample.md' })).toBeVisible()
  await expect(page.locator('[data-session-state]')).toContainText('已保存')
  await expect(page.locator('[data-stat="document-id"]')).toHaveText('desktop-sample')
  await expect(page.locator('[data-stat="path"]')).toHaveText('D:/notes/sample.md')
  await expect(page.locator('[data-stat="line-ending"]')).toHaveText('crlf')
  await expect(page.locator('[data-stat="recent"]')).toContainText('D:/notes/sample.md')
  await expect(page.locator('[data-stat="version"]')).toHaveText('0')
  await expect(page.locator('[data-stat="saved"]')).toHaveText('0')

  await runMenuCommand(page, '在文件夹中显示')

  await expect(page.locator('[data-stat="notice"]')).toHaveText(
    '已在文件夹中显示：D:/notes/sample.md',
  )

  await page.keyboard.type('hello')

  await expect(page.locator('[data-session-state]')).toContainText('有未保存更改')
  await expect(page.locator('[data-stat="version"]')).toHaveText('5')
  await expect(page.locator('[data-stat="saved"]')).toHaveText('0')

  await page.keyboard.press('Control+1')

  await expect(page.locator('.milkup-editor')).toHaveAttribute('data-mode', 'source')
  await page.getByRole('button', { name: '源码' }).click()
  await expect(page.locator('.milkup-editor')).toHaveAttribute('data-mode', 'live')
  await expect(page.locator('[data-session-state]')).toContainText('有未保存更改')

  await runMenuCommand(page, '保存')

  await expect(page.locator('[data-session-state]')).toContainText('已保存')
  await expect(page.locator('[data-stat="version"]')).toHaveText('5')
  await expect(page.locator('[data-stat="saved"]')).toHaveText('5')
  await expect(page.locator('[data-stat="line-ending"]')).toHaveText('crlf')

  await page.keyboard.type('!')

  await expect(page.locator('[data-session-state]')).toContainText('有未保存更改')
  await expect(page.locator('[data-stat="version"]')).toHaveText('6')
  await expect(page.locator('[data-stat="saved"]')).toHaveText('5')

  await runMenuCommand(page, '另存为')

  await expect(page.locator('[data-session-state]')).toContainText('已保存')
  await expect(page.locator('[data-stat="path"]')).toHaveText('D:/notes/sample.md')
  await expect(page.locator('[data-stat="version"]')).toHaveText('6')
  await expect(page.locator('[data-stat="saved"]')).toHaveText('6')

  await runDeveloperCommand(page, '模拟外部修改')

  await expect(page.locator('[data-stat="external"]')).toHaveText('modified-clean')
  await expect(page.locator('[data-session-state]')).toContainText('已保存')

  await runMenuCommand(page, '重新载入外部更改')

  await expect(page.locator('[data-stat="notice"]')).toHaveText('已重新载入外部更改')
  await expect(page.getByRole('heading', { name: 'D:/notes/sample.md' })).toBeVisible()
  await expect(page.locator('[data-stat="external"]')).toHaveText('none')
  await expect(page.locator('[data-session-state]')).toContainText('已保存')
  await expect(page.locator('[data-stat="version"]')).toHaveText('7')
  await expect(page.locator('[data-stat="saved"]')).toHaveText('7')
  await expect(page.locator('[data-stat="line-ending"]')).toHaveText('crlf')

  await runDeveloperCommand(page, '模拟外部删除')

  await expect(page.locator('[data-stat="external"]')).toHaveText('deleted-clean')
  await expect(page.locator('[data-session-state]')).toContainText('已保存')
  await runMenuCommand(page, '保存')

  await expect(page.locator('[data-stat="notice"]')).toContainText('文件已在编辑器外发生变化。')

  await page.keyboard.type('?')

  await expect(page.locator('[data-session-state]')).toContainText('有未保存更改')
  await expect(page.locator('[data-stat="external"]')).toHaveText('conflict')
  await runMenuCommand(page, '关闭标签')

  await expect(page.locator('[data-stat="notice"]')).toContainText('无法关闭')
  await expect(page.locator('[data-session-state]')).toContainText('有未保存更改')
  await expect(page.locator('[data-stat="document-id"]')).toHaveText('desktop-sample')

  await runDeveloperCommand(page, '模拟外部修改')

  await expect(page.locator('[data-stat="external"]')).toHaveText('conflict')
  await runMenuCommand(page, '保存')

  await expect(page.locator('[data-stat="notice"]')).toContainText('文件已在编辑器外发生变化。')
  await expect(page.locator('[data-session-state]')).toContainText('有未保存更改')

  await runMenuCommand(page, '新建')
  await runMenuCommand(page, '在文件夹中显示')

  await expect(page.locator('[data-stat="notice"]')).toHaveText(
    '无法在文件夹中显示：unsaved-document',
  )
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
  await expect(page.locator('[data-session-state]')).toContainText('有未保存更改')
  await expect(page.locator('[data-stat="version"]')).toHaveText('1')
})

test('desktop shell routes primary shortcuts through active document actions', async ({ page }) => {
  await page.goto('/')

  await page.keyboard.press('Control+O')
  await expect(page.locator('[data-stat="path"]')).toHaveText('D:/notes/sample.md')

  await page.keyboard.type('shortcut-save-token')
  await expect(page.locator('[data-session-state]')).toContainText('有未保存更改')

  await page.keyboard.press('Control+S')
  await expect(page.locator('[data-session-state]')).toContainText('已保存')
  await expect(page.locator('[data-stat="notice"]')).toHaveText('已保存')

  await page.keyboard.type(' shortcut-save-as-token')
  await page.keyboard.press('Control+Shift+S')
  await expect(page.locator('[data-session-state]')).toContainText('已保存')
  await expect(page.locator('[data-stat="notice"]')).toHaveText('已另存为')

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
  await expect(page.locator('[data-session-state]')).toContainText('有未保存更改')

  await page.keyboard.press('Control+W')
  await expect(page.locator('[data-stat="notice"]')).toContainText('无法关闭')

  await page.keyboard.press('Control+S')
  await expect(page.locator('[data-session-state]')).toContainText('已保存')
  await page.keyboard.press('Control+W')
  await expect(page.locator('[data-stat="notice"]')).toHaveText('已关闭文档')

  await page.keyboard.press('Control+N')
  await expect(page.locator('[data-stat="notice"]')).toHaveText('已新建文档')
  await expect(page.getByRole('heading', { name: '未命名' })).toBeVisible()
})

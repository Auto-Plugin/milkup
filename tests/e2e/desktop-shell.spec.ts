import { expect, test } from '@playwright/test'

test('desktop shell loads editor and tracks dirty session state', async ({ page }) => {
  await page.goto('/')

  await expect(page.getByRole('heading', { name: '未命名' })).toBeVisible()
  await expect(page.locator('.milkup-editor')).toHaveAttribute('data-mode', 'source')
  await expect(page.locator('[data-session-state]')).toContainText('已保存')
  await expect(page.locator('[data-stat="version"]')).toHaveText('0')
  await expect(page.locator('[data-stat="saved"]')).toHaveText('0')
  await expect(page.locator('[data-stat="path"]')).toHaveText('未保存')
  await expect(page.locator('[data-stat="line-ending"]')).toHaveText('lf')

  await page.getByRole('button', { name: '打开' }).click()

  await expect(page.getByRole('heading', { name: 'D:/notes/sample.md' })).toBeVisible()
  await expect(page.locator('[data-session-state]')).toContainText('已保存')
  await expect(page.locator('[data-stat="document-id"]')).toHaveText('desktop-sample')
  await expect(page.locator('[data-stat="path"]')).toHaveText('D:/notes/sample.md')
  await expect(page.locator('[data-stat="line-ending"]')).toHaveText('crlf')
  await expect(page.locator('[data-stat="recent"]')).toContainText('D:/notes/sample.md')
  await expect(page.locator('[data-stat="version"]')).toHaveText('0')
  await expect(page.locator('[data-stat="saved"]')).toHaveText('0')

  await page.getByRole('button', { name: '在文件夹中显示' }).click()

  await expect(page.locator('[data-stat="notice"]')).toHaveText(
    '已在文件夹中显示：D:/notes/sample.md',
  )

  await page.keyboard.type('hello')

  await expect(page.locator('[data-session-state]')).toContainText('有未保存更改')
  await expect(page.locator('[data-stat="version"]')).toHaveText('5')
  await expect(page.locator('[data-stat="saved"]')).toHaveText('0')

  await page.getByRole('button', { name: '实时' }).click()

  await expect(page.locator('.milkup-editor')).toHaveAttribute('data-mode', 'live')
  await expect(page.locator('[data-session-state]')).toContainText('有未保存更改')

  await page.getByRole('button', { name: '保存', exact: true }).click()

  await expect(page.locator('[data-session-state]')).toContainText('已保存')
  await expect(page.locator('[data-stat="version"]')).toHaveText('5')
  await expect(page.locator('[data-stat="saved"]')).toHaveText('5')
  await expect(page.locator('[data-stat="line-ending"]')).toHaveText('crlf')

  await page.keyboard.type('!')

  await expect(page.locator('[data-session-state]')).toContainText('有未保存更改')
  await expect(page.locator('[data-stat="version"]')).toHaveText('6')
  await expect(page.locator('[data-stat="saved"]')).toHaveText('5')

  await page.getByRole('button', { name: '另存为' }).click()

  await expect(page.locator('[data-session-state]')).toContainText('已保存')
  await expect(page.locator('[data-stat="path"]')).toHaveText('D:/notes/sample.md')
  await expect(page.locator('[data-stat="version"]')).toHaveText('6')
  await expect(page.locator('[data-stat="saved"]')).toHaveText('6')

  await page.getByRole('button', { name: '模拟外部修改' }).click()

  await expect(page.locator('[data-stat="external"]')).toHaveText('modified-clean')
  await expect(page.locator('[data-session-state]')).toContainText('已保存')

  await page.getByRole('button', { name: '重新载入外部更改' }).click()

  await expect(page.locator('[data-stat="notice"]')).toHaveText('已重新载入外部更改')
  await expect(page.getByRole('heading', { name: 'D:/notes/sample.md' })).toBeVisible()
  await expect(page.locator('[data-stat="external"]')).toHaveText('none')
  await expect(page.locator('[data-session-state]')).toContainText('已保存')
  await expect(page.locator('[data-stat="version"]')).toHaveText('7')
  await expect(page.locator('[data-stat="saved"]')).toHaveText('7')
  await expect(page.locator('[data-stat="line-ending"]')).toHaveText('crlf')

  await page.getByRole('button', { name: '模拟外部删除' }).click()

  await expect(page.locator('[data-stat="external"]')).toHaveText('deleted-clean')
  await expect(page.locator('[data-session-state]')).toContainText('已保存')
  await page.getByRole('button', { name: '保存', exact: true }).click()

  await expect(page.locator('[data-stat="notice"]')).toContainText('文件已在编辑器外发生变化。')

  await page.keyboard.type('?')

  await expect(page.locator('[data-session-state]')).toContainText('有未保存更改')
  await expect(page.locator('[data-stat="external"]')).toHaveText('conflict')
  await page.getByRole('button', { name: '关闭标签' }).click()

  await expect(page.locator('[data-stat="notice"]')).toContainText('无法关闭')
  await expect(page.locator('[data-session-state]')).toContainText('有未保存更改')
  await expect(page.locator('[data-stat="document-id"]')).toHaveText('desktop-sample')

  await page.getByRole('button', { name: '模拟外部修改' }).click()

  await expect(page.locator('[data-stat="external"]')).toHaveText('conflict')
  await page.getByRole('button', { name: '保存', exact: true }).click()

  await expect(page.locator('[data-stat="notice"]')).toContainText('文件已在编辑器外发生变化。')
  await expect(page.locator('[data-session-state]')).toContainText('有未保存更改')

  await page.getByRole('button', { name: '新建' }).click()
  await page.getByRole('button', { name: '在文件夹中显示' }).click()

  await expect(page.locator('[data-stat="notice"]')).toHaveText(
    '无法在文件夹中显示：unsaved-document',
  )
})

test('desktop shell imports pasted image files through asset provider', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: '打开' }).click()

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
  await page.keyboard.press('Control+3')
  await expect(page.locator('.milkup-editor')).toHaveAttribute('data-mode', 'preview')
  await page.keyboard.press('Control+1')
  await expect(page.locator('.milkup-editor')).toHaveAttribute('data-mode', 'source')

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

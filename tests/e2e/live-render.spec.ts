import { expect, test } from '@playwright/test'

test('live render projection hides inline markers and keeps editor geometry usable', async ({
  page,
}) => {
  await page.goto('/')

  await expect(page.locator('.milkup-editor')).toHaveAttribute('data-mode', 'source')

  await page.keyboard.type('**bold** x\n')
  await page.getByRole('button', { name: '实时' }).click()

  await expect(page.locator('.milkup-editor')).toHaveAttribute('data-mode', 'live')
  await expect(page.locator('.milkup-inline-strong')).toHaveCount(1)
  await expect(page.locator('.milkup-inline-strong .milkup-inline-content')).toHaveText('bold')
  await expect(page.locator('.milkup-inline-strong .milkup-marker-hidden')).toHaveCount(2)

  const hiddenMarkerDisplay = await page
    .locator('.milkup-inline-strong .milkup-marker-hidden')
    .first()
    .evaluate((element) => getComputedStyle(element).display)
  expect(hiddenMarkerDisplay).toBe('none')

  const listMarker = page.locator('.milkup-block-list .milkup-list-marker').first()
  await expect(listMarker).toBeVisible()
  await expect(listMarker).toHaveText('-')

  const cursor = page.locator('.milkup-cursor').first()
  await expect(cursor).toBeVisible()
  await expect(cursor).toHaveAttribute('data-position', /\d+/)
})

test('browser selection rendering follows keyboard selection changes', async ({ page }) => {
  await page.goto('/')

  await page.keyboard.type('selectable')
  await page.keyboard.down('Shift')
  await page.keyboard.press('ArrowLeft')
  await page.keyboard.press('ArrowLeft')
  await page.keyboard.up('Shift')

  const selection = page.locator('.milkup-selection').first()
  await expect(selection).toBeVisible()
  await expect(selection).toHaveAttribute('data-from', '8')
  await expect(selection).toHaveAttribute('data-to', '10')
  await expect(page.locator('[data-stat="can-undo"]')).toHaveText('true')
})

test('browser mode switches preserve editor scroll position', async ({ page }) => {
  await page.goto('/')

  await page.keyboard.type(Array.from({ length: 20 }, (_, index) => `line ${index}\n`).join(''))
  await page.locator('.milkup-editor').evaluate((editor) => {
    const element = editor as HTMLElement
    element.style.height = '80px'
    element.style.overflow = 'auto'
    element.scrollTop = 120
  })

  await page.getByRole('button', { name: '实时' }).click()
  await expect
    .poll(() => page.locator('.milkup-editor').evaluate((editor) => editor.scrollTop))
    .toBe(120)

  await page.getByRole('button', { name: '源码' }).click()
  await expect
    .poll(() => page.locator('.milkup-editor').evaluate((editor) => editor.scrollTop))
    .toBe(120)
})

test('browser worker plugin command mutates the editor through global history', async ({
  page,
}) => {
  await page.goto('/')

  await expect(page.locator('[data-stat="worker-plugin"]')).toHaveText('ready')
  await expect(page.locator('[data-stat="can-undo"]')).toHaveText('false')

  await page.getByRole('button', { name: '插件' }).click()

  await expect(page.locator('[data-stat="worker-plugin"]')).toHaveText('ran')
  await expect(page.locator('[data-stat="can-undo"]')).toHaveText('true')
  await expect(page.locator('[data-stat="cursor"]')).toHaveText('14')
  await expect(page.locator('.milkup-line').first()).toContainText('worker-plugin# milkup v2')
})

test('browser worker plugin fetches through the main-thread network broker', async ({ page }) => {
  await page.goto('/')

  await expect(page.locator('[data-stat="worker-plugin"]')).toHaveText('ready')
  await expect(page.locator('[data-stat="can-undo"]')).toHaveText('false')

  await page.getByRole('button', { name: '拉取' }).click()

  await expect(page.locator('[data-stat="worker-plugin"]')).toHaveText('fetched')
  await expect(page.locator('[data-stat="can-undo"]')).toHaveText('true')
  await expect(page.locator('.milkup-line').first()).toContainText('worker-network# milkup v2')
})

test('browser worker plugin reads through the main-thread file broker', async ({ page }) => {
  await page.goto('/')

  await expect(page.locator('[data-stat="worker-plugin"]')).toHaveText('ready')
  await expect(page.locator('[data-stat="can-undo"]')).toHaveText('false')

  await page.getByRole('button', { name: '文件' }).click()

  await expect(page.locator('[data-stat="worker-plugin"]')).toHaveText('filed')
  await expect(page.locator('[data-stat="can-undo"]')).toHaveText('true')
  await expect(page.locator('.milkup-line').first()).toContainText('worker-file# milkup v2')
})

import { expect, test, type Page } from '@playwright/test'
import { installPreferencesFixture } from '../helpers/sealed-plugin-fixture'

// Exercise the production shell and stylesheet with controlled contributions:
// document remounts must not change the meaning of a visible separator.
async function mountPanels(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1200, height: 900 })
  await page.goto('/')
  await page.locator('[data-sidebar-toggle]').click()
  await page.evaluate(async () => {
    const source = '/src/desktop-plugin-ui.ts'
    const { DesktopPluginUiController } = await import(/* @vite-ignore */ source)
    const controller = new DesktopPluginUiController(document.querySelector('#app'), {
      contributions: () => ({
        ui: ['a', 'b', 'c'].map((id) => ({
          pluginId: 'resize-fixture',
          id,
          title: `Panel ${id}`,
          slot: 'sidebar-panel',
          scope: id === 'a' ? 'document' : 'app',
        })),
      }),
      renderUi: async () => ({ type: 'element', tag: 'p', text: 'Panel content' }),
      resolveCommand: () => undefined,
      runCommand: () => {},
    })
    ;(window as unknown as { resizeFixture: typeof controller }).resizeFixture = controller
    await controller.sync('first')
  })
}

const panel = (page: Page, id: string) => page.locator(`[data-plugin-ui="resize-fixture:${id}"]`)
const handle = (page: Page, id: string) => panel(page, id).getByRole('separator')
const height = async (page: Page, id: string) => (await panel(page, id).boundingBox())!.height
async function drag(page: Page, id: string, delta: number): Promise<void> {
  const box = (await handle(page, id).boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + delta, { steps: 8 })
  await page.mouse.up()
}

async function remount(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await (
      window as unknown as { resizeFixture: { sync(id: string): Promise<void> } }
    ).resizeFixture.sync('second')
  })
}

test('visible separators resize their DOM neighbours after document remount and collapse', async ({
  page,
}) => {
  await mountPanels(page)
  await remount(page)
  const before = await Promise.all(['a', 'b', 'c'].map((id) => height(page, id)))
  await drag(page, 'a', 60)
  expect(await height(page, 'a')).toBeCloseTo(before[0]! + 60, 0)
  expect(await height(page, 'b')).toBeCloseTo(before[1]! - 60, 0)
  expect(await height(page, 'c')).toBeCloseTo(before[2]!, 0)
  await panel(page, 'b').getByRole('button', { name: 'Panel b', exact: true }).click()
  const expanded = await height(page, 'a')
  await drag(page, 'a', -40)
  expect(await height(page, 'a')).toBeCloseTo(expanded - 40, 0)
  await expect(handle(page, 'b')).toBeHidden()
  await expect(handle(page, 'c')).toBeHidden()
  await panel(page, 'b').getByRole('button', { name: 'Panel b', exact: true }).click()
  await handle(page, 'a').focus()
  const keyboardBefore = await height(page, 'a')
  await page.keyboard.press('ArrowDown')
  expect(await height(page, 'a')).toBeCloseTo(keyboardBefore + 16, 0)
  await expect(handle(page, 'a')).toBeFocused()
})

test('resized panels keep their minimum and fit a changed viewport without clipping siblings', async ({
  page,
}) => {
  await mountPanels(page)
  await drag(page, 'a', 80)
  await page.setViewportSize({ width: 1200, height: 550 })
  const slot = page.locator('[data-plugin-slot="sidebar-panel"]')
  await expect
    .poll(async () => {
      const parent = (await slot.boundingBox())!
      const last = (await panel(page, 'c').boundingBox())!
      return last.y + last.height - parent.y - parent.height
    })
    .toBeLessThanOrEqual(1)
  await drag(page, 'a', -1000)
  expect(await height(page, 'a')).toBeCloseTo(96, 0)
  await drag(page, 'a', 1000)
  expect(await height(page, 'b')).toBeCloseTo(96, 0)
  await page.setViewportSize({ width: 1200, height: 250 })
  for (const id of ['a', 'b', 'c']) expect(await height(page, id)).toBeGreaterThanOrEqual(96)
  await panel(page, 'c').getByRole('button').scrollIntoViewIfNeeded()
  await expect(panel(page, 'c').getByRole('button')).toBeInViewport()
  await page.setViewportSize({ width: 1200, height: 900 })
  const parent = (await slot.boundingBox())!
  const last = (await panel(page, 'c').boundingBox())!
  expect(last.y + last.height).toBeCloseTo(parent.y + parent.height, 0)
})

test('pointer capture ends on cancellation and disposal, and the remaining panel fills the slot', async ({
  page,
}) => {
  await mountPanels(page)
  const box = (await handle(page, 'a').boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await expect(handle(page, 'a')).toBeFocused()
  expect(await handle(page, 'a').evaluate((node) => node.hasPointerCapture(1))).toBe(true)
  await page.mouse.move(600, box.y - 60, { steps: 4 })
  await handle(page, 'a').dispatchEvent('pointercancel', { pointerId: 1 })
  await expect(page.locator('html')).toHaveAttribute('data-plugin-panel-resizing', 'false')
  const canceled = await height(page, 'a')
  await page.mouse.move(600, box.y + 60)
  expect(await height(page, 'a')).toBe(canceled)
  await page.mouse.up()
  await drag(page, 'a', -1000)
  for (const id of ['b', 'c']) await panel(page, id).getByRole('button').click()
  const slotHeight = (await page.locator('[data-plugin-slot="sidebar-panel"]').boundingBox())!
    .height
  expect(await height(page, 'a')).toBeCloseTo(slotHeight - 64, 0)
  for (const id of ['b', 'c']) await panel(page, id).getByRole('button').click()
  const next = (await handle(page, 'a').boundingBox())!
  await page.mouse.move(next.x + next.width / 2, next.y + next.height / 2)
  await page.mouse.down()
  await page.evaluate(async () => {
    await (
      window as unknown as { resizeFixture: { dispose(): Promise<void> } }
    ).resizeFixture.dispose()
  })
  await expect(page.locator('html')).toHaveAttribute('data-plugin-panel-resizing', 'false')
  await page.mouse.move(600, 400)
  await page.mouse.up()
  await expect(page.locator('.plugin-ui-sidebar-panel')).toHaveCount(0)
})

for (const entry of ['details', 'group'] as const) {
  test(`plugin modal from ${entry} keeps the plugin page and returns focus on Escape`, async ({
    page,
  }, testInfo) => {
    await installPreferencesFixture(page, { enabled: true, approved: true })
    await page.goto('/')
    await page.getByRole('button', { name: '菜单', exact: true }).click()
    await page.getByRole('button', { name: '插件', exact: true }).click()
    if (entry === 'details') {
      await page
        .locator('[data-plugin-action="details"][data-plugin-id="milkup.preferences"]')
        .click()
    } else {
      await page.locator('[data-plugin-menu-group] > summary').click()
    }
    const opener = page.locator(
      entry === 'details'
        ? '[data-plugin-action="open-ui"][data-plugin-id="milkup.preferences"]'
        : '[data-plugin-menu-entry="milkup.preferences:preferences-panel"]',
    )
    await opener.click()
    const modal = page.locator('[data-plugin-ui="milkup.preferences:preferences-panel"]')
    await expect(modal).toBeVisible()
    await expect(modal).toBeFocused()
    await expect(page.locator('[data-app-menu]')).toBeVisible()
    await expect(page.locator('[data-menu-panel="plugins"]')).toBeVisible()
    if (entry === 'details')
      await expect(page.locator('#plugin-detail-title')).toHaveText('编辑偏好')
    else await expect(page.locator('[data-plugin-menu-group]')).toHaveAttribute('open', '')
    // CSS stacking must also keep the modal interactive above the menu.
    const size = modal.getByRole('spinbutton', { name: '字体大小', exact: true })
    await size.click()
    await expect(size).toBeFocused()
    const screenshot = testInfo.outputPath(`plugin-modal-${entry}.png`)
    await page.screenshot({ path: screenshot })
    await testInfo.attach(`plugin-modal-${entry}`, { path: screenshot, contentType: 'image/png' })
    await page.keyboard.press('Escape')
    await expect(modal).toHaveCount(0)
    await expect(opener).toBeFocused()
    await expect(page.locator('[data-app-menu]')).toBeVisible()
    await expect(page.locator('[data-menu-panel="plugins"]')).toBeVisible()
  })
}

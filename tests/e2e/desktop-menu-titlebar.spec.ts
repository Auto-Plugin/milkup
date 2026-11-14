import { expect, test, type Page } from '@playwright/test'

async function windowsShell(page: Page): Promise<void> {
  await page.addInitScript(() =>
    Object.defineProperty(navigator, 'platform', { get: () => 'Win32' }),
  )
  await page.goto('/')
  await expect(page.locator('.milkup-input-proxy')).toBeFocused()
}

for (const viewport of [
  { width: 1000, height: 720 },
  { width: 760, height: 520 },
]) {
  test(`menu keeps the titlebar visible and hit-testable at ${viewport.width}px`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport)
    await windowsShell(page)
    const before = await page.locator('[data-editor-host]').boundingBox()
    await page.getByRole('button', { name: '菜单', exact: true }).click()
    await expect(page.getByRole('button', { name: '返回正文', exact: true })).toBeVisible()
    await expect(page.locator('[data-app-menu]')).toHaveAttribute('data-phase', 'open')
    expect(await page.locator('[data-editor-host]').boundingBox()).toEqual(before)
    expect(
      await page.evaluate(() => {
        const bar = document.querySelector<HTMLElement>('.titlebar')!
        const menu = document.querySelector<HTMLElement>('[data-app-menu]')!
        return {
          top: menu.getBoundingClientRect().top,
          bottom: bar.getBoundingClientRect().bottom,
          inert: bar.inert,
          buttons: [...bar.querySelectorAll('button')].map((button) => {
            const rect = button.getBoundingClientRect()
            return button.contains(
              document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2),
            )
          }),
        }
      }),
    ).toMatchObject({ top: 37, bottom: 37, inert: false, buttons: [true, true, true, true] })
    await page.getByRole('button', { name: '返回正文', exact: true }).click()
    await expect(page.locator('[data-app-menu]')).toBeHidden()
    await expect(page.getByRole('button', { name: '菜单', exact: true })).toBeFocused()
    expect(await page.locator('[data-editor-host]').boundingBox()).toEqual(before)
  })
}

test('window buttons dispatch their existing actions while the menu is open; cancel returns to its invoker', async ({
  page,
}) => {
  // Only the native command transport is a browser probe. This verifies shell
  // dispatch/focus, not actual Windows minimization or maximization.
  await page.route(/\/(?:@tauri-apps_api_core|chunk-[A-Z0-9]+)\.js(?:\?|$)/, async (route) => {
    const response = await route.fetch()
    const body = (await response.text()).replace(
      'async function invoke(cmd, args = {}, options) {',
      'async function invoke(cmd, args = {}, options) { if(cmd === "window_control" || cmd === "plugin:window|is_maximized") { (window.__menuWindowCalls ??= []).push({cmd,args}); return false; }',
    )
    await route.fulfill({ response, body })
  })
  await windowsShell(page)
  await page.keyboard.type('KEEP-DRAFT')
  await page.getByRole('button', { name: '菜单', exact: true }).click()
  await page.getByRole('button', { name: '最小化', exact: true }).click()
  await page.getByRole('button', { name: '最大化', exact: true }).click()
  await expect
    .poll(() =>
      page.evaluate(
        'window.__menuWindowCalls?.filter(x => x.cmd === "window_control").map(x => x.args.action)',
      ),
    )
    .toEqual(['minimize', 'maximize'])
  await page.getByRole('button', { name: '关闭窗口', exact: true }).click()
  await expect(page.locator('[data-close-confirm]')).toBeVisible()
  expect(await page.locator('.titlebar').evaluate((bar) => (bar as HTMLElement).inert)).toBe(true)
  await page.keyboard.press('Escape')
  await expect(page.locator('[data-close-confirm]')).toBeHidden()
  await expect(page.getByRole('button', { name: '关闭窗口', exact: true })).toBeFocused()
  await expect(page.locator('[data-app-menu]')).toBeVisible()
  await expect(page.locator('.milkup-editor-content')).toContainText('KEEP-DRAFT')
})

test('menu keyboard scope includes titlebar controls in both directions and Escape restores focus', async ({
  page,
}) => {
  await windowsShell(page)
  await page.getByRole('button', { name: '菜单', exact: true }).click()
  await page.getByRole('button', { name: '返回正文', exact: true }).focus()
  await page.keyboard.press('Tab')
  await expect(page.getByRole('button', { name: '最小化', exact: true })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(page.getByRole('button', { name: '最大化', exact: true })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(page.getByRole('button', { name: '关闭窗口', exact: true })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(page.getByRole('button', { name: '关闭菜单', exact: true })).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect(page.getByRole('button', { name: '关闭窗口', exact: true })).toBeFocused()
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  await expect(page.locator('[data-app-menu]')).toBeHidden()
  await expect(page.getByRole('button', { name: '菜单', exact: true })).toBeFocused()
})

test('closing shields document pointers, can reverse without resetting the page, and leaves no overlay', async ({
  page,
}) => {
  await windowsShell(page)
  await page.getByRole('button', { name: '菜单', exact: true }).click()
  await page.getByRole('button', { name: '关于', exact: true }).click()
  const closing = await page.evaluate(() => {
    document.querySelector<HTMLButtonElement>('[data-menu-toggle]')!.click()
    const menu = document.querySelector<HTMLElement>('[data-app-menu]')!
    const result = {
      phase: menu.dataset.phase,
      hitShield: menu.contains(document.elementFromPoint(400, 250)),
      controlsInert: (menu.firstElementChild as HTMLElement).inert,
    }
    document.querySelector<HTMLButtonElement>('[data-menu-toggle]')!.click()
    return result
  })
  expect(closing).toEqual({ phase: 'closing', hitShield: true, controlsInert: true })
  await expect(page.locator('[data-app-menu]')).toHaveAttribute('data-phase', 'open')
  await expect(page.locator('[data-menu-panel="about"]')).toBeVisible()
  await page.evaluate(() => {
    const toggle = document.querySelector<HTMLButtonElement>('[data-menu-toggle]')!
    for (let i = 0; i < 11; i++) toggle.click()
  })
  await expect(page.locator('[data-app-menu]')).toBeHidden()
  expect(
    await page.locator('.workspace').evaluate((workspace) => (workspace as HTMLElement).inert),
  ).toBe(false)
  await expect(page.getByRole('button', { name: '菜单', exact: true })).toBeFocused()
})

test('entry and exit animate opacity while the titlebar stays in place', async ({ page }) => {
  await windowsShell(page)
  const entering = await page.evaluate(() => {
    const menu = document.querySelector<HTMLElement>('[data-app-menu]')!
    const bar = document.querySelector<HTMLElement>('.titlebar')!
    const before = bar.getBoundingClientRect().toJSON()
    document.querySelector<HTMLButtonElement>('[data-menu-toggle]')!.click()
    return {
      before,
      after: bar.getBoundingClientRect().toJSON(),
      opacity: Number(getComputedStyle(menu).opacity),
      activeAnimations: menu.getAnimations({ subtree: true }).length,
    }
  })
  expect(entering.activeAnimations).toBe(2)
  expect(entering.opacity).toBeLessThan(1)
  expect(entering.after).toEqual(entering.before)
  await expect(page.locator('[data-app-menu]')).toHaveAttribute('data-phase', 'open')
  expect(
    await page
      .locator('[data-app-menu]')
      .evaluate((menu) => Number(getComputedStyle(menu).opacity)),
  ).toBe(1)
  const exiting = await page.evaluate(() => {
    const menu = document.querySelector<HTMLElement>('[data-app-menu]')!
    document.querySelector<HTMLButtonElement>('[data-menu-toggle]')!.click()
    return {
      opacity: Number(getComputedStyle(menu).opacity),
      activeAnimations: menu.getAnimations({ subtree: true }).length,
    }
  })
  expect(exiting.activeAnimations).toBe(2)
  expect(exiting.opacity).toBeGreaterThan(0)
  await expect(page.locator('[data-app-menu]')).toBeHidden()
})

test('menu exit completion cannot steal focus from an immediately opened dirty-document confirmation', async ({
  page,
}) => {
  await windowsShell(page)
  await page.keyboard.type('KEEP-ON-CANCEL')
  await page.getByRole('button', { name: '菜单', exact: true }).click()
  await page.keyboard.press('Control+n')
  const cancel = page.locator('.dialog-button[data-close-confirm-action="cancel"]')
  await expect(cancel).toBeFocused()
  await expect(page.locator('[data-app-menu]')).toBeHidden()
  await expect(cancel).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(page.locator('.milkup-editor-content')).toContainText('KEEP-ON-CANCEL')
  expect(
    await page.evaluate(() => document.activeElement?.closest('[inert], [hidden]') === null),
  ).toBe(true)
})

test('reduced motion settles immediately and Linux keeps native window decoration policy', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'platform', { get: () => 'Linux x86_64' })
    Object.defineProperty(navigator, 'userAgent', { get: () => 'Mozilla/5.0 (X11; Linux x86_64)' })
  })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/')
  await page.getByRole('button', { name: '菜单', exact: true }).click()
  await expect(page.locator('[data-app-menu]')).toHaveAttribute('data-phase', 'open')
  expect(
    await page
      .locator('[data-app-menu]')
      .evaluate((menu) => menu.getAnimations({ subtree: true }).length),
  ).toBe(0)
  await expect(page.locator('.window-controls')).toBeHidden()
  await page.getByRole('button', { name: '返回正文', exact: true }).click()
  await expect(page.locator('[data-app-menu]')).toHaveAttribute('data-phase', 'closed')
  await expect(page.locator('[data-app-menu]')).toBeHidden()
})

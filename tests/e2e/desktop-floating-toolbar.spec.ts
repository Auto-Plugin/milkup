import { expect, test, type Page } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { formattingFixture } from '../helpers/formatting-plugin'

const toolbar = (page: Page) => page.locator('[data-plugin-slot="document-toolbar"]')
const input = (page: Page) => page.locator('.milkup-input-proxy')
const tableRow = 11

async function openDocument(page: Page, windowed: boolean, theme = 'light') {
  const text =
    Array.from({ length: 8 }, (_, index) => `正文 ${index + 1} 中文😀\r\n`).join('') +
    '| A | B |\r\n| --- | --- |\r\n| x | y |\r\n\r\n尾部正文\r\n' +
    ('padding text '.repeat(8) + '\r\n').repeat(windowed ? 24000 : 80)
  await page.addInitScript(
    (theme) =>
      localStorage.setItem('milkup.desktop.appearance.v1', JSON.stringify({ theme, zoom: 1 })),
    theme,
  )
  // Only the browser file transport is replaced. The actual editor selects its
  // ordinary/windowed implementation from this document's measured UTF-8 size.
  await page.route(/\/src\/file-service\.ts(?:\?|$)/, async (route) => {
    const response = await route.fetch()
    const body = (await response.text()).replace(
      'function createDesktopFileService() {',
      `function createDesktopFileService() {
        const service = createMockFileService(); const text = ${JSON.stringify(text)};
        service.getFileMetadata = async path => ({path,sizeBytes:new TextEncoder().encode(text).length,readonly:false});
        service.openPath = async path => ({documentId:'floating-toolbar-document',file:{path},text,diskSnapshotHash:'initial'});
        return service;`,
    )
    expect(body).toContain("documentId:'floating-toolbar-document'")
    await route.fulfill({ response, body })
  })
  await formattingFixture(page)
  await page.getByRole('button', { name: '菜单', exact: true }).click()
  await page.getByRole('button', { name: '打开', exact: true }).click()
  await expect(page.locator('#app')).toHaveAttribute('data-loading', 'ready')
  await expect(page.locator('.milkup-source-document-view')).toHaveCount(windowed ? 1 : 0)
  await page.keyboard.press('Control+1')
  await input(page).focus()
  await page.keyboard.press('Control+Home')
  await expect(toolbar(page)).toBeHidden()
}

async function enterTable(page: Page) {
  await input(page).focus()
  await page.keyboard.press('Control+Home')
  await page.locator(`.milkup-line[data-line="${tableRow}"]`).click({ position: { x: 20, y: 9 } })
  await page.keyboard.press('Home')
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowRight')
  await expect(toolbar(page).getByRole('button', { name: '下方加行', exact: true })).toBeEnabled()
  await expect(toolbar(page)).toBeVisible()
}

async function geometry(page: Page) {
  return page.evaluate((tableRow) => {
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
      titlebar: box('.titlebar'),
      editor: box('.milkup-editor'),
      host: box('[data-editor-host]'),
      toolbar: box('[data-plugin-slot="document-toolbar"]'),
      row: document.querySelector(`.milkup-line[data-line="${tableRow}"]`)
        ? box(`.milkup-line[data-line="${tableRow}"]`)
        : null,
      viewport: { width: innerWidth, height: innerHeight },
      position: getComputedStyle(document.querySelector('[data-plugin-slot="document-toolbar"]')!)
        .position,
      scrollTop: document.querySelector('.milkup-editor')!.scrollTop,
    }
  }, tableRow)
}

function expectSameLayout(
  before: Awaited<ReturnType<typeof geometry>>,
  after: Awaited<ReturnType<typeof geometry>>,
) {
  expect(after.titlebar).toEqual(before.titlebar)
  expect(after.editor).toEqual(before.editor)
  expect(after.host).toEqual(before.host)
}

function expectBounded(geometry: Awaited<ReturnType<typeof geometry>>) {
  expect(geometry.position).toBe('fixed')
  expect(geometry.toolbar.width).toBeGreaterThan(0)
  expect(geometry.toolbar.height).toBeGreaterThan(0)
  expect(geometry.toolbar.left).toBeGreaterThanOrEqual(Math.max(0, geometry.editor.left) - 1)
  expect(geometry.toolbar.right).toBeLessThanOrEqual(
    Math.min(geometry.viewport.width, geometry.editor.right) + 1,
  )
  expect(geometry.toolbar.top).toBeGreaterThanOrEqual(geometry.editor.top - 1)
  expect(geometry.toolbar.bottom).toBeLessThanOrEqual(
    Math.min(geometry.viewport.height, geometry.editor.bottom) + 1,
  )
  if (geometry.row) {
    // The toolbar must follow a visible document anchor, rather than becoming
    // another permanent strip at the top of the window.
    const gap = Math.max(
      geometry.toolbar.top - geometry.row.bottom,
      geometry.row.top - geometry.toolbar.bottom,
      0,
    )
    expect(gap).toBeLessThanOrEqual(40)
  }
}

const browserEvents = new WeakMap<Page, { at: string; kind: string; message: string }[]>()
test.beforeEach(async ({ page }) => {
  const events: { at: string; kind: string; message: string }[] = []
  browserEvents.set(page, events)
  const record = (kind: string, message: string) => {
    if (events.length < 100)
      events.push({ at: new Date().toISOString(), kind, message: message.slice(0, 2000) })
  }
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) record('navigation', frame.url())
  })
  page.on('console', (message) => record(`console:${message.type()}`, message.text()))
  page.on('pageerror', (error) => record('pageerror', error.message))
})

test.afterEach(async ({ page }, info) => {
  if (info.status !== info.expectedStatus) {
    const diagnostics = JSON.stringify(browserEvents.get(page) ?? [], null, 2)
    await info.attach('browser-events', { body: diagnostics, contentType: 'application/json' })
    await writeFile(info.outputPath('browser-events.json'), diagnostics)
    await info.attach('floating-toolbar-state', {
      body: await page.locator('body').ariaSnapshot(),
      contentType: 'text/plain',
    })
    await page.screenshot({ path: info.outputPath('failure.png'), fullPage: true })
  }
})

// Native webview zoom reduces the CSS viewport. These 32 browser cases exercise
// that layout equivalent, not Windows system DPI or actual native webview zoom.
for (const windowed of [false, true])
  for (const size of [
    { width: 1100, height: 760 },
    { width: 760, height: 520 },
  ])
    for (const theme of ['light', 'dark'])
      for (const zoom of [1, 1.25, 1.5, 2])
        test(`floating toolbar ${windowed ? 'windowed' : 'ordinary'} ${size.width}x${size.height} ${theme} ${zoom * 100}%`, async ({
          page,
        }, info) => {
          await openDocument(page, windowed, theme)
          await page.setViewportSize({
            width: Math.floor(size.width / zoom),
            height: Math.floor(size.height / zoom),
          })
          const before = await geometry(page)
          await enterTable(page)
          const entered = await geometry(page)
          await info.attach('layout-before-and-after', {
            body: JSON.stringify({ before, entered }, null, 2),
            contentType: 'application/json',
          })
          await writeFile(
            info.outputPath('layout-before-and-after.json'),
            JSON.stringify({ before, entered }, null, 2),
          )
          expectSameLayout(before, entered)
          expectBounded(entered)
          // Center the selected row before scrolling; this avoids testing a
          // permanently clamped top/bottom position in the small viewport.
          await page.locator('.milkup-editor').evaluate((editor, tableRow) => {
            const row = editor.querySelector(`.milkup-line[data-line="${tableRow}"]`)!
            const r = row.getBoundingClientRect(),
              e = editor.getBoundingClientRect()
            editor.scrollTop += r.top - e.top - e.height / 2
          }, tableRow)
          await expect(toolbar(page)).toBeVisible()
          await page.evaluate(
            () =>
              new Promise<void>((resolve) =>
                requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
              ),
          )
          const centered = await geometry(page)
          await page.locator('.milkup-editor').evaluate((editor) => {
            editor.scrollTop += 20
          })
          await expect
            .poll(async () => (await geometry(page)).toolbar.top)
            .not.toBe(centered.toolbar.top)
          const scrolled = await geometry(page)
          expectSameLayout(before, scrolled)
          expectBounded(scrolled)
          await info.attach('scroll-following', {
            body: JSON.stringify({ centered, scrolled }, null, 2),
            contentType: 'application/json',
          })
          await writeFile(
            info.outputPath('scroll-following.json'),
            JSON.stringify({ centered, scrolled }, null, 2),
          )
          await page.screenshot({ path: info.outputPath('floating-toolbar.png') })
          await page.locator('.milkup-editor').evaluate((editor) => {
            editor.scrollTop += 900
          })
          await expect(toolbar(page)).toBeHidden()
          expectSameLayout(before, await geometry(page))
          await page.locator('.milkup-editor').evaluate((editor, top) => {
            editor.scrollTop = top
          }, scrolled.scrollTop)
          await expect(toolbar(page)).toBeVisible()
          expectBounded(await geometry(page))
          const enabledButtons = toolbar(page).locator('button:not([disabled])')
          const editorScroll = await page.locator('.milkup-editor').evaluate((editor) => ({
            top: editor.scrollTop,
            left: editor.scrollLeft,
            pageTop: scrollY,
            pageLeft: scrollX,
          }))
          for (let index = 0; index < (await enabledButtons.count()); index++) {
            if (index === 0) await enabledButtons.first().focus()
            else await page.keyboard.press('Tab')
            const button = enabledButtons.nth(index)
            await expect(button).toBeFocused()
            const buttonBounds = await button.boundingBox()
            const slotBounds = await toolbar(page).boundingBox()
            expect(buttonBounds!.x).toBeGreaterThanOrEqual(slotBounds!.x + 2)
            expect(buttonBounds!.x + buttonBounds!.width).toBeLessThanOrEqual(
              slotBounds!.x + slotBounds!.width - 2,
            )
          }
          expect(
            await page.locator('.milkup-editor').evaluate((editor) => ({
              top: editor.scrollTop,
              left: editor.scrollLeft,
              pageTop: scrollY,
              pageLeft: scrollX,
            })),
          ).toEqual(editorScroll)
          await input(page).focus()
          await page.keyboard.press('Control+Home')
          await expect(toolbar(page)).toBeHidden()
          await expect(toolbar(page).locator('button')).toHaveCount(0)
          expectSameLayout(before, await geometry(page))
        })

for (const windowed of [false, true])
  test(`floating toolbar ${windowed ? 'windowed' : 'ordinary'} commands retain editing and clear on disable/document switch`, async ({
    page,
  }) => {
    await openDocument(page, windowed)
    await enterTable(page)
    await toolbar(page).getByRole('button', { name: '下方加行', exact: true }).click()
    await expect(page.locator(`.milkup-line[data-line="${tableRow + 1}"]`)).toHaveText('|  |  |')
    await expect(input(page)).toBeFocused()
    await page.keyboard.insertText('新😀')
    await expect(page.locator(`.milkup-line[data-line="${tableRow + 1}"]`)).toContainText('新😀')
    await page.keyboard.press('Control+z')
    await page.keyboard.press('Control+z')
    await expect(page.locator(`.milkup-line[data-line="${tableRow}"]`)).toHaveText('| x | y |')
    await expect(page.locator(`.milkup-line[data-line="${tableRow + 1}"]`)).toHaveText('')
    await enterTable(page)
    await toolbar(page).getByRole('button', { name: '下方加行', exact: true }).focus()
    await page.keyboard.press('Enter')
    await expect(page.locator(`.milkup-line[data-line="${tableRow + 1}"]`)).toHaveText('|  |  |')
    await expect(input(page)).toBeFocused()
    await page.keyboard.press('Control+z')
    await expect(page.locator(`.milkup-line[data-line="${tableRow + 1}"]`)).toHaveText('')
    await enterTable(page)
    await page.getByRole('button', { name: '菜单', exact: true }).click()
    await page.getByRole('button', { name: '插件', exact: true }).click()
    const toggle = page.locator(
      '.plugin-summary-card[data-plugin-id="milkup.formatting"] [role="switch"]',
    )
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-checked', 'false')
    await expect(toolbar(page).locator('button')).toHaveCount(0)
    await expect(toolbar(page)).toBeHidden()
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-checked', 'true')
    await expect(toggle).not.toHaveAttribute('aria-busy', 'true')
    await page.locator('[data-menu-close]').click()
    await enterTable(page)
    await page.keyboard.press('Control+n')
    const discard = page.getByRole('button', { name: '不保存并新建文档', exact: true })
    if (await discard.isVisible()) await discard.click()
    await expect(toolbar(page).locator('button')).toHaveCount(0)
    await expect(toolbar(page)).toBeHidden()
    await input(page).focus()
    await page.keyboard.insertText('新文档保留😀')
    await expect(page.locator('.milkup-line[data-line="1"]')).toHaveText('新文档保留😀')
    await expect(toolbar(page)).toBeHidden()
  })

for (const windowed of [false, true])
  test(`floating toolbar ${windowed ? 'windowed' : 'ordinary'} live table keeps layout and editing after mouse command`, async ({
    page,
  }, info) => {
    await openDocument(page, windowed, 'dark')
    await page.setViewportSize({ width: 600, height: 400 })
    await page.keyboard.press('Control+2')
    const before = await geometry(page)
    const cell = page.locator(`.milkup-line[data-line="${tableRow}"] .milkup-table-cell`).first()
    await expect(cell).toHaveText('x')
    await cell.click()
    const addRow = toolbar(page).getByRole('button', { name: '下方加行', exact: true })
    await expect(addRow).toBeEnabled()
    await expect(toolbar(page)).toBeVisible()
    const entered = await geometry(page)
    await writeFile(
      info.outputPath('live-layout-before-and-after.json'),
      JSON.stringify({ before, entered }, null, 2),
    )
    expectSameLayout(before, entered)
    expectBounded(entered)
    await page.screenshot({ path: info.outputPath('live-floating-toolbar.png') })
    await addRow.click()
    await expect(
      page.locator(`.milkup-line[data-line="${tableRow + 1}"] .milkup-table-cell`),
    ).toHaveCount(2)
    await expect(input(page)).toBeFocused()
    await page.keyboard.insertText('Live新😀')
    await expect(
      page.locator(`.milkup-line[data-line="${tableRow + 1}"] .milkup-table-cell`).first(),
    ).toContainText('Live新😀')
    await page.keyboard.press('Control+z')
    await page.keyboard.press('Control+z')
    await expect(cell).toHaveText('x')
    await expect(
      page.locator(`.milkup-line[data-line="${tableRow + 1}"] .milkup-table-cell`),
    ).toHaveCount(0)
    expectSameLayout(before, await geometry(page))
  })

test('floating toolbar returns after closing the application menu without another editor event', async ({
  page,
}, info) => {
  await openDocument(page, false)
  await enterTable(page)
  await expect(toolbar(page).locator('[data-ui-state="ready"]')).toBeVisible()
  // Let the current Worker notification and paint settle before opening the
  // menu; no selection, scrolling or viewport event is injected to revive it.
  await page.waitForTimeout(200)
  const snapshot = () =>
    page.evaluate(() => {
      const slot = document.querySelector<HTMLElement>('[data-plugin-slot="document-toolbar"]')!
      const editor = document.querySelector<HTMLElement>('.milkup-editor')!
      const active = document.activeElement as HTMLElement | null
      return {
        toolbarHidden: slot.hidden,
        toolbarState: slot.querySelector<HTMLElement>('[data-ui-state]')?.dataset.uiState,
        buttonCount: slot.querySelectorAll('button').length,
        editorInert: Boolean(editor.closest('[inert]')),
        active: {
          tag: active?.tagName,
          label: active?.getAttribute('aria-label'),
          className: active?.className,
        },
        cursorPosition: editor.querySelector<HTMLElement>('.milkup-cursor')?.dataset.position,
      }
    })
  const before = await snapshot()
  await page.getByRole('button', { name: '菜单', exact: true }).click()
  await expect(toolbar(page)).toBeHidden()
  await page.locator('[data-menu-close]').click()
  await expect(page.locator('[data-app-menu]')).toBeHidden()
  try {
    await expect(toolbar(page)).toBeVisible()
  } finally {
    await writeFile(
      info.outputPath('application-menu-toolbar-state.json'),
      JSON.stringify({ before, after: await snapshot() }, null, 2),
    )
  }
})

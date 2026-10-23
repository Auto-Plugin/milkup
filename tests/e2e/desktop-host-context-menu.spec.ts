import { expect, test, type Page } from '@playwright/test'
import { sealWorkerFixture } from '../helpers/sealed-plugin-fixture'

const firstLine = '菜单😀 e\u0301'
const menu = (page: Page) => page.getByRole('menu', { name: '编辑操作', exact: true })
const input = (page: Page) => page.locator('.milkup-input-proxy')
const line = (page: Page, number = 1) => page.locator(`.milkup-line[data-line="${number}"]`)
const command = (page: Page, id: string) =>
  menu(page).locator(`[data-host-context-command="host.${id}"]`)

async function openDocument(page: Page, windowed: boolean, withPlugin = false) {
  const text =
    `${firstLine}\r\n第二行尾\r\n` +
    ('padding text '.repeat(8) + '\r\n').repeat(windowed ? 24000 : 20)
  await page.addInitScript(() => {
    localStorage.setItem(
      'milkup.desktop.appearance.v1',
      JSON.stringify({ theme: 'light', zoom: 1 }),
    )
  })
  if (!withPlugin) {
    await page.route(/\/src\/bundled-plugin-catalog\.ts(?:\?|$)/, (route) =>
      route.fulfill({
        contentType: 'text/javascript',
        body: 'export const bundledPluginPaths = () => []; export const readBundledPlugin = () => undefined;',
      }),
    )
    await page.addInitScript(() => {
      localStorage.setItem(
        'milkup.desktop.plugins.registry.v1',
        JSON.stringify({ version: 1, records: [], auditRecords: [] }),
      )
      localStorage.setItem('milkup.desktop.plugins.bundled.v1', '[]')
    })
  }
  // Replace file transport only. The real desktop chooses its ordinary or
  // windowed source implementation from the actual UTF-8 size and owns edits.
  await page.route(/\/src\/file-service\.ts(?:\?|$)/, async (route) => {
    const response = await route.fetch()
    const body = (await response.text()).replace(
      'function createDesktopFileService() {',
      `function createDesktopFileService() {
        const service = createMockFileService(); const text = ${JSON.stringify(text)};
        service.getFileMetadata = async path => ({path,sizeBytes:new TextEncoder().encode(text).length,readonly:false});
        service.openPath = async path => ({documentId:'host-context-document',file:{path},text,diskSnapshotHash:'initial'});
        return service;`,
    )
    expect(body).toContain("documentId:'host-context-document'")
    await route.fulfill({ response, body })
  })
  await page.goto('/')
  await page.getByRole('button', { name: '菜单', exact: true }).click()
  await page.getByRole('button', { name: '打开', exact: true }).click()
  await expect(page.locator('#app')).toHaveAttribute('data-loading', 'ready')
  await expect(page.locator('.milkup-source-document-view')).toHaveCount(windowed ? 1 : 0)
  await page.keyboard.press('Control+1')
  await input(page).focus()
  await page.keyboard.press('Control+Home')
  await expect(line(page)).toHaveText(firstLine)
}

async function selectFirstLine(page: Page) {
  await input(page).focus()
  await page.keyboard.press('Control+Home')
  await page.keyboard.press('Shift+End')
}

async function openKeyboardMenu(page: Page) {
  await input(page).focus()
  await page.keyboard.press('Shift+F10')
  await expect(menu(page)).toBeVisible()
}

async function invoke(page: Page, id: string) {
  await openKeyboardMenu(page)
  await command(page, id).click()
  await expect(menu(page)).toBeHidden()
  await expect(input(page)).toBeFocused()
}

for (const windowed of [false, true]) {
  const implementation = windowed ? 'windowed' : 'ordinary'

  test(`host menu ${implementation}: no plugins, retained selection, clipboard and history preserve CRLF and Unicode`, async ({
    page,
    context,
  }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await openDocument(page, windowed)
    await selectFirstLine(page)
    // The click intentionally lands at the start of an existing selection.
    await line(page).click({ button: 'right', position: { x: 4, y: 8 } })
    await expect(menu(page)).toBeVisible()
    const basic = ['copy', 'cut', 'paste', 'select-all', 'undo', 'redo']
    for (const id of basic) {
      await expect(command(page, id)).toBeVisible()
      await expect(command(page, id).locator('svg')).toHaveCount(1)
    }
    await expect(menu(page).locator('[data-plugin-command]')).toHaveCount(0)
    await expect(command(page, 'undo')).toBeDisabled()
    await expect(command(page, 'redo')).toBeDisabled()
    await command(page, 'copy').click()
    await expect(menu(page)).toBeHidden()
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(firstLine)
    await expect(input(page)).toBeFocused()

    await invoke(page, 'cut')
    await expect(line(page)).toHaveText('')
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(firstLine)
    await invoke(page, 'undo')
    await expect(line(page)).toHaveText(firstLine)
    await invoke(page, 'redo')
    await expect(line(page)).toHaveText('')

    await page.evaluate(() => navigator.clipboard.writeText('粘贴😀\n第二段e\u0301'))
    await invoke(page, 'paste')
    await expect(line(page)).toHaveText('粘贴😀')
    await expect(line(page, 2)).toHaveText('第二段e\u0301')
    await expect(line(page, 3)).toHaveText('第二行尾')
    await invoke(page, 'undo')
    await expect(line(page)).toHaveText('')
    await invoke(page, 'redo')
    await expect(line(page)).toHaveText('粘贴😀')

    await input(page).focus()
    await page.keyboard.press('Control+Home')
    await page.keyboard.press('Shift+ArrowDown')
    await page.keyboard.press('Shift+End')
    await invoke(page, 'copy')
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
      '粘贴😀\r\n第二段e\u0301',
    )
  })

  test(`host menu ${implementation}: three menu levels are keyboard usable and insertion is undoable`, async ({
    page,
  }) => {
    await openDocument(page, windowed)
    await openKeyboardMenu(page)
    await page.keyboard.press('End')
    await expect(command(page, 'insert')).toBeFocused()
    await page.keyboard.press('ArrowRight')
    await expect(command(page, 'insert.heading')).toBeFocused()
    await page.keyboard.press('ArrowRight')
    await expect(command(page, 'insert.heading-1')).toBeFocused()
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('ArrowDown')
    await expect(command(page, 'insert.heading-3')).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(menu(page)).toBeHidden()
    await expect(line(page)).toHaveText(`### ${firstLine}`)
    await invoke(page, 'undo')
    await expect(line(page)).toHaveText(firstLine)
    await invoke(page, 'redo')
    await expect(line(page)).toHaveText(`### ${firstLine}`)

    await openKeyboardMenu(page)
    await page.keyboard.press('End')
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('Escape')
    await expect(command(page, 'insert.heading')).toBeFocused()
    await page.keyboard.press('ArrowLeft')
    await expect(command(page, 'insert')).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(menu(page)).toBeHidden()
    await expect(input(page)).toBeFocused()
    await invoke(page, 'select-all')
    await expect(page.locator('.milkup-selection')).not.toHaveCount(0)
  })

  test(`host menu ${implementation}: clipboard rejection and a cancelled late paste do not modify the document`, async ({
    page,
  }) => {
    await openDocument(page, windowed)
    // Failure injection covers the real host command/error boundary; it does
    // not claim an operating-system permission dialog was exercised.
    await page.evaluate(() => {
      Object.defineProperty(navigator.clipboard, 'write', {
        configurable: true,
        value: () => Promise.reject(new DOMException('fixture denial', 'NotAllowedError')),
      })
      Object.defineProperty(navigator.clipboard, 'writeText', {
        configurable: true,
        value: () => Promise.reject(new DOMException('fixture denial', 'NotAllowedError')),
      })
      Object.defineProperty(navigator.clipboard, 'readText', {
        configurable: true,
        value: () => Promise.reject(new DOMException('fixture denial', 'NotAllowedError')),
      })
    })
    await selectFirstLine(page)
    await openKeyboardMenu(page)
    await command(page, 'cut').click()
    await expect(page.locator('[data-notice]')).toContainText('写入系统剪贴板失败')
    await expect(menu(page)).toBeVisible()
    await expect(menu(page)).not.toHaveAttribute('aria-busy', 'true')
    await expect(line(page)).toHaveText(firstLine)
    await command(page, 'paste').click()
    await expect(page.locator('[data-notice]')).toContainText('读取系统剪贴板失败')
    await expect(menu(page)).toBeVisible()
    await expect(line(page)).toHaveText(firstLine)
    await page.keyboard.press('Escape')

    await page.evaluate(() => {
      Object.defineProperty(navigator.clipboard, 'readText', {
        configurable: true,
        value: () =>
          new Promise<string>((resolve) => {
            ;(window as unknown as { finishContextPaste(): void }).finishContextPaste = () =>
              resolve('LATE-PASTE-MUST-NOT-APPEAR')
          }),
      })
    })
    await openKeyboardMenu(page)
    await command(page, 'paste').click()
    await expect(menu(page)).toHaveAttribute('aria-busy', 'true')
    await page.keyboard.press('Escape')
    await expect(menu(page)).toBeHidden()
    await page.evaluate(() =>
      (window as unknown as { finishContextPaste(): void }).finishContextPaste(),
    )
    // Subsequent real editing/history must remain usable after the aborted read.
    await input(page).focus()
    await page.keyboard.press('Control+Home')
    await page.keyboard.insertText('AFTER-')
    await expect(line(page)).toHaveText(`AFTER-${firstLine}`)
    await page.keyboard.press('Control+z')
    await expect(line(page)).toHaveText(firstLine)
    await expect(page.locator('.milkup-editor')).not.toContainText('LATE-PASTE-MUST-NOT-APPEAR')

    await openKeyboardMenu(page)
    await command(page, 'paste').click()
    await expect(menu(page)).toHaveAttribute('aria-busy', 'true')
    await page.getByRole('button', { name: '菜单', exact: true }).click()
    await page.getByRole('button', { name: '新建', exact: true }).click()
    const discard = page.getByRole('button', { name: '不保存并新建文档', exact: true })
    if (await discard.isVisible()) await discard.click()
    await expect(menu(page)).toBeHidden()
    await input(page).focus()
    await page.keyboard.insertText('NEW-DOCUMENT-😀')
    await page.evaluate(() =>
      (window as unknown as { finishContextPaste(): void }).finishContextPaste(),
    )
    await expect(line(page)).toHaveText('NEW-DOCUMENT-😀')
    await expect(page.locator('.milkup-editor')).not.toContainText('LATE-PASTE-MUST-NOT-APPEAR')
  })
}

async function installSlowPlugin(page: Page) {
  const manifest = {
    id: 'context.fixture',
    name: 'Context fixture',
    version: '1.0.0',
    host: 'worker',
    main: './dist/plugin.js',
    engines: { milkup: '^2.0.0-0', pluginSdk: '*' },
    permissions: [],
    contributes: {
      commands: Array.from({ length: 6 }, (_, index) => ({
        id: `context.fixture.action${index + 1}`,
        title: `扩展 ${index + 1}`,
        action: `context.fixture.action${index + 1}`,
      })),
      ui: [{ id: 'context', title: '慢扩展', slot: 'context-menu', scope: 'document' }],
    },
  }
  await sealWorkerFixture(
    page,
    manifest,
    '/plugins/context-fixture/plugin.json',
    `export default {
      commands: Object.fromEntries(Array.from({length:6}, (_,i) => ['context.fixture.action'+(i+1), () => {}])),
      renderers: {context: async context => {
        if (!context.node?.visible || context.node?.phase === 'dispose') return '';
        await new Promise(resolve => setTimeout(resolve, 1500));
        return {type:'element',tag:'span',children:Array.from({length:6}, (_,i) => ({type:'element',tag:'button',text:'扩展 '+(i+1),disabled:i===1,action:{command:'context.fixture.action'+(i+1)}}))};
      }}
    }`,
  )
  await page.addInitScript((manifest) => {
    localStorage.setItem(
      'milkup.desktop.plugins.registry.v1',
      JSON.stringify({
        version: 1,
        records: [
          {
            manifest,
            manifestPath: '/plugins/context-fixture/plugin.json',
            rootPath: '/plugins/context-fixture',
            sourcePath: '/plugins/context-fixture/plugin.json',
            dataRoot: `milkup://plugin-data/${manifest.id}`,
            storageRoot: `milkup://plugin-storage/${manifest.id}`,
            state: 'installed',
            enabled: false,
            installedAt: 1,
            updatedAt: 1,
            trust: 'development',
            approvals: { permissions: [], hosts: ['worker'] },
            errors: [],
          },
        ],
        auditRecords: [],
      }),
    )
    localStorage.setItem('milkup.desktop.plugins.bundled.v1', '[]')
  }, manifest)
}

test('host menu remains usable while a slow Worker appends at most three actions, then unloads cleanly', async ({
  page,
}) => {
  await installSlowPlugin(page)
  await openDocument(page, false, true)
  await page.getByRole('button', { name: '菜单', exact: true }).click()
  await page.getByRole('button', { name: '插件', exact: true }).click()
  const card = page.locator('.plugin-summary-card[data-plugin-id="context.fixture"]')
  await card.getByRole('switch').click()
  await expect(card.getByRole('switch')).toHaveAttribute('aria-checked', 'true')
  await expect(card.getByRole('switch')).not.toHaveAttribute('aria-busy', 'true')
  await page.locator('[data-menu-close]').click()
  await selectFirstLine(page)
  await openKeyboardMenu(page)
  await expect(command(page, 'copy')).toBeEnabled({ timeout: 500 })
  await expect(menu(page).locator('[data-context-plugin-action]:visible')).toHaveCount(0)
  await page.keyboard.press('End')
  await page.keyboard.press('ArrowRight')
  await expect(command(page, 'insert.heading')).toBeFocused()
  const copy = await command(page, 'copy').elementHandle()
  const extensions = menu(page).locator('[data-context-plugin-action]:visible')
  await expect(extensions).toHaveCount(3, { timeout: 10000 })
  await expect(extensions.nth(1)).toBeDisabled()
  await expect(extensions.locator('svg')).toHaveCount(3)
  expect(await command(page, 'copy').evaluate((node, original) => node === original, copy)).toBe(
    true,
  )
  await expect(command(page, 'insert.heading')).toBeFocused()
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')

  // Begin a new delayed render, then disable through the actual plugin UI.
  await openKeyboardMenu(page)
  await page.getByRole('button', { name: '菜单', exact: true }).click()
  await page.getByRole('button', { name: '插件', exact: true }).click()
  await card.getByRole('switch').click()
  await expect(card.getByRole('switch')).toHaveAttribute('aria-checked', 'false')
  await expect(card.getByRole('switch')).not.toHaveAttribute('aria-busy', 'true')
  await page.locator('[data-menu-close]').click()
  await openKeyboardMenu(page)
  await expect(command(page, 'copy')).toBeEnabled()
  await expect(menu(page).locator('[data-context-plugin-action]')).toHaveCount(0)
  // Exceed the fixture's known delay to catch an obsolete result reattaching.
  await page.waitForTimeout(1600)
  await expect(menu(page)).toBeVisible()
  await expect(menu(page).locator('[data-context-plugin-action]')).toHaveCount(0)
  await page.keyboard.press('Escape')
})

test('host menu and both nested levels fit a narrow viewport equivalent to 200% native zoom', async ({
  page,
}, info) => {
  await openDocument(page, false)
  // Browser layout equivalent only; native Windows DPI requires separate evidence.
  await page.setViewportSize({ width: 380, height: 260 })
  await openKeyboardMenu(page)
  await page.keyboard.press('End')
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowRight')
  const bounds = await page.locator('[role="menu"]:visible').evaluateAll((menus) =>
    menus.map((menu) => {
      const rect = menu.getBoundingClientRect()
      return {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        viewportWidth: innerWidth,
        viewportHeight: innerHeight,
      }
    }),
  )
  expect(bounds).toHaveLength(3)
  for (const rect of bounds) {
    expect(rect.left).toBeGreaterThanOrEqual(0)
    expect(rect.top).toBeGreaterThanOrEqual(0)
    expect(rect.right).toBeLessThanOrEqual(rect.viewportWidth + 1)
    expect(rect.bottom).toBeLessThanOrEqual(rect.viewportHeight + 1)
  }
  await expect(command(page, 'insert.heading-1')).toBeFocused()
  await page.screenshot({ path: info.outputPath('host-menu-narrow-200-equivalent.png') })
})

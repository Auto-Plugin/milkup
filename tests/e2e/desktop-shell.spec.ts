import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { outlineRegistry } from '../helpers/outline-fixture.mjs'

async function runMenuCommand(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name: '菜单' }).click()
  await page.getByRole('button', { name, exact: true }).click()
}

async function installFileWatchProbe(page: Page): Promise<void> {
  await page.route(/\/src\/file-service\.ts(?:\?|$)/, async (route) => {
    const response = await route.fetch()
    const body = (await response.text()).replace(
      'async listenToFileWatchEvents() {',
      'async listenToFileWatchEvents(handler) { window.__milkupFileWatch = handler;',
    )
    await route.fulfill({ response, body })
  })
}

async function emitExternalChange(page: Page, kind: 'modified' | 'deleted'): Promise<void> {
  await page.evaluate((kind) => {
    const host = window as unknown as { __milkupFileWatch: (event: unknown) => void }
    host.__milkupFileWatch({
      kind,
      documentId: document.querySelector('[data-stat="document-id"]')!.textContent,
      file: { path: 'D:/notes/sample.md' },
    })
  }, kind)
}

test('desktop shell loads editor and tracks dirty session state', async ({ page }) => {
  await installFileWatchProbe(page)
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
  await expect(page.locator('[data-stat="document-id"]')).toHaveText('file:D:/notes/sample.md')
  await expect(page.locator('[data-stat="line-ending"]')).toHaveText('crlf')
  await expect(page.locator('[data-stat="version"]')).toHaveText('0')
  await expect(page.locator('[data-stat="saved"]')).toHaveText('0')

  await runMenuCommand(page, '在文件夹中显示')

  await expect(page.locator('[data-stat="document-id"]')).toHaveText('file:D:/notes/sample.md')

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

  await emitExternalChange(page, 'modified')

  await expect(page.locator('[data-stat="external"]')).toHaveText('modified-clean')
  await expect(page.locator('[data-save-label]')).toContainText('已保存')

  await runMenuCommand(page, '重新载入外部更改')

  await expect(page.getByRole('heading', { name: 'sample' })).toBeVisible()
  await expect(page.locator('[data-stat="external"]')).toHaveText('none')
  await expect(page.locator('[data-save-label]')).toContainText('已保存')
  await expect(page.locator('[data-stat="version"]')).toHaveText('7')
  await expect(page.locator('[data-stat="saved"]')).toHaveText('7')
  await expect(page.locator('[data-stat="line-ending"]')).toHaveText('crlf')

  await emitExternalChange(page, 'deleted')

  await expect(page.locator('[data-stat="external"]')).toHaveText('deleted-clean')
  await expect(page.locator('[data-save-label]')).toContainText('已保存')
  await runMenuCommand(page, '保存')

  await expect(page.locator('[data-stat="external"]')).toHaveText('deleted-clean')

  await page.keyboard.type('?')

  await expect(page.locator('[data-save-label]')).toContainText('未保存')
  await expect(page.locator('[data-stat="external"]')).toHaveText('conflict')
  await runMenuCommand(page, '关闭标签')

  await expect(page.locator('[data-save-label]')).toContainText('未保存')
  await expect(page.locator('[data-stat="document-id"]')).toHaveText('file:D:/notes/sample.md')

  await page.keyboard.press('Escape')
  await emitExternalChange(page, 'modified')

  await expect(page.locator('[data-stat="external"]')).toHaveText('conflict')
  await runMenuCommand(page, '保存')

  await expect(page.locator('[data-save-label]')).toContainText('未保存')
  await expect(page.locator('[data-stat="external"]')).toHaveText('conflict')

  await runMenuCommand(page, '新建')
  await page.getByRole('button', { name: '不保存并新建文档', exact: true }).click()
  await runMenuCommand(page, '在文件夹中显示')

  await expect(page.getByRole('heading', { name: '未命名' })).toBeVisible()
  await expect(page.locator('[data-stat="document-id"]')).toContainText('desktop-untitled')
})

test('plugin manager restores, executes, disables, and reenables a Worker plugin', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const manifest = {
      id: 'e2e-tools',
      name: 'E2E Tools',
      version: '1.0.0',
      main:
        'data:text/javascript,' +
        encodeURIComponent(
          "export default { commands: { 'e2e.hello': () => 'hello from plugin' } }",
        ),
      contributes: {
        commands: [{ id: 'e2e.hello', title: 'Plugin Hello', action: 'e2e.hello' }],
        keymaps: [{ command: 'e2e.hello', key: 'Mod+Alt+H', when: 'editorFocus' }],
      },
    }
    const record = {
      manifest,
      manifestPath: 'D:/plugins/e2e/plugin.json',
      rootPath: 'D:/plugins/e2e',
      sourcePath: 'D:/plugins/e2e/plugin.json',
      state: 'enabled',
      enabled: true,
      installedAt: 1,
      updatedAt: 1,
      trust: 'development',
      dataRoot: 'milkup://plugin-data/e2e-tools',
      storageRoot: 'milkup://plugin-storage/e2e-tools',
      approvals: { permissions: [], hosts: ['worker'] },
      errors: [],
    }
    localStorage.setItem(
      'milkup.desktop.plugins.registry.v1',
      JSON.stringify({ version: 1, records: [record], auditRecords: [] }),
    )
  })
  await page.goto('/')
  await page.getByRole('button', { name: '菜单' }).click()
  await page.getByRole('button', { name: '插件', exact: true }).click()

  await expect(page.getByRole('heading', { name: 'E2E Tools' })).toBeVisible()
  await expect(page.locator('.plugin-state')).toHaveText('已启用')
  await page.getByRole('button', { name: 'Plugin Hello' }).click()
  await page.getByRole('button', { name: '禁用' }).click()

  await expect(page.locator('.plugin-state')).toHaveText('已禁用')
  await expect(page.getByRole('button', { name: 'Plugin Hello' })).toHaveCount(0)
  await page.getByRole('button', { name: '启用' }).click()
  await expect(page.locator('.plugin-state')).toHaveText('已启用')
  await expect(page.getByText('Mod+Alt+H')).toBeVisible()
})

test('desktop shell imports pasted image files through asset provider', async ({ page }) => {
  await page.goto('/')
  await runMenuCommand(page, '打开')
  await expect(page.locator('#app')).toHaveAttribute('data-loading', 'ready')

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

  await page.keyboard.press('Escape')
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

// Exercise the real desktop UI while controlling only its asynchronous file adapter.
async function installSaveProbe(page: Page): Promise<void> {
  await page.route(/\/src\/file-service\.ts(?:\?|$)/, async (route) => {
    const response = await route.fetch()
    const body = (await response.text()).replace(
      'function createDesktopFileService() {',
      `function createDesktopFileService() {
        const service = createMockFileService();
        const probe = window.__milkupSaveProbe = { calls: 0, outcome: 'success', text: '', open: 'success' };
        service.saveFile = async (session, text) => {
          probe.calls++; probe.text = text;
          let outcome = probe.outcome;
          if (outcome === 'pending') outcome = await new Promise(resolve => { probe.release = resolve; });
          if (outcome === 'cancel') return undefined;
          if (outcome === 'error') throw new Error('disk full');
          return { documentId: session.documentId, file: { path: '/notes/saved.md' }, diskSnapshotHash: 'saved:' + text };
        };
        service.saveFileAs = service.saveFile;
        service.listenToFileWatchEvents = async handler => { window.__milkupFileWatch = handler; return () => {}; };
        const openPath = service.openPath.bind(service);
        service.selectOpenFile = async () => probe.open === 'cancel' ? undefined : '/notes/next.md';
        service.openPath = async (...args) => {
          if (probe.open === 'error') throw new Error('cannot read file');
          return openPath(...args);
        };
        return service;`,
    )
    await route.fulfill({ response, body })
  })
}

for (const [shortcut, action] of [
  ['Control+n', '新建文档'],
  ['Control+o', '打开另一份文档'],
  ['Control+w', '关闭文档'],
] as const) {
  test(`dirty ${shortcut} supports cancel, focus containment and explicit discard`, async ({
    page,
  }) => {
    await page.goto('/')
    await page.keyboard.type('KEEP-MY-DRAFT')
    const originalId = await page.locator('[data-stat="document-id"]').textContent()
    await page.keyboard.press(shortcut)
    const dialog = page.getByRole('dialog', { name: '文档尚未保存' })
    await expect(dialog).toBeVisible()
    await expect(dialog.locator('.dialog-button[data-close-confirm-action="cancel"]')).toBeFocused()
    for (let i = 0; i < 6; i++) await page.keyboard.press('Tab')
    expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true)
    await page.keyboard.press('Shift+Tab')
    expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true)
    await page.keyboard.press('Control+n')
    await page.keyboard.press('Control+o')
    await expect(
      dialog.getByRole('button', { name: `不保存并${action}`, exact: true }),
    ).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await expect(page.locator('[data-stat="document-id"]')).toHaveText(originalId!)
    await expect(page.locator('.milkup-editor-content')).toContainText('KEEP-MY-DRAFT')
    await expect(page.locator('.milkup-input-proxy')).toBeFocused()
    await page.keyboard.type('-still-editable')
    await expect(page.locator('.milkup-editor-content')).toContainText('still-editable')
    await page.keyboard.press(shortcut)
    await dialog.getByRole('button', { name: `不保存并${action}`, exact: true }).click()
    await expect(dialog).toBeHidden()
    await expect(page.locator('.milkup-editor-content')).not.toContainText('KEEP-MY-DRAFT')
  })
}

test('save before new retains the draft after cancellation or failure and supports retry', async ({
  page,
}) => {
  await installSaveProbe(page)
  await page.goto('/')
  await page.keyboard.type('ONLY-SAVED-WHEN-WRITTEN')
  await page.evaluate("window.__milkupSaveProbe.outcome = 'cancel'")
  await page.keyboard.press('Control+n')
  const dialog = page.getByRole('dialog', { name: '文档尚未保存' })
  await dialog.getByRole('button', { name: '保存并新建文档', exact: true }).click()
  await expect(dialog.getByRole('alert')).toContainText('已取消保存')
  await expect(page.locator('[data-save-label]')).toContainText('未保存')
  await page.evaluate("window.__milkupSaveProbe.outcome = 'error'")
  await dialog.getByRole('button', { name: '保存并新建文档', exact: true }).click()
  await expect(dialog.getByRole('alert')).toContainText('disk full')
  await expect(page.locator('.milkup-editor-content')).toContainText('ONLY-SAVED-WHEN-WRITTEN')
  await page.evaluate("window.__milkupSaveProbe.outcome = 'success'")
  await dialog.getByRole('button', { name: '保存并新建文档', exact: true }).click()
  await expect(dialog).toBeHidden()
  await expect(page.locator('.milkup-editor-content')).not.toContainText('ONLY-SAVED-WHEN-WRITTEN')
  expect(await page.evaluate('window.__milkupSaveProbe.text')).toBe('ONLY-SAVED-WHEN-WRITTEN')
  expect(await page.evaluate('window.__milkupSaveProbe.calls')).toBe(3)
})

test('cancelling a pending save continuation never navigates after the write completes', async ({
  page,
}) => {
  await installSaveProbe(page)
  await page.goto('/')
  await page.keyboard.type('SAVE-BUT-STAY')
  const originalId = await page.locator('[data-stat="document-id"]').textContent()
  await page.evaluate("window.__milkupSaveProbe.outcome = 'pending'")
  await page.keyboard.press('Control+n')
  await page.getByRole('button', { name: '保存并新建文档', exact: true }).click()
  await expect(page.locator('#app')).toHaveAttribute('data-saving', 'true')
  await expect(page.locator('[data-close-confirm-action="save"]')).toBeDisabled()
  await expect(page.locator('[data-close-confirm-action="discard"]')).toBeDisabled()
  await page.keyboard.press('Control+s')
  await page.keyboard.press('Escape')
  await page.keyboard.press('Control+n')
  await page.evaluate("window.__milkupSaveProbe.release('success')")
  await expect(page.locator('#app')).toHaveAttribute('data-saving', 'false')
  await expect(page.locator('[data-close-confirm]')).toBeHidden()
  await expect(page.locator('[data-stat="document-id"]')).toHaveText(originalId!)
  await expect(page.locator('.milkup-editor-content')).toContainText('SAVE-BUT-STAY')
  await expect(page.locator('[data-save-label]')).toContainText('已保存')
  expect(await page.evaluate('window.__milkupSaveProbe.calls')).toBe(1)
  await page.keyboard.type('-MORE')
  await expect(page.locator('[data-save-label]')).toContainText('未保存')
})

for (const outcome of ['cancel', 'error']) {
  test(`opening ${outcome} after discard preserves original content and history`, async ({
    page,
  }) => {
    await installSaveProbe(page)
    await page.goto('/')
    await page.keyboard.type('ORIGINAL')
    await page.evaluate(`window.__milkupSaveProbe.open = '${outcome}'`)
    await page.keyboard.press('Control+o')
    await page.getByRole('button', { name: '不保存并打开另一份文档', exact: true }).click()
    await expect(page.locator('#app')).toHaveAttribute(
      'data-loading',
      outcome === 'error' ? 'failed' : 'ready',
    )
    if (outcome === 'error') await page.locator('[data-loading-dismiss]').click()
    await expect(page.locator('.milkup-editor-content')).toContainText('ORIGINAL')
    await expect(page.locator('[data-save-label]')).toContainText('未保存')
    await page.keyboard.press('Control+z')
    await expect(page.locator('.milkup-editor-content')).not.toContainText('ORIGINAL')
  })
}

test('ordinary save failures are visible without developer diagnostics and recover on retry', async ({
  page,
}) => {
  await installSaveProbe(page)
  await page.goto('/')
  await page.keyboard.type('RECOVERABLE')
  await page.evaluate("window.__milkupSaveProbe.outcome = 'error'")
  await page.keyboard.press('Control+s')
  await expect(page.locator('[data-notice]')).toBeVisible()
  await expect(page.locator('[data-notice]')).toContainText('disk full')
  await expect(page.locator('[data-save-label]')).toContainText('未保存')
  await page.evaluate("window.__milkupSaveProbe.outcome = 'success'")
  await page.keyboard.press('Control+s')
  await expect(page.locator('[data-save-label]')).toContainText('已保存')
  await expect(page.locator('[data-notice]')).toBeHidden()
})

test('browser reload cancellation keeps the unsaved editor alive', async ({ page }) => {
  await page.goto('/')
  await page.keyboard.type('RELOAD-PROTECTED')
  const pendingDialog = page.waitForEvent('dialog')
  const reload = page.reload({ timeout: 5000 }).catch(() => null)
  const dialog = await pendingDialog
  expect(dialog.type()).toBe('beforeunload')
  await dialog.dismiss()
  await reload
  await expect(page.locator('.milkup-editor-content')).toContainText('RELOAD-PROTECTED')
  await page.keyboard.type('-still-alive')
  await expect(page.locator('.milkup-editor-content')).toContainText('still-alive')
})

for (const mode of ['source', 'live'] as const) {
  test(`synthetic composition cancellation preserves selected text and history in ${mode}`, async ({
    page,
  }) => {
    await page.goto('/')
    await page.keyboard.press(mode === 'source' ? 'Control+1' : 'Control+2')
    await page.keyboard.insertText('保留原文')
    await page.keyboard.press('Control+a')
    const version = await page.locator('[data-stat="version"]').textContent()
    await page.evaluate(() => {
      const input = document.querySelector<HTMLTextAreaElement>('.milkup-input-proxy')!
      input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
      input.value = 'zhong'
      input.dispatchEvent(
        new CompositionEvent('compositionupdate', { data: 'zhong', bubbles: true }),
      )
      input.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'n',
          ctrlKey: true,
          isComposing: true,
          bubbles: true,
          cancelable: true,
        }),
      )
      input.value = ''
      input.dispatchEvent(new CompositionEvent('compositionend', { data: '', bubbles: true }))
    })
    await expect(page.locator('[data-close-confirm]')).toBeHidden()
    await expect(page.locator('[data-stat="version"]')).toHaveText(version!)
    await expect(page.locator('.milkup-editor-content')).toContainText('保留原文')
    await expect(page.locator('.milkup-selection')).toHaveCount(1)
    await page.evaluate(() => {
      const input = document.querySelector<HTMLTextAreaElement>('.milkup-input-proxy')!
      input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
      input.value = '中文'
      input.dispatchEvent(new CompositionEvent('compositionend', { data: '中文', bubbles: true }))
      input.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          data: '中文',
          inputType: 'insertCompositionText',
        }),
      )
    })
    await expect(page.locator('.milkup-editor-content')).toContainText('中文')
    await expect(page.locator('.milkup-editor-content')).not.toContainText('保留原文')
    await page.keyboard.press('Control+z')
    await expect(page.locator('.milkup-editor-content')).toContainText('保留原文')
    await expect(page.locator('.milkup-selection')).toHaveCount(1)
    await page.keyboard.press('Control+Shift+z')
    await expect(page.locator('.milkup-editor-content')).toContainText('中文')
    await expect(page.locator('.milkup-input-proxy')).toBeFocused()
  })
}

test('multiline code paste and following typing undo independently across mode changes', async ({
  page,
}) => {
  await page.goto('/')
  await page.keyboard.type('KEEP ')
  await page.evaluate(() => {
    const data = new DataTransfer()
    data.setData('text/plain', '\n```python\nfirst()\n\n\nsecond()\n```\n')
    document
      .querySelector('.milkup-input-proxy')!
      .dispatchEvent(
        new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
      )
  })
  await page.keyboard.type('TAIL')
  await page.keyboard.press('Control+1')
  await page.keyboard.press('Control+z')
  await expect(page.locator('.milkup-editor-content')).not.toContainText('TAIL')
  await expect(page.locator('.milkup-editor-content')).toContainText('second()')
  await page.keyboard.press('Control+2')
  await page.keyboard.press('Control+z')
  await expect(page.locator('.milkup-editor-content')).toContainText('KEEP')
  await expect(page.locator('.milkup-editor-content')).not.toContainText('first()')
  await page.keyboard.press('Control+Shift+z')
  await page.keyboard.press('Control+Shift+z')
  await expect(page.locator('.milkup-editor-content')).toContainText('TAIL')
})

test('typing after cursor movement restores only the local edit on undo', async ({ page }) => {
  await page.goto('/')
  await page.keyboard.type('AB')
  await page.keyboard.press('ArrowLeft')
  await page.keyboard.type('X')
  await page.keyboard.press('Control+z')
  await expect(page.locator('.milkup-editor-content')).toContainText('AB')
  await expect(page.locator('.milkup-cursor')).toHaveAttribute('data-position', '1')
  await page.keyboard.press('Control+Shift+z')
  await expect(page.locator('.milkup-editor-content')).toContainText('AXB')
})

test('cancelled and failed Save As preserve the path and dirty content', async ({ page }) => {
  await installSaveProbe(page)
  await page.goto('/')
  await page.keyboard.type('SAVE-AS-DRAFT')
  for (const outcome of ['cancel', 'error']) {
    await page.evaluate(`window.__milkupSaveProbe.outcome = '${outcome}'`)
    await page.keyboard.press('Control+Shift+s')
    await expect(page.locator('[data-notice]')).toContainText(
      outcome === 'cancel' ? '取消另存为' : 'disk full',
    )
    await expect(page.locator('[data-title-path]')).toHaveText('未保存')
    await expect(page.locator('[data-save-label]')).toContainText('未保存')
    await expect(page.locator('.milkup-editor-content')).toContainText('SAVE-AS-DRAFT')
  }
})

test('windowed memory documents keep finalized composition separate from adjacent typing', async ({
  page,
}) => {
  await page.route(/\/src\/file-service\.ts(?:\?|$)/, async (route) => {
    const response = await route.fetch()
    const body = (await response.text()).replace(
      'function createDesktopFileService() {',
      `function createDesktopFileService() {
      const service = createMockFileService();
      const text = 'ORIGINAL\\n' + 'body line\\n'.repeat(16000);
      service.getFileMetadata = async path => ({ path, sizeBytes: text.length, readonly: false });
      service.openPath = async path => ({ documentId: 'windowed', file: {path}, text, diskSnapshotHash: 'initial' });
      return service;`,
    )
    await route.fulfill({ response, body })
  })
  await page.goto('/')
  await runMenuCommand(page, '打开')
  await expect(page.locator('#app')).toHaveAttribute('data-loading', 'ready')
  await expect(page.locator('.milkup-source-document-view')).toBeVisible()
  await page.keyboard.press('Control+1')
  await page.keyboard.type('A')
  await expect(page.locator('[data-stat="version"]')).toHaveText('1')
  await page.evaluate(() => {
    const input = document.querySelector<HTMLTextAreaElement>('.milkup-input-proxy')!
    input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
    input.value = '中'
    input.dispatchEvent(new CompositionEvent('compositionend', { data: '中', bubbles: true }))
  })
  await expect(page.locator('[data-stat="version"]')).toHaveText('2')
  await page.keyboard.type('X')
  await expect(page.locator('[data-stat="version"]')).toHaveText('3')
  await expect(page.locator('.milkup-line[data-line="1"]')).toHaveText('A中XORIGINAL')
  await page.keyboard.press('Control+z')
  await expect(page.locator('.milkup-line[data-line="1"]')).toHaveText('A中ORIGINAL')
  await page.keyboard.press('Control+z')
  await expect(page.locator('.milkup-line[data-line="1"]')).toHaveText('AORIGINAL')
})

async function installPendingAssetProbe(page: Page): Promise<void> {
  await page.route(/\/src\/asset-service\.ts(?:\?|$)/, async (route) => {
    const response = await route.fetch()
    const body = (await response.text()).replace(
      'return new SessionAssetProvider(config);',
      `const probe = window.__milkupAssetProbe = { calls: 0 };
       return { async importAsset(input) {
         probe.calls++;
         const outcome = await new Promise(resolve => { probe.release = resolve; });
         if (outcome === 'error') throw new Error('asset disk full');
         return { originalName: input.name, fileName: 'a.png', relativePath: 'assets/a.png', mimeType: input.type };
       } };`,
    )
    await route.fulfill({ response, body })
  })
}

async function pasteDelayedImage(page: Page): Promise<void> {
  await page.locator('.milkup-input-proxy').evaluate((input) => {
    const data = new DataTransfer()
    data.items.add(new File(['image'], 'a.png', { type: 'image/png' }))
    input.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
    )
  })
  await expect.poll(() => page.evaluate('window.__milkupAssetProbe.calls')).toBe(1)
}

test('late image imports never write into a newly created document', async ({ page }) => {
  await installPendingAssetProbe(page)
  await page.goto('/')
  await pasteDelayedImage(page)
  const previousId = await page.locator('[data-stat="document-id"]').textContent()
  await page.keyboard.press('Control+n')
  await expect(page.locator('[data-stat="document-id"]')).not.toHaveText(previousId!)
  await page.evaluate('window.__milkupAssetProbe.release()')
  await page.evaluate(() => new Promise(requestAnimationFrame))
  await expect(page.locator('[data-stat="char-count"]')).toHaveText('0 字符')
  await expect(page.locator('[data-save-label]')).toContainText('已保存')
  await page.keyboard.type('NEW')
  await page.keyboard.press('Control+z')
  await expect(page.locator('[data-stat="char-count"]')).toHaveText('0 字符')
})

for (const kind of ['modified', 'deleted', 'own-save'] as const) {
  test(`pending save reconciles ${kind} events before allowing navigation`, async ({ page }) => {
    await installSaveProbe(page)
    await page.goto('/')
    await page.keyboard.type('KEEP')
    await page.keyboard.press('Control+s')
    await expect(page.locator('[data-save-label]')).toContainText('已保存')
    await page.keyboard.type('!')
    const previousId = await page.locator('[data-stat="document-id"]').textContent()
    await page.evaluate("window.__milkupSaveProbe.outcome = 'pending'")
    await page.keyboard.press('Control+n')
    const dialog = page.getByRole('dialog', { name: '文档尚未保存' })
    await dialog.getByRole('button', { name: '保存并新建文档', exact: true }).click()
    await expect.poll(() => page.evaluate('window.__milkupSaveProbe.calls')).toBe(2)
    await page.evaluate((kind) => {
      const host = window as unknown as {
        __milkupFileWatch: (event: unknown) => void
        __milkupSaveProbe: { text: string; release: (value: string) => void }
      }
      host.__milkupFileWatch({
        kind: kind === 'deleted' ? 'deleted' : 'modified',
        documentId: document.querySelector('[data-stat="document-id"]')!.textContent,
        file: { path: '/notes/saved.md' },
        ...(kind === 'own-save'
          ? { diskSnapshotHash: 'saved:' + host.__milkupSaveProbe.text }
          : {}),
      })
      host.__milkupSaveProbe.release('success')
    }, kind)
    if (kind === 'own-save') {
      await expect(dialog).toBeHidden()
      await expect(page.locator('[data-stat="document-id"]')).not.toHaveText(previousId!)
    } else {
      await expect(dialog.getByRole('alert')).toContainText('外部')
      await expect(page.locator('[data-stat="document-id"]')).toHaveText(previousId!)
      await expect(page.locator('.milkup-editor-content')).toContainText('KEEP!')
      await expect(page.locator('[data-stat="external"]')).not.toHaveText('none')
      await page.keyboard.press('Escape')
      await page.keyboard.press('Control+s')
      expect(await page.evaluate('window.__milkupSaveProbe.calls')).toBe(2)
    }
  })
}

test('saving cancels a pending image import without dirtying the saved snapshot', async ({
  page,
}) => {
  await installPendingAssetProbe(page)
  await installSaveProbe(page)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/')
  await page.keyboard.type('BEFORE')
  await pasteDelayedImage(page)
  await page.keyboard.press('Control+s')
  await expect(page.locator('[data-save-label]')).toContainText('已保存')
  await page.evaluate('window.__milkupAssetProbe.release()')
  await expect(page.locator('[data-notice]')).toContainText('图片导入已取消')
  await expect(page.locator('.milkup-editor-content')).toHaveText('BEFORE')
  await expect(page.locator('[data-save-label]')).toContainText('已保存')
  expect(await page.evaluate('window.__milkupSaveProbe.text')).toBe('BEFORE')
  expect(errors).toEqual([])
})

test('failed image imports show an error and a subsequent paste can succeed', async ({ page }) => {
  await installPendingAssetProbe(page)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/')
  await pasteDelayedImage(page)
  await page.evaluate("window.__milkupAssetProbe.release('error')")
  await expect(page.locator('[data-notice]')).toContainText('asset disk full')
  await expect(page.locator('[data-save-label]')).toContainText('已保存')
  await page.evaluate('window.__milkupAssetProbe.calls = 0')
  await pasteDelayedImage(page)
  await page.evaluate('window.__milkupAssetProbe.release()')
  await expect(page.locator('[data-save-label]')).toContainText('未保存')
  await page.keyboard.press('Control+1')
  await expect(page.locator('.milkup-editor-content')).toContainText('![a](assets/a.png)')
  await expect(page.locator('[data-notice]')).toBeHidden()
  await page.keyboard.press('Control+z')
  await expect(page.locator('[data-stat="char-count"]')).toHaveText('0 字符')
  expect(errors).toEqual([])
})

for (const mode of ['source', 'live'] as const) {
  test(`Unicode graphemes survive keyboard selection, deletion and undo in ${mode}`, async ({
    page,
  }) => {
    await page.goto('/')
    if (mode === 'source') await page.keyboard.press('Control+1')
    await page.keyboard.insertText('A👩🏽‍💻B')
    await page.keyboard.press('ArrowLeft')
    await page.keyboard.press('Backspace')
    await expect(page.locator('.milkup-editor-content')).toHaveText('AB')
    await page.keyboard.press('Control+z')
    await expect(page.locator('.milkup-editor-content')).toHaveText('A👩🏽‍💻B')
    await page.keyboard.press('Control+a')
    await page.keyboard.press('ArrowLeft')
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('Shift+ArrowRight')
    await page.keyboard.press('Delete')
    await expect(page.locator('.milkup-editor-content')).toHaveText('AB')
    await page.keyboard.press('Control+z')
    await expect(page.locator('.milkup-editor-content')).toHaveText('A👩🏽‍💻B')
    await page.keyboard.press('Control+Shift+z')
    await expect(page.locator('.milkup-editor-content')).toHaveText('AB')
  })
}

for (const mode of ['source', 'live'] as const) {
  test(`windowed ${mode} keyboard edits preserve whole graphemes and undo`, async ({ page }) => {
    await page.route(/\/src\/file-service\.ts(?:\?|$)/, async (route) => {
      const response = await route.fetch()
      const body = (await response.text()).replace(
        'function createDesktopFileService() {',
        `function createDesktopFileService() {
          const service = createMockFileService();
          const text = 'A👩🏽‍💻B\\r\\n' + 'body line\\r\\n'.repeat(16000);
          service.getFileMetadata = async path => ({ path, sizeBytes: text.length, readonly: false });
          service.openPath = async path => ({ documentId: 'unicode-window', file: {path}, text, diskSnapshotHash: 'initial' });
          return service;`,
      )
      await route.fulfill({ response, body })
    })
    await page.goto('/')
    await runMenuCommand(page, '打开')
    await expect(page.locator('#app')).toHaveAttribute('data-loading', 'ready')
    await expect(page.locator('.milkup-source-document-view')).toBeVisible()
    if (mode === 'source') await page.keyboard.press('Control+1')
    await page.locator('.milkup-input-proxy').focus()
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('ArrowRight')
    await expect(page.locator('.milkup-cursor')).toHaveAttribute('data-position', '8')
    await page.keyboard.press('Backspace')
    await expect(page.locator('.milkup-line[data-line="1"]')).toHaveText('AB')
    await page.keyboard.press('Control+z')
    await expect(page.locator('.milkup-line[data-line="1"]')).toHaveText('A👩🏽‍💻B')
    await page.keyboard.press('Control+Shift+z')
    await expect(page.locator('.milkup-line[data-line="1"]')).toHaveText('AB')
  })
}

test('issue 255 bracket typing keeps its position after delayed rendering', async ({ page }) => {
  await page.goto('/')
  const input = page.locator('.milkup-input-proxy')
  await input.focus()
  await page.keyboard.type('()tail')
  await page.keyboard.press('Control+a')
  await page.keyboard.press('ArrowLeft')
  await page.keyboard.press('ArrowRight')
  await page.keyboard.type('abc123')
  await expect(page.locator('.milkup-cursor')).toHaveAttribute('data-position', '7')
  // The historical report specifically describes a 1–2 second delayed jump.
  await page.waitForTimeout(2500)
  await expect(page.locator('.milkup-cursor')).toHaveAttribute('data-position', '7')
  await page.keyboard.type('X')
  await expect(page.locator('.milkup-line[data-line="1"]')).toHaveText('(abc123X)tail')
})

test('issue 255 single-space headings render immediately after an image line', async ({ page }) => {
  await page.goto('/')
  await page.locator('.milkup-input-proxy').focus()
  await page.keyboard.type('![alt](missing.png)')
  await page.keyboard.press('Enter')
  await page.keyboard.type('## 3')
  await page.keyboard.press('Enter')
  await expect(page.locator('.milkup-line[data-line="2"] .milkup-heading-content')).toHaveText('3')
  await page.keyboard.type('## title')
  await page.keyboard.press('Enter')
  await expect(page.locator('.milkup-line[data-line="3"] .milkup-heading-content')).toHaveText(
    'title',
  )
})

for (const mode of ['source', 'live'] as const) {
  test(`${mode} list keyboard nesting, exit and undo survive mode changes`, async ({ page }) => {
    await page.goto('/')
    if (mode === 'source') await page.keyboard.press('Control+1')
    await page.locator('.milkup-input-proxy').focus()
    await page.keyboard.type('- item')
    await page.keyboard.press('Tab')
    await expect(page.locator('.milkup-cursor')).toHaveAttribute('data-position', '8')
    await page.keyboard.press(mode === 'source' ? 'Control+2' : 'Control+1')
    await expect(page.locator('.milkup-cursor')).toHaveAttribute('data-position', '8')
    await page.keyboard.press(mode === 'source' ? 'Control+1' : 'Control+2')
    await page.keyboard.press('Shift+Tab')
    await page.keyboard.press('Enter')
    await expect(page.locator('.milkup-cursor')).toHaveAttribute('data-position', '9')
    await page.keyboard.press('Enter')
    await expect(page.locator('.milkup-cursor')).toHaveAttribute('data-position', '7')
    await page.keyboard.press('Control+z')
    await expect(page.locator('.milkup-cursor')).toHaveAttribute('data-position', '9')
    await page.keyboard.press('Control+1')
    await expect(page.locator('.milkup-line[data-line="2"]')).toHaveText('-')
    await page.keyboard.press('Backspace')
    await expect(page.locator('.milkup-cursor')).toHaveAttribute('data-position', '7')
  })
  test(`${mode} code block Enter preserves literal markers and blank lines`, async ({ page }) => {
    await page.goto('/')
    if (mode === 'source') await page.keyboard.press('Control+1')
    await page.locator('.milkup-input-proxy').focus()
    const code = '```js\n- literal\n  value\n```'
    await page.keyboard.insertText(code)
    await page.keyboard.press('Control+a')
    await page.keyboard.press('ArrowLeft')
    for (let i = 0; i < code.indexOf('\n  value'); i++) await page.keyboard.press('ArrowRight')
    await page.keyboard.press('Enter')
    await expect
      .poll(() =>
        page
          .locator('.milkup-line[data-line="3"]')
          .evaluate((el) => el.textContent?.replace(/\u200b/g, '')),
      )
      .toBe('')
    await page.keyboard.press('Control+z')
    await expect
      .poll(() => page.locator('.milkup-line[data-line="3"]').evaluate((el) => el.textContent))
      .toBe('  value')
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Enter')
    await expect
      .poll(() =>
        page
          .locator('.milkup-line[data-line="4"]')
          .evaluate((el) => el.textContent?.replace(/\u200b/g, '')),
      )
      .toBe('  ')
    await page.keyboard.press(mode === 'source' ? 'Control+2' : 'Control+1')
    await page.keyboard.press('Control+z')
    await expect(page.locator('.milkup-line[data-line="4"]')).toHaveText('```')
  })
}

const editableTable = '| Name | Value |\n| --- | --- |\n| A | 1 |\n| B | 2 |'
async function openEditableTable(page: Page): Promise<void> {
  await page.goto('/')
  await page.locator('.milkup-input-proxy').focus()
  await page.keyboard.insertText(editableTable)
  await page.locator('.milkup-line[data-line="3"] .milkup-table-cell').first().click()
  await page.getByRole('button', { name: '选中单元格', exact: true }).click()
}
test('live table navigation replaces one cell, keeps line breaks and supports undo', async ({
  page,
}) => {
  await openEditableTable(page)
  await page.keyboard.press('Tab')
  await page.keyboard.type('x')
  await expect(page.locator('.milkup-line[data-line="3"] .milkup-table-cell').nth(1)).toHaveText(
    'x',
  )
  await page.keyboard.press('Control+z')
  await page.keyboard.press('Shift+Tab')
  await page.keyboard.press('Enter')
  await page.keyboard.type('second')
  await expect(page.locator('.milkup-line[data-line="4"] .milkup-table-cell').first()).toHaveText(
    'second',
  )
  await page.keyboard.press('Shift+Enter')
  // Assert one committed input undo boundary independently of host key dispatch latency.
  await page.keyboard.insertText('line|value')
  await expect(page.locator('.milkup-line[data-line="4"] .milkup-table-cell')).toHaveCount(2)
  await expect(page.locator('.milkup-line[data-line="4"] .milkup-table-cell br')).toHaveCount(1)
  await page.keyboard.press('Control+1')
  await expect(page.locator('.milkup-line[data-line="4"]')).toHaveText(
    '| second<br>line\\|value | 2 |',
  )
  await page.keyboard.press('Control+z')
  await expect(page.locator('.milkup-line[data-line="4"]')).toHaveText('| second<br> | 2 |')
  await page.keyboard.press('Control+z')
  await expect(page.locator('.milkup-line[data-line="4"]')).toHaveText('| second | 2 |')
})
test('table toolbar preserves row and column content through undo and redo', async ({ page }) => {
  await openEditableTable(page)
  await page.getByRole('button', { name: '右侧加列', exact: true }).click()
  await expect(page.locator('.milkup-line[data-line="1"] .milkup-table-cell')).toHaveCount(3)
  const cellBox = await page
    .locator('.milkup-line[data-line="3"] .milkup-table-cell')
    .nth(1)
    .boundingBox()
  const cursorBox = await page.locator('.milkup-cursor').boundingBox()
  expect(cursorBox!.x).toBeGreaterThanOrEqual(cellBox!.x)
  expect(cursorBox!.x).toBeLessThan(cellBox!.x + cellBox!.width)
  await page.getByRole('button', { name: '删除列', exact: true }).click()
  await expect(page.locator('.milkup-line[data-line="1"] .milkup-table-cell')).toHaveCount(2)
  await page.keyboard.press('Control+z')
  await expect(page.locator('.milkup-line[data-line="1"] .milkup-table-cell')).toHaveCount(3)
  await page.keyboard.press('Control+Shift+z')
  await expect(page.locator('.milkup-line[data-line="1"] .milkup-table-cell')).toHaveCount(2)
  await page.getByRole('button', { name: '下方加行', exact: true }).click()
  await page.keyboard.type('new')
  await expect(page.locator('.milkup-line[data-line="4"] .milkup-table-cell').nth(1)).toHaveText(
    'new',
  )
  await page.getByRole('button', { name: '删除行', exact: true }).click()
  await expect(page.locator('.milkup-line[data-line="4"] .milkup-table-cell').first()).toHaveText(
    'B',
  )
  await page.keyboard.press('Control+z')
  await expect(page.locator('.milkup-line[data-line="4"] .milkup-table-cell').nth(1)).toHaveText(
    'new',
  )
})
test('rendered table copy offers HTML and exact Markdown; source copy stays plain', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.goto('/')
  const source = '| 名称 | Value |\n| :--- | ---: |\n| A & <x> | **1**<br>two |'
  await page.locator('.milkup-input-proxy').focus()
  await page.keyboard.insertText(source)
  await page.keyboard.press('Control+a')
  await page.keyboard.press('Control+c')
  const payload = await page.evaluate(async () => {
    const item = (await navigator.clipboard.read())[0]!
    return {
      text: await (await item.getType('text/plain')).text(),
      html: await (await item.getType('text/html')).text(),
    }
  })
  expect(payload.text).toBe(source)
  const structure = await page.evaluate((html) => {
    const doc = new DOMParser().parseFromString(html, 'text/html')
    return {
      rows: doc.querySelectorAll('table tr').length,
      headers: doc.querySelectorAll('th').length,
      cell: doc.querySelector('td')?.textContent,
      breaks: doc.querySelectorAll('td br').length,
      scripts: doc.querySelectorAll('script').length,
    }
  }, payload.html)
  expect(structure).toEqual({ rows: 2, headers: 2, cell: 'A & <x>', breaks: 1, scripts: 0 })
  await page.keyboard.press('Control+1')
  await page.keyboard.press('Control+c')
  expect(
    await page.evaluate(async () => (await navigator.clipboard.read())[0]!.types),
  ).not.toContain('text/html')
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(source)
})
test('native-style multiline clipboard paste stays within a cell and table exit is undoable', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await openEditableTable(page)
  await page.evaluate(() => navigator.clipboard.writeText('one\ntwo|three'))
  await page.keyboard.press('Control+v')
  await expect(page.locator('.milkup-line[data-line="3"] .milkup-table-cell')).toHaveCount(2)
  await page.keyboard.press('Control+1')
  await expect(page.locator('.milkup-line[data-line="3"]')).toHaveText('| one<br>two\\|three | 1 |')
  await page.keyboard.press('Control+2')
  await page.keyboard.press('Control+z')
  await page.getByRole('button', { name: '退出表格', exact: true }).click()
  await page.keyboard.type('after')
  await expect(page.locator('.milkup-line[data-line="6"]')).toHaveText('after')
  await page.keyboard.press('Control+z')
  await page.keyboard.press('Control+z')
  await expect(page.locator('.milkup-line')).toHaveCount(4)
})

test('phase9 search updates queries and keeps keyboard navigation in the search box', async ({
  page,
}) => {
  await page.goto('/')
  await page.locator('.milkup-input-proxy').focus()
  await page.keyboard.insertText('alpha target beta target')
  await page.keyboard.press('Control+f')
  const search = page.getByRole('searchbox', { name: '搜索', exact: true })
  await search.fill('target')
  await expect(page.locator('[data-search-result-count]')).toHaveText('1/2')
  await expect(search).toBeFocused()
  await search.press('Enter')
  await expect(page.locator('[data-search-result-count]')).toHaveText('2/2')
  await search.press('Shift+Enter')
  await expect(page.locator('[data-search-result-count]')).toHaveText('1/2')
  await search.fill('missing')
  await expect(page.locator('[data-search-result-count]')).toHaveText('0/0')
  await expect(page.locator('.milkup-search-highlight')).toHaveCount(0)
})

test('phase9 outline updates renamed headings and highlights the current section', async ({
  page,
}) => {
  await page.addInitScript(
    (registry) => localStorage.setItem('milkup.desktop.plugins.registry.v1', registry),
    outlineRegistry(600),
  )
  await page.goto('/')
  await page.locator('.milkup-input-proxy').focus()
  await page.keyboard.insertText('# First\nbody\n### Third\ntext')
  await page.getByRole('button', { name: '侧栏', exact: true }).click()
  const outline = page.locator('[data-plugin-ui="milkup.outline:outline-panel"]')
  await expect(
    outline.getByRole('button', { name: '跳转到 First，第 1 行', exact: true }),
  ).toBeVisible()
  await outline.getByRole('button', { name: '跳转到 First，第 1 行', exact: true }).click()
  await expect(page.locator('.milkup-input-proxy')).toBeFocused()
  await page.keyboard.press('End')
  await page.keyboard.insertText(' renamed')
  await expect(
    outline.getByRole('button', { name: '跳转到 First renamed，第 1 行', exact: true }),
  ).toBeVisible()
})

test('phase9 literal replacement preserves Unicode offsets and one undo boundary', async ({
  page,
}) => {
  await page.goto('/')
  await page.keyboard.insertText('İ foo 😀 FOO [x] .*')
  await page.keyboard.press('Control+f')
  const search = page.getByRole('searchbox', { name: '搜索', exact: true })
  await search.fill('foo')
  await expect(page.locator('[data-search-result-count]')).toHaveText('1/2')
  await page.getByRole('button', { name: '区分大小写', exact: true }).click()
  await expect(page.locator('[data-search-result-count]')).toHaveText('1/1')
  await page.getByRole('textbox', { name: '替换为', exact: true }).fill('$1中')
  await page.getByRole('button', { name: '替换', exact: true }).click()
  await expect(page.locator('.milkup-editor-content')).toHaveText('İ $1中 😀 FOO [x] .*')
  await expect(page.locator('[data-search-message]')).toHaveText('没有匹配结果')
  await search.focus()
  await search.press('Control+a')
  await search.press('Backspace')
  await search.press('f')
  await expect(search).toHaveValue('f')
  await expect(page.locator('.milkup-editor-content')).toHaveText('İ $1中 😀 FOO [x] .*')
  await search.press('Escape')
  await expect(page.locator('.milkup-input-proxy')).toBeFocused()
  await page.keyboard.press('Control+z')
  await expect(page.locator('.milkup-editor-content')).toHaveText('İ foo 😀 FOO [x] .*')
  await page.keyboard.press('Control+Shift+z')
  await expect(page.locator('.milkup-editor-content')).toHaveText('İ $1中 😀 FOO [x] .*')
})

test('phase9 replace all deletes literally and rejects a stale query', async ({ page }) => {
  await page.goto('/')
  await page.keyboard.insertText('aa .* aa .*')
  await page.keyboard.press('Control+h')
  await expect(page.getByRole('textbox', { name: '替换为', exact: true })).toBeFocused()
  const search = page.getByRole('searchbox', { name: '搜索', exact: true })
  await search.fill('.*')
  await expect(page.locator('[data-search-result-count]')).toHaveText('1/2')
  await page.getByRole('button', { name: '全部替换', exact: true }).click()
  await expect(page.locator('.milkup-editor-content')).toHaveText('aa  aa ')
  await expect(page.locator('[data-search-result-count]')).toHaveText('0/0')
  await search.fill('[')
  await expect(page.locator('[data-search-message]')).toHaveText('没有匹配结果')
  await expect(page.getByRole('button', { name: '全部替换', exact: true })).toBeDisabled()
  await search.press('Escape')
  await page.keyboard.press('Control+z')
  await expect(page.locator('.milkup-editor-content')).toHaveText('aa .* aa .*')
})

test('phase9 editing refreshes results without moving the caret and switching documents clears them', async ({
  page,
}) => {
  await page.goto('/')
  await page.keyboard.insertText('target target')
  await page.keyboard.press('Control+f')
  const search = page.getByRole('searchbox', { name: '搜索', exact: true })
  await search.fill('target')
  await expect(page.locator('[data-search-result-count]')).toHaveText('1/2')
  await search.press('F3')
  await expect(page.locator('[data-search-result-count]')).toHaveText('2/2')
  await search.press('Shift+F3')
  await expect(page.locator('[data-search-result-count]')).toHaveText('1/2')
  await page.locator('.milkup-input-proxy').focus()
  await page.keyboard.insertText('changed')
  await expect(page.locator('[data-search-result-count]')).toHaveText('1/1')
  await page.keyboard.insertText('!')
  await expect(page.locator('.milkup-editor-content')).toHaveText('changed! target')
  await page.keyboard.press('Control+n')
  await page.locator('[data-close-confirm-action="discard"].dialog-button').click()
  await expect(page.locator('.milkup-editor-content')).toHaveText('')
  await expect(page.locator('[data-search-result-count]')).toHaveText('0/0')
  await expect(page.locator('.milkup-search-highlight')).toHaveCount(0)
})

test('phase9 truncated results are explicit and cannot be replaced as a complete set', async ({
  page,
}) => {
  await page.goto('/')
  await page.keyboard.insertText('target '.repeat(205))
  await page.keyboard.press('Control+f')
  await page.getByRole('searchbox', { name: '搜索', exact: true }).fill('target')
  await expect(page.locator('[data-search-result-count]')).toHaveText('1/200+')
  await expect(page.locator('[data-search-message]')).toContainText('仅显示前 200 处')
  await expect(page.getByRole('button', { name: '全部替换', exact: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: '替换', exact: true })).toBeEnabled()
})

test('phase9 narrow search and outline stay reachable and source mode removes inline code styling', async ({
  page,
}) => {
  await page.addInitScript(
    (registry) => localStorage.setItem('milkup.desktop.plugins.registry.v1', registry),
    outlineRegistry(),
  )
  await page.setViewportSize({ width: 760, height: 520 })
  await page.goto('/')
  await page.keyboard.insertText('# Heading\ntext `code` tail\n### Child\nbody')
  await page.getByRole('button', { name: '侧栏', exact: true }).click()
  await page.keyboard.press('Control+f')
  await page.getByRole('searchbox', { name: '搜索', exact: true }).fill('code')
  await expect(page.locator('[data-search-result-count]')).toHaveText('1/1')
  const bounds = await page.evaluate(() => {
    const search = document.querySelector('[data-floating-search]')!.getBoundingClientRect()
    const editor = document.querySelector('[data-editor-host]')!.getBoundingClientRect()
    return {
      right: search.right,
      bottom: search.bottom,
      editorTop: editor.top,
      editorHeight: editor.height,
      overflow: document.documentElement.scrollWidth > innerWidth,
      controls: Array.from(
        document.querySelectorAll('[data-floating-search] button, [data-floating-search] input'),
      ).every((e) => {
        const r = e.getBoundingClientRect()
        return r.left >= search.left && r.right <= search.right
      }),
    }
  })
  expect(bounds.right).toBeLessThanOrEqual(760)
  expect(bounds.bottom).toBeLessThanOrEqual(bounds.editorTop)
  expect(bounds.overflow).toBe(false)
  expect(bounds.controls).toBe(true)
  expect(bounds.editorHeight).toBeGreaterThanOrEqual(200)
  await page.keyboard.press('Escape')
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press('Control+1')
    await expect(page.locator('.milkup-editor')).toHaveAttribute('data-mode', 'source')
    await expect(page.locator('.milkup-line[data-line="2"]')).toHaveText('text `code` tail')
    const styles = await page.locator('.milkup-line[data-line="2"]').evaluate((e) =>
      Array.from(e.querySelectorAll('*')).map((n) => ({
        background: getComputedStyle(n).backgroundColor,
        font: getComputedStyle(n).fontFamily,
        border: getComputedStyle(n).borderWidth,
      })),
    )
    expect(styles.every((s) => s.background === 'rgba(0, 0, 0, 0)' && s.border === '0px')).toBe(
      true,
    )
    await page.keyboard.press('Control+2')
  }
  const child = page.getByRole('button', { name: '跳转到 Child，第 3 行', exact: true })
  await child.focus()
  await child.press('Enter')
  await expect(page.locator('.milkup-input-proxy')).toBeFocused()
  await expect(child).toHaveAttribute('aria-current', 'location')
})

import { expect, test, type Page } from '@playwright/test'
import { installPreferencesFixture } from '../../plugins/preferences/scripts/browser-fixture.mjs'

const view = (page: Page) => page.locator('[data-plugin-ui="milkup.preferences:preferences-panel"]')
const field = (page: Page, label: string) => view(page).getByLabel(label, { exact: true })
const settingsKey = 'milkup.desktop.settings.v1'
const button = (page: Page, label: string) =>
  view(page).getByRole('button', { name: label, exact: true })
async function menu(page: Page) {
  await page.getByRole('button', { name: '菜单', exact: true }).click()
}
async function open(page: Page) {
  await menu(page)
  await page.locator('[data-plugin-menu-entry="milkup.preferences:preferences-panel"]').click()
  await expect(field(page, '字体大小')).toBeVisible()
  await expect(field(page, '字体大小')).toBeEnabled()
}
async function close(page: Page) {
  await page.keyboard.press('Escape')
  await expect(view(page)).toHaveCount(0)
}
async function setup(page: Page, approved = true) {
  await installPreferencesFixture(page, { enabled: approved, approved })
  await page.emulateMedia({ colorScheme: 'light' })
  await page.goto('/')
  await expect(page.locator('#app')).toHaveAttribute('data-loading', /^(idle|ready)$/)
}
const fontSize = (page: Page) =>
  page.locator('.milkup-editor').evaluate((e) => getComputedStyle(e).fontSize)
const persisted = (page: Page) => page.evaluate((key) => localStorage.getItem(key), settingsKey)
async function previewSize(page: Page, value: string) {
  await field(page, '字体大小').fill(value)
  await expect.poll(() => fontSize(page)).toBe(value + 'px')
  await expect(view(page).getByRole('status')).toHaveText('正在预览，尚未保存。')
}

test('permissions, generic menu entry, controlled invalid drafts, preview cancellation and default reset', async ({
  page,
}) => {
  await setup(page, false)
  await menu(page)
  await expect(
    page.locator('[data-plugin-menu-entry="milkup.preferences:preferences-panel"]'),
  ).toHaveCount(0)
  await page.getByRole('button', { name: '插件', exact: true }).click()
  await page.locator('[data-plugin-action="details"][data-plugin-id="milkup.preferences"]').click()
  await page.getByRole('button', { name: '批准能力', exact: true }).click()
  await page.getByRole('button', { name: '启用', exact: true }).click()
  await expect(page.locator('.plugin-state')).toHaveText('已启用')
  await page.getByRole('button', { name: '关闭菜单', exact: true }).click()
  await open(page)
  const baseline = await persisted(page)
  await previewSize(page, '20')
  await field(page, '字体大小').fill('')
  await expect(field(page, '字体大小')).toHaveAttribute('aria-invalid', 'true')
  await expect(button(page, '保存')).toBeDisabled()
  await expect(view(page)).toContainText('请输入数值')
  await field(page, '字体大小').fill('99')
  await expect(field(page, '字体大小')).toHaveAttribute('aria-invalid', 'true')
  await expect.poll(() => fontSize(page)).toBe('20px')
  await button(page, '取消更改').click()
  await expect(field(page, '字体大小')).toHaveValue('14')
  await expect.poll(() => fontSize(page)).toBe('14px')
  expect(await persisted(page)).toBe(baseline)
  await previewSize(page, '22')
  await button(page, '保存').click()
  await expect(view(page).getByRole('status')).toHaveText('偏好已保存。')
  await button(page, '预览默认值').click()
  await expect(field(page, '字体大小')).toHaveValue('14')
  await expect.poll(() => fontSize(page)).toBe('14px')
  await button(page, '取消更改').click()
  await expect.poll(() => fontSize(page)).toBe('22px')
  await close(page)
  await page.reload()
  await expect.poll(() => fontSize(page)).toBe('22px')
  await open(page)
  await expect(field(page, '字体大小')).toHaveValue('22')
})

test('failed persistent writes retain the draft and allow cancel or retry without a false saved status', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const original = Storage.prototype.setItem
    Object.assign(window, { preferencesFailStorage: false })
    Storage.prototype.setItem = function (key, value) {
      if (
        key === 'milkup.desktop.settings.v1' &&
        (window as unknown as { preferencesFailStorage: boolean }).preferencesFailStorage
      )
        throw new DOMException('quota test', 'QuotaExceededError')
      return original.call(this, key, value)
    }
  })
  await setup(page)
  await open(page)
  const baseline = await persisted(page)
  await previewSize(page, '22')
  await page.evaluate(() => {
    ;(window as unknown as { preferencesFailStorage: boolean }).preferencesFailStorage = true
  })
  await button(page, '保存').click()
  await expect(view(page).getByRole('alert')).toBeVisible()
  await expect(field(page, '字体大小')).toHaveValue('22')
  expect(await persisted(page)).toBe(baseline)
  await expect(view(page)).not.toContainText('偏好已保存。')
  await page.evaluate(() => {
    ;(window as unknown as { preferencesFailStorage: boolean }).preferencesFailStorage = false
  })
  await button(page, '保存').click()
  await expect(view(page).getByRole('status')).toHaveText('偏好已保存。')
  await close(page)
  await page.reload()
  await expect.poll(() => fontSize(page)).toBe('22px')
})

test('closing preview then disabling, enabling and uninstalling preserves committed preferences only', async ({
  page,
}) => {
  await setup(page)
  await open(page)
  await previewSize(page, '20')
  await button(page, '保存').click()
  await expect(view(page).getByRole('status')).toHaveText('偏好已保存。')
  await previewSize(page, '26')
  await close(page)
  await expect.poll(() => fontSize(page)).toBe('20px')
  await menu(page)
  await page.getByRole('button', { name: '插件', exact: true }).click()
  await page.locator('[data-plugin-action="details"][data-plugin-id="milkup.preferences"]').click()
  await page.locator('[data-plugin-action="disable"][data-plugin-id="milkup.preferences"]').click()
  await expect(
    page.locator('[data-plugin-action="enable"][data-plugin-id="milkup.preferences"]'),
  ).toBeVisible()
  await expect(
    page.locator('[data-plugin-menu-entry="milkup.preferences:preferences-panel"]'),
  ).toHaveCount(0)
  await page.locator('[data-plugin-action="enable"][data-plugin-id="milkup.preferences"]').click()
  await page.getByRole('button', { name: '关闭菜单', exact: true }).click()
  await open(page)
  await expect(field(page, '字体大小')).toHaveValue('20')
  await previewSize(page, '24')
  await close(page)
  await menu(page)
  await page.getByRole('button', { name: '插件', exact: true }).click()
  await page.locator('[data-plugin-action="remove"][data-plugin-id="milkup.preferences"]').click()
  await expect(
    page.locator('[data-plugin-menu-entry="milkup.preferences:preferences-panel"]'),
  ).toHaveCount(0)
  await page.getByRole('button', { name: '关闭菜单', exact: true }).click()
  await expect.poll(() => fontSize(page)).toBe('20px')
  await page.reload()
  await expect.poll(() => fontSize(page)).toBe('20px')
  await menu(page)
  await expect(
    page.locator('[data-plugin-menu-entry="milkup.preferences:preferences-panel"]'),
  ).toHaveCount(0)
})

for (const windowed of [false, true])
  for (const mode of ['source', 'live']) {
    test(`${windowed ? 'windowed' : 'ordinary'} ${mode} preview and commit preserve Unicode CRLF bytes, selection and document history`, async ({
      page,
    }) => {
      test.setTimeout(120000)
      const original =
        'ORIGINAL 中文 👩🏽‍💻 é\r\n\r\n' +
        (windowed ? '正文 preserved line '.repeat(6) + '\r\n' : '正文保留。\r\n').repeat(
          windowed ? 18000 : 1,
        )
      expect(original).toContain('\r\n')
      expect(original).not.toContain('\\r\\n')
      await page.route(/\/src\/file-service\.ts(?:\?|$)/, async (route) => {
        const response = await route.fetch()
        const body = (await response.text()).replace(
          'function createDesktopFileService() {',
          `function createDesktopFileService() {
        const service = createMockFileService(); const text = ${JSON.stringify(original)};
        service.getFileMetadata = async path => ({path,sizeBytes:new TextEncoder().encode(text).length,readonly:false});
        service.openPath = async path => ({documentId:'preferences-document',file:{path},text,diskSnapshotHash:'initial'});
        const save = service.saveFile.bind(service); service.saveFile = async (session,text) => { window.preferencesSavedText = text; return save(session,text); }; return service;`,
        )
        expect(body).toContain('window.preferencesSavedText = text')
        await route.fulfill({ response, body })
      })
      await setup(page)
      await menu(page)
      await page.getByRole('button', { name: '打开', exact: true }).click()
      await expect(page.locator('#app')).toHaveAttribute('data-loading', 'ready')
      if (windowed)
        await expect(page.locator('.milkup-source-document-view')).toHaveAttribute(
          'data-editable',
          'true',
        )
      else await expect(page.locator('.milkup-source-document-view')).toHaveCount(0)
      await page.keyboard.press(mode === 'source' ? 'Control+1' : 'Control+2')
      await expect(page.locator('.milkup-editor')).toHaveAttribute('data-mode', mode)
      await page.locator('.milkup-input-proxy').focus()
      await page.keyboard.press('Control+Home')
      await page.keyboard.insertText('EDIT-')
      await expect(page.locator('.milkup-editor')).toContainText('EDIT-ORIGINAL')
      await expect
        .poll(async () => Number(await page.locator('[data-stat="version"]').textContent()))
        .toBeGreaterThan(0)
      const version = await page.locator('[data-stat="version"]').textContent()
      await page.keyboard.press('Shift+ArrowLeft')
      await page.keyboard.press('Shift+ArrowLeft')
      const selection = await page.locator('.milkup-selection').evaluateAll((elements) =>
        elements.map((e) => ({
          from: e.getAttribute('data-from'),
          to: e.getAttribute('data-to'),
        })),
      )
      await open(page)
      await previewSize(page, '20')
      await field(page, '行高').fill('1.8')
      await field(page, '正文宽度').fill('600')
      await field(page, '编辑字体').selectOption('serif')
      await button(page, '取消更改').click()
      await expect.poll(() => fontSize(page)).toBe('14px')
      await previewSize(page, '18')
      await button(page, '保存').click()
      await expect(view(page).getByRole('status')).toHaveText('偏好已保存。')
      await close(page)
      await expect(page.locator('[data-stat="version"]')).toHaveText(version!)
      expect(
        await page.locator('.milkup-selection').evaluateAll((elements) =>
          elements.map((e) => ({
            from: e.getAttribute('data-from'),
            to: e.getAttribute('data-to'),
          })),
        ),
      ).toEqual(selection)
      await page.locator('.milkup-input-proxy').focus()
      await page.keyboard.press('Control+z')
      await expect(page.locator('.milkup-editor')).not.toContainText('EDIT-ORIGINAL')
      await page.keyboard.press('Control+Shift+z')
      await expect(page.locator('.milkup-editor')).toContainText('EDIT-ORIGINAL')
      await page.keyboard.press('Control+s')
      await expect
        .poll(() =>
          page.evaluate(
            () => (window as unknown as { preferencesSavedText?: string }).preferencesSavedText,
          ),
        )
        .toBe('EDIT-' + original)
      await expect(page.locator('[data-save-dot]')).not.toHaveClass(/is-dirty/)
    })
  }

test('base host remains editable and saves with persistent storage access denied', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('storage denied fixture', 'SecurityError')
      },
    })
  })
  await page.route(/\/src\/file-service\.ts(?:\?|$)/, async (route) => {
    const response = await route.fetch()
    const body = (await response.text()).replace(
      'function createDesktopFileService() {',
      `function createDesktopFileService() {
      const service = createMockFileService(); const save = service.saveFile.bind(service);
      const saveAs = service.saveFileAs.bind(service);
      service.saveFile = async (session,text) => { window.preferencesStorageFaultSaved = text; return save(session,text); };
      service.saveFileAs = async (session,text) => { window.preferencesStorageFaultSaved = text; return saveAs(session,text); }; return service;`,
    )
    expect(body).toContain('window.preferencesStorageFaultSaved = text')
    await route.fulfill({ response, body })
  })
  await page.goto('/')
  await expect(page.locator('.milkup-input-proxy')).toBeVisible()
  await page.keyboard.press('Control+1')
  await expect(page.locator('.milkup-editor')).toHaveAttribute('data-mode', 'source')
  await page.locator('.milkup-input-proxy').focus()
  const text = 'Storage unavailable — 中文 👩🏽‍💻 é'
  await page.keyboard.insertText(text)
  await expect(page.locator('.milkup-editor')).toContainText(text)
  await page.keyboard.press('Control+z')
  await expect(page.locator('.milkup-editor')).not.toContainText('Storage unavailable')
  await page.keyboard.press('Control+Shift+z')
  await expect(page.locator('.milkup-editor')).toContainText(text)
  await page.keyboard.press('Control+s')
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { preferencesStorageFaultSaved?: string })
            .preferencesStorageFaultSaved,
      ),
    )
    .toBe(text)
  await expect(page.locator('[data-save-dot]')).not.toHaveClass(/is-dirty/)
})

for (const windowed of [false, true]) {
  test(`${windowed ? 'windowed' : 'ordinary'} live centered body focuses and selects from both editor gutters`, async ({
    page,
  }) => {
    const original =
      'first 中文😀\r\nsecond é\r\n' +
      (windowed ? 'bounded text 中文 '.repeat(12) + '\r\n' : '').repeat(windowed ? 18000 : 1)
    await page.route(/\/src\/file-service\.ts(?:\?|$)/, async (route) => {
      const response = await route.fetch()
      const body = (await response.text()).replace(
        'function createDesktopFileService() {',
        `function createDesktopFileService() {
        const service = createMockFileService(); const text = ${JSON.stringify(original)};
        service.getFileMetadata = async path => ({path,sizeBytes:new TextEncoder().encode(text).length,readonly:false});
        service.openPath = async path => ({documentId:'gutter-document',file:{path},text,diskSnapshotHash:'initial'}); return service;`,
      )
      expect(body).toContain('gutter-document')
      await route.fulfill({ response, body })
    })
    await setup(page)
    await menu(page)
    await page.getByRole('button', { name: '打开', exact: true }).click()
    await expect(page.locator('#app')).toHaveAttribute('data-loading', 'ready')
    await page.keyboard.press('Control+2')
    await open(page)
    await field(page, '正文宽度').fill('720')
    await button(page, '保存').click()
    await expect(view(page).getByRole('status')).toHaveText('偏好已保存。')
    await close(page)
    await expect(page.locator('.milkup-source-document-view')).toHaveCount(windowed ? 1 : 0)
    const geometry = await page.locator('.milkup-editor').evaluate((editor) => {
      const e = editor.getBoundingClientRect(),
        c = editor.querySelector('.milkup-editor-content')!.getBoundingClientRect(),
        line = editor.querySelector('.milkup-line')!.getBoundingClientRect()
      return {
        left: e.left + 20,
        right: e.right - 20,
        y: line.top + line.height / 2,
        contentLeft: c.left,
        contentRight: c.right,
      }
    })
    expect(geometry.left).toBeLessThan(geometry.contentLeft)
    expect(geometry.right).toBeGreaterThan(geometry.contentRight)
    await page.mouse.click(geometry.left, geometry.y)
    await expect(page.locator('.milkup-input-proxy')).toBeFocused()
    await expect(page.locator('.milkup-cursor')).toHaveAttribute('data-position', '0')
    await page.keyboard.type('L')
    await expect(page.locator('.milkup-line[data-line="1"]')).toHaveText('Lfirst 中文😀')
    await page.mouse.click(geometry.right, geometry.y)
    await expect(page.locator('.milkup-input-proxy')).toBeFocused()
    await expect(page.locator('.milkup-cursor')).toHaveAttribute(
      'data-position',
      String(original.indexOf('\r\n') + 1),
    )
    await page.keyboard.type('R')
    await expect(page.locator('.milkup-line[data-line="1"]')).toHaveText('Lfirst 中文😀R')
    await page.mouse.move(geometry.left, geometry.y)
    await page.mouse.down()
    await page.mouse.move(geometry.right, geometry.y, { steps: 5 })
    await page.mouse.up()
    await expect(page.locator('.milkup-selection').first()).toBeVisible()
    await expect(page.locator('.milkup-input-proxy')).toBeFocused()
  })
}

test('responsive breakpoint preserves preferences select and input focus without editing the document', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1100, height: 760 })
  await setup(page)
  await page.keyboard.press('Control+1')
  await page.locator('.milkup-input-proxy').focus()
  const original = 'Breakpoint preserves 中文 👩🏽‍💻 é'
  await page.keyboard.insertText(original)
  const version = await page.locator('[data-stat="version"]').textContent()
  await open(page)
  try {
    for (const label of ['界面缩放', '字体大小']) {
      const control = field(page, label)
      await control.focus()
      for (const width of [700, 1100]) {
        await page.setViewportSize({ width, height: 760 })
        await page.evaluate(
          () =>
            new Promise<void>((resolve) =>
              requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
            ),
        )
        await expect(view(page)).toBeVisible()
        await expect(control).toBeFocused()
        await expect(page.locator('[data-stat="version"]')).toHaveText(version!)
        await expect(page.locator('.milkup-line[data-line="1"]')).toHaveText(original)
      }
    }
    await close(page)
    await page.keyboard.press('Control+f')
    const search = page.locator('[data-search-input]')
    await expect(search).toBeFocused()
    await page.setViewportSize({ width: 700, height: 760 })
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    )
    await expect(search).toBeFocused()
    await page.keyboard.type('find only')
    await expect(search).toHaveValue('find only')
    await expect(page.locator('[data-stat="version"]')).toHaveText(version!)
    await expect(page.locator('.milkup-line[data-line="1"]')).toHaveText(original)
  } finally {
    await test.info().attach('breakpoint-focus', {
      body: JSON.stringify(
        await page.evaluate(() => ({
          width: innerWidth,
          narrow: matchMedia('(max-width: 760px)').matches,
          activeTag: document.activeElement?.tagName,
          activeLabel: document.activeElement?.getAttribute('aria-label'),
          activeField: (document.activeElement as HTMLElement)?.dataset.pluginFieldControl,
          modalVisible: !!document.querySelector('.plugin-ui-modal')?.getClientRects().length,
          editorInert: document.querySelector('.editor-panel')?.hasAttribute('inert'),
          version: document.querySelector('[data-stat="version"]')?.textContent,
          text: document.querySelector('.milkup-line[data-line="1"]')?.textContent,
        })),
        null,
        2,
      ),
      contentType: 'application/json',
    })
    await page.screenshot({ path: test.info().outputPath('breakpoint-focus.png') })
  }
})

test('responsive breakpoint moves focus only when sidebar controls or the editor become unavailable', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1100, height: 760 })
  await setup(page)
  await page.locator('[data-sidebar-toggle]').click()
  await expect(page.locator('#app')).toHaveAttribute('data-sidebar-collapsed', 'false')
  await page.locator('.milkup-input-proxy').focus()
  await page.setViewportSize({ width: 700, height: 760 })
  await expect(page.locator('.editor-panel')).toHaveAttribute('inert', '')
  await expect(page.locator('[data-sidebar-close]')).toBeFocused()
  await page.setViewportSize({ width: 1100, height: 760 })
  await expect(page.locator('[data-sidebar-close]')).toBeHidden()
  await expect(page.locator('.milkup-input-proxy')).toBeFocused()
  await page.locator('[data-sidebar-resize]').focus()
  await page.setViewportSize({ width: 700, height: 760 })
  await expect(page.locator('[data-sidebar-resize]')).toBeHidden()
  await expect(page.locator('[data-sidebar-close]')).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(page.locator('#app')).toHaveAttribute('data-sidebar-collapsed', 'true')
  await expect(page.locator('.milkup-input-proxy')).toBeFocused()
})

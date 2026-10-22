import { sealWorkerFixture } from '../helpers/sealed-plugin-fixture'
import { expect, test, type Page } from '@playwright/test'

async function seed(page: Page, betaCode = 'export default {}'): Promise<void> {
  const records = ['alpha', 'beta'].map((id) => ({
    manifest: {
      id: `cards.${id}`,
      name: `${id} tools`,
      description: `${id} description <script>plain text</script>`,
      version: '1.0.0',
      main: './dist/plugin.js',
      engines: { milkup: '^2.0.0-beta.1', pluginSdk: '*' },
      ...(id === 'alpha'
        ? { permissions: ['network:access'], networkOrigins: ['https://example.test'] }
        : {}),
    },
    manifestPath: `/plugins/${id}/plugin.json`,
    rootPath: `/plugins/${id}`,
    sourcePath: `/plugins/${id}/plugin.json`,
    state: 'installed',
    enabled: false,
    installedAt: 1,
    updatedAt: 1,
    trust: 'development',
    dataRoot: `milkup://plugin-data/cards.${id}`,
    storageRoot: `milkup://plugin-storage/cards.${id}`,
    approvals: { permissions: [], hosts: ['worker'] },
    errors: [],
  }))
  for (const record of records)
    await sealWorkerFixture(
      page,
      record.manifest,
      record.manifestPath,
      record.manifest.id === 'cards.beta' ? betaCode : 'export default {}',
    )
  await page.addInitScript((records) => {
    localStorage.setItem(
      'milkup.desktop.plugins.registry.v1',
      JSON.stringify({ version: 1, records, auditRecords: [] }),
    )
    localStorage.setItem('milkup.desktop.plugins.bundled.v1', '[]')
  }, records)
  await page.goto('/')
  await page.getByRole('button', { name: '菜单', exact: true }).click()
  await page.getByRole('button', { name: '插件', exact: true }).click()
}

test('plugin cards expose explicit details; keyboard detail and back restore focus', async ({
  page,
}) => {
  await seed(page)
  const card = page.getByRole('button', { name: 'alpha tools 详情', exact: true })
  await expect(card).toBeVisible()
  await expect(card).toHaveText('详情')
  await expect(card.locator('xpath=../..')).toContainText(
    'alpha description <script>plain text</script>',
  )
  await expect(card.locator('xpath=../..').locator('.plugin-logo')).toHaveCount(1)
  await expect(
    page.locator('.plugin-meta, .plugin-state, [data-plugin-action="enable"]'),
  ).toHaveCount(0)
  await card.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('heading', { name: 'alpha tools' })).toBeFocused()
  await expect(page.locator('.plugin-meta')).toContainText('network:access')
  await expect(page.locator('.plugin-meta')).toContainText('^2.0.0-beta.1')
  await page.keyboard.press('Escape')
  await expect(card).toBeFocused()
  await expect(page.locator('[data-app-menu]')).toBeVisible()
  await page.keyboard.press('Space')
  await page.getByRole('button', { name: '返回插件列表', exact: true }).click()
  await expect(card).toBeFocused()
})

test('plugin permission approval, enable, disable and uninstall remain inside details', async ({
  page,
}) => {
  await seed(page)
  await page.getByRole('button', { name: 'alpha tools 详情', exact: true }).click()
  await expect(page.locator('.plugin-meta')).toContainText('待审批')
  await page.getByRole('button', { name: '启用', exact: true }).click()
  await expect(page.locator('.plugin-state')).toHaveText('失败')
  await expect(page.locator('.plugin-errors')).toContainText('require approval')
  await page.getByRole('button', { name: '批准能力', exact: true }).click()
  await expect(page.locator('.plugin-meta')).toContainText('已批准')
  await page.getByRole('button', { name: '启用', exact: true }).click()
  await expect(page.locator('.plugin-state')).toHaveText('已启用')
  await expect(page.getByRole('heading', { name: 'alpha tools' })).toBeFocused()
  await page.getByRole('button', { name: '禁用', exact: true }).click()
  await expect(page.locator('.plugin-state')).toHaveText('已禁用')
  await page.getByRole('button', { name: '移除', exact: true }).click()
  await expect(page.getByRole('button', { name: 'beta tools 详情', exact: true })).toBeFocused()
  await expect(page.getByRole('button', { name: 'alpha tools 详情', exact: true })).toHaveCount(0)
})

test('plugin detail controls and long metadata fit a narrow viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await seed(page)
  await page.getByRole('button', { name: 'alpha tools 详情', exact: true }).click()
  await expect(page.getByRole('button', { name: '移除', exact: true })).toBeVisible()
  expect(
    await page
      .locator('.plugin-detail')
      .evaluate((element) => element.scrollWidth <= element.clientWidth),
  ).toBe(true)
})

test('new installation opens approval details; late and broken logos preserve fallback and focus', async ({
  page,
}) => {
  await page.goto('/')
  await page.evaluate(async () => {
    const module = await import(/* @vite-ignore */ '/src/desktop-plugin-manager-ui.ts')
    const target = document.createElement('div')
    target.id = 'plugin-ui-test'
    document.body.append(target)
    const state = {
      records: [],
      contributions: {
        commands: [],
        keymaps: [],
        renderers: [],
        markdownSyntax: [],
        ui: [],
        importers: [],
        documentTypes: [],
      },
      auditCount: 0,
      auditRecords: [],
      installFailures: [],
    }
    const data =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZZkAAAAASUVORK5CYII='
    const loadIcon = async (record: { manifest: { id: string } }) => {
      await new Promise((resolve) => setTimeout(resolve, 200))
      return record.manifest.id === 'new.tools' ? data : 'data:image/png;base64,AAAA'
    }
    module.renderDesktopPluginManagerElement(target, state, loadIcon)
    target.querySelector<HTMLButtonElement>('button')!.focus()
    const record = {
      manifest: {
        id: 'new.tools',
        name: 'New Tools',
        description: 'Installed description',
        version: '1.0.0',
        permissions: ['file:read'],
      },
      manifestPath: '/plugins/new/plugin.json',
      rootPath: '/plugins/new',
      sourcePath: '/plugins/new/plugin.json',
      state: 'installed',
      enabled: false,
      installedAt: 1,
      updatedAt: 1,
      trust: 'development',
      dataRoot: '/data',
      storageRoot: '/storage',
      approvals: { permissions: [], hosts: [] },
      errors: [],
    }
    const next = {
      ...state,
      records: [
        record,
        { ...record, manifest: { ...record.manifest, id: 'broken.tools', name: 'Broken Tools' } },
      ],
    }
    module.renderDesktopPluginManagerElement(target, next, loadIcon)
  })
  const target = page.locator('#plugin-ui-test')
  await expect(target.getByRole('heading', { name: 'New Tools' })).toBeFocused()
  await expect(target.getByRole('button', { name: '批准能力', exact: true })).toBeVisible()
  await expect(target.locator('.plugin-logo img')).toHaveCount(1)
  await expect(target.getByRole('heading', { name: 'New Tools' })).toBeFocused()
  await target.getByRole('button', { name: '返回插件列表', exact: true }).click()
  await expect(target.getByRole('button', { name: 'New Tools 详情', exact: true })).toBeFocused()
  await expect(
    target.locator('.plugin-summary-card[data-plugin-id="broken.tools"] img'),
  ).toHaveCount(0)
  await expect(
    target.locator('.plugin-summary-card[data-plugin-id="broken.tools"] .plugin-logo'),
  ).toHaveText('B')
})

test('background package restoration opens on the list and changed icons do not retain stale images', async ({
  page,
}) => {
  await page.goto('/')
  await page.evaluate(async () => {
    const module = await import(/* @vite-ignore */ '/src/desktop-plugin-manager-ui.ts')
    const target = document.createElement('div')
    target.id = 'plugin-restoration-test'
    target.hidden = true
    document.body.append(target)
    const state = {
      records: [],
      contributions: {
        commands: [],
        keymaps: [],
        renderers: [],
        markdownSyntax: [],
        ui: [],
        importers: [],
        documentTypes: [],
      },
      auditCount: 0,
      auditRecords: [],
      installFailures: [],
    }
    const loadIcon = async (record: { manifest: { version: string } }) =>
      record.manifest.version === '1.0.0'
        ? 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZZkAAAAASUVORK5CYII='
        : undefined
    module.renderDesktopPluginManagerElement(target, state, loadIcon)
    const record = {
      manifest: { id: 'restored.tools', name: 'Restored Tools', version: '1.0.0' },
      manifestPath: '/plugins/restored/plugin.json',
      rootPath: '/plugins/restored',
      sourcePath: '/plugins/restored/plugin.json',
      state: 'installed',
      enabled: false,
      installedAt: 1,
      updatedAt: 1,
      trust: 'development',
      dataRoot: '/data',
      storageRoot: '/storage',
      approvals: { permissions: [], hosts: [] },
      errors: [],
    }
    module.renderDesktopPluginManagerElement(target, { ...state, records: [record] }, loadIcon)
    await Promise.resolve()
    target.hidden = false
    const image = target.querySelector('img')
    if (!image) throw new Error('Expected initial package icon')
    module.renderDesktopPluginManagerElement(
      target,
      { ...state, records: [{ ...record, manifest: { ...record.manifest, version: '2.0.0' } }] },
      loadIcon,
    )
  })
  const target = page.locator('#plugin-restoration-test')
  await expect(
    target.getByRole('button', { name: 'Restored Tools 详情', exact: true }),
  ).toBeVisible()
  await expect(target.locator('.plugin-detail')).toHaveCount(0)
  await expect(target.locator('img')).toHaveCount(0)
  await expect(target.locator('.plugin-logo')).toHaveText('R')
})

test('beta3 card switch toggles in place without opening details', async ({ page }) => {
  await seed(page)
  const card = page.locator('.plugin-summary-card[data-plugin-id="cards.beta"]')
  await expect(card.getByRole('switch')).toHaveAttribute('aria-checked', 'false')
  await card.locator('.plugin-card-title').click()
  await expect(page.locator('.plugin-detail')).toHaveCount(0)
  await card.getByRole('switch').click()
  await expect(card.getByRole('switch')).toHaveAttribute('aria-checked', 'true')
  await expect(page.locator('.plugin-detail')).toHaveCount(0)
  await card.getByRole('switch').click()
  await expect(card.getByRole('switch')).toHaveAttribute('aria-checked', 'false')
  await expect(
    page.locator('.plugin-summary-card[data-plugin-id="cards.alpha"]').getByRole('switch'),
  ).toBeDisabled()
})

test('beta3 switch rejects repeated activation while pending and reports failure in place', async ({
  page,
}) => {
  await seed(
    page,
    'export default { async activate() { await new Promise(resolve => setTimeout(resolve, 250)); throw new Error("fixture activation failed") } }',
  )
  const card = page.locator('.plugin-summary-card[data-plugin-id="cards.beta"]')
  await card.getByRole('switch').evaluate((button: HTMLButtonElement) => {
    button.click()
    document
      .querySelector<HTMLButtonElement>(
        '.plugin-summary-card[data-plugin-id="cards.beta"] [role="switch"]',
      )!
      .click()
  })
  await expect(card.getByRole('switch')).toHaveAttribute('aria-busy', 'true')
  await expect(card.getByRole('switch')).toBeDisabled()
  await expect(card.getByRole('switch')).toBeEnabled()
  await expect(card.getByRole('switch')).toHaveAttribute('aria-checked', 'false')
  await expect(card.getByRole('status')).toContainText('操作未完成')
  await expect(page.locator('.plugin-detail')).toHaveCount(0)
  await card.getByRole('button', { name: 'beta tools 详情' }).click()
  await expect(page.locator('.plugin-errors')).toContainText('fixture activation failed')
})

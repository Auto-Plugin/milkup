import { sealWorkerFixture } from '../helpers/sealed-plugin-fixture'
import { expect, test, type Page } from '@playwright/test'

async function seed(page: Page): Promise<void> {
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
    await sealWorkerFixture(page, record.manifest, record.manifestPath, 'export default {}')
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

test('plugin cards show only identity and description; keyboard detail and back restore focus', async ({
  page,
}) => {
  await seed(page)
  const card = page.getByRole('button', { name: 'alpha tools', exact: true })
  await expect(card).toBeVisible()
  await expect(card).toHaveText('aalpha toolsalpha description <script>plain text</script>')
  await expect(card.locator('.plugin-logo')).toHaveCount(1)
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
  await page.getByRole('button', { name: 'alpha tools', exact: true }).click()
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
  await expect(page.getByRole('button', { name: 'beta tools', exact: true })).toBeFocused()
  await expect(page.getByRole('button', { name: 'alpha tools', exact: true })).toHaveCount(0)
})

test('plugin detail controls and long metadata fit a narrow viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await seed(page)
  await page.getByRole('button', { name: 'alpha tools', exact: true }).click()
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
  await expect(target.getByRole('button', { name: 'New Tools', exact: true })).toBeFocused()
  await expect(
    target.getByRole('button', { name: 'Broken Tools', exact: true }).locator('img'),
  ).toHaveCount(0)
  await expect(
    target.getByRole('button', { name: 'Broken Tools', exact: true }).locator('.plugin-logo'),
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
  await expect(target.getByRole('button', { name: 'Restored Tools', exact: true })).toBeVisible()
  await expect(target.locator('.plugin-detail')).toHaveCount(0)
  await expect(target.locator('img')).toHaveCount(0)
  await expect(target.locator('.plugin-logo')).toHaveText('R')
})

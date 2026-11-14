import { sealWorkerFixture } from '../helpers/sealed-plugin-fixture'
import { expect, test, type Page } from '@playwright/test'

async function seed(page: Page, betaCode = 'export default {}', controls = false): Promise<void> {
  const records = ['alpha', 'beta'].map((id) => ({
    manifest: {
      id: `cards.${id}`,
      name: `${id} tools`,
      description: `${id} description <script>plain text</script>`,
      version: '1.0.0',
      main: './dist/plugin.js',
      engines: { milkup: '^2.0.0-beta.1', pluginSdk: '*' },
      ...(id === 'beta' && controls
        ? {
            contributes: {
              commands: [{ id: 'cards.run', title: '运行卡片命令', action: 'cards.run' }],
              ui: [{ id: 'panel', title: '卡片控制面板', slot: 'modal' }],
            },
          }
        : {}),
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

test('the card switch enables sensitive plugins directly and details contain information only', async ({
  page,
}) => {
  await seed(page)
  const card = page.locator('.plugin-summary-card[data-plugin-id="cards.alpha"]')
  const toggle = card.getByRole('switch')
  await expect(toggle).toBeEnabled()
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-checked', 'true')
  await expect(toggle).toBeFocused()
  await card.getByRole('button', { name: 'alpha tools 详情', exact: true }).click()
  await expect(page.locator('.plugin-state')).toHaveText('已启用')
  await expect(
    page.locator(
      '[data-plugin-action="approve"], [data-plugin-action="enable"], [data-plugin-action="disable"], [data-plugin-action="revoke-approval"]',
    ),
  ).toHaveCount(0)
  await expect(page.locator('.plugin-meta')).not.toContainText('审批')
  await page.keyboard.press('Escape')
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-checked', 'false')
  await card.getByRole('button', { name: 'alpha tools 详情', exact: true }).click()
  await expect(page.locator('[data-plugin-action="reload"]')).toHaveCount(0)
  await page.getByRole('button', { name: '移除插件', exact: true }).click()
  await expect(page.getByRole('button', { name: 'beta tools 详情', exact: true })).toBeFocused()
  await expect(page.getByRole('button', { name: 'alpha tools 详情', exact: true })).toHaveCount(0)
})

test('plugin detail controls and long metadata fit a narrow viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await seed(page)
  await page.getByRole('button', { name: 'alpha tools 详情', exact: true }).click()
  await expect(page.getByRole('button', { name: '移除插件', exact: true })).toBeVisible()
  expect(
    await page
      .locator('.plugin-detail')
      .evaluate((element) => element.scrollWidth <= element.clientWidth),
  ).toBe(true)
})

test('new installation opens information details; late and broken logos preserve fallback and focus', async ({
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
  await expect(
    target.locator('[data-plugin-action="approve"], [data-plugin-action="enable"]'),
  ).toHaveCount(0)
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
  await expect(card.getByRole('switch')).toBeFocused()
  await expect(page.locator('.plugin-detail')).toHaveCount(0)
  await card.getByRole('switch').click()
  await expect(card.getByRole('switch')).toHaveAttribute('aria-checked', 'false')
  await expect(
    page.locator('.plugin-summary-card[data-plugin-id="cards.alpha"]').getByRole('switch'),
  ).toBeEnabled()
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

for (const theme of ['light', 'dark'])
  for (const width of [1100, 390])
    test(`beta4 card controls fit ${theme} ${width} and retain menu focus`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width, height: 900 })
      await seed(page)
      await page.evaluate(async (theme) => {
        const { renderDesktopPluginManagerElement } = await import(
          /* @vite-ignore */ '/src/desktop-plugin-manager-ui.ts'
        )
        document.documentElement.dataset.theme = theme
        const original = document.querySelector('[data-plugin-manager]')!
        const target = document.createElement('div')
        target.id = 'card-visual-fixture'
        original.replaceWith(target)
        const record = {
          manifest: {
            id: 'visual.tools',
            name: '文档工具 · Document tools',
            description: '在卡片打开控制面板或执行插件命令，所有操作保持清晰可达。',
            version: '1.0.0',
            main: './plugin.js',
            contributes: {
              commands: [{ id: 'visual.run', title: '整理当前文档', action: 'visual.run' }],
            },
          },
          manifestPath: '/plugins/visual/plugin.json',
          rootPath: '/plugins/visual',
          sourcePath: '/visual.milkup-plugin',
          state: 'enabled',
          enabled: true,
          installedAt: 1,
          updatedAt: 1,
          trust: 'development',
          dataRoot: '/data',
          storageRoot: '/storage',
          approvals: { hosts: ['worker'], permissions: [] },
          errors: [],
        }
        const state = {
          records: [
            record,
            {
              ...record,
              manifest: { ...record.manifest, id: 'visual.other', name: '未启用插件' },
              state: 'disabled',
              enabled: false,
            },
          ],
          contributions: {
            commands: [{ id: 'visual.run', title: '整理当前文档', category: 'plugin', run() {} }],
            ui: [{ pluginId: 'visual.tools', id: 'panel', title: '控制面板', slot: 'modal' }],
            keymaps: [],
            renderers: [],
            markdownSyntax: [],
            importers: [],
            documentTypes: [],
          },
          auditCount: 0,
          auditRecords: [],
          installFailures: [],
        }
        renderDesktopPluginManagerElement(target, state)
        ;(window as any).repaintCardFixture = () =>
          renderDesktopPluginManagerElement(target, { ...state })
      }, theme)
      const card = page.locator('.plugin-summary-card[data-plugin-id="visual.tools"]')
      await expect(card.getByRole('button', { name: '控制面板', exact: true })).toBeVisible()
      const toggle = card.getByRole('switch')
      await toggle.focus()
      await expect(toggle).toBeFocused()
      expect(await toggle.evaluate((element) => element.getBoundingClientRect().width)).toBe(44)
      const summary = card.locator('summary')
      await summary.click()
      const reload = card.locator('[data-plugin-action="reload"]')
      await page.keyboard.press('Tab')
      await expect(reload).toBeFocused()
      await page.evaluate(() => (window as any).repaintCardFixture())
      await expect(reload).toBeFocused()
      await expect(card.locator('[data-plugin-card-more]')).toHaveAttribute('open', '')
      for (const selector of ['.plugin-summary-card', '.plugin-card-menu']) {
        for (const item of await page.locator(selector).all()) {
          const box = (await item.boundingBox())!
          expect(box.x).toBeGreaterThanOrEqual(0)
          expect(box.x + box.width).toBeLessThanOrEqual(width + 1)
          expect(await item.evaluate((e) => e.scrollWidth <= e.clientWidth + 1)).toBe(true)
        }
      }
      await testInfo.attach(`cards-${theme}-${width}`, {
        body: await page.screenshot({ path: testInfo.outputPath(`cards-${theme}-${width}.png`) }),
        contentType: 'image/png',
      })
      await page.keyboard.press('Escape')
      await expect(summary).toBeFocused()
      await expect(card.locator('[data-plugin-card-more]')).not.toHaveAttribute('open', '')
      await expect(page.locator('[data-app-menu]')).toBeVisible()
      await card.getByRole('button', { name: '文档工具 · Document tools 详情' }).click()
      await expect(page.getByRole('heading', { name: '文档工具 · Document tools' })).toBeFocused()
      await testInfo.attach(`details-${theme}-${width}`, {
        body: await page.screenshot({ path: testInfo.outputPath(`details-${theme}-${width}.png`) }),
        contentType: 'image/png',
      })
    })

test('beta4 card icons open the actual Worker panel and invoke its command', async ({ page }) => {
  await seed(
    page,
    `let runs=0; export default { commands:{'cards.run':()=>{runs++}}, renderers:{panel:()=>({type:'element',tag:'span',text:'Runs '+runs})} }`,
    true,
  )
  const card = page.locator('.plugin-summary-card[data-plugin-id="cards.beta"]')
  await card.getByRole('switch').click()
  await expect(card.getByRole('switch')).toHaveAttribute('aria-checked', 'true')
  const panel = card.locator('[data-plugin-action="open-ui"]')
  await panel.locator('svg').click()
  await expect(page.locator('.plugin-ui-modal')).toContainText('Runs 0')
  await page.keyboard.press('Escape')
  await expect(panel).toBeFocused()
  await expect(page.locator('[data-app-menu]')).toBeVisible()
  await card.locator('summary svg').click()
  await card.locator('[data-plugin-command="cards.run"] svg').click()
  await panel.locator('svg').click()
  await expect(page.locator('.plugin-ui-modal')).toContainText('Runs 1')
  await page.keyboard.press('Escape')
  await expect(panel).toBeFocused()
  await expect(page.locator('[data-plugin-menu-group], [data-plugin-menu-entry]')).toHaveCount(0)
})

test('beta4 trusted Worker upgrade stays on its card while a candidate is staged', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 760, height: 850 })
  await seed(page)
  await page.evaluate(async () => {
    const { renderDesktopPluginManagerElement } = await import(
      /* @vite-ignore */ '/src/desktop-plugin-manager-ui.ts'
    )
    const target = document.createElement('div')
    target.id = 'upgrade-card-fixture'
    document.querySelector('[data-plugin-manager]')!.replaceWith(target)
    const manifest = {
      id: 'upgrade.fixture',
      name: '文档图表',
      version: '1.0.0',
      host: 'dom',
      main: './plugin.js',
    }
    const offer = {
      ...manifest,
      version: '2.0.0',
      host: 'worker',
      description: '仅提供受限的静态文档呈现。',
    }
    const record = {
      manifest,
      manifestPath: '/plugins/upgrade/plugin.json',
      rootPath: '/plugins/upgrade',
      sourcePath: 'bundled:/upgrade',
      state: 'disabled',
      enabled: false,
      installedAt: 1,
      updatedAt: 1,
      trust: 'development',
      dataRoot: '/data',
      storageRoot: '/storage',
      approvals: { hosts: ['dom'], permissions: [] },
      errors: [],
    }
    const state = {
      records: [record],
      bundledUpgradeOffers: { 'upgrade.fixture': offer },
      contributions: {
        commands: [],
        ui: [],
        keymaps: [],
        renderers: [],
        markdownSyntax: [],
        importers: [],
        documentTypes: [],
      },
      auditCount: 0,
      auditRecords: [],
      installFailures: [],
    }
    renderDesktopPluginManagerElement(target, state)
    ;(window as any).stageUpgradeFixture = () =>
      renderDesktopPluginManagerElement(target, {
        ...state,
        bundledUpgradeOffers: {},
        catalogEntries: [
          {
            id: 'upgrade.fixture',
            revision: 2,
            active: null,
            previous: null,
            pending: {
              transactionId: 'upgrade-staging',
              phase: 'prepared',
              restoreEnabled: false,
              generation: {
                id: 'new',
                manifest: offer,
                capabilityFingerprint: 'new',
                approvedFingerprint: null,
                verified: false,
                sourcePath: 'bundled:/upgrade',
                packageRoot: '/upgrade',
                manifestSha256: 'a',
                contentSha256: 'b',
              },
            },
            enabled: false,
            tombstone: false,
            startAttempt: null,
            dataRoot: '/data',
            storageRoot: '/storage',
            diagnostics: [],
          },
        ],
      })
  })
  const target = page.locator('#upgrade-card-fixture')
  const toggle = target.getByRole('switch')
  await expect(toggle).toBeEnabled()
  await expect(target).toContainText('2.0.0 · Worker · 下次开启时应用')
  await expect(target).toContainText('仅提供受限的静态文档呈现。')
  await target.locator('[data-plugin-action="install"]').focus()
  await page.keyboard.press('Tab')
  await expect(toggle).toBeFocused()
  await page.screenshot({ path: testInfo.outputPath('bundled-worker-upgrade.png') })
  await page.evaluate(() => (window as any).stageUpgradeFixture())
  await expect(toggle).toBeFocused()
  await expect(target.locator('.plugin-summary-card')).toHaveCount(1)
  await expect(target.locator('.plugin-detail')).toHaveCount(0)
})

async function mountStableCards(page: Page): Promise<void> {
  await page.goto('/')
  await page.evaluate(async () => {
    const { renderDesktopPluginManagerElement } = await import(
      /* @vite-ignore */ '/src/desktop-plugin-manager-ui.ts'
    )
    const target = document.createElement('div')
    target.id = 'stable-cards-fixture'
    target.style.cssText = 'position:fixed;inset:20px;z-index:10000;overflow:auto;background:white'
    document.body.append(target)
    const records = Array.from({ length: 18 }, (_, index) => ({
      manifest: { id: `stable.${index}`, name: `Stable ${index}`, version: '1.0.0' },
      manifestPath: `/plugins/${index}/plugin.json`,
      rootPath: `/plugins/${index}`,
      sourcePath: `/plugins/${index}/plugin.json`,
      state: 'disabled',
      enabled: false,
      installedAt: 1,
      updatedAt: 1,
      trust: 'development',
      dataRoot: '/data',
      storageRoot: '/storage',
      approvals: { permissions: [], hosts: ['worker'] },
      errors: [],
    }))
    const state = {
      records,
      contributions: {
        commands: [],
        ui: [],
        keymaps: [],
        renderers: [],
        markdownSyntax: [],
        importers: [],
        documentTypes: [],
      },
      auditCount: 0,
      auditRecords: [],
      installFailures: [],
    }
    renderDesktopPluginManagerElement(target, state)
    ;(window as any).stableCards = {
      target,
      state,
      original: Array.from(target.querySelectorAll('.plugin-summary-card')),
      notify: (next: any) => renderDesktopPluginManagerElement(target, next),
    }
  })
}

test('beta5 status notifications retain card nodes, order, scroll, focus and an open menu', async ({
  page,
}) => {
  await mountStableCards(page)
  const result = await page.evaluate(async () => {
    const f = (window as any).stableCards
    const card = f.original[10] as HTMLElement
    const toggle = card.querySelector<HTMLButtonElement>('[role="switch"]')!
    const more = card.querySelector<HTMLDetailsElement>('details')!
    const exportButton = card.querySelector('[data-plugin-action="export"]')!
    more.open = true
    toggle.focus()
    const top = f.target.scrollTop
    const y = toggle.getBoundingClientRect().top
    let detachedCards = 0
    const observer = new MutationObserver((changes) => {
      for (const change of changes)
        for (const removed of change.removedNodes)
          if (f.original.some((node: Node) => removed === node || removed.contains(node)))
            detachedCards++
    })
    observer.observe(f.target, { childList: true, subtree: true })
    // Native catalog projection may reorder active/pending records on every publication.
    // Exercise enable, asynchronous failure, retry, and an unrelated notification.
    for (const [enabled, errors] of [
      [true, []],
      [false, ['activation failed']],
      [true, []],
      [true, []],
    ] as const) {
      f.notify({
        ...f.state,
        records: [...f.state.records]
          .reverse()
          .map((record: any) =>
            record.manifest.id === 'stable.10'
              ? { ...record, enabled, state: enabled ? 'enabled' : 'failed', errors }
              : record,
          ),
        diagnostics: errors,
        installFailures: errors.length
          ? [{ sourcePath: '/background.milkup-plugin', at: 42, message: 'background failure' }]
          : [],
      })
      await Promise.resolve()
    }
    observer.disconnect()
    return {
      sameCards: f.original.every(
        (node: Element, index: number) =>
          node === f.target.querySelectorAll('.plugin-summary-card')[index],
      ),
      sameToggle: toggle === f.target.querySelector('[data-plugin-id="stable.10"] [role="switch"]'),
      sameExport:
        exportButton ===
        f.target.querySelector('[data-plugin-id="stable.10"] [data-plugin-action="export"]'),
      detachedCards,
      focused: document.activeElement === toggle,
      sameScroll: top === f.target.scrollTop,
      samePosition: y === toggle.getBoundingClientRect().top,
      open: more.open && more.isConnected,
      checked: toggle.getAttribute('aria-checked'),
      count: f.target.querySelectorAll('.plugin-summary-card').length,
    }
  })
  expect(result).toEqual({
    sameCards: true,
    sameToggle: true,
    sameExport: true,
    detachedCards: 0,
    focused: true,
    sameScroll: true,
    samePosition: true,
    open: true,
    checked: 'true',
    count: 18,
  })
})

test('beta5 detail notifications retain heading, focus and the currently selected plugin', async ({
  page,
}) => {
  await mountStableCards(page)
  await page
    .locator('#stable-cards-fixture [data-plugin-id="stable.10"] [data-plugin-action="details"]')
    .click()
  const result = await page.evaluate(() => {
    const f = (window as any).stableCards
    const detail = f.target.querySelector('.plugin-detail')!
    const heading = f.target.querySelector('#plugin-detail-title')!
    const exportButton = detail.querySelector('[data-plugin-action="export"]')!
    ;(exportButton as HTMLElement).focus()
    const top = f.target.scrollTop
    f.notify({
      ...f.state,
      records: [...f.state.records]
        .reverse()
        .map((record: any) =>
          record.manifest.id === 'stable.10'
            ? { ...record, state: 'failed', errors: ['asynchronous teardown failed'] }
            : record,
        )
        .concat({
          ...f.state.records[0],
          manifest: { id: 'stable.new', name: 'New', version: '1.0.0' },
        }),
      // Background candidate/failure notifications must not replace this detail.
      catalogEntries: [
        {
          id: 'stable.2',
          pending: {
            transactionId: 'background-candidate',
            generation: { manifest: { id: 'stable.2', name: 'Stable 2', version: '2.0.0' } },
          },
        },
      ],
      installFailures: [
        { sourcePath: '/background.milkup-plugin', at: 42, message: 'background failure' },
      ],
    })
    return {
      sameDetail: detail === f.target.querySelector('.plugin-detail'),
      sameHeading: heading === f.target.querySelector('#plugin-detail-title'),
      sameExport: exportButton === f.target.querySelector('[data-plugin-action="export"]'),
      focused: document.activeElement === exportButton,
      sameScroll: top === f.target.scrollTop,
      title: heading.textContent,
      error: f.target.querySelector('.plugin-errors')?.textContent,
    }
  })
  expect(result).toEqual({
    sameDetail: true,
    sameHeading: true,
    sameExport: true,
    focused: true,
    sameScroll: true,
    title: 'Stable 10',
    error: 'asynchronous teardown failed',
  })
})

test('beta5 rapid real card switches retain their DOM nodes after asynchronous activation failure', async ({
  page,
}) => {
  await seed(
    page,
    'export default { async activate() { await new Promise(r => setTimeout(r, 80)); throw new Error("activation failed"); } }',
  )
  const card = page.locator('.plugin-summary-card[data-plugin-id="cards.beta"]')
  await card.evaluate((element) => {
    ;(window as any).originalCard = element
    ;(window as any).originalSwitch = element.querySelector('[role="switch"]')
    const toggle = (window as any).originalSwitch as HTMLButtonElement
    toggle.focus()
    toggle.click()
    toggle.click()
    toggle.click()
  })
  await expect(card.locator('.plugin-card-error')).toBeVisible()
  expect(
    await card.evaluate((element) => ({
      sameCard: element === (window as any).originalCard,
      sameSwitch: element.querySelector('[role="switch"]') === (window as any).originalSwitch,
      focused: document.activeElement === (window as any).originalSwitch,
    })),
  ).toEqual({ sameCard: true, sameSwitch: true, focused: true })
  await expect(card.getByRole('switch')).toHaveAttribute('aria-checked', 'false')
  await expect(page.locator('.plugin-summary-card')).toHaveCount(2)
})

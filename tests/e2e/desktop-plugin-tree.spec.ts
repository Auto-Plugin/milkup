import { expect, test, type Page } from '@playwright/test'
import { resolve } from 'node:path'

type Call = { command: string; trusted: boolean; type?: string; key?: string }
type FixtureWindow = Window & {
  treeFixture: {
    calls: Call[]
    states: { phase: string; visible: unknown }[]
    refresh(remove?: boolean): Promise<void>
  }
}

async function mountTree(page: Page): Promise<void> {
  await page.route('**/__controlled-tree-test', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><html><head><link rel="stylesheet" href="/src/style.css"></head><body><main id="fixture" style="width:100%;max-width:360px;height:480px;padding:12px;box-sizing:border-box"><button id="outside">Outside</button><div data-plugin-slot="sidebar-panel"></div></main></body></html>',
    }),
  )
  await page.goto('/__controlled-tree-test')
  await page.evaluate(async () => {
    const source = '/src/desktop-plugin-ui.ts'
    const { DesktopPluginUiController } = await import(/* @vite-ignore */ source)
    let expanded = false
    let removed = false
    let suffix = 0
    const calls: Call[] = []
    const states: { phase: string; visible: unknown }[] = []
    const element = (tag: string, attributes: Record<string, string>, children: unknown[]) => ({
      type: 'element',
      tag,
      attributes,
      children,
    })
    const button = (label: string, command: string, attributes: Record<string, string> = {}) => ({
      type: 'element',
      tag: 'button',
      text: label,
      attributes: { 'aria-label': label, ...attributes },
      action: { command },
    })
    const rows = () => [
      button('docs', 'fixture.toggle', {
        role: 'treeitem',
        'aria-level': '1',
        'aria-expanded': String(expanded),
        class: 'plugin-tree-item',
      }),
      ...(expanded && !removed
        ? [
            button('docs/repeated.md', 'fixture.open', {
              role: 'treeitem',
              'aria-level': '2',
              class: 'plugin-tree-item',
            }),
          ]
        : []),
      button('very-long-directory/another-directory/repeated.md', 'fixture.open', {
        role: 'treeitem',
        'aria-level': '1',
        class: 'plugin-tree-item',
      }),
      button('最后一个文档.md', 'fixture.open', {
        role: 'treeitem',
        'aria-level': '1',
        class: 'plugin-tree-item',
      }),
    ]
    const controller = new DesktopPluginUiController(document.querySelector('#fixture'), {
      contributions: () => ({
        commands: [],
        keymaps: [],
        renderers: [],
        markdownSyntax: [],
        importers: [],
        documentTypes: [],
        ui: [
          {
            pluginId: 'fixture',
            id: 'tree',
            title: 'Navigation',
            slot: 'sidebar-panel',
            scope: 'app',
            viewportUpdates: false,
          },
        ],
      }),
      resolveCommand: (id: string, command: string) =>
        id === 'fixture:tree' &&
        ['fixture.toggle', 'fixture.open', 'fixture.more'].includes(command)
          ? command
          : undefined,
      runCommand: (command: string, _input: unknown, event?: Event) => {
        calls.push({
          command,
          trusted: event?.isTrusted === true,
          ...(event ? { type: event.type, key: (event as KeyboardEvent).key } : {}),
        })
        if (command === 'fixture.toggle') {
          expanded = !expanded
          void controller.invalidate('fixture', 'tree')
        }
      },
      renderUi: async (
        _plugin: string,
        _view: string,
        phase: string,
        state: Record<string, unknown>,
      ) => {
        states.push({ phase, visible: state.visible })
        // Real delayed output exercises focus restoration across an asynchronous render.
        if (phase === 'update') await new Promise((resolve) => setTimeout(resolve, 30))
        return element('span', { class: 'plugin-list-panel plugin-navigation-panel' }, [
          element('span', { class: 'plugin-tree-toolbar plugin-actions' }, [
            button('Refresh navigation contents', 'fixture.more', {
              class: 'dialog-button secondary',
            }),
          ]),
          element('span', { class: 'plugin-list-summary' }, [`Ready ${suffix}`]),
          element('span', { role: 'tree', 'aria-label': 'Files', class: 'plugin-tree-list' }, [
            ...rows(),
            button('Load more', 'fixture.more', { class: 'dialog-button secondary' }),
          ]),
        ])
      },
    })
    await controller.sync('doc')
    Object.assign(window, {
      treeFixture: {
        calls,
        states,
        refresh: async (remove = false) => {
          removed = remove
          suffix++
          await controller.invalidate('fixture', 'tree')
        },
      },
    })
  })
}

async function calls(page: Page): Promise<Call[]> {
  return page.evaluate(
    () => (window as unknown as { treeFixture: { calls: Call[] } }).treeFixture.calls,
  )
}

test('controlled trees navigate visible items and preserve focus through asynchronous refresh', async ({
  page,
}) => {
  await mountTree(page)
  const docs = page.getByRole('treeitem', { name: 'docs', exact: true })
  await docs.focus()
  await page.keyboard.press('ArrowRight')
  await expect(docs).toHaveAttribute('aria-expanded', 'true')
  await expect(docs).toBeFocused()
  await page.keyboard.press('ArrowRight')
  const child = page.getByRole('treeitem', { name: 'docs/repeated.md', exact: true })
  await expect(child).toBeFocused()
  await page.evaluate(async () => {
    await (window as FixtureWindow).treeFixture.refresh()
  })
  await expect(child).toBeFocused()
  await page.evaluate(async () => {
    await (window as FixtureWindow).treeFixture.refresh(true)
  })
  await expect(
    page.getByRole('treeitem', {
      name: 'very-long-directory/another-directory/repeated.md',
      exact: true,
    }),
  ).toBeFocused()
  await page.keyboard.press('End')
  await expect(page.getByRole('treeitem', { name: '最后一个文档.md', exact: true })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(page.getByRole('button', { name: 'Load more' })).toBeFocused()
  await page.locator('#outside').focus()
  await page.evaluate(async () => {
    await (window as FixtureWindow).treeFixture.refresh()
  })
  await expect(page.locator('#outside')).toBeFocused()
  expect(await calls(page)).toEqual([
    { command: 'fixture.toggle', trusted: true, type: 'keydown', key: 'ArrowRight' },
  ])
  await expect(page.locator('[role="treeitem"][tabindex="0"]')).toHaveCount(1)
})

test('collapsing a controlled panel reports visibility and keeps its keyboard return point', async ({
  page,
}) => {
  await mountTree(page)
  const toggle = page.getByRole('button', { name: 'Navigation', exact: true })
  await toggle.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('tree')).toBeHidden()
  await expect(toggle).toBeFocused()
  expect(
    await page.evaluate(
      () =>
        (window as FixtureWindow).treeFixture.states
          .filter((state) => state.phase === 'update')
          .at(-1)?.visible,
    ),
  ).toBe(false)
  await page.keyboard.press('Enter')
  await expect(page.getByRole('tree')).toBeVisible()
  await expect(toggle).toBeFocused()
  expect(
    await page.evaluate(
      () =>
        (window as FixtureWindow).treeFixture.states
          .filter((state) => state.phase === 'update')
          .at(-1)?.visible,
    ),
  ).toBe(true)
})

test('only the same synchronous native button action receives its trusted click or keydown', async ({
  page,
}) => {
  await mountTree(page)
  const docs = page.getByRole('treeitem', { name: 'docs', exact: true })
  await docs.click()
  await expect(docs).toHaveAttribute('aria-expanded', 'true')
  await page.keyboard.press('ArrowLeft')
  await expect(docs).toHaveAttribute('aria-expanded', 'false')
  await page.keyboard.press('Enter')
  await expect(docs).toHaveAttribute('aria-expanded', 'true')
  await page.keyboard.press('Space')
  await expect(docs).toHaveAttribute('aria-expanded', 'false')
  expect((await calls(page)).map((call) => [call.trusted, call.type, call.key])).toEqual([
    [true, 'click', undefined],
    [true, 'keydown', 'ArrowLeft'],
    [true, 'click', undefined],
    [true, 'click', undefined],
  ])
  const leaf = page.getByRole('treeitem', { name: '最后一个文档.md', exact: true })
  await leaf.evaluate((button) => {
    const detail = {
      rendererId: 'fixture:tree',
      command: 'fixture.open',
      input: {},
      trusted: true,
      isTrusted: true,
    }
    button.dispatchEvent(
      new CustomEvent('milkup-plugin-renderer-action', { bubbles: true, detail }),
    )
    ;(button as HTMLButtonElement).click()
    button.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    button.dispatchEvent(
      new CustomEvent('milkup-plugin-renderer-action', {
        bubbles: true,
        detail: { ...detail, rendererId: 'other:tree' },
      }),
    )
  })
  expect((await calls(page)).slice(4)).toEqual([
    { command: 'fixture.open', trusted: false },
    { command: 'fixture.open', trusted: false },
  ])
  // A different button cannot consume a real click's proof during the same dispatch.
  await leaf.evaluate((button) => {
    button.addEventListener(
      'click',
      () => {
        document.querySelector('[aria-label="docs"]')!.dispatchEvent(
          new CustomEvent('milkup-plugin-renderer-action', {
            bubbles: true,
            detail: { rendererId: 'fixture:tree', command: 'fixture.open', input: {} },
          }),
        )
      },
      { capture: true, once: true },
    )
  })
  await leaf.click()
  expect((await calls(page)).slice(-2)).toEqual([
    { command: 'fixture.open', trusted: false },
    { command: 'fixture.open', trusted: true, type: 'click' },
  ])
  await leaf.evaluate((button) =>
    button.dispatchEvent(
      new CustomEvent('milkup-plugin-renderer-action', {
        bubbles: true,
        detail: { rendererId: 'fixture:tree', command: 'fixture.open', input: {}, isTrusted: true },
      }),
    ),
  )
  expect((await calls(page)).at(-1)).toEqual({ command: 'fixture.open', trusted: false })
})

for (const theme of ['light', 'dark']) {
  test(`controlled navigation remains visible and keyboard usable in ${theme} at narrow 200% CSS zoom`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 420, height: 760 })
    await mountTree(page)
    await page.evaluate((theme) => {
      document.documentElement.dataset.theme = theme
      document.documentElement.style.zoom = '2'
    }, theme)
    const docs = page.getByRole('treeitem', { name: 'docs', exact: true })
    await docs.focus()
    await page.keyboard.press('ArrowDown')
    const long = page.getByRole('treeitem', {
      name: 'very-long-directory/another-directory/repeated.md',
      exact: true,
    })
    await expect(long).toBeFocused()
    await expect(long).toBeInViewport()
    const metrics = await long.evaluate((row) => ({
      outline: getComputedStyle(row).outlineStyle,
      rowWidth: row.getBoundingClientRect().width,
      viewportWidth: window.innerWidth,
      treeOverflow: row.parentElement!.scrollWidth - row.parentElement!.clientWidth,
    }))
    expect(metrics.outline).toBe('solid')
    expect(metrics.rowWidth).toBeLessThanOrEqual(metrics.viewportWidth)
    expect(metrics.treeOverflow).toBeLessThanOrEqual(1)
    await page.keyboard.press('End')
    await expect(page.getByRole('treeitem', { name: '最后一个文档.md' })).toBeInViewport()
  })
}

for (const theme of ['light', 'dark'])
  for (const viewport of [
    { width: 1100, height: 760 },
    { width: 760, height: 520 },
  ])
    for (const recentCount of [3, 20])
      test(`navigation secondary list ${theme} ${viewport.width} with ${recentCount} recent rows preserves the primary tree`, async ({
        page,
      }) => {
        await page.setViewportSize(viewport)
        await page.route('**/__navigation-layout-test', (route) =>
          route.fulfill({
            contentType: 'text/html',
            body: '<!doctype html><html><head><link rel="stylesheet" href="/src/style.css"></head><body><main id="fixture" style="display:flex;flex-direction:column;width:165px;height:calc(100vh - 64px)"><div data-plugin-slot="sidebar-panel"></div></main></body></html>',
          }),
        )
        await page.goto('/__navigation-layout-test')
        await page.evaluate(
          async ({ theme, recentCount, pluginSource }) => {
            document.documentElement.dataset.theme = theme
            const controllerSource = '/src/desktop-plugin-ui.ts'
            const { DesktopPluginUiController } = await import(/* @vite-ignore */ controllerSource)
            const { render } = await import(/* @vite-ignore */ pluginSource)
            const state = {
              root: { id: 'root', key: 'key', label: 'Project Unicode' },
              phase: 'idle',
              directories: new Map([
                [
                  '',
                  {
                    loaded: true,
                    expanded: true,
                    cursor: null,
                    entries: Array.from({ length: 24 }, (_, n) => ({
                      id: `entry-${n}`,
                      name: `document-${n}.md`,
                      relativePath: `document-${n}.md`,
                      kind: 'file',
                    })),
                  },
                ],
              ]),
              recent: Array.from({ length: recentCount }, (_, n) => `recent-document-${n}.md`),
            }
            const controller = new DesktopPluginUiController(document.querySelector('#fixture'), {
              contributions: () => ({
                commands: [],
                keymaps: [],
                renderers: [],
                markdownSyntax: [],
                importers: [],
                documentTypes: [],
                ui: [
                  {
                    pluginId: 'layout',
                    id: 'other',
                    title: 'Another panel',
                    slot: 'sidebar-panel',
                    scope: 'app',
                  },
                  {
                    pluginId: 'layout',
                    id: 'navigation',
                    title: 'Navigation',
                    slot: 'sidebar-panel',
                    scope: 'app',
                  },
                ],
              }),
              resolveCommand: () => undefined,
              runCommand: () => {},
              renderUi: async (_plugin: string, view: string) =>
                view === 'navigation' ? render(state) : 'Another independently sized panel',
            })
            await controller.sync('doc')
          },
          { theme, recentCount, pluginSource: '/@fs' + resolve('plugins/workspace/src/plugin.ts') },
        )
        const tree = page.getByRole('tree', { name: '工作区文件' })
        const secondary = page.locator('[aria-label="最近文件"]')
        const dimensions = await secondary.evaluate((element) => {
          const root = element.closest('.plugin-navigation-panel')!
          const tree = root.querySelector('[role="tree"]')!
          return {
            panel: root.clientHeight,
            tree: tree.getBoundingClientRect().height,
            secondary: element.getBoundingClientRect().height,
            padding: getComputedStyle(element).paddingBlockStart,
            secondaryScrollable: element.scrollHeight > element.clientHeight,
            panelScrollable: root.scrollHeight > root.clientHeight,
          }
        })
        await page.screenshot({ path: test.info().outputPath('navigation-layout.png') })
        await test.info().attach('navigation-dimensions', {
          body: JSON.stringify(dimensions),
          contentType: 'application/json',
        })
        expect(dimensions.padding, JSON.stringify(dimensions)).toBe('0px')
        expect(dimensions.tree, JSON.stringify(dimensions)).toBeGreaterThanOrEqual(84)
        expect(dimensions.tree, JSON.stringify(dimensions)).toBeGreaterThan(dimensions.secondary)
        expect(dimensions.secondary, JSON.stringify(dimensions)).toBeLessThanOrEqual(
          Math.min(168, dimensions.panel * 0.3) + 1,
        )
        if (recentCount === 20) expect(dimensions.secondaryScrollable).toBe(true)
        await tree.getByRole('treeitem').first().focus()
        await page.keyboard.press('End')
        await expect(tree.getByRole('treeitem').last()).toBeFocused()
        await expect(tree.getByRole('treeitem').last()).toBeInViewport()
        const recent = secondary.getByRole('button')
        await recent.nth(recentCount - 2).focus()
        await page.keyboard.press('Tab')
        await expect(recent.last()).toBeFocused()
        await expect(recent.last()).toBeInViewport()
        await page.getByRole('button', { name: '选择工作区文件夹' }).focus()
        await expect(page.getByRole('button', { name: '选择工作区文件夹' })).toBeInViewport()
      })

import { expect, test } from '@playwright/test'

// Component integration in a real browser. Native persistence and OS associations
// are separate native tests; this fixture does not claim a running installed app.
async function themeFixture(page: import('@playwright/test').Page) {
  await page.route('**/theme-component-check', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><html><head><meta charset="utf-8"></head><body><div id="panel"></div><p id="outside">Host controls remain outside theme selectors</p><div class="milkup-editor" style="font-size:14px;line-height:21px;font-family:monospace"><div class="milkup-line milkup-block-heading">Real editor heading</div><div class="milkup-block-code">const keep = true</div></div></body></html>',
    }),
  )
  await page.goto('/theme-component-check')
  await page.evaluate(async () => {
    const load = (path: string) => import(path)
    const [{ createThemeStyleController }, { createAppearancePanel }] = await Promise.all([
      load('/src/appearance-theme.ts'),
      load('/src/appearance-panel.ts'),
    ])
    const { default: defaults } = await load('/src/appearance-default.css?raw')
    const css = `:root{--panel-bg:#fff5e9;--text:#302719;--code-bg:#f0dec6;--theme-link:#735000;--link:var(--theme-link)}:root[data-theme="dark"]{--panel-bg:#181c26;--text:#e2e8f7;--code-bg:#263047;--theme-link:#acbdff}.milkup-editor{font-size:18px;line-height:27px}.milkup-block-heading{font-family:serif;color:var(--link)}.milkup-block-code{font-family:monospace;border-left-color:var(--link)}`
    let mode = 'system'
    let chosen: string | null = '/tmp/真实 空格.css'
    let error: string | undefined
    let pickerFailure = false
    let modeFailure = false
    const file = (text: string, custom = false) => ({
      revision: custom ? 'custom' : 'default',
      name: custom ? '暖色纸张' : '系统默认主题',
      text,
      defaultText: defaults,
      path: custom ? '/tmp/真实 空格.css' : '/tmp/default.css',
      isDefault: !custom,
    })
    const style = document.createElement('style')
    document.head.append(style)
    const theme = createThemeStyleController({
      supports: (p: string, v: string) => CSS.supports(p, v),
      apply: (result: { css: string }) => {
        style.textContent = result.css
      },
      backend: {
        load: async () => file(defaults),
        readCandidate: async () => ({
          text: error ?? css,
          name: '暖色纸张',
          sourceDigest: 'fixture',
        }),
        commitCandidate: async () => file(css, true),
        reset: async () => file(defaults),
        openCurrent: async () => ({ status: 'requested', path: '/tmp/真实 空格.css' }),
      },
    })
    const system = matchMedia('(prefers-color-scheme: dark)')
    const refresh = () => {
      document.documentElement.dataset.theme =
        mode === 'system' ? (system.matches ? 'dark' : 'light') : mode
    }
    const panel = createAppearancePanel({
      container: document.querySelector('#panel'),
      styles: theme,
      getMode: () => mode,
      changeMode: async (next: string) => {
        if (modeFailure) throw new Error('mode & <failed>')
        mode = next
        refresh()
      },
      chooseFile: async () => {
        if (pickerFailure) throw new Error('picker & <failed>')
        return chosen
      },
      native: true,
    })
    system.addEventListener('change', refresh)
    refresh()
    await theme.ready
    Object.assign(window, {
      themeProbe: {
        theme,
        panel,
        failPicker: () => {
          pickerFailure = true
        },
        failMode: () => {
          modeFailure = true
        },
        cancel: () => {
          chosen = null
        },
        malformed: () => {
          error = 'p{background:u\\72l("https://example.invalid/leak")}'
          chosen = '/tmp/bad.css'
        },
      },
    })
  })
  await expect(page.locator('iframe')).toHaveCount(4)
  await expect(page.locator('[data-theme-import]')).toBeEnabled()
}

test('actual theme CSS paints both editor previews, system blend, and live content without changing host selectors', async ({
  page,
}) => {
  await themeFixture(page)
  await page.getByRole('button', { name: '导入 CSS', exact: true }).click()
  await expect(page.locator('[data-theme-name]')).toHaveText('暖色纸张')
  await expect(page.locator('body > .milkup-editor .milkup-block-code')).toHaveCSS(
    'font-size',
    '18px',
  )
  await expect(page.locator('body > .milkup-editor')).toHaveCSS('line-height', '27px')
  const frames = page.locator('iframe')
  await expect(frames.nth(0).contentFrame().locator('.milkup-editor')).toHaveCSS(
    'background-color',
    'rgb(255, 245, 233)',
  )
  await expect(frames.nth(1).contentFrame().locator('.milkup-editor')).toHaveCSS(
    'background-color',
    'rgb(24, 28, 38)',
  )
  await expect(frames.nth(0).contentFrame().locator('.milkup-block-code')).toHaveCSS(
    'font-size',
    '18px',
  )
  await expect(frames.nth(1).contentFrame().locator('.milkup-block-heading')).toHaveCSS(
    'font-family',
    'serif',
  )
  await expect(page.locator('.theme-preview-system iframe').last()).toHaveCSS(
    'mask-image',
    /linear-gradient/,
  )
  expect(
    await frames.nth(0).evaluate((frame) => (frame as HTMLIFrameElement).contentDocument),
  ).toBe(null)
  await page.getByRole('button', { name: '深色', exact: true }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await page.emulateMedia({ colorScheme: 'light' })
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await page.getByRole('button', { name: '系统', exact: true }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await page.emulateMedia({ colorScheme: 'dark' })
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await page.getByRole('button', { name: '浅色', exact: true }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  expect(await page.locator('#outside').evaluate((p) => getComputedStyle(p).fontSize)).toBe('16px')
  await page.screenshot({
    path: '/tmp/milkup-beta7-appearance-browser/actual-theme-previews.png',
    fullPage: true,
  })
})

test('cancel and rejected CSS preserve the current theme; no external request or SVG/script interpolation', async ({
  page,
}) => {
  const external: string[] = []
  page.on('request', (request) => {
    if (/example\.invalid/.test(request.url())) external.push(request.url())
  })
  await themeFixture(page)
  await page.getByRole('button', { name: '导入 CSS', exact: true }).click()
  await expect(page.locator('[data-theme-name]')).toHaveText('暖色纸张')
  await page.evaluate('window.themeProbe.cancel()')
  await page.getByRole('button', { name: '导入 CSS', exact: true }).click()
  await expect(page.locator('[data-theme-name]')).toHaveText('暖色纸张')
  await page.evaluate('window.themeProbe.malformed()')
  await page.getByRole('button', { name: '导入 CSS', exact: true }).click()
  await expect(page.locator('[data-theme-feedback]')).toContainText('不允许函数 url')
  await expect(page.locator('[data-theme-name]')).toHaveText('暖色纸张')
  expect(external).toEqual([])
  for (const action of ['import', 'open', 'reset'])
    await expect(page.locator(`[data-theme-${action}] svg`)).toHaveCount(1)
  await page.getByRole('button', { name: '恢复默认', exact: true }).click()
  await expect(page.locator('[data-theme-name]')).toHaveText('系统默认主题')
})

test('file chooser and mode errors remain visible after busy-state cleanup', async ({ page }) => {
  await themeFixture(page)
  await page.evaluate('window.themeProbe.failPicker()')
  await page.getByRole('button', { name: '导入 CSS', exact: true }).click()
  await expect(page.locator('[data-theme-feedback]')).toContainText('picker & <failed>')
  await expect(page.getByRole('button', { name: '导入 CSS', exact: true })).toBeEnabled()
  await page.evaluate('window.themeProbe.failMode()')
  await page.getByRole('button', { name: '深色', exact: true }).click()
  await expect(page.locator('[data-theme-feedback]')).toContainText('mode & <failed>')
  await expect(page.getByRole('button', { name: '系统', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
})

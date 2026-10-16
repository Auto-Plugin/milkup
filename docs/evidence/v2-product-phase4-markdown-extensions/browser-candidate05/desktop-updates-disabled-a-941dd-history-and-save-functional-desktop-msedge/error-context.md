# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: desktop-updates.spec.ts >> disabled and uninstalled plugin leaves live editing/history and save functional
- Location: tests/e2e/desktop-updates.spec.ts:182:3

# Error details

```
Error: expect(locator).toHaveText(expected) failed

Locator:  locator('.plugin-state')
Expected: "已启用"
Received: "已禁用"
Timeout:  5000ms

Call log:
  - Expect "toHaveText" with timeout 5000ms
  - waiting for locator('.plugin-state')
    8 × locator resolved to <span class="plugin-state" data-state="disabled">已禁用</span>
      - unexpected value "已禁用"

```

```yaml
- text: 已禁用
```

# Test source

```ts
  1   | import { expect, test, type Page } from '@playwright/test'
  2   | import { readFile } from 'node:fs/promises'
  3   | import { resolve } from 'node:path'
  4   | import { build } from 'esbuild'
  5   |
  6   | async function fixture(page: Page, mode = 'valid') {
  7   |   // Real standalone Worker + real public SDK RPC. Only native transport is replaced.
  8   |   const manifest = JSON.parse(await readFile('plugins/updates/plugin.json', 'utf8'))
  9   |   const bundle = await build({
  10  |     entryPoints: ['plugins/updates/src/plugin.ts'],
  11  |     bundle: true,
  12  |     write: false,
  13  |     format: 'esm',
  14  |     platform: 'browser',
  15  |     alias: { '@milkup/plugin-sdk': resolve('packages/plugin-sdk/src/index.js') },
  16  |   })
  17  |   manifest.main = 'data:text/javascript,' + encodeURIComponent(bundle.outputFiles[0]!.text)
  18  |   await page.addInitScript(
  19  |     ({ manifest, mode }) => {
  20  |       const state = { mode, installs: 0, cancels: 0, downloads: 0 }
  21  |       const host = window as unknown as { releaseFixture: typeof state; releaseTransport: unknown }
  22  |       host.releaseFixture = state
  23  |       host.releaseTransport = {
  24  |         async check() {
  25  |           await new Promise((resolve) => setTimeout(resolve, 180))
  26  |           if (state.mode === 'offline') throw Error('检查失败：离线')
  27  |           return {
  28  |             configured: state.mode !== 'unconfigured',
  29  |             channel: 'beta',
  30  |             update: {
  31  |               token: 1,
  32  |               version: '2.0.0-beta.2',
  33  |               notes: '改进编辑\n<script>说明按纯文本展示</script>',
  34  |               date: null,
  35  |             },
  36  |           }
  37  |         },
  38  |         async download(_token: number, progress: (event: unknown) => void) {
  39  |           const run = ++state.downloads
  40  |           for (const received of [2048, 8192]) {
  41  |             progress({
  42  |               phase: 'downloading',
  43  |               received,
  44  |               total: state.mode === 'unknown' ? null : 8192,
  45  |             })
  46  |             await new Promise((resolve) => setTimeout(resolve, 300))
  47  |             if (state.cancels >= run) throw Error('下载取消')
  48  |           }
  49  |           progress({ phase: 'verifying', received: 8192, total: null })
  50  |           if (state.mode === 'signature') throw Error('签名校验失败')
  51  |         },
  52  |         async cancel() {
  53  |           state.cancels++
  54  |         },
  55  |         async install() {
  56  |           state.installs++
  57  |           throw Error('测试安装器失败：保留编辑器')
  58  |         },
  59  |       }
  60  |       const record = {
  61  |         manifest,
  62  |         manifestPath: '/plugins/updates/plugin.json',
  63  |         rootPath: '/plugins/updates',
  64  |         sourcePath: '/plugins/updates/plugin.json',
  65  |         state: 'installed',
  66  |         enabled: false,
  67  |         installedAt: 1,
  68  |         updatedAt: 1,
  69  |         trust: 'development',
  70  |         approvals: { permissions: [], hosts: ['worker'] },
  71  |         errors: [],
  72  |       }
  73  |       localStorage.setItem(
  74  |         'milkup.desktop.plugins.registry.v1',
  75  |         JSON.stringify({ version: 1, records: [record], auditRecords: [] }),
  76  |       )
  77  |     },
  78  |     { manifest, mode },
  79  |   )
  80  |   await page.route(/\/src\/plugin-release-service\.ts(?:\?|$)/, async (route) => {
  81  |     const response = await route.fetch()
  82  |     const body = (await response.text()).replace(
  83  |       'function nativeReleaseTransport() {',
  84  |       'function nativeReleaseTransport() { return window.releaseTransport;',
  85  |     )
  86  |     await route.fulfill({ response, body })
  87  |   })
  88  |   await page.goto('/')
  89  | }
  90  | async function open(page: Page) {
  91  |   await page.getByRole('button', { name: '菜单', exact: true }).click()
  92  |   await page.getByRole('button', { name: '插件', exact: true }).click()
  93  |   await page.getByRole('button', { name: 'Milkup Updates', exact: true }).click()
  94  |   await page.getByRole('button', { name: '批准能力', exact: true }).click()
  95  |   await page.getByRole('button', { name: '启用', exact: true }).click()
> 96  |   await expect(page.locator('.plugin-state')).toHaveText('已启用')
      |                                               ^ Error: expect(locator).toHaveText(expected) failed
  97  |   await page.getByRole('button', { name: '打开 软件更新', exact: true }).click()
  98  |   await expect(page.getByRole('dialog', { name: '软件更新', exact: true })).toBeVisible()
  99  | }
  100 | const modal = (page: Page) => page.getByRole('dialog', { name: '软件更新', exact: true })
  101 | const installCount = (page: Page) =>
  102 |   page.evaluate(
  103 |     () => (window as unknown as { releaseFixture: { installs: number } }).releaseFixture.installs,
  104 |   )
  105 | async function ready(page: Page) {
  106 |   await open(page)
  107 |   await modal(page).getByRole('button', { name: '检查更新', exact: true }).click()
  108 |   await modal(page).getByRole('button', { name: '下载更新', exact: true }).click()
  109 |   await expect(modal(page).getByRole('button', { name: '请求安装更新', exact: true })).toBeVisible()
  110 | }
  111 |
  112 | test('host About has no update feature; public plugin requires approval and owns the UI', async ({
  113 |   page,
  114 | }) => {
  115 |   await fixture(page, 'unconfigured')
  116 |   await page.getByRole('button', { name: '菜单', exact: true }).click()
  117 |   await page.getByRole('button', { name: '关于', exact: true }).click()
  118 |   await expect(page.locator('[data-menu-panel="about"]')).toContainText('2.0.0-beta.1')
  119 |   await expect(page.locator('[data-menu-panel="about"]')).not.toContainText('检查更新')
  120 |   await page.keyboard.press('Escape')
  121 |   await open(page)
  122 |   await modal(page).getByRole('button', { name: '检查更新', exact: true }).click()
  123 |   await expect(modal(page)).toContainText('尚未配置')
  124 |   await expect(modal(page).getByRole('button', { name: '检查更新', exact: true })).toBeFocused()
  125 |   await page.keyboard.press('Escape')
  126 |   await expect(modal(page)).toHaveCount(0)
  127 |   await expect(page.getByRole('button', { name: '打开 软件更新', exact: true })).toBeFocused()
  128 | })
  129 |
  130 | test('plugin shows plain notes and unknown progress; cancellation and retry use guarded release IDs', async ({
  131 |   page,
  132 | }) => {
  133 |   await fixture(page, 'unknown')
  134 |   await open(page)
  135 |   await modal(page).getByRole('button', { name: '检查更新', exact: true }).click()
  136 |   await expect(modal(page)).toContainText('<script>说明按纯文本展示</script>')
  137 |   await expect(modal(page).locator('script')).toHaveCount(0)
  138 |   await modal(page).getByRole('button', { name: '下载更新', exact: true }).click()
  139 |   await expect(modal(page)).toContainText('总大小未知')
  140 |   await modal(page).getByRole('button', { name: '取消下载', exact: true }).click()
  141 |   await expect(modal(page).getByRole('button', { name: '下载更新', exact: true })).toBeVisible()
  142 |   await modal(page).getByRole('button', { name: '下载更新', exact: true }).click()
  143 |   await expect(modal(page).getByRole('button', { name: '请求安装更新', exact: true })).toBeVisible()
  144 |   expect(await installCount(page)).toBe(0)
  145 | })
  146 |
  147 | test('signature failure cannot install and plugin retry succeeds', async ({ page }) => {
  148 |   await fixture(page, 'signature')
  149 |   await open(page)
  150 |   await modal(page).getByRole('button', { name: '检查更新', exact: true }).click()
  151 |   await modal(page).getByRole('button', { name: '下载更新', exact: true }).click()
  152 |   await expect(modal(page).getByRole('alert')).toContainText('签名')
  153 |   await expect(modal(page).getByRole('button', { name: '请求安装更新', exact: true })).toHaveCount(
  154 |     0,
  155 |   )
  156 |   await page.evaluate(() => {
  157 |     ;(window as unknown as { releaseFixture: { mode: string } }).releaseFixture.mode = 'valid'
  158 |   })
  159 |   await modal(page).getByRole('button', { name: '下载更新', exact: true }).click()
  160 |   await expect(modal(page).getByRole('button', { name: '请求安装更新', exact: true })).toBeVisible()
  161 | })
  162 |
  163 | test('even a clean document requires trusted host confirmation; cancel keeps editor and no install', async ({
  164 |   page,
  165 | }) => {
  166 |   await fixture(page)
  167 |   await ready(page)
  168 |   await modal(page).getByRole('button', { name: '请求安装更新', exact: true }).click()
  169 |   await expect(page.locator('[data-close-confirm]')).toBeVisible()
  170 |   await expect(page.locator('.dialog-button[data-close-confirm-action="cancel"]')).toBeFocused()
  171 |   await expect(page.locator('[data-close-confirm-action="discard"]')).toBeHidden()
  172 |   expect(await installCount(page)).toBe(0)
  173 |   await page.keyboard.press('Tab')
  174 |   await expect(page.locator('[data-close-confirm-action="save"]')).toBeFocused()
  175 |   await page.keyboard.press('Escape')
  176 |   await expect(page.locator('[data-close-confirm]')).toBeHidden()
  177 |   await expect(modal(page).getByRole('button', { name: '请求安装更新', exact: true })).toBeVisible()
  178 |   expect(await installCount(page)).toBe(0)
  179 | })
  180 |
  181 | for (const mode of ['source', 'live'])
  182 |   test(`disabled and uninstalled plugin leaves ${mode} editing/history and save functional`, async ({
  183 |     page,
  184 |   }) => {
  185 |     await fixture(page)
  186 |     await open(page)
  187 |     await page.keyboard.press('Escape')
  188 |     await page.getByRole('button', { name: '禁用', exact: true }).click()
  189 |     await expect(page.locator('.plugin-state')).toHaveText('已禁用')
  190 |     await expect(page.getByRole('button', { name: '打开 软件更新', exact: true })).toHaveCount(0)
  191 |     await page.getByRole('button', { name: '移除', exact: true }).click()
  192 |     await expect(page.getByRole('button', { name: 'Milkup Updates', exact: true })).toHaveCount(0)
  193 |     await page.keyboard.press('Escape')
  194 |     await page.keyboard.press(mode === 'source' ? 'Control+1' : 'Control+2')
  195 |     await page.locator('.milkup-editor').click()
  196 |     await page.keyboard.type('preserve document')
```

# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: desktop-formatting.spec.ts >> formatting modal applies headings and links through retained bounded snapshots
- Location: tests/e2e/desktop-formatting.spec.ts:45:1

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: locator('[data-plugin-slot="document-toolbar"]').getByRole('button', { name: '格式', exact: true })
Expected: visible
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 5000ms
  - waiting for locator('[data-plugin-slot="document-toolbar"]').getByRole('button', { name: '格式', exact: true })

```

```yaml
- main:
  - button "菜单"
  - heading "未命名" [level=1]
  - paragraph: 未保存
  - button "最小化"
  - button "最大化"
  - button "关闭窗口"
  - text: 写点什么吧...
  - textbox
  - textbox "Markdown 编辑器"
  - button "侧栏"
  - button "实时"
  - text: Markdown 0 字符 已保存
```

# Test source

```ts
  1  | import { expect, type Page } from '@playwright/test'
  2  | import { readFile } from 'node:fs/promises'
  3  | import { resolve } from 'node:path'
  4  | import { build } from 'esbuild'
  5  | 
  6  | // A genuine isolated Worker entry bundled solely through the public SDK.
  7  | export async function formattingFixture(page: Page) {
  8  |   const manifest = JSON.parse(await readFile('plugins/formatting/plugin.json', 'utf8'))
  9  |   const bundle = await build({
  10 |     entryPoints: ['plugins/formatting/src/plugin.ts'],
  11 |     bundle: true,
  12 |     write: false,
  13 |     format: 'esm',
  14 |     platform: 'browser',
  15 |     alias: { '@milkup/plugin-sdk': resolve('packages/plugin-sdk/src/index.js') },
  16 |   })
  17 |   manifest.main = 'data:text/javascript,' + encodeURIComponent(bundle.outputFiles[0]!.text)
  18 |   await page.addInitScript((manifest) => {
  19 |     localStorage.setItem(
  20 |       'milkup.desktop.plugins.registry.v1',
  21 |       JSON.stringify({
  22 |         version: 1,
  23 |         records: [
  24 |           {
  25 |             manifest,
  26 |             manifestPath: '/plugins/formatting/plugin.json',
  27 |             rootPath: '/plugins/formatting',
  28 |             sourcePath: '/plugins/formatting/plugin.json',
  29 |             dataRoot: `milkup://plugin-data/${manifest.id}`,
  30 |             storageRoot: `milkup://plugin-storage/${manifest.id}`,
  31 |             state: 'installed',
  32 |             enabled: false,
  33 |             installedAt: 1,
  34 |             updatedAt: 1,
  35 |             trust: 'development',
  36 |             approvals: { permissions: [], hosts: ['worker'] },
  37 |             errors: [],
  38 |           },
  39 |         ],
  40 |         auditRecords: [],
  41 |       }),
  42 |     )
  43 |   }, manifest)
  44 |   await page.goto('/')
  45 |   await page.getByRole('button', { name: '菜单', exact: true }).click()
  46 |   await page.getByRole('button', { name: '插件', exact: true }).click()
  47 |   await page.getByRole('button', { name: 'Milkup Formatting', exact: true }).click()
  48 |   const approve = page.getByRole('button', { name: '批准能力', exact: true })
  49 |   if (await approve.isVisible()) await approve.click()
  50 |   else await expect(page.getByRole('button', { name: '撤销审批', exact: true })).toBeVisible()
  51 |   await page.getByRole('button', { name: '启用', exact: true }).click()
  52 |   await page.locator('[data-menu-close]').click()
  53 |   await expect(
  54 |     page
  55 |       .locator('[data-plugin-slot="document-toolbar"]')
  56 |       .getByRole('button', { name: '格式', exact: true }),
> 57 |   ).toBeVisible()
     |     ^ Error: expect(locator).toBeVisible() failed
  58 | }
  59 | 
```
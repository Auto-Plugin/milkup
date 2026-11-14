# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: desktop-formatting.spec.ts >> formatting toolbar geometry 760x520 dark 125%
- Location: tests/e2e/desktop-formatting.spec.ts:132:7

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
  1  | import { sealWorkerFixture } from './sealed-plugin-fixture'
  2  | import { expect, type Page } from '@playwright/test'
  3  | import { readFile } from 'node:fs/promises'
  4  | import { resolve } from 'node:path'
  5  | import { build } from 'esbuild'
  6  | 
  7  | // A genuine isolated Worker entry bundled solely through the public SDK.
  8  | export async function formattingFixture(page: Page) {
  9  |   const manifest = JSON.parse(await readFile('plugins/formatting/plugin.json', 'utf8'))
  10 |   const bundle = await build({
  11 |     entryPoints: ['plugins/formatting/src/plugin.ts'],
  12 |     bundle: true,
  13 |     write: false,
  14 |     format: 'esm',
  15 |     platform: 'browser',
  16 |     alias: { '@milkup/plugin-sdk': resolve('packages/plugin-sdk/src/index.js') },
  17 |   })
  18 |   await sealWorkerFixture(
  19 |     page,
  20 |     manifest,
  21 |     '/plugins/formatting/plugin.json',
  22 |     bundle.outputFiles[0]!.text,
  23 |   )
  24 |   await page.addInitScript((manifest) => {
  25 |     localStorage.setItem(
  26 |       'milkup.desktop.plugins.registry.v1',
  27 |       JSON.stringify({
  28 |         version: 1,
  29 |         records: [
  30 |           {
  31 |             manifest,
  32 |             manifestPath: '/plugins/formatting/plugin.json',
  33 |             rootPath: '/plugins/formatting',
  34 |             sourcePath: '/plugins/formatting/plugin.json',
  35 |             dataRoot: `milkup://plugin-data/${manifest.id}`,
  36 |             storageRoot: `milkup://plugin-storage/${manifest.id}`,
  37 |             state: 'installed',
  38 |             enabled: false,
  39 |             installedAt: 1,
  40 |             updatedAt: 1,
  41 |             trust: 'development',
  42 |             approvals: { permissions: [], hosts: ['worker'] },
  43 |             errors: [],
  44 |           },
  45 |         ],
  46 |         auditRecords: [],
  47 |       }),
  48 |     )
  49 |   }, manifest)
  50 |   await page.goto('/')
  51 |   await page.getByRole('button', { name: '菜单', exact: true }).click()
  52 |   await page.getByRole('button', { name: '插件', exact: true }).click()
  53 |   await page.getByRole('button', { name: 'Milkup Formatting', exact: true }).click()
  54 |   const approve = page.getByRole('button', { name: '批准能力', exact: true })
  55 |   if (await approve.isVisible()) await approve.click()
  56 |   else await expect(page.getByRole('button', { name: '撤销审批', exact: true })).toBeVisible()
  57 |   await page.getByRole('button', { name: '启用', exact: true }).click()
  58 |   await page.locator('[data-menu-close]').click()
  59 |   await expect(
  60 |     page
  61 |       .locator('[data-plugin-slot="document-toolbar"]')
  62 |       .getByRole('button', { name: '格式', exact: true }),
> 63 |   ).toBeVisible()
     |     ^ Error: expect(locator).toBeVisible() failed
  64 | }
  65 | 
```
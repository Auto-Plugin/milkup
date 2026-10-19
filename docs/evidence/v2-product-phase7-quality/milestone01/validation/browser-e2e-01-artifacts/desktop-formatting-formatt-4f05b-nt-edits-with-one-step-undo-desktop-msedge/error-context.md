# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: desktop-formatting.spec.ts >> formatting table UI performs real row, column and alignment edits with one-step undo
- Location: tests/e2e/desktop-formatting.spec.ts:63:1

# Error details

```
Error: locator.click: Test ended.
Call log:
  - waiting for getByRole('button', { name: 'Milkup Formatting', exact: true })

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
  29 |             state: 'installed',
  30 |             enabled: false,
  31 |             installedAt: 1,
  32 |             updatedAt: 1,
  33 |             trust: 'development',
  34 |             approvals: { permissions: [], hosts: ['worker'] },
  35 |             errors: [],
  36 |           },
  37 |         ],
  38 |         auditRecords: [],
  39 |       }),
  40 |     )
  41 |   }, manifest)
  42 |   await page.goto('/')
  43 |   await page.getByRole('button', { name: '菜单', exact: true }).click()
  44 |   await page.getByRole('button', { name: '插件', exact: true }).click()
> 45 |   await page.getByRole('button', { name: 'Milkup Formatting', exact: true }).click()
     |                                                                              ^ Error: locator.click: Test ended.
  46 |   const approve = page.getByRole('button', { name: '批准能力', exact: true })
  47 |   if (await approve.isVisible()) await approve.click()
  48 |   else await expect(page.getByRole('button', { name: '撤销审批', exact: true })).toBeVisible()
  49 |   await page.getByRole('button', { name: '启用', exact: true }).click()
  50 |   await page.locator('[data-menu-close]').click()
  51 |   await expect(
  52 |     page
  53 |       .locator('[data-plugin-slot="document-toolbar"]')
  54 |       .getByRole('button', { name: '格式', exact: true }),
  55 |   ).toBeVisible()
  56 | }
  57 | 
```
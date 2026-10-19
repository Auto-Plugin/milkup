# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: desktop-formatting.spec.ts >> formatting Worker preserves Unicode selection and supports toolbar toggle, undo and save
- Location: tests/e2e/desktop-formatting.spec.ts:28:1

# Error details

```
Test timeout of 60000ms exceeded.
```

```
Error: locator.click: Test timeout of 60000ms exceeded.
Call log:
  - waiting for getByRole('button', { name: 'Milkup Formatting', exact: true })

```

# Page snapshot

```yaml
- main [ref=e3]:
  - generic [ref=e4]:
    - button "菜单" [expanded] [ref=e5] [cursor=pointer]:
      - img [ref=e6]
    - generic [ref=e7]:
      - heading "未命名" [level=1] [ref=e8]
      - paragraph [ref=e9]: 未保存
    - generic "窗口控制" [ref=e10]:
      - button "最小化" [ref=e11] [cursor=pointer]
      - button "最大化" [ref=e13] [cursor=pointer]
      - button "关闭窗口" [ref=e15] [cursor=pointer]
  - dialog "菜单" [ref=e18]:
    - generic [ref=e19]:
      - heading "菜单" [level=2] [ref=e21]
      - button "关闭菜单" [ref=e22] [cursor=pointer]:
        - img [ref=e23]
    - generic [ref=e26]:
      - navigation "菜单分类" [ref=e27]:
        - button "文件" [ref=e28] [cursor=pointer]:
          - img [ref=e29]
          - generic [ref=e32]: 文件
        - button "插件" [active] [ref=e33] [cursor=pointer]:
          - img [ref=e34]
          - generic [ref=e36]: 插件
        - button "关于" [ref=e37] [cursor=pointer]:
          - img [ref=e38]
          - generic [ref=e40]: 关于
      - generic [ref=e41]:
        - heading "插件" [level=3] [ref=e42]
        - generic [ref=e44]:
          - button "安装本地插件" [ref=e46] [cursor=pointer]
          - group [ref=e47]:
            - generic "插件目录诊断" [ref=e48]
  - generic [ref=e51]:
    - text: 写点什么吧...
    - generic [ref=e52]:
      - textbox [ref=e53]
      - textbox "Markdown 编辑器"
  - generic [ref=e55]:
    - generic [ref=e56]:
      - button "侧栏" [ref=e57] [cursor=pointer]:
        - img [ref=e58]
      - button "实时" [ref=e60] [cursor=pointer]:
        - img [ref=e61]
    - generic [ref=e64]:
      - generic [ref=e65]: Markdown
      - generic [ref=e66]: 0 字符
      - generic [ref=e69]: 已保存
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
     |                                                                              ^ Error: locator.click: Test timeout of 60000ms exceeded.
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
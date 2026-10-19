# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: desktop-markdown-extensions.spec.ts >> search keeps the selected marker visible while asynchronous block previews settle
- Location: tests/e2e/desktop-markdown-extensions.spec.ts:173:1

# Error details

```
Error: expect(received).toBe(expected) // Object.is equality

Expected: true
Received: false

Call Log:
- Timeout 10000ms exceeded while waiting on the predicate
```

# Page snapshot

```yaml
- main [ref=e3]:
  - generic [ref=e4]:
    - button "菜单" [ref=e5] [cursor=pointer]:
      - img [ref=e6]
    - generic [ref=e7]:
      - heading "未命名" [level=1] [ref=e8]
      - paragraph [ref=e9]: 未保存
    - generic "窗口控制" [ref=e10]:
      - button "最小化" [ref=e11] [cursor=pointer]
      - button "最大化" [ref=e13] [cursor=pointer]
      - button "关闭窗口" [ref=e15] [cursor=pointer]
  - generic [ref=e19]:
    - text: 写点什么吧...
    - generic [ref=e20]:
      - textbox [ref=e21]
      - textbox "Markdown 编辑器" [active]
  - generic [ref=e23]:
    - generic [ref=e24]:
      - button "侧栏" [ref=e25] [cursor=pointer]:
        - img [ref=e26]
      - button "实时" [ref=e28] [cursor=pointer]:
        - img [ref=e29]
    - generic [ref=e32]:
      - generic [ref=e33]: Markdown
      - generic [ref=e34]: 0 字符
      - generic [ref=e37]: 已保存
```

# Test source

```ts
  1   | import { expect, type Page } from '@playwright/test'
  2   | import { readFile } from 'node:fs/promises'
  3   | import { resolve } from 'node:path'
  4   | import { build } from 'esbuild'
  5   | 
  6   | /** Real math/footnotes Workers plus an explicitly test-only closed image provider.
  7   |  * Official Mermaid uses the native DOM host and is covered by native tests.
  8   |  * Browser fixture has no official-engine or operating-system save claim.
  9   |  */
  10  | export async function markdownExtensionFixture(
  11  |   page: Page,
  12  |   options: { nativeDiagramUnavailable?: boolean } = {},
  13  | ) {
  14  |   const records = []
  15  |   for (const directory of ['math', 'diagrams', 'footnotes']) {
  16  |     const fixtureImage = directory === 'diagrams' && !options.nativeDiagramUnavailable
  17  |     const nativeUnavailable = directory === 'diagrams' && options.nativeDiagramUnavailable
  18  |     const root = fixtureImage
  19  |       ? 'tests/fixtures/document-presentation-image'
  20  |       : `plugins/${directory}`
  21  |     const manifest = JSON.parse(await readFile(`${root}/plugin.json`, 'utf8'))
  22  |     if (nativeUnavailable) {
  23  |       // Small, locatable entry, deliberately never loaded: native preparation
  24  |       // rejects before module execution. This does not load the real engine.
  25  |       manifest.main = './native-only-placeholder.js'
  26  |     } else {
  27  |       const bundle = await build({
  28  |         entryPoints: [fixtureImage ? `${root}/plugin.ts` : `${root}/src/plugin.ts`],
  29  |         bundle: true,
  30  |         write: false,
  31  |         format: 'esm',
  32  |         platform: 'browser',
  33  |         alias: { '@milkup/plugin-sdk': resolve('packages/plugin-sdk/src/index.js') },
  34  |       })
  35  |       manifest.main = 'data:text/javascript,' + encodeURIComponent(bundle.outputFiles[0]!.text)
  36  |     }
  37  |     const recordRoot = nativeUnavailable
  38  |       ? '/tests/fixtures/document-presentation-image'
  39  |       : `/${root}`
  40  |     records.push({
  41  |       manifest,
  42  |       manifestPath: `${recordRoot}/plugin.json`,
  43  |       rootPath: recordRoot,
  44  |       sourcePath: `${recordRoot}/plugin.json`,
  45  |       dataRoot: `milkup://plugin-data/${manifest.id}`,
  46  |       storageRoot: `milkup://plugin-storage/${manifest.id}`,
  47  |       state: 'enabled',
  48  |       enabled: true,
  49  |       installedAt: 1,
  50  |       updatedAt: 1,
  51  |       trust: 'development',
  52  |       approvals: { permissions: ['document:read'], hosts: [manifest.host ?? 'worker'] },
  53  |       errors: [],
  54  |     })
  55  |   }
  56  |   await page.addInitScript(
  57  |     (records) =>
  58  |       localStorage.setItem(
  59  |         'milkup.desktop.plugins.registry.v1',
  60  |         JSON.stringify({ version: 1, records, auditRecords: [] }),
  61  |       ),
  62  |     records,
  63  |   )
  64  |   await page.goto('/')
  65  |   await expect(page.locator('.milkup-input-proxy')).toHaveCount(1)
  66  |   // Restored records already say enabled before their Workers activate. Wait for
  67  |   // this fresh registry's successful activation audit within the host startup budget.
  68  |   await expect
  69  |     .poll(
  70  |       () =>
  71  |         page.evaluate(
  72  |           (ids) => {
  73  |             const snapshot = JSON.parse(localStorage.getItem('milkup.desktop.plugins.registry.v1')!)
  74  |             return (
  75  |               snapshot !== null &&
  76  |               ids.every(
  77  |                 (id) =>
  78  |                   snapshot.records.some(
  79  |                     (record: { manifest: { id: string }; state: string; enabled: boolean }) =>
  80  |                       record.manifest.id === id && record.state === 'enabled' && record.enabled,
  81  |                   ) &&
  82  |                   snapshot.auditRecords.some(
  83  |                     (audit: { pluginId: string; operation: string; denied?: boolean }) =>
  84  |                       audit.pluginId === id && audit.operation === 'enable' && !audit.denied,
  85  |                   ),
  86  |               )
  87  |             )
  88  |           },
  89  |           records
  90  |             .filter((record) => record.manifest.host !== 'dom')
  91  |             .map((record) => record.manifest.id as string),
  92  |         ),
  93  |       { timeout: 10_000 },
  94  |     )
> 95  |     .toBe(true)
      |      ^ Error: expect(received).toBe(expected) // Object.is equality
  96  | }
  97  | export async function seedMarkdownExtensions(page: Page, text: string) {
  98  |   await page.keyboard.press('Control+1')
  99  |   await page.locator('.milkup-input-proxy').focus()
  100 |   await page.keyboard.press('Control+a')
  101 |   await page.keyboard.insertText(text)
  102 |   await page.keyboard.press('Control+Home')
  103 |   await page.keyboard.press('Control+2')
  104 | }
  105 | 
```
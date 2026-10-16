# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: desktop-markdown-extensions.spec.ts >> footnote navigation reveals editable original and remains read only
- Location: tests/e2e/desktop-markdown-extensions.spec.ts:109:1

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: locator('.milkup-document-reference').first()
Expected: visible
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 5000ms
  - waiting for locator('.milkup-document-reference').first()

```

```yaml
- main:
    - button "菜单"
    - heading "未命名" [level=1]
    - paragraph: 未保存
    - button "最小化"
    - button "最大化"
    - button "关闭窗口"
    - status: 部分预览上下文尚未加载，保留对应 Markdown 源码。
    - textbox
    - textbox "Markdown 编辑器"
    - button "侧栏"
    - button "实时"
    - text: Markdown 155 字符 未保存
```

# Test source

````ts
  12  |       lines.map((line) =>
  13  |         line.getAttribute('data-from') === line.getAttribute('data-to') ? '' : line.textContent,
  14  |       ),
  15  |     )
  16  | const fixture = [
  17  |   '安全起点 中文😀',
  18  |   '',
  19  |   '行内 $x^2 + \\frac{1}{2}$ 末尾',
  20  |   '',
  21  |   '$$',
  22  |   '\\begin{pmatrix}a&b\\\\c&d\\end{pmatrix}',
  23  |   '$$',
  24  |   '',
  25  |   '```mermaid',
  26  |   'flowchart LR',
  27  |   'A[中文] --> B[结束]',
  28  |   '```',
  29  |   '',
  30  |   '引用[^n]。',
  31  |   '',
  32  |   '[^n]: 脚注 **正文**',
  33  |   '',
  34  |   '终点',
  35  | ].join('\n')
  36  | test.afterEach(async ({ page }, info) => {
  37  |   if (info.status !== info.expectedStatus) {
  38  |     await info.attach('page-state', {
  39  |       body: await page.locator('body').ariaSnapshot(),
  40  |       contentType: 'text/plain',
  41  |     })
  42  |     await page.screenshot({ path: info.outputPath('failure.png'), fullPage: true })
  43  |   }
  44  | })
  45  | test('three isolated document extensions render safe semantics and preserve source/history', async ({
  46  |   page,
  47  | }) => {
  48  |   await markdownExtensionFixture(page)
  49  |   await seedMarkdownExtensions(page, fixture)
  50  |   await expect(page.locator('.milkup-document-presentation math')).toHaveCount(2)
  51  |   await expect(page.locator('.milkup-document-presentation svg')).toHaveCount(1)
  52  |   await expect(page.locator('.milkup-document-reference').first()).toBeVisible()
  53  |   await expect(page.locator('.milkup-document-presentation mtable')).toHaveCount(1)
  54  |   const metrics = await page.locator('.milkup-document-presentation').evaluateAll((elements) =>
  55  |     elements.map((e) => ({
  56  |       width: e.getBoundingClientRect().width,
  57  |       height: e.getBoundingClientRect().height,
  58  |     })),
  59  |   )
  60  |   expect(metrics.every((m) => m.width > 0 && m.height > 0)).toBe(true)
  61  |   await page.screenshot({
  62  |     path: test.info().outputPath('three-extensions-live.png'),
  63  |     fullPage: true,
  64  |   })
  65  |   await page.keyboard.press('Control+1')
  66  |   await expect(page.locator('[data-document-presentation]')).toHaveCount(0)
  67  |   expect(await sourceLines(page)).toEqual(fixture.split('\n'))
  68  |   await page.locator('.milkup-input-proxy').focus()
  69  |   await page.keyboard.press('Control+Home')
  70  |   await page.keyboard.press('ArrowRight')
  71  |   await page.keyboard.insertText('😀')
  72  |   await page.keyboard.press('Control+z')
  73  |   expect(await sourceLines(page)).toEqual(fixture.split('\n'))
  74  |   await page.keyboard.press('Control+Shift+z')
  75  |   await expect(page.locator('.milkup-line').first()).toHaveText('安😀全起点 中文😀')
  76  | })
  77  | test('opaque code and unsupported diagrams stay literal without executable content', async ({
  78  |   page,
  79  | }) => {
  80  |   await markdownExtensionFixture(page)
  81  |   const source = [
  82  |     '起点',
  83  |     '',
  84  |     '`$x$`',
  85  |     '```js',
  86  |     '$x$',
  87  |     '```',
  88  |     '',
  89  |     '```mermaid',
  90  |     'flowchart TD',
  91  |     'A --> B',
  92  |     'click A "https://example.com"',
  93  |     '```',
  94  |     '',
  95  |     '$\\href{javascript:alert(1)}{x}$',
  96  |     '',
  97  |     '尾',
  98  |   ].join('\n')
  99  |   await seedMarkdownExtensions(page, source)
  100 |   await expect(page.locator('.milkup-editor-content')).toHaveAttribute(
  101 |     'data-document-presentation-status',
  102 |     'fallback',
  103 |   )
  104 |   await expect(page.locator('.milkup-document-presentation math')).toHaveCount(0)
  105 |   await expect(page.locator('.milkup-document-presentation svg')).toHaveCount(0)
  106 |   await page.keyboard.press('Control+1')
  107 |   expect(await sourceLines(page)).toEqual(source.split('\n'))
  108 | })
  109 | test('footnote navigation reveals editable original and remains read only', async ({ page }) => {
  110 |   await markdownExtensionFixture(page)
  111 |   await seedMarkdownExtensions(page, fixture)
> 112 |   await expect(page.locator('.milkup-document-reference').first()).toBeVisible()
      |                                                                    ^ Error: expect(locator).toBeVisible() failed
  113 |   await page.keyboard.press('Control+s')
  114 |   await expect(page.locator('[data-save-dot]')).not.toHaveClass(/is-dirty/)
  115 |   await page.locator('.milkup-document-reference').first().click()
  116 |   await expect(page.locator('.milkup-line[data-line="16"]')).toContainText('[^n]:')
  117 |   await expect(page.locator('.milkup-input-proxy')).toBeFocused()
  118 |   await page.keyboard.press('ArrowRight')
  119 |   await expect(page.locator('.milkup-selection')).toHaveCount(0)
  120 |   await page.keyboard.press('ArrowDown')
  121 |   const back = page
  122 |     .locator(`[data-presentation-from="${fixture.indexOf('[^n]:')}"] .milkup-document-reference`)
  123 |     .first()
  124 |   await expect(back).toBeVisible()
  125 |   await back.click()
  126 |   await expect(page.locator('.milkup-input-proxy')).toBeFocused()
  127 |   await expect(page.locator('[data-save-dot]')).not.toHaveClass(/is-dirty/)
  128 |   await page.keyboard.press('Control+1')
  129 |   expect(await sourceLines(page)).toEqual(fixture.split('\n'))
  130 | })
  131 | test('disabled renderers disappear and leave Unicode editing and save available', async ({
  132 |   page,
  133 | }) => {
  134 |   await markdownExtensionFixture(page)
  135 |   await seedMarkdownExtensions(page, fixture)
  136 |   await expect(page.locator('.milkup-document-presentation math')).toHaveCount(2)
  137 |   await page.getByRole('button', { name: '菜单', exact: true }).click()
  138 |   await page.getByRole('button', { name: '插件', exact: true }).click()
  139 |   for (const name of ['数学公式', 'Milkup Diagrams', 'Milkup Footnotes']) {
  140 |     await page.getByRole('button', { name, exact: true }).click()
  141 |     await page.getByRole('button', { name: '禁用', exact: true }).click()
  142 |     await page.locator('[data-plugin-action=back]').click()
  143 |   }
  144 |   await page.locator('[data-menu-close]').click()
  145 |   await expect(page.locator('[data-document-presentation]')).toHaveCount(0)
  146 |   await page.keyboard.press('Control+1')
  147 |   await page.locator('.milkup-input-proxy').focus()
  148 |   await page.keyboard.press('Control+End')
  149 |   await page.keyboard.insertText('停用😀')
  150 |   await page.keyboard.press('Control+z')
  151 |   expect(await sourceLines(page)).toEqual(fixture.split('\n'))
  152 |   await page.keyboard.press('Control+s')
  153 |   await expect(page.locator('[data-save-dot]')).not.toHaveClass(/is-dirty/)
  154 | })
  155 |
  156 | test('search keeps the selected marker visible while asynchronous block previews settle', async ({
  157 |   page,
  158 | }) => {
  159 |   await page.setViewportSize({ width: 1100, height: 760 })
  160 |   await markdownExtensionFixture(page)
  161 |   const source =
  162 |     '# Unicode 中文 é 👩🏽‍💻\r\n\r\nSAMPLE-ROOT\r\n公式 $\\frac{x_1^2}{\\sqrt[3]{y}}$ 和 $\\int_0^\\infty x\\,dx$。\r\n\r\nSAMPLE-MATRIX\r\n$$\r\n\\begin{pmatrix}a&b\\\\c&d\\end{pmatrix}\r\n$$\r\n\r\nSAMPLE-FLOW\r\n```mermaid\r\nflowchart TD\r\nA[开始] --> B{通过?}\r\nB -->|是| C(完成)\r\n```\r\n\r\nSAMPLE-SEQUENCE\r\n```mermaid\r\nsequenceDiagram\r\nactor A as 用户\r\nparticipant B as 服务\r\nA->>B: 请求\r\nB-->>A: 返回\r\n```\r\n\r\nSAMPLE-PIE\r\n```mermaid\r\npie\r\ntitle 分布\r\n"甲": 2\r\n"乙": 1\r\n```\r\n\r\nSAMPLE-FOOTNOTES\r\n脚注引用[^note] 与再次引用[^note]。\r\n\r\n[^note]: 定义中文与 **强调**，原始 Unicode 保留。\r\n\r\nSAMPLE-ERRORS\r\n未知 $\\notACommand{x}$。\r\n```mermaid\r\nflowchart TD\r\nclick A "https://example.invalid"\r\n```\r\n\r\nSAMPLE-CODE\r\n`$notMath$` 与 [目标](https://example.invalid/$notMath$)\r\n```text\r\n$notMath$\r\n```\r\n\r\nEND-SAMPLES\r\n'
  163 |   await seedMarkdownExtensions(page, source)
  164 |   await expect(page.locator('.milkup-document-presentation svg')).toHaveCount(3)
  165 |   await page.locator('.milkup-input-proxy').focus()
  166 |   await page.keyboard.press('Control+End')
  167 |   await page.keyboard.press('Control+f')
  168 |   await page.locator('[data-search-input]').pressSequentially('SAMPLE-ROOT', { delay: 2 })
  169 |   await expect(page.locator('[data-search-result-count]')).toHaveText('1/1')
  170 |   await expect(page.locator('.milkup-selection')).not.toHaveCount(0)
  171 |   await page.keyboard.press('Escape')
  172 |   await page.locator('.milkup-input-proxy').focus()
  173 |   const observations = []
  174 |   for (let i = 0; i < 60; i++) {
  175 |     observations.push(
  176 |       await page.locator('.milkup-editor').evaluate((root) => {
  177 |         const line = root.querySelector('.milkup-line[data-line="3"]')!
  178 |         const rect = line.getBoundingClientRect(),
  179 |           box = root.getBoundingClientRect()
  180 |         return {
  181 |           scrollTop: root.scrollTop,
  182 |           top: rect.top,
  183 |           bottom: rect.bottom,
  184 |           viewportTop: box.top,
  185 |           viewportBottom: box.bottom,
  186 |         }
  187 |       }),
  188 |     )
  189 |     await page.waitForTimeout(50)
  190 |   }
  191 |   await test.info().attach('search-scroll-observations', {
  192 |     body: JSON.stringify(observations),
  193 |     contentType: 'application/json',
  194 |   })
  195 |   expect(
  196 |     observations.slice(-3).every((r) => r.top >= r.viewportTop && r.bottom <= r.viewportBottom),
  197 |   ).toBe(true)
  198 |   await page
  199 |     .locator('.milkup-document-presentation')
  200 |     .filter({ has: page.locator('mroot') })
  201 |     .click()
  202 |   await expect(page.locator('.milkup-line[data-line="4"]')).toContainText('\\frac')
  203 |   await expect(page.locator('.milkup-input-proxy')).toBeFocused()
  204 |   const revealed = []
  205 |   for (let i = 0; i < 20; i++) {
  206 |     revealed.push(
  207 |       await page.locator('.milkup-editor').evaluate((root) => {
  208 |         const line = root.querySelector('.milkup-line[data-line="4"]')!.getBoundingClientRect(),
  209 |           box = root.getBoundingClientRect()
  210 |         return {
  211 |           top: line.top,
  212 |           bottom: line.bottom,
````

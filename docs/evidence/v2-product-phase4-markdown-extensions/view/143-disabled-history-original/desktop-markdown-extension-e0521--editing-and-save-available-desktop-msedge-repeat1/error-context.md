# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: desktop-markdown-extensions.spec.ts >> disabled renderers disappear and leave Unicode editing and save available
- Location: tests/e2e/desktop-markdown-extensions.spec.ts:131:1

# Error details

````
Error: expect(received).toEqual(expected) // deep equality

- Expected  - 17
+ Received  +  0

  Array [
-   "安全起点 中文😀",
-   "",
-   "行内 $x^2 + \\frac{1}{2}$ 末尾",
-   "",
-   "$$",
-   "\\begin{pmatrix}a&b\\\\c&d\\end{pmatrix}",
-   "$$",
    "",
-   "```mermaid",
-   "flowchart LR",
-   "A[中文] --> B[结束]",
-   "```",
-   "",
-   "引用[^n]。",
-   "",
-   "[^n]: 脚注 **正文**",
-   "",
-   "终点",
  ]
````

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
            - button "源码" [ref=e28] [cursor=pointer]:
                - img [ref=e29]
        - generic [ref=e33]:
            - generic [ref=e34]: Markdown
            - generic [ref=e35]: 0 字符
            - generic [ref=e38]: 未保存
```

# Test source

````ts
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
  112 |   await expect(page.locator('.milkup-document-reference').first()).toBeVisible()
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
> 151 |   expect(await sourceLines(page)).toEqual(fixture.split('\n'))
      |                                   ^ Error: expect(received).toEqual(expected) // deep equality
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
  213 |           viewportTop: box.top,
  214 |           viewportBottom: box.bottom,
  215 |         }
  216 |       }),
  217 |     )
  218 |     await page.waitForTimeout(50)
  219 |   }
  220 |   await test.info().attach('source-reveal-geometry', {
  221 |     body: JSON.stringify(revealed),
  222 |     contentType: 'application/json',
  223 |   })
  224 |   expect(
  225 |     revealed.slice(-3).every((r) => r.top >= r.viewportTop && r.bottom <= r.viewportBottom),
  226 |   ).toBe(true)
  227 |   const graphs = page
  228 |     .locator('.milkup-document-presentation[tabindex="0"]')
  229 |     .filter({ has: page.locator('svg') })
  230 |   await graphs.nth(0).focus()
  231 |   await page.waitForTimeout(300)
  232 |   await expect(graphs.nth(0)).toBeFocused()
  233 |   await page.keyboard.press('Tab')
  234 |   await page.waitForTimeout(300)
  235 |   await expect(graphs.nth(1)).toBeFocused()
  236 |   await page.keyboard.press('Shift+Tab')
  237 |   await page.waitForTimeout(300)
  238 |   await expect(graphs.nth(0)).toBeFocused()
  239 |   const references = page.locator('.milkup-document-reference')
  240 |   await references.nth(0).focus()
  241 |   await page.waitForTimeout(300)
  242 |   await expect(references.nth(0)).toBeFocused()
  243 |   await page.keyboard.press('Tab')
  244 |   await page.waitForTimeout(300)
  245 |   await expect(references.nth(1)).toBeFocused()
  246 |   await page.keyboard.press('Shift+Tab')
  247 |   await expect(references.nth(0)).toBeFocused()
  248 | })
  249 |
  250 | for (const windowed of [false, true])
  251 |   test(`background preview refresh preserves layout (${windowed})`, async ({ page }) => {
````

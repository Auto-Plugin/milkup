# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: 144-history-diagnostic.spec.ts >> observe disabled renderer undo at End
- Location: ../milkup-markdown-extensions-phase4-evidence/view/144-history-diagnostic.spec.ts:25:45

# Error details

```
Error: keyboard.press: Unknown key: "shift"
```

# Page snapshot

````yaml
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
    - generic [ref=e20]:
        - textbox [ref=e21]:
            - generic [ref=e22]: 安全起点 中文😀
            - generic [ref=e24]: "行内 $x^2 + \\frac{1}{2}$ 末尾"
            - generic [ref=e26]: $$
            - generic [ref=e27]: "\\begin{pmatrix}a&b\\\\c&d\\end{pmatrix}"
            - generic [ref=e28]: $$
            - generic [ref=e30]: '```mermaid'
            - generic [ref=e31]: flowchart LR
            - generic [ref=e32]: A[中文] --> B[结束]
            - generic [ref=e33]: '```'
            - generic [ref=e35]: 引用[^n]。
            - generic [ref=e37]: '[^n]: 脚注 **正文**'
            - generic [ref=e39]: 终点
        - textbox "Markdown 编辑器" [active]
    - generic [ref=e40]:
        - generic [ref=e41]:
            - button "侧栏" [ref=e42] [cursor=pointer]:
                - img [ref=e43]
            - button "源码" [ref=e45] [cursor=pointer]:
                - img [ref=e46]
        - generic [ref=e50]:
            - generic [ref=e51]: Markdown
            - generic [ref=e52]: 155 字符
            - generic [ref=e55]: 未保存
````

# Test source

````ts
  1  | import { test, expect } from '/workspace/milkup/node_modules/@playwright/test'
  2  | import { writeFile } from 'node:fs/promises'
  3  | import { markdownExtensionFixture, seedMarkdownExtensions } from '/workspace/milkup/tests/helpers/markdown-extension-plugins'
  4  | const fixture = [
  5  |   '安全起点 中文😀',
  6  |   '',
  7  |   '行内 $x^2 + \\frac{1}{2}$ 末尾',
  8  |   '',
  9  |   '$$',
  10 |   '\\begin{pmatrix}a&b\\\\c&d\\end{pmatrix}',
  11 |   '$$',
  12 |   '',
  13 |   '```mermaid',
  14 |   'flowchart LR',
  15 |   'A[中文] --> B[结束]',
  16 |   '```',
  17 |   '',
  18 |   '引用[^n]。',
  19 |   '',
  20 |   '[^n]: 脚注 **正文**',
  21 |   '',
  22 |   '终点',
  23 | ].join('\n')
  24 |
  25 | for (const boundary of ['End', 'Home']) test(`observe disabled renderer undo at ${boundary}`, async ({page}) => {
  26 |   await markdownExtensionFixture(page)
  27 |   await page.evaluate(() => {
  28 |     (window as any).historyEvents = []
  29 |     document.addEventListener('input', (event) => {
  30 |       if (!(event.target instanceof Element) || !event.target.matches('.milkup-input-proxy')) return
  31 |       ;(window as any).historyEvents.push({ wall: Date.now(), type: (event as InputEvent).inputType, data: (event as InputEvent).data, cursor: document.querySelector<HTMLElement>('.milkup-cursor')?.dataset.position })
  32 |     })
  33 |   })
  34 |   await seedMarkdownExtensions(page, fixture)
  35 |   await expect(page.locator('.milkup-document-presentation math')).toHaveCount(2)
  36 |   await page.getByRole('button', { name: '菜单', exact: true }).click()
  37 |   await page.getByRole('button', { name: '插件', exact: true }).click()
  38 |   for (const name of ['数学公式', 'Milkup Diagrams', 'Milkup Footnotes']) {
  39 |     await page.getByRole('button', { name, exact: true }).click()
  40 |     await page.getByRole('button', { name: '禁用', exact: true }).click()
  41 |     await page.locator('[data-plugin-action=back]').click()
  42 |   }
  43 |   await page.locator('[data-menu-close]').click()
  44 |   await expect(page.locator('[data-document-presentation]')).toHaveCount(0)
  45 |   await page.keyboard.press('Control+1')
  46 |   await page.locator('.milkup-input-proxy').focus()
  47 |   await page.keyboard.press(`Control+${boundary}`)
  48 |   const state = () => page.evaluate(() => ({ cursor: document.querySelector<HTMLElement>('.milkup-cursor')?.dataset.position, lines: [...document.querySelectorAll<HTMLElement>('.milkup-line')].map(line => line.dataset.from === line.dataset.to ? '' : line.textContent), events: (window as any).historyEvents }))
  49 |   const before = await state()
  50 |   await page.keyboard.insertText('停用😀')
  51 |   const inserted = await state()
  52 |   await page.keyboard.press('Control+z')
  53 |   const undone = await state()
> 54 |   await page.keyboard.press('Control+shift+z')
     |                       ^ Error: keyboard.press: Unknown key: "shift"
  55 |   const redone = await state()
  56 |   const inputGap = inserted.events.at(-1).wall - inserted.events[0].wall
  57 |   await writeFile(test.info().outputPath('history.json'), JSON.stringify({ boundary, fixtureLength: fixture.length, inputGap, before, inserted, undone, redone }, null, 2))
  58 |   await page.screenshot({path:test.info().outputPath('history.png')})
  59 |   expect(redone.lines).toEqual(inserted.lines)
  60 |   if (boundary === 'Home') expect(undone.lines).toEqual(fixture.split('\n'))
  61 | })
  62 |
````

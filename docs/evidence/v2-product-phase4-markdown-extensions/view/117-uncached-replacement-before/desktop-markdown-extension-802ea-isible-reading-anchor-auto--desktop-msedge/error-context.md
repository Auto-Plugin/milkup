# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: desktop-markdown-extensions.spec.ts >> uncached source replacement retains the visible reading anchor (auto)
- Location: tests/e2e/desktop-markdown-extensions.spec.ts:912:3

# Error details

```
Error: expect(received).toBeCloseTo(expected, precision)

Expected: 204.78125
Received: -91

Expected precision:    0
Expected difference: < 0.5
Received difference:   295.78125
```

# Page snapshot

```yaml
- generic [ref=e1]:
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
    - main [ref=e38]:
        - generic [ref=e39]:
            - textbox [ref=e40]:
                - generic [ref=e42]: preview
                - generic [ref=e44]: retained 中文😀 body
                - generic [ref=e46]: retained 中文😀 body
                - generic [ref=e48]: retained 中文😀 body
                - generic [ref=e50]: retained 中文😀 body
                - generic [ref=e52]: retained 中文😀 body
                - generic [ref=e54]: retained 中文😀 body
                - generic [ref=e56]: retained 中文😀 body
                - generic [ref=e58]: retained 中文😀 body
                - generic [ref=e60]: retained 中文😀 body
                - generic [ref=e62]: retained 中文😀 body
                - generic [ref=e64]: retained 中文😀 body
                - generic [ref=e66]: retained 中文😀 body
                - generic [ref=e68]: retained 中文😀 body
                - generic [ref=e70]: retained 中文😀 body
                - generic [ref=e72]: retained 中文😀 body
                - generic [ref=e74]: retained 中文😀 body
                - generic [ref=e76]: retained 中文😀 body
                - generic [ref=e78]: retained 中文😀 body
                - generic [ref=e80]: retained 中文😀 body
                - generic [ref=e82]: retained 中文😀 body
                - generic [ref=e84]: retained 中文😀 body
                - generic [ref=e86]: retained 中文😀 body
                - generic [ref=e88]: retained 中文😀 body
                - generic [ref=e90]: retained 中文😀 body
                - generic [ref=e92]: retained 中文😀 body
                - generic [ref=e94]: retained 中文😀 body
                - generic [ref=e96]: retained 中文😀 body
                - generic [ref=e98]: retained 中文😀 body
                - generic [ref=e100]: retained 中文😀 body
                - generic [ref=e102]: retained 中文😀 body
                - generic [ref=e104]: retained 中文😀 body
                - generic [ref=e106]: retained 中文😀 body
                - generic [ref=e108]: retained 中文😀 body
                - generic [ref=e110]: retained 中文😀 body
                - generic [ref=e112]: retained 中文😀 body
                - generic [ref=e114]: retained 中文😀 body
                - generic [ref=e116]: retained 中文😀 body
                - generic [ref=e118]: retained 中文😀 body
                - generic [ref=e120]: retained 中文😀 body
                - generic [ref=e122]: retained 中文😀 body
                - generic [ref=e124]: retained 中文😀 body
                - generic [ref=e126]: retained 中文😀 body
                - generic [ref=e128]: retained 中文😀 body
                - generic [ref=e130]: retained 中文😀 body
                - generic [ref=e132]: retained 中文😀 body
                - generic [ref=e134]: retained 中文😀 body
                - generic [ref=e136]: retained 中文😀 body
                - generic [ref=e138]: retained 中文😀 body
                - generic [ref=e140]: retained 中文😀 body
                - generic [ref=e142]: retained 中文😀 body
                - generic [ref=e144]: retained 中文😀 body
                - generic [ref=e146]: retained 中文😀 body
                - generic [ref=e148]: retained 中文😀 body
                - generic [ref=e150]: retained 中文😀 body
                - generic [ref=e152]: retained 中文😀 body
                - generic [ref=e154]: retained 中文😀 body
            - textbox "Markdown 编辑器"
```

# Test source

```ts
  947  |               request: {
  948  |                 ...window,
  949  |                 documentId: source.documentId,
  950  |                 version: 0,
  951  |                 contextKnown: true,
  952  |                 blocks: [],
  953  |                 protectedRanges: [],
  954  |                 theme: 'light',
  955  |                 target: 'screen',
  956  |               },
  957  |               result: {
  958  |                 complete: true,
  959  |                 fragments:
  960  |                   window.from === 0
  961  |                     ? [
  962  |                         {
  963  |                           from: 0,
  964  |                           to: 7,
  965  |                           layout: 'block',
  966  |                           accessibleText: 'Tall preview',
  967  |                           content: { type: 'vector', width: 600, height: 300, children: [] },
  968  |                         },
  969  |                       ]
  970  |                     : [],
  971  |               },
  972  |             }
  973  |           },
  974  |         }
  975  |         view.setDocumentPresentation(provider)
  976  |         const observe = () => {
  977  |           const target = view.contentDOM.querySelector('[data-line="20"]')?.getBoundingClientRect()
  978  |           return {
  979  |             top: target?.top,
  980  |             bottom: target?.bottom,
  981  |             scrollTop: view.dom.scrollTop,
  982  |             fromLine: view.contentDOM.dataset.fromLine,
  983  |             toLine: view.contentDOM.dataset.toLine,
  984  |             spacer: view.contentDOM.querySelector<HTMLElement>('[data-spacer="top"]')?.style.height,
  985  |             viewportTop: view.dom.getBoundingClientRect().top,
  986  |             viewportBottom: view.dom.getBoundingClientRect().bottom,
  987  |           }
  988  |         }
  989  |         ;(window as any).uncachedReplacement = {
  990  |           view,
  991  |           source,
  992  |           provider,
  993  |           observe,
  994  |           text,
  995  |           beginPending: () => {
  996  |             pending = true
  997  |             view.setDocumentPresentation(provider)
  998  |           },
  999  |           select: async () => {
  1000 |             const line = await source.readLineWindow(20, 20)
  1001 |             await view.revealSelection(20, Selection.cursor(line.from))
  1002 |           },
  1003 |         }
  1004 |       },
  1005 |       {
  1006 |         anchoring,
  1007 |         viewModule: `/@fs${resolve('packages/view-dom/src/index.ts')}`,
  1008 |         coreModule: `/@fs${resolve('packages/core/src/index.ts')}`,
  1009 |       },
  1010 |     )
  1011 |     await expect(page.locator('[data-uncached-replacement] svg')).toHaveCount(1)
  1012 |     await page.evaluate(() => (window as any).uncachedReplacement.select())
  1013 |     await expect(page.locator('[data-uncached-replacement] svg')).toHaveCount(0)
  1014 |     await page.waitForTimeout(100)
  1015 |     await page.evaluate(() => (window as any).uncachedReplacement.view.scrollToLine(15))
  1016 |     await expect(
  1017 |       page.locator('[data-uncached-replacement] .milkup-editor-content'),
  1018 |     ).toHaveAttribute('data-from-line', '3')
  1019 |     await page.evaluate(() => (window as any).uncachedReplacement.beginPending())
  1020 |     await page.waitForTimeout(50)
  1021 |     const before = await page.evaluate(() => {
  1022 |       const probe = (window as any).uncachedReplacement
  1023 |       probe.view.dom.scrollTop -= 63
  1024 |       return probe.observe()
  1025 |     })
  1026 |     await expect(
  1027 |       page.locator('[data-uncached-replacement] .milkup-editor-content'),
  1028 |     ).toHaveAttribute('data-from-line', '1')
  1029 |     await page.waitForTimeout(100)
  1030 |     const after = await page.evaluate(async () => {
  1031 |       const probe = (window as any).uncachedReplacement
  1032 |       return {
  1033 |         ...probe.observe(),
  1034 |         version: probe.source.version,
  1035 |         unchanged:
  1036 |           (await probe.source.readLineWindow(1, probe.source.lineCount)).text === probe.text,
  1037 |       }
  1038 |     })
  1039 |     await writeFile(
  1040 |       test.info().outputPath('uncached-replacement.json'),
  1041 |       JSON.stringify({ before, after }, null, 2),
  1042 |     )
  1043 |     await page.screenshot({
  1044 |       path: test.info().outputPath('uncached-replacement.png'),
  1045 |       fullPage: true,
  1046 |     })
> 1047 |     expect(after.top).toBeCloseTo(before.top, 0)
       |                       ^ Error: expect(received).toBeCloseTo(expected, precision)
  1048 |     expect(after.top).toBeGreaterThanOrEqual(after.viewportTop)
  1049 |     expect(after.bottom).toBeLessThanOrEqual(after.viewportBottom)
  1050 |     expect(after.unchanged).toBe(true)
  1051 |     expect(after.version).toBe(0)
  1052 |   })
  1053 |
```

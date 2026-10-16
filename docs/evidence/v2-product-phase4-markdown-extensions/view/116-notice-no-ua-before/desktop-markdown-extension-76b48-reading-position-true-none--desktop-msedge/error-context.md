# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: desktop-markdown-extensions.spec.ts >> timed-out preparation preserves the uncached near-end reading position (true, none)
- Location: tests/e2e/desktop-markdown-extensions.spec.ts:731:5

# Error details

```
Error: expect(received).toBeCloseTo(expected, precision)

Expected: 640
Received: 670

Expected precision:    0
Expected difference: < 0.5
Received difference:   30
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
                - generic [ref=e43]: retained 中文😀 body
                - generic [ref=e45]: retained 中文😀 body
                - generic [ref=e47]: retained 中文😀 body
                - generic [ref=e49]: retained 中文😀 body
                - generic [ref=e51]: retained 中文😀 body
                - generic [ref=e53]: retained 中文😀 body
                - generic [ref=e55]: retained 中文😀 body
                - generic [ref=e57]: retained 中文😀 body
                - generic [ref=e59]: retained 中文😀 body
                - generic [ref=e61]: retained 中文😀 body
                - generic [ref=e63]: retained 中文😀 body
                - generic [ref=e65]: retained 中文😀 body
                - generic [ref=e67]: retained 中文😀 body
                - generic [ref=e69]: retained 中文😀 body
                - generic [ref=e71]: retained 中文😀 body
                - generic [ref=e73]: retained 中文😀 body
                - generic [ref=e75]: retained 中文😀 body
                - generic [ref=e77]: retained 中文😀 body
                - generic [ref=e79]: retained 中文😀 body
                - generic [ref=e81]: retained 中文😀 body
                - generic [ref=e83]: retained 中文😀 body
                - generic [ref=e85]: retained 中文😀 body
                - generic [ref=e87]: retained 中文😀 body
                - generic [ref=e89]: retained 中文😀 body
                - generic [ref=e91]: retained 中文😀 body
                - generic [ref=e93]: retained 中文😀 body
                - generic [ref=e95]: retained 中文😀 body
                - generic [ref=e97]: retained 中文😀 body
                - generic [ref=e99]: retained 中文😀 body
                - generic [ref=e101]: retained 中文😀 body
                - generic [ref=e103]: retained 中文😀 body
                - generic [ref=e105]: retained 中文😀 body
                - generic [ref=e107]: retained 中文😀 body
                - generic [ref=e109]: retained 中文😀 body
                - generic [ref=e111]: retained 中文😀 body
                - generic [ref=e113]: retained 中文😀 body
                - generic [ref=e115]: retained 中文😀 body
                - generic [ref=e117]: retained 中文😀 body
                - generic [ref=e119]: retained 中文😀 body
                - generic [ref=e121]: retained 中文😀 body
                - generic [ref=e123]: retained 中文😀 body
                - generic [ref=e125]: SAMPLE-REMOTE
                - generic [ref=e126]:
                    - generic [ref=e128]: final
                    - group "Prepared reference" [ref=e129]
            - textbox "Markdown 编辑器"
```

# Test source

```ts
  804 |           }
  805 |           const replaceChildren = view.contentDOM.replaceChildren.bind(view.contentDOM)
  806 |           view.contentDOM.replaceChildren = (...nodes: (Node | string)[]) => {
  807 |             observe('before-source-replacement')
  808 |             replaceChildren(...nodes)
  809 |             observe('after-source-replacement')
  810 |           }
  811 |           const interval = setInterval(() => observe('interval'), 100)
  812 |           view.setDocumentPresentation({
  813 |             provide: async (
  814 |               { sourceIdentity: _i, sourceVersion: _v, documentVersion: _d, ...window }: any,
  815 |               { signal }: any,
  816 |             ) => {
  817 |               const index = requests.length
  818 |               requests.push({
  819 |                 at: performance.now(),
  820 |                 fromLine: window.fromLine,
  821 |                 toLine: window.toLine,
  822 |               })
  823 |               if (index < 2)
  824 |                 await new Promise((_resolve, reject) =>
  825 |                   signal.addEventListener(
  826 |                     'abort',
  827 |                     () => {
  828 |                       observe('deadline-abort')
  829 |                       reject(signal.reason)
  830 |                     },
  831 |                     { once: true },
  832 |                   ),
  833 |                 )
  834 |               return {
  835 |                 declarations: [{ id: 'fixture', contexts: ['text'] }],
  836 |                 request: {
  837 |                   ...window,
  838 |                   documentId: source.documentId,
  839 |                   version: 0,
  840 |                   contextKnown: true,
  841 |                   blocks: [],
  842 |                   protectedRanges: [],
  843 |                   theme: 'light',
  844 |                   target: 'screen',
  845 |                 },
  846 |                 result: {
  847 |                   complete: true,
  848 |                   fragments: [
  849 |                     {
  850 |                       from: text.indexOf('[reference]'),
  851 |                       to: text.length,
  852 |                       accessibleText: 'Prepared reference',
  853 |                       layout: 'inline',
  854 |                       content: { type: 'text', text: 'Prepared reference' },
  855 |                     },
  856 |                   ],
  857 |                 },
  858 |               }
  859 |             },
  860 |           })
  861 |           ;(window as any).noticeLayoutProbe = {
  862 |             view,
  863 |             source,
  864 |             text,
  865 |             from,
  866 |             requests,
  867 |             observations,
  868 |             finish: async () => {
  869 |               clearInterval(interval)
  870 |               observe('final')
  871 |               return {
  872 |                 observations,
  873 |                 requests,
  874 |                 version: source.version,
  875 |                 selection: (windowed ? view.selection : view.state.selection).main,
  876 |                 unchanged: windowed
  877 |                   ? (await source.readLineWindow(1, source.lineCount)).text === text
  878 |                   : view.state.doc.text === text,
  879 |               }
  880 |             },
  881 |           }
  882 |         },
  883 |         {
  884 |           windowed,
  885 |           anchoring,
  886 |           viewModule: `/@fs${resolve('packages/view-dom/src/index.ts')}`,
  887 |           coreModule: `/@fs${resolve('packages/core/src/index.ts')}`,
  888 |         },
  889 |       )
  890 |       await expect
  891 |         .poll(() => page.evaluate(() => (window as any).noticeLayoutProbe.requests.length), {
  892 |           timeout: 30000,
  893 |         })
  894 |         .toBeGreaterThanOrEqual(3)
  895 |       await expect(
  896 |         page.locator('[data-notice-layout-probe] [data-document-presentation]'),
  897 |       ).toHaveCount(1)
  898 |       await page.waitForTimeout(200)
  899 |       const result = await page.evaluate(() => (window as any).noticeLayoutProbe.finish())
  900 |       await writeFile(test.info().outputPath('notice-layout.json'), JSON.stringify(result, null, 2))
  901 |       await page.screenshot({ path: test.info().outputPath('notice-layout.png'), fullPage: true })
  902 |       const baseline = result.observations[0]
  903 |       const final = result.observations.at(-1)
> 904 |       expect(final.top).toBeCloseTo(baseline.top, 0)
      |                         ^ Error: expect(received).toBeCloseTo(expected, precision)
  905 |       expect(final.top).toBeGreaterThanOrEqual(final.viewportTop)
  906 |       expect(final.bottom).toBeLessThanOrEqual(final.viewportBottom)
  907 |       expect(result.version).toBe(0)
  908 |       expect(result.unchanged).toBe(true)
  909 |     })
  910 |
```

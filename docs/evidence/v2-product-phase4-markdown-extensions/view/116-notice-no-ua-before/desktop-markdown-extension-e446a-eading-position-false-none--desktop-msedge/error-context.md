# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: desktop-markdown-extensions.spec.ts >> timed-out preparation preserves the uncached near-end reading position (false, none)
- Location: tests/e2e/desktop-markdown-extensions.spec.ts:731:5

# Error details

```
Error: expect(received).toBeCloseTo(expected, precision)

Expected: 640
Received: 700

Expected precision:    0
Expected difference: < 0.5
Received difference:   60
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
                - generic [ref=e42]: retained 中文😀 body
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
                - generic [ref=e156]: retained 中文😀 body
                - generic [ref=e158]: retained 中文😀 body
                - generic [ref=e160]: retained 中文😀 body
                - generic [ref=e162]: retained 中文😀 body
                - generic [ref=e164]: retained 中文😀 body
                - generic [ref=e166]: retained 中文😀 body
                - generic [ref=e168]: retained 中文😀 body
                - generic [ref=e170]: retained 中文😀 body
                - generic [ref=e172]: retained 中文😀 body
                - generic [ref=e174]: retained 中文😀 body
                - generic [ref=e176]: retained 中文😀 body
                - generic [ref=e178]: retained 中文😀 body
                - generic [ref=e180]: retained 中文😀 body
                - generic [ref=e182]: retained 中文😀 body
                - generic [ref=e184]: retained 中文😀 body
                - generic [ref=e186]: retained 中文😀 body
                - generic [ref=e188]: retained 中文😀 body
                - generic [ref=e190]: retained 中文😀 body
                - generic [ref=e192]: retained 中文😀 body
                - generic [ref=e194]: retained 中文😀 body
                - generic [ref=e196]: retained 中文😀 body
                - generic [ref=e198]: retained 中文😀 body
                - generic [ref=e200]: retained 中文😀 body
                - generic [ref=e202]: retained 中文😀 body
                - generic [ref=e204]: retained 中文😀 body
                - generic [ref=e206]: retained 中文😀 body
                - generic [ref=e208]: retained 中文😀 body
                - generic [ref=e210]: retained 中文😀 body
                - generic [ref=e212]: retained 中文😀 body
                - generic [ref=e214]: retained 中文😀 body
                - generic [ref=e216]: retained 中文😀 body
                - generic [ref=e218]: retained 中文😀 body
                - generic [ref=e220]: retained 中文😀 body
                - generic [ref=e222]: retained 中文😀 body
                - generic [ref=e224]: retained 中文😀 body
                - generic [ref=e226]: retained 中文😀 body
                - generic [ref=e228]: retained 中文😀 body
                - generic [ref=e230]: retained 中文😀 body
                - generic [ref=e232]: retained 中文😀 body
                - generic [ref=e234]: retained 中文😀 body
                - generic [ref=e236]: retained 中文😀 body
                - generic [ref=e238]: retained 中文😀 body
                - generic [ref=e240]: retained 中文😀 body
                - generic [ref=e242]: retained 中文😀 body
                - generic [ref=e244]: retained 中文😀 body
                - generic [ref=e246]: retained 中文😀 body
                - generic [ref=e248]: retained 中文😀 body
                - generic [ref=e250]: retained 中文😀 body
                - generic [ref=e252]: retained 中文😀 body
                - generic [ref=e254]: retained 中文😀 body
                - generic [ref=e256]: retained 中文😀 body
                - generic [ref=e258]: retained 中文😀 body
                - generic [ref=e260]: retained 中文😀 body
                - generic [ref=e262]: retained 中文😀 body
                - generic [ref=e264]: retained 中文😀 body
                - generic [ref=e266]: retained 中文😀 body
                - generic [ref=e268]: retained 中文😀 body
                - generic [ref=e270]: retained 中文😀 body
                - generic [ref=e272]: retained 中文😀 body
                - generic [ref=e274]: retained 中文😀 body
                - generic [ref=e276]: retained 中文😀 body
                - generic [ref=e278]: SAMPLE-REMOTE
                - generic [ref=e279]:
                    - generic [ref=e281]: final
                    - group "Prepared reference" [ref=e282]
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

# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: desktop-workspace.spec.ts >> trusted workspace commands cross the actual Worker and retain asynchronous capabilities; recent paths persist
- Location: tests/e2e/desktop-workspace.spec.ts:136:1

# Error details

```
Error: expect(received).toBe(expected) // Object.is equality

Expected: "[\"docs/a.md\"]"
Received: null
```

# Page snapshot

```yaml
- main [ref=e3]:
    - generic [ref=e4]:
        - button "菜单" [ref=e5] [cursor=pointer]:
            - img [ref=e6]
        - generic [ref=e7]:
            - heading "a" [level=1] [ref=e8]
            - paragraph [ref=e9]: /notes/docs
        - generic "窗口控制" [ref=e10]:
            - button "最小化" [ref=e11] [cursor=pointer]
            - button "最大化" [ref=e13] [cursor=pointer]
            - button "关闭窗口" [ref=e15] [cursor=pointer]
    - generic [ref=e17]:
        - complementary "工作区" [ref=e18]:
            - region "工作区" [ref=e20]:
                - button "工作区" [expanded] [ref=e21] [cursor=pointer]:
                    - img [ref=e22]
                    - generic [ref=e24]: 工作区
                - generic [ref=e26]:
                    - generic [ref=e27]:
                        - button "选择工作区文件夹" [ref=e28] [cursor=pointer]: 更换文件夹…
                        - button "刷新" [ref=e29] [cursor=pointer]
                    - generic [ref=e30]: Notes
                    - status [ref=e31]: 操作未完成。
                    - alert [ref=e32]: 文件已打开，但最近文件记录未能保存。
                    - tree "工作区文件" [ref=e33]:
                        - treeitem "docs" [expanded] [level=1] [ref=e34] [cursor=pointer]: ▾ docs
                        - treeitem "docs/a.md" [level=2] [ref=e35] [cursor=pointer]: a.md
                    - generic [ref=e36]: 最近打开
                    - generic "最近文件" [ref=e37]:
                        - button "最近文件：docs/a.md" [ref=e38] [cursor=pointer]: docs/a.md
        - separator "调整侧栏宽度" [ref=e39]
        - generic [ref=e42]:
            - textbox [ref=e43]:
                - generic [ref=e44]:
                    - text: '#'
                    - generic [ref=e46]: Workspace file
                - generic [ref=e48]: Body
            - textbox "Markdown 编辑器" [active]
    - generic [ref=e50]:
        - generic [ref=e51]:
            - button "侧栏" [pressed] [ref=e52] [cursor=pointer]:
                - img [ref=e53]
            - button "实时" [ref=e56] [cursor=pointer]:
                - img [ref=e57]
        - generic [ref=e60]:
            - generic [ref=e61]: Markdown
            - generic [ref=e62]: 22 字符
            - generic [ref=e65]: 已保存
```

# Test source

```ts
  59  |             }
  60  |           }
  61  |           if (command === 'workspace_finish_open' && args.accepted) state.opened++
  62  |           if (
  63  |             [
  64  |               'workspace_finish_open',
  65  |               'workspace_validate_open',
  66  |               'workspace_release_root',
  67  |               'workspace_release_scope',
  68  |               'workspace_cancel_cursor',
  69  |             ].includes(command)
  70  |           )
  71  |             return undefined
  72  |           throw Error(`Unexpected workspace command: ${command}`)
  73  |         },
  74  |       })
  75  |       const record = {
  76  |         manifest,
  77  |         manifestPath: '/plugins/workspace/plugin.json',
  78  |         rootPath: '/plugins/workspace',
  79  |         sourcePath: '/plugins/workspace/plugin.json',
  80  |         state: 'installed',
  81  |         enabled: false,
  82  |         installedAt: 1,
  83  |         updatedAt: 1,
  84  |         trust: 'development',
  85  |         approvals: { permissions: [], hosts: ['worker'] },
  86  |         errors: [],
  87  |       }
  88  |       localStorage.setItem(
  89  |         'milkup.desktop.plugins.registry.v1',
  90  |         JSON.stringify({ version: 1, records: [record], auditRecords: [] }),
  91  |       )
  92  |     },
  93  |     { manifest },
  94  |   )
  95  |   // Exercise the actual controller, command runtime, Worker, SDK and broker. Only IPC is mocked.
  96  |   await page.route(/\/src\/plugin-workspace-service\.ts(?:\?|$)/, async (route) => {
  97  |     const response = await route.fetch()
  98  |     const body = (await response.text()).replace(
  99  |       'async function nativeWorkspaceInvoke(command, args) {',
  100 |       'async function nativeWorkspaceInvoke(command, args) { return window.workspaceTransport(command, args);',
  101 |     )
  102 |     expect(body).toContain('return window.workspaceTransport(command, args);')
  103 |     await route.fulfill({ response, body })
  104 |   })
  105 |   await page.goto('/')
  106 | }
  107 |
  108 | async function state(page: Page): Promise<WorkspaceFixture> {
  109 |   return page.evaluate(
  110 |     () => (window as unknown as { workspaceFixture: WorkspaceFixture }).workspaceFixture,
  111 |   )
  112 | }
  113 | async function enable(page: Page): Promise<void> {
  114 |   await page.getByRole('button', { name: '菜单', exact: true }).click()
  115 |   await page.getByRole('button', { name: '插件', exact: true }).click()
  116 |   await page.getByRole('button', { name: 'Milkup Workspace', exact: true }).click()
  117 |   expect((await state(page)).calls).toHaveLength(0)
  118 |   await expect(page.getByRole('button', { name: '选择工作区文件夹' })).toHaveCount(0)
  119 |   await page.getByRole('button', { name: '批准能力', exact: true }).click()
  120 |   await page.getByRole('button', { name: '启用', exact: true }).click()
  121 |   await expect(page.locator('.plugin-state')).toHaveText('已启用')
  122 |   await page.keyboard.press('Escape')
  123 |   await page.keyboard.press('Escape')
  124 |   await page.locator('[data-sidebar-toggle]').click()
  125 |   await expect(page.getByRole('button', { name: '选择工作区文件夹' })).toBeVisible()
  126 | }
  127 | async function chooseAndExpand(page: Page): Promise<void> {
  128 |   await page.getByRole('button', { name: '选择工作区文件夹' }).click()
  129 |   const directory = page.getByRole('treeitem', { name: 'docs', exact: true })
  130 |   await expect(directory).toBeVisible()
  131 |   await directory.focus()
  132 |   await page.keyboard.press('ArrowRight')
  133 |   await expect(page.getByRole('treeitem', { name: 'docs/a.md', exact: true })).toBeVisible()
  134 | }
  135 |
  136 | test('trusted workspace commands cross the actual Worker and retain asynchronous capabilities; recent paths persist', async ({
  137 |   page,
  138 | }) => {
  139 |   await fixture(page)
  140 |   await enable(page)
  141 |   await chooseAndExpand(page)
  142 |   expect((await state(page)).chosen).toBe(1)
  143 |   const file = page.getByRole('treeitem', { name: 'docs/a.md', exact: true })
  144 |   await file.click()
  145 |   await expect(page.locator('[data-stat="document-id"]')).toHaveText('file:/notes/docs/a.md')
  146 |   await expect(page.locator('.milkup-editor')).toContainText('Workspace file')
  147 |   const recent = page.getByRole('button', { name: '最近文件：docs/a.md', exact: true })
  148 |   await expect(recent).toBeVisible()
  149 |   expect((await state(page)).opened).toBe(1)
  150 |   await recent.click()
  151 |   await expect.poll(async () => (await state(page)).opened).toBe(2)
  152 |   expect((await state(page)).calls.some((call) => call.command === 'workspace_resolve_entry')).toBe(
  153 |     true,
  154 |   )
  155 |   expect(
  156 |     await page.evaluate(() =>
  157 |       localStorage.getItem('milkup.plugin.storage.milkup.workspace.recent:v1:stable-notes'),
  158 |     ),
> 159 |   ).toBe('["docs/a.md"]')
      |     ^ Error: expect(received).toBe(expected) // Object.is equality
  160 |   // Reload retains only relative recent metadata; renewed folder selection is still required.
  161 |   await page.reload()
  162 |   await enable(page)
  163 |   await expect(page.getByRole('button', { name: '最近文件：docs/a.md' })).toHaveCount(0)
  164 |   expect((await state(page)).chosen).toBe(0)
  165 |   await chooseAndExpand(page)
  166 |   await expect(page.getByRole('button', { name: '最近文件：docs/a.md' })).toBeVisible()
  167 | })
  168 |
  169 | test('scripted workspace actions receive no authority and dirty cancellation preserves the document', async ({
  170 |   page,
  171 | }) => {
  172 |   await fixture(page)
  173 |   await enable(page)
  174 |   await page
  175 |     .getByRole('button', { name: '选择工作区文件夹' })
  176 |     .evaluate((button) => (button as HTMLButtonElement).click())
  177 |   await expect(page.getByRole('alert')).toContainText('gesture-required')
  178 |   expect((await state(page)).chosen).toBe(0)
  179 |   await chooseAndExpand(page)
  180 |   const file = page.getByRole('treeitem', { name: 'docs/a.md', exact: true })
  181 |   await file.evaluate((button) => (button as HTMLButtonElement).click())
  182 |   await expect(page.getByRole('alert')).toContainText('gesture-required')
  183 |   expect((await state(page)).opened).toBe(0)
  184 |   await page.keyboard.press('Control+1')
  185 |   await page.locator('.milkup-editor').click()
  186 |   await page.keyboard.type('keep my draft')
  187 |   await file.click()
  188 |   await expect(page.locator('[data-close-confirm]')).toBeVisible()
  189 |   await page.locator('[data-close-confirm-action="cancel"]').click()
  190 |   await expect(page.locator('[data-close-confirm]')).toBeHidden()
  191 |   await expect(page.locator('.milkup-editor')).toContainText('keep my draft')
  192 |   await expect(page.getByRole('button', { name: '最近文件：docs/a.md' })).toHaveCount(0)
  193 |   expect((await state(page)).opened).toBe(0)
  194 |   expect(
  195 |     (await state(page)).calls.filter((call) => call.command === 'workspace_prepare_open'),
  196 |   ).toHaveLength(0)
  197 | })
  198 |
```

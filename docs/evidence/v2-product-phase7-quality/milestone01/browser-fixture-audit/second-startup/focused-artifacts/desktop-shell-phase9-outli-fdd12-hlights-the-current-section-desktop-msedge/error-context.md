# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: desktop-shell.spec.ts >> phase9 outline updates renamed headings and highlights the current section
- Location: tests/e2e/desktop-shell.spec.ts:1205:1

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: locator('[data-plugin-ui="milkup.outline:outline-panel"]').getByRole('button', { name: '跳转到 First，第 1 行', exact: true })
Expected: visible
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 5000ms
  - waiting for locator('[data-plugin-ui="milkup.outline:outline-panel"]').getByRole('button', { name: '跳转到 First，第 1 行', exact: true })

```

```yaml
- main:
  - button "菜单"
  - heading "未命名" [level=1]
  - paragraph: 未保存
  - button "最小化"
  - button "最大化"
  - button "关闭窗口"
  - complementary "工作区":
    - region "大纲":
      - button "大纲" [expanded]
      - text: 全文索引完成 · 2 个标题 · 4 行
      - button "全部展开"
      - button "全部折叠"
      - tree "文档大纲":
        - button "折叠 First" [expanded]: ▾
        - treeitem "跳转到 First，第 1 行" [expanded] [level=1]: First
        - treeitem "跳转到 Third，第 3 行" [level=3]: Third
  - separator "调整侧栏宽度"
  - textbox
  - textbox "Markdown 编辑器"
  - button "侧栏" [pressed]
  - button "实时"
  - text: Markdown 27 字符 未保存
```

# Test source

```ts
  1119 |   await expect(page.locator('.milkup-line[data-line="4"] .milkup-table-cell').nth(1)).toHaveText(
  1120 |     'new',
  1121 |   )
  1122 | })
  1123 | test('rendered table copy offers HTML and exact Markdown; source copy stays plain', async ({
  1124 |   page,
  1125 |   context,
  1126 | }) => {
  1127 |   await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  1128 |   await page.goto('/')
  1129 |   const source = '| 名称 | Value |\n| :--- | ---: |\n| A & <x> | **1**<br>two |'
  1130 |   await page.locator('.milkup-input-proxy').focus()
  1131 |   await page.keyboard.insertText(source)
  1132 |   await page.keyboard.press('Control+a')
  1133 |   await page.keyboard.press('Control+c')
  1134 |   const payload = await page.evaluate(async () => {
  1135 |     const item = (await navigator.clipboard.read())[0]!
  1136 |     return {
  1137 |       text: await (await item.getType('text/plain')).text(),
  1138 |       html: await (await item.getType('text/html')).text(),
  1139 |     }
  1140 |   })
  1141 |   expect(payload.text).toBe(source)
  1142 |   const structure = await page.evaluate((html) => {
  1143 |     const doc = new DOMParser().parseFromString(html, 'text/html')
  1144 |     return {
  1145 |       rows: doc.querySelectorAll('table tr').length,
  1146 |       headers: doc.querySelectorAll('th').length,
  1147 |       cell: doc.querySelector('td')?.textContent,
  1148 |       breaks: doc.querySelectorAll('td br').length,
  1149 |       scripts: doc.querySelectorAll('script').length,
  1150 |     }
  1151 |   }, payload.html)
  1152 |   expect(structure).toEqual({ rows: 2, headers: 2, cell: 'A & <x>', breaks: 1, scripts: 0 })
  1153 |   await page.keyboard.press('Control+1')
  1154 |   await page.keyboard.press('Control+c')
  1155 |   expect(
  1156 |     await page.evaluate(async () => (await navigator.clipboard.read())[0]!.types),
  1157 |   ).not.toContain('text/html')
  1158 |   expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(source)
  1159 | })
  1160 | test('native-style multiline clipboard paste stays within a cell and table exit is undoable', async ({
  1161 |   page,
  1162 |   context,
  1163 | }) => {
  1164 |   await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  1165 |   await openEditableTable(page)
  1166 |   await page.evaluate(() => navigator.clipboard.writeText('one\ntwo|three'))
  1167 |   await page.keyboard.press('Control+v')
  1168 |   await expect(page.locator('.milkup-line[data-line="3"] .milkup-table-cell')).toHaveCount(2)
  1169 |   await page.keyboard.press('Control+1')
  1170 |   await expect(page.locator('.milkup-line[data-line="3"]')).toHaveText('| one<br>two\\|three | 1 |')
  1171 |   await page.keyboard.press('Control+2')
  1172 |   await page.keyboard.press('Control+z')
  1173 |   await page.getByRole('button', { name: '退出表格', exact: true }).click()
  1174 |   // The public Worker command commits asynchronously; observe its structural
  1175 |   // result before issuing the next, independent typing transaction.
  1176 |   await expect(page.locator('.milkup-line[data-line="6"]')).toHaveCount(1)
  1177 |   await expect(page.locator('.milkup-input-proxy')).toBeFocused()
  1178 |   await page.keyboard.type('after')
  1179 |   await expect(page.locator('.milkup-line[data-line="6"]')).toHaveText('after')
  1180 |   await page.keyboard.press('Control+z')
  1181 |   await page.keyboard.press('Control+z')
  1182 |   await expect(page.locator('.milkup-line')).toHaveCount(4)
  1183 | })
  1184 | 
  1185 | test('phase9 search updates queries and keeps keyboard navigation in the search box', async ({
  1186 |   page,
  1187 | }) => {
  1188 |   await page.goto('/')
  1189 |   await page.locator('.milkup-input-proxy').focus()
  1190 |   await page.keyboard.insertText('alpha target beta target')
  1191 |   await page.keyboard.press('Control+f')
  1192 |   const search = page.getByRole('searchbox', { name: '搜索', exact: true })
  1193 |   await search.fill('target')
  1194 |   await expect(page.locator('[data-search-result-count]')).toHaveText('1/2')
  1195 |   await expect(search).toBeFocused()
  1196 |   await search.press('Enter')
  1197 |   await expect(page.locator('[data-search-result-count]')).toHaveText('2/2')
  1198 |   await search.press('Shift+Enter')
  1199 |   await expect(page.locator('[data-search-result-count]')).toHaveText('1/2')
  1200 |   await search.fill('missing')
  1201 |   await expect(page.locator('[data-search-result-count]')).toHaveText('0/0')
  1202 |   await expect(page.locator('.milkup-search-highlight')).toHaveCount(0)
  1203 | })
  1204 | 
  1205 | test('phase9 outline updates renamed headings and highlights the current section', async ({
  1206 |   page,
  1207 | }) => {
  1208 |   await page.addInitScript(
  1209 |     (registry) => localStorage.setItem('milkup.desktop.plugins.registry.v1', registry),
  1210 |     await sealRegistryFixture(page, outlineRegistry(600)),
  1211 |   )
  1212 |   await page.goto('/')
  1213 |   await page.locator('.milkup-input-proxy').focus()
  1214 |   await page.keyboard.insertText('# First\nbody\n### Third\ntext')
  1215 |   await page.getByRole('button', { name: '侧栏', exact: true }).click()
  1216 |   const outline = page.locator('[data-plugin-ui="milkup.outline:outline-panel"]')
  1217 |   await expect(
  1218 |     outline.getByRole('button', { name: '跳转到 First，第 1 行', exact: true }),
> 1219 |   ).toBeVisible()
       |     ^ Error: expect(locator).toBeVisible() failed
  1220 |   await outline.getByRole('button', { name: '跳转到 First，第 1 行', exact: true }).click()
  1221 |   await expect(page.locator('.milkup-input-proxy')).toBeFocused()
  1222 |   await page.keyboard.press('End')
  1223 |   await page.keyboard.insertText(' renamed')
  1224 |   await expect(
  1225 |     outline.getByRole('button', { name: '跳转到 First renamed，第 1 行', exact: true }),
  1226 |   ).toBeVisible()
  1227 | })
  1228 | 
  1229 | test('phase9 literal replacement preserves Unicode offsets and one undo boundary', async ({
  1230 |   page,
  1231 | }) => {
  1232 |   await page.goto('/')
  1233 |   await page.keyboard.insertText('İ foo 😀 FOO [x] .*')
  1234 |   await page.keyboard.press('Control+f')
  1235 |   const search = page.getByRole('searchbox', { name: '搜索', exact: true })
  1236 |   await search.fill('foo')
  1237 |   await expect(page.locator('[data-search-result-count]')).toHaveText('1/2')
  1238 |   await page.getByRole('button', { name: '区分大小写', exact: true }).click()
  1239 |   await expect(page.locator('[data-search-result-count]')).toHaveText('1/1')
  1240 |   await page.getByRole('textbox', { name: '替换为', exact: true }).fill('$1中')
  1241 |   await page.getByRole('button', { name: '替换', exact: true }).click()
  1242 |   await expect(page.locator('.milkup-editor-content')).toHaveText('İ $1中 😀 FOO [x] .*')
  1243 |   await expect(page.locator('[data-search-message]')).toHaveText('没有匹配结果')
  1244 |   await search.focus()
  1245 |   await search.press('Control+a')
  1246 |   await search.press('Backspace')
  1247 |   await search.press('f')
  1248 |   await expect(search).toHaveValue('f')
  1249 |   await expect(page.locator('.milkup-editor-content')).toHaveText('İ $1中 😀 FOO [x] .*')
  1250 |   await search.press('Escape')
  1251 |   await expect(page.locator('.milkup-input-proxy')).toBeFocused()
  1252 |   await page.keyboard.press('Control+z')
  1253 |   await expect(page.locator('.milkup-editor-content')).toHaveText('İ foo 😀 FOO [x] .*')
  1254 |   await page.keyboard.press('Control+Shift+z')
  1255 |   await expect(page.locator('.milkup-editor-content')).toHaveText('İ $1中 😀 FOO [x] .*')
  1256 | })
  1257 | 
  1258 | test('phase9 replace all deletes literally and rejects a stale query', async ({ page }) => {
  1259 |   await page.goto('/')
  1260 |   await page.keyboard.insertText('aa .* aa .*')
  1261 |   await page.keyboard.press('Control+h')
  1262 |   await expect(page.getByRole('textbox', { name: '替换为', exact: true })).toBeFocused()
  1263 |   const search = page.getByRole('searchbox', { name: '搜索', exact: true })
  1264 |   await search.fill('.*')
  1265 |   await expect(page.locator('[data-search-result-count]')).toHaveText('1/2')
  1266 |   await page.getByRole('button', { name: '全部替换', exact: true }).click()
  1267 |   await expect(page.locator('.milkup-editor-content')).toHaveText('aa  aa ')
  1268 |   await expect(page.locator('[data-search-result-count]')).toHaveText('0/0')
  1269 |   await search.fill('[')
  1270 |   await expect(page.locator('[data-search-message]')).toHaveText('没有匹配结果')
  1271 |   await expect(page.getByRole('button', { name: '全部替换', exact: true })).toBeDisabled()
  1272 |   await search.press('Escape')
  1273 |   await page.keyboard.press('Control+z')
  1274 |   await expect(page.locator('.milkup-editor-content')).toHaveText('aa .* aa .*')
  1275 | })
  1276 | 
  1277 | test('phase9 editing refreshes results without moving the caret and switching documents clears them', async ({
  1278 |   page,
  1279 | }) => {
  1280 |   await page.goto('/')
  1281 |   await page.keyboard.insertText('target target')
  1282 |   await page.keyboard.press('Control+f')
  1283 |   const search = page.getByRole('searchbox', { name: '搜索', exact: true })
  1284 |   await search.fill('target')
  1285 |   await expect(page.locator('[data-search-result-count]')).toHaveText('1/2')
  1286 |   await search.press('F3')
  1287 |   await expect(page.locator('[data-search-result-count]')).toHaveText('2/2')
  1288 |   await search.press('Shift+F3')
  1289 |   await expect(page.locator('[data-search-result-count]')).toHaveText('1/2')
  1290 |   await page.locator('.milkup-input-proxy').focus()
  1291 |   await page.keyboard.insertText('changed')
  1292 |   await expect(page.locator('[data-search-result-count]')).toHaveText('1/1')
  1293 |   await page.keyboard.insertText('!')
  1294 |   await expect(page.locator('.milkup-editor-content')).toHaveText('changed! target')
  1295 |   await page.keyboard.press('Control+n')
  1296 |   await page.locator('[data-close-confirm-action="discard"].dialog-button').click()
  1297 |   await expect(page.locator('.milkup-editor-content')).toHaveText('')
  1298 |   await expect(page.locator('[data-search-result-count]')).toHaveText('0/0')
  1299 |   await expect(page.locator('.milkup-search-highlight')).toHaveCount(0)
  1300 | })
  1301 | 
  1302 | test('phase9 truncated results are explicit and cannot be replaced as a complete set', async ({
  1303 |   page,
  1304 | }) => {
  1305 |   await page.goto('/')
  1306 |   await page.keyboard.insertText('target '.repeat(205))
  1307 |   await page.keyboard.press('Control+f')
  1308 |   await page.getByRole('searchbox', { name: '搜索', exact: true }).fill('target')
  1309 |   await expect(page.locator('[data-search-result-count]')).toHaveText('1/200+')
  1310 |   await expect(page.locator('[data-search-message]')).toContainText('仅显示前 200 处')
  1311 |   await expect(page.getByRole('button', { name: '全部替换', exact: true })).toBeDisabled()
  1312 |   await expect(page.getByRole('button', { name: '替换', exact: true })).toBeEnabled()
  1313 | })
  1314 | 
  1315 | test('phase9 narrow search and outline stay reachable and source mode removes inline code styling', async ({
  1316 |   page,
  1317 | }) => {
  1318 |   await page.addInitScript(
  1319 |     (registry) => localStorage.setItem('milkup.desktop.plugins.registry.v1', registry),
```
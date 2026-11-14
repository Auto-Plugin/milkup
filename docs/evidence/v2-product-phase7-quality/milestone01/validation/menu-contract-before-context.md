# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: desktop-shell.spec.ts >> phase16 modal menu contains keyboard focus and closes ahead of background search
- Location: tests/e2e/desktop-shell.spec.ts:1410:1

# Error details

```
Error: expect(locator).toBeFocused() failed

Locator:  locator('.milkup-input-proxy')
Expected: focused
Received: inactive
Timeout:  5000ms

Call log:
  - Expect "toBeFocused" with timeout 5000ms
  - waiting for locator('.milkup-input-proxy')
    14 × locator resolved to <textarea tabindex="0" autocomplete="off" spellcheck="false" aria-label="Markdown 编辑器" class="milkup-input-proxy"></textarea>
       - unexpected value "inactive"

```

```yaml
- textbox "Markdown 编辑器"
```

# Test source

```ts
  1325 |   await expect(page.locator('[data-search-result-count]')).toHaveText('1/1')
  1326 |   await expect(page.locator('[data-replace-cancel]')).toBeHidden()
  1327 |   const bounds = await page.evaluate(() => {
  1328 |     const search = document.querySelector('[data-floating-search]')!.getBoundingClientRect()
  1329 |     const editor = document.querySelector('[data-editor-host]')!.getBoundingClientRect()
  1330 |     return {
  1331 |       right: search.right,
  1332 |       bottom: search.bottom,
  1333 |       editorTop: editor.top,
  1334 |       editorHeight: editor.height,
  1335 |       overflow: document.documentElement.scrollWidth > innerWidth,
  1336 |       controls: Array.from(
  1337 |         document.querySelectorAll('[data-floating-search] button, [data-floating-search] input'),
  1338 |       )
  1339 |         .filter((e) => e.getClientRects().length > 0)
  1340 |         .every((e) => {
  1341 |           const r = e.getBoundingClientRect()
  1342 |           return r.left >= search.left && r.right <= search.right
  1343 |         }),
  1344 |     }
  1345 |   })
  1346 |   expect(bounds.right).toBeLessThanOrEqual(760)
  1347 |   expect(bounds.bottom).toBeLessThanOrEqual(bounds.editorTop)
  1348 |   expect(bounds.overflow).toBe(false)
  1349 |   expect(bounds.controls).toBe(true)
  1350 |   expect(bounds.editorHeight).toBeGreaterThanOrEqual(200)
  1351 |   await page.keyboard.press('Escape')
  1352 |   for (let i = 0; i < 3; i++) {
  1353 |     await page.keyboard.press('Control+1')
  1354 |     await expect(page.locator('.milkup-editor')).toHaveAttribute('data-mode', 'source')
  1355 |     await expect(page.locator('.milkup-line[data-line="2"]')).toHaveText('text `code` tail')
  1356 |     const styles = await page.locator('.milkup-line[data-line="2"]').evaluate((e) =>
  1357 |       Array.from(e.querySelectorAll('*')).map((n) => ({
  1358 |         background: getComputedStyle(n).backgroundColor,
  1359 |         font: getComputedStyle(n).fontFamily,
  1360 |         border: getComputedStyle(n).borderWidth,
  1361 |       })),
  1362 |     )
  1363 |     expect(styles.every((s) => s.background === 'rgba(0, 0, 0, 0)' && s.border === '0px')).toBe(
  1364 |       true,
  1365 |     )
  1366 |     await page.keyboard.press('Control+2')
  1367 |   }
  1368 |   await page.getByRole('button', { name: '侧栏', exact: true }).click()
  1369 |   const child = page.getByRole('button', {
  1370 |     name: '跳转到 Child，第 3 行',
  1371 |     exact: true,
  1372 |     includeHidden: true,
  1373 |   })
  1374 |   await child.focus()
  1375 |   await child.press('Enter')
  1376 |   await expect(page.locator('.milkup-input-proxy')).toBeFocused()
  1377 |   await expect(child).toHaveAttribute('aria-current', 'location')
  1378 | })
  1379 | 
  1380 | test('phase10 live table arrows skip delimiters and protect shifted cell selections', async ({
  1381 |   page,
  1382 | }, testInfo) => {
  1383 |   await openEditableTable(page)
  1384 |   await page.keyboard.press('ArrowRight')
  1385 |   await page.keyboard.press('ArrowRight')
  1386 |   await expect(page.locator('.milkup-cursor')).toHaveAttribute(
  1387 |     'data-position',
  1388 |     String(editableTable.indexOf('1')),
  1389 |   )
  1390 |   await page.keyboard.press('ArrowLeft')
  1391 |   await page.keyboard.press('Home')
  1392 |   await page.keyboard.press('ArrowUp')
  1393 |   await expect(page.locator('.milkup-cursor')).toHaveAttribute(
  1394 |     'data-position',
  1395 |     String(editableTable.indexOf('Name')),
  1396 |   )
  1397 |   await page.keyboard.press('ArrowDown')
  1398 |   await page.keyboard.press('Shift+ArrowLeft')
  1399 |   await page.keyboard.press('Shift+ArrowRight')
  1400 |   await page.keyboard.press('Shift+ArrowRight')
  1401 |   await page.keyboard.type('x')
  1402 |   await page.keyboard.press('Control+1')
  1403 |   await expect(page.locator('.milkup-line[data-line="3"]')).toHaveText('| x | 1 |')
  1404 |   await page.keyboard.press('Control+z')
  1405 |   await expect(page.locator('.milkup-line[data-line="3"]')).toHaveText('| A | 1 |')
  1406 |   await page.keyboard.press('Control+2')
  1407 |   await page.screenshot({ path: testInfo.outputPath('table-arrows.png') })
  1408 | })
  1409 | 
  1410 | test('phase16 modal menu contains keyboard focus and closes ahead of background search', async ({
  1411 |   page,
  1412 | }) => {
  1413 |   await page.goto('/')
  1414 |   await page.keyboard.type('keep')
  1415 |   await page.keyboard.press('Control+f')
  1416 |   await page.getByRole('button', { name: '菜单', exact: true }).click()
  1417 |   await page.keyboard.press('Shift+Tab')
  1418 |   await page.keyboard.press('Shift+Tab')
  1419 |   expect(
  1420 |     await page.locator('[data-app-menu]').evaluate((e) => e.contains(document.activeElement)),
  1421 |   ).toBe(true)
  1422 |   await page.keyboard.press('Escape')
  1423 |   await expect(page.locator('[data-app-menu]')).toBeHidden()
  1424 |   await expect(page.locator('[data-floating-search]')).toBeVisible()
> 1425 |   await expect(page.locator('.milkup-input-proxy')).toBeFocused()
       |                                                     ^ Error: expect(locator).toBeFocused() failed
  1426 |   await page.getByRole('button', { name: '菜单', exact: true }).click()
  1427 |   await page.keyboard.press('Control+n')
  1428 |   await expect(page.locator('[data-close-confirm]')).toBeVisible()
  1429 |   await page.keyboard.press('Escape')
  1430 |   await expect(page.locator('[data-app-menu]')).toBeHidden()
  1431 |   await expect(page.locator('.milkup-input-proxy')).toBeFocused()
  1432 | })
  1433 | 
  1434 | test('phase16 F6 reaches shell without plugins and keeps basic table navigation and document text', async ({
  1435 |   page,
  1436 | }) => {
  1437 |   await page.goto('/')
  1438 |   await page.locator('.milkup-input-proxy').focus()
  1439 |   await page.keyboard.insertText(editableTable)
  1440 |   await page.locator('.milkup-line[data-line="3"] .milkup-table-cell').first().click()
  1441 |   await page.keyboard.press('Tab')
  1442 |   await page.keyboard.press('Shift+Tab')
  1443 |   const before = await page.locator('.milkup-editor-content').textContent()
  1444 |   await page.keyboard.press('F6')
  1445 |   await expect(page.locator('[data-sidebar-toggle]')).toBeFocused()
  1446 |   await page.keyboard.press('F6')
  1447 |   await expect(page.locator('[data-menu-toggle]')).toBeFocused()
  1448 |   await page.keyboard.press('Enter')
  1449 |   await page.keyboard.press('Escape')
  1450 |   await expect(page.locator('.milkup-input-proxy')).toBeFocused()
  1451 |   await expect(page.locator('.milkup-input-proxy')).toHaveAttribute('aria-label', 'Markdown 编辑器')
  1452 |   await expect(page.locator('.milkup-input-proxy')).not.toHaveAttribute('aria-hidden', 'true')
  1453 |   await expect(page.locator('.milkup-editor-content')).toHaveText(before!)
  1454 | })
  1455 | 
  1456 | test('phase16 confirmation remains scrollable at a 380 by 260 effective viewport', async ({
  1457 |   page,
  1458 | }) => {
  1459 |   await page.setViewportSize({ width: 380, height: 260 })
  1460 |   await page.goto('/')
  1461 |   await page.keyboard.type('keep')
  1462 |   await page.keyboard.press('Control+n')
  1463 |   const dialog = page.getByRole('dialog', { name: '文档尚未保存' })
  1464 |   const rect = await dialog.boundingBox()
  1465 |   expect(rect!.y).toBeGreaterThanOrEqual(0)
  1466 |   expect(rect!.y + rect!.height).toBeLessThanOrEqual(260)
  1467 |   await page.keyboard.press('Tab')
  1468 |   await page.keyboard.press('Tab')
  1469 |   const save = page.locator('[data-close-confirm-action="save"]')
  1470 |   await expect(save).toBeFocused()
  1471 |   const button = await save.boundingBox()
  1472 |   expect(button!.y).toBeGreaterThanOrEqual(0)
  1473 |   expect(button!.y + button!.height).toBeLessThanOrEqual(260)
  1474 |   await page.keyboard.press('Escape')
  1475 |   await expect(page.locator('.milkup-input-proxy')).toBeFocused()
  1476 | })
  1477 | 
  1478 | test('phase18 theme follows system only when selected, persists explicit dark and keeps contrast', async ({
  1479 |   page,
  1480 | }) => {
  1481 |   await installPreferencesFixture(page, { enabled: true, approved: true })
  1482 |   await page.emulateMedia({ colorScheme: 'light' })
  1483 |   await page.goto('/')
  1484 |   await page.keyboard.insertText('# Heading\n\ntext `code` and [link](https://example.com)\n')
  1485 |   await page.getByRole('button', { name: '菜单', exact: true }).click()
  1486 |   await page.locator('[data-plugin-menu-entry="milkup.preferences:preferences-panel"]').click()
  1487 |   await page.getByRole('combobox', { name: '外观主题', exact: true }).selectOption('dark')
  1488 |   await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  1489 |   const contrast = await page.evaluate(() => {
  1490 |     const css = getComputedStyle(document.documentElement)
  1491 |     const rgb = (value: string) => {
  1492 |       const node = document.createElement('span')
  1493 |       node.style.color = value
  1494 |       document.body.append(node)
  1495 |       const valueRgb = getComputedStyle(node).color
  1496 |       node.remove()
  1497 |       return valueRgb
  1498 |         .match(/[\d.]+/g)!
  1499 |         .slice(0, 3)
  1500 |         .map(Number)
  1501 |     }
  1502 |     const light = (value: string) =>
  1503 |       rgb(value)
  1504 |         .map((n) => {
  1505 |           const v = n / 255
  1506 |           return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  1507 |         })
  1508 |         .reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i]!, 0)
  1509 |     return [
  1510 |       ['--text', '--panel-bg'],
  1511 |       ['--text-muted', '--panel-bg'],
  1512 |       ['--code-text', '--code-bg'],
  1513 |       ['--inline-code-text', '--inline-code-bg'],
  1514 |       ['--on-primary', '--primary-bg'],
  1515 |       ['--danger', '--danger-soft'],
  1516 |     ].map(([fg, bg]) => {
  1517 |       const a = light(css.getPropertyValue(fg!)),
  1518 |         b = light(css.getPropertyValue(bg!))
  1519 |       return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
  1520 |     })
  1521 |   })
  1522 |   expect(contrast.every((r) => r >= 4.5)).toBe(true)
  1523 |   await page.emulateMedia({ colorScheme: 'light' })
  1524 |   await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  1525 |   // Preferences commits through the real Worker broker and host persistence.
```
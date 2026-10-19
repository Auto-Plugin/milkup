# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: desktop-shell.spec.ts >> phase16 F6 reaches shell without plugins and keeps basic table navigation and document text
- Location: tests/e2e/desktop-shell.spec.ts:1441:1

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
  1357 |   await page.keyboard.press('Escape')
  1358 |   for (let i = 0; i < 3; i++) {
  1359 |     await page.keyboard.press('Control+1')
  1360 |     await expect(page.locator('.milkup-editor')).toHaveAttribute('data-mode', 'source')
  1361 |     await expect(page.locator('.milkup-line[data-line="2"]')).toHaveText('text `code` tail')
  1362 |     const styles = await page.locator('.milkup-line[data-line="2"]').evaluate((e) =>
  1363 |       Array.from(e.querySelectorAll('*')).map((n) => ({
  1364 |         background: getComputedStyle(n).backgroundColor,
  1365 |         font: getComputedStyle(n).fontFamily,
  1366 |         border: getComputedStyle(n).borderWidth,
  1367 |       })),
  1368 |     )
  1369 |     expect(styles.every((s) => s.background === 'rgba(0, 0, 0, 0)' && s.border === '0px')).toBe(
  1370 |       true,
  1371 |     )
  1372 |     await page.keyboard.press('Control+2')
  1373 |   }
  1374 |   await page.getByRole('button', { name: '侧栏', exact: true }).click()
  1375 |   const child = page.getByRole('treeitem', {
  1376 |     name: '跳转到 Child，第 3 行',
  1377 |     exact: true,
  1378 |     includeHidden: true,
  1379 |   })
  1380 |   await child.focus()
  1381 |   await child.press('Enter')
  1382 |   await expect(page.locator('.milkup-input-proxy')).toBeFocused()
  1383 |   await expect(child).toHaveAttribute('aria-current', 'location')
  1384 | })
  1385 | 
  1386 | test('phase10 live table arrows skip delimiters and protect shifted cell selections', async ({
  1387 |   page,
  1388 | }, testInfo) => {
  1389 |   await openEditableTable(page)
  1390 |   await page.keyboard.press('ArrowRight')
  1391 |   await page.keyboard.press('ArrowRight')
  1392 |   await expect(page.locator('.milkup-cursor')).toHaveAttribute(
  1393 |     'data-position',
  1394 |     String(editableTable.indexOf('1')),
  1395 |   )
  1396 |   await page.keyboard.press('ArrowLeft')
  1397 |   await page.keyboard.press('Home')
  1398 |   await page.keyboard.press('ArrowUp')
  1399 |   await expect(page.locator('.milkup-cursor')).toHaveAttribute(
  1400 |     'data-position',
  1401 |     String(editableTable.indexOf('Name')),
  1402 |   )
  1403 |   await page.keyboard.press('ArrowDown')
  1404 |   await page.keyboard.press('Shift+ArrowLeft')
  1405 |   await page.keyboard.press('Shift+ArrowRight')
  1406 |   await page.keyboard.press('Shift+ArrowRight')
  1407 |   await page.keyboard.type('x')
  1408 |   await page.keyboard.press('Control+1')
  1409 |   await expect(page.locator('.milkup-line[data-line="3"]')).toHaveText('| x | 1 |')
  1410 |   await page.keyboard.press('Control+z')
  1411 |   await expect(page.locator('.milkup-line[data-line="3"]')).toHaveText('| A | 1 |')
  1412 |   await page.keyboard.press('Control+2')
  1413 |   await page.screenshot({ path: testInfo.outputPath('table-arrows.png') })
  1414 | })
  1415 | 
  1416 | test('phase16 modal menu contains keyboard focus and closes ahead of background search', async ({
  1417 |   page,
  1418 | }) => {
  1419 |   await page.goto('/')
  1420 |   await page.keyboard.type('keep')
  1421 |   await page.keyboard.press('Control+f')
  1422 |   await page.getByRole('button', { name: '菜单', exact: true }).click()
  1423 |   await page.keyboard.press('Shift+Tab')
  1424 |   await page.keyboard.press('Shift+Tab')
  1425 |   expect(
  1426 |     await page.locator('[data-app-menu]').evaluate((e) => e.contains(document.activeElement)),
  1427 |   ).toBe(true)
  1428 |   await page.keyboard.press('Escape')
  1429 |   await expect(page.locator('[data-app-menu]')).toBeHidden()
  1430 |   await expect(page.locator('[data-floating-search]')).toBeVisible()
  1431 |   // P7 returns to the menu invoker while retaining the background search.
  1432 |   await expect(page.getByRole('button', { name: '菜单', exact: true })).toBeFocused()
  1433 |   await page.getByRole('button', { name: '菜单', exact: true }).click()
  1434 |   await page.keyboard.press('Control+n')
  1435 |   await expect(page.locator('[data-close-confirm]')).toBeVisible()
  1436 |   await page.keyboard.press('Escape')
  1437 |   await expect(page.locator('[data-app-menu]')).toBeHidden()
  1438 |   await expect(page.locator('.milkup-input-proxy')).toBeFocused()
  1439 | })
  1440 | 
  1441 | test('phase16 F6 reaches shell without plugins and keeps basic table navigation and document text', async ({
  1442 |   page,
  1443 | }) => {
  1444 |   await page.goto('/')
  1445 |   await page.locator('.milkup-input-proxy').focus()
  1446 |   await page.keyboard.insertText(editableTable)
  1447 |   await page.locator('.milkup-line[data-line="3"] .milkup-table-cell').first().click()
  1448 |   await page.keyboard.press('Tab')
  1449 |   await page.keyboard.press('Shift+Tab')
  1450 |   const before = await page.locator('.milkup-editor-content').textContent()
  1451 |   await page.keyboard.press('F6')
  1452 |   await expect(page.locator('[data-sidebar-toggle]')).toBeFocused()
  1453 |   await page.keyboard.press('F6')
  1454 |   await expect(page.locator('[data-menu-toggle]')).toBeFocused()
  1455 |   await page.keyboard.press('Enter')
  1456 |   await page.keyboard.press('Escape')
> 1457 |   await expect(page.locator('.milkup-input-proxy')).toBeFocused()
       |                                                     ^ Error: expect(locator).toBeFocused() failed
  1458 |   await expect(page.locator('.milkup-input-proxy')).toHaveAttribute('aria-label', 'Markdown 编辑器')
  1459 |   await expect(page.locator('.milkup-input-proxy')).not.toHaveAttribute('aria-hidden', 'true')
  1460 |   await expect(page.locator('.milkup-editor-content')).toHaveText(before!)
  1461 | })
  1462 | 
  1463 | test('phase16 confirmation remains scrollable at a 380 by 260 effective viewport', async ({
  1464 |   page,
  1465 | }) => {
  1466 |   await page.setViewportSize({ width: 380, height: 260 })
  1467 |   await page.goto('/')
  1468 |   await page.keyboard.type('keep')
  1469 |   await page.keyboard.press('Control+n')
  1470 |   const dialog = page.getByRole('dialog', { name: '文档尚未保存' })
  1471 |   const rect = await dialog.boundingBox()
  1472 |   expect(rect!.y).toBeGreaterThanOrEqual(0)
  1473 |   expect(rect!.y + rect!.height).toBeLessThanOrEqual(260)
  1474 |   await page.keyboard.press('Tab')
  1475 |   await page.keyboard.press('Tab')
  1476 |   const save = page.locator('[data-close-confirm-action="save"]')
  1477 |   await expect(save).toBeFocused()
  1478 |   const button = await save.boundingBox()
  1479 |   expect(button!.y).toBeGreaterThanOrEqual(0)
  1480 |   expect(button!.y + button!.height).toBeLessThanOrEqual(260)
  1481 |   await page.keyboard.press('Escape')
  1482 |   await expect(page.locator('.milkup-input-proxy')).toBeFocused()
  1483 | })
  1484 | 
  1485 | test('phase18 theme follows system only when selected, persists explicit dark and keeps contrast', async ({
  1486 |   page,
  1487 | }) => {
  1488 |   await installPreferencesFixture(page, { enabled: true, approved: true })
  1489 |   await page.emulateMedia({ colorScheme: 'light' })
  1490 |   await page.goto('/')
  1491 |   await page.keyboard.insertText('# Heading\n\ntext `code` and [link](https://example.com)\n')
  1492 |   await page.getByRole('button', { name: '菜单', exact: true }).click()
  1493 |   await page.locator('[data-plugin-menu-entry="milkup.preferences:preferences-panel"]').click()
  1494 |   await page.getByRole('combobox', { name: '外观主题', exact: true }).selectOption('dark')
  1495 |   await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  1496 |   const contrast = await page.evaluate(() => {
  1497 |     const css = getComputedStyle(document.documentElement)
  1498 |     const rgb = (value: string) => {
  1499 |       const node = document.createElement('span')
  1500 |       node.style.color = value
  1501 |       document.body.append(node)
  1502 |       const valueRgb = getComputedStyle(node).color
  1503 |       node.remove()
  1504 |       return valueRgb
  1505 |         .match(/[\d.]+/g)!
  1506 |         .slice(0, 3)
  1507 |         .map(Number)
  1508 |     }
  1509 |     const light = (value: string) =>
  1510 |       rgb(value)
  1511 |         .map((n) => {
  1512 |           const v = n / 255
  1513 |           return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  1514 |         })
  1515 |         .reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i]!, 0)
  1516 |     return [
  1517 |       ['--text', '--panel-bg'],
  1518 |       ['--text-muted', '--panel-bg'],
  1519 |       ['--code-text', '--code-bg'],
  1520 |       ['--inline-code-text', '--inline-code-bg'],
  1521 |       ['--on-primary', '--primary-bg'],
  1522 |       ['--danger', '--danger-soft'],
  1523 |     ].map(([fg, bg]) => {
  1524 |       const a = light(css.getPropertyValue(fg!)),
  1525 |         b = light(css.getPropertyValue(bg!))
  1526 |       return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
  1527 |     })
  1528 |   })
  1529 |   expect(contrast.every((r) => r >= 4.5)).toBe(true)
  1530 |   await page.emulateMedia({ colorScheme: 'light' })
  1531 |   await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  1532 |   // Preferences commits through the real Worker broker and host persistence.
  1533 |   const preferences = page.locator('[data-plugin-ui="milkup.preferences:preferences-panel"]')
  1534 |   await preferences.getByRole('button', { name: '保存', exact: true }).click()
  1535 |   await expect(preferences.getByRole('status')).toHaveText('偏好已保存。')
  1536 |   // Browser preview must report unsupported native zoom without pretending to apply it.
  1537 |   await preferences.getByRole('combobox', { name: '界面缩放', exact: true }).selectOption('1.25')
  1538 |   await expect(preferences.getByRole('alert')).toBeVisible()
  1539 |   await expect(page.locator('#app')).toHaveAttribute('data-appearance-zoom', '1')
  1540 |   await preferences.getByRole('button', { name: '取消更改', exact: true }).click()
  1541 |   await expect(preferences.getByRole('combobox', { name: '界面缩放', exact: true })).toHaveValue(
  1542 |     '1',
  1543 |   )
  1544 |   await page.keyboard.press('Escape')
  1545 |   await page.keyboard.press('Control+s')
  1546 |   await page.reload()
  1547 |   await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  1548 |   await page.getByRole('button', { name: '菜单', exact: true }).click()
  1549 |   await page.locator('[data-plugin-menu-entry="milkup.preferences:preferences-panel"]').click()
  1550 |   await page.getByRole('combobox', { name: '外观主题', exact: true }).selectOption('system')
  1551 |   await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  1552 |   await page.emulateMedia({ colorScheme: 'dark' })
  1553 |   await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  1554 | })
  1555 | 
  1556 | test('phase18 narrow sidebar overlays without shrinking text and search controls remain reachable', async ({
  1557 |   page,
```
# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: desktop-markdown-extensions.spec.ts >> official Mermaid DOM host is explicitly unavailable in the browser and keeps source
- Location: tests/e2e/desktop-markdown-extensions.spec.ts:1460:1

# Error details

```
Error: expect(locator).toContainText(expected) failed

Locator: locator('.plugin-errors')
Expected substring: "DOM plugins require the native desktop runtime"
Received string:    "DOM module requires a native catalog generation"
Timeout: 5000ms

Call log:
  - Expect "toContainText" with timeout 5000ms
  - waiting for locator('.plugin-errors')
    14 × locator resolved to <div class="plugin-errors">DOM module requires a native catalog generation</div>
       - unexpected value "DOM module requires a native catalog generation"

```

```yaml
- text: DOM module requires a native catalog generation
```

# Test source

```ts
  1373 |           position: 'fixed',
  1374 |           inset: '37px 0 30px',
  1375 |           zIndex: '10000',
  1376 |           background: 'white',
  1377 |         })
  1378 |         document.body.append(mount)
  1379 |         const view = new SourceDocumentView({
  1380 |           parent: mount,
  1381 |           source: store,
  1382 |           mode,
  1383 |           virtualViewport: { viewportHeight: 126, overscanLines: 2 },
  1384 |         })
  1385 |         await view.renderVisibleWindow()
  1386 |         const target = (await store.readLineWindow(50, 50)).from
  1387 |         const original = store.readLineWindow.bind(store)
  1388 |         let holding = true
  1389 |         const releases: (() => void)[] = [],
  1390 |           reads: unknown[] = []
  1391 |         store.readLineWindow = async (...args: any[]) => {
  1392 |           reads.push({ args, at: performance.now() })
  1393 |           if (holding && args[0] <= 50 && args[1] >= 50)
  1394 |             await new Promise<void>((resolve) => releases.push(resolve))
  1395 |           return original(...args)
  1396 |         }
  1397 |         let outcome = 'pending'
  1398 |         const before = { selection: view.selection.main, version: store.version }
  1399 |         const navigation = view
  1400 |           .revealSelection(50, Selection.cursor(target), {
  1401 |             signal: new AbortController().signal,
  1402 |             assertCurrent: () => {},
  1403 |           })
  1404 |           .then(
  1405 |             () => {
  1406 |               outcome = 'resolved'
  1407 |             },
  1408 |             () => {
  1409 |               outcome = 'rejected'
  1410 |             },
  1411 |           )
  1412 |         const deadline = performance.now() + 2000
  1413 |         while (!releases.length && performance.now() < deadline)
  1414 |           await new Promise((resolve) => setTimeout(resolve, 10))
  1415 |         if (!releases.length) throw Error('Fixture did not hold the target window')
  1416 |         view.dom.scrollTop = 200 * 21
  1417 |         await view.renderVisibleWindow()
  1418 |         const superseding = {
  1419 |           from: view.contentDOM.dataset.fromLine,
  1420 |           to: view.contentDOM.dataset.toLine,
  1421 |         }
  1422 |         holding = false
  1423 |         releases.forEach((release) => release())
  1424 |         await navigation
  1425 |         const result = {
  1426 |           mode,
  1427 |           before,
  1428 |           target,
  1429 |           outcome,
  1430 |           superseding,
  1431 |           after: {
  1432 |             selection: view.selection.main,
  1433 |             version: store.version,
  1434 |             targetPresent: !!view.contentDOM.querySelector('[data-line="50"]'),
  1435 |           },
  1436 |           reads,
  1437 |           unchanged: (await original(1, store.lineCount)).text === text,
  1438 |         }
  1439 |         return result
  1440 |       },
  1441 |       {
  1442 |         mode,
  1443 |         viewModule: `/@fs${resolve('packages/view-dom/src/index.ts')}`,
  1444 |         coreModule: `/@fs${resolve('packages/core/src/index.ts')}`,
  1445 |       },
  1446 |     )
  1447 |     await writeFile(
  1448 |       test.info().outputPath('superseded-navigation.json'),
  1449 |       JSON.stringify(result, null, 2),
  1450 |     )
  1451 |     await page.screenshot({ path: test.info().outputPath('superseded-navigation.png') })
  1452 |     expect(result.outcome === 'rejected' || result.after.selection.head === result.target).toBe(
  1453 |       true,
  1454 |     )
  1455 |     expect(result.unchanged).toBe(true)
  1456 |     expect(result.after.version).toBe(0)
  1457 |   })
  1458 | }
  1459 | 
  1460 | test('official Mermaid DOM host is explicitly unavailable in the browser and keeps source', async ({
  1461 |   page,
  1462 | }) => {
  1463 |   const loads: string[] = []
  1464 |   page.on('request', (request) => {
  1465 |     if (request.url().includes('native-only-placeholder')) loads.push(request.url())
  1466 |   })
  1467 |   await markdownExtensionFixture(page, { nativeDiagramUnavailable: true })
  1468 |   const source = '浏览器保留原文😀\n\n```mermaid\nflowchart LR\nA --> B\n```\n'
  1469 |   await seedMarkdownExtensions(page, source)
  1470 |   await page.getByRole('button', { name: '菜单', exact: true }).click()
  1471 |   await page.getByRole('button', { name: '插件', exact: true }).click()
  1472 |   await page.getByRole('button', { name: 'Milkup Diagrams', exact: true }).click()
> 1473 |   await expect(page.locator('.plugin-errors')).toContainText(
       |                                                ^ Error: expect(locator).toContainText(expected) failed
  1474 |     'DOM plugins require the native desktop runtime',
  1475 |   )
  1476 |   expect(loads).toEqual([])
  1477 |   await page.screenshot({
  1478 |     path: test.info().outputPath('native-dom-unavailable.png'),
  1479 |     fullPage: true,
  1480 |   })
  1481 |   await page.locator('[data-menu-close]').click()
  1482 |   await expect(page.locator('.milkup-document-presentation img')).toHaveCount(0)
  1483 |   await page.keyboard.press('Control+1')
  1484 |   expect(await sourceLines(page)).toEqual(source.split('\n'))
  1485 | })
  1486 | 
  1487 | test('presentation resize delivers finite responsive layout outside ResizeObserver delivery', async ({
  1488 |   page,
  1489 | }) => {
  1490 |   await page.goto('/')
  1491 |   const result = await page.evaluate(
  1492 |     async ({ module }) => {
  1493 |       const { DocumentPresentation } = await import(module)
  1494 |       const errors: string[] = []
  1495 |       const onError = (event: ErrorEvent) => errors.push(event.message)
  1496 |       window.addEventListener('error', onError)
  1497 |       const root = document.createElement('section')
  1498 |       Object.assign(root.style, {
  1499 |         position: 'fixed',
  1500 |         top: '50px',
  1501 |         left: '20px',
  1502 |         width: '300px',
  1503 |         padding: '0',
  1504 |         border: '0',
  1505 |         zIndex: '20000',
  1506 |         background: 'white',
  1507 |       })
  1508 |       const content = document.createElement('div')
  1509 |       content.style.height = '40px'
  1510 |       const source = '中文😀 é source'
  1511 |       const line = document.createElement('div')
  1512 |       line.className = 'milkup-line'
  1513 |       Object.assign(line.dataset, { line: '1', from: '0', to: String(source.length) })
  1514 |       line.textContent = source
  1515 |       content.append(line)
  1516 |       root.append(content)
  1517 |       document.body.append(root)
  1518 |       const identity = {}
  1519 |       const selection = { anchor: 0, head: 2 }
  1520 |       const widths: number[] = []
  1521 |       let layouts = 0
  1522 |       const manager = new DocumentPresentation(
  1523 |         root,
  1524 |         content,
  1525 |         {
  1526 |           provide(window) {
  1527 |             widths.push(window.width)
  1528 |             return {
  1529 |               declarations: [],
  1530 |               request: {
  1531 |                 documentId: 'finite-resize',
  1532 |                 version: 0,
  1533 |                 source: window.source,
  1534 |                 from: window.from,
  1535 |                 to: window.to,
  1536 |                 fromLine: window.fromLine,
  1537 |                 toLine: window.toLine,
  1538 |                 completeStart: window.completeStart,
  1539 |                 completeEnd: window.completeEnd,
  1540 |                 selection: window.selection,
  1541 |                 width: window.width,
  1542 |                 contextKnown: true,
  1543 |                 protectedRanges: [],
  1544 |                 blocks: [],
  1545 |                 theme: 'light',
  1546 |                 target: 'screen',
  1547 |               },
  1548 |               result: { complete: true, fragments: [] },
  1549 |             }
  1550 |           },
  1551 |         },
  1552 |         () => ({
  1553 |           mode: 'live',
  1554 |           sourceIdentity: identity,
  1555 |           sourceVersion: 0,
  1556 |           selection,
  1557 |           lineCount: 1,
  1558 |           read: (from: number, to: number) => source.slice(from, to),
  1559 |         }),
  1560 |         () => {
  1561 |           layouts++
  1562 |           // Finite, idempotent responsive layout: one height transition, no oscillation.
  1563 |           const height = root.getBoundingClientRect().width >= 360 ? '80px' : '40px'
  1564 |           if (content.style.height !== height) content.style.height = height
  1565 |         },
  1566 |         () => {},
  1567 |       )
  1568 |       const frames = async (count: number) => {
  1569 |         for (let i = 0; i < count; i++)
  1570 |           await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  1571 |       }
  1572 |       try {
  1573 |         manager.schedule()
```
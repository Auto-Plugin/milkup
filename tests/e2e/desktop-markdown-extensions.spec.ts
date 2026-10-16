import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import {
  markdownExtensionFixture,
  seedMarkdownExtensions,
} from '../helpers/markdown-extension-plugins'
const sourceLines = (page: Page) =>
  page
    .locator('.milkup-line')
    .evaluateAll((lines) =>
      lines.map((line) =>
        line.getAttribute('data-from') === line.getAttribute('data-to') ? '' : line.textContent,
      ),
    )
const fixture = [
  '安全起点 中文😀',
  '',
  '行内 $x^2 + \\frac{1}{2}$ 末尾',
  '',
  '$$',
  '\\begin{pmatrix}a&b\\\\c&d\\end{pmatrix}',
  '$$',
  '',
  '```mermaid',
  'flowchart LR',
  'A[中文] --> B[结束]',
  '```',
  '',
  '引用[^n]。',
  '',
  '[^n]: 脚注 **正文**',
  '',
  '终点',
].join('\n')
test.afterEach(async ({ page }, info) => {
  if (info.status !== info.expectedStatus) {
    await info.attach('page-state', {
      body: await page.locator('body').ariaSnapshot(),
      contentType: 'text/plain',
    })
    await page.screenshot({ path: info.outputPath('failure.png'), fullPage: true })
  }
})
test('three isolated document extensions render safe semantics and preserve source/history', async ({
  page,
}) => {
  await markdownExtensionFixture(page)
  await seedMarkdownExtensions(page, fixture)
  await expect(page.locator('.milkup-document-presentation math')).toHaveCount(2)
  await expect(page.locator('.milkup-document-presentation svg')).toHaveCount(1)
  await expect(page.locator('.milkup-document-reference').first()).toBeVisible()
  await expect(page.locator('.milkup-document-presentation mtable')).toHaveCount(1)
  const metrics = await page.locator('.milkup-document-presentation').evaluateAll((elements) =>
    elements.map((e) => ({
      width: e.getBoundingClientRect().width,
      height: e.getBoundingClientRect().height,
    })),
  )
  expect(metrics.every((m) => m.width > 0 && m.height > 0)).toBe(true)
  await page.screenshot({
    path: test.info().outputPath('three-extensions-live.png'),
    fullPage: true,
  })
  await page.keyboard.press('Control+1')
  await expect(page.locator('[data-document-presentation]')).toHaveCount(0)
  expect(await sourceLines(page)).toEqual(fixture.split('\n'))
  await page.locator('.milkup-input-proxy').focus()
  await page.keyboard.press('Control+Home')
  await page.keyboard.press('ArrowRight')
  await page.keyboard.insertText('😀')
  await page.keyboard.press('Control+z')
  expect(await sourceLines(page)).toEqual(fixture.split('\n'))
  await page.keyboard.press('Control+Shift+z')
  await expect(page.locator('.milkup-line').first()).toHaveText('安😀全起点 中文😀')
})
test('opaque code and unsupported diagrams stay literal without executable content', async ({
  page,
}) => {
  await markdownExtensionFixture(page)
  const source = [
    '起点',
    '',
    '`$x$`',
    '```js',
    '$x$',
    '```',
    '',
    '```mermaid',
    'flowchart TD',
    'A --> B',
    'click A "https://example.com"',
    '```',
    '',
    '$\\href{javascript:alert(1)}{x}$',
    '',
    '尾',
  ].join('\n')
  await seedMarkdownExtensions(page, source)
  await expect(page.locator('.milkup-editor-content')).toHaveAttribute(
    'data-document-presentation-status',
    'fallback',
  )
  await expect(page.locator('.milkup-document-presentation math')).toHaveCount(0)
  await expect(page.locator('.milkup-document-presentation svg')).toHaveCount(0)
  await page.keyboard.press('Control+1')
  expect(await sourceLines(page)).toEqual(source.split('\n'))
})
test('footnote navigation reveals editable original and remains read only', async ({ page }) => {
  await markdownExtensionFixture(page)
  await seedMarkdownExtensions(page, fixture)
  await expect(page.locator('.milkup-document-reference').first()).toBeVisible()
  await page.keyboard.press('Control+s')
  await expect(page.locator('[data-save-dot]')).not.toHaveClass(/is-dirty/)
  await page.locator('.milkup-document-reference').first().click()
  await expect(page.locator('.milkup-line[data-line="16"]')).toContainText('[^n]:')
  await expect(page.locator('.milkup-input-proxy')).toBeFocused()
  await page.keyboard.press('ArrowRight')
  await expect(page.locator('.milkup-selection')).toHaveCount(0)
  await page.keyboard.press('ArrowDown')
  const back = page
    .locator(`[data-presentation-from="${fixture.indexOf('[^n]:')}"] .milkup-document-reference`)
    .first()
  await expect(back).toBeVisible()
  await back.click()
  await expect(page.locator('.milkup-input-proxy')).toBeFocused()
  await expect(page.locator('[data-save-dot]')).not.toHaveClass(/is-dirty/)
  await page.keyboard.press('Control+1')
  expect(await sourceLines(page)).toEqual(fixture.split('\n'))
})
test('disabled renderers disappear and leave Unicode editing and save available', async ({
  page,
}) => {
  await markdownExtensionFixture(page)
  await seedMarkdownExtensions(page, fixture)
  await expect(page.locator('.milkup-document-presentation math')).toHaveCount(2)
  await page.getByRole('button', { name: '菜单', exact: true }).click()
  await page.getByRole('button', { name: '插件', exact: true }).click()
  for (const name of ['数学公式', 'Milkup Diagrams', 'Milkup Footnotes']) {
    await page.getByRole('button', { name, exact: true }).click()
    await page.getByRole('button', { name: '禁用', exact: true }).click()
    await page.locator('[data-plugin-action=back]').click()
  }
  await page.locator('[data-menu-close]').click()
  await expect(page.locator('[data-document-presentation]')).toHaveCount(0)
  await page.keyboard.press('Control+1')
  await page.locator('.milkup-input-proxy').focus()
  await page.keyboard.press('Control+End')
  await page.keyboard.insertText('停用😀')
  await page.keyboard.press('Control+z')
  expect(await sourceLines(page)).toEqual(fixture.split('\n'))
  await page.keyboard.press('Control+s')
  await expect(page.locator('[data-save-dot]')).not.toHaveClass(/is-dirty/)
})

test('search keeps the selected marker visible while asynchronous block previews settle', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1100, height: 760 })
  await markdownExtensionFixture(page)
  const source =
    '# Unicode 中文 é 👩🏽‍💻\r\n\r\nSAMPLE-ROOT\r\n公式 $\\frac{x_1^2}{\\sqrt[3]{y}}$ 和 $\\int_0^\\infty x\\,dx$。\r\n\r\nSAMPLE-MATRIX\r\n$$\r\n\\begin{pmatrix}a&b\\\\c&d\\end{pmatrix}\r\n$$\r\n\r\nSAMPLE-FLOW\r\n```mermaid\r\nflowchart TD\r\nA[开始] --> B{通过?}\r\nB -->|是| C(完成)\r\n```\r\n\r\nSAMPLE-SEQUENCE\r\n```mermaid\r\nsequenceDiagram\r\nactor A as 用户\r\nparticipant B as 服务\r\nA->>B: 请求\r\nB-->>A: 返回\r\n```\r\n\r\nSAMPLE-PIE\r\n```mermaid\r\npie\r\ntitle 分布\r\n"甲": 2\r\n"乙": 1\r\n```\r\n\r\nSAMPLE-FOOTNOTES\r\n脚注引用[^note] 与再次引用[^note]。\r\n\r\n[^note]: 定义中文与 **强调**，原始 Unicode 保留。\r\n\r\nSAMPLE-ERRORS\r\n未知 $\\notACommand{x}$。\r\n```mermaid\r\nflowchart TD\r\nclick A "https://example.invalid"\r\n```\r\n\r\nSAMPLE-CODE\r\n`$notMath$` 与 [目标](https://example.invalid/$notMath$)\r\n```text\r\n$notMath$\r\n```\r\n\r\nEND-SAMPLES\r\n'
  await seedMarkdownExtensions(page, source)
  await expect(page.locator('.milkup-document-presentation svg')).toHaveCount(3)
  await page.locator('.milkup-input-proxy').focus()
  await page.keyboard.press('Control+End')
  await page.keyboard.press('Control+f')
  await page.locator('[data-search-input]').pressSequentially('SAMPLE-ROOT', { delay: 2 })
  await expect(page.locator('[data-search-result-count]')).toHaveText('1/1')
  await expect(page.locator('.milkup-selection')).not.toHaveCount(0)
  await page.keyboard.press('Escape')
  await page.locator('.milkup-input-proxy').focus()
  const observations = []
  for (let i = 0; i < 60; i++) {
    observations.push(
      await page.locator('.milkup-editor').evaluate((root) => {
        const line = root.querySelector('.milkup-line[data-line="3"]')!
        const rect = line.getBoundingClientRect(),
          box = root.getBoundingClientRect()
        return {
          scrollTop: root.scrollTop,
          top: rect.top,
          bottom: rect.bottom,
          viewportTop: box.top,
          viewportBottom: box.bottom,
        }
      }),
    )
    await page.waitForTimeout(50)
  }
  await test.info().attach('search-scroll-observations', {
    body: JSON.stringify(observations),
    contentType: 'application/json',
  })
  expect(
    observations.slice(-3).every((r) => r.top >= r.viewportTop && r.bottom <= r.viewportBottom),
  ).toBe(true)
  await page
    .locator('.milkup-document-presentation')
    .filter({ has: page.locator('mroot') })
    .click()
  await expect(page.locator('.milkup-line[data-line="4"]')).toContainText('\\frac')
  await expect(page.locator('.milkup-input-proxy')).toBeFocused()
  const revealed = []
  for (let i = 0; i < 20; i++) {
    revealed.push(
      await page.locator('.milkup-editor').evaluate((root) => {
        const line = root.querySelector('.milkup-line[data-line="4"]')!.getBoundingClientRect(),
          box = root.getBoundingClientRect()
        return {
          top: line.top,
          bottom: line.bottom,
          viewportTop: box.top,
          viewportBottom: box.bottom,
        }
      }),
    )
    await page.waitForTimeout(50)
  }
  await test.info().attach('source-reveal-geometry', {
    body: JSON.stringify(revealed),
    contentType: 'application/json',
  })
  expect(
    revealed.slice(-3).every((r) => r.top >= r.viewportTop && r.bottom <= r.viewportBottom),
  ).toBe(true)
  const graphs = page
    .locator('.milkup-document-presentation[tabindex="0"]')
    .filter({ has: page.locator('svg') })
  await graphs.nth(0).focus()
  await page.waitForTimeout(300)
  await expect(graphs.nth(0)).toBeFocused()
  await page.keyboard.press('Tab')
  await page.waitForTimeout(300)
  await expect(graphs.nth(1)).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await page.waitForTimeout(300)
  await expect(graphs.nth(0)).toBeFocused()
  const references = page.locator('.milkup-document-reference')
  await references.nth(0).focus()
  await page.waitForTimeout(300)
  await expect(references.nth(0)).toBeFocused()
  await page.keyboard.press('Tab')
  await page.waitForTimeout(300)
  await expect(references.nth(1)).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect(references.nth(0)).toBeFocused()
})

for (const windowed of [false, true])
  test(`background preview refresh preserves layout (${windowed})`, async ({ page }) => {
    await page.setViewportSize({ width: 1100, height: 760 })
    await page.goto('/')
    const source = [
      'START',
      '',
      'SAMPLE-ROOT',
      'inline source',
      '',
      'SAMPLE-FLOW',
      '```mermaid',
      'flowchart TD',
      'A --> B',
      'B --> C',
      '```',
      '',
      'SAMPLE-SEQUENCE',
      '```mermaid',
      'sequenceDiagram',
      'A->>B: hi',
      'B-->>A: ok',
      '```',
      '',
      'SAMPLE-PIE',
      '```mermaid',
      'pie',
      'title parts',
      '"A": 2',
      '"B": 1',
      '```',
      '',
      'SAMPLE-NOTE',
      'reference',
      '',
      'definition',
      '',
      'SAMPLE-ERROR',
      '```mermaid',
      'unsupported',
      '```',
      '',
      ...Array(100).fill('retained 中文😀 text'),
    ].join('\r\n')
    await page.evaluate(
      async ({ source, windowed, viewModule, coreModule }) => {
        const { SourceDocumentView, EditorView } = await import(viewModule)
        const { MemoryDocumentSource, Selection, EditorState, MemoryTextDocument } = await import(
          coreModule
        )
        const mount = document.createElement('div')
        mount.dataset.presentationProbe = ''
        Object.assign(mount.style, {
          position: 'fixed',
          inset: '37px 0 30px',
          zIndex: '10000',
          background: 'white',
        })
        document.body.append(mount)
        const requests: unknown[] = []
        const fragments = [...source.matchAll(/```mermaid\r\n([\s\S]*?)```/g)].map(
          (match, index) => ({
            from: match.index!,
            to: match.index! + match[0].length,
            layout: 'block',
            accessibleText: `graph ${index}`,
            ...(index === 3
              ? { status: 'error', message: 'Unsupported graph; edit original source.' }
              : {}),
            content: {
              type: 'vector',
              width: 700,
              height: [300, 245, 420, 100][index],
              children: [{ type: 'text', x: 10, y: 20, text: `graph ${index}` }],
            },
          }),
        )
        const store = new MemoryDocumentSource({ documentId: 'window-stability', text: source })
        let view: InstanceType<typeof SourceDocumentView>
        const options = {
          parent: mount,
          source: store,
          mode: 'live',
          editable: true,
          virtualViewport: { viewportHeight: 693, overscanLines: 20 },
          documentPresentation: {
            provide: async ({
              sourceIdentity: _identity,
              sourceVersion: _version,
              documentVersion: _dv,
              ...window
            }: any) => {
              requests.push({
                ...window,
                at: performance.now(),
                scrollTop: view?.dom.scrollTop,
                previews: view
                  ? [...view.contentDOM.querySelectorAll('[data-document-presentation]')].map(
                      (node: any) => ({
                        from: node.dataset.presentationFrom,
                        top: node.getBoundingClientRect().top,
                        height: node.getBoundingClientRect().height,
                      }),
                    )
                  : [],
              })
              if (requests.length > 100) await new Promise(() => {})
              await new Promise((resolve) => setTimeout(resolve, 40))
              return {
                declarations: [{ id: 'fixture', contexts: ['text'] }],
                request: {
                  ...window,
                  documentId: store.documentId,
                  version: store.version,
                  contextKnown: true,
                  protectedRanges: [],
                  blocks: [],
                  theme: 'light',
                  target: 'screen',
                },
                result: {
                  complete: true,
                  fragments: fragments.filter(
                    (fragment) => fragment.from >= window.from && fragment.to <= window.to,
                  ),
                },
              }
            },
          },
        }
        const selection = Selection.range(
          source.indexOf('SAMPLE-ROOT'),
          source.indexOf('SAMPLE-ROOT') + 11,
        )
        view = windowed
          ? new SourceDocumentView(options)
          : new EditorView({
              ...options,
              state: new EditorState({ doc: new MemoryTextDocument(source), selection }),
            })
        if (windowed) await view.revealSelection(3, selection)
        view.dom.querySelector<HTMLTextAreaElement>('.milkup-input-proxy')!.focus()
        ;(window as any).presentationProbe = { view, requests, store, source, coreModule }
      },
      {
        source,
        windowed,
        viewModule: `/@fs${resolve('packages/view-dom/src/index.ts')}`,
        coreModule: `/@fs${resolve('packages/core/src/index.ts')}`,
      },
    )
    await page.waitForTimeout(1000)
    const first = await page.evaluate(() => (window as any).presentationProbe.requests.length)
    await page.waitForTimeout(1000)
    const result = await page.evaluate(async () => {
      const { view, requests, store, source } = (window as any).presentationProbe
      const gaps: unknown[] = []
      const observer = new MutationObserver(() => {
        if (!view.contentDOM.querySelector('svg'))
          gaps.push({ at: performance.now(), scrollTop: view.dom.scrollTop })
      })
      observer.observe(view.contentDOM, { childList: true, subtree: true })
      const refreshStart = requests.length
      for (let i = 0; i < 6; i++) {
        view.refreshDocumentPresentation()
        await new Promise((resolve) => setTimeout(resolve, 250))
      }
      observer.disconnect()
      const read = await store.readLineWindow(1, store.lineCount)
      return {
        requests,
        refreshStart,
        gaps,
        version: store.version,
        selection: view.selection?.main ?? view.state.selection.main,
        unchanged: (view.state ? view.state.doc.text : read.text) === source,
        historyUnchanged: view.state ? view.state.undo().doc.text === source : true,
        previewCount: view.contentDOM.querySelectorAll('svg').length,
      }
    })
    await writeFile(
      test.info().outputPath('window-stability.json'),
      JSON.stringify(result, null, 2),
    )
    await test.info().attach('window-stability-requests', {
      body: JSON.stringify(result),
      contentType: 'application/json',
    })
    expect(result.refreshStart - first).toBe(0)
    expect(result.gaps).toHaveLength(0)
    expect(result.requests.length - result.refreshStart).toBe(6)
    expect(result.previewCount).toBe(3)
    expect(result.version).toBe(0)
    expect(result.unchanged).toBe(true)
    expect(result.historyUnchanged).toBe(true)
    expect(result.selection).toMatchObject({
      anchor: source.indexOf('SAMPLE-ROOT'),
      head: source.indexOf('SAMPLE-ROOT') + 11,
    })
    if (windowed) {
      const navigation = await page.evaluate(async () => {
        const { view, source, store, coreModule } = (window as any).presentationProbe
        const { Selection } = await import(coreModule)
        const from = source.indexOf('SAMPLE-NOTE')
        const lineNumber = source.slice(0, from).split('\n').length
        await view.revealSelection(lineNumber, Selection.range(from, from + 'SAMPLE-NOTE'.length))
        const observations = []
        for (let index = 0; index < 20; index++) {
          const line = view.contentDOM.querySelector(`[data-line="${lineNumber}"]`)
          const rect = line?.getBoundingClientRect(),
            viewport = view.dom.getBoundingClientRect()
          observations.push({
            scrollTop: view.dom.scrollTop,
            top: rect?.top,
            bottom: rect?.bottom,
            viewportTop: viewport.top,
            viewportBottom: viewport.bottom,
          })
          await new Promise((resolve) => setTimeout(resolve, 50))
        }
        const text = (await store.readLineWindow(1, store.lineCount)).text
        return {
          observations,
          unchanged: text === source,
          version: store.version,
          selection: view.selection.main,
          from,
        }
      })
      await writeFile(
        test.info().outputPath('window-navigation.json'),
        JSON.stringify(navigation, null, 2),
      )
      expect(
        navigation.observations.every(
          (item) =>
            item.top !== undefined &&
            item.bottom !== undefined &&
            item.top >= item.viewportTop &&
            item.bottom <= item.viewportBottom,
        ),
      ).toBe(true)
      expect(navigation.unchanged).toBe(true)
      expect(navigation.version).toBe(0)
      expect(navigation.selection).toMatchObject({
        anchor: navigation.from,
        head: navigation.from + 'SAMPLE-NOTE'.length,
      })
    }
  })

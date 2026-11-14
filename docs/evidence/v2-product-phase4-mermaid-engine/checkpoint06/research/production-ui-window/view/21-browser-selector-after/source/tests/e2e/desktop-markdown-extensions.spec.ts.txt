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
test('real math and footnotes plus controlled image Worker preserve source/history', async ({
  page,
}) => {
  await markdownExtensionFixture(page)
  await seedMarkdownExtensions(page, fixture)
  await expect(page.locator('.milkup-document-presentation math')).toHaveCount(2)
  await expect(page.locator('.milkup-document-presentation img')).toHaveCount(1)
  await expect(page.locator('.milkup-document-presentation svg')).toHaveCount(0)
  expect(
    await page
      .locator('.milkup-document-presentation img')
      .evaluate(
        (img: HTMLImageElement) =>
          img.complete && img.naturalWidth > 0 && img.src.startsWith('blob:'),
      ),
  ).toBe(true)
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
test('opaque code and controlled provider errors stay literal without executable content', async ({
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
    'TEST_DOCUMENT_IMAGE_ERROR',
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
  await expect(page.locator('.milkup-document-presentation img')).toHaveCount(0)
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
  for (const name of ['数学公式', 'Controlled Document Image Fixture', 'Milkup Footnotes']) {
    await page.getByRole('button', { name, exact: true }).click()
    await page.getByRole('button', { name: '禁用', exact: true }).click()
    await page.locator('[data-plugin-action=back]').click()
  }
  await page.locator('[data-menu-close]').click()
  await expect(page.locator('[data-document-presentation]')).toHaveCount(0)
  await page.keyboard.press('Control+1')
  await page.locator('.milkup-input-proxy').focus()
  // Use a different position from the seed insertion's end, so this edit has
  // its own history entry even when the UI interactions finish within 1 second.
  await page.keyboard.press('Control+Home')
  await page.keyboard.insertText('停用😀')
  expect(await sourceLines(page)).toEqual(`停用😀${fixture}`.split('\n'))
  await page.keyboard.press('Control+z')
  expect(await sourceLines(page)).toEqual(fixture.split('\n'))
  await page.keyboard.press('Control+Shift+z')
  expect(await sourceLines(page)).toEqual(`停用😀${fixture}`.split('\n'))
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
    '# Unicode 中文 é 👩🏽‍💻\r\n\r\nSAMPLE-ROOT\r\n公式 $\\frac{x_1^2}{\\sqrt[3]{y}}$ 和 $\\int_0^\\infty x\\,dx$。\r\n\r\nSAMPLE-MATRIX\r\n$$\r\n\\begin{pmatrix}a&b\\\\c&d\\end{pmatrix}\r\n$$\r\n\r\nSAMPLE-FLOW\r\n```mermaid\r\nflowchart TD\r\nA[开始] --> B{通过?}\r\nB -->|是| C(完成)\r\n```\r\n\r\nSAMPLE-SEQUENCE\r\n```mermaid\r\nsequenceDiagram\r\nactor A as 用户\r\nparticipant B as 服务\r\nA->>B: 请求\r\nB-->>A: 返回\r\n```\r\n\r\nSAMPLE-PIE\r\n```mermaid\r\npie\r\ntitle 分布\r\n"甲": 2\r\n"乙": 1\r\n```\r\n\r\nSAMPLE-FOOTNOTES\r\n脚注引用[^note] 与再次引用[^note]。\r\n\r\n[^note]: 定义中文与 **强调**，原始 Unicode 保留。\r\n\r\nSAMPLE-ERRORS\r\n未知 $\\notACommand{x}$。\r\n```mermaid\r\nflowchart TD\r\nTEST_DOCUMENT_IMAGE_ERROR\r\nclick A "https://example.invalid"\r\n```\r\n\r\nSAMPLE-CODE\r\n`$notMath$` 与 [目标](https://example.invalid/$notMath$)\r\n```text\r\n$notMath$\r\n```\r\n\r\nEND-SAMPLES\r\n'
  await seedMarkdownExtensions(page, source)
  await expect(page.locator('.milkup-document-presentation img')).toHaveCount(3)
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
    .filter({ has: page.locator('img') })
  await graphs.nth(0).focus()
  await page.waitForTimeout(300)
  await expect(graphs.nth(0)).toBeFocused()
  const decodedImages = []
  for (let i = 0; i < 20; i++) {
    decodedImages.push(
      await page.locator('.milkup-document-presentation img').evaluateAll((images) =>
        images.map((node) => {
          const image = node as HTMLImageElement
          return {
            src: image.src,
            complete: image.complete,
            width: image.naturalWidth,
            height: image.naturalHeight,
            connected: image.isConnected,
          }
        }),
      ),
    )
    await page.waitForTimeout(50)
  }
  await writeFile(
    test.info().outputPath('decoded-image-stability.json'),
    JSON.stringify(decodedImages, null, 2),
  )
  expect(
    decodedImages.every(
      (images) =>
        images.length >= 2 &&
        images.every(
          (image) =>
            image.connected &&
            image.complete &&
            image.width > 0 &&
            image.height > 0 &&
            image.src.startsWith('blob:'),
        ),
    ),
  ).toBe(true)
  expect(
    new Set(decodedImages.map((images) => JSON.stringify(images.map((image) => image.src)))).size,
  ).toBe(1)
  await page.screenshot({
    path: test.info().outputPath('stable-controlled-images.png'),
    fullPage: true,
  })
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
              visibleFrom: _visibleFrom,
              visibleTo: _visibleTo,
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

async function lastReferenceFixture(page: Page, windowed: boolean) {
  await page.goto('/')
  await page.evaluate(
    async ({ windowed, viewModule, coreModule }) => {
      const { EditorView, SourceDocumentView } = await import(viewModule)
      const { EditorState, MemoryTextDocument, MemoryDocumentSource, Selection, ChangeSet } =
        await import(coreModule)
      let version = 0
      const text = '  编辑 中文😀\r\n引用[^only]'
      let state = new EditorState({
        doc: new MemoryTextDocument(text),
        selection: Selection.cursor(2),
      })
      let memory = new MemoryDocumentSource({ documentId: 'last-reference', document: state.doc })
      const source = {
        documentId: 'last-reference',
        get version() {
          return version
        },
        get lineCount() {
          return state.doc.lineCount
        },
        get length() {
          return state.doc.length
        },
        readLineWindow: (...args: any[]) => memory.readLineWindow(...args),
        lineAtPosition: (position: number) => memory.lineAtPosition(position),
        positionAtLineOffset: (line: number, offset: number) =>
          memory.positionAtLineOffset(line, offset),
        snapshot: () => memory.snapshot(),
      }
      const mount = document.createElement('main')
      mount.dataset.lastReferenceProbe = ''
      Object.assign(mount.style, {
        position: 'fixed',
        inset: '37px 0 30px',
        zIndex: '10000',
        background: 'white',
      })
      document.body.append(mount)
      const edits: unknown[] = []
      const options = {
        parent: mount,
        mode: 'live',
        editable: true,
        documentPresentation: {
          provide: async ({
            sourceIdentity: _i,
            sourceVersion: _v,
            documentVersion: _d,
            visibleFrom: _visibleFrom,
            visibleTo: _visibleTo,
            ...window
          }: any) => {
            const from = state.doc.text.indexOf('[^only]')
            return {
              declarations: [{ id: 'reference-fixture', contexts: ['text'] }],
              request: {
                ...window,
                documentId: source.documentId,
                version: version,
                contextKnown: true,
                protectedRanges: [],
                blocks: [],
                theme: 'light',
                target: 'screen',
              },
              result: {
                complete: true,
                fragments: [
                  {
                    from,
                    to: from + 7,
                    layout: 'inline',
                    accessibleText: 'Only reference',
                    content: {
                      type: 'reference',
                      label: 'Only reference',
                      target: { documentId: source.documentId, version: version, from: 2, to: 4 },
                    },
                  },
                ],
              },
            }
          },
        },
      }
      const view = windowed
        ? new SourceDocumentView({
            ...options,
            source,
            onEdit: (edit: any) => {
              edits.push(edit)
              version++
              state = state.applyTransaction({
                changes: ChangeSet.of([{ from: edit.from, to: edit.to, insert: edit.insert }]),
                selection: edit.selectionAfter,
              })
              memory = new MemoryDocumentSource({
                documentId: source.documentId,
                document: state.doc,
                version: version,
              })
            },
          })
        : new EditorView({
            ...options,
            state,
            dispatch: (transaction: any, activeView: any) => {
              if (transaction.changes && !transaction.changes.empty) {
                edits.push(transaction)
                version++
              }
              state = state.applyTransaction(transaction)
              activeView.updateState(state, [transaction])
            },
          })
      if (windowed) await view.revealSelection(1, Selection.cursor(2))
      ;(window as any).lastReferenceProbe = {
        view,
        edits,
        text,
        read: () => {
          const current = windowed ? state : view.state
          return {
            text: current.doc.text,
            version,
            historyText: current.undo().doc.text,
            undoCount: current.history.undoStack.length,
            redoCount: current.history.redoStack.length,
            edits: edits.length,
            selection: (windowed ? view.selection : current.selection).main,
          }
        },
      }
    },
    {
      windowed,
      viewModule: `/@fs${resolve('packages/view-dom/src/index.ts')}`,
      coreModule: `/@fs${resolve('packages/core/src/index.ts')}`,
    },
  )
  await expect(page.locator('[data-last-reference-probe] .milkup-document-reference')).toHaveCount(
    1,
  )
}

for (const windowed of [false, true]) {
  test(`last preview reference supports native Tab round trip (${windowed})`, async ({ page }) => {
    await lastReferenceFixture(page, windowed)
    const reference = page.locator('[data-last-reference-probe] .milkup-document-reference')
    const input = page.locator('[data-last-reference-probe] .milkup-input-proxy')
    const before = await page.evaluate(() => (window as any).lastReferenceProbe.read())
    await reference.focus()
    await page.keyboard.press('Tab')
    await expect(input).toBeFocused()
    await page.keyboard.press('Shift+Tab')
    const after = await page.evaluate(async () => {
      const probe = (window as any).lastReferenceProbe
      if (probe.view.runAfterPendingEdits) await probe.view.runAfterPendingEdits(async () => {})
      return probe.read()
    })
    await writeFile(
      test.info().outputPath('last-reference-tab-state.json'),
      JSON.stringify({ before, after }, null, 2),
    )
    await test.info().attach('last-reference-tab-state', {
      body: JSON.stringify({ before, after }),
      contentType: 'application/json',
    })
    await expect(reference).toBeFocused()
    expect(after).toEqual(before)
    await page.screenshot({
      path: test.info().outputPath('last-reference-tab-after.png'),
      fullPage: true,
    })
  })

  test(`ordinary proxy focus retains Tab indentation (${windowed})`, async ({ page }) => {
    await lastReferenceFixture(page, windowed)
    const input = page.locator('[data-last-reference-probe] .milkup-input-proxy')
    await input.focus()
    await page.keyboard.press('Tab')
    await expect
      .poll(() => page.evaluate(() => (window as any).lastReferenceProbe.read().text))
      .toBe('    编辑 中文😀\r\n引用[^only]')
    await expect(input).toBeFocused()
    await page.keyboard.press('Shift+Tab')
    await expect
      .poll(() => page.evaluate(() => (window as any).lastReferenceProbe.read().text))
      .toBe('  编辑 中文😀\r\n引用[^only]')
    await expect(input).toBeFocused()
  })
}

for (const windowed of [false, true])
  for (const intervention of ['arrow', 'text', 'pointer', 'external-focus', 'replacement'])
    test(`preview proxy navigation ends after ${intervention} (${windowed})`, async ({ page }) => {
      await lastReferenceFixture(page, windowed)
      const reference = page.locator('[data-last-reference-probe] .milkup-document-reference')
      const input = page.locator('[data-last-reference-probe] .milkup-input-proxy')
      await reference.focus()
      await page.keyboard.press('Tab')
      await expect(input).toBeFocused()
      if (intervention === 'arrow') await page.keyboard.press('ArrowRight')
      else if (intervention === 'text') {
        await page.keyboard.insertText('X')
        await expect
          .poll(() => page.evaluate(() => (window as any).lastReferenceProbe.read().text))
          .toBe('  X编辑 中文😀\r\n引用[^only]')
      } else if (intervention === 'pointer') await input.click({ force: true })
      else if (intervention === 'external-focus') {
        await page.getByRole('button', { name: '菜单', exact: true }).focus()
        await input.focus()
      } else {
        const previous = await reference.elementHandle()
        await page.evaluate(() =>
          (window as any).lastReferenceProbe.view.refreshDocumentPresentation(),
        )
        await expect.poll(() => previous!.evaluate((element) => element.isConnected)).toBe(false)
        await expect(reference).toHaveCount(1)
        await expect(input).toBeFocused()
      }
      await page.keyboard.press('Shift+Tab')
      await expect
        .poll(() => page.evaluate(() => (window as any).lastReferenceProbe.read().text))
        .toBe(`${intervention === 'text' ? 'X' : ''}编辑 中文😀\r\n引用[^only]`)
      await expect(input).toBeFocused()
    })

for (const anchoring of ['auto', 'none'])
  for (const windowed of [false, true])
    test(`timed-out preparation preserves the uncached near-end reading position (${windowed}, ${anchoring})`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: 1100, height: 760 })
      await page.goto('/')
      await page.evaluate(
        async ({ viewModule, coreModule, windowed, anchoring }) => {
          const { EditorView, SourceDocumentView } = await import(viewModule)
          const { EditorState, MemoryTextDocument, MemoryDocumentSource, Selection } = await import(
            coreModule
          )
          const text = [
            ...Array(118).fill('retained 中文😀 body'),
            'SAMPLE-REMOTE',
            'final [reference]',
          ].join('\r\n')
          const from = text.indexOf('SAMPLE-REMOTE')
          const source = new MemoryDocumentSource({ documentId: 'notice-layout', text })
          const mount = document.createElement('main')
          mount.dataset.noticeLayoutProbe = ''
          Object.assign(mount.style, {
            position: 'fixed',
            inset: '37px 0 30px',
            zIndex: '10000',
            background: 'white',
          })
          document.body.append(mount)
          const selection = Selection.range(from, from + 'SAMPLE-REMOTE'.length)
          const view = windowed
            ? new SourceDocumentView({ parent: mount, source, mode: 'live', editable: true })
            : new EditorView({
                parent: mount,
                mode: 'live',
                state: new EditorState({ doc: new MemoryTextDocument(text), selection }),
              })
          view.dom.style.overflowAnchor = anchoring
          if (windowed) await view.revealSelection(119, selection)
          else {
            view.dom.scrollTop = view.dom.scrollHeight
            view.ensureCursorVisible()
          }
          await new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve)),
          )
          const observations: any[] = [],
            requests: any[] = []
          const observe = (reason: string) => {
            const target = view.contentDOM.querySelector('[data-line="119"]')
            const rect = target?.getBoundingClientRect(),
              root = view.dom.getBoundingClientRect()
            const notice = view.dom.querySelector('[data-document-presentation-notice]')
            observations.push({
              reason,
              at: performance.now(),
              scrollTop: view.dom.scrollTop,
              scrollHeight: view.dom.scrollHeight,
              viewportTop: root.top,
              viewportBottom: root.bottom,
              top: rect?.top,
              bottom: rect?.bottom,
              noticeHeight: notice?.getBoundingClientRect().height ?? 0,
              contentTop: view.contentDOM.getBoundingClientRect().top,
              fromLine: view.contentDOM.dataset.fromLine,
              toLine: view.contentDOM.dataset.toLine,
            })
          }
          observe('baseline')
          const insertBefore = view.dom.insertBefore.bind(view.dom)
          view.dom.insertBefore = (node: Node, child: Node | null) => {
            observe('before-root-insert')
            const result = insertBefore(node, child)
            observe('after-root-insert')
            return result
          }
          const replaceChildren = view.contentDOM.replaceChildren.bind(view.contentDOM)
          view.contentDOM.replaceChildren = (...nodes: (Node | string)[]) => {
            observe('before-source-replacement')
            replaceChildren(...nodes)
            observe('after-source-replacement')
          }
          const interval = setInterval(() => observe('interval'), 100)
          view.setDocumentPresentation({
            provide: async (
              {
                sourceIdentity: _i,
                sourceVersion: _v,
                documentVersion: _d,
                visibleFrom: _visibleFrom,
                visibleTo: _visibleTo,
                ...window
              }: any,
              { signal }: any,
            ) => {
              const index = requests.length
              requests.push({
                at: performance.now(),
                fromLine: window.fromLine,
                toLine: window.toLine,
              })
              if (index < 2)
                await new Promise((_resolve, reject) =>
                  signal.addEventListener(
                    'abort',
                    () => {
                      observe('deadline-abort')
                      reject(signal.reason)
                    },
                    { once: true },
                  ),
                )
              return {
                declarations: [{ id: 'fixture', contexts: ['text'] }],
                request: {
                  ...window,
                  documentId: source.documentId,
                  version: 0,
                  contextKnown: true,
                  blocks: [],
                  protectedRanges: [],
                  theme: 'light',
                  target: 'screen',
                },
                result: {
                  complete: true,
                  fragments: [
                    {
                      from: text.indexOf('[reference]'),
                      to: text.length,
                      accessibleText: 'Prepared reference',
                      layout: 'inline',
                      content: { type: 'text', text: 'Prepared reference' },
                    },
                  ],
                },
              }
            },
          })
          ;(window as any).noticeLayoutProbe = {
            view,
            source,
            text,
            from,
            requests,
            observations,
            finish: async () => {
              clearInterval(interval)
              observe('final')
              return {
                observations,
                requests,
                version: source.version,
                selection: (windowed ? view.selection : view.state.selection).main,
                unchanged: windowed
                  ? (await source.readLineWindow(1, source.lineCount)).text === text
                  : view.state.doc.text === text,
              }
            },
          }
        },
        {
          windowed,
          anchoring,
          viewModule: `/@fs${resolve('packages/view-dom/src/index.ts')}`,
          coreModule: `/@fs${resolve('packages/core/src/index.ts')}`,
        },
      )
      await expect
        .poll(() => page.evaluate(() => (window as any).noticeLayoutProbe.requests.length), {
          timeout: 30000,
        })
        .toBeGreaterThanOrEqual(3)
      await expect(
        page.locator('[data-notice-layout-probe] [data-document-presentation]'),
      ).toHaveCount(1)
      await page.waitForTimeout(200)
      const result = await page.evaluate(() => (window as any).noticeLayoutProbe.finish())
      await writeFile(test.info().outputPath('notice-layout.json'), JSON.stringify(result, null, 2))
      await page.screenshot({ path: test.info().outputPath('notice-layout.png'), fullPage: true })
      const baseline = result.observations[0]
      const final = result.observations.at(-1)
      expect(final.top).toBeCloseTo(baseline.top, 0)
      expect(final.top).toBeGreaterThanOrEqual(final.viewportTop)
      expect(final.bottom).toBeLessThanOrEqual(final.viewportBottom)
      expect(result.version).toBe(0)
      expect(result.unchanged).toBe(true)
    })

for (const anchoring of ['auto', 'none'])
  test(`uncached source replacement retains the visible reading anchor (${anchoring})`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1100, height: 760 })
    await page.goto('/')
    await page.evaluate(
      async ({ viewModule, coreModule, anchoring }) => {
        const { SourceDocumentView } = await import(viewModule)
        const { MemoryDocumentSource, Selection } = await import(coreModule)
        const text = ['preview', ...Array(119).fill('retained 中文😀 body')].join('\r\n')
        const source = new MemoryDocumentSource({ documentId: 'uncached-replacement', text })
        const mount = document.createElement('main')
        mount.dataset.uncachedReplacement = ''
        Object.assign(mount.style, {
          position: 'fixed',
          inset: '37px 0 30px',
          zIndex: '10000',
          background: 'white',
        })
        document.body.append(mount)
        const view = new SourceDocumentView({ parent: mount, source, mode: 'live', editable: true })
        view.dom.style.overflowAnchor = anchoring
        await view.revealSelection(2, Selection.cursor(9))
        let pending = false
        const provider = {
          provide: async (
            {
              sourceIdentity: _i,
              sourceVersion: _v,
              documentVersion: _d,
              visibleFrom: _visibleFrom,
              visibleTo: _visibleTo,
              ...window
            }: any,
            { signal }: any,
          ) => {
            if (pending)
              await new Promise((_resolve, reject) =>
                signal.addEventListener('abort', () => reject(signal.reason), { once: true }),
              )
            return {
              declarations: [{ id: 'fixture', contexts: ['text'] }],
              request: {
                ...window,
                documentId: source.documentId,
                version: 0,
                contextKnown: true,
                blocks: [],
                protectedRanges: [],
                theme: 'light',
                target: 'screen',
              },
              result: {
                complete: true,
                fragments:
                  window.from === 0
                    ? [
                        {
                          from: 0,
                          to: 7,
                          layout: 'block',
                          accessibleText: 'Tall preview',
                          content: { type: 'vector', width: 600, height: 300, children: [] },
                        },
                      ]
                    : [],
              },
            }
          },
        }
        view.setDocumentPresentation(provider)
        const observe = () => {
          const target = view.contentDOM.querySelector('[data-line="20"]')?.getBoundingClientRect()
          return {
            top: target?.top,
            bottom: target?.bottom,
            scrollTop: view.dom.scrollTop,
            fromLine: view.contentDOM.dataset.fromLine,
            toLine: view.contentDOM.dataset.toLine,
            spacer: view.contentDOM.querySelector<HTMLElement>('[data-spacer="top"]')?.style.height,
            viewportTop: view.dom.getBoundingClientRect().top,
            viewportBottom: view.dom.getBoundingClientRect().bottom,
          }
        }
        ;(window as any).uncachedReplacement = {
          view,
          source,
          provider,
          observe,
          text,
          beginPending: () => {
            pending = true
            view.setDocumentPresentation(provider)
          },
          select: async () => {
            const line = await source.readLineWindow(20, 20)
            await view.revealSelection(20, Selection.cursor(line.from))
          },
        }
      },
      {
        anchoring,
        viewModule: `/@fs${resolve('packages/view-dom/src/index.ts')}`,
        coreModule: `/@fs${resolve('packages/core/src/index.ts')}`,
      },
    )
    await expect(page.locator('[data-uncached-replacement] svg')).toHaveCount(1)
    await page.evaluate(() => (window as any).uncachedReplacement.select())
    await expect(page.locator('[data-uncached-replacement] svg')).toHaveCount(0)
    await page.waitForTimeout(100)
    await page.evaluate(() => (window as any).uncachedReplacement.view.scrollToLine(15))
    await expect(
      page.locator('[data-uncached-replacement] .milkup-editor-content'),
    ).toHaveAttribute('data-from-line', '3')
    await page.evaluate(() => (window as any).uncachedReplacement.beginPending())
    await page.waitForTimeout(50)
    const before = await page.evaluate(() => {
      const probe = (window as any).uncachedReplacement
      probe.view.dom.scrollTop -= 63
      return probe.observe()
    })
    await expect(
      page.locator('[data-uncached-replacement] .milkup-editor-content'),
    ).toHaveAttribute('data-from-line', '1')
    await page.waitForTimeout(100)
    const after = await page.evaluate(async () => {
      const probe = (window as any).uncachedReplacement
      return {
        ...probe.observe(),
        version: probe.source.version,
        unchanged:
          (await probe.source.readLineWindow(1, probe.source.lineCount)).text === probe.text,
      }
    })
    await writeFile(
      test.info().outputPath('uncached-replacement.json'),
      JSON.stringify({ before, after }, null, 2),
    )
    await page.screenshot({
      path: test.info().outputPath('uncached-replacement.png'),
      fullPage: true,
    })
    expect(after.top).toBeCloseTo(before.top, 0)
    expect(after.top).toBeGreaterThanOrEqual(after.viewportTop)
    expect(after.bottom).toBeLessThanOrEqual(after.viewportBottom)
    expect(after.unchanged).toBe(true)
    expect(after.version).toBe(0)
  })

for (const route of [
  'ordinary-provider',
  'windowed-provider',
  'windowed-source',
  'windowed-outside',
]) {
  test(`reference pointer activation survives ${route} replacement between down and up`, async ({
    page,
  }) => {
    await markdownExtensionFixture(page)
    await page.evaluate(
      async ({ route, viewModule, coreModule }) => {
        const { EditorView, SourceDocumentView } = await import(viewModule)
        const { MemoryDocumentSource, MemoryTextDocument, EditorState, Selection } = await import(
          coreModule
        )
        const text = 'start\nreference\ntarget\n' + 'retained 中文😀\n'.repeat(100)
        const store = new MemoryDocumentSource({ documentId: 'gesture', text })
        const mount = document.createElement('main')
        Object.assign(mount.style, {
          position: 'fixed',
          inset: '37px 0 30px',
          background: 'white',
          zIndex: '10000',
        })
        document.body.append(mount)
        let release: (() => void) | undefined,
          hold = false,
          calls = 0,
          completed = 0,
          provided = 0
        const events: unknown[] = [],
          nodes = new WeakMap<Node, number>()
        let next = 1
        const id = (node: Node | null) => {
          if (!node) return null
          if (!nodes.has(node)) nodes.set(node, next++)
          return nodes.get(node)
        }
        const config = {
          onNavigate: async () => {
            calls++
            if (route.startsWith('windowed'))
              await view.revealSelection(3, Selection.range(16, 22), {
                signal: new AbortController().signal,
                assertCurrent: () => {},
              })
            completed++
          },
          provide: async ({
            sourceIdentity: _i,
            sourceVersion: _v,
            documentVersion: _d,
            visibleFrom: _visibleFrom,
            visibleTo: _visibleTo,
            ...window
          }: any) => {
            if (hold)
              await new Promise<void>((resolve) => {
                release = resolve
              })
            provided++
            return {
              declarations: [{ id: 'fixture', contexts: ['text'] }],
              request: {
                ...window,
                documentId: store.documentId,
                version: 0,
                contextKnown: true,
                protectedRanges: [],
                blocks: [],
                theme: 'light',
                target: 'screen',
              },
              result: {
                complete: true,
                fragments: [
                  {
                    from: 6,
                    to: 15,
                    layout: 'inline',
                    accessibleText: 'reference',
                    content: {
                      type: 'reference',
                      label: 'Jump to target',
                      target: { documentId: store.documentId, version: 0, from: 16, to: 22 },
                    },
                  },
                ],
              },
            }
          },
        }
        const options = {
          parent: mount,
          mode: 'live',
          editable: true,
          documentPresentation: config,
        }
        const view = route.startsWith('windowed')
          ? new SourceDocumentView({
              ...options,
              source: store,
              virtualViewport: { viewportHeight: 693, overscanLines: 2 },
            })
          : new EditorView({
              ...options,
              state: new EditorState({
                doc: new MemoryTextDocument(text),
                selection: Selection.cursor(0),
              }),
            })
        if (route.startsWith('windowed')) await view.renderVisibleWindow()
        for (const type of ['pointerdown', 'mousedown', 'focusin', 'pointerup', 'mouseup', 'click'])
          mount.addEventListener(
            type,
            (event) =>
              events.push({
                type,
                at: performance.now(),
                id: id(event.target as Node),
                connected: (event.target as Node).isConnected,
                active: id(document.activeElement),
                trusted: event.isTrusted,
              }),
            true,
          )
        ;(window as any).gestureProbe = {
          view,
          store,
          text,
          events,
          id,
          get provided() {
            return provided
          },
          get calls() {
            return calls
          },
          get ready() {
            return !!release
          },
          start: () => {
            hold = true
            view.refreshDocumentPresentation()
          },
          release: () => {
            hold = false
            release?.()
          },
          snapshot: () => ({
            calls,
            completed,
            version: store.version,
            selection: (view.state?.selection ?? view.selection).main,
            unchanged: view.state ? view.state.doc.text === text : true,
            active: id(document.activeElement),
            button: id(mount.querySelector('button.milkup-document-reference')),
          }),
        }
      },
      {
        route,
        viewModule: `/@fs${resolve('packages/view-dom/src/index.ts')}`,
        coreModule: `/@fs${resolve('packages/core/src/index.ts')}`,
      },
    )
    const button = page.locator('.milkup-document-reference').last()
    await expect(button).toBeVisible()
    await page.waitForTimeout(100)
    if (!route.endsWith('source')) {
      await page.evaluate(() => (window as any).gestureProbe.start())
      await expect.poll(() => page.evaluate(() => (window as any).gestureProbe.ready)).toBe(true)
    }
    const bounds = await button.boundingBox()
    const before = await page.evaluate(() => {
      const p = (window as any).gestureProbe
      p.original = p.view.contentDOM.querySelector('button')
      return p.snapshot()
    })
    await page.mouse.move(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height / 2)
    await page.mouse.down()
    if (!route.endsWith('source')) {
      const provided = await page.evaluate(() => (window as any).gestureProbe.provided)
      await page.evaluate(() => (window as any).gestureProbe.release())
      await expect
        .poll(() => page.evaluate(() => (window as any).gestureProbe.provided))
        .toBeGreaterThan(provided)
    } else {
      await page.evaluate(() => {
        const p = (window as any).gestureProbe
        p.sourceRender = p.view.renderVisibleWindow().then(() => {
          p.sourceRenderDone = true
        })
      })
      // Give the controlled read/application an opportunity to finish. Keeping the
      // original node until mouseup is a valid implementation, not a test failure.
      await page.waitForTimeout(50)
    }
    if (route.endsWith('outside'))
      await page.mouse.move(bounds!.x + bounds!.width + 50, bounds!.y + bounds!.height / 2)
    await page.mouse.up()
    if (!route.endsWith('outside'))
      await expect
        .poll(() => page.evaluate(() => (window as any).gestureProbe.snapshot().completed))
        .toBe(1)
    if (route.endsWith('source'))
      await page.evaluate(() => (window as any).gestureProbe.sourceRender)
    const result = await page.evaluate(async () => {
      const p = (window as any).gestureProbe
      return {
        after: p.snapshot(),
        events: p.events,
        originalConnected: p.original.isConnected,
        unchanged: (await p.store.readLineWindow(1, p.store.lineCount)).text === p.text,
      }
    })
    await writeFile(
      test.info().outputPath('gesture.json'),
      JSON.stringify({ route, bounds, before, ...result }, null, 2),
    )
    await page.screenshot({ path: test.info().outputPath('gesture.png') })
    expect(result.after.calls).toBe(route.endsWith('outside') ? 0 : 1)
    expect(result.after.version).toBe(0)
    expect(result.unchanged).toBe(true)
  })
}

for (const mode of ['source', 'live']) {
  test(`superseded ${mode} navigation cannot silently resolve without selecting its target`, async ({
    page,
  }) => {
    await markdownExtensionFixture(page)
    const result = await page.evaluate(
      async ({ mode, viewModule, coreModule }) => {
        const { SourceDocumentView } = await import(viewModule)
        const { MemoryDocumentSource, Selection } = await import(coreModule)
        const text = Array.from({ length: 500 }, (_, n) => `line ${n + 1} 中文😀`).join('\n')
        const store = new MemoryDocumentSource({ documentId: 'navigation-race', text })
        const mount = document.createElement('main')
        Object.assign(mount.style, {
          position: 'fixed',
          inset: '37px 0 30px',
          zIndex: '10000',
          background: 'white',
        })
        document.body.append(mount)
        const view = new SourceDocumentView({
          parent: mount,
          source: store,
          mode,
          virtualViewport: { viewportHeight: 126, overscanLines: 2 },
        })
        await view.renderVisibleWindow()
        const target = (await store.readLineWindow(50, 50)).from
        const original = store.readLineWindow.bind(store)
        let holding = true
        const releases: (() => void)[] = [],
          reads: unknown[] = []
        store.readLineWindow = async (...args: any[]) => {
          reads.push({ args, at: performance.now() })
          if (holding && args[0] <= 50 && args[1] >= 50)
            await new Promise<void>((resolve) => releases.push(resolve))
          return original(...args)
        }
        let outcome = 'pending'
        const before = { selection: view.selection.main, version: store.version }
        const navigation = view
          .revealSelection(50, Selection.cursor(target), {
            signal: new AbortController().signal,
            assertCurrent: () => {},
          })
          .then(
            () => {
              outcome = 'resolved'
            },
            () => {
              outcome = 'rejected'
            },
          )
        const deadline = performance.now() + 2000
        while (!releases.length && performance.now() < deadline)
          await new Promise((resolve) => setTimeout(resolve, 10))
        if (!releases.length) throw Error('Fixture did not hold the target window')
        view.dom.scrollTop = 200 * 21
        await view.renderVisibleWindow()
        const superseding = {
          from: view.contentDOM.dataset.fromLine,
          to: view.contentDOM.dataset.toLine,
        }
        holding = false
        releases.forEach((release) => release())
        await navigation
        const result = {
          mode,
          before,
          target,
          outcome,
          superseding,
          after: {
            selection: view.selection.main,
            version: store.version,
            targetPresent: !!view.contentDOM.querySelector('[data-line="50"]'),
          },
          reads,
          unchanged: (await original(1, store.lineCount)).text === text,
        }
        return result
      },
      {
        mode,
        viewModule: `/@fs${resolve('packages/view-dom/src/index.ts')}`,
        coreModule: `/@fs${resolve('packages/core/src/index.ts')}`,
      },
    )
    await writeFile(
      test.info().outputPath('superseded-navigation.json'),
      JSON.stringify(result, null, 2),
    )
    await page.screenshot({ path: test.info().outputPath('superseded-navigation.png') })
    expect(result.outcome === 'rejected' || result.after.selection.head === result.target).toBe(
      true,
    )
    expect(result.unchanged).toBe(true)
    expect(result.after.version).toBe(0)
  })
}

test('official Mermaid DOM host is explicitly unavailable in the browser and keeps source', async ({
  page,
}) => {
  const loads: string[] = []
  page.on('request', (request) => {
    if (request.url().includes('native-only-placeholder')) loads.push(request.url())
  })
  await markdownExtensionFixture(page, { nativeDiagramUnavailable: true })
  const source = '浏览器保留原文😀\n\n```mermaid\nflowchart LR\nA --> B\n```\n'
  await seedMarkdownExtensions(page, source)
  await page.getByRole('button', { name: '菜单', exact: true }).click()
  await page.getByRole('button', { name: '插件', exact: true }).click()
  await page.getByRole('button', { name: 'Milkup Diagrams', exact: true }).click()
  await expect(page.locator('.plugin-errors')).toContainText(
    'DOM plugins require the native desktop runtime',
  )
  expect(loads).toEqual([])
  await page.screenshot({
    path: test.info().outputPath('native-dom-unavailable.png'),
    fullPage: true,
  })
  await page.locator('[data-menu-close]').click()
  await expect(page.locator('.milkup-document-presentation img')).toHaveCount(0)
  await page.keyboard.press('Control+1')
  expect(await sourceLines(page)).toEqual(source.split('\n'))
})

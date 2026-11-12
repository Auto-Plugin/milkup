import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { expect, test } from '@playwright/test'

// Obtain the historical attachment separately; do not vendor the anthology.
// https://github.com/Auto-Plugin/milkup/issues/5
const sample = process.env.MILKUP_ISSUE5_SAMPLE
const expectedHash = '6889961c1dbcce2a235bb219d4dd218b0371e1b1a09b7b36a05e6ccf8458d197'
const sha = (value: Buffer | string) => createHash('sha256').update(value).digest('hex')

test('issue 5 original HTML-containing Markdown remains complete through source and Save As', async ({
  page,
}, info) => {
  test.skip(!sample, 'Requires original issue #5 attachment via MILKUP_ISSUE5_SAMPLE')
  const bytes = await readFile(sample!)
  expect(bytes.length).toBe(9717)
  expect(sha(bytes)).toBe(expectedHash)
  const source = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  expect(source.length).toBe(4342)
  const input = info.outputPath('input-copy.md')
  const saved = info.outputPath('saved-as.md')
  await writeFile(input, bytes, { flag: 'wx' })
  let saveCalls = 0
  await page.exposeBinding('issue5SaveAs', async (_, text: string) => {
    expect(typeof text).toBe('string')
    expect(Buffer.byteLength(text)).toBeLessThanOrEqual(65536)
    await writeFile(saved, text, { flag: 'wx' })
    saveCalls++
    return { path: saved, hash: sha(text) }
  })
  // Browser has no native file service. Only IO is replaced: open from a temporary
  // copy and persist the actual Save As payload. This does not test Tauri dialogs,
  // atomic writes, permissions or native resource relocation.
  await page.route(/\/src\/file-service\.ts(?:\?|$)/, async (route) => {
    const response = await route.fetch()
    const original = await response.text()
    const body = original.replace(
      'function createDesktopFileService() {',
      `function createDesktopFileService() {
        const service = createMockFileService();
        const path = ${JSON.stringify(input)}, text = ${JSON.stringify(source)};
        service.selectOpenFile = async () => path;
        service.getFileMetadata = async () => ({path,sizeBytes:9717,readonly:false});
        service.openPath = async () => ({documentId:'issue-5',file:{path},text,diskSnapshotHash:${JSON.stringify(expectedHash)}});
        service.saveFileAs = async (session,text) => {
          const result = await window.issue5SaveAs(text);
          return {documentId:session.documentId,file:{path:result.path},diskSnapshotHash:result.hash};
        }; return service;`,
    )
    expect(body).not.toBe(original)
    await route.fulfill({ response, body })
  })
  await page.goto('/')
  await expect(page.locator('#app')).toHaveAttribute('data-loading', /^(idle|ready)$/)
  await page.getByRole('button', { name: '菜单', exact: true }).click()
  await page.getByRole('button', { name: '打开', exact: true }).click()
  await expect(page.locator('#app')).toHaveAttribute('data-loading', 'ready')
  await expect(page.locator('[data-app-menu]')).toHaveAttribute('data-phase', 'closed')
  const editor = page.locator('.milkup-editor')
  await page.keyboard.press('Control+2')
  await expect(editor).toHaveAttribute('data-mode', 'live')
  // Literal HTML stays available; do not enable arbitrary HTML to pass this test.
  await expect(editor).toContainText('名侦探柯南')
  await expect(editor).toContainText('直美！')
  await expect(editor.locator('p[align="right"]')).toHaveCount(0)
  await page.locator('.milkup-input-proxy').focus()
  await page.keyboard.press('Control+End')
  await expect(page.locator('.milkup-line').last()).toBeInViewport()
  await page.screenshot({ path: info.outputPath('live-tail.png') })
  await page.keyboard.press('Control+1')
  await expect(editor).toHaveAttribute('data-mode', 'source')
  const lines = await page
    .locator('.milkup-line')
    .evaluateAll((elements) =>
      elements.map((e) =>
        e.getAttribute('data-from') === e.getAttribute('data-to') ? '' : e.textContent,
      ),
    )
  expect(lines).toEqual(source.split('\r\n'))
  await page.screenshot({ path: info.outputPath('source-tail.png') })
  await page.getByRole('button', { name: '菜单', exact: true }).click()
  await page.getByRole('button', { name: '另存为', exact: true }).click()
  await expect.poll(() => saveCalls).toBe(1)
  expect(await readFile(saved)).toEqual(bytes)
  expect(await readFile(input)).toEqual(bytes)
  expect(await readFile(sample!)).toEqual(bytes)

  // The same pure static serializer used by output-service, not the installed
  // export dialog or native PDF backend. Audit every nonblank source line.
  const moduleUrl = '/@fs/' + resolve('packages/export/src/static-html.ts')
  const exported = await page.evaluate(
    async ({ moduleUrl, source }) => {
      const { renderStaticMarkdownDocument } = await import(/* @vite-ignore */ moduleUrl)
      const result = renderStaticMarkdownDocument(source, { documentId: 'issue-5', version: 0 })
      const dom = new DOMParser().parseFromString(result.html, 'text/html')
      return {
        ...result,
        text: dom.body.textContent,
        rawHtmlElements: dom.querySelectorAll('p[align="right"]').length,
        thematicBreaks: dom.querySelectorAll('hr').length,
      }
    },
    { moduleUrl, source },
  )
  for (const line of source.split('\r\n')) {
    const payload = line.replace(/^(?:> ?|#{1,6} )/, '').trim()
    if (payload && payload !== '***') expect(exported.text).toContain(payload)
  }
  expect(exported.thematicBreaks).toBe(source.split('\r\n').filter((line) => line === '***').length)
  expect(exported.rawHtmlElements).toBe(0)
  await writeFile(info.outputPath('static-export.html'), exported.html)
  await writeFile(
    info.outputPath('evidence.json'),
    JSON.stringify(
      {
        inputSha256: expectedHash,
        savedSha256: sha(await readFile(saved)),
        bytes: bytes.length,
        utf16: source.length,
        sourceLines: lines.length,
        allSourceLinesExact: true,
        originalUnchanged: true,
        temporaryInputUnchanged: true,
        saveCalls,
        staticExportSha256: sha(exported.html),
        staticExportWarnings: exported.warnings,
        boundary:
          'Chromium desktop UI and test IO adapter; production static serializer. No native file dialog, Tauri write, installed export or PDF claim.',
      },
      null,
      2,
    ),
  )
})

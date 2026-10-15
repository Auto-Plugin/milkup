import { expect, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { build } from 'esbuild'

/** Real Worker modules, public SDK only. Browser fixture has no OS-save claim. */
export async function markdownExtensionFixture(page: Page) {
  const records = []
  for (const directory of ['math', 'diagrams', 'footnotes']) {
    const manifest = JSON.parse(await readFile(`plugins/${directory}/plugin.json`, 'utf8'))
    const bundle = await build({
      entryPoints: [`plugins/${directory}/src/plugin.ts`],
      bundle: true,
      write: false,
      format: 'esm',
      platform: 'browser',
      alias: { '@milkup/plugin-sdk': resolve('packages/plugin-sdk/src/index.js') },
    })
    manifest.main = 'data:text/javascript,' + encodeURIComponent(bundle.outputFiles[0]!.text)
    records.push({
      manifest,
      manifestPath: `/plugins/${directory}/plugin.json`,
      rootPath: `/plugins/${directory}`,
      sourcePath: `/plugins/${directory}/plugin.json`,
      state: 'enabled',
      enabled: true,
      installedAt: 1,
      updatedAt: 1,
      trust: 'development',
      approvals: { permissions: ['document:read'], hosts: ['worker'] },
      errors: [],
    })
  }
  await page.addInitScript(
    (records) =>
      localStorage.setItem(
        'milkup.desktop.plugins.registry.v1',
        JSON.stringify({ version: 1, records, auditRecords: [] }),
      ),
    records,
  )
  await page.goto('/')
  await expect(page.locator('.milkup-input-proxy')).toHaveCount(1)
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(localStorage.getItem('milkup.desktop.plugins.registry.v1')!).records.filter(
            (r: { state: string }) => r.state === 'enabled',
          ).length,
      ),
    )
    .toBe(3)
}
export async function seedMarkdownExtensions(page: Page, text: string) {
  await page.keyboard.press('Control+1')
  await page.locator('.milkup-input-proxy').focus()
  await page.keyboard.press('Control+a')
  await page.keyboard.insertText(text)
  await page.keyboard.press('Control+Home')
  await page.keyboard.press('Control+2')
}

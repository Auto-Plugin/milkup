import { sealWorkerFixture } from './sealed-plugin-fixture'
import { expect, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { build } from 'esbuild'

/** Real math/footnotes Workers plus an explicitly test-only closed image provider.
 * Official Mermaid uses the native DOM host and is covered by native tests.
 * Browser fixture has no official-engine or operating-system save claim.
 */
export async function markdownExtensionFixture(
  page: Page,
  options: { nativeDiagramUnavailable?: boolean } = {},
) {
  const records = []
  for (const directory of ['math', 'diagrams', 'footnotes']) {
    const fixtureImage = directory === 'diagrams' && !options.nativeDiagramUnavailable
    const nativeUnavailable = directory === 'diagrams' && options.nativeDiagramUnavailable
    const root = fixtureImage
      ? 'tests/fixtures/document-presentation-image'
      : `plugins/${directory}`
    const manifest = JSON.parse(await readFile(`${root}/plugin.json`, 'utf8'))
    if (nativeUnavailable) {
      // Small, locatable entry, deliberately never loaded: native preparation
      // rejects before module execution. This does not load the real engine.
      manifest.main = './native-only-placeholder.js'
    } else {
      const bundle = await build({
        entryPoints: [fixtureImage ? `${root}/plugin.ts` : `${root}/src/plugin.ts`],
        bundle: true,
        write: false,
        format: 'esm',
        platform: 'browser',
        alias: { '@milkup/plugin-sdk': resolve('packages/plugin-sdk/src/index.js') },
      })
      await sealWorkerFixture(page, manifest, `/${root}/plugin.json`, bundle.outputFiles[0]!.text)
    }
    const recordRoot = nativeUnavailable
      ? '/tests/fixtures/document-presentation-image'
      : `/${root}`
    records.push({
      manifest,
      manifestPath: `${recordRoot}/plugin.json`,
      rootPath: recordRoot,
      sourcePath: `${recordRoot}/plugin.json`,
      dataRoot: `milkup://plugin-data/${manifest.id}`,
      storageRoot: `milkup://plugin-storage/${manifest.id}`,
      state: 'enabled',
      enabled: true,
      installedAt: 1,
      updatedAt: 1,
      trust: 'development',
      approvals: { permissions: ['document:read'], hosts: [manifest.host ?? 'worker'] },
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
  // Restored records already say enabled before their Workers activate. Wait for
  // this fresh registry's successful activation audit within the host startup budget.
  await expect
    .poll(
      () =>
        page.evaluate(
          (ids) => {
            const snapshot = JSON.parse(localStorage.getItem('milkup.desktop.plugins.registry.v1')!)
            return (
              snapshot !== null &&
              ids.every(
                (id) =>
                  snapshot.records.some(
                    (record: { manifest: { id: string }; state: string; enabled: boolean }) =>
                      record.manifest.id === id && record.state === 'enabled' && record.enabled,
                  ) &&
                  snapshot.auditRecords.some(
                    (audit: { pluginId: string; operation: string; denied?: boolean }) =>
                      audit.pluginId === id && audit.operation === 'enable' && !audit.denied,
                  ),
              )
            )
          },
          records
            .filter((record) => record.manifest.host !== 'dom')
            .map((record) => record.manifest.id as string),
        ),
      { timeout: 10_000 },
    )
    .toBe(true)
}
export async function seedMarkdownExtensions(page: Page, text: string) {
  await page.keyboard.press('Control+1')
  await page.locator('.milkup-input-proxy').focus()
  await page.keyboard.press('Control+a')
  await page.keyboard.insertText(text)
  await page.keyboard.press('Control+Home')
  await page.keyboard.press('Control+2')
}

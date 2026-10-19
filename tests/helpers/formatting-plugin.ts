import { sealWorkerFixture } from './sealed-plugin-fixture'
import { expect, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { build } from 'esbuild'

// A genuine isolated Worker entry bundled solely through the public SDK.
export async function formattingFixture(page: Page) {
  const manifest = JSON.parse(await readFile('plugins/formatting/plugin.json', 'utf8'))
  const bundle = await build({
    entryPoints: ['plugins/formatting/src/plugin.ts'],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'browser',
    alias: { '@milkup/plugin-sdk': resolve('packages/plugin-sdk/src/index.js') },
  })
  await sealWorkerFixture(
    page,
    manifest,
    '/plugins/formatting/plugin.json',
    bundle.outputFiles[0]!.text,
  )
  await page.addInitScript((manifest) => {
    localStorage.setItem(
      'milkup.desktop.plugins.registry.v1',
      JSON.stringify({
        version: 1,
        records: [
          {
            manifest,
            manifestPath: '/plugins/formatting/plugin.json',
            rootPath: '/plugins/formatting',
            sourcePath: '/plugins/formatting/plugin.json',
            dataRoot: `milkup://plugin-data/${manifest.id}`,
            storageRoot: `milkup://plugin-storage/${manifest.id}`,
            state: 'installed',
            enabled: false,
            installedAt: 1,
            updatedAt: 1,
            trust: 'development',
            approvals: { permissions: [], hosts: ['worker'] },
            errors: [],
          },
        ],
        auditRecords: [],
      }),
    )
  }, manifest)
  await page.goto('/')
  await page.getByRole('button', { name: '菜单', exact: true }).click()
  await page.getByRole('button', { name: '插件', exact: true }).click()
  await page.getByRole('button', { name: 'Milkup Formatting', exact: true }).click()
  const approve = page.getByRole('button', { name: '批准能力', exact: true })
  if (await approve.isVisible()) await approve.click()
  else await expect(page.getByRole('button', { name: '撤销审批', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '启用', exact: true }).click()
  await page.locator('[data-menu-close]').click()
  await expect(
    page
      .locator('[data-plugin-slot="document-toolbar"]')
      .getByRole('button', { name: '格式', exact: true }),
  ).toBeVisible()
}

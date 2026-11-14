import { build } from 'esbuild'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const imagesId = 'milkup.images'
export const imagesView = '[data-plugin-ui="milkup.images:images-panel"]'
export async function installImagesFixture(page, { enabled = false, approved = false } = {}) {
  const manifest = JSON.parse(await readFile(resolve(root, 'plugin.json'), 'utf8'))
  const bundle = await build({
    absWorkingDir: root,
    entryPoints: ['src/plugin.ts'],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'browser',
  })
  manifest.main = 'data:text/javascript,' + encodeURIComponent(bundle.outputFiles[0].text)
  await page.addInitScript(
    ({ manifest, enabled, approved }) => {
      const marker = 'milkup.test.images-fixture.seeded'
      if (sessionStorage.getItem(marker)) return
      sessionStorage.setItem(marker, '1')
      const key = 'milkup.desktop.plugins.registry.v1'
      const previous = JSON.parse(
        localStorage.getItem(key) || '{"version":1,"records":[],"auditRecords":[]}',
      )
      const record = {
        manifest,
        manifestPath: '/plugins/images/plugin.json',
        rootPath: '/plugins/images',
        sourcePath: '/plugins/images/plugin.json',
        state: enabled ? 'enabled' : 'installed',
        enabled,
        installedAt: 1,
        updatedAt: 1,
        trust: 'development',
        approvals: { permissions: approved ? manifest.permissions : [], hosts: ['worker'] },
        errors: [],
      }
      localStorage.setItem(
        key,
        JSON.stringify({
          ...previous,
          records: [...previous.records.filter((r) => r.manifest.id !== manifest.id), record],
        }),
      )
    },
    { manifest, enabled, approved },
  )
}

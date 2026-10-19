import type { Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { createPluginPackageArchive } from '../../packages/plugin/src/package'

const catalogs = new WeakMap<Page, Map<string, string>>()

/** Replace only the browser fixture's package-data transport. The actual host
 * still validates the archive and closed bundle, prepares the Worker, and gates
 * activation against the original approvals. No native installation is claimed.
 */
export async function sealWorkerFixture(
  page: Page,
  manifest: Record<string, unknown>,
  manifestPath: string,
  source: string,
): Promise<void> {
  manifest.main = './dist/plugin.js'
  const archive = createPluginPackageArchive(manifest, [
    { path: 'dist/plugin.js', encoding: 'utf8', content: source },
    ...(await Promise.all(
      ((manifest.resources ?? []) as string[]).map(async (path) => ({
        path,
        encoding: 'base64' as const,
        content: (await readFile(resolve(dirname(manifestPath.replace(/^\//, '')), path))).toString(
          'base64',
        ),
      })),
    )),
  ])
  let catalog = catalogs.get(page)
  if (!catalog) {
    catalog = new Map()
    catalogs.set(page, catalog)
    await page.route(/\/src\/bundled-plugin-catalog\.ts(?:\?|$)/, async (route) => {
      await route.fulfill({
        contentType: 'text/javascript',
        body: `const catalog = new Map(${JSON.stringify([...catalog!])});
export function bundledPluginPaths() { return [...catalog.keys()].sort(); }
export function readBundledPlugin(path) { return catalog.get(path); }`,
      })
    })
  }
  catalog.set(manifestPath, JSON.stringify(archive))
}

/** Normalize legacy, test-owned serialized seeds without changing approval or
 * enabled state. This also keeps the shared native outline fixture untouched.
 */
export async function sealRegistryFixture(page: Page, serialized: string): Promise<string> {
  const snapshot = JSON.parse(serialized)
  for (const record of snapshot.records) {
    const main = record.manifest.main
    if (typeof main === 'string' && main.startsWith('data:text/javascript,'))
      await sealWorkerFixture(
        page,
        record.manifest,
        record.manifestPath,
        decodeURIComponent(main.slice('data:text/javascript,'.length)),
      )
  }
  return JSON.stringify(snapshot)
}

async function installStandaloneFixture(
  page: Page,
  directory: 'preferences' | 'images',
  { enabled = false, approved = false }: { enabled?: boolean; approved?: boolean } = {},
): Promise<void> {
  const root = resolve('plugins', directory)
  const manifest = JSON.parse(await readFile(resolve(root, 'plugin.json'), 'utf8'))
  const { build } = await import('esbuild')
  const bundle = await build({
    absWorkingDir: root,
    entryPoints: ['src/plugin.ts'],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'browser',
  })
  await sealWorkerFixture(
    page,
    manifest,
    `/plugins/${directory}/plugin.json`,
    bundle.outputFiles[0]!.text,
  )
  await page.addInitScript(
    ({ manifest, directory, enabled, approved }) => {
      const marker = `milkup.test.${directory}-fixture.seeded`
      if (sessionStorage.getItem(marker)) return
      sessionStorage.setItem(marker, '1')
      const key = 'milkup.desktop.plugins.registry.v1'
      const previous = JSON.parse(
        localStorage.getItem(key) || '{"version":1,"records":[],"auditRecords":[]}',
      )
      const record = {
        manifest,
        manifestPath: `/plugins/${directory}/plugin.json`,
        rootPath: `/plugins/${directory}`,
        sourcePath: `/plugins/${directory}/plugin.json`,
        dataRoot: `milkup://plugin-data/${manifest.id}`,
        storageRoot: `milkup://plugin-storage/${manifest.id}`,
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
          records: [
            ...previous.records.filter(
              (r: { manifest: { id: string } }) => r.manifest.id !== manifest.id,
            ),
            record,
          ],
        }),
      )
    },
    { manifest, directory, enabled, approved },
  )
}

export const installPreferencesFixture = (
  page: Page,
  options?: { enabled?: boolean; approved?: boolean },
) => installStandaloneFixture(page, 'preferences', options)
export const installImagesFixture = (
  page: Page,
  options?: { enabled?: boolean; approved?: boolean },
) => installStandaloneFixture(page, 'images', options)

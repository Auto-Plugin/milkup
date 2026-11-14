import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { buildSync } from 'esbuild'

// Fast browser fixtures still seed a development registry. Production acceptance
// separately installs the standalone .milkup-plugin through the native picker.
export function outlineRegistry(loadDelay = 0) {
  const manifest = JSON.parse(
    readFileSync(new URL('../../plugins/outline/plugin.json', import.meta.url), 'utf8'),
  )
  const { outputFiles } = buildSync({
    entryPoints: [fileURLToPath(new URL('../../plugins/outline/src/plugin.ts', import.meta.url))],
    alias: {
      '@milkup/plugin-sdk': fileURLToPath(
        new URL('../../packages/plugin-sdk/src/index.js', import.meta.url),
      ),
    },
    bundle: true,
    write: false,
    platform: 'browser',
    format: 'esm',
    target: 'es2022',
  })
  manifest.main =
    'data:text/javascript,' +
    encodeURIComponent(
      `await new Promise(resolve => setTimeout(resolve, ${loadDelay}));\n` + outputFiles[0].text,
    )
  return JSON.stringify({
    version: 1,
    records: [
      {
        manifest,
        manifestPath: '/development/milkup-outline/plugin.json',
        rootPath: '/development/milkup-outline',
        sourcePath: '/development/milkup-outline/plugin.json',
        state: 'enabled',
        enabled: true,
        installedAt: 1,
        updatedAt: 1,
        trust: 'development',
        dataRoot: 'milkup://plugin-data/milkup.outline',
        storageRoot: 'milkup://plugin-storage/milkup.outline',
        approvals: { permissions: ['document:read'], hosts: ['worker'] },
        errors: [],
      },
    ],
    auditRecords: [],
  })
}

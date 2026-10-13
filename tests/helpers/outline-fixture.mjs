import { readFileSync } from 'node:fs'
import ts from 'typescript'

// Install the actual repository plugin through the existing development registry.
export function outlineRegistry(loadDelay = 0) {
  const manifest = JSON.parse(
    readFileSync(new URL('../../plugins/outline/plugin.json', import.meta.url), 'utf8'),
  )
  const source = readFileSync(
    new URL('../../plugins/outline/src/plugin.ts', import.meta.url),
    'utf8',
  )
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  })
  manifest.main =
    'data:text/javascript,' +
    encodeURIComponent(
      `await new Promise(resolve => setTimeout(resolve, ${loadDelay}));\n` + outputText,
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

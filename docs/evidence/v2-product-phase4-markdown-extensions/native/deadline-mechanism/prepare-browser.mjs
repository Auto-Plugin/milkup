// Preparation only. Generates an injectable probe; does not launch any browser.
import { build } from '/workspace/milkup/node_modules/esbuild/lib/main.js'
import { readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
const root = '/workspace/milkup'
const entry = await readFile(new URL('./browser-entry.js', import.meta.url), 'utf8')
const result = await build({
  stdin: { contents: entry, resolveDir: root, loader: 'ts' },
  bundle: true,
  write: false,
  platform: 'browser',
  format: 'iife',
  target: 'es2022',
})
const client = await readFile(`${root}/packages/plugin/src/document-render-rpc.ts`)
const sha = createHash('sha256').update(client).digest('hex')
await writeFile(new URL('./browser-probe.js', import.meta.url), result.outputFiles[0].text)
await writeFile(
  new URL('./browser-preparation.json', import.meta.url),
  JSON.stringify(
    {
      preparedOnly: true,
      browserRun: false,
      originalClientSha256: sha,
      diagnosticOnly: true,
      budgetMs: 2000,
    },
    null,
    2,
  ) + '\n',
)
console.log(`Prepared browser-probe.js; original client ${sha}; no browser launched`)

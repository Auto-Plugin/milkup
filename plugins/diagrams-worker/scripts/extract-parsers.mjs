// Offline maintainer verification only. The normal build uses vendored parsers.
// Usage: node scripts/extract-parsers.mjs /path/to/unpacked/mermaid-12.2.0
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
if (!process.argv[2])
  throw new Error(
    'Supply an existing unpacked Mermaid 12.2.0 package; this script never downloads code',
  )
const provenance = JSON.parse(await readFile(resolve(root, 'dependency-provenance.json'), 'utf8'))
const digest = (value) => createHash('sha256').update(value).digest('hex')
for (const parser of provenance.parsers) {
  const input = await readFile(resolve(process.argv[2], parser.upstreamPath))
  if (digest(input) !== parser.inputSha256)
    throw new Error('Upstream hash mismatch: ' + parser.upstreamPath)
  const extracted =
    'const __name = (fn, name) => Object.defineProperty(fn, "name", {value:name, configurable:true});\n' +
    input.toString('utf8').slice(parser.from, parser.to) +
    '\nexport default parser;\n'
  const vendored = await readFile(resolve(root, parser.vendoredPath), 'utf8')
  if (extracted !== vendored || digest(extracted) !== parser.outputSha256)
    throw new Error('Extraction mismatch: ' + parser.vendoredPath)
  console.log('Verified exact extraction: ' + parser.vendoredPath)
}

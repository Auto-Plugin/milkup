import assert from 'node:assert/strict'
import { readFile, lstat } from 'node:fs/promises'
import path from 'node:path'
import { verifyGuiEvidence } from './mermaid-gui-contract.mjs'

const root = path.resolve(process.argv[2] ?? '')
assert(
  process.argv.length === 3,
  'Usage: node verify-mermaid-gui-evidence.mjs <retained evidence directory>',
)
async function read(name, limit) {
  const file = path.join(root, name),
    stat = await lstat(file)
  assert(stat.isFile() && !stat.isSymbolicLink() && stat.size <= limit)
  const bytes = await readFile(file)
  assert.equal(bytes.length, stat.size)
  return bytes
}
const report = JSON.parse(await read('gui-regression.json', 1024 * 1024))
const native = await read('gui-native-audit.json', 2 * 1024 * 1024)
const windows = await read('native-window-events.json', 2 * 1024 * 1024)
console.log(JSON.stringify(verifyGuiEvidence(report, native, windows)))

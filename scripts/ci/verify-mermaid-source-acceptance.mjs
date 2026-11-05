import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

export function verifySourceAcceptance(receipt, runId, sha, rendererMode = 'native') {
  assert(['native', 'frontend'].includes(rendererMode), 'Explicit source renderer contract')
  assert.match(runId, /^[1-9][0-9]*$/)
  assert.match(sha, /^[a-f0-9]{40}$/)
  assert.equal(String(receipt.id), runId, 'Source run identity')
  assert.equal(receipt.repository?.full_name, 'Auto-Plugin/milkup', 'Source repository')
  assert.equal(receipt.status, 'completed', 'Source run must be completed')
  assert.equal(receipt.conclusion, 'success', 'Source run must pass')
  assert.equal(receipt.head_sha, sha, 'Exact accepted source SHA')
  assert.equal(receipt.head_branch, 'dot/mermaid-stability-20261104', 'Source branch')
  assert.equal(
    receipt.path,
    rendererMode === 'frontend'
      ? '.github/workflows/mermaid-windows-frontend-compat.yml'
      : '.github/workflows/mermaid-windows-account-compat.yml',
    'Source workflow',
  )
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  assert.equal(
    process.argv.length,
    6,
    'receipt file, source run ID, SHA and renderer mode required',
  )
  const bytes = await readFile(process.argv[2])
  assert.ok(bytes.length > 0 && bytes.length <= 1024 * 1024, 'Bounded source receipt')
  verifySourceAcceptance(
    JSON.parse(bytes.toString('utf8')),
    process.argv[3],
    process.argv[4],
    process.argv[5],
  )
}

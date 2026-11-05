import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { verifySourceAcceptance } from './verify-mermaid-source-acceptance.mjs'

const runId = '42021529824'
const sha = 'f9c802f5acb735c9f3b41fb13ad6dbf03f1631d2'
const receipt = {
  id: Number(runId),
  repository: { full_name: 'Auto-Plugin/milkup' },
  status: 'completed',
  conclusion: 'success',
  head_sha: sha,
  head_branch: 'dot/mermaid-stability-20261104',
  path: '.github/workflows/mermaid-windows-account-compat.yml',
}
test('accepts the exact successful dual-account source receipt', () => {
  verifySourceAcceptance(receipt, runId, sha)
})
for (const [key, value] of Object.entries({
  id: 41985364078,
  repository: { full_name: 'other/milkup' },
  status: 'in_progress',
  conclusion: 'failure',
  head_sha: 'a'.repeat(40),
  head_branch: 'main',
  path: '.github/workflows/mermaid-windows-trial-delivery.yml',
})) {
  test(`rejects source receipt mismatch: ${key}`, () => {
    assert.throws(() => verifySourceAcceptance({ ...receipt, [key]: value }, runId, sha))
  })
}
test('rejects missing receipt fields and malformed request identity', () => {
  for (const key of Object.keys(receipt)) {
    const incomplete = { ...receipt }
    delete incomplete[key]
    assert.throws(() => verifySourceAcceptance(incomplete, runId, sha))
  }
  for (const id of ['', '../runs/1', '0', '1; exit']) {
    assert.throws(() => verifySourceAcceptance(receipt, id, sha))
  }
  assert.throws(() => verifySourceAcceptance(receipt, runId, sha.toUpperCase()))
})
test('both installer workflows forward the accepted receipt into the protected builder', async () => {
  for (const name of ['trial-delivery', 'installer-lifecycle']) {
    const workflow = await readFile(
      new URL(`../../.github/workflows/mermaid-windows-${name}.yml`, import.meta.url),
      'utf8',
    )
    assert.match(
      workflow,
      /git diff --exit-code .* -- vendor\/wry \.gitattributes scripts\/frontend-mermaid-document\.mjs /,
    )
    const build = workflow.split('      - name: Build release NSIS')[1].split('      - name:')[0]
    assert.match(build, /GH_TOKEN: \$\{\{ github.token \}\}/)
    assert.match(build, /ACCEPTED_SOURCE_RUN: \$\{\{ inputs.accepted_source_run/)
    assert.match(build, /ACCEPTED_SOURCE_SHA: \$\{\{ inputs.accepted_source_sha/)
    assert.match(
      build,
      /-AcceptedSourceRunId \$env:ACCEPTED_SOURCE_RUN -AcceptedSourceSha \$env:ACCEPTED_SOURCE_SHA/,
    )
  }
  const builder = await readFile(
    new URL('./build-windows-mermaid-trial.ps1', import.meta.url),
    'utf8',
  )
  assert.match(
    builder,
    /verify-mermaid-source-acceptance\.mjs', \$sourceReceiptPath, \$AcceptedSourceRunId, \$AcceptedSourceSha/,
  )
  assert.match(builder, /'merge-base', '--is-ancestor', \$AcceptedSourceSha, \$sha/)
  assert.match(builder, /'diff', '--exit-code', \$AcceptedSourceSha, \$sha, '--', 'vendor\/wry'/)
  assert.match(
    builder,
    /'vendor\/wry', '\.gitattributes', 'scripts\/frontend-mermaid-document\.mjs'/,
  )
  assert.match(builder, /reviewedImplementationBase = \$AcceptedSourceSha/)
  assert.match(builder, /sourceAcceptanceRunId = \[long\]\$AcceptedSourceRunId/)
  assert.doesNotMatch(builder, /a22f8c35|41985364078/)
})

test('frontend packaging requires an exact successful frontend source workflow, not a native green run', () => {
  const frontend = { ...receipt, path: '.github/workflows/mermaid-windows-frontend-compat.yml' }
  verifySourceAcceptance(frontend, runId, sha, 'frontend')
  assert.throws(() => verifySourceAcceptance(receipt, runId, sha, 'frontend'))
  assert.throws(() => verifySourceAcceptance(frontend, runId, sha, 'native'))
  assert.throws(() => verifySourceAcceptance(frontend, runId, sha, 'unknown'))
})

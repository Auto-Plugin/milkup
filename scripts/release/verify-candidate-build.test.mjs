import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { verifyCandidateBuild } from './verify-candidate-build.mjs'

const sha = 'a'.repeat(40)
const runId = '43616134287'
const fixture = () => ({
  id: Number(runId),
  repository: { full_name: 'Auto-Plugin/milkup' },
  head_repository: { full_name: 'Auto-Plugin/milkup' },
  head_branch: 'v2',
  head_sha: sha,
  event: 'workflow_dispatch',
  path: '.github/workflows/distribution-candidate.yml',
  status: 'completed',
  conclusion: 'success',
})

test('manual exact v2 build is eligible for separate byte and installation gates', () => {
  const result = verifyCandidateBuild(fixture(), runId, sha)
  assert.equal(result.sourceSha, sha)
  assert.equal(result.status, 'build-provenance-verified-not-installed')
})

for (const [field, value] of [
  ['id', Number(runId) + 1],
  ['id', runId],
  ['repository', { full_name: 'someone/milkup' }],
  ['head_repository', { full_name: 'someone/milkup' }],
  ['head_branch', 'main'],
  ['head_branch', 'dot/release-quality-integration-20261112'],
  ['head_branch', 'v2-scratch'],
  ['head_sha', 'b'.repeat(40)],
  ['event', 'push'],
  ['event', 'pull_request'],
  ['path', '.github/workflows/unrelated.yml'],
  ['status', 'in_progress'],
  ['conclusion', 'failure'],
  ['conclusion', 'cancelled'],
  ['conclusion', 'skipped'],
]) {
  test(`reject altered build provenance: ${field}=${JSON.stringify(value)}`, () => {
    assert.throws(() => verifyCandidateBuild({ ...fixture(), [field]: value }, runId, sha))
  })
}

test('no missing field or malformed caller identity can bypass provenance', () => {
  for (const field of Object.keys(fixture())) {
    const run = fixture()
    delete run[field]
    assert.throws(() => verifyCandidateBuild(run, runId, sha), field)
  }
  for (const id of ['0', '01', '-1', '1e3', '9007199254740993', `${runId}\n`]) {
    assert.throws(() => verifyCandidateBuild(fixture(), id, sha))
  }
  for (const source of [sha.slice(0, 12), sha.toUpperCase(), `${sha}\n`, 'v2']) {
    assert.throws(() => verifyCandidateBuild(fixture(), runId, source))
  }
})

test('actual CLI rejects bad JSON, symlink and oversized evidence and returns nonzero', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'milkup-build-proof-'))
  const file = path.join(dir, 'run.json')
  const script = fileURLToPath(new URL('./verify-candidate-build.mjs', import.meta.url))
  const invoke = (target = file) =>
    spawnSync(process.execPath, [script, target, runId, sha], { encoding: 'utf8' })
  try {
    await writeFile(file, JSON.stringify(fixture()))
    const valid = invoke()
    assert.equal(valid.status, 0, valid.stderr)
    assert.equal(JSON.parse(valid.stdout).sourceSha, sha)
    const link = path.join(dir, 'link.json')
    await symlink(file, link)
    assert.notEqual(invoke(link).status, 0)
    await writeFile(file, JSON.stringify({ ...fixture(), head_sha: 'b'.repeat(40) }))
    assert.notEqual(invoke().status, 0)
    await writeFile(file, '{')
    assert.notEqual(invoke().status, 0)
    await writeFile(file, Buffer.alloc(2 * 1024 * 1024 + 1, 32))
    assert.notEqual(invoke().status, 0)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('installation checks build provenance before download and exact bytes afterwards', async () => {
  const workflow = await readFile(
    new URL('../../.github/workflows/distribution-install-candidate.yml', import.meta.url),
    'utf8',
  )
  const gate =
    'node scripts/release/verify-candidate-build.mjs "$RUNNER_TEMP/build-run.json" "$BUILD_RUN" "$SOURCE_SHA"'
  const download = 'gh run download "$BUILD_RUN"'
  const bytes =
    'node scripts/release/verify-candidate.mjs "$RUNNER_TEMP/candidate-input" "$SOURCE_SHA" "$VARIANT"'
  assert.ok(workflow.includes(gate))
  assert.ok(workflow.indexOf(gate) < workflow.indexOf(download))
  assert.ok(workflow.indexOf(download) < workflow.indexOf(bytes))
  assert.ok(workflow.includes('node --test scripts/release/verify-candidate-build.test.mjs'))
})

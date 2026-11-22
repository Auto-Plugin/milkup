import assert from 'node:assert/strict'
import { lstat, readFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

// The normal candidate path follows the consolidated v2 branch. Historical
// package reuse has its own pinned receipt and must not enter this path.
export function verifyCandidateBuild(run, runId, sourceSha) {
  assert.match(runId, /^[1-9][0-9]*$/, 'Exact build run ID required')
  assert.ok(Number.isSafeInteger(Number(runId)), 'Build run ID exceeds safe range')
  assert.match(sourceSha, /^[a-f0-9]{40}$/, 'Exact source SHA required')
  assert.equal(run.id, Number(runId), 'Wrong build run')
  assert.equal(run.repository?.full_name, 'Auto-Plugin/milkup', 'Wrong build repository')
  assert.equal(run.head_repository?.full_name, 'Auto-Plugin/milkup', 'Fork build rejected')
  assert.equal(run.head_branch, 'v2', 'Consolidated v2 candidate required')
  assert.equal(run.head_sha, sourceSha, 'Wrong source SHA')
  assert.equal(run.event, 'workflow_dispatch', 'Explicit manual candidate required')
  assert.equal(run.path, '.github/workflows/distribution-candidate.yml', 'Wrong workflow')
  assert.equal(run.status, 'completed', 'Build has not finished')
  assert.equal(run.conclusion, 'success', 'Build did not pass')
  return {
    schema: 1,
    status: 'build-provenance-verified-not-installed',
    runId: run.id,
    sourceSha,
    sourceBranch: run.head_branch,
    workflow: run.path,
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  assert.equal(process.argv.length, 5, 'Usage: verify-candidate-build.mjs run.json run-id sha')
  const [, , file, runId, sourceSha] = process.argv
  const stat = await lstat(file)
  assert.ok(stat.isFile() && !stat.isSymbolicLink(), 'Regular run receipt required')
  assert.ok(stat.size > 0 && stat.size <= 2 * 1024 * 1024, 'Bounded run receipt required')
  console.log(
    JSON.stringify(
      verifyCandidateBuild(JSON.parse(await readFile(file, 'utf8')), runId, sourceSha),
      null,
      2,
    ),
  )
}

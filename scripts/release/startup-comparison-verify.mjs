import assert from 'node:assert/strict'
import { readFile, stat } from 'node:fs/promises'
import {
  StartupLog,
  fixtureSource,
  sha,
  logBudget,
  verifyCatalogRestart,
} from './startup-comparison-contract.mjs'
const bounded = async (file, budget) => {
  assert((await stat(file)).size <= budget)
  return readFile(file)
}
const json = (bytes) => JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, ''))
const spec = json(await bounded(process.argv[2], 16384))
const observation = json(await bounded(spec.report, logBudget))
assert.deepEqual(observation.spec, spec)
assert.equal(observation.status, 'observed-await-normal-close')
assert.equal(observation.inputs, 0)
const document = await bounded(spec.document, logBudget)
assert.equal(sha(document), spec.documentSha256)
const bytes = await bounded(spec.stderr, logBudget)
const parser = new StartupLog(spec.pid, fixtureSource(document), Date.parse(spec.creationUtc))
parser.append(bytes.toString('utf8'), bytes.length)
parser.finish()
assert(parser.firstReady)
assert.deepEqual(parser.firstReady, observation.observation.ready)
assert(parser.records.some((r) => r.kind === 'MILKUP_STARTUP_TIMING'))
assert(parser.records.some((r) => r.kind === 'MILKUP_WRY_STARTUP_TIMING'))
assert(parser.records.some((r) => r.kind === 'MILKUP_CATALOG_TIMING'))
if (spec.mode === 'none') {
  assert.equal(observation.connectionAttempts, 0)
  assert.equal(observation.sessionId, undefined)
  assert.equal(observation.observation.dom, null)
} else {
  assert(observation.sessionId && observation.observation.dom.decoded)
  assert(Date.parse(observation.attachStartedUtc) <= Date.parse(observation.attachFinishedUtc))
  if (spec.mode === 'late')
    assert(Date.parse(observation.attachStartedUtc) >= parser.firstReady.timestampUnixMs)
}
const catalogue = verifyCatalogRestart(
  await bounded(spec.catalogBefore, logBudget),
  await bounded(spec.catalogAfter, logBudget),
)
const stdout = await bounded(spec.stdout, logBudget)
console.log(
  JSON.stringify({
    status: 'passed',
    catalogue,
    mode: spec.mode,
    pid: spec.pid,
    creationTicks: spec.creationTicks,
    stderr: {
      bytes: bytes.length,
      sha256: sha(bytes),
      lines: parser.lines,
      records: parser.records.length,
    },
    stdout: { bytes: stdout.length, sha256: sha(stdout) },
    firstReady: parser.firstReady,
    nativeFirstReadyFromCreationMs:
      parser.firstReady.timestampUnixMs - Date.parse(spec.creationUtc),
  }),
)

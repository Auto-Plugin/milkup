import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fences, source, sha, classifyEntry, ledgerFromLog } from './mermaid-visible-contract.mjs'

test('distinct sources keep immediate entry outside initial bounded prefetch and control nearby', () => {
  assert.equal(fences.length, 3)
  assert.equal(new Set(fences.map((f) => f.sourceSha256)).size, 3)
  const line = (f) => source.slice(0, f.from).split('\n').length
  assert(line(fences[1]) - line(fences[0]) > 256)
  assert(line(fences[2]) - line(fences[1]) < 256)
  for (const f of fences) assert.equal(sha(source.slice(f.from + 11, f.to - 3)), f.sourceSha256)
})
const row = () => ({
  scenario: 'cold-entry',
  sourceSha256: fences[1].sourceSha256,
  firstInputUnix: 1010,
  observation: {
    complete: true,
    timeOrigin: 1000,
    firstVisible: 20,
    decoded: 80,
    sourceVisibleFrames: 3,
    maxSampleGapMs: 16,
    decodedAtFirstSample: false,
  },
  ready: { sourceSha256: fences[1].sourceSha256, timestampUnixMs: 1060 },
})
test('cold label cannot hide prefetched or left-censored outcomes', () => {
  const r = row()
  assert.equal(classifyEntry(r).coldComparisonEstablished, true)
  r.ready.timestampUnixMs = 1005
  assert.equal(classifyEntry(r).coldComparisonEstablished, false)
  assert.equal(classifyEntry(r).readyBeforeFirstInput, true)
  r.ready.timestampUnixMs = 1060
  r.observation.decodedAtFirstSample = true
  assert.equal(classifyEntry(r).coldComparisonEstablished, false)
  r.observation.decodedAtFirstSample = false
  r.scenario = 'prefetch-ready'
  assert.equal(classifyEntry(r).coldComparisonEstablished, false)
  assert.equal(classifyEntry(r).noFlashProven, false)
})
test('incomplete or cross-source observations cannot claim a measurement', () => {
  for (const mutate of [
    (r) => (r.observation.complete = false),
    (r) => (r.observation.decoded = null),
    (r) => (r.ready.sourceSha256 = fences[0].sourceSha256),
    (r) => (r.scenario = 'unknown'),
  ]) {
    const r = row()
    mutate(r)
    assert.throws(() => classifyEntry(r))
  }
})
test('final log rejects truncation, external renderer and wrong process identity', () => {
  const spec = {
    pid: 123,
    creationFileTime: '123456',
    sid: 'test',
    session: 1,
    creationUtc: '2026-11-15T00:00:00Z',
  }
  assert.throws(() => ledgerFromLog(Buffer.from('partial'), spec, true), /truncated/)
  assert.throws(() => ledgerFromLog(Buffer.alloc(1024 * 1024 + 1), spec), /bounded/)
  assert.throws(
    () => ledgerFromLog(Buffer.from('MILKUP_MERMAID_NATIVE_AUDIT {}\n'), spec),
    /External/,
  )
  const event = {
    renderer: 'frontend-mermaid-12.2.0',
    productPid: 124,
    timestampUnixMs: Date.parse(spec.creationUtc) + 1,
  }
  assert.throws(() =>
    ledgerFromLog(
      Buffer.from('MILKUP_MERMAID_FRONTEND_AUDIT ' + JSON.stringify(event) + '\n'),
      spec,
    ),
  )
})

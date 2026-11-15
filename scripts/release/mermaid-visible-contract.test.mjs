import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  fences,
  source,
  sha,
  classifyEntry,
  ledgerFromLog,
  documents,
  catalogReady,
  requestSnapshot,
  cursorResult,
  collectStage,
  assertStartupRetained,
  warmApproachFrom,
} from './mermaid-visible-contract.mjs'

test('independent documents retain distinct sources and cold/warm prefetch distances', () => {
  assert.equal(fences.length, 3)
  assert.equal(new Set(fences.map((f) => f.sourceSha256)).size, 3)
  const line = (i) => documents[i].text.slice(0, fences[i].from).split('\n').length
  assert(line(1) > 256)
  assert(line(2) > 450)
  assert(documents[2].text.slice(0, warmApproachFrom).split('\n').length > 250)
  assert(documents[2].text.slice(warmApproachFrom, fences[2].from).split('\n').length < 256)
  documents.forEach((d, i) =>
    assert.equal(sha(d.text.slice(fences[i].from + 11, fences[i].to - 3)), fences[i].sourceSha256),
  )
})
test('cursor causal gate requires settled catalog, actual render counts and image identity', () => {
  const before = {
    catalogReady: true,
    quietMs: 1500,
    imageId: 1,
    requests: { admitted: ['a'], started: ['a'] },
  }
  const after = structuredClone(before)
  assert(cursorResult(before, after).passed)
  for (const mutate of [
    (a) => (a.catalogReady = false),
    (a) => (a.imageId = 2),
    (a) => a.requests.admitted.push('b'),
    (a) => a.requests.started.push('b'),
  ]) {
    const changed = structuredClone(after)
    mutate(changed)
    assert.equal(cursorResult(before, changed).passed, false)
  }
  assert.equal(cursorResult({ ...before, quietMs: 1499 }, after).isolated, false)
  assert.equal(catalogReady({ marks: [] }), false)
  assert(catalogReady({ marks: [{ name: 'milkup:startup:plugin-catalog-ready' }] }))
  const ledger = {
    jobs: new Map([
      ['a', { requestId: 'a', admitted: { sourceSha256: 'x' }, started: {}, finished: {} }],
      ['b', { requestId: 'b', admitted: { sourceSha256: 'y' } }],
    ]),
  }
  assert.deepEqual(requestSnapshot(ledger, 'x'), {
    admitted: ['a'],
    started: ['a'],
    finished: ['a'],
  })
})
test('failed cursor stage persists and permits independent stages and close handoff, never passes', async () => {
  const record = { stages: [] },
    calls = []
  const persist = async () => calls.push('persist')
  await collectStage(
    record,
    'cursor',
    async () => {
      throw Error('re-rendered')
    },
    persist,
  )
  await collectStage(record, 'entry', async () => calls.push('entry'), persist)
  calls.push('handoff-to-native-close')
  assert.deepEqual(calls, ['persist', 'entry', 'persist', 'handoff-to-native-close'])
  assert.equal(record.stages[0].status, 'failed')
  assert.match(record.stages[0].error, /re-rendered/)
  assert.equal(record.stages[1].status, 'passed')
})
const row = () => ({
  scenario: 'cold-entry',
  sourceSha256: fences[1].sourceSha256,
  firstInputUnix: 1010,
  readyAtInstall: [],
  started: { timestampUnixMs: 1002 },
  observation: {
    complete: true,
    timeOrigin: 1000,
    begun: 0,
    firstVisible: 20,
    decoded: 80,
    sourceVisibleFrames: 3,
    maxSampleGapMs: 16,
    decodedAtFirstSample: false,
    transitions: [
      { at: 1, inView: false },
      { at: 20, inView: true },
    ],
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

test('already visible warm fixture cannot prove offscreen prefetch or zero entry wait', () => {
  const r = row()
  r.scenario = 'prefetch-ready'
  r.ready.timestampUnixMs = 1005
  assert.equal(classifyEntry(r).prefetchComparisonEstablished, true)
  r.observation.transitions = [{ at: 20, inView: true }]
  r.observation.decodedAtFirstSample = true
  assert.equal(classifyEntry(r).prefetchComparisonEstablished, false)
  assert.equal(classifyEntry(r).visibleAtFirstSample, true)
  r.scenario = 'cold-entry'
  r.ready.timestampUnixMs = 1060
  r.observation.decodedAtFirstSample = false
  assert.equal(classifyEntry(r).coldComparisonEstablished, false)
})

test('catalog finalization must not admit or execute the same source twice', () => {
  const b = {
    inputCountAfter: 0,
    last: { requests: { admitted: ['a'], started: ['a'], finished: ['a'] } },
    transitions: [{ imageId: null }, { imageId: 1 }],
  }
  assert.doesNotThrow(() => assertStartupRetained(b))
  for (const mutate of [
    (x) => x.last.requests.started.push('b'),
    (x) => x.last.requests.admitted.push('b'),
    (x) => x.transitions.push({ imageId: 2 }),
    (x) => (x.inputCountAfter = 1),
  ]) {
    const x = structuredClone(b)
    mutate(x)
    assert.throws(() => assertStartupRetained(x))
  }
})

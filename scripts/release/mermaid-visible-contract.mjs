import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { AuditLedger } from '../../tests/windows/mermaid-product-e2e.mjs'
import {
  frontendLedgerClass,
  FRONTEND_AUDIT_PREFIX,
} from '../../tests/windows/mermaid-frontend-contract.mjs'
export const sha = (bytes) => createHash('sha256').update(bytes).digest('hex')
// Drive the existing plugin settings UI; never write storage or change the
// editor's global mode to manufacture a render-only sample.
export async function selectMermaidEntryPolicy({ pointer, keys, observe, until }) {
  const before = await observe()
  if (!before.menu) await pointer('[data-menu-toggle]')
  await pointer('[data-menu-section="plugins"]')
  if ((await observe()).details) await pointer('[data-plugin-action="back"]')
  await pointer(
    '.plugin-summary-card[data-plugin-id="milkup.diagrams"] [data-plugin-action="details"]',
  )
  await pointer('[data-mermaid-render-mode]')
  await keys('\uE011\uE015\uE007')
  await until(async () => {
    const s = await observe()
    return s.selectedPolicy === 'preview' && s.storedPluginPolicy === 'preview'
  }, 'Plugin-only render strategy persisted')
  await pointer('[data-menu-close]')
  await until(async () => !(await observe()).menu, 'Plugin settings closed')
  const after = await observe()
  assert.equal(after.editorMode, before.editorMode, 'Plugin policy must not change document mode')
  assert.equal(after.storedPluginPolicy, 'preview')
  return { before, after, input: 'real-pointer-and-keyboard', policy: 'preview' }
}
const graph = (label) => '```mermaid\nflowchart LR\n A[' + label + '] --> B[visible]\n```\n'
export const documents = [
  { scenario: 'document-open', text: '# Visible latency\n\n' + graph('OPEN_569f') + '\nTail\n' },
  {
    scenario: 'cold-entry',
    text:
      '# Immediate entry\n\n' +
      Array.from({ length: 350 }, (_, i) => `Entry lead ${i}\n`).join('') +
      graph('ENTRY_569f') +
      '\nTail\n',
  },
  {
    scenario: 'prefetch-ready',
    text:
      '# Independent warm control\n\n' +
      Array.from({ length: 500 }, (_, i) => `Warm lead ${i}\n`).join('') +
      graph('WARM_569f') +
      '\nTail\n',
  },
]
// Approach a still-offscreen target by a real wheel input, staying within the
// product's bounded prefetch distance. Separate source, no stale warm-cache match.
export const warmApproachFrom = documents[2].text.split('\n').slice(0, 300).join('\n').length + 1
export function assertStartupRetained(baseline) {
  assert.equal(baseline.inputCountAfter, 0)
  assert.equal(baseline.last.requests.admitted.length, 1, 'One cold-start source admission')
  assert.equal(baseline.last.requests.started.length, 1, 'No redundant startup render')
  assert.equal(baseline.last.requests.finished.length, 1)
  const images = new Set(baseline.transitions.map((t) => t.imageId).filter((id) => id !== null))
  assert.equal(images.size, 1, 'No startup image replacement')
}
export const source = documents[0].text
export const fences = documents.map(({ text }) => {
  const m = [...text.matchAll(/```mermaid\n([\s\S]*?)```/g)]
  assert.equal(m.length, 1)
  return { from: m[0].index, to: m[0].index + m[0][0].length, sourceSha256: sha(m[0][1]) }
})
export const documentPath = (initial, index) =>
  index === 0 ? initial : initial + '.' + documents[index].scenario + '.md'
export const catalogReady = (startup) =>
  startup.marks.some((m) => m.name === 'milkup:startup:plugin-catalog-ready')
export function requestSnapshot(ledger, sourceSha256) {
  const rows = [...ledger.jobs.values()].filter(
    (j) => !sourceSha256 || j.admitted.sourceSha256 === sourceSha256,
  )
  return {
    admitted: rows.map((j) => j.requestId),
    started: rows.filter((j) => j.started).map((j) => j.requestId),
    finished: rows.filter((j) => j.finished).map((j) => j.requestId),
  }
}
export function cursorResult(before, after) {
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
  const isolated = before.catalogReady && after.catalogReady && before.quietMs >= 1500
  const noAdditionalAdmissions = same(before.requests.admitted, after.requests.admitted)
  const noAdditionalRenders = same(before.requests.started, after.requests.started)
  const sameImage = before.imageId !== null && before.imageId === after.imageId
  return {
    isolated,
    noAdditionalAdmissions,
    noAdditionalRenders,
    sameImage,
    passed: isolated && noAdditionalAdmissions && noAdditionalRenders && sameImage,
  }
}
// Functional errors remain failures, but must not prevent later independent
// observations or the native wrapper's close/EOF/release verification.
export async function collectStage(record, name, action, persist) {
  const stage = { name, status: 'running', startedUnixMs: Date.now() }
  record.stages.push(stage)
  try {
    await action()
    stage.status = 'passed'
  } catch (error) {
    stage.status = 'failed'
    stage.error = String(error)
  } finally {
    stage.finishedUnixMs = Date.now()
    await persist()
  }
  return stage
}
export function ledgerFromLog(bytes, spec, final = false) {
  assert(bytes.length <= 1024 * 1024, 'Complete bounded stderr required')
  const text = bytes.toString('utf8'),
    lines = text.split('\n')
  if (final) assert.equal(lines.at(-1), '', 'No truncated final record')
  lines.pop()
  const Ledger = frontendLedgerClass(AuditLedger)
  const ledger = new Ledger(spec.sid, spec.session, 'pure-standard')
  ledger.registerLaunch({ productPid: spec.pid, creationFileTime: spec.creationFileTime })
  for (const line of lines) {
    if (line.startsWith('MILKUP_MERMAID_NATIVE_AUDIT '))
      throw Error('External renderer is forbidden')
    if (!line.startsWith(FRONTEND_AUDIT_PREFIX)) continue
    const event = JSON.parse(line.slice(FRONTEND_AUDIT_PREFIX.length))
    assert(event.timestampUnixMs >= Date.parse(spec.creationUtc), 'Record predates owned process')
    if (event.phase)
      assert(
        fences.some((f) => f.sourceSha256 === event.sourceSha256),
        'Unexpected source',
      )
    ledger.accept(event, spec.pid, spec.creationFileTime)
  }
  return ledger
}
export function classifyEntry(row) {
  assert(['cold-entry', 'prefetch-ready'].includes(row.scenario))
  const observation = row.observation
  assert(
    observation?.complete === true && observation.decoded !== null,
    'Complete visible observation required',
  )
  assert(row.ready && row.ready.sourceSha256 === row.sourceSha256, 'Exact source success required')
  const entryUnix = observation.timeOrigin + observation.firstVisible
  const readyBeforeEntry = row.ready.timestampUnixMs <= entryUnix
  const first = observation.transitions?.[0]
  const observedOffscreenBeforeEntry =
    first?.inView === false && first.at < observation.firstVisible
  return {
    observedOffscreenBeforeEntry,
    visibleAtFirstSample: first?.inView === true,
    prefetchComparisonEstablished:
      row.scenario === 'prefetch-ready' &&
      observedOffscreenBeforeEntry &&
      readyBeforeEntry &&
      row.ready.timestampUnixMs <= row.firstInputUnix &&
      row.readyAtArm?.length === 0 &&
      row.requestsAtArm?.admitted.length === 0 &&
      row.started?.timestampUnixMs >= observation.timeOrigin + observation.begun &&
      observation.expectedDocument === row.document &&
      observation.documentMatchedAt !== null &&
      observation.timeOrigin + first.at <= row.ready.timestampUnixMs &&
      entryUnix >= row.firstInputUnix,
    readyBeforeEntry,
    readyBeforeFirstInput: row.ready.timestampUnixMs <= row.firstInputUnix,
    coldComparisonEstablished:
      row.scenario === 'cold-entry' &&
      observedOffscreenBeforeEntry &&
      !readyBeforeEntry &&
      !observation.decodedAtFirstSample,
    sourceVisibleFrames: observation.sourceVisibleFrames,
    layoutWaitMs: observation.decoded - observation.firstVisible,
    samplingGapMs: observation.maxSampleGapMs,
    noFlashProven: false,
    boundary:
      'Read-only rAF samples, not physical paint; wall/native clock alignment is millisecond-resolution',
  }
}

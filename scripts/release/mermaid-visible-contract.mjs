import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { AuditLedger } from '../../tests/windows/mermaid-product-e2e.mjs'
import {
  frontendLedgerClass,
  FRONTEND_AUDIT_PREFIX,
} from '../../tests/windows/mermaid-frontend-contract.mjs'
export const sha = (bytes) => createHash('sha256').update(bytes).digest('hex')
const graph = (label) => '```mermaid\nflowchart LR\n A[' + label + '] --> B[visible]\n```\n'
export const source =
  '# Visible latency\n\n' +
  graph('OPEN_569f') +
  '\n' +
  Array.from({ length: 350 }, (_, i) => `Entry lead ${i}\n`).join('') +
  graph('ENTRY_569f') +
  '\n' +
  Array.from({ length: 200 }, (_, i) => `Warm lead ${i}\n`).join('') +
  graph('WARM_569f') +
  '\nTail\n'
export const fences = [...source.matchAll(/```mermaid\n([\s\S]*?)```/g)].map((m) => ({
  from: m.index,
  to: m.index + m[0].length,
  sourceSha256: sha(m[1]),
}))
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
  return {
    readyBeforeEntry,
    readyBeforeFirstInput: row.ready.timestampUnixMs <= row.firstInputUnix,
    coldComparisonEstablished:
      row.scenario === 'cold-entry' && !readyBeforeEntry && !observation.decodedAtFirstSample,
    sourceVisibleFrames: observation.sourceVisibleFrames,
    layoutWaitMs: observation.decoded - observation.firstVisible,
    samplingGapMs: observation.maxSampleGapMs,
    noFlashProven: false,
    boundary:
      'Read-only rAF samples, not physical paint; wall/native clock alignment is millisecond-resolution',
  }
}

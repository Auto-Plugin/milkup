import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
const logBudget = 128 * 1024
export const sha = (bytes) => createHash('sha256').update(bytes).digest('hex')
export const profileOrder = Object.freeze(['a', 'a', 'b', 'b', 'a', 'c', 'c', 'b'])
export function profileTrial(index) {
  assert(Number.isInteger(index) && index >= 0 && index < profileOrder.length)
  const name = profileOrder[index]
  return { index, name, reused: profileOrder.slice(0, index).includes(name) }
}
export function verifyProfileReuse(previous, current) {
  for (const field of ['device', 'inode', 'birthtimeNs']) assert.match(current[field], /^\d+$/)
  assert(BigInt(current.birthtimeNs) > 0n)
  if (previous) assert.deepEqual(current, previous, 'Exact temporary directory generation retained')
  return current
}
export function verifyNoOwnedWebView(snapshot, sid, runtime) {
  assert.equal(snapshot.scope, 'exact-sid-webview-runtime')
  assert.equal(snapshot.sid, sid)
  for (const key of ['enumeratedCount', 'excludedByImageName', 'candidateCount'])
    assert(Number.isInteger(snapshot[key]) && snapshot[key] >= 0 && snapshot[key] <= 4096)
  assert.equal(snapshot.enumeratedCount, snapshot.excludedByImageName + snapshot.candidateCount)
  assert(snapshot.matchCount <= snapshot.candidateCount)
  assert.equal(snapshot.readOnly, true)
  assert.equal(snapshot.complete, true)
  assert.deepEqual(snapshot.errors, [])
  assert.equal(snapshot.matchCount, snapshot.records.length)
  assert(snapshot.records.length <= 64)
  assert.equal(snapshot.matchCount, 0, 'Every owned WebView runtime must exit before reuse')
  assert.match(runtime, /[\\/]msedgewebview2\.exe$/i, 'Known runtime image required')
  return true
}
export function verifyCatalogRestart(beforeBytes, afterBytes) {
  const decode = (bytes) => {
    assert(bytes.length <= logBudget, 'Bounded comparison catalogue required')
    const envelope = JSON.parse(bytes.toString('utf8'))
    assert.equal(
      sha(Buffer.from(JSON.stringify(envelope.payload))),
      envelope.sha256,
      'Catalogue checksum',
    )
    assert.equal(envelope.payload.version, 1)
    assert(Array.isArray(envelope.payload.entries) && envelope.payload.entries.length <= 512)
    return envelope.payload
  }
  const before = decode(beforeBytes),
    after = decode(afterBytes)
  assert.equal(before.entries.length, after.entries.length)
  let transitions = 0
  for (let i = 0; i < before.entries.length; i++) {
    const prior = before.entries[i],
      next = after.entries[i]
    assert.equal(prior.startAttempt, null, 'Prior startup must be complete')
    assert.equal(next.startAttempt, null, 'Restart must commit its startup attempt')
    const increment = prior.enabled ? 2 : 0
    if (prior.enabled) {
      assert(prior.active?.verified && !prior.tombstone)
      assert.equal(prior.active.approvedFingerprint, prior.active.capabilityFingerprint)
    }
    assert(Number.isSafeInteger(prior.revision) && Number.isSafeInteger(next.revision))
    assert.equal(
      next.revision,
      prior.revision + increment,
      'Only startup-begin and startup-complete revisions allowed',
    )
    transitions += increment
    next.revision = prior.revision
  }
  assert(Number.isSafeInteger(before.revision) && Number.isSafeInteger(after.revision))
  assert.equal(after.revision, before.revision + transitions)
  after.revision = before.revision
  assert.deepEqual(
    after,
    before,
    'Package identity, approval, switches and all other catalogue state must remain unchanged',
  )
  assert(before.entries.some((e) => e.id === 'milkup.diagrams' && e.enabled))
  return {
    beforeSha256: sha(beforeBytes),
    afterSha256: sha(afterBytes),
    expectedDurableTransitions: transitions,
  }
}

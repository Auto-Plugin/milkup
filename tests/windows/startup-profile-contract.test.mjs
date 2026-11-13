import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  profileOrder,
  startupProfileOrder,
  profileTrial,
  verifyProfileReuse,
  verifyCatalogRestart,
  verifyNoOwnedWebView,
  sha,
} from './startup-profile-contract.mjs'
test('closed eight-launch plan interleaves new and reused directories', () => {
  assert.deepEqual(profileOrder, ['a', 'a', 'b', 'b', 'a', 'c', 'c', 'b'])
  assert.deepEqual(
    profileOrder.map((_, i) => profileTrial(i).reused),
    [false, true, false, true, true, false, true, true],
  )
  for (const index of [-1, 8, 0.1, NaN]) assert.throws(() => profileTrial(index))
})
test('reuse requires exact same directory generation', () => {
  const identity = { device: '1', inode: '2', birthtimeNs: '3' }
  assert.deepEqual(verifyProfileReuse(identity, { ...identity }), identity)
  for (const field of Object.keys(identity))
    assert.throws(() => verifyProfileReuse(identity, { ...identity, [field]: '4' }))
  assert.throws(() => verifyProfileReuse(null, { ...identity, birthtimeNs: '0' }))
})
const sid = 'S-1-5-21-1-2-3-4',
  runtime = 'C:\\Runtime\\msedgewebview2.exe'
const snapshot = () => ({
  scope: 'exact-sid-webview-runtime',
  sid,
  readOnly: true,
  complete: true,
  enumeratedCount: 150,
  excludedByImageName: 150,
  candidateCount: 0,
  errors: [],
  matchCount: 0,
  records: [],
})
test('runtime census requires complete bounded image enumeration and no owned runtime', () => {
  assert.equal(verifyNoOwnedWebView(snapshot(), sid, runtime), true)
  for (const mutate of [
    (s) => (s.complete = false),
    (s) => (s.scope = 'exact-sid-all-processes'),
    (s) => (s.sid += '1'),
    (s) => s.errors.push('candidate SID denied'),
    (s) => s.matchCount++,
    (s) => s.candidateCount++,
    (s) => (s.enumeratedCount = 4097),
    (s) => (s.excludedByImageName = -1),
    (s) => {
      s.excludedByImageName--
      s.candidateCount++
      s.matchCount++
      s.records.push({
        enumeratedSid: sid,
        token: { sid },
        image: runtime,
        enumeratedImage: 'msedgewebview2.exe',
      })
    },
  ]) {
    const s = snapshot()
    mutate(s)
    assert.throws(() => verifyNoOwnedWebView(s, sid, runtime))
  }
})
const payload = () => ({
  version: 1,
  revision: 4,
  entries: [
    {
      id: 'milkup.diagrams',
      revision: 3,
      enabled: true,
      tombstone: false,
      startAttempt: null,
      active: {
        verified: true,
        approvedFingerprint: 'reviewed',
        capabilityFingerprint: 'reviewed',
      },
    },
    { id: 'milkup.other', revision: 1, enabled: false, startAttempt: null },
  ],
})
const encode = (p) =>
  Buffer.from(JSON.stringify({ payload: p, sha256: sha(Buffer.from(JSON.stringify(p))) }))
test('restart permits only exact two durable transitions for enabled package', () => {
  const a = payload(),
    b = structuredClone(a)
  b.revision += 2
  b.entries[0].revision += 2
  assert.equal(verifyCatalogRestart(encode(a), encode(b)).expectedDurableTransitions, 2)
  for (const mutate of [
    (p) => (p.entries[0].enabled = false),
    (p) => (p.entries[0].active.approvedFingerprint = 'other'),
    (p) => (p.entries[0].startAttempt = {}),
    (p) => p.entries[1].revision++,
    (p) => p.revision++,
    (p) => p.entries.pop(),
  ]) {
    const c = structuredClone(b)
    mutate(c)
    assert.throws(() => verifyCatalogRestart(encode(a), encode(c)))
  }
  const corrupt = JSON.parse(encode(a))
  corrupt.sha256 = '0'.repeat(64)
  assert.throws(() => verifyCatalogRestart(Buffer.from(JSON.stringify(corrupt)), encode(b)))
})
test('workflow keeps diagnostic opt-in, and wrapper gates copied input and purpose', () => {
  const workflow = readFileSync(
    new URL('../../.github/workflows/mermaid-windows-frontend-compat.yml', import.meta.url),
    'utf8',
  )
  assert.match(workflow, /startup_profile_comparison:\s+type: boolean\s+default: false/)
  assert.match(workflow, /inputs\.startup_profile_comparison != true/)
  const wrapper = readFileSync(
    new URL('../../scripts/ci/run-windows-mermaid-product-e2e.ps1', import.meta.url),
    'utf8',
  )
  assert.match(wrapper, /Startup comparison cannot run installation or ordinary acceptance/)
  assert.match(wrapper, /Diagnostic cannot substitute for product acceptance/)
  assert.match(wrapper, /Startup contract staging mismatch/)
})

test('targeted I/O plan is exactly fresh then reused with no extra controls', () => {
  assert.deepEqual(startupProfileOrder(true, true), ['a', 'a'])
  assert.deepEqual(startupProfileOrder(false, true), profileOrder)
  assert.throws(() => startupProfileOrder(true, false))
  assert.throws(() => startupProfileOrder('1', true))
})

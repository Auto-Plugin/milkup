import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import {
  fixedFrameDocument,
  verifyFixedFrameDocument,
} from '../../scripts/frontend-mermaid-document.mjs'
import { AuditLedger } from './mermaid-product-e2e.mjs'
import { frontendLedgerClass, FRONTEND_RENDERER } from './mermaid-frontend-contract.mjs'
const Ledger = frontendLedgerClass(AuditLedger)
test('fixed document seals exact bootstrap and engine without inheriting main-page styles', () => {
  const source = readFileSync(
    new URL('../../apps/desktop/src/frontend-mermaid/frame.js', import.meta.url),
    'utf8',
  )
  const document = verifyFixedFrameDocument()
  assert.equal(document, fixedFrameDocument(source))
  assert.notEqual(document, fixedFrameDocument(source + '\n'))
  assert.throws(() => fixedFrameDocument('</script><script>untrusted()</script>'))
  for (const bytes of [
    Buffer.from(source),
    readFileSync(
      new URL(
        '../../apps/desktop/src-tauri/mermaid-engine/assets/mermaid-12.2.0.min.js',
        import.meta.url,
      ),
    ),
  ]) {
    assert(
      document.includes("'sha256-" + createHash('sha256').update(bytes).digest('base64') + "'"),
    )
  }
  assert(document.includes("style-src 'unsafe-inline'"))
  assert(document.includes("connect-src 'none'"))
  assert(!document.includes("script-src 'unsafe-inline'"))
  assert(!document.includes('allow-same-origin'))
})
const owner = 'a'.repeat(32),
  request = 'b'.repeat(32),
  source = 'c'.repeat(64),
  png = 'd'.repeat(64)
const birth = '134383703131466830',
  pid = 100
const launch = (creationFileTime = birth) => ({
  productPid: pid,
  creationFileTime,
  exitCode: 0,
  signal: null,
  exitedAt: '2026-11-05',
  stdioClosedAt: '2026-11-05',
})
function fixture() {
  const ledger = new Ledger('S-1-5-21-1-2-3-1000', 1, 'pure-standard', true)
  ledger.registerLaunch(launch())
  return ledger
}
const event = (v) => ({ renderer: FRONTEND_RENDERER, productPid: pid, timestampUnixMs: 1000, ...v })
function inventory(l, b = birth, extra = {}) {
  l.accept(
    event({
      kind: 'connection',
      ownerId: owner,
      stage: 'bridge-inventory',
      nativeFrameLive: true,
      failed: false,
      tauriInternals: false,
      tauriInvoke: false,
      wryIpc: false,
      chromeWebview: true,
      parentDomReadable: false,
      engineAvailable: true,
      engineStartupError: false,
      engineScriptUrlRevoked: true,
      ...extra,
    }),
    pid,
    b,
  )
}
function boundary(l, b = birth) {
  inventory(l, b)
  l.accept(event({ kind: 'main-probe-dispatched', nonce: owner, dispatchedProbes: 1 }), pid, b)
  l.accept(
    event({
      kind: 'frame-ipc-rejected',
      nonce: owner,
      dispatchedProbes: 1,
      blockedMessages: 1,
      forwardedToTauri: false,
      createdFrameNameMatched: true,
    }),
    pid,
    b,
  )
  l.accept(
    event({
      kind: 'frame-navigation-rejected',
      nonce: owner,
      cancelled: true,
      aboutBlank: true,
      blockedNavigations: 1,
    }),
    pid,
    b,
  )
}
const base = { ownerId: owner, requestId: request, sourceSha256: source }
function ready(l, b = birth) {
  boundary(l, b)
  l.accept(
    event({
      ...base,
      phase: 'admitted',
      nativeBridgeRejected: true,
      blockedMessages: 1,
      dispatchedProbes: 1,
      blockedNavigations: 1,
    }),
    pid,
    b,
  )
  l.accept(event({ ...base, phase: 'started' }), pid, b)
  l.accept(
    event({
      ...base,
      phase: 'finished',
      status: 'ready',
      consumerAborted: false,
      pngSha256: png,
      pngBytes: 120,
      width: 20,
      height: 20,
    }),
    pid,
    b,
  )
}
function release(l, b = birth) {
  l.accept(
    event({
      kind: 'owner-released',
      nonce: owner,
      frameDestroyed: true,
      pendingRequests: 0,
      hardTerminationProven: false,
    }),
    pid,
    b,
  )
}
test('frontend evidence binds actual rejection, PNG, release and exact reusable PID generations', () => {
  const l = fixture()
  ready(l)
  release(l)
  l.closeLaunch(launch())
  assert.equal(l.matchPng(pid, { sha256: png, bytes: 120 }, birth).renderer, FRONTEND_RENDERER)
  const next = '134383703131466831'
  l.registerLaunch(launch(next))
  assert.throws(() => l.matchPng(pid, { sha256: png, bytes: 120 }, next))
  ready(l, next)
  release(l, next)
  l.closeLaunch(launch(next))
  assert.equal(l.verifyAll().length, 2)
})
test('missing native bridge proof, dispatched child, navigation and unclosed old generation fail', () => {
  const l = fixture()
  assert.throws(() =>
    l.accept(event({ ...base, phase: 'admitted', nativeBridgeRejected: true }), pid, birth),
  )
  const m = fixture()
  inventory(m)
  m.accept(event({ kind: 'main-probe-dispatched', nonce: owner, dispatchedProbes: 1 }), pid, birth)
  assert.throws(() =>
    m.accept(
      event({
        kind: 'frame-ipc-rejected',
        nonce: owner,
        dispatchedProbes: 2,
        blockedMessages: 1,
        forwardedToTauri: false,
        createdFrameNameMatched: true,
      }),
      pid,
      birth,
    ),
  )
  const n = fixture()
  assert.throws(() => n.registerLaunch(launch('134383703131466831')))
  ready(n)
  assert.throws(() => n.closeLaunch(launch()))
  assert.throws(() => n.matchPng(pid, { sha256: 'e'.repeat(64), bytes: 120 }, birth))
})
test('missing or forged process birth and fabricated hard termination cannot pass', () => {
  const l = fixture()
  ready(l)
  assert.throws(() =>
    l.accept(
      event({
        kind: 'owner-released',
        nonce: owner,
        frameDestroyed: true,
        pendingRequests: 0,
        hardTerminationProven: true,
      }),
      pid,
      birth,
    ),
  )
  assert.throws(() =>
    l.accept(event({ ...base, phase: 'started', productCreationFileTime: '123' }), pid, birth),
  )
  assert.throws(() => l.matchPng(pid, { sha256: png, bytes: 120 }, '123'))
  assert.throws(() => new Ledger('S-1-5-21-1-2-3-1000', 1, 'pure-standard', false))
})

test('connection diagnostics retain the exact failed stage and reject exposed frame bridges', () => {
  const l = fixture()
  assert.throws(
    () =>
      l.accept(
        event({
          kind: 'connection',
          ownerId: owner,
          stage: 'bridge-inventory',
          nativeFrameLive: true,
          failed: false,
          engineAvailable: true,
          engineStartupError: false,
          engineScriptUrlRevoked: true,
          tauriInternals: true,
          tauriInvoke: false,
          wryIpc: false,
          chromeWebview: true,
        }),
        pid,
        birth,
      ),
    /tauriInternals/,
  )
  const m = fixture()
  assert.throws(
    () =>
      m.accept(
        event({
          kind: 'connection',
          ownerId: owner,
          stage: 'main-probe',
          nativeFrameLive: true,
          failed: true,
        }),
        pid,
        birth,
      ),
    /main-probe/,
  )
  assert.equal(m.events[0].stage, 'main-probe')
})

test('parent DOM readability and missing production inventory reject admission', () => {
  assert.throws(() => inventory(fixture(), birth, { parentDomReadable: true }), /parent DOM/)
  assert.throws(() => inventory(fixture(), birth, { parentDomReadable: undefined }), /parent DOM/)
  assert.throws(
    () =>
      fixture().accept(
        event({ kind: 'main-probe-dispatched', nonce: owner, dispatchedProbes: 1 }),
        pid,
        birth,
      ),
    /inventory/,
  )
})

test('native frame lifecycle diagnostics cannot substitute for rejection or release proof', () => {
  const l = fixture()
  for (const stage of [
    'created',
    'navigation-start',
    'dom-content-loaded',
    'navigation-completed',
    'destroyed',
  ]) {
    l.accept(
      event({ kind: 'frame-lifecycle', frameId: 1, ownerId: owner, stage, detail: {} }),
      pid,
      birth,
    )
  }
  assert.throws(
    () => l.accept(event({ ...base, phase: 'admitted', nativeBridgeRejected: true }), pid, birth),
    /rejection/,
  )
  const m = fixture()
  ready(m)
  m.accept(
    event({ kind: 'frame-lifecycle', frameId: 1, ownerId: owner, stage: 'destroyed', detail: {} }),
    pid,
    birth,
  )
  assert.throws(() => m.closeLaunch(launch()), /acknowledged/)
})

test('fixed document response diagnostics cannot replace frame readiness or release', () => {
  const l = fixture()
  for (const [stage, bodyBytes] of [
    ['received', 0],
    ['response-built', 42],
  ])
    l.accept(
      event({ kind: 'fixed-document-protocol', stage, allowed: true, bodyBytes }),
      pid,
      birth,
    )
  assert.throws(
    () => l.accept(event({ ...base, phase: 'admitted', nativeBridgeRejected: true }), pid, birth),
    /rejection/,
  )
  for (const value of [
    { stage: 'unknown', allowed: true, bodyBytes: 1 },
    { stage: 'received', allowed: true, bodyBytes: 1 },
    { stage: 'response-built', allowed: true, bodyBytes: 65537 },
    { stage: 'response-built', allowed: false, bodyBytes: 42 },
  ])
    assert.throws(() =>
      fixture().accept(event({ kind: 'fixed-document-protocol', ...value }), pid, birth),
    )
  const m = fixture()
  ready(m)
  m.accept(
    event({
      kind: 'fixed-document-protocol',
      stage: 'response-built',
      allowed: true,
      bodyBytes: 42,
    }),
    pid,
    birth,
  )
  assert.throws(() => m.closeLaunch(launch()), /acknowledged/)
})

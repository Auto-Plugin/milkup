// Pure fixtures and audit/PNG gates only. Importing the harness never launches a
// browser, product, process observer, PowerShell, Runtime, or Windows task.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { deflateSync } from 'node:zlib'
import {
  fixtures,
  crc32,
  validatePng,
  validateContext,
  AuditLedger,
  validateProcessIdentities,
  isUnknownGrammarRejection,
  observe,
  decodeScript,
} from './mermaid-product-e2e.mjs'

const sid = 'S-1-5-21-11-22-33-1001'
const chunk = (kind, data) => {
  const bytes = Buffer.alloc(data.length + 12)
  bytes.writeUInt32BE(data.length)
  bytes.write(kind, 4, 'ascii')
  data.copy(bytes, 8)
  bytes.writeUInt32BE(crc32(bytes.subarray(4, bytes.length - 4)), bytes.length - 4)
  return bytes
}
const png = () => {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(2)
  header.writeUInt32BE(1, 4)
  header[8] = 8
  header[9] = 6
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.from([0, 255, 255, 255, 255, 0, 0, 0, 255]))),
    chunk('IEND', Buffer.alloc(0)),
  ])
}
const ownership = {
  hostSid: sid,
  childSid: sid,
  browserSid: sid,
  hostPureStandard: true,
  appContainer: true,
  zeroCapabilities: true,
  browserAppContainer: true,
  browserZeroCapabilities: true,
  browserInOwnedJob: true,
  browserPid: 333,
}
const completion = {
  ...ownership,
  successful: true,
  ownedJobCreated: true,
  profileCreated: true,
  jobActiveAfterStop: 0,
  ipcThreadsCompleted: true,
  profileDeleted: true,
  privateTreeRemoved: true,
  cleanupUncertain: false,
  cancelled: false,
  deadlineExpired: false,
  ownedPidsBeforeStop: [222, 333],
  pngBytes: png().length,
  pngSha256: validatePng(png()).sha256,
}
const append = (ledger, phase, fields = {}, requestId = 'r1', productPid = 111) =>
  ledger.accept({ phase, requestId, productPid, ...fields }, productPid)
const successful = (changes = {}) => {
  const ledger = new AuditLedger(sid)
  append(ledger, 'admitted')
  append(ledger, 'started', ownership)
  append(ledger, 'finished', { ...completion, ...changes })
  return ledger
}

test('four self-authored fixture bytes retain CRLF and Unicode without normalization', () => {
  assert.deepEqual(Object.keys(fixtures), ['ordinary', 'wide', 'c4', 'invalid'])
  assert(fixtures.ordinary.includes('中文😀\r\n') && fixtures.ordinary.includes('é 👩🏽‍💻'))
  assert.equal(fixtures.ordinary.replaceAll('\r\n', '').includes('\n'), false)
  assert(!fixtures.wide.includes('\r'))
  assert.equal((fixtures.wide.match(/native width/g) ?? []).length, 16)
  const offset = fixtures.ordinary.indexOf('Draft'),
    edited = fixtures.ordinary.slice(0, offset) + 'X' + fixtures.ordinary.slice(offset)
  assert.equal(Buffer.byteLength(edited), Buffer.byteLength(fixtures.ordinary) + 1)
  assert.equal(edited.slice(0, offset) + edited.slice(offset + 1), fixtures.ordinary)
})

test('PNG gate validates complete framing/CRC and rejects truncation, trailing bytes and APNG', () => {
  const bytes = png(),
    valid = validatePng(bytes)
  assert.equal(valid.width, 2)
  assert.equal(valid.height, 1)
  assert.throws(() => validatePng(bytes.subarray(0, -1)))
  assert.throws(() => validatePng(Buffer.concat([bytes, Buffer.from([0])])), /exact EOF/)
  const corrupt = Buffer.from(bytes)
  corrupt[45] ^= 1
  assert.throws(() => validatePng(corrupt), /CRC/)
  const animated = Buffer.concat([
    bytes.subarray(0, 33),
    chunk('acTL', Buffer.alloc(8)),
    bytes.subarray(33),
  ])
  assert.throws(() => validatePng(animated), /Animated/)
  assert.throws(() => validatePng(bytes, bytes.length - 1), /byte budget/)
  const oversized = Buffer.from(bytes)
  oversized.writeUInt32BE(8193, 16)
  oversized.writeUInt32BE(crc32(oversized.subarray(12, 29)), 29)
  assert.throws(() => validatePng(oversized), /pixel budget/)
})

test('standard-user gate rejects missing token, desktop and exact-session evidence', () => {
  const context = {
    status: 'ready',
    actualSid: sid,
    expectedSid: sid,
    pureStandard: true,
    interactive: true,
    sessionId: 2,
    expectedSessionId: 2,
    blockedReasons: [],
    knownFolders: {
      profile: 'C:/Users/test',
      roamingAppData: 'C:/Users/test/AppData/Roaming',
      localAppData: 'C:/Users/test/AppData/Local',
    },
  }
  assert.equal(validateContext(context, sid, 2), context)
  for (const changes of [
    { pureStandard: false },
    { interactive: false },
    { actualSid: sid + '9' },
    { sessionId: 3 },
    { blockedReasons: ['denied'] },
    { status: 'blocked' },
  ]) {
    assert.throws(() => validateContext({ ...context, ...changes }, sid, 2))
  }
  assert.throws(() => validateContext(context, sid, 0))
})

test('only an exact completed native PNG binds to a successful output lease', () => {
  const ledger = successful(),
    image = validatePng(png())
  assert.equal(ledger.verifyAll().length, 1)
  assert.deepEqual(ledger.matchPng(111, image), {
    productPid: 111,
    requestId: 'r1',
    pngSha256: image.sha256,
  })
  assert.throws(() => ledger.matchPng(112, image))
  assert.throws(() => ledger.matchPng(111, { ...image, sha256: 'a'.repeat(64) }))
  assert.throws(() => ledger.matchPng(111, { ...image, bytes: image.bytes + 1 }))
})

test('missing/unsafe native cleanup never becomes acceptance after outer termination', () => {
  const incomplete = new AuditLedger(sid)
  append(incomplete, 'admitted')
  append(incomplete, 'started', ownership)
  assert.equal(incomplete.pending(111), 1)
  assert.throws(() => incomplete.verifyAll(), /completion audit/)
  for (const changes of [
    { cleanupUncertain: true },
    { jobActiveAfterStop: 1 },
    { profileDeleted: false },
    { privateTreeRemoved: false },
    { ipcThreadsCompleted: false },
    { hostPureStandard: false },
    { browserSid: sid + '9' },
    { browserInOwnedJob: false },
    { cancelled: true },
  ]) {
    assert.throws(() => successful(changes).verifyAll())
  }
  const foreign = new AuditLedger(sid)
  append(foreign, 'admitted')
  assert.throws(
    () => append(foreign, 'started', { ...ownership, browserSid: sid + '9' }),
    /Same-login/,
  )
  assert.throws(
    () => foreign.accept({ phase: 'admitted', requestId: 'other', productPid: 999 }, 111),
    /spawned product/,
  )
})

test('reverse completions retain request ownership and duplicate/post-completion phases fail', () => {
  const ledger = new AuditLedger(sid)
  for (const id of ['r1', 'r2']) {
    append(ledger, 'admitted', {}, id)
    append(ledger, 'started', ownership, id)
  }
  append(ledger, 'finished', completion, 'r2')
  assert.equal(ledger.pending(111), 1)
  append(ledger, 'finished', completion, 'r1')
  assert.equal(ledger.pending(111), 0)
  assert.equal(ledger.verifyAll().length, 2)
  assert.throws(() => append(ledger, 'finished', completion, 'r1'), /duplicate/)
  assert.throws(() => append(ledger, 'started', ownership, 'r1'), /duplicate|after/)
})

test('early cancellation is distinguished from an owned parser rejection', () => {
  const early = new AuditLedger(sid)
  append(early, 'admitted')
  append(early, 'finished', {
    ...completion,
    successful: false,
    ownedJobCreated: false,
    profileCreated: false,
    jobActiveAfterStop: null,
    cancelled: true,
    childSid: null,
    browserSid: null,
    browserPid: null,
    ownedPidsBeforeStop: [],
    appContainer: false,
    zeroCapabilities: false,
    browserAppContainer: false,
    browserZeroCapabilities: false,
    browserInOwnedJob: false,
    pngBytes: 0,
    pngSha256: null,
  })
  assert.equal(early.verifyAll()[0].finished.cancelled, true)
  const invalid = successful({ successful: false, pngBytes: 0, pngSha256: null })
  assert.equal(invalid.verifyAll()[0].finished.successful, false)
  const pretend = new AuditLedger(sid)
  append(pretend, 'admitted')
  append(pretend, 'finished', { ...completion, successful: false, pngBytes: 0, pngSha256: null })
  assert.throws(() => pretend.verifyAll(), /ready\/ownership/)
})

test('process identity readback rejects duplicate, missing and reused PIDs', () => {
  const expected = new Map([
    [10, '/fixtures/node.exe'],
    [11, '/fixtures/msedgedriver.exe'],
  ])
  const make = (pid) => ({
    pid,
    image: expected.get(pid),
    stillActive: true,
    creationFileTime: '133900000000000000',
    token: { sid, sessionId: 2, pureStandardUser: true },
  })
  const births = new Map()
  validateProcessIdentities([make(10), make(11)], expected, sid, 2, births)
  assert.throws(
    () => validateProcessIdentities([make(10), make(10)], expected, sid, 2, births),
    /Unique/,
  )
  assert.throws(
    () => validateProcessIdentities([make(10)], expected, sid, 2, births),
    /every owned/,
  )
  assert.throws(
    () =>
      validateProcessIdentities(
        [make(10), { ...make(11), creationFileTime: '133900000000000001' }],
        expected,
        sid,
        2,
        births,
      ),
    /reused/,
  )
})

test('generic rendering failure is never accepted as the unknown-grammar negative case', () => {
  const job = {
    started: ownership,
    finished: { ...completion, successful: false, rendererErrorKind: 'unknown-diagram' },
  }
  assert.equal(isUnknownGrammarRejection(job), true)
  for (const rendererErrorKind of [undefined, null, 'other', 'parse-error']) {
    assert.equal(
      isUnknownGrammarRejection({ ...job, finished: { ...job.finished, rendererErrorKind } }),
      false,
    )
  }
  assert.equal(
    isUnknownGrammarRejection({ ...job, finished: { ...job.finished, deadlineExpired: true } }),
    false,
  )
  assert.equal(isUnknownGrammarRejection({ ...job, started: undefined }), false)
})

test('uncreated-job cancellation rejects contradictory identities and ownership claims', () => {
  const noWork = {
    ...completion,
    successful: false,
    ownedJobCreated: false,
    profileCreated: false,
    jobActiveAfterStop: null,
    cancelled: true,
    childSid: null,
    browserSid: null,
    browserPid: null,
    ownedPidsBeforeStop: [],
    appContainer: false,
    zeroCapabilities: false,
    browserAppContainer: false,
    browserZeroCapabilities: false,
    browserInOwnedJob: false,
    pngBytes: 0,
    pngSha256: null,
  }
  for (const changes of [
    { ownedPidsBeforeStop: [333] },
    { childSid: sid },
    { browserPid: 333 },
    { browserInOwnedJob: true },
  ]) {
    const ledger = new AuditLedger(sid)
    append(ledger, 'admitted')
    append(ledger, 'finished', { ...noWork, ...changes })
    assert.throws(() => ledger.verifyAll())
  }
})

test('browser observation/decode bodies parse without executing browser APIs', () => {
  assert.doesNotThrow(() => new Function(observe))
  assert.doesNotThrow(() => new Function(decodeScript))
})

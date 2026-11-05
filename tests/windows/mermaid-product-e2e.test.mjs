// Pure fixtures and audit/PNG gates only. Importing the harness never launches a
// browser, product, process observer, PowerShell, Runtime, or Windows task.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import path from 'node:path'
import { deflateSync } from 'node:zlib'
import {
  fixtures,
  serializeProductEvidence,
  MAX_PRODUCT_REPORT_BYTES,
  validatePreviewModes,
  validateMigrationReceipt,
  validateSyntheticMigrationFixture,
  MIGRATION_BASELINE_SHA256,
  crc32,
  validatePng,
  validateResponsiveDiagram,
  validateContext,
  validateHostProcessToken,
  AuditLedger,
  validateProcessIdentities,
  isUnknownGrammarRejection,
  waitForUnknownGrammarRejection,
  observe,
  decodeScript,
  waitForPluginCard,
  parseExpectedPluginInventory,
  inspectBundledPluginInventory,
  waitForBundledPluginInventory,
  validateCardReflow,
  waitForNativeJobs,
  waitForOwnedExit,
  settleOwnedProduct,
  stopOwnedProductAfterFailure,
  unwrapWebDriverValue,
  decodeWebDriverResponse,
  probeCloseConfirmation,
  assertCleanCloseConfirmation,
} from './mermaid-product-e2e.mjs'

test('wide diagrams fit the measured padded content box while retaining intrinsic pixels', () => {
  const image = {
    naturalWidth: 2000,
    naturalHeight: 400,
    rect: { left: 112, right: 888, width: 776, height: 155.2 },
    presentation: {
      rect: { left: 100 },
      clientWidth: 800,
      scrollWidth: 800,
      paddingLeft: 12,
      paddingRight: 12,
      borderLeft: 0,
    },
  }
  assert.equal(validateResponsiveDiagram(image).contentWidth, 776)
  const small = structuredClone(image)
  small.naturalWidth = 300
  small.naturalHeight = 150
  small.rect.width = 300
  small.rect.right = 412
  small.rect.height = 150
  assert.equal(validateResponsiveDiagram(small).expectedWidth, 300)
  for (const [label, change] of [
    [
      'oversized',
      (bad) => {
        bad.rect.width = 2000
        bad.rect.right = 2112
        bad.rect.height = 400
      },
    ],
    [
      'undersized',
      (bad) => {
        bad.rect.width = 500
        bad.rect.right = 612
        bad.rect.height = 100
      },
    ],
    [
      'distorted',
      (bad) => {
        bad.rect.height = 190
      },
    ],
    [
      'padding ignored',
      (bad) => {
        bad.rect.width = 800
        bad.rect.right = 912
        bad.rect.height = 160
      },
    ],
    [
      'overflow',
      (bad) => {
        bad.presentation.scrollWidth = 1200
      },
    ],
    [
      'outside content box',
      (bad) => {
        bad.rect.left = 100
        bad.rect.right = 876
      },
    ],
  ]) {
    const bad = structuredClone(image)
    change(bad)
    assert.throws(() => validateResponsiveDiagram(bad), label)
  }
  const upscaled = structuredClone(small)
  upscaled.rect.width = 600
  upscaled.rect.right = 712
  upscaled.rect.height = 300
  assert.throws(() => validateResponsiveDiagram(upscaled), /without under-sizing or upscaling/)
})

test('W3C null result is preserved instead of turning its envelope into a dialog truthy value', () => {
  const response = JSON.parse('{"value":null}')
  // A pure causal model of the old expression, not a diagnosis of a past run.
  assert.equal(Boolean(response.value ?? response), true)
  assert.equal(unwrapWebDriverValue(response), null)
})

test('W3C boolean results and legacy unwrapped responses keep their actual values', () => {
  assert.equal(unwrapWebDriverValue({ value: true }), true)
  assert.equal(unwrapWebDriverValue({ value: false }), false)
  const legacy = { sessionId: 'session-1' }
  assert.equal(unwrapWebDriverValue(legacy), legacy)
})

const confirmationReply =
  (raw, status = 200) =>
  (row) =>
    decodeWebDriverResponse(raw, status, row)

// Exact bounded response retained from run 41688389731, filtered-admin invalid close.
const detachedTargetResponse =
  '{"value":{"error":"target frame detached","message":"target frame detached\\n  (failed to check if window was closed: disconnected: Unable to receive message from renderer)\\n  (Session info: MicrosoftEdge=156.0.4314.50)","stacktrace":"Symbols not available. Dumping unresolved backtrace:\\n\\t(No symbol) [0x7ff6429209d5]\\n\\t(No symbol) [0x7ff6428675b4]\\n\\t(No symbol) [0x7ff6425f4593]\\n\\t(No symbol) [0x7ff6425e6f58]\\n\\t(No symbol) [0x7ff6425e608d]\\n\\t(No symbol) [0x7ff642601808]\\n\\t(No symbol) [0x7ff642600eda]\\n\\t(No symbol) [0x7ff64267e3a1]\\n\\t(No symbol) [0x7ff642635d5c]\\n\\t(No symbol) [0x7ff642634f4a]\\n\\t(No symbol) [0x7ff642635b83]\\n\\t(No symbol) [0x7ff642775981]\\n\\t(No symbol) [0x7ff642785638]\\n\\t(No symbol) [0x7ff6429c96b5]\\n\\t(No symbol) [0x7ff6429cfd31]\\n\\t(No symbol) [0x7ff64287368c]\\n\\t(No symbol) [0x7ff64286dea4]\\n\\t(No symbol) [0x7ff64286dfca]\\n\\t(No symbol) [0x7ff64285f3d8]\\n\\t(No symbol) [0x7ffc324add37]\\n\\t(No symbol) [0x7ffc339ff2bc]\\n"}}'

test('only literal boolean true proves a close dialog; null retains exact response and decision', async () => {
  for (const [value, decision] of [
    [true, 'visible-unsaved-dialog'],
    [false, 'no-visible-unsaved-dialog'],
    [null, 'null-result-awaiting-owned-exit'],
  ]) {
    const record = {},
      raw = JSON.stringify({ value })
    assert.equal(await probeCloseConfirmation(record, confirmationReply(raw), true), value)
    assert.equal(record.unexpectedUnsavedConfirmation === true, value === true)
    const row = record.closeConfirmationProbes.observations[0]
    assert.equal(row.response.text, raw)
    assert.equal(row.response.bytes, Buffer.byteLength(raw))
    assert.equal(row.response.truncated, false)
    assert.match(row.response.sha256, /^[a-f0-9]{64}$/)
    assert.equal(row.httpStatus, 200)
    assert.equal(row.decision, decision)
    assert.equal(row.value, value)
  }
})

test('truthy non-boolean replies fail without becoming unsaved confirmation or discard permission', async () => {
  for (const value of [{}, { value: true }, 'true', 1, ['true']]) {
    const record = {}
    await assert.rejects(
      probeCloseConfirmation(record, confirmationReply(JSON.stringify({ value })), false),
      /actual boolean or null/,
    )
    assert.equal(record.unexpectedUnsavedConfirmation, undefined)
    assert.equal(record.discardedOwnedUnsavedFixture, undefined)
    assert.equal(
      record.closeConfirmationProbes.observations[0].decision,
      'invalid-non-boolean-result',
    )
  }
})

test('closed frame/window/session protocol errors are recorded as inconclusive, not dialogs or exits', async () => {
  for (const code of ['no such frame', 'no such window', 'invalid session id']) {
    const record = {},
      raw = JSON.stringify({ value: { error: code, message: 'Context is gone' } })
    assert.equal(await probeCloseConfirmation(record, confirmationReply(raw, 404), true), null)
    const row = record.closeConfirmationProbes.observations[0]
    assert.equal(row.decision, 'closed-context-awaiting-owned-exit')
    assert.equal(row.webDriverErrorCode, code)
    assert.equal(row.response.text, raw)
    assert.equal(record.unexpectedUnsavedConfirmation, undefined)
  }
})

test('unrelated WebDriver, malformed JSON and transport errors remain failures with bounded evidence', async () => {
  for (const read of [
    confirmationReply('{"value":{"error":"javascript error","message":"script failed"}}', 500),
    confirmationReply('{"value":'),
    () => {
      throw new Error('Transport failed')
    },
  ]) {
    const record = {}
    await assert.rejects(probeCloseConfirmation(record, read, true))
    const row = record.closeConfirmationProbes.observations[0]
    assert.equal(row.decision, 'probe-error')
    assert(row.error.text.length > 0)
    assert.equal(record.unexpectedUnsavedConfirmation, undefined)
  }
})

test('actual detached-target 404 after requested close is inconclusive and retains its raw evidence', async () => {
  const record = { teardown: { realUiCloseRequested: true } }
  assert.equal(
    await probeCloseConfirmation(record, confirmationReply(detachedTargetResponse, 404), true),
    null,
  )
  const row = record.closeConfirmationProbes.observations[0]
  assert.equal(row.decision, 'closed-context-awaiting-owned-exit')
  assert.equal(row.webDriverErrorCode, 'target frame detached')
  assert.equal(row.httpStatus, 404)
  assert.equal(row.response.text, detachedTargetResponse)
  assert.equal(row.response.bytes, 963)
  assert.equal(
    row.response.sha256,
    'a6855c77d293d94d59f0645981ea0ae165b89a58cd5931fe2e4a86ab551d7191',
  )
  assert.equal(row.response.truncated, false)
  assert.match(row.error.text, /WebDriver HTTP 404/)
  assert.equal(Object.hasOwn(row, 'value'), false, 'An error never proves no visible dialog')
  assert.equal(record.unexpectedUnsavedConfirmation, undefined)
  assert.equal(record.discardedOwnedUnsavedFixture, undefined)
})

test('detached-target exception requires requested close, exact structured code and HTTP 404', async () => {
  for (const [requested, status, raw] of [
    [false, 404, detachedTargetResponse],
    [undefined, 404, detachedTargetResponse],
    [true, 500, detachedTargetResponse],
    [true, 200, detachedTargetResponse],
    [true, 404, '{"error":"target frame detached"}'],
    [true, 404, '{"value":{"message":"target frame detached"}}'],
    [
      true,
      404,
      detachedTargetResponse.replace('"error":"target frame detached"', '"error":"unknown error"'),
    ],
    [
      true,
      404,
      detachedTargetResponse.replace(
        '"error":"target frame detached"',
        '"error":"Target frame detached"',
      ),
    ],
  ]) {
    const record = { teardown: { realUiCloseRequested: requested } }
    await assert.rejects(probeCloseConfirmation(record, confirmationReply(raw, status), true))
    const row = record.closeConfirmationProbes.observations[0]
    assert.equal(row.decision, 'probe-error')
    assert.equal(row.response.text, raw)
    assert.equal(record.unexpectedUnsavedConfirmation, undefined)
  }
})

test('detached-target observations while the held product stays alive exhaust one original deadline', async (t) => {
  let now = 0
  t.mock.method(performance, 'now', () => now)
  const record = { teardown: { realUiCloseRequested: true } }
  assert.equal(
    await waitForOwnedExit(
      () => true,
      15000,
      1,
      async (signal, checkpoint) => {
        assert.equal(
          await probeCloseConfirmation(
            record,
            confirmationReply(detachedTargetResponse, 404),
            true,
            signal,
          ),
          null,
        )
        now = 15000
        checkpoint()
      },
    ),
    false,
  )
  assert.equal(record.closeConfirmationProbes.total, 1)
  assert.equal(record.discardedOwnedUnsavedFixture, undefined)
})

test('actual detached-target response awaits owned exit without accepting late, abnormal or previously dirty close', async (t) => {
  for (const scenario of [
    { name: 'delayed normal exit', exitCode: 0, signal: null, exitAt: 100 },
    {
      name: 'exit beyond original deadline',
      exitCode: 0,
      signal: null,
      exitAt: 15001,
      failure: /UI-close deadline/,
    },
    { name: 'nonzero exit', exitCode: 37, signal: null, exitAt: 100, failure: /Product exit code/ },
    {
      name: 'signal exit',
      exitCode: null,
      signal: 'SIGTERM',
      exitAt: 100,
      failure: /Product exit code|Product signal/,
    },
    {
      name: 'previous actual dialog',
      exitCode: 0,
      signal: null,
      exitAt: 100,
      dialog: true,
      failure: /actual unsaved close confirmation/,
    },
  ])
    await t.test(scenario.name, async (subtest) => {
      let now = 0,
        observedExit,
        exitCode,
        signalCode
      subtest.mock.method(performance, 'now', () => now)
      const fixture = teardownFixture(),
        record = { teardown: fixture.record },
        exit = new AbortController()
      if (scenario.dialog)
        await probeCloseConfirmation(record, confirmationReply('{"value":true}'), true)
      fixture.options.closeUi = async () => ({ realUiCloseRequested: true })
      fixture.options.waitForExit = () =>
        waitForOwnedExit(
          fixture.options.isAlive,
          15000,
          1,
          async (signal) => {
            now = 96
            assert.equal(
              await probeCloseConfirmation(
                record,
                confirmationReply(detachedTargetResponse, 404),
                true,
                signal,
              ),
              null,
            )
            await Promise.resolve()
            now = scenario.exitAt
            observedExit = now
            exitCode = scenario.exitCode
            signalCode = scenario.signal
            fixture.setAlive(false)
            exit.abort()
          },
          { exitedAt: () => observedExit, exitSignal: exit.signal },
        )
      fixture.options.verifyExit = () => {
        assert.equal(exitCode, 0, 'Product exit code')
        assert.equal(signalCode, null, 'Product signal')
        assertCleanCloseConfirmation(record)
        return true
      }
      if (scenario.failure)
        await assert.rejects(settleOwnedProduct(fixture.options), scenario.failure)
      else await settleOwnedProduct(fixture.options)
      assert.equal(fixture.record.closedByUi, !scenario.failure)
      assert(!fixture.calls.includes('owned-kill'))
      assert.equal(record.discardedOwnedUnsavedFixture, undefined)
      assert.equal(
        record.closeConfirmationProbes.observations.at(-1).decision,
        'closed-context-awaiting-owned-exit',
      )
    })
})

test('null response can precede timely owned exit but never prove completion while product is alive', async () => {
  for (const close of [true, false]) {
    const record = {}
    let alive = true,
      reads = 0
    const exited = await waitForOwnedExit(
      () => alive,
      15,
      1,
      async () => {
        assert.equal(
          await probeCloseConfirmation(record, confirmationReply('{"value":null}'), true),
          null,
        )
        reads++
        if (close) alive = false
      },
    )
    assert(reads > 0)
    assert.equal(exited, close)
    assertCleanCloseConfirmation(record)
  }
})

test('closed frame without actual process exit still exhausts the original close deadline', async () => {
  const record = {}
  const exited = await waitForOwnedExit(
    () => true,
    10,
    1,
    () =>
      probeCloseConfirmation(
        record,
        confirmationReply('{"value":{"error":"no such frame"}}', 404),
        true,
      ),
  )
  assert.equal(exited, false)
  assert(record.closeConfirmationProbes.total > 0)
  assert.equal(record.unexpectedUnsavedConfirmation, undefined)
})

test('a true unsaved dialog stays a failed success gate even after a later false reply and normal exit', async () => {
  const record = {}
  await probeCloseConfirmation(record, confirmationReply('{"value":true}'), true)
  await probeCloseConfirmation(record, confirmationReply('{"value":false}'), true)
  const fixture = teardownFixture()
  fixture.options.verifyExit = () => {
    assert.equal(fixture.options.isAlive(), false)
    assertCleanCloseConfirmation(record)
    return true
  }
  await assert.rejects(settleOwnedProduct(fixture.options), /actual unsaved close confirmation/)
  assert.equal(fixture.record.closedByUi, false)
  assert(!fixture.calls.includes('owned-kill'))
})

test('probe history keeps bounded first and final observations with explicit omission and truncation', async () => {
  const record = {}
  for (let i = 0; i < 40; i++)
    await probeCloseConfirmation(record, confirmationReply('{"value":false}'), true)
  const raw = JSON.stringify({ value: { error: 'no such frame', message: '中'.repeat(3000) } })
  await probeCloseConfirmation(record, confirmationReply(raw, 404), true)
  const history = record.closeConfirmationProbes
  assert.equal(history.total, 41)
  assert.equal(history.observations.length, 32)
  assert.equal(history.omitted, 8)
  assert.equal(history.lastObservation.sequence, 41)
  assert.equal(history.lastObservation.response.bytes, Buffer.byteLength(raw))
  assert.equal(history.lastObservation.response.truncated, true)
  assert(Buffer.byteLength(history.lastObservation.response.text) <= 2048)
  assert(!history.lastObservation.response.text.includes('\uFFFD'))
  assert(Buffer.byteLength(JSON.stringify(history)) < 32 * 1024)
  await probeCloseConfirmation(record, confirmationReply('{"value":true}'), true)
  await probeCloseConfirmation(record, confirmationReply('{"value":false}'), true)
  assert.equal(history.firstVisibleDialog.sequence, 42)
  assert.equal(history.firstVisibleDialog.response.text, '{"value":true}')
  assert.equal(history.lastObservation.sequence, 43)
  assert.throws(() => assertCleanCloseConfirmation(record), /actual unsaved/)
})

test('an aborted probe retains its raw result but cannot make a stale dialog decision or permit discard', async () => {
  const record = {},
    controller = new AbortController()
  await assert.rejects(
    probeCloseConfirmation(
      record,
      (row) => {
        controller.abort()
        return decodeWebDriverResponse('{"value":true}', 200, row)
      },
      true,
      controller.signal,
    ),
    { name: 'AbortError' },
  )
  const row = record.closeConfirmationProbes.observations[0]
  assert.equal(row.value, true)
  assert.equal(row.response.text, '{"value":true}')
  assert.equal(row.decision, 'interrupted')
  assert.equal(record.unexpectedUnsavedConfirmation, undefined)
})

const sid = 'S-1-5-21-11-22-33-1001'
const appContainerSid = 'S-1-15-2-1-2-3-4-5-6-7'
const linkedAuthority = (elevationType = 1) => ({
  callerThreadTokenAbsent: true,
  callerThreadQueryWin32Error: 1008,
  queryAttempted: elevationType === 3,
  querySucceeded: elevationType === 3,
  queryWin32Error: null,
  targetTokenType: elevationType === 3 ? 2 : null,
  targetImpersonationLevel: elevationType === 3 ? 1 : null,
  targetQueryWin32Error: null,
})
const noHelperProof = {
  helperNativeProofVerified: false,
  helperProtocolHandlesNonInheritable: null,
  helperSelfSid: null,
  browserFromHelperSid: null,
  helperSelfAppContainerSid: null,
  browserFromHelperAppContainerSid: null,
  helperSelfObserverPid: null,
  helperSelfSubjectPid: null,
  browserFromHelperObserverPid: null,
  browserFromHelperSubjectPid: null,
  helperSelfTokenEvidence: null,
  browserFromHelperTokenEvidence: null,
}
const nativeToken = (kind = 'pure-standard', sandbox = false) => ({
  tokenType: 1,
  sessionId: 2,
  elevated: false,
  elevationType: kind === 'filtered-admin' ? 3 : 1,
  integrityRid: sandbox ? 4096 : 8192,
  uiAccess: false,
  ownerIsUser: true,
  administratorsGroupPresentIncludingDenyOnly: kind === 'filtered-admin',
  administratorsGroupAttributes: kind === 'filtered-admin' ? 16 : null,
  privilegeCount: 2,
  hostDisallowedPrivilegeCount: 0,
  sandboxDisallowedPrivilegeCount: sandbox ? 0 : 1,
  seDebugPrivilegePresent: false,
  linkedAuthority: sandbox ? linkedAuthority(kind === 'filtered-admin' ? 3 : 1) : null,
})
const processToken = (kind = 'pure-standard') => {
  const { linkedAuthority: _nativeOnlyProof, ...facts } = nativeToken(kind)
  return {
    ...facts,
    sid,
    ownerSid: sid,
    pureStandardUser: kind === 'pure-standard',
    filteredAdmin: kind === 'filtered-admin',
    privilegesComplete: true,
    privileges: [
      { name: 'SeChangeNotifyPrivilege', attributes: 3 },
      { name: 'SeShutdownPrivilege', attributes: 0 },
    ],
  }
}
const accountContext = (kind = 'pure-standard') => ({
  status: 'ready',
  actualSid: sid,
  expectedSid: sid,
  expectedAccountKind: kind,
  accountKindVerified: true,
  pureStandard: kind === 'pure-standard',
  filteredAdmin: kind === 'filtered-admin',
  interactive: true,
  sessionId: 2,
  expectedSessionId: 2,
  blockedReasons: [],
  desktop: { token: processToken(kind) },
  knownFolders: {
    profile: 'C:/Users/test',
    roamingAppData: 'C:/Users/test/AppData/Roaming',
    localAppData: 'C:/Users/test/AppData/Local',
  },
})
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
  hostTokenClass: 'pure-standard',
  hostNonElevatedVerified: true,
  hostTokenEvidence: nativeToken(),
  childTokenEvidence: nativeToken('pure-standard', true),
  browserTokenEvidence: nativeToken('pure-standard', true),
  helperSelfTokenEvidence: nativeToken('pure-standard', true),
  browserFromHelperTokenEvidence: nativeToken('pure-standard', true),
  helperNativeProofVerified: true,
  helperProtocolHandlesNonInheritable: true,
  helperSelfSid: sid,
  browserFromHelperSid: sid,
  helperSelfAppContainerSid: appContainerSid,
  browserFromHelperAppContainerSid: appContainerSid,
  helperPid: 222,
  helperSelfObserverPid: 222,
  helperSelfSubjectPid: 222,
  browserFromHelperObserverPid: 222,
  browserFromHelperSubjectPid: 333,
  appContainerSid,
  childAppContainerSid: appContainerSid,
  browserAppContainerSid: appContainerSid,
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
  const ledger = new AuditLedger(sid, 2)
  append(ledger, 'admitted')
  append(ledger, 'started', ownership)
  append(ledger, 'finished', { ...completion, ...changes })
  return ledger
}

test('four self-authored fixture bytes retain CRLF and Unicode without normalization', () => {
  assert.deepEqual(Object.keys(fixtures), ['syntax', 'ordinary', 'wide', 'c4', 'invalid'])
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
  const context = accountContext()
  assert.equal(validateContext(context, sid, 2), context)
  for (const changes of [
    { pureStandard: false },
    { interactive: false },
    { actualSid: sid + '9' },
    { sessionId: 3 },
    { blockedReasons: ['denied'] },
    { status: 'blocked' },
    { desktop: {} },
    { expectedAccountKind: 'filtered-admin' },
    { accountKindVerified: false },
  ]) {
    assert.throws(() => validateContext({ ...context, ...changes }, sid, 2))
  }
  assert.throws(() => validateContext(context, sid, 0))
})

test('filtered-admin admission requires actual limited medium token without relabeling it pure-standard', () => {
  const context = accountContext('filtered-admin')
  assert.equal(validateContext(context, sid, 2, 'filtered-admin'), context)
  assert.equal(context.pureStandard, false)
  assert.throws(() => validateContext(context, sid, 2), /account|pure-standard/i)
  assert.throws(() => validateContext(accountContext(), sid, 2, 'filtered-admin'))
  assert.throws(() => validateContext(context, sid, 2, 'administrator'))
  const expected = new Map([[10, '/fixtures/node.exe']])
  const row = {
    pid: 10,
    image: expected.get(10),
    stillActive: true,
    creationFileTime: '123',
    token: context.desktop.token,
  }
  validateProcessIdentities([row], expected, sid, 2, new Map(), 'filtered-admin')
  assert.throws(() => validateProcessIdentities([row], expected, sid, 2, new Map()))
})

test('both account kinds reject missing actual facts, enabled admin bits, elevated and privileged tokens', () => {
  for (const kind of ['pure-standard', 'filtered-admin']) {
    for (const [field, value] of [
      ['tokenType', 2],
      ['elevated', true],
      ['elevationType', 2],
      ['integrityRid', 12288],
      ['uiAccess', true],
      ['ownerIsUser', false],
      ['ownerSid', 'S-1-5-32-544'],
      ['sessionId', 3],
      ['privilegesComplete', false],
      ['privilegeCount', 0],
      ['hostDisallowedPrivilegeCount', 1],
      ['seDebugPrivilegePresent', true],
      ['administratorsGroupAttributes', 20],
      ['administratorsGroupAttributes', 17],
    ]) {
      assert.throws(
        () => validateHostProcessToken({ ...processToken(kind), [field]: value }, sid, 2, kind),
        `${kind} rejects ${field}`,
      )
    }
    for (const key of Object.keys(processToken(kind)).filter(
      (key) => key !== 'sandboxDisallowedPrivilegeCount',
    )) {
      const token = processToken(kind)
      delete token[key]
      assert.throws(() => validateHostProcessToken(token, sid, 2, kind), `${kind} missing ${key}`)
    }
    const token = processToken(kind)
    token.privileges[1] = { name: 'SeDebugPrivilege', attributes: 0 }
    assert.throws(() => validateHostProcessToken(token, sid, 2, kind), /Every present privilege/)
    token.privileges[1] = { ...token.privileges[0] }
    assert.throws(() => validateHostProcessToken(token, sid, 2, kind), /duplicate/)
  }
})

test('native audit checks filtered host class and exact low-privilege fresh child/browser evidence', () => {
  const facts = {
    ...ownership,
    hostPureStandard: false,
    hostTokenClass: 'filtered-admin',
    hostTokenEvidence: nativeToken('filtered-admin'),
    childTokenEvidence: nativeToken('filtered-admin', true),
    browserTokenEvidence: nativeToken('filtered-admin', true),
    helperSelfTokenEvidence: nativeToken('filtered-admin', true),
    browserFromHelperTokenEvidence: nativeToken('filtered-admin', true),
  }
  const ledger = new AuditLedger(sid, 2, 'filtered-admin')
  assert.equal(facts.hostTokenEvidence.elevationType, 3)
  assert.equal(facts.childTokenEvidence.elevationType, 3)
  assert.equal(facts.browserTokenEvidence.elevationType, 3)
  append(ledger, 'admitted')
  append(ledger, 'started', facts)
  append(ledger, 'finished', { ...completion, ...facts })
  assert.equal(ledger.verifyAll().length, 1)
  assert.throws(() => new AuditLedger(sid))
  for (const changes of [
    { hostPureStandard: true },
    { hostTokenClass: 'pure-standard' },
    { hostNonElevatedVerified: false },
    { hostTokenEvidence: null },
    { browserTokenEvidence: null },
    { childAppContainerSid: 'S-1-15-2-8-2-3-4-5-6-7' },
    { browserAppContainerSid: 'S-1-15-2-01-2-3-4-5-6-7' },
    { childTokenEvidence: { ...facts.childTokenEvidence, integrityRid: 8192 } },
    { childTokenEvidence: { ...facts.childTokenEvidence, sessionId: 3 } },
    { childTokenEvidence: { ...facts.childTokenEvidence, elevationType: 2 } },
    { browserTokenEvidence: { ...facts.browserTokenEvidence, elevationType: 2 } },
    { browserTokenEvidence: { ...facts.browserTokenEvidence, sandboxDisallowedPrivilegeCount: 1 } },
    { browserTokenEvidence: { ...facts.browserTokenEvidence, administratorsGroupAttributes: 20 } },
  ]) {
    const invalid = new AuditLedger(sid, 2, 'filtered-admin')
    append(invalid, 'admitted')
    assert.throws(() => append(invalid, 'started', { ...facts, ...changes }))
  }
})

const sandboxViews = [
  'childTokenEvidence',
  'browserTokenEvidence',
  'helperSelfTokenEvidence',
  'browserFromHelperTokenEvidence',
]
const filteredOwnership = () => ({
  ...ownership,
  hostPureStandard: false,
  hostTokenClass: 'filtered-admin',
  hostTokenEvidence: nativeToken('filtered-admin'),
  ...Object.fromEntries(sandboxViews.map((name) => [name, nativeToken('filtered-admin', true)])),
})
const admitOwnership = (facts, kind = 'pure-standard') => {
  const ledger = new AuditLedger(sid, 2, kind)
  append(ledger, 'admitted')
  append(ledger, 'started', facts)
  append(ledger, 'finished', { ...completion, ...facts })
  return ledger.verifyAll()
}

test('all four sandbox views require complete Default or Limited linked authority facts', () => {
  for (const kind of ['pure-standard', 'filtered-admin']) {
    const valid = kind === 'pure-standard' ? ownership : filteredOwnership()
    assert.equal(admitOwnership(valid, kind).length, 1)
    for (const field of sandboxViews) {
      for (const key of Object.keys(linkedAuthority())) {
        const facts = structuredClone(valid)
        delete facts[field].linkedAuthority[key]
        assert.throws(() => admitOwnership(facts, kind), undefined, `${field} missing ${key}`)
      }
      for (const change of [
        { linkedAuthority: null },
        { linkedAuthority: { ...valid[field].linkedAuthority, callerThreadTokenAbsent: false } },
        { linkedAuthority: { ...valid[field].linkedAuthority, callerThreadQueryWin32Error: 5 } },
        { linkedAuthority: { ...valid[field].linkedAuthority, queryWin32Error: 5 } },
        { linkedAuthority: { ...valid[field].linkedAuthority, targetQueryWin32Error: 5 } },
        { linkedAuthority: { ...valid[field].linkedAuthority, queryAttempted: 'true' } },
        {
          linkedAuthority: {
            ...valid[field].linkedAuthority,
            arbitraryDiagnostic: 'not part of production proof',
          },
        },
      ]) {
        const facts = structuredClone(valid)
        Object.assign(facts[field], change)
        assert.throws(() => admitOwnership(facts, kind), undefined, field)
      }
    }
  }
})

test('Limited authority uses actual identification type and level without assuming QUERY-only grants', () => {
  // The observed 0xF01FF handle grant is not a QUERY-only guarantee and is not
  // projected into the closed product proof. Its actual type/level are required.
  const facts = filteredOwnership()
  assert.equal(admitOwnership(facts, 'filtered-admin').length, 1)
  for (const field of sandboxViews) {
    for (const changes of [
      { targetTokenType: 1 },
      { targetTokenType: null },
      { targetTokenType: 0 },
      { targetImpersonationLevel: 0 },
      { targetImpersonationLevel: 2 },
      { targetImpersonationLevel: 3 },
      { targetImpersonationLevel: null },
      { querySucceeded: false },
      { queryAttempted: false },
    ]) {
      const invalid = structuredClone(facts)
      Object.assign(invalid[field].linkedAuthority, changes)
      assert.throws(() => admitOwnership(invalid, 'filtered-admin'), undefined, field)
    }
  }
})

test('Default authority cannot carry a queried linked target or reuse a Limited proof', () => {
  for (const field of sandboxViews) {
    for (const changes of [
      { queryAttempted: true },
      { querySucceeded: true },
      { targetTokenType: 2 },
      { targetImpersonationLevel: 1 },
    ]) {
      const facts = structuredClone(ownership)
      Object.assign(facts[field].linkedAuthority, changes)
      assert.throws(() => admitOwnership(facts))
    }
    const facts = structuredClone(ownership)
    facts[field].elevationType = 3
    assert.throws(() => admitOwnership(facts), /queryAttempted|Expected values/)
  }
})

test('parent observations cannot substitute for helper-self and helper-context browser proofs', () => {
  for (const changes of [
    { helperNativeProofVerified: false },
    { helperSelfTokenEvidence: null },
    { browserFromHelperTokenEvidence: null },
    { helperSelfSid: 'S-1-5-21-1-2-3-1002' },
    { browserFromHelperSid: null },
    { helperSelfAppContainerSid: 'S-1-15-2-8-2-3-4-5-6-7' },
    { browserFromHelperAppContainerSid: null },
    { helperPid: 111 },
    { helperPid: 333 },
    { helperPid: 0 },
    { helperSelfObserverPid: 111 },
    { helperSelfSubjectPid: 333 },
    { browserFromHelperObserverPid: 333 },
    { browserFromHelperSubjectPid: 222 },
    { helperSelfTokenEvidence: { ...ownership.helperSelfTokenEvidence, sessionId: 3 } },
    {
      browserFromHelperTokenEvidence: {
        ...ownership.browserFromHelperTokenEvidence,
        sandboxDisallowedPrivilegeCount: 1,
      },
    },
  ])
    assert.throws(() => admitOwnership({ ...ownership, ...changes }))
  const ledger = new AuditLedger(sid, 2)
  append(ledger, 'admitted')
  append(ledger, 'started', ownership)
  append(ledger, 'finished', {
    ...completion,
    helperPid: 444,
    helperSelfObserverPid: 444,
    helperSelfSubjectPid: 444,
    browserFromHelperObserverPid: 444,
  })
  assert.throws(() => ledger.verifyAll(), /Expected values/)
})

test('protocol handle inheritance proof is required at both native ownership stages for both accounts', () => {
  const field = 'helperProtocolHandlesNonInheritable'
  for (const kind of ['pure-standard', 'filtered-admin']) {
    const facts = kind === 'pure-standard' ? ownership : filteredOwnership()
    assert.equal(admitOwnership(facts, kind).length, 1)
    for (const value of [undefined, null, false, 'true', 1, {}]) {
      for (const phase of ['started', 'finished']) {
        const ledger = new AuditLedger(sid, 2, kind)
        const invalid = { ...facts, [field]: value }
        if (value === undefined) delete invalid[field]
        append(ledger, 'admitted')
        if (phase === 'started') {
          assert.throws(
            () => append(ledger, 'started', invalid),
            /helperProtocolHandlesNonInheritable/,
          )
        } else {
          append(ledger, 'started', facts)
          const finish = { ...completion, ...invalid }
          if (value === undefined) delete finish[field]
          append(ledger, 'finished', finish)
          assert.throws(() => ledger.verifyAll(), /helperProtocolHandlesNonInheritable/)
        }
      }
    }
  }
})

test('pre-ready cancellation keeps actual held helper facts without fabricating native self proofs', () => {
  const canceled = {
    ...completion,
    ...noHelperProof,
    successful: false,
    cancelled: true,
    browserSid: null,
    browserPid: null,
    browserTokenEvidence: null,
    browserAppContainerSid: null,
    browserAppContainer: false,
    browserZeroCapabilities: false,
    browserInOwnedJob: false,
    ownedPidsBeforeStop: [222],
    pngBytes: 0,
    pngSha256: null,
  }
  const ledger = new AuditLedger(sid, 2)
  append(ledger, 'admitted')
  append(ledger, 'finished', canceled)
  assert.equal(ledger.verifyAll().length, 1)
  for (const changes of [
    { helperNativeProofVerified: true },
    { helperProtocolHandlesNonInheritable: true },
    { helperProtocolHandlesNonInheritable: false },
    { helperProtocolHandlesNonInheritable: 'true' },
    { helperProtocolHandlesNonInheritable: undefined },
    { helperSelfSid: sid },
    { helperSelfTokenEvidence: ownership.childTokenEvidence },
  ]) {
    const invalid = new AuditLedger(sid, 2)
    append(invalid, 'admitted')
    append(invalid, 'finished', { ...canceled, ...changes })
    assert.throws(() => invalid.verifyAll())
  }
})

test('pre-publish cancellation validates an observed parent browser without inventing helper readiness', () => {
  const canceled = {
    ...completion,
    ...noHelperProof,
    successful: false,
    cancelled: true,
    pngBytes: 0,
    pngSha256: null,
  }
  const verify = (fields) => {
    const ledger = new AuditLedger(sid, 2)
    append(ledger, 'admitted')
    append(ledger, 'finished', { ...canceled, ...fields })
    return ledger.verifyAll()
  }
  assert.equal(verify({}).length, 1)
  assert.equal(verify({ cancelled: false, deadlineExpired: true }).length, 1)
  for (const fields of [
    { browserSid: 'S-1-5-21-1-2-3-1002' },
    { helperPid: 111 },
    { browserPid: 0 },
    { browserPid: 111 },
    { browserPid: 222 },
    { browserAppContainerSid: 'S-1-15-2-8-2-3-4-5-6-7' },
    { browserAppContainer: false },
    { browserZeroCapabilities: false },
    { browserInOwnedJob: false },
    { browserTokenEvidence: null },
    { browserTokenEvidence: { ...ownership.browserTokenEvidence, sessionId: 3 } },
    { browserTokenEvidence: { ...ownership.browserTokenEvidence, linkedAuthority: null } },
    { helperNativeProofVerified: true },
    { helperProtocolHandlesNonInheritable: true },
    { browserFromHelperTokenEvidence: ownership.browserTokenEvidence },
  ])
    assert.throws(() => verify(fields))
  assert.throws(() => verify({ successful: true }), /ready\/ownership/)
  assert.throws(() => admitOwnership({ ...ownership, ...noHelperProof }))
})

test('complete four-view audit records fit unchanged line, launch-log and product-report budgets', (t) => {
  const largeSid = 'S-1-5-21-4294967295-4294967295-4294967295-4294967295'
  const largeAppSid = 'S-1-15-2-' + Array(7).fill('4294967295').join('-')
  const facts = filteredOwnership()
  for (const name of ['hostSid', 'childSid', 'browserSid', 'helperSelfSid', 'browserFromHelperSid'])
    facts[name] = largeSid
  for (const name of [
    'appContainerSid',
    'childAppContainerSid',
    'browserAppContainerSid',
    'helperSelfAppContainerSid',
    'browserFromHelperAppContainerSid',
  ])
    facts[name] = largeAppSid
  const ledger = new AuditLedger(largeSid, 2, 'filtered-admin')
  const outputs = []
  let maximumLineBytes = 0
  for (let launch = 0; launch < 4; launch++) {
    const productPid = 1000 + launch
    let log = ''
    for (let index = 0; index < 8; index++) {
      const requestId = `${launch}_${index}_` + 'r'.repeat(76)
      const records = [
        { phase: 'admitted', requestId, productPid },
        { phase: 'started', requestId, productPid, ...facts },
        {
          phase: 'finished',
          requestId,
          productPid,
          ...completion,
          ...facts,
          ipcThreadCleanup: ['stdout', 'stdin', 'stderr'].map((stream) => ({
            stream,
            elapsedMs: 250,
            cancelRequested: false,
            cancelCallSucceeded: null,
            cancelWin32Error: null,
            finished: true,
            panicked: false,
          })),
          cleanupFailureKinds: [],
          stdoutFailure: null,
          stderrFailure: null,
          rendererStatus: 'ok',
          rendererErrorKind: null,
          capturedPngBytes: 262144,
        },
      ]
      for (const record of records) {
        const line = 'MILKUP_MERMAID_NATIVE_AUDIT ' + JSON.stringify(record) + '\n'
        maximumLineBytes = Math.max(maximumLineBytes, Buffer.byteLength(line))
        assert(Buffer.byteLength(line) <= 8192, 'Native fixed record limit remains 8192 bytes')
        log += line
        ledger.accept(record, productPid)
      }
    }
    assert(Buffer.byteLength(log) <= 512 * 1024, 'Per-product diagnostic cap unchanged')
    outputs.push(log)
  }
  assert.equal(ledger.verifyAll().length, 32)
  assert(ledger.events.length < 512)
  const reportBytes = Buffer.byteLength(
    JSON.stringify({ nativeAudit: ledger.events, launches: outputs }),
  )
  assert(reportBytes <= 2 * 1024 * 1024, 'Full synthetic UI audit remains within report cap')
  t.diagnostic(
    JSON.stringify({
      maximumLineBytes,
      maximumLaunchLogBytes: Math.max(...outputs.map((log) => Buffer.byteLength(log))),
      reportBytes,
      eventCount: ledger.events.length,
      completedJobs: 32,
    }),
  )
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
  const incomplete = new AuditLedger(sid, 2)
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
  const foreign = new AuditLedger(sid, 2)
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
  const ledger = new AuditLedger(sid, 2)
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
  const early = new AuditLedger(sid, 2)
  append(early, 'admitted')
  append(early, 'finished', {
    ...completion,
    successful: false,
    ownedJobCreated: false,
    ...noHelperProof,
    helperPid: null,
    profileCreated: false,
    jobActiveAfterStop: null,
    cancelled: true,
    childSid: null,
    browserSid: null,
    browserPid: null,
    childTokenEvidence: null,
    browserTokenEvidence: null,
    childAppContainerSid: null,
    browserAppContainerSid: null,
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
  const pretend = new AuditLedger(sid, 2)
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
    token: processToken(),
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
    ...noHelperProof,
    helperPid: null,
    profileCreated: false,
    jobActiveAfterStop: null,
    cancelled: true,
    childSid: null,
    browserSid: null,
    browserPid: null,
    childTokenEvidence: null,
    browserTokenEvidence: null,
    childAppContainerSid: null,
    browserAppContainerSid: null,
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
    { helperProtocolHandlesNonInheritable: true },
    { helperProtocolHandlesNonInheritable: false },
    { helperProtocolHandlesNonInheritable: undefined },
    { childSid: sid },
    { browserPid: 333 },
    { browserInOwnedJob: true },
  ]) {
    const ledger = new AuditLedger(sid, 2)
    append(ledger, 'admitted')
    append(ledger, 'finished', { ...noWork, ...changes })
    assert.throws(() => ledger.verifyAll())
  }
})

test('browser observation/decode bodies parse without executing browser APIs', () => {
  assert.doesNotThrow(() => new Function(observe))
  assert.doesNotThrow(() => new Function(decodeScript))
})

const pluginCard = (changes = {}) => ({
  id: 'milkup.diagrams',
  availableVersionText: '1.3.0 · 下次开启时应用',
  checked: 'false',
  busy: null,
  ariaDisabled: null,
  switchDisabled: false,
  visible: true,
  rect: { x: 20, y: 200, width: 600, height: 90 },
  switchRect: { x: 500, y: 220, width: 40, height: 24 },
  ...changes,
})

const pluginInventory = [
  { id: 'milkup.diagrams', version: '1.3.0' },
  { id: 'milkup.footnotes', version: '1.0.1' },
]
const bundledCards = () =>
  pluginInventory.map(({ id, version }) =>
    pluginCard({
      id,
      checked: id === 'milkup.diagrams' ? 'true' : 'false',
      availableVersionText: `${version} · 下次开启时应用`,
      visible: false,
      rect: { x: 20, y: 1400, width: 600, height: 90 },
    }),
  )

test('optional expected plugin inventory rejects empty, malformed and duplicate configuration', () => {
  assert.equal(parseExpectedPluginInventory(undefined), null)
  assert.deepEqual(parseExpectedPluginInventory(JSON.stringify(pluginInventory)), pluginInventory)
  for (const raw of [
    '',
    '[]',
    '{}',
    'not json',
    '[{"id":"milkup.diagrams"}]',
    JSON.stringify([pluginInventory[0], pluginInventory[0]]),
    JSON.stringify([{ id: 'milkup.diagrams', version: '1.3' }]),
  ])
    assert.throws(() => parseExpectedPluginInventory(raw))
})

test('bundled inventory waits for late cards, DOM versions, layout and settled busy state offscreen', async () => {
  const complete = bundledCards()
  const states = [
    { cards: [complete[0]] },
    { cards: [complete[0], { ...complete[1], availableVersionText: null }] },
    { cards: [complete[0], { ...complete[1], rect: { width: 0, height: 0 } }] },
    { cards: [complete[0], { ...complete[1], busy: 'true' }] },
    { cards: complete },
  ]
  let reads = 0
  const result = await waitForBundledPluginInventory(
    async () => states[Math.min(reads++, states.length - 1)],
    pluginInventory,
    { timeoutMs: 1000, pollIntervalMs: 1 },
  )
  assert.equal(reads, states.length)
  assert.equal(result.state, states.at(-1))
  assert.deepEqual(
    result.observed,
    pluginInventory.map(({ id, version }) => ({
      id,
      version,
      checked: id === 'milkup.diagrams' ? 'true' : 'false',
      busy: null,
    })),
  )
})

test('bundled inventory rejects extra, duplicate, enabled and mismatched public versions', () => {
  const cards = bundledCards()
  assert.throws(
    () =>
      inspectBundledPluginInventory(
        [...cards, pluginCard({ id: 'milkup.extra' })],
        pluginInventory,
      ),
    /Unexpected bundled plugin/,
  )
  assert.throws(
    () => inspectBundledPluginInventory([...cards, cards[0]], pluginInventory),
    /Unique observed/,
  )
  assert.throws(
    () =>
      inspectBundledPluginInventory([cards[0], { ...cards[1], checked: 'true' }], pluginInventory),
    /remain disabled/,
  )
  for (const version of ['1.3.01', '1.3.0-beta.1', '9.9.9'])
    assert.throws(
      () =>
        inspectBundledPluginInventory(
          [{ ...cards[0], availableVersionText: `${version} · 下次开启时应用` }, cards[1]],
          pluginInventory,
        ),
      /version mismatch/,
    )
  assert.throws(
    () =>
      inspectBundledPluginInventory(
        [{ ...cards[0], availableVersionText: 'not a version' }, cards[1]],
        pluginInventory,
      ),
    /Unexpected public plugin version text/,
  )
  // A missing earlier expected card must not hide a wrong version on a later one.
  assert.throws(
    () =>
      inspectBundledPluginInventory(
        [{ ...cards[1], availableVersionText: '9.9.9 · 下次开启时应用' }],
        pluginInventory,
      ),
    /version mismatch/,
  )
})

test('missing bundled cards or DOM versions time out without manifest-supplied observations', async () => {
  for (const cards of [
    [],
    bundledCards().map((card) => ({ ...card, availableVersionText: null })),
    bundledCards().map((card) => ({ ...card, busy: 'true' })),
  ]) {
    assert.equal(inspectBundledPluginInventory(cards, pluginInventory), null)
    await assert.rejects(
      waitForBundledPluginInventory(async () => ({ cards }), pluginInventory, {
        timeoutMs: 15,
        pollIntervalMs: 1,
      }),
      /Timed out waiting for complete disabled bundled plugin inventory/,
    )
  }
  await assert.rejects(
    waitForBundledPluginInventory(
      async () => ({ cards: [...bundledCards(), pluginCard({ id: 'milkup.extra' })] }),
      pluginInventory,
      { timeoutMs: 1000 },
    ),
    /Unexpected bundled plugin/,
  )
  await assert.rejects(
    waitForBundledPluginInventory(
      async () => ({ cards: [bundledCards()[0], { ...bundledCards()[1], checked: 'true' }] }),
      pluginInventory,
      { timeoutMs: 1000 },
    ),
    /remain disabled/,
  )
})

test('plugin menu waits for asynchronous exact-card readiness independently of document ready', async () => {
  const states = [
    { loading: 'ready', cards: [], pluginText: '安装本地插件' },
    { loading: 'ready', cards: [pluginCard({ id: 'milkup.other' })] },
    { loading: 'ready', cards: [pluginCard({ busy: 'true' })] },
    { loading: 'ready', cards: [pluginCard()] },
  ]
  let reads = 0
  const result = await waitForPluginCard(
    async () => {
      await new Promise((resolve) => setTimeout(resolve, 1))
      return states[Math.min(reads++, states.length - 1)]
    },
    { timeoutMs: 1000, pollIntervalMs: 1 },
  )
  assert.equal(reads, 4)
  assert.equal(result.card.id, 'milkup.diagrams')
  assert.equal(result.card.checked, 'false')
})

test('laid-out offscreen cards are ready for real wheel input without assuming disabled', async () => {
  const card = pluginCard({
    visible: false,
    checked: 'true',
    rect: { x: 20, y: 1400, width: 600, height: 90 },
  })
  const result = await waitForPluginCard(async () => ({ cards: [card] }), { timeoutMs: 100 })
  assert.equal(result.card, card)
  assert.equal(result.card.checked, 'true', 'Readiness does not convert enabled into disabled')
})

test('missing or unusable cards time out with public application notice diagnostics', async () => {
  for (const cards of [
    [],
    [pluginCard({ checked: undefined })],
    [pluginCard({ busy: 'true' })],
    [pluginCard({ rect: { width: 0, height: 0 } })],
    [pluginCard({ switchDisabled: true })],
  ]) {
    await assert.rejects(
      waitForPluginCard(
        async () => ({
          menu: true,
          cards,
          pluginText: '安装本地插件',
          applicationNotices: [{ text: '插件目录尚未就绪', visible: true }],
        }),
        { timeoutMs: 15, pollIntervalMs: 1 },
      ),
      (error) => {
        assert.match(error.message, /Timed out waiting for laid-out nonbusy milkup\.diagrams card/)
        assert.match(error.message, /插件目录尚未就绪/)
        assert.match(error.message, /"visible":true/)
        return true
      },
    )
  }
})

const reflowCards = (collapsed = false, scroll = 0) => [
  {
    id: 'milkup.diagrams',
    rect: { x: 242, y: 202.59375 - scroll, width: 754, height: collapsed ? 157 : 178 },
  },
  {
    id: 'milkup.footnotes',
    rect: { x: 242, y: (collapsed ? 369.59375 : 390.59375) - scroll, width: 754, height: 160 },
  },
  {
    id: 'milkup.formatting',
    rect: { x: 242, y: (collapsed ? 539.59375 : 560.59375) - scroll, width: 754, height: 160 },
  },
]

test('card layout accepts pending-version height removal and exact downstream reflow', () => {
  const result = validateCardReflow(reflowCards(), reflowCards(true))
  assert.equal(result.targetTop, 202.59375)
  assert.equal(result.rows[0].heightDelta, -21)
  assert.equal(result.rows[1].actualTop, result.rows[1].expectedTop)
  // The actual pointer takes its baseline after wheel reveal, so a pre-click
  // scroll changes both snapshots equally and is not mistaken for a card jump.
  assert.doesNotThrow(() => validateCardReflow(reflowCards(false, 120), reflowCards(true, 120)))
})

test('card layout still rejects reordered identities, target jumps and unexplained downstream shifts', () => {
  const before = reflowCards(),
    after = reflowCards(true)
  assert.throws(() => validateCardReflow(before, [after[1], after[0], after[2]]), /identity order/)
  const moved = structuredClone(after)
  moved[0].rect.y += 5
  assert.throws(() => validateCardReflow(before, moved), /predecessor|top anchor/)
  const wrongReflow = structuredClone(after)
  wrongReflow[2].rect.y += 4
  assert.throws(() => validateCardReflow(before, wrongReflow), /predecessor height/)
  const widened = structuredClone(after)
  widened[1].rect.width += 10
  assert.throws(() => validateCardReflow(before, widened), /width retained/)
})

function teardownFixture(overrides = {}) {
  const calls = [],
    record = { afterFailure: true }
  let alive = true
  const options = {
    record,
    isAlive: () => alive,
    drainNative: async () => {
      calls.push('native-drain')
      return { innerCleanupVerified: true }
    },
    closeUi: async () => {
      calls.push('ui-close')
      alive = false
      return { realUiCloseRequested: true }
    },
    waitForExit: async () => {
      calls.push('ui-exit-wait')
      return waitForOwnedExit(() => alive, 10, 1)
    },
    forceStop: async () => {
      calls.push('identity-check')
      calls.push('owned-kill')
      alive = false
    },
    drainStdio: async () => {
      calls.push('stdio-close')
    },
    verifyExit: () => {
      calls.push('verify-exit')
      assert.equal(alive, false)
      return true
    },
    verifyNative: () => {
      calls.push('verify-native')
      return { innerCleanupVerified: true }
    },
    detach: async () => {
      calls.push('detach')
    },
    ...overrides,
  }
  return {
    calls,
    record,
    options,
    setAlive: (value) => {
      alive = value
    },
  }
}

test('failure teardown drains an admitted job before real UI close, then stdio and detach', async () => {
  const ledger = new AuditLedger(sid, 2)
  append(ledger, 'admitted')
  append(ledger, 'started', ownership)
  const fixture = teardownFixture()
  fixture.options.drainNative = async () => {
    fixture.calls.push('native-drain')
    return waitForNativeJobs(ledger, 111, fixture.options.isAlive, {
      timeoutMs: 1000,
      pollIntervalMs: 1,
    })
  }
  setTimeout(() => append(ledger, 'finished', completion), 5)
  await settleOwnedProduct(fixture.options)
  assert.deepEqual(fixture.calls, [
    'native-drain',
    'ui-close',
    'ui-exit-wait',
    'stdio-close',
    'verify-exit',
    'verify-native',
    'detach',
  ])
  assert.equal(fixture.record.closedByUi, true)
  assert.deepEqual(fixture.record.errors, [])
  assert.equal(ledger.pending(111), 0)
})

test('native drain timeout survives later successful UI close and late final audit', async () => {
  const ledger = new AuditLedger(sid, 2)
  append(ledger, 'admitted')
  append(ledger, 'started', ownership)
  const fixture = teardownFixture()
  fixture.options.drainNative = () =>
    waitForNativeJobs(ledger, 111, fixture.options.isAlive, { timeoutMs: 5, pollIntervalMs: 1 })
  fixture.options.drainStdio = async () => {
    fixture.calls.push('stdio-close')
    append(ledger, 'finished', completion)
  }
  fixture.options.verifyNative = () => {
    fixture.calls.push('verify-native')
    return ledger.verifyAll(111)
  }
  await assert.rejects(
    settleOwnedProduct(fixture.options),
    /Timed out draining admitted native jobs/,
  )
  assert(fixture.calls.includes('ui-close'))
  assert(!fixture.calls.includes('owned-kill'))
  assert(fixture.calls.indexOf('stdio-close') < fixture.calls.indexOf('verify-native'))
  assert.equal(
    ledger.verifyAll().length,
    1,
    'Later completion exists but cannot erase the earlier drain failure',
  )
  assert(fixture.record.errors.some((error) => error.includes('native-drain')))
})

test('inner cleanup rejection still requests UI close and remains failed without forced termination', async () => {
  const fixture = teardownFixture({
    drainNative: async () => {
      throw Error('profile deletion unverified')
    },
  })
  await assert.rejects(settleOwnedProduct(fixture.options), /profile deletion unverified/)
  assert(fixture.calls.includes('ui-close') && fixture.calls.includes('detach'))
  assert(!fixture.calls.includes('owned-kill'))
  assert.equal(
    fixture.record.closedByUi,
    true,
    'Actual UI close is recorded separately from failed native cleanup',
  )
})

test('only UI exit timeout permits identity-checked force stop, which never passes inner cleanup', async () => {
  const fixture = teardownFixture()
  fixture.options.closeUi = async () => {
    fixture.calls.push('ui-close')
    throw Error('driver unavailable')
  }
  fixture.options.verifyNative = () => {
    fixture.calls.push('verify-native')
    throw Error('Missing finished native audit')
  }
  await assert.rejects(
    settleOwnedProduct(fixture.options),
    /forced termination is not inner cleanup acceptance/,
  )
  assert.deepEqual(fixture.calls, [
    'native-drain',
    'ui-close',
    'ui-exit-wait',
    'identity-check',
    'owned-kill',
    'stdio-close',
    'verify-exit',
    'verify-native',
    'detach',
  ])
  assert.equal(fixture.record.outerTerminationRequired, true)
  assert.equal(fixture.record.closedByUi, false)
  assert(fixture.record.errors.some((error) => error.includes('Missing finished native audit')))
})

test('already exited or crashed product is never killed again and abnormal exit stays failed', async () => {
  const fixture = teardownFixture({
    verifyExit: () => {
      throw Error('Product exit code 101')
    },
  })
  fixture.setAlive(false)
  await assert.rejects(settleOwnedProduct(fixture.options), /exit code 101/)
  assert(!fixture.calls.includes('ui-close') && !fixture.calls.includes('owned-kill'))
  assert(fixture.calls.includes('stdio-close') && fixture.calls.includes('detach'))
})

test('UI exit-wait exception still uses identity-checked fallback and preserves the exception', async () => {
  const fixture = teardownFixture()
  fixture.options.closeUi = async () => ({ realUiCloseRequested: true })
  fixture.options.waitForExit = async () => {
    throw Error('UI wait transport failed')
  }
  await assert.rejects(settleOwnedProduct(fixture.options), /UI wait transport failed/)
  assert(fixture.calls.includes('identity-check') && fixture.calls.includes('owned-kill'))
  assert.equal(fixture.record.closedByUi, false)
  assert(fixture.record.errors.some((error) => error.includes('UI wait transport failed')))
  assert.equal(fixture.record.uiExitWaitFailed, true)
  assert.equal(fixture.record.uiExitDeadlineUnmet, undefined)
  assert(!fixture.record.errors.some((error) => error.includes('did not exit within')))
})

test('fallback skips observation or signal only after the held process actually records exit', async () => {
  for (const transition of ['before-observation', 'during-observation', 'observer-error']) {
    let observations = 0,
      verifications = 0,
      kills = 0
    const current = {
      pid: 111,
      exitCode: null,
      signalCode: null,
      kill() {
        kills++
        return true
      },
    }
    if (transition === 'before-observation') current.exitCode = 0
    const result = await stopOwnedProductAfterFailure({
      current,
      expectedPid: 111,
      observeIdentity: async () => {
        observations++
        await Promise.resolve()
        current.exitCode = 0
        if (transition === 'observer-error')
          throw Error('Observer exited after owned process: ' + 'x'.repeat(3000))
        return []
      },
      verifyIdentity: () => {
        verifications++
      },
    })
    assert.equal(observations, transition === 'before-observation' ? 0 : 1)
    assert.equal(verifications, 0)
    assert.equal(kills, 0)
    assert.equal(result.exactOwnedProcessAlreadyExited, true)
    assert.equal(result.exitCode, 0)
    assert.equal(result.signal, null)
    assert.equal(result.forcedTermination, false)
    assert.equal(result.innerCleanupAcceptance, false)
    if (transition === 'observer-error') {
      assert.equal(result.identityObservationError.truncated, true)
      assert(Buffer.byteLength(result.identityObservationError.text) <= 2048)
    }
  }
})

test('fallback cannot infer owned exit from missing PID, observer failure or mismatched identity', async () => {
  for (const failure of ['missing-pid', 'observer-error', 'wrong-held-pid']) {
    let kills = 0
    const current = {
      pid: 111,
      exitCode: null,
      signalCode: null,
      kill() {
        kills++
        return true
      },
    }
    await assert.rejects(
      stopOwnedProductAfterFailure({
        current,
        expectedPid: failure === 'wrong-held-pid' ? 222 : 111,
        observeIdentity: async () => {
          if (failure === 'observer-error') throw Error('Observer unavailable')
          return []
        },
        verifyIdentity: (identities) =>
          validateProcessIdentities(
            identities,
            new Map([[111, 'C:/milkup.exe']]),
            sid,
            2,
            new Map(),
            'pure-standard',
          ),
      }),
    )
    assert.equal(kills, 0)
  }
})

test('fallback signals the held process only after identity verification and never proves inner cleanup', async () => {
  const calls = []
  const current = {
    pid: 111,
    exitCode: null,
    signalCode: null,
    kill() {
      calls.push('kill')
      this.signalCode = 'SIGTERM'
      return true
    },
  }
  const result = await stopOwnedProductAfterFailure({
    current,
    expectedPid: 111,
    observeIdentity: async () => {
      calls.push('observe')
      return 'identity'
    },
    verifyIdentity: (identity) => {
      calls.push('verify')
      assert.equal(identity, 'identity')
    },
  })
  assert.deepEqual(calls, ['observe', 'verify', 'kill'])
  assert.deepEqual(result, {
    exactOwnedProcessStopped: true,
    forcedTermination: true,
    innerCleanupAcceptance: false,
  })
})

test('unknown close-probe error stays failed when the owned process exits during fallback observation', async () => {
  const fixture = teardownFixture()
  const current = {
    pid: 111,
    exitCode: null,
    signalCode: null,
    kill() {
      assert.fail('Already exited product must not be killed')
    },
  }
  fixture.options.closeUi = async () => ({ realUiCloseRequested: true })
  fixture.options.waitForExit = async () => {
    throw Error('Unrelated close-probe failure')
  }
  fixture.options.forceStop = () =>
    stopOwnedProductAfterFailure({
      current,
      expectedPid: 111,
      observeIdentity: async () => {
        await Promise.resolve()
        current.exitCode = 0
        fixture.setAlive(false)
        return []
      },
      verifyIdentity: () => assert.fail('No missing-PID inference needed after held exit'),
    })
  await assert.rejects(settleOwnedProduct(fixture.options), /Unrelated close-probe failure/)
  assert.equal(fixture.record.closedByUi, false)
  assert.equal(fixture.record.uiExitWaitFailed, true)
  assert.equal(fixture.record.uiExitDeadlineUnmet, undefined)
  assert.equal(
    fixture.record.phases.find((row) => row.phase === 'owned-process-fallback').result
      .forcedTermination,
    false,
  )
  assert(!fixture.record.errors.some((error) => error.includes('did not exit within')))
})

test('delayed unsaved-close dialog is polled within one exit budget before natural exit', async () => {
  let alive = true,
    reads = 0,
    discarded = 0
  const exited = await waitForOwnedExit(
    () => alive,
    100,
    1,
    async () => {
      reads++
      if (reads < 3) return
      discarded++
      alive = false
    },
  )
  assert.equal(exited, true)
  assert.equal(reads, 3)
  assert.equal(discarded, 1)
})

test('an unrequested self-exit is never reported as a real UI close', async () => {
  const fixture = teardownFixture()
  fixture.options.closeUi = async () => {
    fixture.setAlive(false)
    return { realUiCloseRequested: false }
  }
  await settleOwnedProduct(fixture.options)
  assert.equal(fixture.record.closedByUi, false)
})

test('confirmation polling never resets or accepts an exit beyond the original close deadline', async () => {
  let alive = true
  const result = await waitForOwnedExit(
    () => alive,
    5,
    1,
    async () => {
      await new Promise((resolve) => setTimeout(resolve, 10))
      alive = false
    },
  )
  assert.equal(result, false)
  const fixture = teardownFixture()
  fixture.options.closeUi = async () => ({ realUiCloseRequested: true })
  fixture.options.waitForExit = async () => {
    fixture.setAlive(false)
    return false
  }
  await assert.rejects(settleOwnedProduct(fixture.options), /UI-close deadline/)
  assert(!fixture.calls.includes('owned-kill'), 'Already exited product is never killed')
  assert.equal(fixture.record.closedByUi, false)
})

test('timely owned exit stays timely when a closing query completes after the deadline', async (t) => {
  let now = 0,
    alive = true,
    observedExit
  t.mock.method(performance, 'now', () => now)
  const exit = new AbortController()
  const result = await waitForOwnedExit(
    () => alive,
    20,
    1,
    async () => {
      now = 5
      observedExit = now
      alive = false
      exit.abort()
      // A closing WebDriver response may arrive long after the actual exit.
      now = 30
    },
    { exitedAt: () => observedExit, exitSignal: exit.signal },
  )
  assert.equal(result, true)
})

test('owned exit interrupts a stalled confirmation request without awaiting its normal timeout', async (t) => {
  let now = 0,
    alive = true,
    observedExit,
    queryAborted = false
  t.mock.method(performance, 'now', () => now)
  const exit = new AbortController()
  const result = await waitForOwnedExit(
    () => alive,
    1000,
    1,
    (signal) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener(
          'abort',
          () => {
            queryAborted = true
            reject(signal.reason)
          },
          { once: true },
        )
        queueMicrotask(() => {
          now = 5
          observedExit = now
          alive = false
          exit.abort()
        })
      }),
    { exitedAt: () => observedExit, exitSignal: exit.signal },
  )
  assert.equal(result, true)
  assert.equal(queryAborted, true)
})

test('the original exit budget aborts a stalled request while the owned process remains alive', async (t) => {
  let now = 0,
    queryAborted = false
  t.mock.method(performance, 'now', () => now)
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const waiting = waitForOwnedExit(
    () => true,
    15,
    1,
    (signal) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener(
          'abort',
          () => {
            queryAborted = true
            reject(signal.reason)
          },
          { once: true },
        )
      }),
  )
  now = 15
  t.mock.timers.tick(15)
  assert.equal(await waiting, false)
  assert.equal(queryAborted, true)
})

test('a recorded owned exit after the original budget remains a failure', async (t) => {
  let now = 0,
    alive = true,
    observedExit
  t.mock.method(performance, 'now', () => now)
  const exit = new AbortController()
  const result = await waitForOwnedExit(
    () => alive,
    20,
    1,
    async () => {
      now = 21
      observedExit = now
      alive = false
      exit.abort()
    },
    { exitedAt: () => observedExit, exitSignal: exit.signal },
  )
  assert.equal(result, false)
})

test('confirmation errors unrelated to an owned exit are retained and pending observation is aborted', async () => {
  let observedSignal
  await assert.rejects(
    waitForOwnedExit(
      () => true,
      1000,
      1,
      async (signal) => {
        observedSignal = signal
        throw Error('Exact fixture identity mismatch')
      },
    ),
    /Exact fixture identity mismatch/,
  )
  assert.equal(observedSignal.aborted, true)
})

test('an interrupted query without an owned exit is never accepted as process completion', async () => {
  const exit = new AbortController()
  exit.abort()
  assert.equal(
    await waitForOwnedExit(() => true, 1000, 1, undefined, { exitSignal: exit.signal }),
    false,
  )
})

test('a continuation beyond the original deadline cannot dispatch discard before its timer runs', async (t) => {
  let now = 0,
    dispatched = false,
    querySignal
  t.mock.method(performance, 'now', () => now)
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const result = await waitForOwnedExit(
    () => true,
    15,
    1,
    async (signal, checkpoint) => {
      querySignal = signal
      now = 16
      // An I/O continuation is ready, but the timer has deliberately not fired.
      assert.equal(signal.aborted, false)
      checkpoint()
      dispatched = true
    },
  )
  assert.equal(result, false)
  assert.equal(dispatched, false)
  assert.equal(querySignal.aborted, true)
})

test('fallback awaits persisted identity rejection before considering any signal', async () => {
  let killed = false
  const current = {
    pid: 111,
    exitCode: null,
    signalCode: null,
    kill() {
      killed = true
      return true
    },
  }
  await assert.rejects(
    stopOwnedProductAfterFailure({
      current,
      expectedPid: 111,
      observeIdentity: async () => [],
      verifyIdentity: async () => {
        await Promise.resolve()
        throw Error('Identity path mismatch retained')
      },
    }),
    /Identity path mismatch retained/,
  )
  assert.equal(killed, false)
})

test('identity path comparison keeps Chinese characters and exposes mismatched code units', () => {
  const image = '/fixtures/安装 生命周期/milkup.exe'
  const row = {
    pid: 10,
    image,
    stillActive: true,
    creationFileTime: '133900000000000000',
    token: processToken(),
  }
  validateProcessIdentities([row], new Map([[10, image]]), sid, 2, new Map())
  assert.throws(
    () =>
      validateProcessIdentities(
        [{ ...row, image: '/fixtures/?? 生命周期/milkup.exe' }],
        new Map([[10, image]]),
        sid,
        2,
        new Map(),
      ),
    (error) => {
      assert.match(error.message, /Exact owned process image/)
      assert.equal(error.expected, path.resolve(image).replaceAll('\\', '/').toLowerCase())
      assert.equal(
        error.actual,
        path.resolve('/fixtures/?? 生命周期/milkup.exe').replaceAll('\\', '/').toLowerCase(),
      )
      return true
    },
  )
})

test('preview acceptance rejects missing modes, caret relocation and restart-dependent enable', () => {
  const good = {
    modeTransitions: [
      { mode: 'source', cursor: 35, images: 0 },
      { mode: 'preview', cursor: 35, images: 1 },
      { mode: 'live', cursor: 35, images: 0 },
    ],
    hotEnableWithoutRestart: true,
    previewReadonlyAfterHotEnable: true,
    markdownPreviewMarkersHidden: true,
    sourcePreserved: true,
  }
  validatePreviewModes(good)
  for (const change of [
    (v) => v.modeTransitions.pop(),
    (v) => (v.modeTransitions[1].cursor = 0),
    (v) => (v.modeTransitions[1].images = 0),
    (v) => (v.hotEnableWithoutRestart = false),
    (v) => (v.sourcePreserved = false),
  ]) {
    const bad = structuredClone(good)
    change(bad)
    assert.throws(() => validatePreviewModes(bad))
  }
})

test('old profile receipts require the real pinned baseline, same owned account and explicit choice', () => {
  const expected = {
    runId: 'owned-run',
    candidateSha: 'a'.repeat(40),
    sid: 'S-1-5-21-1-2-3-1003',
    sessionId: 2,
    choice: 'disabled',
  }
  const receipt = {
    status: 'passed',
    runId: expected.runId,
    candidateSha: expected.candidateSha,
    context: { actualSid: expected.sid, sessionId: 2 },
    applicationSha256: MIGRATION_BASELINE_SHA256,
    launches: [{ closedByUi: true }],
    migration: {
      phase: 'prepare',
      auditContract: 'shipped-beta9-preparation-only',
      choice: 'disabled',
      catalog: {
        pluginId: 'milkup.diagrams',
        enabled: false,
        verified: true,
        approved: true,
        sourcePath: 'bundled:milkup.diagrams-1.3.0.milkup-plugin',
        sha256: 'b'.repeat(64),
      },
    },
  }
  validateMigrationReceipt(receipt, expected)
  for (const change of [
    (r) => (r.status = 'failed'),
    (r) => (r.context.actualSid += '0'),
    (r) => (r.applicationSha256 = 'c'.repeat(64)),
    (r) => (r.launches[0].closedByUi = false),
    (r) => (r.migration.catalog.enabled = true),
    (r) => (r.migration.catalog.approved = false),
    (r) => (r.migration.catalog.sourcePath = 'C:/manual.milkup-plugin'),
  ]) {
    const bad = structuredClone(receipt)
    change(bad)
    assert.throws(() => validateMigrationReceipt(bad, expected))
  }
})

test('historical preparation audit is frozen and has no executable main', async () => {
  const { readFile } = await import('node:fs/promises')
  const { createHash } = await import('node:crypto')
  const source = await readFile(new URL('./mermaid-beta9-audit-fixture.mjs', import.meta.url))
  assert.equal(
    createHash('sha256').update(source).digest('hex'),
    '0752db907f7381e95a8f718555fd5f9a0a9edd291b5fd25cf899bca873fd38f1',
  )
  assert(!source.toString().includes('export async function main('))
  const old = await import('./mermaid-beta9-audit-fixture.mjs')
  assert.equal(typeof old.AuditLedger, 'function')
})

test('synthetic prior packages bind identity, preserve approvals and cannot impersonate historical evidence', () => {
  const expected = {
    runId: 'run',
    candidateSha: 'candidate',
    sid: 'isolated-sid',
    scenario: 'startup-failure',
    baselineReceiptSha256: 'a'.repeat(64),
    catalogPath: 'C:\\owned\\catalog-v1.json',
    contentSha256: 'b'.repeat(64),
    version: '1.3.0',
  }
  const before = {
    id: 'milkup.diagrams',
    enabled: true,
    tombstone: false,
    pending: null,
    startAttempt: null,
    active: {
      id: 'old',
      verified: true,
      approvedFingerprint: 'fingerprint',
      capabilityFingerprint: 'fingerprint',
      manifest: { version: '1.3.0' },
      contentSha256: expected.contentSha256,
      sourcePath: 'bundled:diagrams.milkup-plugin',
    },
  }
  const after = structuredClone(before)
  after.active.id = 'synthetic'
  after.active.contentSha256 = 'c'.repeat(64)
  after.previous = structuredClone(before.active)
  const fixture = {
    ...expected,
    status: 'passed',
    scope: 'synthetic-prior-approved-bundle-not-historical-release',
    catalogSha256: 'd'.repeat(64),
    before,
    after,
  }
  validateSyntheticMigrationFixture(fixture, expected)
  for (const mutate of [
    (f) => {
      f.scope = 'real-historical-release'
    },
    (f) => {
      f.sid = 'another-account'
    },
    (f) => {
      f.after.enabled = false
    },
    (f) => {
      f.after.active.contentSha256 = f.before.active.contentSha256
    },
    (f) => {
      f.after.active.manifest.version = '2.0.0'
    },
    (f) => {
      f.after.active.approvedFingerprint = null
    },
    (f) => {
      f.after.previous.id = 'unknown'
    },
    (f) => {
      f.after.active.sourcePath = 'local:untrusted'
    },
  ]) {
    const bad = structuredClone(fixture)
    mutate(bad)
    assert.throws(() => validateSyntheticMigrationFixture(bad, expected))
  }
})

test('unknown-grammar gate waits through an empty startup ledger and pending native work', async () => {
  let samples = 0
  const job = {
    requestId: 'owned',
    started: ownership,
    finished: { ...completion, successful: false, rendererErrorKind: 'unknown-diagram' },
  }
  const ledger = {
    pending: () => {
      samples++
      return samples === 2 ? 1 : 0
    },
    verifyAll: () => (samples >= 3 ? [job] : []),
  }
  assert.equal(
    await waitForUnknownGrammarRejection(ledger, 111, { timeoutMs: 1000, pollIntervalMs: 1 }),
    job,
  )
  assert(samples >= 3)
  await assert.rejects(
    waitForUnknownGrammarRejection({ pending: () => 0, verifyAll: () => [] }, 111, {
      timeoutMs: 5,
      pollIntervalMs: 1,
    }),
    /Timed out/,
  )
  for (const failed of [
    { ...job, started: undefined },
    { ...job, finished: { ...job.finished, deadlineExpired: true } },
    { ...job, finished: { ...job.finished, cancelled: true } },
    { ...job, finished: { ...job.finished, rendererErrorKind: 'other' } },
  ])
    await assert.rejects(
      waitForUnknownGrammarRejection({ pending: () => 0, verifyAll: () => [failed] }, 111),
      /timeout\/startup failure is not syntax acceptance/,
    )
})

test('product evidence retains every nested observation within the unchanged coordinator byte budget', () => {
  const record = {
    status: 'passed',
    steps: [{ before: { text: '中文😀\r\n', pixels: [0, 1, 255] }, after: { readonly: true } }],
    nativeAudit: [{ requestId: 'owned', phase: 'finished', resourceReleaseProven: true }],
    inputs: [{ key: '\\n' }],
  }
  assert.deepEqual(JSON.parse(serializeProductEvidence(record)), record)
  const exact = {
    data: 'x'.repeat(
      MAX_PRODUCT_REPORT_BYTES - Buffer.byteLength(serializeProductEvidence({ data: '' })),
    ),
  }
  assert.equal(Buffer.byteLength(serializeProductEvidence(exact)), MAX_PRODUCT_REPORT_BYTES)
  assert.throws(() => serializeProductEvidence({ data: exact.data + 'x' }), /1 MiB/)
  const multibyte = { data: '界'.repeat(Math.ceil(MAX_PRODUCT_REPORT_BYTES / 3)) }
  assert(JSON.stringify(multibyte).length < MAX_PRODUCT_REPORT_BYTES)
  assert.throws(() => serializeProductEvidence(multibyte), /1 MiB/)
})

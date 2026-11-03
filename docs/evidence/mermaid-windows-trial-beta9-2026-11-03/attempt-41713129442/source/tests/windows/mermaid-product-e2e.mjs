// Opt-in Windows product acceptance. This file does not install a Runtime, alter
// accounts/ACLs, invoke private IPC, inject editor actions, or claim IME/DPI tests.
// The reviewed standard-user wrapper must supply the closed environment below.
import assert from 'node:assert/strict'
import { spawn, execFile, execFileSync } from 'node:child_process'
import { promisify } from 'node:util'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile, lstat, readdir, realpath } from 'node:fs/promises'
import { createServer } from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { StringDecoder } from 'node:string_decoder'

export const fixtures = Object.freeze({
  ordinary: [
    '# Windows Mermaid 中文😀',
    '',
    '```mermaid',
    'flowchart LR',
    'A[Draft 草稿] --> B[Review 审阅]',
    '```',
    '',
    'Outside é 👩🏽‍💻',
    '',
  ].join('\r\n'),
  wide: [
    '# Windows wide Mermaid',
    '',
    '```mermaid',
    'flowchart LR',
    ...Array.from({ length: 16 }, (_, i) => `N${i + 1}[Stage ${i + 1} native width]`),
    ...Array.from({ length: 15 }, (_, i) => `N${i + 1} --> N${i + 2}`),
    '```',
    '',
    'Outside wide diagram',
    '',
  ].join('\n'),
  c4: [
    '# Windows C4',
    '',
    '```mermaid',
    'C4Component',
    'Component(parser, "Parser", "TypeScript", "Reads notes")',
    'Component(view, "View", "TypeScript", "Shows notes")',
    'Rel(parser, view, "Presents")',
    '```',
    '',
    'Outside C4 diagram',
    '',
  ].join('\n'),
  invalid: [
    '# Windows invalid Mermaid',
    '',
    '```mermaid',
    'unknownWindowsMermaidGrammar',
    'A --> B',
    '```',
    '',
    'Outside invalid diagram',
    '',
  ].join('\n'),
})
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex')

export const unwrapWebDriverValue = (response) =>
  response !== null && typeof response === 'object' && Object.hasOwn(response, 'value')
    ? response.value
    : response

const boundedResponse = (raw) => {
  const bytes = Buffer.from(raw)
  return {
    text: new StringDecoder('utf8').write(bytes.subarray(0, 2048)),
    bytes: bytes.length,
    sha256: sha(bytes),
    truncated: bytes.length > 2048,
  }
}

export function decodeWebDriverResponse(raw, httpStatus, observation) {
  const response = boundedResponse(raw)
  if (observation) Object.assign(observation, { httpStatus, response })
  const envelope = JSON.parse(raw)
  const value = unwrapWebDriverValue(envelope)
  const code = typeof value?.error === 'string' ? value.error : undefined
  if (httpStatus < 200 || httpStatus >= 300 || code) {
    const error = new Error(`WebDriver HTTP ${httpStatus}: ${response.text}`)
    error.webDriverErrorCode = code
    if (
      envelope !== null &&
      typeof envelope === 'object' &&
      Object.hasOwn(envelope, 'value') &&
      value !== null &&
      typeof value === 'object' &&
      Object.hasOwn(value, 'error')
    )
      error.webDriverValueErrorCode = code
    throw error
  }
  return value
}

// Only boolean true proves a visible unsaved dialog. Null and a protocol-level
// missing context are inconclusive observations during close, never exit proof.
export async function probeCloseConfirmation(record, read, successful, signal) {
  const evidence = (record.closeConfirmationProbes ??= {
    retainedLimit: 32,
    total: 0,
    omitted: 0,
    observations: [],
  })
  const row = {
    sequence: ++evidence.total,
    startedAt: new Date().toISOString(),
    decision: 'pending',
  }
  if (evidence.observations.length < evidence.retainedLimit) evidence.observations.push(row)
  else {
    if (evidence.lastObservation) evidence.omitted++
    evidence.lastObservation = row
  }
  try {
    const value = await read(row)
    row.valueType = value === null ? 'null' : typeof value
    if (typeof value === 'boolean' || value === null) row.value = value
    signal?.throwIfAborted()
    if (value === true) {
      row.decision = 'visible-unsaved-dialog'
      // Preserve the first decisive response even if routine later polls exceed
      // the sequential history budget. Omitted counts only that history.
      evidence.firstVisibleDialog ??= row
      if (successful) record.unexpectedUnsavedConfirmation = true
      return true
    }
    if (value === false) {
      row.decision = 'no-visible-unsaved-dialog'
      return false
    }
    if (value === null) {
      row.decision = 'null-result-awaiting-owned-exit'
      return null
    }
    row.decision = 'invalid-non-boolean-result'
    throw new Error('Close confirmation requires an actual boolean or null script result')
  } catch (error) {
    row.error = boundedResponse(String(error))
    if (signal?.aborted && error === signal.reason) row.decision = 'interrupted'
    else if (
      ['no such window', 'no such frame', 'invalid session id'].includes(
        error?.webDriverErrorCode,
      ) ||
      (record.teardown?.realUiCloseRequested === true &&
        row.httpStatus === 404 &&
        error?.webDriverValueErrorCode === 'target frame detached')
    ) {
      row.decision = 'closed-context-awaiting-owned-exit'
      row.webDriverErrorCode = error.webDriverErrorCode
      return null
    } else if (row.decision === 'pending') row.decision = 'probe-error'
    throw error
  } finally {
    row.finishedAt = new Date().toISOString()
  }
}

export function assertCleanCloseConfirmation(record) {
  assert.notEqual(
    record.unexpectedUnsavedConfirmation,
    true,
    'Successful test must not expose an actual unsaved close confirmation',
  )
}
const normalized = (value) => value.replaceAll('\\', '/').toLowerCase()
const samePath = (left, right) => normalized(path.resolve(left)) === normalized(path.resolve(right))
const within = (root, child) => {
  const relative = path.relative(root, child)
  return relative && !relative.startsWith('..') && !path.isAbsolute(relative)
}
const AUDIT_PREFIX = 'MILKUP_MERMAID_NATIVE_AUDIT '
const PLUGIN = 'milkup.diagrams'
const MAX_NATIVE_PNG = 262144
const MAX_SCREENSHOT = 8 * 1024 * 1024

export function crc32(bytes) {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
  }
  return (crc ^ 0xffffffff) >>> 0
}
// Structural validation supplements actual browser image decoding; it never
// substitutes a signature/metadata check for decoding the complete image.
export function validatePng(bytes, maxBytes = MAX_NATIVE_PNG) {
  assert(
    Buffer.isBuffer(bytes) && bytes.length >= 45 && bytes.length <= maxBytes,
    'PNG byte budget',
  )
  assert(
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
    'PNG signature',
  )
  let position = 8,
    header = false,
    data = false,
    endedData = false,
    end = false,
    width,
    height
  while (position < bytes.length) {
    assert(position + 12 <= bytes.length, 'Complete PNG chunk framing')
    const length = bytes.readUInt32BE(position),
      next = position + 12 + length
    assert(next <= bytes.length, 'Complete PNG chunk body and CRC')
    const kind = bytes.toString('ascii', position + 4, position + 8)
    assert(/^[A-Za-z]{2}[A-Z][A-Za-z]$/.test(kind), 'PNG chunk type')
    assert.equal(
      crc32(bytes.subarray(position + 4, next - 4)),
      bytes.readUInt32BE(next - 4),
      'PNG CRC',
    )
    assert(!['acTL', 'fcTL', 'fdAT'].includes(kind), 'Animated PNG rejected')
    if (kind === 'IHDR') {
      assert(!header && position === 8 && length === 13, 'Single initial IHDR')
      header = true
      width = bytes.readUInt32BE(position + 8)
      height = bytes.readUInt32BE(position + 12)
      assert(
        width > 0 && height > 0 && width <= 8192 && height <= 8192 && width * height <= 16777216,
        'PNG pixel budget',
      )
    } else if (kind === 'IDAT') {
      assert(header && !endedData, 'Consecutive image data after IHDR')
      data ||= length > 0
    } else if (kind === 'IEND') {
      assert(header && data && length === 0 && next === bytes.length, 'Terminal IEND at exact EOF')
      end = true
    } else if (kind === 'PLTE') {
      assert(
        header && !data && length > 0 && length <= 768 && length % 3 === 0,
        'Valid palette position/size',
      )
    } else {
      assert(header && /^[a-z]/.test(kind), 'Known critical PNG chunk')
      if (data) endedData = true
    }
    position = next
  }
  assert(end, 'Complete PNG IEND')
  return { width, height, bytes: bytes.length, sha256: sha(bytes), structuralValidation: true }
}

export function validateAccountKind(value) {
  assert(['pure-standard', 'filtered-admin'].includes(value), 'Explicit supported account kind')
  return value
}

const uint32 = (value) => Number.isSafeInteger(value) && value >= 0 && value <= 0xffffffff
const ordinaryPrivileges = new Set([
  'SeChangeNotifyPrivilege',
  'SeShutdownPrivilege',
  'SeUndockPrivilege',
  'SeIncreaseWorkingSetPrivilege',
  'SeTimeZonePrivilege',
])

const linkedAuthorityFields = [
  'callerThreadTokenAbsent',
  'callerThreadQueryWin32Error',
  'queryAttempted',
  'querySucceeded',
  'queryWin32Error',
  'targetTokenType',
  'targetImpersonationLevel',
  'targetQueryWin32Error',
].sort()

function validateLinkedAuthority(authority, elevationType) {
  assert(
    authority && typeof authority === 'object' && !Array.isArray(authority),
    'Complete linked-token authority evidence required',
  )
  assert.deepEqual(
    Object.keys(authority).sort(),
    linkedAuthorityFields,
    'Closed linked-token evidence fields',
  )
  assert.equal(authority.callerThreadTokenAbsent, true, 'Actual non-impersonating caller')
  assert.equal(authority.callerThreadQueryWin32Error, 1008, 'Observed ERROR_NO_TOKEN')
  assert.equal(authority.queryWin32Error, null, 'No failed linked-token query')
  assert.equal(authority.targetQueryWin32Error, null, 'No incomplete linked-target observation')
  if (elevationType === 1) {
    assert.equal(
      authority.queryAttempted,
      false,
      'Default token does not perform a linked-token query',
    )
    assert.equal(authority.querySucceeded, false)
    assert.equal(authority.targetTokenType, null)
    assert.equal(authority.targetImpersonationLevel, null)
  } else {
    assert.equal(elevationType, 3, 'Only Default or evidence-backed Limited sandbox tokens')
    assert.equal(authority.queryAttempted, true)
    assert.equal(authority.querySucceeded, true)
    // Returned handle access is not inferred from TOKEN_QUERY. Even a broad
    // grant does not substitute for the actual target type and level checks.
    assert.equal(authority.targetTokenType, 2, 'Linked target must be an impersonation token')
    assert.equal(
      authority.targetImpersonationLevel,
      1,
      'Identification-only linked target required',
    )
  }
}

function validateTokenAuthority(token, expectedSessionId, role, expectedAccountKind) {
  assert(token && typeof token === 'object', 'Actual token facts required')
  assert(
    Number.isSafeInteger(expectedSessionId) && expectedSessionId > 0,
    'Exact token session required',
  )
  assert.equal(token.tokenType, 1, 'Primary token required')
  assert.equal(token.sessionId, expectedSessionId, 'Exact token session')
  assert.equal(token.elevated, false, 'Elevated tokens remain unsupported')
  assert.equal(token.uiAccess, false)
  assert.equal(token.ownerIsUser, true)
  assert.equal(token.seDebugPrivilegePresent, false)
  assert(uint32(token.privilegeCount) && token.privilegeCount <= 64, 'Bounded privilege count')
  assert.equal(token.hostDisallowedPrivilegeCount, 0, 'No nonordinary present privileges')
  if (role === 'host') {
    assert.equal(token.integrityRid, 8192, 'Medium-integrity host')
    const filtered = expectedAccountKind === 'filtered-admin'
    assert.equal(token.elevationType, filtered ? 3 : 1)
    assert.equal(token.administratorsGroupPresentIncludingDenyOnly, filtered)
    assert.equal(token.administratorsGroupAttributes, filtered ? 16 : null)
  } else {
    assert(uint32(token.integrityRid) && token.integrityRid <= 4096, 'Low-integrity sandbox')
    validateLinkedAuthority(token.linkedAuthority, token.elevationType)
    assert.equal(typeof token.administratorsGroupPresentIncludingDenyOnly, 'boolean')
    assert.equal(
      token.administratorsGroupAttributes,
      token.administratorsGroupPresentIncludingDenyOnly ? 16 : null,
      'No enabled, owner or unknown Administrators flags in sandbox',
    )
  }
}

export function validateHostProcessToken(
  token,
  expectedSid,
  expectedSessionId,
  expectedAccountKind = 'pure-standard',
) {
  validateAccountKind(expectedAccountKind)
  validateTokenAuthority(token, expectedSessionId, 'host', expectedAccountKind)
  assert.equal(token.sid, expectedSid)
  assert.equal(token.ownerSid, expectedSid, 'Actual token owner remains login user')
  assert.equal(token.pureStandardUser, expectedAccountKind === 'pure-standard')
  assert.equal(token.filteredAdmin, expectedAccountKind === 'filtered-admin')
  assert.equal(token.privilegesComplete, true)
  assert(Array.isArray(token.privileges) && token.privileges.length === token.privilegeCount)
  const names = new Set()
  for (const privilege of token.privileges) {
    assert(
      ordinaryPrivileges.has(privilege.name),
      'Every present privilege must be ordinary, even disabled',
    )
    assert(!names.has(privilege.name), 'No duplicate privilege observations')
    names.add(privilege.name)
    assert(uint32(privilege.attributes), 'Actual privilege attributes required')
  }
}

export function validateContext(
  context,
  expectedSid,
  expectedSessionId,
  expectedAccountKind = 'pure-standard',
) {
  validateAccountKind(expectedAccountKind)
  assert.equal(context.status, 'ready', 'Account-context readiness')
  assert.equal(context.actualSid, expectedSid, 'Actual account actor SID')
  assert.equal(context.expectedSid, expectedSid)
  assert.equal(context.expectedAccountKind, expectedAccountKind)
  assert.equal(context.accountKindVerified, true)
  assert.equal(context.pureStandard, expectedAccountKind === 'pure-standard')
  assert.equal(context.filteredAdmin, expectedAccountKind === 'filtered-admin')
  assert.equal(context.interactive, true, 'Actual interactive desktop available')
  assert(
    Number.isSafeInteger(expectedSessionId) && expectedSessionId > 0,
    'Non-service Windows session',
  )
  assert.equal(context.sessionId, expectedSessionId)
  assert.equal(context.expectedSessionId, expectedSessionId)
  validateHostProcessToken(
    context.desktop?.token,
    expectedSid,
    expectedSessionId,
    expectedAccountKind,
  )
  assert.deepEqual(context.blockedReasons, [], 'No ignored preflight blockers')
  for (const key of ['profile', 'roamingAppData', 'localAppData'])
    assert(context.knownFolders?.[key], `Actual ${key}`)
  return context
}

export function validateProcessIdentities(
  values,
  expected,
  expectedSid,
  expectedSessionId,
  births,
  expectedAccountKind = 'pure-standard',
) {
  assert(
    Array.isArray(values) && values.length === expected.size,
    'Read-only identities for every owned process',
  )
  const seen = new Set()
  for (const value of values) {
    assert(
      expected.has(value.pid) && !seen.has(value.pid) && !value.error,
      'Unique expected process identity observation',
    )
    seen.add(value.pid)
    assert(samePath(value.image, expected.get(value.pid)), 'Exact owned process image')
    assert.equal(value.stillActive, true)
    validateHostProcessToken(value.token, expectedSid, expectedSessionId, expectedAccountKind)
    assert(
      typeof value.creationFileTime === 'string' && /^\d+$/.test(value.creationFileTime),
      'Exact process creation FILETIME string',
    )
    if (births.has(value.pid))
      assert.equal(value.creationFileTime, births.get(value.pid), 'PID was not reused')
    else births.set(value.pid, value.creationFileTime)
  }
  assert.deepEqual(
    [...seen].sort(),
    [...expected.keys()].sort(),
    'No missing owned process observation',
  )
}

export function isUnknownGrammarRejection(job) {
  return (
    !!job.started &&
    job.finished?.successful === false &&
    job.finished.cancelled === false &&
    job.finished.deadlineExpired === false &&
    job.finished.rendererErrorKind === 'unknown-diagram'
  )
}

// Catalog readiness is independent of document readiness. The card may be laid
// out below the scroll viewport; the real pointer helper reveals it before use.
export async function waitForPluginCard(
  readState,
  { timeoutMs = 30000, pollIntervalMs = 100, guard = () => {} } = {},
) {
  const deadline = performance.now() + timeoutMs
  let last
  while (performance.now() < deadline) {
    guard()
    last = await readState()
    const card = last.cards?.find((item) => item.id === PLUGIN)
    if (
      card &&
      card.rect?.width > 0 &&
      card.rect?.height > 0 &&
      card.switchRect?.width > 0 &&
      card.switchRect?.height > 0 &&
      ['true', 'false'].includes(card.checked) &&
      card.busy !== 'true' &&
      card.switchDisabled === false &&
      card.ariaDisabled !== 'true'
    )
      return { card, state: last }
    const remaining = deadline - performance.now()
    if (remaining > 0) await delay(Math.min(pollIntervalMs, remaining))
  }
  const diagnostic = {
    menu: last?.menu,
    cards: last?.cards
      ?.slice(0, 64)
      .map(({ id, checked, busy, visible, rect, switchRect, switchDisabled, ariaDisabled }) => ({
        id,
        checked,
        busy,
        visible,
        rect,
        switchRect,
        switchDisabled,
        ariaDisabled,
      })),
    applicationNotices: last?.applicationNotices,
    pluginText: last?.pluginText?.slice(0, 4000),
  }
  throw Error(
    `Timed out waiting for laid-out nonbusy ${PLUGIN} card: ${JSON.stringify(diagnostic)}`,
  )
}

const pluginVersion = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/
function validateExpectedPluginInventory(inventory) {
  assert(Array.isArray(inventory) && inventory.length > 0 && inventory.length <= 64)
  for (const entry of inventory) {
    assert(
      entry && typeof entry.id === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(entry.id),
    )
    assert(
      typeof entry.version === 'string' &&
        entry.version.length <= 128 &&
        pluginVersion.test(entry.version),
    )
  }
  assert.equal(
    new Set(inventory.map(({ id }) => id)).size,
    inventory.length,
    'Unique expected plugin IDs',
  )
  return inventory
}

export function parseExpectedPluginInventory(raw) {
  if (raw === undefined) return null
  assert(
    typeof raw === 'string' && raw.length > 0 && raw.length <= 16384,
    'Bounded plugin inventory JSON required',
  )
  return validateExpectedPluginInventory(JSON.parse(raw))
}

// Read only public card text. Missing versions/layouts and busy cards are still
// pending; explicit identity, version or enabled-state mismatches cannot pass.
export function inspectBundledPluginInventory(cards, inventory) {
  validateExpectedPluginInventory(inventory)
  assert(Array.isArray(cards), 'Observed plugin cards required')
  const expected = new Map(inventory.map(({ id, version }) => [id, version]))
  assert.equal(new Set(cards.map(({ id }) => id)).size, cards.length, 'Unique observed plugin IDs')
  let pending = cards.length !== inventory.length
  const observed = cards.map((card) => {
    assert(expected.has(card.id), 'Unexpected bundled plugin: ' + card.id)
    assert.equal(card.checked, 'false', 'Fresh bundled plugin must be disabled: ' + card.id)
    assert([null, 'false', 'true'].includes(card.busy), 'Observed plugin busy state required')
    const versionText = card.availableVersionText
    assert(
      versionText == null || typeof versionText === 'string',
      'Observed plugin version text required',
    )
    const prefix = versionText?.match(/^(\S+) · /)?.[1]
    if (versionText?.trim())
      assert(
        prefix && pluginVersion.test(prefix),
        'Unexpected public plugin version text: ' + card.id,
      )
    const version = prefix ?? null
    if (version !== null)
      assert.equal(version, expected.get(card.id), 'Bundled plugin version mismatch: ' + card.id)
    if (
      version === null ||
      card.busy === 'true' ||
      !Number.isFinite(card.rect?.width) ||
      card.rect.width <= 0 ||
      !Number.isFinite(card.rect?.height) ||
      card.rect.height <= 0
    )
      pending = true
    return { id: card.id, version, checked: card.checked, busy: card.busy }
  })
  if (pending) return null
  assert.deepEqual(
    cards.map(({ id }) => id).sort(),
    [...expected.keys()].sort(),
    'Exact bundled plugin inventory',
  )
  return observed
}

export async function waitForBundledPluginInventory(
  readState,
  inventory,
  { timeoutMs = 30000, pollIntervalMs = 100, guard = () => {} } = {},
) {
  validateExpectedPluginInventory(inventory)
  const deadline = performance.now() + timeoutMs
  let last
  while (performance.now() < deadline) {
    guard()
    last = await readState()
    const observed = inspectBundledPluginInventory(last.cards, inventory)
    if (observed) return { observed, state: last }
    const remaining = deadline - performance.now()
    if (remaining > 0) await delay(Math.min(pollIntervalMs, remaining))
  }
  throw Error(
    'Timed out waiting for complete disabled bundled plugin inventory: ' +
      JSON.stringify({
        expected: inventory,
        cards: last?.cards
          ?.slice(0, 64)
          .map(({ id, availableVersionText, checked, busy, rect, visible }) => ({
            id,
            availableVersionText: availableVersionText?.slice(0, 200),
            checked,
            busy,
            rect,
            visible,
          })),
        applicationNotices: last?.applicationNotices,
      }),
  )
}

export function validateCardReflow(before, after, targetId = PLUGIN, tolerance = 1) {
  assert.deepEqual(
    after.map((card) => card.id),
    before.map((card) => card.id),
    'Plugin cards retain full identity order',
  )
  assert.equal(new Set(before.map((card) => card.id)).size, before.length, 'Unique plugin cards')
  const target = before.findIndex((card) => card.id === targetId)
  assert(target >= 0, 'Target plugin card exists')
  let precedingHeightDelta = 0
  const rows = before.map((previous, index) => {
    const next = after[index]
    for (const bounds of [previous.rect, next.rect]) {
      assert(
        bounds &&
          ['x', 'y', 'width', 'height'].every((key) => Number.isFinite(bounds[key])) &&
          bounds.width > 0 &&
          bounds.height > 0,
        'Laid-out card geometry',
      )
    }
    const expectedTop = previous.rect.y + precedingHeightDelta
    assert(
      Math.abs(next.rect.y - expectedTop) <= tolerance,
      `Card ${previous.id} follows predecessor height changes: expected ${expectedTop}, got ${next.rect.y}`,
    )
    assert(
      Math.abs(next.rect.x - previous.rect.x) <= tolerance &&
        Math.abs(next.rect.width - previous.rect.width) <= tolerance,
      'Plugin card horizontal anchor and width retained',
    )
    if (index === target)
      assert(
        Math.abs(next.rect.y - previous.rect.y) <= tolerance,
        'Toggled card retains its top anchor',
      )
    const heightDelta = next.rect.height - previous.rect.height
    precedingHeightDelta += heightDelta
    return { id: previous.id, expectedTop, actualTop: next.rect.y, heightDelta }
  })
  return { targetId, targetTop: after[target].rect.y, rows }
}

export async function waitForNativeJobs(
  ledger,
  productPid,
  isAlive,
  { timeoutMs = 45000, pollIntervalMs = 100 } = {},
) {
  const deadline = performance.now() + timeoutMs
  while (ledger.pending(productPid) > 0) {
    assert(isAlive(), 'Product exited before admitted native jobs completed')
    const remaining = deadline - performance.now()
    assert(
      remaining > 0,
      'Timed out draining admitted native jobs; inner cleanup remains unverified',
    )
    await delay(Math.min(pollIntervalMs, remaining))
  }
  return ledger.verifyAll(productPid)
}

export async function waitForOwnedExit(
  isAlive,
  timeoutMs,
  pollIntervalMs = 100,
  whileWaiting,
  { exitedAt = () => undefined, exitSignal } = {},
) {
  const deadline = performance.now() + timeoutMs
  const controller = new AbortController()
  const signal = exitSignal ? AbortSignal.any([controller.signal, exitSignal]) : controller.signal
  let stopped
  const interruption = new Promise((resolve) => {
    stopped = resolve
    if (signal.aborted) resolve()
    else signal.addEventListener('abort', stopped, { once: true })
  })
  const timer = setTimeout(() => controller.abort(), Math.max(0, timeoutMs))
  const checkpoint = () => {
    // Timer delivery may lag a ready I/O continuation. Never dispatch another
    // observation or discard action merely because its timer has not run yet.
    if (performance.now() >= deadline) controller.abort()
    signal.throwIfAborted()
  }
  const result = () => {
    const observedExit = exitedAt()
    // Use the directly spawned child's exit-event timestamp, not the time a
    // closing WebDriver query eventually returns. A late exit remains a failure.
    if (observedExit !== undefined) {
      assert(Number.isFinite(observedExit), 'Monotonic owned exit timestamp required')
      return observedExit <= deadline
    }
    if (!isAlive()) return performance.now() <= deadline
    if (performance.now() >= deadline || signal.aborted) return false
    return undefined
  }
  try {
    for (;;) {
      let outcome = result()
      if (outcome !== undefined) return outcome
      if (whileWaiting) {
        try {
          await Promise.race([whileWaiting(signal, checkpoint), interruption])
        } catch (error) {
          if (!signal.aborted || error !== signal.reason) throw error
        }
      }
      outcome = result()
      if (outcome !== undefined) return outcome
      await Promise.race([
        delay(Math.min(pollIntervalMs, Math.max(0, deadline - performance.now()))),
        interruption,
      ])
    }
  } finally {
    clearTimeout(timer)
    signal.removeEventListener('abort', stopped)
    controller.abort()
  }
}

// Only the directly spawned ChildProcess can prove it exited during fallback.
// A missing PID in the observer snapshot is never exit evidence or kill authority.
export async function stopOwnedProductAfterFailure({
  current,
  expectedPid,
  observeIdentity,
  verifyIdentity,
}) {
  assert.equal(current.pid, expectedPid, 'Fallback retains the exact owned product')
  const isAlive = () => current.exitCode === null && current.signalCode === null
  const alreadyExited = (error) => ({
    exactOwnedProcessAlreadyExited: true,
    exitCode: current.exitCode,
    signal: current.signalCode,
    forcedTermination: false,
    innerCleanupAcceptance: false,
    ...(error ? { identityObservationError: boundedResponse(String(error)) } : {}),
  })
  if (!isAlive()) return alreadyExited()
  let observation
  try {
    observation = await observeIdentity()
  } catch (error) {
    if (isAlive()) throw error
    return alreadyExited(error)
  }
  if (!isAlive()) return alreadyExited()
  verifyIdentity(observation)
  assert.equal(current.pid, expectedPid, 'Fallback still holds the exact owned product')
  assert(isAlive(), 'Exact owned product remains active')
  assert(current.kill(), 'Signal only the identity-verified owned product')
  assert(await waitForOwnedExit(isAlive, 5000), 'Owned product stops after bounded fallback')
  return { exactOwnedProcessStopped: true, forcedTermination: true, innerCleanupAcceptance: false }
}

// Both successful and failed test paths give admitted native jobs a bounded
// opportunity to finish. Errors are accumulated, never replaced by outer kill.
export async function settleOwnedProduct({
  record,
  isAlive,
  drainNative,
  closeUi,
  waitForExit,
  forceStop,
  drainStdio,
  verifyExit,
  verifyNative,
  detach,
}) {
  const errors = []
  record.phases = []
  const attempt = async (phase, operation) => {
    const row = { phase, startedAt: new Date().toISOString() }
    record.phases.push(row)
    try {
      row.result = await operation()
      row.ok = true
      return row.result
    } catch (error) {
      row.ok = false
      row.error = String(error)
      errors.push(new Error(`${phase}: ${error}`, { cause: error }))
    } finally {
      row.finishedAt = new Date().toISOString()
    }
  }
  await attempt('native-drain', drainNative)
  if (isAlive()) {
    record.uiCloseAttempted = true
    const requested = await attempt('ui-close', closeUi)
    record.realUiCloseRequested = requested?.realUiCloseRequested === true
    const exited = await attempt('ui-exit-wait', waitForExit)
    if (exited !== true) {
      record.uiExitWaitFailed = true
      if (exited === false) {
        record.uiExitDeadlineUnmet = true
        errors.push(
          new Error(
            'Owned product did not exit within the UI-close deadline; forced termination is not inner cleanup acceptance',
          ),
        )
      } else if (record.phases.at(-1).ok) {
        errors.push(new Error('UI-close observation did not confirm the owned process exit'))
      }
      if (isAlive()) {
        record.outerTerminationRequired = true
        await attempt('owned-process-fallback', forceStop)
      }
    }
  }
  await attempt('stdio-drain', drainStdio)
  const normalExit = await attempt('normal-exit', verifyExit)
  record.closedByUi =
    record.realUiCloseRequested === true &&
    normalExit === true &&
    !record.uiExitWaitFailed &&
    !record.uiExitDeadlineUnmet &&
    !record.outerTerminationRequired
  await attempt('native-final-verification', verifyNative)
  await attempt('webdriver-detach', detach)
  record.errors = errors.map((error) => error.message)
  if (errors.length) throw new AggregateError(errors, record.errors.join('; '))
  return record
}

export class AuditLedger {
  constructor(expectedSid, expectedSessionId, expectedAccountKind = 'pure-standard') {
    this.expectedSid = expectedSid
    assert(
      Number.isSafeInteger(expectedSessionId) && expectedSessionId > 0,
      'Exact native actor session required',
    )
    this.expectedSessionId = expectedSessionId
    this.expectedAccountKind = validateAccountKind(expectedAccountKind)
    this.jobs = new Map()
    this.events = []
  }
  accept(value, productPid) {
    assert(
      value && ['admitted', 'started', 'finished'].includes(value.phase),
      'Known native audit phase',
    )
    assert.equal(value.productPid, productPid, 'Audit belongs to this directly spawned product PID')
    assert(/^[A-Za-z0-9_-]{1,80}$/.test(value.requestId), 'Bounded audit request identity')
    assert(this.events.length < 512, 'Native audit event budget')
    const key = `${productPid}:${value.requestId}`
    const job = this.jobs.get(key) ?? { productPid, requestId: value.requestId }
    assert(!job[value.phase], 'No duplicate native audit phase')
    assert(!job.finished, 'No audit event after native completion')
    if (value.phase !== 'admitted')
      assert(job.admitted, 'Native admission precedes ownership/completion')
    if (value.phase === 'started') this.verifyOwnership(value)
    job[value.phase] = value
    this.jobs.set(key, job)
    this.events.push(value)
    return job
  }
  verifyHost(value) {
    assert.equal(value.hostSid, this.expectedSid)
    assert.equal(value.hostPureStandard, this.expectedAccountKind === 'pure-standard')
    assert.equal(value.hostTokenClass, this.expectedAccountKind)
    assert.equal(value.hostNonElevatedVerified, true)
    this.verifyToken(value.hostTokenEvidence, 'host')
  }
  verifyToken(token, role) {
    validateTokenAuthority(token, this.expectedSessionId, role, this.expectedAccountKind)
    assert(
      uint32(token.sandboxDisallowedPrivilegeCount) &&
        token.sandboxDisallowedPrivilegeCount <= token.privilegeCount,
    )
    if (role === 'host')
      assert.equal(
        token.linkedAuthority,
        null,
        'Host evidence does not claim a sandbox linked-token proof',
      )
    else
      assert.equal(
        token.sandboxDisallowedPrivilegeCount,
        0,
        'Only change-notify and increase-working-set privileges in sandbox',
      )
  }
  verifyAppContainer(value, role) {
    assert(
      typeof value.appContainerSid === 'string' &&
        /^S-1-15-2-(?:\d+-){6}\d+$/.test(value.appContainerSid) &&
        value.appContainerSid
          .slice(9)
          .split('-')
          .every((part) => uint32(Number(part)) && String(Number(part)) === part),
      'Actual bounded fresh AppContainer SID',
    )
    assert.equal(
      value[`${role}AppContainerSid`],
      value.appContainerSid,
      'Exact fresh AppContainer identity',
    )
    this.verifyToken(value[`${role}TokenEvidence`], role)
  }
  verifyParentBrowser(value) {
    assert.equal(value.browserSid, this.expectedSid, 'Same-login parent-observed browser')
    for (const field of ['browserAppContainer', 'browserZeroCapabilities', 'browserInOwnedJob'])
      assert.equal(value[field], true, `Parent-observed ${field}`)
    this.verifyAppContainer(value, 'browser')
    assert(uint32(value.browserPid) && value.browserPid > 0, 'Observed browser PID')
    assert.notEqual(value.browserPid, value.helperPid, 'Browser is distinct from helper')
    assert.notEqual(value.browserPid, value.productPid, 'Browser is distinct from product')
  }
  verifyOwnership(value) {
    this.verifyHost(value)
    for (const field of [
      'hostSid',
      'childSid',
      'browserSid',
      'helperSelfSid',
      'browserFromHelperSid',
    ])
      assert.equal(value[field], this.expectedSid, `Same-login ${field}`)
    for (const field of [
      'appContainer',
      'zeroCapabilities',
      'browserAppContainer',
      'browserZeroCapabilities',
      'browserInOwnedJob',
      'helperNativeProofVerified',
      'helperProtocolHandlesNonInheritable',
    ]) {
      assert.equal(value[field], true, `Native ${field}`)
    }
    this.verifyAppContainer(value, 'child')
    this.verifyAppContainer(value, 'browser')
    this.verifyAppContainer(value, 'helperSelf')
    this.verifyAppContainer(value, 'browserFromHelper')
    assert(uint32(value.browserPid) && value.browserPid > 0, 'Observed browser PID')
    assert(uint32(value.helperPid) && value.helperPid > 0, 'Observed held helper PID')
    assert.notEqual(value.helperPid, value.productPid, 'Helper is distinct from product')
    assert.notEqual(value.browserPid, value.helperPid, 'Browser is distinct from helper')
    assert.notEqual(value.browserPid, value.productPid, 'Browser is distinct from product')
    assert.equal(value.helperSelfObserverPid, value.helperPid)
    assert.equal(value.helperSelfSubjectPid, value.helperPid)
    assert.equal(value.browserFromHelperObserverPid, value.helperPid)
    assert.equal(value.browserFromHelperSubjectPid, value.browserPid)
  }
  verifyFinished(job) {
    const finish = job.finished
    assert(finish, 'Native completion audit required; outer process termination is insufficient')
    this.verifyHost(finish)
    for (const field of [
      'successful',
      'ownedJobCreated',
      'profileCreated',
      'cancelled',
      'deadlineExpired',
    ]) {
      assert.equal(typeof finish[field], 'boolean', `Explicit ${field}`)
    }
    assert.equal(finish.cleanupUncertain, false, 'Native cleanup certainty')
    assert.equal(finish.ipcThreadsCompleted, true, 'Native IPC threads completed')
    assert.equal(finish.privateTreeRemoved, true, 'Native private tree removed')
    if (finish.profileCreated)
      assert.equal(finish.profileDeleted, true, 'Native AppContainer profile deleted')
    if (finish.ownedJobCreated) assert.equal(finish.jobActiveAfterStop, 0, 'Owned native Job empty')
    else
      assert(
        finish.jobActiveAfterStop === null || finish.jobActiveAfterStop === 0,
        'No uncreated Job members',
      )
    assert(Array.isArray(finish.ownedPidsBeforeStop) && finish.ownedPidsBeforeStop.length <= 16)
    assert(finish.ownedPidsBeforeStop.every((pid) => Number.isSafeInteger(pid) && pid > 0))
    assert.equal(new Set(finish.ownedPidsBeforeStop).size, finish.ownedPidsBeforeStop.length)
    if (!finish.ownedJobCreated) {
      assert.deepEqual(finish.ownedPidsBeforeStop, [], 'Uncreated Job has no owned PIDs')
      for (const field of ['childSid', 'browserSid', 'browserPid', 'helperPid'])
        assert.equal(finish[field], null, 'No identity for an uncreated helper/browser')
      for (const field of [
        'childTokenEvidence',
        'browserTokenEvidence',
        'childAppContainerSid',
        'browserAppContainerSid',
      ])
        assert.equal(finish[field], null, 'No token evidence for an uncreated helper/browser')
      for (const field of [
        'appContainer',
        'zeroCapabilities',
        'browserAppContainer',
        'browserZeroCapabilities',
        'browserInOwnedJob',
      ])
        assert.equal(finish[field], false, 'No ownership claims for an uncreated helper/browser')
    }
    if (!job.started && (finish.cancelled || finish.deadlineExpired)) {
      assert.equal(
        finish.helperNativeProofVerified,
        false,
        'No trusted native ready proof before ownership audit',
      )
      for (const field of [
        'helperProtocolHandlesNonInheritable',
        'helperSelfTokenEvidence',
        'browserFromHelperTokenEvidence',
        'helperSelfSid',
        'browserFromHelperSid',
        'helperSelfAppContainerSid',
        'browserFromHelperAppContainerSid',
        'helperSelfObserverPid',
        'helperSelfSubjectPid',
        'browserFromHelperObserverPid',
        'browserFromHelperSubjectPid',
      ])
        assert.equal(finish[field], null, 'No fabricated helper-native proof before ready')
    }
    if (job.started || finish.successful || (!finish.cancelled && !finish.deadlineExpired)) {
      assert(job.started, 'Rendering requires actual ready/ownership audit')
      this.verifyOwnership(finish)
      assert.equal(
        finish.appContainerSid,
        job.started.appContainerSid,
        'Native profile identity retained through cleanup',
      )
      assert.equal(finish.browserPid, job.started.browserPid)
      assert.equal(finish.helperPid, job.started.helperPid)
      assert.equal(finish.ownedJobCreated, true)
      assert.equal(finish.profileCreated, true)
    } else if (finish.ownedJobCreated) {
      assert(
        uint32(finish.helperPid) && finish.helperPid > 0,
        'Canceled owned helper retains actual PID',
      )
      assert.notEqual(finish.helperPid, finish.productPid, 'Owned helper is distinct from product')
      assert.equal(finish.childSid, this.expectedSid)
      assert.equal(finish.appContainer, true)
      assert.equal(finish.zeroCapabilities, true)
      this.verifyAppContainer(finish, 'child')
      // A checkpoint may cancel after parent observation but before native
      // helper proofs are published. Validate those parent facts without
      // treating them as a ready renderer or substituting for self-observation.
      if (finish.browserSid !== null) this.verifyParentBrowser(finish)
    }
    if (finish.successful) {
      assert.equal(finish.cancelled, false)
      assert.equal(finish.deadlineExpired, false)
      assert(/^[a-f0-9]{64}$/.test(finish.pngSha256))
      assert(
        Number.isSafeInteger(finish.pngBytes) &&
          finish.pngBytes > 0 &&
          finish.pngBytes <= MAX_NATIVE_PNG,
      )
    }
    return finish
  }
  pending(productPid) {
    return [...this.jobs.values()].filter((job) => job.productPid === productPid && !job.finished)
      .length
  }
  verifyAll(productPid) {
    const jobs = [...this.jobs.values()].filter(
      (job) => productPid === undefined || job.productPid === productPid,
    )
    for (const job of jobs) this.verifyFinished(job)
    return jobs
  }
  matchPng(productPid, png) {
    const job = [...this.jobs.values()].find(
      (item) =>
        item.productPid === productPid &&
        item.finished?.successful &&
        item.finished.pngSha256 === png.sha256 &&
        item.finished.pngBytes === png.bytes,
    )
    assert(job, 'Accepted DOM PNG must match a completed owned native render')
    this.verifyFinished(job)
    return { productPid, requestId: job.requestId, pngSha256: png.sha256 }
  }
}

export const observe = `
const editor=document.querySelector('.milkup-editor'),rect=e=>e?.getBoundingClientRect().toJSON()??null;
const visible=e=>{if(!e)return false;const r=e.getBoundingClientRect(),s=getComputedStyle(e);return s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0&&r.bottom>0&&r.top<innerHeight&&r.right>0&&r.left<innerWidth};
const text=s=>document.querySelector(s)?.textContent??null;
return {url:location.href,protocol:location.protocol,hostname:location.hostname,userAgent:navigator.userAgent,devicePixelRatio,
 path:text('[data-stat="path"]')??(text('[data-title-path]')+'/'+text('[data-title]')+'.md'),loading:document.querySelector('#app')?.dataset.loading,
 version:Number(text('[data-stat="version"]')),saving:document.querySelector('#app')?.dataset.saving==='true',dirty:!!document.querySelector('[data-save-dot]')?.classList.contains('is-dirty'),
 mode:editor?.dataset.mode,editor:rect(editor),cursor:Number(document.querySelector('.milkup-cursor')?.dataset.position),visibility:document.visibilityState,
 editorFocused:!!document.activeElement?.matches('.milkup-input-proxy'),menu:visible(document.querySelector('[data-app-menu]')),
 developmentProbe:typeof window.__searchProbe,diagnostics:typeof window.__productionDiagnostics,
 images:[...document.querySelectorAll('[data-document-presentation] img')].map(e=>({src:e.currentSrc,complete:e.complete,naturalWidth:e.naturalWidth,naturalHeight:e.naturalHeight,rect:rect(e),visible:visible(e),alt:e.alt})),
 vectorCount:document.querySelectorAll('[data-document-presentation] svg').length,
 source:[...document.querySelectorAll('.milkup-line,.milkup-code-source')].map(e=>({text:e.textContent,visible:visible(e)&&!e.classList.contains('milkup-marker-hidden'),rect:rect(e)})),
 notices:[...document.querySelectorAll('[data-document-presentation-notice]')].map(e=>({text:e.textContent,visible:visible(e)})),
 cards:[...document.querySelectorAll('.plugin-summary-card[data-plugin-id]')].map(e=>{const toggle=e.querySelector('[role="switch"]');return {id:e.dataset.pluginId,text:e.textContent,availableVersionText:e.querySelector('.plugin-card-update')?.textContent??null,checked:toggle?.getAttribute('aria-checked'),busy:toggle?.getAttribute('aria-busy'),ariaDisabled:toggle?.getAttribute('aria-disabled'),switchDisabled:!!toggle?.disabled,switchRect:rect(toggle),visible:visible(e),switchVisible:visible(toggle),rect:rect(e)}}),
 applicationNotices:[...document.querySelectorAll('[data-notice]')].map(e=>({text:e.textContent?.slice(0,2000),visible:visible(e)})),
 pluginText:document.querySelector('.plugin-manager')?.textContent??document.querySelector('[data-plugin-manager]')?.textContent};`

// These asynchronous observations only read accepted DOM images or decode a
// supplied screenshot in a detached canvas. No editor DOM or application state
// is changed, and there is no access to an application bridge or private IPC.
export const decodeScript = `
const supplied=arguments[0],done=arguments[arguments.length-1];
(async()=>{
 let blob,source=null;
 if(supplied){const raw=atob(supplied),bytes=Uint8Array.from(raw,c=>c.charCodeAt(0));blob=new Blob([bytes],{type:'image/png'})}
 else{const images=[...document.querySelectorAll('[data-document-presentation] img')];if(images.length!==1)throw Error('Exactly one accepted diagram required');const image=images.find(e=>e.complete&&e.naturalWidth>0);if(!image||!image.currentSrc.startsWith('blob:'))throw Error('No accepted Blob image');await image.decode();source=image.currentSrc;blob=await(await fetch(source)).blob()}
 if(blob.type!=='image/png'||blob.size>8388608)throw Error('PNG transport budget/MIME');
 const bytes=new Uint8Array(await blob.arrayBuffer());const bitmap=await createImageBitmap(blob);
 try{if(!bitmap.width||!bitmap.height||bitmap.width>8192||bitmap.height>8192||bitmap.width*bitmap.height>16777216)throw Error('Decoded pixel budget');
 const canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;
 const context=canvas.getContext('2d',{willReadFrequently:true});if(!context)throw Error('Canvas unavailable');context.drawImage(bitmap,0,0);
 const pixels=context.getImageData(0,0,bitmap.width,bitmap.height).data;let nonuniform=false;
 for(let offset=4;offset<pixels.length;offset+=4)if(pixels[offset]!==pixels[0]||pixels[offset+1]!==pixels[1]||pixels[offset+2]!==pixels[2]||pixels[offset+3]!==pixels[3]){nonuniform=true;break}
 if(!nonuniform)throw Error('Uniform decoded image');
 const pixelSha256=[...new Uint8Array(await crypto.subtle.digest('SHA-256',pixels))].map(v=>v.toString(16).padStart(2,'0')).join('');
 let binary='';for(let offset=0;offset<bytes.length;offset+=32768)binary+=String.fromCharCode(...bytes.subarray(offset,offset+32768));
 return {source,width:bitmap.width,height:bitmap.height,fullyDecoded:true,nonuniform,pixelSha256,base64:btoa(binary)};
 }finally{bitmap.close()}
})().then(value=>done({ok:true,value}),error=>done({ok:false,error:String(error)}));`

async function freePort() {
  const server = createServer()
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const port = server.address().port
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  )
  return port
}
async function noLinks(file) {
  for (let current = path.resolve(file); ; current = path.dirname(current)) {
    const stat = await lstat(current)
    assert(!stat.isSymbolicLink(), `No symlink/reparse path: ${current}`)
    if (path.dirname(current) === current) break
  }
  assert(samePath(await realpath(file), file), 'Canonical input path')
}

export async function main() {
  assert.equal(
    process.platform,
    'win32',
    'Windows production acceptance only; local unit tests do not call main',
  )
  const required = (suffix) => {
    const key = `MILKUP_WINDOWS_MERMAID_${suffix}`
    assert(process.env[key], `Missing ${key}`)
    return process.env[key]
  }
  const application = path.resolve(required('APP')),
    edgeDriver = path.resolve(required('EDGE_DRIVER'))
  const work = path.resolve(required('WORK')),
    evidence = path.resolve(required('EVIDENCE'))
  const expectedSid = required('EXPECTED_SID'),
    expectedSessionId = Number(required('EXPECTED_SESSION_ID'))
  const expectedAccountKind = validateAccountKind(
    process.env.MILKUP_WINDOWS_MERMAID_EXPECTED_ACCOUNT_KIND ?? 'pure-standard',
  )
  const runId = required('RUN_ID'),
    candidateSha = required('CANDIDATE_SHA')
  const processObserver = path.resolve(required('PROCESS_OBSERVER')),
    pwsh = path.resolve(required('PWSH'))
  const expectedBinarySha = required('APP_SHA256'),
    runtimeVersion = required('RUNTIME_VERSION'),
    runtimeExe = path.resolve(required('RUNTIME_EXE'))
  const expectedPluginInventory = parseExpectedPluginInventory(
    process.env.MILKUP_WINDOWS_MERMAID_EXPECTED_PLUGIN_INVENTORY,
  )
  assert(/^[A-Za-z0-9_-]{1,80}$/.test(runId) && /^[a-f0-9]{40}$/.test(candidateSha))
  assert(/^[a-f0-9]{64}$/.test(expectedBinarySha) && /^\d+\.\d+\.\d+\.\d+$/.test(runtimeVersion))
  for (const file of [application, edgeDriver, runtimeExe, processObserver, pwsh, work, evidence])
    await noLinks(file)
  const contextBytes = await readFile(path.join(evidence, 'standard-context.json'))
  const context = validateContext(
    JSON.parse(contextBytes.toString('utf8').replace(/^\uFEFF/, '')),
    expectedSid,
    expectedSessionId,
    expectedAccountKind,
  )
  assert(samePath(context.work, work) && samePath(context.evidence, evidence))
  assert(within(context.scratchRoot, work) && within(context.scratchRoot, evidence))
  for (const [environment, field] of [
    ['USERPROFILE', 'profile'],
    ['APPDATA', 'roamingAppData'],
    ['LOCALAPPDATA', 'localAppData'],
  ]) {
    assert(
      process.env[environment] && samePath(process.env[environment], context.knownFolders[field]),
      `Real ${environment}; no forged known-folder environment`,
    )
  }
  const whoami = execFileSync(
    path.join(process.env.SystemRoot, 'System32', 'whoami.exe'),
    ['/user', '/fo', 'csv', '/nh'],
    { encoding: 'utf8', windowsHide: true, timeout: 10000 },
  )
  assert.equal(whoami.match(/S-1-\d+(?:-\d+)+/i)?.[0], expectedSid, 'Node current token SID')
  assert.equal(sha(await readFile(application)), expectedBinarySha, 'Frozen exact candidate binary')
  const fixtureRoot = path.join(work, 'fixtures'),
    profileRoot = path.join(work, 'webview-profiles')
  await mkdir(fixtureRoot)
  await mkdir(profileRoot) // Never reuse or erase another run.
  const productData = [
    ...new Set([context.knownFolders.roamingAppData, context.knownFolders.localAppData]),
  ].map((root) => path.join(root, 'app.milkup.desktop'))
  for (const directory of productData) {
    const entries = await readdir(directory).catch((error) => {
      if (error.code === 'ENOENT') return []
      throw error
    })
    assert.equal(entries.length, 0, 'Refuse an existing product profile: ' + directory)
  }
  const files = Object.fromEntries(
    Object.entries(fixtures).map(([name, source]) => [
      name,
      { path: path.join(fixtureRoot, `${name}-中文.md`), bytes: Buffer.from(source) },
    ]),
  )
  for (const [name, { path: file, bytes }] of Object.entries(files)) {
    await writeFile(file, bytes, { flag: 'wx' })
    await writeFile(path.join(evidence, `fixture-${name}.md`), bytes, { flag: 'wx' })
  }
  const ledger = new AuditLedger(expectedSid, expectedSessionId, expectedAccountKind),
    driverPort = await freePort()
  const report = {
    status: 'running',
    startedAt: new Date().toISOString(),
    candidateSha,
    expectedAccountKind,
    runId,
    application,
    applicationSha256: expectedBinarySha,
    harnessSha256: sha(await readFile(fileURLToPath(import.meta.url))),
    runtime: {
      version: runtimeVersion,
      executable: runtimeExe,
      sha256: sha(await readFile(runtimeExe)),
      provenance:
        'Existing installed Evergreen selected by reviewed wrapper; no runtime installation',
    },
    driver: { executable: edgeDriver, sha256: sha(await readFile(edgeDriver)), port: driverPort },
    context: {
      ...context,
      recordSha256: sha(contextBytes),
      nodePid: process.pid,
      nodeObservedSid: expectedSid,
    },
    fixtures: Object.fromEntries(
      Object.entries(files).map(([name, file]) => [
        name,
        { path: file.path, bytes: file.bytes.length, sha256: sha(file.bytes) },
      ]),
    ),
    productDataDirectories: productData,
    processObserver: { path: processObserver, sha256: sha(await readFile(processObserver)) },
    processIdentities: [],
    launches: [],
    steps: [],
    inputs: [],
    nativeAudit: ledger.events,
    boundaries: [
      'Four self-authored files, not full Mermaid grammar/corpus coverage.',
      'W3C trusted pointer/key actions, public DOM observations and detached image decode only.',
      'No real system IME, native file-picker, installer, rollback, multi-DPI or OS-wide network denial acceptance.',
      'Outer process cleanup never substitutes for native Job/profile/private-tree/IPC completion.',
    ],
    realImeAccepted: false,
    systemDpiMatrixAccepted: false,
    installationAccepted: false,
    visualReviewAccepted: false,
  }
  const reportFile = path.join(evidence, 'mermaid-product-e2e.json')
  await writeFile(reportFile, '{}\n', { flag: 'wx' })
  const persist = () => {
    const body = JSON.stringify(report, null, 2) + '\n'
    assert(Buffer.byteLength(body) <= 2 * 1024 * 1024, 'Structured evidence file budget')
    return writeFile(reportFile, body)
  }
  let driver,
    product,
    session,
    active,
    launch,
    fatal,
    driverLog = '',
    driverClosed = false,
    logOverflow = false,
    failure
  const guard = () => {
    if (fatal) throw fatal
    assert(!logOverflow, 'Diagnostic log budget exceeded; evidence is incomplete')
    if (driver && (driver.exitCode !== null || driver.signalCode !== null))
      throw Error('Owned EdgeDriver exited')
    if (product && (product.exitCode !== null || product.signalCode !== null))
      throw Error('Owned product exited unexpectedly')
  }
  const until = async (check, label, milliseconds = 30000, checkGuard = true) => {
    const deadline = Date.now() + milliseconds
    while (Date.now() < deadline) {
      if (checkGuard) guard()
      const value = await check()
      if (value) return value
      await delay(100)
    }
    throw Error('Timed out: ' + label)
  }
  const request = async (method, route, body, signal, observation) => {
    report.lastRequest = { method, route, at: new Date().toISOString() }
    const response = await fetch(`http://127.0.0.1:${driverPort}${route}`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.any([
        AbortSignal.timeout(route === '/session' ? 60000 : 30000),
        ...(signal ? [signal] : []),
      ]),
    })
    return decodeWebDriverResponse(await response.text(), response.status, observation)
  }
  const executeWithSignal = (signal, script, ...args) =>
    request('POST', `/session/${session}/execute/sync`, { script, args }, signal)
  const execute = (script, ...args) => executeWithSignal(undefined, script, ...args)
  const executeAsync = (script, ...args) =>
    request('POST', `/session/${session}/execute/async`, { script, args })
  const state = (signal) => executeWithSignal(signal, observe)
  const identityBirths = new Map()
  const observeProcesses = async (includeProduct = true) => {
    const expected = new Map([
      [process.pid, process.execPath],
      [driver.pid, edgeDriver],
    ])
    if (includeProduct && product) expected.set(product.pid, application)
    const { stdout } = await promisify(execFile)(
      pwsh,
      [
        '-NoLogo',
        '-NoProfile',
        '-File',
        processObserver,
        '-InspectProcesses',
        '-ProcessIds',
        [...expected.keys()].join(','),
      ],
      { encoding: 'utf8', windowsHide: true, timeout: 15000, maxBuffer: 1024 * 1024 },
    )
    const values = JSON.parse(stdout.replace(/^\uFEFF/, ''))
    validateProcessIdentities(
      values,
      expected,
      expectedSid,
      expectedSessionId,
      identityBirths,
      expectedAccountKind,
    )
    report.processIdentities.push({ at: new Date().toISOString(), values })
    return values
  }
  const keys = async (value, modifier) => {
    report.inputs.push({
      at: new Date().toISOString(),
      kind: 'W3C-key-actions',
      value,
      modifier: modifier ?? null,
    })
    const actions = []
    if (modifier) actions.push({ type: 'keyDown', value: modifier })
    for (const key of value)
      actions.push({ type: 'keyDown', value: key }, { type: 'keyUp', value: key })
    if (modifier) actions.push({ type: 'keyUp', value: modifier })
    await request('POST', `/session/${session}/actions`, {
      actions: [{ type: 'key', id: 'keyboard', actions }],
    })
  }
  const control = (value) => keys(value, '\uE009')
  const pointer = async (selector, left = false, beforeClick, signal, checkpoint) => {
    for (let attempt = 0; attempt < 24; attempt++) {
      checkpoint?.()
      signal?.throwIfAborted()
      const target = await executeWithSignal(
        signal,
        `const e=document.querySelector(arguments[0]);if(!e)return null;const r=e.getBoundingClientRect(),x=arguments[1]?r.left+Math.min(8,r.width/2):(r.left+r.right)/2,y=(r.top+r.bottom)/2;
let parent=e.parentElement;while(parent&&!(parent.scrollHeight>parent.clientHeight+1&&/(auto|scroll)/.test(getComputedStyle(parent).overflowY)))parent=parent.parentElement;
const p=parent?.getBoundingClientRect(),hit=document.elementFromPoint(x,y);return {x,y,rect:r.toJSON(),disabled:!!e.disabled,hit:!!hit&&(e===hit||e.contains(hit)),scroll:p?{x:(p.left+p.right)/2,y:(p.top+p.bottom)/2,top:p.top,bottom:p.bottom}:null}`,
        selector,
        left,
      )
      assert(target && !target.disabled, 'Visible enabled UI target: ' + selector)
      if (target.hit && target.rect.width > 0 && target.rect.height > 0) {
        if (beforeClick) await beforeClick()
        checkpoint?.()
        signal?.throwIfAborted()
        report.inputs.push({
          at: new Date().toISOString(),
          kind: 'W3C-pointer-actions',
          selector,
          x: target.x,
          y: target.y,
        })
        await request(
          'POST',
          `/session/${session}/actions`,
          {
            actions: [
              {
                type: 'pointer',
                id: 'mouse',
                parameters: { pointerType: 'mouse' },
                actions: [
                  {
                    type: 'pointerMove',
                    origin: 'viewport',
                    x: Math.round(target.x),
                    y: Math.round(target.y),
                    duration: 50,
                  },
                  { type: 'pointerDown', button: 0 },
                  { type: 'pointerUp', button: 0 },
                ],
              },
            ],
          },
          signal,
        )
        return
      }
      assert(target.scroll, 'UI target has a scrollable parent')
      checkpoint?.()
      await request(
        'POST',
        `/session/${session}/actions`,
        {
          actions: [
            {
              type: 'wheel',
              id: 'wheel',
              actions: [
                {
                  type: 'scroll',
                  origin: 'viewport',
                  x: Math.round(target.scroll.x),
                  y: Math.round(target.scroll.y),
                  deltaX: 0,
                  deltaY: target.y < target.scroll.top ? -180 : 180,
                  duration: 150,
                },
              ],
            },
          ],
        },
        signal,
      )
      await delay(150, undefined, { signal })
    }
    assert.fail('Could not expose UI target: ' + selector)
  }
  const menu = async () => {
    if (!(await state()).menu) await pointer('[data-menu-toggle]')
    await pointer('[data-menu-section="plugins"]')
    if (await execute('return !!document.querySelector(\'[data-plugin-action="back"]\')'))
      await pointer('[data-plugin-action="back"]')
    return waitForPluginCard(state, { guard })
  }
  const closeMenu = async () => {
    if ((await state()).menu) await pointer('[data-menu-close]')
    await until(async () => !(await state()).menu, 'Menu closed')
  }
  const switchPlugin = async (enabled) => {
    await menu()
    let before
    // Capture after any real wheel reveal, immediately before the click. This
    // excludes legitimate scrolling from the card anchoring comparison.
    await pointer(
      `.plugin-summary-card[data-plugin-id="${PLUGIN}"] [role="switch"]`,
      false,
      async () => {
        before = await state()
        const card = before.cards.find((item) => item.id === PLUGIN)
        assert(card && card.checked === String(!enabled), 'Actual plugin switch starting state')
      },
    )
    await until(async () => {
      const next = (await state()).cards.find((item) => item.id === PLUGIN)
      return next?.checked === String(enabled) && next.busy !== 'true'
    }, 'Plugin toggle settled')
    const after = await state()
    assert.equal(after.version, before.version)
    assert.equal(after.dirty, before.dirty)
    const layout = validateCardReflow(before.cards, after.cards)
    const step = report.steps.at(-1)
    if (step) (step.pluginToggleLayouts ??= []).push(layout)
    await closeMenu()
  }
  const position = async (source, offset = 0, mode = 'live') => {
    await closeMenu()
    await control('1')
    await until(async () => (await state()).mode === 'source', 'Source mode')
    const selector = await execute(
      `const root=document.querySelector('.milkup-editor'),b=root.getBoundingClientRect();const e=[...root.querySelectorAll('.milkup-line')].find(e=>{const r=e.getBoundingClientRect();return r.height>0&&r.top>=b.top&&r.bottom<=Math.min(b.bottom,innerHeight)});return e?'.milkup-line[data-line="'+e.dataset.line+'"]':null`,
    )
    assert(selector, 'Actual source-line pointer target')
    await pointer(selector, true)
    await until(async () => (await state()).editorFocused, 'Real pointer focuses editor')
    await control('\uE011') // Ctrl+Home.
    const lines = source.slice(0, offset).split('\n')
    if (lines.length > 1) await keys('\uE015'.repeat(lines.length - 1))
    await keys('\uE011') // Home.
    const column = [
      ...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(lines.at(-1)),
    ].length
    if (column) await keys('\uE014'.repeat(column))
    await until(async () => (await state()).cursor === offset, 'Exact public caret position')
    if (mode === 'live') await control('2')
    await until(async () => (await state()).mode === mode, 'Requested editor mode')
  }
  const saved = async (expected = files[active].bytes) => {
    await control('s')
    await until(async () => {
      const current = await state()
      return (
        !current.dirty &&
        !current.saving &&
        (await readFile(files[active].path)).equals(Buffer.from(expected))
      )
    }, 'Exact LF/CRLF/Unicode saved bytes')
    return { bytes: Buffer.byteLength(expected), sha256: sha(await readFile(files[active].path)) }
  }
  const rendered = async (expected) =>
    until(
      async () => {
        const value = await state()
        assert.equal(value.vectorCount, 0, 'No inline SVG private output')
        return expected
          ? value.mode === 'live' &&
              value.images.some(
                (image) =>
                  image.visible &&
                  image.complete &&
                  image.naturalWidth > 0 &&
                  image.naturalHeight > 0 &&
                  image.src.startsWith('blob:'),
              )
          : value.images.length === 0
      },
      expected ? 'Actual decoded PNG in editor' : 'Source fallback without image',
      45000,
    )
  const readImage = async (name, screenshot = false) => {
    const supplied = screenshot ? await request('GET', `/session/${session}/screenshot`) : null
    const result = await executeAsync(decodeScript, supplied)
    assert.equal(result.ok, true, result.error)
    const { base64, ...decoded } = result.value,
      bytes = Buffer.from(base64, 'base64')
    const structure = validatePng(bytes, screenshot ? MAX_SCREENSHOT : MAX_NATIVE_PNG)
    assert.equal(decoded.width, structure.width)
    assert.equal(decoded.height, structure.height)
    assert.equal(decoded.fullyDecoded, true)
    assert.equal(decoded.nonuniform, true)
    const file = name + (screenshot ? '-window.png' : '-diagram.png')
    await writeFile(path.join(evidence, file), bytes, { flag: 'wx' })
    let native
    if (!screenshot) {
      await until(
        () => {
          try {
            native = ledger.matchPng(product.pid, structure)
            return true
          } catch {
            return false
          }
        },
        'Matching native success, ownership and cleanup audit',
        15000,
      )
    }
    return { file, ...structure, ...decoded, native, visuallyReviewed: false }
  }
  const step = async (name, operation) => {
    const row = { name, fixture: active, startedAt: new Date().toISOString(), passed: false }
    report.steps.push(row)
    try {
      row.before = await state()
      await operation(row)
      row.after = await state()
      row.screenshot = await readImage(name, true)
      row.passed = true
    } catch (error) {
      row.error = String(error)
      row.after = await state().catch(() => null)
      row.screenshot = await readImage(name + '-failure', true).catch(() => null)
      throw error
    } finally {
      row.finishedAt = new Date().toISOString()
      await persist()
    }
  }
  const drain = async () => {
    await until(
      () => ledger.pending(product.pid) === 0,
      'Native jobs have completed before application close',
      45000,
    )
    guard()
    return ledger.verifyAll(product.pid)
  }
  const startProduct = async (name) => {
    active = name
    const port = await freePort(),
      profile = path.join(profileRoot, name)
    await mkdir(profile)
    const env = { ...process.env }
    for (const key of Object.keys(env))
      if (key.startsWith('WEBVIEW2_') || key.startsWith('TAURI_')) delete env[key]
    Object.assign(env, {
      TAURI_WEBVIEW_AUTOMATION: 'true',
      MILKUP_MERMAID_NATIVE_AUDIT: '1',
      WEBVIEW2_USER_DATA_FOLDER: profile,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port} --remote-debugging-address=127.0.0.1`,
    })
    product = spawn(application, [files[name].path], { stdio: ['ignore', 'pipe', 'pipe'], env })
    product.once('error', (error) => {
      fatal = error
    })
    launch = {
      fixture: name,
      productPid: product.pid,
      fileArgument: files[name].path,
      profile,
      debugPort: port,
      startedAt: new Date().toISOString(),
      applicationOutput: '',
    }
    report.launches.push(launch)
    const current = launch
    product.once('exit', (code, signal) =>
      Object.assign(current, {
        exitCode: code,
        signal,
        exitedAt: new Date().toISOString(),
        exitObservedMonotonicMs: performance.now(),
      }),
    )
    product.once('close', () => {
      current.stdioClosedAt = new Date().toISOString()
    })
    for (const stream of [product.stdout, product.stderr]) {
      const decoder = new StringDecoder('utf8')
      let pending = ''
      const consume = (text, final = false) => {
        if (current.applicationOutput.length + text.length > 512 * 1024) {
          logOverflow = true
          return
        }
        current.applicationOutput += text
        pending += text
        if (pending.length > 65536 && !pending.includes('\n')) {
          fatal = Error('Unbounded product diagnostic line')
          return
        }
        const lines = pending.split('\n')
        pending = final ? '' : lines.pop()
        for (const line of lines)
          if (line.startsWith(AUDIT_PREFIX)) {
            try {
              ledger.accept(JSON.parse(line.slice(AUDIT_PREFIX.length)), current.productPid)
            } catch (error) {
              fatal = error
            }
          }
      }
      stream.on('data', (bytes) => consume(decoder.write(bytes)))
      stream.on('end', () => consume(decoder.end(), true))
    }
    await observeProcesses()
    await persist()
    current.devToolsVersion = await until(
      async () =>
        fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1000) })
          .then((response) => (response.ok ? response.json() : null))
          .catch(() => null),
      'Owned WebView2 loopback startup',
      60000,
    )
    const response = await request('POST', '/session', {
      capabilities: {
        alwaysMatch: {
          browserName: 'webview2',
          'ms:edgeChromium': true,
          'ms:edgeOptions': { debuggerAddress: `127.0.0.1:${port}` },
        },
      },
    })
    session = response.sessionId
    assert(session, 'Attached WebDriver session')
    current.capabilities = response.capabilities
    assert.equal(
      response.capabilities?.browserVersion,
      runtimeVersion,
      'Actually attached WebView2 version matches pinned installed Runtime evidence',
    )
    await request('POST', `/session/${session}/timeouts`, {
      script: 30000,
      pageLoad: 45000,
      implicit: 0,
    })
    current.windowRect = await request('GET', `/session/${session}/window/rect`)
    assert(
      current.windowRect.width >= 640 && current.windowRect.height >= 480,
      'Visible usable native window; no synthetic viewport/DPI',
    )
    await until(async () => {
      const current = await state()
      return current.path && samePath(current.path, files[name].path) && current.loading === 'ready'
    }, 'Literal production file-argument open')
    const initial = await state()
    assert(
      (initial.protocol === 'tauri:' && initial.hostname === 'localhost') ||
        (['http:', 'https:'].includes(initial.protocol) && initial.hostname === 'tauri.localhost'),
      'Shipped production origin',
    )
    assert.equal(initial.visibility, 'visible')
    assert.equal(initial.developmentProbe, 'undefined')
    assert.equal(initial.diagnostics, 'undefined')
    await control('0')
    await position(fixtures[name], 0)
  }
  const closeProduct = async (successful) => {
    if (!product) return
    const current = product,
      record = launch,
      productPid = record.productPid
    const isAlive = () => current.exitCode === null && current.signalCode === null
    const exitController = new AbortController()
    const stopExitQueries = () => exitController.abort()
    current.once('exit', stopExitQueries)
    if (!isAlive()) stopExitQueries()
    record.teardown = { afterFailure: !successful, ownedProductPid: productPid }
    const evidenceErrors = []
    try {
      await persist()
    } catch (error) {
      evidenceErrors.push(error)
      record.teardown.evidenceBeforeCloseError = String(error)
    }
    const summarizeNative = () =>
      ledger.verifyAll(productPid).map((job) => ({
        requestId: job.requestId,
        successful: job.finished.successful,
        cleanupVerified: true,
      }))
    let teardownFailure
    try {
      await settleOwnedProduct({
        record: record.teardown,
        isAlive,
        drainNative: async () => {
          await waitForNativeJobs(ledger, productPid, isAlive)
          record.nativeJobs = summarizeNative()
          return { admittedJobs: record.nativeJobs.length, innerCleanupVerified: true }
        },
        closeUi: async () => {
          assert(session, 'A real WebDriver session is required to request UI close')
          const beforeClose = await state().catch((error) => {
            record.closeStateDiagnostic = String(error)
            return null
          })
          if (successful)
            assert(beforeClose && !beforeClose.dirty, 'Successful test closes a clean document')
          if (beforeClose?.menu)
            await pointer('[data-menu-close]').catch((error) => {
              record.closeMenuDiagnostic = String(error)
            })
          let requested = false
          await pointer('[data-window-control="close"]', false, () => {
            requested = true
          }).catch((error) => {
            record.closePointerError = String(error)
          })
          return { realUiCloseRequested: requested }
        },
        waitForExit: () =>
          waitForOwnedExit(
            isAlive,
            15000,
            100,
            async (signal, checkpoint) => {
              // flushEdits may expose confirmation after the close click. Keep one
              // original exit budget instead of restarting it for each observation.
              if (!session || record.discardedOwnedUnsavedFixture) return
              checkpoint()
              const confirm = await probeCloseConfirmation(
                record,
                (observation) =>
                  request(
                    'POST',
                    `/session/${session}/execute/sync`,
                    {
                      script: `const e=document.querySelector('[data-close-confirm]');return !!e&&!e.hidden&&e.getClientRects().length>0`,
                      args: [],
                    },
                    signal,
                    observation,
                  ),
                successful,
                signal,
              )
              checkpoint()
              if (confirm !== true || successful) return
              const owned = await state(signal)
              assert(
                owned.path && samePath(owned.path, files[active].path),
                'Only the exact self-authored fixture may be discarded during failed-test cleanup',
              )
              await pointer(
                '[data-close-confirm-action="discard"]',
                false,
                undefined,
                signal,
                checkpoint,
              )
              record.discardedOwnedUnsavedFixture = true
            },
            {
              exitedAt: () => record.exitObservedMonotonicMs,
              exitSignal: exitController.signal,
            },
          ),
        forceStop: () =>
          stopOwnedProductAfterFailure({
            current,
            expectedPid: productPid,
            // Validate only this product, even if the failed driver's process is gone.
            observeIdentity: () =>
              promisify(execFile)(
                pwsh,
                [
                  '-NoLogo',
                  '-NoProfile',
                  '-File',
                  processObserver,
                  '-InspectProcesses',
                  '-ProcessIds',
                  String(productPid),
                ],
                { encoding: 'utf8', windowsHide: true, timeout: 15000, maxBuffer: 1024 * 1024 },
              ),
            verifyIdentity: ({ stdout }) => {
              const identities = JSON.parse(stdout.replace(/^\uFEFF/, ''))
              validateProcessIdentities(
                identities,
                new Map([[productPid, application]]),
                expectedSid,
                expectedSessionId,
                identityBirths,
                expectedAccountKind,
              )
              record.teardown.fallbackIdentity = identities[0]
              assert.equal(current, product, 'Fallback still owns this product object')
              record.outerTerminationRequired = true
            },
          }),
        drainStdio: () =>
          until(() => record.stdioClosedAt, 'Product stdout/stderr fully drained', 5000, false),
        verifyExit: () => {
          assert.equal(current.exitCode, 0, 'Product closes normally after real UI close')
          assert.equal(current.signalCode, null, 'Product was not terminated by a signal')
          if (successful) assertCleanCloseConfirmation(record)
          return true
        },
        verifyNative: () => {
          if (fatal) throw fatal
          assert.equal(logOverflow, false, 'Complete native diagnostics after stdio drain')
          record.nativeJobs = summarizeNative()
          return { admittedJobs: record.nativeJobs.length, innerCleanupVerified: true }
        },
        detach: async () => {
          if (session)
            await request('DELETE', `/session/${session}`).catch((error) => {
              record.detachDiagnostic = String(error)
            })
          session = undefined
          return { detachedAfterProductCloseAttempt: true }
        },
      })
      if (successful)
        assert.equal(
          record.teardown.closedByUi,
          true,
          'Successful acceptance requires an actual requested UI close',
        )
    } catch (error) {
      teardownFailure = error
    } finally {
      current.removeListener('exit', stopExitQueries)
      stopExitQueries()
      record.closedByUi = record.teardown.closedByUi === true
      try {
        await writeFile(
          path.join(evidence, `${record.fixture}-product.log`),
          record.applicationOutput,
        )
      } catch (error) {
        evidenceErrors.push(error)
        record.teardown.productLogWriteError = String(error)
      }
      // Only a drained stream may lose its mutable buffer. If identity proof or
      // fallback failed, retain diagnostics for the outer owned Job supervisor.
      if (record.stdioClosedAt) delete record.applicationOutput
      product = undefined
      try {
        await persist()
      } catch (error) {
        evidenceErrors.push(error)
        record.teardown.finalEvidenceWriteError = String(error)
      }
    }
    if (teardownFailure || evidenceErrors.length) {
      const errors = [...(teardownFailure ? [teardownFailure] : []), ...evidenceErrors]
      throw new AggregateError(errors, errors.map((error) => String(error)).join('; '))
    }
  }
  try {
    await persist()
    driver = spawn(
      edgeDriver,
      [
        `--port=${driverPort}`,
        '--log-level=WARNING',
        `--log-path=${path.join(evidence, 'edgedriver-native.log')}`,
      ],
      { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, env: process.env },
    )
    report.driver.pid = driver.pid
    driver.once('close', () => {
      driverClosed = true
    })
    driver.once('error', (error) => {
      fatal = error
    })
    for (const stream of [driver.stdout, driver.stderr])
      stream.on('data', (bytes) => {
        const text = bytes.toString()
        if (driverLog.length + text.length > 512 * 1024) logOverflow = true
        else driverLog += text
      })
    await until(
      () =>
        request('GET', '/status').then(
          () => true,
          () => false,
        ),
      'Owned EdgeDriver ready',
      15000,
    )
    await observeProcesses(false)
    await startProduct('ordinary')
    await step('01-initial-disabled-source', async (row) => {
      await rendered(false)
      const before = await state()
      assert.equal(before.dirty, false)
      await menu()
      const inventory = expectedPluginInventory
        ? await waitForBundledPluginInventory(state, expectedPluginInventory, { guard })
        : null
      if (inventory) row.bundledPluginsObserved = inventory.observed
      let current = inventory?.state ?? (await state())
      const initialCard = current.cards.find((card) => card.id === PLUGIN)
      assert(initialCard, 'Exact Diagrams card exists after asynchronous catalog readiness')
      assert.equal(initialCard.checked, 'false', 'Fresh Diagrams is actually disabled')
      assert.notEqual(initialCard.busy, 'true', 'Initial Diagrams switch is not busy')
      assert.equal(initialCard.switchDisabled, false, 'Initial Diagrams switch is actionable')
      await pointer(`[data-plugin-action="details"][data-plugin-id="${PLUGIN}"]`)
      current = await state()
      assert(
        current.pluginText?.includes('1.3.0'),
        'Actual reviewed Diagrams version in product UI',
      )
      row.pluginDetails = current.pluginText
      await closeMenu()
      assert.equal((await state()).version, before.version)
      assert((await readFile(files.ordinary.path)).equals(files.ordinary.bytes))
    })
    let initialImage, editedImage
    await step('02-enable-and-exact-bytes', async (row) => {
      const before = await state()
      await switchPlugin(true)
      await rendered(true)
      assert.equal((await state()).version, before.version)
      assert.equal((await state()).dirty, before.dirty)
      row.image = initialImage = await readImage('02-enabled')
      row.saved = await saved()
    })
    const offset = fixtures.ordinary.indexOf('Draft'),
      edited = fixtures.ordinary.slice(0, offset) + 'X' + fixtures.ordinary.slice(offset)
    await step('03-real-edit-save-replacement', async (row) => {
      await position(fixtures.ordinary, offset, 'source')
      await rendered(false)
      const before = await state()
      assert(before.source.some((line) => line.visible && line.text.includes('A[Draft 草稿]')))
      await keys('X')
      await until(async () => {
        const s = await state()
        return s.dirty && s.version === before.version + 1
      }, 'Real source edit and dirty/version change')
      row.saved = await saved(edited)
      await position(edited)
      await rendered(true)
      row.image = editedImage = await readImage('03-edited')
      assert.notEqual(
        editedImage.pixelSha256,
        initialImage.pixelSha256,
        'Actual edited diagram pixels changed',
      )
    })
    await step('04-undo-exact-original', async (row) => {
      await position(edited, 0, 'source')
      await control('z')
      row.saved = await saved()
      await position(fixtures.ordinary)
      await rendered(true)
      row.image = await readImage('04-undone')
      assert.equal(
        row.image.pixelSha256,
        initialImage.pixelSha256,
        'Undo restores decoded original pixels',
      )
    })
    await step('05-redo-exact-edit', async (row) => {
      await position(fixtures.ordinary, 0, 'source')
      await control('y')
      row.saved = await saved(edited)
      await position(edited)
      await rendered(true)
      row.image = await readImage('05-redone')
      assert.equal(
        row.image.pixelSha256,
        editedImage.pixelSha256,
        'Redo restores decoded edited pixels',
      )
    })
    await step('06-disable-and-reenable-in-place', async (row) => {
      await position(edited, 0, 'source')
      await control('z')
      row.saved = await saved()
      await position(fixtures.ordinary)
      await rendered(true)
      await switchPlugin(false)
      await rendered(false)
      let current = await state()
      assert(current.source.some((line) => line.visible && line.text.includes('flowchart LR')))
      assert.equal(current.dirty, false)
      await switchPlugin(true)
      await rendered(true)
      row.image = await readImage('06-reenabled')
      assert.equal((await state()).dirty, false)
      row.saved = await saved()
    })
    await closeProduct(true)
    for (const name of ['wide', 'c4', 'invalid']) {
      await startProduct(name)
      await step('07-' + name, async (row) => {
        if (name === 'invalid') {
          await until(
            async () => {
              const s = await state()
              return (
                !s.images.length &&
                s.notices.some((notice) => notice.visible && notice.text.trim()) &&
                s.source.some(
                  (line) => line.visible && line.text.includes('unknownWindowsMermaidGrammar'),
                )
              )
            },
            'Invalid grammar leaves source and actual diagnostic',
            45000,
          )
          await drain()
          assert(
            ledger.verifyAll(product.pid).some(isUnknownGrammarRejection),
            'Invalid grammar reached owned renderer; timeout/startup failure is not syntax acceptance',
          )
        } else {
          await rendered(true)
          row.image = await readImage('07-' + name)
          const current = await state(),
            image = current.images.find((item) => item.visible)
          if (name === 'wide') {
            assert(image.naturalWidth > current.editor.width)
            assert(
              Math.abs(image.rect.width - image.naturalWidth) < 1,
              'Wide PNG keeps natural width',
            )
            assert(image.naturalHeight >= 40)
          }
          if (name === 'c4')
            row.visualReviewRequired =
              'Read the retained actual C4 PNG for label/arrow separation, readable contrast and bounded blank margin.'
        }
        assert.equal((await state()).dirty, false)
        row.saved = await saved()
      })
      if (name === 'invalid')
        await step('08-final-disable', async () => {
          await switchPlugin(false)
          await rendered(false)
          await saved()
        })
      await closeProduct(true)
    }
    await observeProcesses(false)
    ledger.verifyAll()
    assert(
      ledger.events.some((event) => event.phase === 'started'),
      'Actual native rendering evidence exists',
    )
    for (const [name, file] of Object.entries(files)) {
      const finalBytes = await readFile(file.path)
      assert(finalBytes.equals(file.bytes), 'Every authored fixture restored exactly')
      await writeFile(path.join(evidence, `saved-${name}.md`), finalBytes, { flag: 'wx' })
    }
    assert.equal(sha(await readFile(application)), expectedBinarySha)
    assert.equal(sha(await readFile(runtimeExe)), report.runtime.sha256)
    report.status = 'passed'
  } catch (error) {
    failure = error
    report.status = 'failed'
    report.failure = { message: String(error), stack: error.stack, at: new Date().toISOString() }
    if (session) {
      report.failure.state = await state().catch(() => null)
      report.failure.screenshot = await readImage('unhandled-failure', true).catch(() => null)
    }
  } finally {
    await closeProduct(false).catch((error) => {
      report.cleanupError = String(error)
      failure ??= error
      report.status = 'failed'
    })
    if (driver && driver.exitCode === null && driver.signalCode === null) {
      driver.kill()
      await until(
        () => driver.exitCode !== null || driver.signalCode !== null,
        'Owned EdgeDriver stopped',
        5000,
        false,
      ).catch((error) => {
        report.cleanupError = String(error)
        failure ??= error
        report.status = 'failed'
      })
    }
    if (driver)
      await until(() => driverClosed, 'Driver stdout/stderr fully drained', 5000, false).catch(
        (error) => {
          report.cleanupError = String(error)
          failure ??= error
          report.status = 'failed'
        },
      )
    if (fatal || logOverflow) {
      failure ??= fatal ?? Error('Incomplete diagnostic logs')
      report.status = 'failed'
      report.finalDiagnosticFailure = String(failure)
    }
    report.driver.exitCode = driver?.exitCode
    report.driver.signal = driver?.signalCode
    report.finishedAt = new Date().toISOString()
    await writeFile(path.join(evidence, 'edgedriver-stdio.log'), driverLog)
    await persist()
  }
  if (failure) throw failure
  return report
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main().catch((error) => {
    console.error(error.stack ?? String(error))
    process.exitCode = 1
  })
}

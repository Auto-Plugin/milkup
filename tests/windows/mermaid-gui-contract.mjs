import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { AuditLedger, validateContext } from './mermaid-product-e2e.mjs'

export const GUI_BASELINE = Object.freeze({
  applicationCandidateSha: 'a5556beea5cdd1570361c528b2326bc0ad8ba0c4',
  installerSha256: 'f7fe28275477e8957653649924348bc06e24b4b49d63f6e1d6a6f08ed65c6fbf',
  applicationSha256: '5d4df1a7f6e7962be12d624437f620fe5775885e79b7a97b4b519a676ec95d84',
  historicalRunId: '41713129442',
})

export const GUI_STEPS = Object.freeze([
  'blank-start-enable',
  'open-ordinary-stable',
  'open-wide-stable',
  'resize-wide',
  'repeat-document-open',
  'multi-diagram',
  'idle-close',
  'busy-close',
])

export const GUI_EVIDENCE_NAMES = Object.freeze([
  'gui-regression.json',
  'gui-native-audit.json',
  'gui-source-inventory.json',
  'native-window-events.json',
  'gui-observer-stderr.log',
  'gui-idle-product.log',
  'gui-busy-product.log',
  'gui-console-positive.png',
  'gui-native-failure.png',
  'gui-failure-cleanup-window.png',
  ...GUI_STEPS.map((name) => `gui-${name}-window.png`),
  'gui-ordinary-diagram.png',
  'gui-wide-diagram.png',
  'gui-wide-natural-window.png',
  'gui-multi-diagram.png',
  'gui-multi-2-diagram.png',
])

export function validateGuiIdentity(value) {
  assert.equal(value.harnessMode, 'gui-regression', 'Explicit GUI-only mode required')
  for (const name of ['harnessCandidateSha', 'applicationCandidateSha'])
    assert.match(value[name], /^[a-f0-9]{40}$/, name)
  assert.match(value.applicationSha256, /^[a-f0-9]{64}$/)
  if (value.applicationCandidateSha !== value.harnessCandidateSha) {
    assert.notEqual(
      value.frontendBoundaryProbeRequested,
      true,
      'The delivered baseline cannot execute a new frontend diagnostic',
    )
    for (const [name, expected] of Object.entries(GUI_BASELINE)) {
      if (name !== 'historicalRunId')
        assert.equal(value[name], expected, 'Exact delivered baseline ' + name)
    }
    return 'delivered-beta9-baseline'
  }
  return 'current-candidate'
}

export function validateStableSamples(samples, { durationMs, imageCount }) {
  assert(Array.isArray(samples) && samples.length >= 2, 'Continuous stability samples required')
  const first = samples[0]
  assert(Number.isFinite(durationMs) && durationMs >= 3000)
  assert(samples.at(-1).elapsedMs - first.elapsedMs >= durationMs, 'Full requested idle duration')
  let previous = first.elapsedMs
  for (const sample of samples) {
    assert(Number.isFinite(sample.elapsedMs) && sample.elapsedMs >= previous)
    assert(
      sample.elapsedMs - previous <= 3000,
      'No unobserved stability interval over three seconds',
    )
    previous = sample.elapsedMs
    assert.equal(sample.imageCount, imageCount, 'Diagram must remain present throughout idle')
    assert.equal(sample.pending, 0, 'No new native work after rendering settles')
    assert.equal(
      sample.admitted,
      first.admitted,
      'Unchanged document must not re-render during idle',
    )
    assert.equal(sample.mode, 'live')
    assert.equal(sample.dirty, false)
    assert.equal(sample.path, first.path)
    assert.equal(sample.sourceVisible, false, 'No rendered Mermaid source fallback')
    assert.equal(sample.geometry, first.geometry, 'Diagram geometry must remain stable')
    assert.equal(
      sample.imageSources,
      first.imageSources,
      'Displayed image leases must remain stable',
    )
    assert.equal(sample.notices, first.notices, 'No delayed rendering diagnostic')
  }
  return { durationMs: samples.at(-1).elapsedMs - first.elapsedMs, samples: samples.length }
}

export function validateManyDiagrams(rounds) {
  assert(
    Array.isArray(rounds) && rounds.length === 2,
    'Compact and eviction-scroll documents required',
  )
  assert.deepEqual(
    rounds.map((round) => round.name),
    ['many', 'manyScroll'],
  )
  for (const round of rounds) {
    assert.equal(round.exactBytesUnchanged, true)
    assert.equal(round.sourceOffsets.length, 12)
    assert.equal(new Set(round.sourceOffsets).size, 12)
    assert.deepEqual(
      round.visits.map((visit) => visit.diagram),
      [...Array(12).keys(), 0, 11, 0],
    )
    for (const visit of round.visits) {
      assert.equal(visit.from, round.sourceOffsets[visit.diagram])
      assert(Number.isSafeInteger(visit.from) && visit.from >= 0)
      assert.equal(visit.png.fullyDecoded, true)
      assert.match(visit.png.sha256, /^[a-f0-9]{64}$/)
      assert(Number.isSafeInteger(visit.imageCount) && visit.imageCount >= 1)
      assert(Array.isArray(visit.wheelInputs) && visit.wheelInputs.length <= 80)
      validateStableSamples(visit.samples, { durationMs: 3000, imageCount: visit.imageCount })
    }
    assert.equal(
      new Set(round.visits.slice(0, 12).map((visit) => visit.png.sha256)).size,
      12,
      'Twelve distinct diagrams; a repeated first image cannot satisfy coverage',
    )
    assert(round.visits.some((visit) => visit.wheelInputs.some((input) => input.deltaY > 0)))
    assert(round.visits.some((visit) => visit.wheelInputs.some((input) => input.deltaY < 0)))
    for (const visit of round.visits.slice(12))
      assert.equal(
        visit.png.sha256,
        round.visits[visit.diagram].png.sha256,
        'Scroll return preserves diagram content',
      )
  }
  return true
}

export function validateGuiClose(close, kind) {
  assert.equal(close.kind, kind)
  assert.equal(close.realUiCloseRequested, true)
  assert.equal(close.deadlineMs, 15000)
  assert.equal(close.exitCode, 0)
  assert.equal(close.signal, null)
  assert.equal(close.exitedWithinDeadline, true)
  assert.equal(close.stdioDrained, true)
  assert.equal(close.innerCleanupVerified, true, 'Outer cleanup cannot replace product cleanup')
  assert.equal(close.forcedTermination, false)
  assert.deepEqual(close.errors, [])
  if (kind === 'busy') {
    assert.equal(close.preDrained, false, 'Busy close must not pre-drain rendering')
    assert(close.pendingAtClick >= 1, 'A genuinely in-flight native request must overlap the click')
    assert(
      Array.isArray(close.pendingRequestIds) &&
        close.pendingRequestIds.length === close.pendingAtClick,
    )
  }
  return true
}

// The native observer owns positive-control and visibility measurement. This
// contract accepts its explicit final acknowledgement, never an absent log.
export function validateGuiObserver(summary) {
  assert(summary && typeof summary === 'object', 'Native observer final acknowledgement required')
  assert.equal(summary.complete, true)
  assert.equal(
    summary.positiveControlPassed,
    true,
    'Visible console positive control on this desktop',
  )
  assert.equal(summary.productVisibleConsoleCount, 0)
  assert.equal(summary.unattributedVisibleConsoleCount, 0)
  assert.equal(summary.overflow, false, 'Truncated observations cannot prove absence')
  assert.deepEqual(summary.observerErrors, [])
  return true
}

export function validateGuiPluginState(record, phase) {
  assert.equal(record?.phase, phase, 'Plugin startup state must be explicit')
  assert.equal(
    record.togglePerformed,
    false,
    'Fresh and persisted launches must preview without toggling Diagrams',
  )
  assert(Array.isArray(record.initialInventory) && record.initialInventory.length > 0)
  assert(Array.isArray(record.finalInventory))
  const initialIds = record.initialInventory.map((item) => item.id)
  assert.equal(new Set(initialIds).size, initialIds.length)
  assert.deepEqual(record.finalInventory.map((item) => item.id).sort(), [...initialIds].sort())
  assert(initialIds.includes('milkup.diagrams'))
  const installed = record.installedIdentity
  assert.equal(installed?.id, 'milkup.diagrams')
  assert.equal(installed.version, '1.3.0')
  assert.equal(installed.text, 'milkup.diagrams · v1.3.0')
  assert.equal(installed.source, 'public-details-ui')
  for (const before of record.initialInventory) {
    const after = record.finalInventory.find((item) => item.id === before.id)
    const diagrams = before.id === 'milkup.diagrams'
    assert.equal(before.checked, diagrams ? 'true' : 'false')
    assert.equal(after.checked, diagrams ? 'true' : 'false')
    assert.notEqual(before.busy, 'true')
    assert.notEqual(after.busy, 'true')
    if (!diagrams)
      assert.equal(after.version, before.version, 'Other bundled versions must persist unchanged')
    else if (phase === 'fresh') assert.equal(before.version, installed.version)
  }
  return true
}

export function validateNativeDpiObservation(measurement, expectedPid, expectedCreation) {
  const { native, dom } = measurement ?? {}
  assert(native && dom, 'Actual native window and DOM measurements are both required')
  assert.equal(native.observed, true)
  assert.equal(native.displaySettingsChanged, false)
  assert.equal(native.pid, expectedPid, 'DPI observation belongs to the held product')
  assert.equal(native.creationFileTime, expectedCreation, 'DPI observation cannot reuse a PID')
  assert.equal(native.className, 'Tauri Window')
  assert(typeof native.hwnd === 'string' && native.hwnd.length > 0)
  assert(
    Number.isInteger(native.dpi) && native.dpi > 0 && native.dpi <= 1536,
    'Known actual GetDpiForWindow result; no assumed 96',
  )
  assert([0, 1, 2].includes(native.dpiAwareness))
  assert([0, 1, 2].includes(native.observerThreadDpiAwareness))
  assert(typeof native.dpiAwarenessContext === 'string' && native.dpiAwarenessContext.length > 0)
  for (const rect of [native.windowRect, native.clientRect, native.clientScreenRect]) {
    assert(
      rect &&
        ['left', 'top', 'right', 'bottom', 'width', 'height'].every((key) =>
          Number.isFinite(rect[key]),
        ),
    )
    assert.equal(rect.width, rect.right - rect.left)
    assert.equal(rect.height, rect.bottom - rect.top)
    assert(rect.width > 0 && rect.height > 0)
  }
  for (const value of [
    dom.innerWidth,
    dom.innerHeight,
    dom.devicePixelRatio,
    dom.screenAvailWidth,
    dom.screenAvailHeight,
  ])
    assert(Number.isFinite(value) && value > 0, 'Measured positive DOM/CSS dimensions')
  assert(dom.devicePixelRatio <= 16)
  // Win32 coordinates may be virtualized for the querying thread. Preserve its
  // awareness and report which measured relationship fits. Do not label every
  // GetClientRect result physical pixels, or infer window DPI from browser DPR.
  const models = [
    { name: 'client-coordinates-match-css', scale: 1 },
    { name: 'client-coordinates-match-css-times-dpr', scale: dom.devicePixelRatio },
  ]
  const matched = models.find(
    ({ scale }) =>
      Math.abs(native.clientRect.width - dom.innerWidth * scale) <= 2 &&
      Math.abs(native.clientRect.height - dom.innerHeight * scale) <= 2,
  )
  assert(
    matched,
    'Actual Win32 client and CSS viewport dimensions must have a consistent measured relationship',
  )
  return {
    windowDpi: native.dpi,
    dpiAwareness: native.dpiAwareness,
    monitorDpiObserved: native.dpiAwareness === 2,
    browserDpr: dom.devicePixelRatio,
    coordinateRelationship: matched.name,
    scale: matched.scale,
    multiDpiMatrixAccepted: false,
  }
}

export function validateNativeGuiResize(operation, expectedPid, expectedCreation) {
  const control = operation.nativeControl
  assert(control, 'Actual native product-window operation evidence is required')
  assert.equal(control.ok, true)
  assert(Number.isInteger(control.operationSequence) && control.operationSequence > 0)
  assert.equal(control.nativeWindowOperation, true)
  assert.equal(control.displaySettingsChanged, false)
  assert.deepEqual(control.requested, operation.operation)
  assert(['normal', 'maximize', 'restore'].includes(control.requested.mode))
  for (const native of [control.before, control.after]) {
    assert.equal(native.observed, true)
    assert.equal(native.pid, expectedPid)
    assert.equal(native.creationFileTime, expectedCreation)
    assert.equal(native.className, 'Tauri Window')
    assert.equal(native.displaySettingsChanged, false)
    assert.equal(typeof native.maximized, 'boolean')
    assert.equal(native.minimized, false)
    assert(Number.isInteger(native.dpi) && native.dpi > 0)
    for (const rect of [native.windowRect, native.clientRect, native.desktopRect]) {
      assert(
        rect &&
          ['left', 'top', 'right', 'bottom', 'width', 'height'].every((key) =>
            Number.isFinite(rect[key]),
          ),
      )
      assert(rect.width > 0 && rect.height > 0)
      assert.equal(rect.width, rect.right - rect.left)
      assert.equal(rect.height, rect.bottom - rect.top)
    }
  }
  assert.equal(control.before.hwnd, control.after.hwnd, 'The same owned native window must resize')
  assert.deepEqual(
    control.before.desktopRect,
    control.after.desktopRect,
    'No display reconfiguration',
  )
  assert.equal(control.after.maximized, control.requested.mode === 'maximize')
  if (control.requested.mode === 'normal') {
    assert(
      Number.isInteger(control.requested.width) &&
        control.requested.width >= 480 &&
        control.requested.width <= control.before.desktopRect.width,
    )
    assert(
      Number.isInteger(control.requested.height) &&
        control.requested.height >= 360 &&
        control.requested.height <= control.before.desktopRect.height,
    )
  }
  assert.deepEqual(operation.before, control.before.windowRect)
  assert.deepEqual(operation.after, control.after.windowRect)
  assert(
    control.before.windowRect.width !== control.after.windowRect.width ||
      control.before.windowRect.height !== control.after.windowRect.height,
    'Native Tauri window dimensions must actually change',
  )
  assert.equal(operation.nativeWindowChanged, true)
  assert.deepEqual(
    operation.windowMetrics.native.windowRect,
    control.after.windowRect,
    'Measured window must retain the actual native resize result',
  )
  assert.equal(operation.windowMetrics.native.hwnd, control.after.hwnd)
  validateNativeDpiObservation(operation.windowMetrics, expectedPid, expectedCreation)
  return true
}

export function validateNativeChildLifetimes(raw, { allowLegacyChildLifetimes = false } = {}) {
  assert.equal(typeof allowLegacyChildLifetimes, 'boolean')
  const fields = [
    'childLifeVersion',
    'windowLifetimes',
    'childShowEvidence',
    'observationStoppedAtTick',
    'workingGenerationPeak',
    'sharedRecordCount',
  ]
  const present = fields.filter((field) => Object.hasOwn(raw, field))
  if (present.length === 0) {
    assert(allowLegacyChildLifetimes, 'Explicit child lifetime evidence is required')
    assert.deepEqual(raw.unresolvedEvents ?? [], [], 'Historical unknown SHOW cannot pass')
    assert.deepEqual(
      raw.resolvedChildEvents ?? [],
      [],
      'Historical child hints cannot replace lifetime evidence',
    )
    assert.equal(
      raw.knownChildShowEvents ?? 0,
      0,
      'Historical unproved child suppression cannot pass',
    )
    assert.equal(
      raw.knownWindowShowEvents ?? 0,
      0,
      'Historical unproved window suppression cannot pass',
    )
    return true
  }
  assert.deepEqual(raw.unresolvedEvents, [], 'Every unknown SHOW needs complete lifetime evidence')
  assert.deepEqual(raw.resolvedChildEvents, [], 'Old child hints cannot replace lifetime evidence')
  assert.equal(present.length, fields.length, 'Child lifetime evidence cannot be partially omitted')
  assert.equal(raw.childLifeVersion, 1)
  const integer = (value, label, min = 0, max = Number.MAX_SAFE_INTEGER) => {
    assert(Number.isSafeInteger(value) && value >= min && value <= max, label)
    return value
  }
  const hwnd = (value) => {
    assert(
      typeof value === 'string' && /^0x[0-9a-f]{1,16}$/.test(value) && BigInt(value) > 0n,
      'Exact HWND required',
    )
    return BigInt(value).toString()
  }
  const birth = (value) => {
    assert(
      typeof value === 'string' &&
        /^[1-9][0-9]{0,18}$/.test(value) &&
        BigInt(value) <= 9223372036854775807n,
      'Exact positive native creation FILETIME required',
    )
    return BigInt(value)
  }
  const stopped = integer(raw.observationStoppedAtTick, 'Final native observation tick required')
  const time = (record) => {
    integer(record.sequence, 'Native observation sequence required', 1)
    integer(record.callbackTick, 'Native callback tick required', 0, stopped)
    integer(record.nativeEventUptimeMs32, 'Original WinEvent uptime required', 0, 0xffffffff)
    const delay =
      ((record.callbackTick % 0x100000000) - record.nativeEventUptimeMs32 + 0x100000000) %
      0x100000000
    const expected =
      delay <= 2000 && delay <= record.callbackTick ? record.callbackTick - delay : null
    assert.equal(
      record.nativeTick,
      expected,
      'Native event time must independently unwrap within 2000 ms',
    )
  }
  assert(Array.isArray(raw.windowLifetimes) && raw.windowLifetimes.length <= 2048)
  assert(Array.isArray(raw.childShowEvidence) && raw.childShowEvidence.length <= 128)
  assert(Array.isArray(raw.processes) && raw.processes.length <= 256)
  assert(Array.isArray(raw.events) && raw.events.length <= 2048)
  const total = raw.events.length + raw.windowLifetimes.length + raw.childShowEvidence.length
  assert(total <= 2048, 'All native event and lifetime records share the existing 2048 budget')
  assert.equal(raw.sharedRecordCount, total)
  const processes = new Map()
  for (const process of raw.processes) {
    integer(process.pid, 'Process PID required', 1, 0xffffffff)
    birth(process.creationFileTime)
    const key = `${process.pid}:${process.creationFileTime}`
    assert(!processes.has(key), 'Exact process identities must not be duplicated')
    processes.set(key, process)
  }
  const identity = (record) => {
    integer(record.pid, 'Confirmed owner PID required', 1, 0xffffffff)
    integer(record.threadId, 'Confirmed native thread ID required', 1, 0xffffffff)
    assert(
      birth(record.threadCreationFileTime) >= birth(record.processCreationFileTime),
      'Thread cannot predate its exact owning process',
    )
    assert(
      processes.has(`${record.pid}:${record.processCreationFileTime}`),
      'Lifetime owner must have retained exact process identity evidence',
    )
  }
  const lives = new Map(),
    byHwnd = new Map()
  let previousCreateSequence = 0
  for (const life of raw.windowLifetimes) {
    integer(life.id, 'Unique native lifetime ID required', 1)
    assert(!lives.has(life.id), 'Native lifetime IDs must be unique')
    const key = hwnd(life.hwnd)
    const generations = byHwnd.get(key) ?? []
    assert.equal(life.generation, generations.length + 1, 'Every CREATE is a new HWND generation')
    time(life.create)
    integer(life.create.eventThreadId, 'Original CREATE thread required', 1, 0xffffffff)
    assert(life.create.sequence > previousCreateSequence, 'CREATE records preserve callback order')
    previousCreateSequence = life.create.sequence
    if (life.confirmation !== null) {
      const confirmation = life.confirmation
      integer(
        confirmation.sequence,
        'Child confirmation observation required',
        life.create.sequence,
      )
      integer(
        confirmation.callbackTick,
        'Actual child confirmation tick required',
        life.create.callbackTick,
        stopped,
      )
      assert.equal(confirmation.doubleReadMatched, true)
      identity(confirmation)
      assert.equal(
        confirmation.threadId,
        life.create.eventThreadId,
        'CREATE belongs to the exact confirmed window thread',
      )
      assert(
        typeof confirmation.className === 'string' &&
          confirmation.className.length > 0 &&
          confirmation.className.length <= 64,
      )
      hwnd(confirmation.rootHwnd)
      if (confirmation.rootLifeId === null)
        assert.equal(hwnd(confirmation.rootHwnd), key, 'A root confirmation observes itself')
      else {
        integer(confirmation.rootLifeId, 'Exact observed root generation required', 1)
        assert.notEqual(
          hwnd(confirmation.rootHwnd),
          key,
          'A child is distinct from its observed root',
        )
        assert(
          !['ConsoleWindowClass', 'CASCADIA_HOSTING_WINDOW_CLASS', 'PseudoConsoleWindow'].includes(
            confirmation.className,
          ),
          'A console class can never become a negative child classification',
        )
      }
    }
    if (life.retirement !== null) {
      time(life.retirement)
      assert(life.retirement.sequence > life.create.sequence)
      assert(life.retirement.callbackTick >= life.create.callbackTick)
      assert(['destroy', 'parent-destroy', 'new-create'].includes(life.retirement.reason))
      if (life.retirement.reason === 'parent-destroy')
        integer(life.retirement.parentLifeId, 'Retiring parent generation required', 1)
      else assert.equal(life.retirement.parentLifeId, null)
      if (life.confirmation) {
        assert(life.confirmation.sequence < life.retirement.sequence)
        assert(life.confirmation.callbackTick <= life.retirement.callbackTick)
      }
    }
    if (life.proofReleasedAtTick !== null) {
      if (!life.retirement)
        assert.equal(
          life.proofReleasedAtTick,
          stopped,
          'A still-live generation releases its query handles only at observer stop',
        )
      integer(
        life.proofReleasedAtTick,
        'Native proof release tick required',
        life.retirement?.callbackTick ?? life.create.callbackTick,
        stopped,
      )
    }
    lives.set(life.id, life)
    generations.push(life)
    byHwnd.set(key, generations)
  }
  const sameEventTime = (left, right) => {
    for (const field of ['sequence', 'callbackTick', 'nativeTick', 'nativeEventUptimeMs32'])
      assert.equal(
        left[field],
        right[field],
        'Retirement must reference the actual terminating event',
      )
  }
  for (const life of lives.values()) {
    const confirmation = life.confirmation
    if (confirmation?.rootLifeId !== null && confirmation) {
      const root = lives.get(confirmation.rootLifeId)
      assert(
        root?.confirmation && root.confirmation.rootLifeId === null,
        'Child requires a directly confirmed root lifetime',
      )
      assert.equal(hwnd(root.hwnd), hwnd(confirmation.rootHwnd))
      assert(
        root.confirmation.sequence <= confirmation.sequence &&
          root.confirmation.callbackTick <= confirmation.callbackTick,
        'Root identity must be established before child confirmation',
      )
      if (root.retirement)
        assert(
          confirmation.sequence < root.retirement.sequence,
          'A retired root cannot confirm a new child',
        )
    }
    if (life.retirement?.reason === 'parent-destroy') {
      assert(
        confirmation && confirmation.rootLifeId === life.retirement.parentLifeId,
        'Parent retirement must match the root generation actually observed by this child',
      )
      const root = lives.get(life.retirement.parentLifeId)
      assert(root?.retirement && root.retirement.reason === 'destroy')
      sameEventTime(life.retirement, root.retirement)
    }
    const generations = byHwnd.get(hwnd(life.hwnd))
    const next = generations[life.generation]
    if (life.retirement?.reason === 'new-create') {
      assert(next, 'A reuse retirement requires the next observed CREATE barrier')
      sameEventTime(life.retirement, next.create)
    }
    if (next)
      assert(
        life.retirement && life.retirement.sequence <= next.create.sequence,
        'A new CREATE cannot inherit an unclosed HWND lifetime',
      )
  }
  let conservativePeak = 0,
    minimumPeak = 0
  for (const life of lives.values()) {
    const tick = life.create.callbackTick
    const occupied = [...lives.values()].filter(
      (other) =>
        other.create.callbackTick <= tick &&
        (other.proofReleasedAtTick === null || other.proofReleasedAtTick >= tick),
    ).length
    conservativePeak = Math.max(conservativePeak, occupied)
    const minimum = [...lives.values()].filter(
      (other) =>
        other.create.callbackTick <= tick &&
        (other.proofReleasedAtTick === null || other.proofReleasedAtTick > tick),
    ).length
    minimumPeak = Math.max(minimumPeak, minimum)
  }
  integer(raw.workingGenerationPeak, 'Working lifetime generation peak required', 0, 256)
  assert(
    raw.workingGenerationPeak >= minimumPeak && raw.workingGenerationPeak <= conservativePeak,
    'Reported peak must agree with the retained lifetime intervals',
  )
  assert(
    conservativePeak <= 256,
    'Live and retained retired generations share the existing 256-window budget',
  )
  const showIds = new Set(),
    showSequences = new Set()
  const directShows = raw.events.filter(
    (event) => Object.hasOwn(event, 'windowLifeShow') && event.windowLifeShow !== null,
  )
  for (const event of raw.events) {
    if (
      event.showEvent &&
      event.productObservationInterval &&
      !event.positiveControlInterval &&
      !event.consoleCandidate
    )
      assert(
        event.windowLifeShow && typeof event.windowLifeShow === 'object',
        'Every negative SHOW classification retains its exact original window generation proof',
      )
  }
  const shows = [
    ...raw.childShowEvidence.map((show) => ({ show, event: null })),
    ...directShows.map((event) => ({ show: event.windowLifeShow, event })),
  ]
  let childCount = 0
  function teardownContinuity(life, show) {
    const observed = show.postParentDestroy
    if (!observed) return false
    try {
      const root = lives.get(observed.rootLifeId)
      assert.equal(observed.doubleReadMatched, true)
      assert.equal(observed.childLifeId, life.id)
      assert(life.confirmation && root?.confirmation)
      assert.equal(root.confirmation.rootLifeId, null)
      assert.equal(life.confirmation.rootLifeId, root.id)
      assert.equal(life.retirement?.reason, 'parent-destroy')
      assert.equal(life.retirement.parentLifeId, root.id)
      assert.equal(root.retirement?.reason, 'destroy')
      sameEventTime(life.retirement, root.retirement)
      const destroy = life.directDestroy
      assert(destroy)
      time(destroy)
      assert.equal(destroy.eventKind, 'destroy')
      assert.equal(destroy.eventThreadId, life.confirmation.threadId)
      assert.equal(hwnd(destroy.processingWindow.hwnd), hwnd(life.hwnd))
      let end = 0
      for (const [owner, first, second, proof] of [
        [life, observed.childFirst, observed.childSecond, observed.childProof],
        [root, observed.rootFirst, observed.rootSecond, observed.rootProof],
      ]) {
        assert(first && second && proof)
        for (const snapshot of [first, second]) {
          assert.equal(snapshot.isWindow, true)
          assert.equal(hwnd(snapshot.hwnd), hwnd(owner.hwnd))
          for (const field of ['className', 'rootHwnd', 'pid', 'threadId'])
            assert.equal(snapshot[field], owner.confirmation[field])
          integer(
            snapshot.beginTick,
            'Live snapshot starts after SHOW callback',
            show.callbackTick,
            stopped,
          )
          integer(
            snapshot.endTick,
            'Live snapshot completes after all reads',
            snapshot.beginTick,
            stopped,
          )
        }
        assert(second.beginTick >= first.endTick)
        identity(proof)
        for (const field of [
          'pid',
          'threadId',
          'processCreationFileTime',
          'threadCreationFileTime',
        ])
          assert.equal(proof[field], owner.confirmation[field])
        assert.equal(proof.heldThreadVerified, true)
        assert.equal(proof.heldProcessVerified, true)
        for (const field of ['heldThreadWait', 'heldProcessWait']) {
          assert.equal(proof[field]?.result, 258)
          assert.equal(proof[field].exitFileTime, null)
        }
        assert.equal(proof.currentThread?.status, 'same-identity')
        assert.equal(proof.currentThread.win32Error ?? null, null)
        for (const field of ['pid', 'processCreationFileTime', 'threadCreationFileTime'])
          assert.equal(proof.currentThread[field], proof[field])
        integer(
          proof.capturedAtTick,
          'Held identity read lies inside live double read',
          first.beginTick,
          second.endTick,
        )
        if (owner.proofReleasedAtTick !== null)
          assert(proof.capturedAtTick <= owner.proofReleasedAtTick)
        end = Math.max(end, second.endTick)
      }
      integer(observed.endSequence, 'Completed live snapshot order', show.sequence)
      assert(life.create.sequence < show.sequence && root.retirement.sequence < show.sequence)
      assert(observed.endSequence < destroy.sequence)
      assert(
        life.create.nativeTick !== null &&
          root.retirement.nativeTick !== null &&
          destroy.nativeTick !== null,
      )
      assert(
        life.create.nativeTick <= show.nativeTick && root.retirement.nativeTick <= show.nativeTick,
      )
      assert(show.nativeTick <= end && end <= destroy.nativeTick)
      assert(end - root.retirement.nativeTick <= 2000 && destroy.nativeTick - end <= 2000)
      for (const owner of [life, root])
        assert(
          !(byHwnd.get(hwnd(owner.hwnd)) ?? []).some(
            (other) =>
              other.id !== owner.id &&
              other.create.sequence > owner.create.sequence &&
              (other.create.nativeTick === null || other.create.nativeTick <= end),
          ),
        )
      return true
    } catch {
      return false
    }
  }
  for (const { show, event } of shows) {
    assert(show && typeof show === 'object', 'Original window SHOW evidence required')
    assert(['child', 'root'].includes(show.scope), 'Explicit child or root SHOW scope required')
    if (!event)
      assert.equal(show.scope, 'child', 'Unreadable SHOW cannot guess a top-level classification')
    if (show.scope === 'child') childCount++
    integer(show.id, 'Unique unresolved SHOW ID required', 1)
    assert(!showIds.has(show.id), 'SHOW IDs must be unique')
    showIds.add(show.id)
    time(show)
    assert(show.nativeTick !== null, 'An ambiguous event clock cannot suppress a SHOW')
    assert(!showSequences.has(show.sequence), 'A SHOW observation cannot resolve more than once')
    showSequences.add(show.sequence)
    integer(show.eventThreadId, 'Original SHOW event thread required', 1, 0xffffffff)
    assert(
      typeof show.reason === 'string' && show.reason.length > 0 && show.reason.length <= 320,
      'Retained SHOW resolution reason required',
    )
    const proof = show.proof
    assert(proof, 'Suppressed SHOW requires fresh reads of the retained native identity handles')
    identity(proof)
    assert.equal(proof.heldThreadVerified, true)
    assert.equal(proof.heldProcessVerified, true)
    for (const [key, creation] of [
      ['heldThreadWait', proof.threadCreationFileTime],
      ['heldProcessWait', proof.processCreationFileTime],
    ]) {
      const wait = proof[key]
      assert(
        wait && [0, 258].includes(wait.result),
        'Native object wait state must be explicit and successful',
      )
      if (wait.result === 0)
        assert(
          birth(wait.exitFileTime) >= birth(creation),
          'A signaled original object has a valid exit FILETIME after its own creation',
        )
      else
        assert.equal(
          wait.exitFileTime,
          null,
          'An unsignaled object has no defined exit time; never treat undefined native bytes as evidence',
        )
    }
    assert.equal(
      proof.currentThread?.status,
      'same-identity',
      'The original retained thread object must remain precisely identifiable, even after exit',
    )
    assert.equal(proof.currentThread.win32Error ?? null, null)
    for (const field of ['pid', 'threadCreationFileTime', 'processCreationFileTime'])
      assert.equal(
        proof.currentThread[field],
        proof[field],
        'Fresh current thread lookup matches the retained object',
      )
    integer(
      proof.capturedAtTick,
      'Actual SHOW identity read tick required',
      show.callbackTick,
      stopped,
    )
    assert.equal(proof.threadId, show.eventThreadId)
    const candidates = (byHwnd.get(hwnd(show.hwnd)) ?? []).filter((life) => {
      const confirmation = life.confirmation,
        retirement = life.retirement
      const teardown = teardownContinuity(life, show)
      if (
        !confirmation ||
        (show.scope === 'child'
          ? confirmation.rootLifeId === null
          : confirmation.rootLifeId !== null) ||
        ['ConsoleWindowClass', 'CASCADIA_HOSTING_WINDOW_CLASS', 'PseudoConsoleWindow'].includes(
          confirmation.className,
        ) ||
        life.create.nativeTick === null ||
        !retirement ||
        retirement.nativeTick === null ||
        (!teardown &&
          !(
            life.create.nativeTick <= show.nativeTick && show.nativeTick < retirement.nativeTick
          )) ||
        (!teardown &&
          !(life.create.sequence < show.sequence && show.sequence < retirement.sequence)) ||
        !(
          life.create.nativeTick <= confirmation.callbackTick &&
          confirmation.callbackTick < retirement.nativeTick
        ) ||
        (life.proofReleasedAtTick !== null && proof.capturedAtTick > life.proofReleasedAtTick)
      )
        return false
      if (
        ['pid', 'processCreationFileTime', 'threadId', 'threadCreationFileTime'].some(
          (field) => proof[field] !== confirmation[field],
        )
      )
        return false
      const root = show.scope === 'root' ? life : lives.get(confirmation.rootLifeId)
      if (
        root.create.nativeTick === null ||
        (!teardown &&
          root.retirement &&
          (root.retirement.nativeTick === null || show.nativeTick >= root.retirement.nativeTick))
      )
        return false
      if (
        (byHwnd.get(hwnd(root.hwnd)) ?? []).some(
          (other) =>
            other.id !== root.id &&
            other.create.sequence > root.create.sequence &&
            (other.create.nativeTick === null || other.create.nativeTick <= show.nativeTick),
        )
      )
        return false
      return !(byHwnd.get(hwnd(show.hwnd)) ?? []).some(
        (other) =>
          other.id !== life.id &&
          other.create.sequence > life.create.sequence &&
          (other.create.nativeTick === null || other.create.nativeTick <= show.nativeTick),
      )
    })
    assert.equal(
      candidates.length,
      1,
      'A SHOW must identify exactly one proven window generation without an intervening CREATE',
    )
    assert.equal(show.lifeId, candidates[0].id)
    assert.equal(show.status, 'resolved-' + show.scope)
    if (event) {
      const confirmation = candidates[0].confirmation
      assert.equal(event.kind, 'show')
      assert.equal(event.showEvent, true)
      assert.equal(event.productObservationInterval, true)
      assert.equal(event.positiveControlInterval, false)
      assert.equal(
        event.consoleCandidate,
        false,
        'Actual console events cannot be hidden inside a negative window proof',
      )
      assert.equal(hwnd(event.hwnd), hwnd(show.hwnd))
      for (const field of ['nativeEventUptimeMs32', 'eventThreadId'])
        assert.equal(event[field], show[field])
      assert.equal(event.className, confirmation.className)
      assert.equal(event.pid, proof.pid)
      assert.equal(event.processCreationFileTime, proof.processCreationFileTime)
    }
  }
  assert.equal(
    raw.knownChildShowEvents,
    childCount,
    'Suppressed child SHOW count must be independently accounted for',
  )
  assert.equal(
    raw.knownWindowShowEvents,
    shows.length,
    'Every negative SHOW classification must be independently accounted for',
  )
  return true
}

export function validateNativeWindowEvidence(
  raw,
  summary,
  { allowLegacyDesktopBounds = false, allowLegacyChildLifetimes = false } = {},
) {
  validateGuiObserver(summary)
  validateNativeChildLifetimes(raw, { allowLegacyChildLifetimes })
  for (const key of [
    'complete',
    'positiveControlPassed',
    'productVisibleConsoleCount',
    'unattributedVisibleConsoleCount',
    'overflow',
    'observerErrors',
  ])
    assert.deepEqual(
      raw[key],
      summary[key],
      'Native raw report agrees with acknowledgement: ' + key,
    )
  assert.equal(raw.windowEventHookUsed, true)
  assert.equal(raw.desktopOrAclChanged, false)
  assert.equal(raw.productTerminatedByObserver, false)
  assert.equal(raw.positiveControl.sameInputDesktop, true)
  for (const field of [
    'passed',
    'detectedVisible',
    'heldProcessSignaled',
    'naturalExit',
    'cleanupComplete',
    'screenshotCaptured',
  ])
    assert.equal(raw.positiveControl[field], true, 'Observed console control ' + field)
  assert.equal(raw.positiveControl.exitCode, 0)
  assert.equal(raw.positiveControl.jobActiveAfterStop, 0)
  assert(Array.isArray(raw.events) && raw.events.length > 0 && raw.events.length <= 2048)
  assert.equal(typeof allowLegacyDesktopBounds, 'boolean')
  const legacyDesktopBounds = raw.events.every(
    (event) => !Object.hasOwn(event, 'desktopRect') && !Object.hasOwn(event, 'intersectsDesktop'),
  )
  assert(
    !legacyDesktopBounds || allowLegacyDesktopBounds,
    'Actual desktop bounds are required; only an explicitly identified historical baseline may omit them',
  )
  const validateRect = (rect, positive, label) => {
    assert(
      Array.isArray(rect) &&
        rect.length === 4 &&
        rect.every(
          (coordinate) =>
            Number.isInteger(coordinate) && coordinate >= -2147483648 && coordinate <= 2147483647,
        ),
      'Actual signed Win32 rectangle required: ' + label,
    )
    assert(
      positive ? rect[2] > rect[0] && rect[3] > rect[1] : rect[2] >= rect[0] && rect[3] >= rect[1],
      'Ordered nonempty desktop or nonnegative window rectangle required: ' + label,
    )
  }
  const product = new Set(),
    unknown = new Set()
  let previousSequence = 0,
    previousTime = 0,
    positiveObserved = false
  for (const event of raw.events) {
    assert.equal(event.sequence, ++previousSequence)
    assert(Number.isFinite(event.elapsedMs) && event.elapsedMs >= previousTime)
    previousTime = event.elapsedMs
    assert.equal(typeof event.productObservationInterval, 'boolean')
    validateRect(event.rect, false, 'window')
    const hasDesktop = Object.hasOwn(event, 'desktopRect')
    assert.equal(
      hasDesktop,
      Object.hasOwn(event, 'intersectsDesktop'),
      'Desktop bounds and intersection evidence must be present together',
    )
    let intersectsDesktop = true
    if (hasDesktop) {
      validateRect(event.desktopRect, true, 'desktop')
      assert.equal(typeof event.intersectsDesktop, 'boolean')
      const [left, top, right, bottom] = event.desktopRect
      intersectsDesktop =
        event.rect[2] > left &&
        event.rect[3] > top &&
        event.rect[0] < right &&
        event.rect[1] < bottom
      assert.equal(
        event.intersectsDesktop,
        intersectsDesktop,
        'Recorded desktop intersection agrees with the actual rectangles',
      )
    } else {
      assert(
        legacyDesktopBounds,
        'Do not mix historical missing bounds with current measured events',
      )
    }
    const actuallyVisible =
      event.visibleNow &&
      event.cloaked === 0 &&
      event.rect[2] > event.rect[0] &&
      event.rect[3] > event.rect[1] &&
      intersectsDesktop
    const visible =
      actuallyVisible || (event.consoleCandidate && event.showEvent && !event.baselineVisible)
    assert.equal(event.observedVisible, visible)
    if (
      event.positiveControlInterval &&
      event.consoleCandidate &&
      actuallyVisible &&
      event.title === raw.positiveControl.title
    )
      positiveObserved = true
    if (
      event.consoleCandidate &&
      event.productObservationInterval &&
      !event.positiveControlInterval &&
      !event.baselineVisible &&
      visible
    ) {
      const identity = `${event.hwnd}:${event.pid}:${event.processCreationFileTime ?? '0'}`
      ;(event.attribution === 'unattributed' ? unknown : product).add(identity)
    }
  }
  assert(positiveObserved, 'Raw window events must contain the visible console control')
  assert.equal(product.size, raw.productVisibleConsoleCount)
  assert.equal(unknown.size, raw.unattributedVisibleConsoleCount)
  assert.equal(
    product.size + unknown.size,
    0,
    'No visible console during the product observation interval',
  )
  return true
}

export function validateCurrentNativeResourceProof(job) {
  assert.equal(job.finished.resourceReleaseProven, true)
  assert.equal(job.finished.resourceCleanupUncertain, false)
  if (!job.finished.successful) return true
  for (const event of [job.started, job.finished]) {
    const proof = event.directoryAccess
    assert(proof, 'Current renderer must retain its actual directory-access proof')
    for (const [key, value] of Object.entries({
      aclOperations: 2,
      allowAcesPerDirectory: 3,
      inheritanceFlags: 3,
      rootAppMask: 0x1200a9,
      stateAppMask: 0x1f01ff,
      ownerAndDaclVerified: true,
      sameHandleReadback: true,
      lowStateLabel: true,
      aclProcessesStarted: false,
      stateWriteProbe: true,
      ancestorWritesDenied: true,
    }))
      assert.equal(proof[key], value, 'Native directory proof ' + key)
    assert(
      Number.isInteger(proof.denialCount) &&
        proof.denialCount > 0 &&
        proof.denialCount <= 384 &&
        proof.denialCount % 6 === 0,
    )
  }
  return true
}

export function validateWideInteraction(interaction, png) {
  assert(
    interaction && interaction.status === 'passed',
    'Wide diagram fit/native-size interaction required',
  )
  assert.equal(interaction.input, 'W3C-pointer-and-wheel')
  assert.equal(interaction.exactBytesUnchanged, true)
  assert.match(png.sha256, /^[a-f0-9]{64}$/)
  assert.equal(interaction.pngSha256, png.sha256)
  assert.equal(interaction.naturalPngSha256, png.sha256)
  assert.equal(interaction.naturalScreenshot, 'gui-wide-natural-window.png')
  const { fit, natural, scrolled, restored } = interaction
  for (const [name, value] of Object.entries({ fit, natural, scrolled, restored })) {
    assert(value, 'Actual wide UI observation: ' + name)
    const atNaturalSize = name === 'natural' || name === 'scrolled'
    assert.equal(value.mode, atNaturalSize ? 'natural' : 'fit')
    assert.equal(value.button.text, atNaturalSize ? '适应宽度' : '原始尺寸')
    assert.equal(value.button.visible, true)
    assert.equal(value.button.disabled, false)
    assert.equal(value.image.complete, true)
    assert.equal(
      value.image.naturalWidth,
      png.width,
      'Displayed intrinsic width belongs to the decoded native PNG',
    )
    assert.equal(
      value.image.naturalHeight,
      png.height,
      'Displayed intrinsic height belongs to the decoded native PNG',
    )
    assert.match(value.image.sourceSha256, /^[a-f0-9]{64}$/)
    assert.equal(
      value.image.sourceSha256,
      fit.image.sourceSha256,
      'View change retains the accepted image lease',
    )
    assert.equal(value.image.naturalWidth, fit.image.naturalWidth)
    assert.equal(value.image.naturalHeight, fit.image.naturalHeight)
    assert(
      value.image.naturalWidth > value.viewport.clientWidth && value.viewport.clientWidth >= 200,
    )
    const width = atNaturalSize ? value.image.naturalWidth : value.viewport.clientWidth
    assert(Math.abs(value.image.width - width) <= 1, 'Actual fit/native image width')
    assert(
      Math.abs(
        value.image.height - (width * value.image.naturalHeight) / value.image.naturalWidth,
      ) <= 1,
      'View change preserves image aspect ratio',
    )
    assert(
      value.outer.scrollWidth <= value.outer.clientWidth + 1,
      'Horizontal overflow remains inside the diagram viewport',
    )
    assert.equal(value.requests.pending, 0)
    assert.equal(
      value.requests.admitted,
      fit.requests.admitted,
      'View controls do not enqueue another native request',
    )
    assert.equal(value.dirty, false)
    assert.equal(value.sourceVisible, false)
    if (atNaturalSize) {
      assert(['auto', 'scroll'].includes(value.viewport.overflowX))
      assert(value.viewport.scrollWidth >= value.image.naturalWidth - 1)
      assert(value.viewport.clientHeight >= value.image.naturalHeight - 1)
    } else {
      assert(value.viewport.scrollWidth <= value.viewport.clientWidth + 1)
      assert.equal(value.viewport.scrollLeft, 0)
    }
  }
  assert.equal(natural.viewport.scrollLeft, 0)
  assert(scrolled.viewport.scrollLeft > 0, 'Real wheel input must reach the wide image')
  assert(
    Math.abs(
      scrolled.viewport.scrollLeft -
        (scrolled.viewport.scrollWidth - scrolled.viewport.clientWidth),
    ) <= 2,
    'The far end of the natural-size image is reachable',
  )
  return true
}

export function validateGuiReport(report) {
  assert.equal(report.schema, 1)
  validateGuiIdentity(report)
  if (report.frontendBoundaryProbeRequested) {
    assert.match(report.frontendBoundaryProbeSha256, /^[a-f0-9]{64}$/)
    assert.equal(
      report.frontendBoundaryProbe?.cleanupConfirmed,
      true,
      'Optional diagnostic cleanup must be verified before product acceptance',
    )
  }
  assert.deepEqual(
    report.steps.map((step) => step.name),
    GUI_STEPS,
  )
  assert(
    report.steps.every((step) => step.status === 'passed'),
    'Every real GUI phase must pass',
  )
  validateGuiPluginState(
    report.steps.find((item) => item.name === 'blank-start-enable').pluginState,
    'fresh',
  )
  validateGuiPluginState(
    report.steps.find((item) => item.name === 'busy-close').pluginState,
    'persisted',
  )
  assert(Array.isArray(report.launches) && report.launches.length === 2)
  for (const launch of report.launches) {
    const readiness = launch.windowMetrics.native.readiness
    assert(
      readiness && Number.isInteger(readiness.attempts) && readiness.attempts >= 2,
      'Native startup needs two stable real window observations',
    )
    assert(
      Number.isInteger(readiness.zeroMatches) &&
        readiness.zeroMatches >= 0 &&
        readiness.zeroMatches < readiness.attempts,
    )
    assert(
      Number.isFinite(readiness.elapsedMs) &&
        readiness.elapsedMs >= 0 &&
        readiness.elapsedMs <= 8000,
    )
    assert.equal(readiness.stableSamples, 2)
    assert.deepEqual(
      launch.windowMetrics.relationship,
      validateNativeDpiObservation(
        launch.windowMetrics,
        launch.productPid,
        launch.identity.creationFileTime,
      ),
    )
  }
  for (const name of ['open-ordinary-stable', 'open-wide-stable']) {
    const step = report.steps.find((item) => item.name === name)
    validateStableSamples(step.samples, { durationMs: 75000, imageCount: 1 })
    assert.equal(step.nativePickerAccepted, true)
    assert.equal(step.png.fullyDecoded, true)
    assert.equal(step.exactBytesUnchanged, true)
    if (name === 'open-wide-stable' && validateGuiIdentity(report) === 'current-candidate')
      validateWideInteraction(step.wideInteraction, step.png)
  }
  const resize = report.steps.find((item) => item.name === 'resize-wide')
  assert.equal(resize.operations.length, 6)
  assert(resize.operations.every((operation) => operation.nativeWindowChanged && operation.settled))
  const firstLaunch = report.launches[0]
  for (const operation of resize.operations) {
    validateNativeGuiResize(
      operation,
      firstLaunch.productPid,
      firstLaunch.identity.creationFileTime,
    )
    assert.deepEqual(
      operation.windowMetrics.relationship,
      validateNativeDpiObservation(
        operation.windowMetrics,
        firstLaunch.productPid,
        firstLaunch.identity.creationFileTime,
      ),
    )
  }
  const repeated = report.steps.find((item) => item.name === 'repeat-document-open')
  assert.equal(repeated.opens.length, 3)
  assert(
    repeated.opens.every(
      (open) => open.nativePickerAccepted && open.exactBytesUnchanged && open.stable,
    ),
  )
  const multi = report.steps.find((item) => item.name === 'multi-diagram')
  assert.equal(multi.decodedImages.length, 2)
  assert(multi.decodedImages.every((png) => png.fullyDecoded))
  validateStableSamples(multi.samples, { durationMs: 10000, imageCount: 2 })
  if (validateGuiIdentity(report) === 'current-candidate') validateManyDiagrams(multi.manyDiagrams)
  validateGuiClose(report.steps.find((item) => item.name === 'idle-close').close, 'idle')
  validateGuiClose(report.steps.find((item) => item.name === 'busy-close').close, 'busy')
  validateGuiObserver(report.observerSummary)
  assert.equal(report.nativeCleanupVerified, true)
  assert.equal(report.logOverflow, false)
  return {
    status: 'passed',
    scope: 'real Windows GUI regression; separate from ordinary product acceptance',
  }
}

export function verifyGuiEvidence(report, nativeBytes, windowBytes) {
  assert.equal(report.status, 'passed', 'Failed baselines cannot become passing GUI evidence')
  assert(
    Buffer.byteLength(windowBytes) <= 2 * 1024 * 1024,
    'Native window evidence retains its 2 MiB limit',
  )
  validateGuiReport(report)
  const digest = (bytes) => createHash('sha256').update(bytes).digest('hex')
  assert.equal(digest(nativeBytes), report.nativeAudit.sha256)
  assert.equal(digest(windowBytes), report.nativeWindowEvidence.sha256)
  const context = report.context
  validateContext(
    context,
    context.expectedSid,
    context.expectedSessionId,
    report.expectedAccountKind,
  )
  const ledger = new AuditLedger(
    context.expectedSid,
    context.expectedSessionId,
    report.expectedAccountKind,
  )
  const events = JSON.parse(nativeBytes)
  assert.equal(events.length, report.nativeAudit.events)
  const owned = new Set(report.launches.map((launch) => launch.productPid))
  assert.equal(owned.size, 2)
  for (const event of events) {
    assert(owned.has(event.productPid), 'Audit belongs to a held product from this GUI run')
    ledger.accept(event, event.productPid)
  }
  const jobs = ledger.verifyAll()
  if (validateGuiIdentity(report) === 'current-candidate')
    for (const job of jobs) validateCurrentNativeResourceProof(job)
  for (const step of report.steps) {
    for (const png of [
      step.png,
      step.finalPng,
      ...(step.decodedImages ?? []),
      ...(step.manyDiagrams ?? []).flatMap((round) => round.visits.map((visit) => visit.png)),
    ].filter(Boolean))
      ledger.matchPng(png.nativeMatch.productPid, png)
    if (step.close?.kind === 'busy') {
      for (const id of step.close.pendingRequestIds) {
        const job = jobs.find(
          (item) => item.requestId === id && item.productPid === step.close.productPid,
        )
        assert(job, 'Busy-close overlap refers to a real admitted job of that exact product')
        assert(job.admitted.timestampUnixMs <= Date.parse(step.close.clickedAt))
        assert(
          job.finished.timestampUnixMs >= Date.parse(step.close.clickedAt),
          'The request must finish after the real close dispatch',
        )
      }
    }
  }
  const windows = JSON.parse(windowBytes)
  validateNativeWindowEvidence(windows, report.observerSummary, {
    allowLegacyDesktopBounds: validateGuiIdentity(report) === 'delivered-beta9-baseline',
    allowLegacyChildLifetimes: validateGuiIdentity(report) === 'delivered-beta9-baseline',
  })
  assert(
    Array.isArray(windows.productWindowReadiness) && windows.productWindowReadiness.length === 2,
    'Both product launches require their retained native readiness observations',
  )
  for (const [index, ready] of windows.productWindowReadiness.entries()) {
    const native = report.launches[index].windowMetrics.native
    assert.equal(ready.requestSequence, index + 1)
    assert.equal(ready.ok, true)
    assert.deepEqual(
      ready.lastMeasurement,
      native,
      'Startup measurement must equal the retained native readiness result',
    )
    for (const field of ['attempts', 'zeroMatches'])
      assert.equal(ready[field], native.readiness[field])
    assert(Number.isFinite(ready.startedElapsedMs) && ready.startedElapsedMs >= 0)
    assert(
      Number.isFinite(ready.finishedElapsedMs) && ready.finishedElapsedMs >= ready.startedElapsedMs,
    )
    assert(
      ready.finishedElapsedMs - ready.startedElapsedMs >= native.readiness.elapsedMs,
      'Raw readiness interval must contain the reported actual observation duration',
    )
  }
  const resize = report.steps.find((step) => step.name === 'resize-wide')
  assert(
    Array.isArray(windows.productWindowOperations) && windows.productWindowOperations.length === 6,
  )
  for (const [index, operation] of resize.operations.entries()) {
    assert.equal(operation.nativeControl.operationSequence, index + 1)
    assert.deepEqual(
      operation.nativeControl,
      windows.productWindowOperations[index],
      'GUI native resize must match the retained helper operation',
    )
  }
  assert(
    Array.isArray(windows.productMeasurements) &&
      windows.productMeasurements.length > 0 &&
      windows.productMeasurements.length <= 64,
  )
  const measured = new Map()
  for (const [index, native] of windows.productMeasurements.entries()) {
    assert.equal(native.measurementSequence, index + 1)
    measured.set(native.measurementSequence, native)
  }
  for (const native of [
    ...report.launches.map((launch) => launch.windowMetrics.native),
    resize.initialNativeWindow,
    ...resize.operations.map((operation) => operation.windowMetrics.native),
  ]) {
    assert(native, 'Raw native window measurement required')
    assert.deepEqual(
      native,
      measured.get(native.measurementSequence),
      'GUI window metrics must match the retained native measurement',
    )
  }
  return {
    status: 'passed',
    applicationCandidateSha: report.applicationCandidateSha,
    harnessCandidateSha: report.harnessCandidateSha,
    requests: jobs.length,
  }
}

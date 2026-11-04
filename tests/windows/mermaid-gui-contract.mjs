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
    phase === 'fresh',
    'Only the first launch may enable Diagrams',
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
    assert.equal(before.checked, diagrams && phase === 'persisted' ? 'true' : 'false')
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

export function validateNativeWindowEvidence(
  raw,
  summary,
  { allowLegacyDesktopBounds = false } = {},
) {
  validateGuiObserver(summary)
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
  for (const launch of report.launches)
    assert.deepEqual(
      launch.windowMetrics.relationship,
      validateNativeDpiObservation(
        launch.windowMetrics,
        launch.productPid,
        launch.identity.creationFileTime,
      ),
    )
  for (const name of ['open-ordinary-stable', 'open-wide-stable']) {
    const step = report.steps.find((item) => item.name === name)
    validateStableSamples(step.samples, { durationMs: 75000, imageCount: 1 })
    assert.equal(step.nativePickerAccepted, true)
    assert.equal(step.png.fullyDecoded, true)
    assert.equal(step.exactBytesUnchanged, true)
  }
  const resize = report.steps.find((item) => item.name === 'resize-wide')
  assert.equal(resize.operations.length, 6)
  assert(resize.operations.every((operation) => operation.nativeWindowChanged && operation.settled))
  const firstLaunch = report.launches[0]
  for (const operation of resize.operations)
    assert.deepEqual(
      operation.windowMetrics.relationship,
      validateNativeDpiObservation(
        operation.windowMetrics,
        firstLaunch.productPid,
        firstLaunch.identity.creationFileTime,
      ),
    )
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
    for (const png of [step.png, step.finalPng, ...(step.decodedImages ?? [])].filter(Boolean))
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
  validateNativeWindowEvidence(JSON.parse(windowBytes), report.observerSummary, {
    allowLegacyDesktopBounds: validateGuiIdentity(report) === 'delivered-beta9-baseline',
  })
  return {
    status: 'passed',
    applicationCandidateSha: report.applicationCandidateSha,
    harnessCandidateSha: report.harnessCandidateSha,
    requests: jobs.length,
  }
}

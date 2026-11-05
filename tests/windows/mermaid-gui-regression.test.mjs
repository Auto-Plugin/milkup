import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import {
  GUI_BASELINE,
  GUI_STEPS,
  GUI_EVIDENCE_NAMES,
  validateGuiIdentity,
  validateStableSamples,
  validateGuiClose,
  validateGuiObserver,
  validateGuiReport,
  validateNativeWindowEvidence,
  validateNativeChildLifetimes,
  validateCurrentNativeResourceProof,
  validateNativeDpiObservation,
  validateNativeGuiResize,
} from './mermaid-gui-contract.mjs'
import {
  guiFixtures,
  naturalViewStabilityMs,
  validateDiagramLayout,
  inspectPersistedGuiPluginInventory,
  prepareGuiPluginState,
  captureGuiWindowMetrics,
  guiNativeResizeOperations,
} from './mermaid-gui-regression.mjs'
import { stageEvidence } from './stage-mermaid-evidence.mjs'
import { syntheticWideInteraction } from './mermaid-gui-test-fixtures.mjs'

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex')
const identity = () => ({
  harnessMode: 'gui-regression',
  applicationCandidateSha: 'a'.repeat(40),
  harnessCandidateSha: 'a'.repeat(40),
  applicationSha256: 'b'.repeat(64),
})
const windowMetrics = (
  pid = 41,
  creationFileTime = '123',
  dpi = 96,
  devicePixelRatio = 1,
  scale = 1,
) => {
  const width = 1000 * scale,
    height = 700 * scale
  const rect = { left: 0, top: 0, right: width, bottom: height, width, height }
  const value = {
    native: {
      observed: true,
      readiness: { attempts: 2, zeroMatches: 0, elapsedMs: 100, stableSamples: 2 },
      displaySettingsChanged: false,
      pid,
      creationFileTime,
      hwnd: '0x42',
      className: 'Tauri Window',
      dpi,
      dpiAwareness: 2,
      dpiAwarenessContext: '0xfffffffffffffffc',
      observerThreadDpiAwareness: 0,
      minimized: false,
      maximized: false,
      desktopRect: { left: 0, top: 0, right: 1920, bottom: 1080, width: 1920, height: 1080 },
      windowRect: { ...rect },
      clientRect: { ...rect },
      clientScreenRect: { ...rect },
    },
    dom: {
      innerWidth: 1000,
      innerHeight: 700,
      devicePixelRatio,
      screenAvailWidth: 1920,
      screenAvailHeight: 1080,
    },
  }
  value.relationship = validateNativeDpiObservation(value, pid, creationFileTime)
  return value
}

const nativeResize = () => {
  const metrics = windowMetrics()
  const before = structuredClone(metrics.native)
  before.windowRect = { left: 0, top: 0, right: 900, bottom: 650, width: 900, height: 650 }
  const operation = { mode: 'normal', width: 1000, height: 700 }
  return {
    operation,
    before: structuredClone(before.windowRect),
    after: structuredClone(metrics.native.windowRect),
    nativeControl: {
      ok: true,
      operationSequence: 1,
      requested: { ...operation },
      nativeWindowOperation: true,
      displaySettingsChanged: false,
      before,
      after: structuredClone(metrics.native),
    },
    nativeWindowChanged: true,
    settled: true,
    windowMetrics: metrics,
  }
}

test('resize requires an actual owned native window change, not only WebDriver viewport change', () => {
  assert(validateNativeGuiResize(nativeResize(), 41, '123'))
  for (const change of [
    (value) => {
      delete value.nativeControl
    },
    (value) => {
      value.nativeControl.before = structuredClone(value.nativeControl.after)
      value.before = structuredClone(value.after)
    },
    (value) => {
      value.nativeControl.after.hwnd = '0x999'
    },
    (value) => {
      value.nativeControl.after.creationFileTime = '999'
    },
    (value) => {
      value.nativeControl.after.pid = 99
    },
    (value) => {
      value.nativeControl.after.maximized = true
    },
    (value) => {
      value.windowMetrics.native.windowRect.width += 10
      value.windowMetrics.native.windowRect.right += 10
    },
  ]) {
    const bad = nativeResize()
    change(bad)
    assert.throws(() => validateNativeGuiResize(bad, 41, '123'))
  }
})

test('native resize matrix uses measured desktop bounds and rejects insufficient desktops', () => {
  for (const [width, height] of [
    [1024, 768],
    [1920, 1080],
    [900, 640],
  ]) {
    const operations = guiNativeResizeOperations({ desktopRect: { width, height } })
    assert.equal(operations.length, 6)
    assert.deepEqual(operations.slice(2, 4), [{ mode: 'maximize' }, { mode: 'restore' }])
    for (const op of operations.filter((op) => op.mode === 'normal')) {
      assert(op.width <= width && op.height <= height)
    }
  }
  assert.throws(() => guiNativeResizeOperations({ desktopRect: { width: 800, height: 600 } }))
})

test('failed native/CSS consistency retains both original measurements before rejection', async () => {
  const raw = windowMetrics(),
    target = {},
    writes = []
  raw.dom.innerWidth = 740
  await assert.rejects(
    () =>
      captureGuiWindowMetrics({
        target,
        readNative: async () => raw.native,
        readDom: async () => raw.dom,
        persist: async () => writes.push(structuredClone(target)),
        expectedPid: 41,
        expectedCreation: '123',
      }),
    /consistent measured relationship/,
  )
  assert.equal(writes.length, 1)
  assert.deepEqual(writes[0].windowMetrics.native, raw.native)
  assert.deepEqual(writes[0].windowMetrics.dom, raw.dom)
  assert.equal(writes[0].windowMetrics.validation.status, 'failed')
  assert.equal(writes[0].windowMetrics.relationship, undefined)
})

test('DOM measurement failure still preserves successful native observation', async () => {
  const raw = windowMetrics(),
    target = {},
    writes = []
  await assert.rejects(
    () =>
      captureGuiWindowMetrics({
        target,
        readNative: async () => raw.native,
        readDom: async () => {
          throw Error('synthetic DOM disconnect')
        },
        persist: async () => writes.push(structuredClone(target)),
        expectedPid: 41,
        expectedCreation: '123',
      }),
    /synthetic DOM disconnect/,
  )
  assert.deepEqual(writes[0].windowMetrics.native, raw.native)
  assert.equal(writes[0].windowMetrics.dom, null)
  assert.equal(writes[0].windowMetrics.validation.status, 'failed')
})

test('window DPI is observed independently from browser DPR and preserves coordinate awareness', () => {
  assert.equal(windowMetrics().relationship.windowDpi, 96)
  const physical = windowMetrics(41, '123', 192, 2, 2)
  assert.equal(
    physical.relationship.coordinateRelationship,
    'client-coordinates-match-css-times-dpr',
  )
  const virtualized = windowMetrics(41, '123', 192, 2, 1)
  assert.equal(virtualized.relationship.coordinateRelationship, 'client-coordinates-match-css')
  assert.equal(virtualized.relationship.windowDpi, 192)
  assert.equal(virtualized.relationship.multiDpiMatrixAccepted, false)
  for (const modify of [
    (value) => {
      value.native.dpi = 0
    },
    (value) => {
      delete value.native.dpi
    },
    (value) => {
      value.native.dpiAwareness = -1
    },
    (value) => {
      value.native.pid = 99
    },
    (value) => {
      value.native.creationFileTime = '999'
    },
    (value) => {
      value.dom.innerWidth = 600
    },
    (value) => {
      value.dom.innerHeight = 800
    },
    (value) => {
      value.native.displaySettingsChanged = true
    },
  ]) {
    const bad = windowMetrics()
    modify(bad)
    assert.throws(() => validateNativeDpiObservation(bad, 41, '123'))
  }
})

const pluginInventory = [
  { id: 'milkup.diagrams', version: '1.3.0' },
  { id: 'milkup.footnotes', version: '1.0.1' },
]
const pluginCards = (enabled) =>
  pluginInventory.map(({ id, version }) => ({
    id,
    availableVersionText:
      enabled && id === 'milkup.diagrams' ? null : `${version} · 下次开启时应用`,
    checked: String(enabled && id === 'milkup.diagrams'),
    busy: null,
    ariaDisabled: null,
    switchDisabled: false,
    rect: { width: 600, height: 120 },
    switchRect: { width: 40, height: 24 },
  }))

test('first GUI launch enables once; restarted GUI verifies persisted state and installed version without toggling', async () => {
  let cards = pluginCards(false),
    inDetails = false,
    toggles = 0,
    closes = 0,
    detailsReads = 0
  const options = {
    inventory: pluginInventory,
    pollIntervalMs: 1,
    timeoutMs: 1000,
    readState: async () => ({ cards: inDetails ? [] : cards }),
    pointer: async (selector) => {
      if (selector.includes('[role="switch"]')) {
        toggles++
        assert.equal(cards[0].checked, 'false')
        cards = pluginCards(true)
      } else if (selector.includes('[data-plugin-action="details"]')) inDetails = true
      else if (selector === '[data-plugin-action="back"]') {
        assert(inDetails)
        inDetails = false
      } else assert.fail('Unexpected action: ' + selector)
    },
    readInstalledIdentity: async () => {
      assert(inDetails)
      return ++detailsReads === 1 ? null : 'milkup.diagrams · v1.3.0'
    },
    closeMenu: async () => {
      assert(!inDetails)
      closes++
    },
  }
  const first = await prepareGuiPluginState({ ...options, phase: 'fresh' })
  assert.equal(toggles, 1)
  assert.equal(first.togglePerformed, true)
  assert(first.initialInventory.every((entry) => entry.checked === 'false'))
  const restarted = await prepareGuiPluginState({ ...options, phase: 'persisted' })
  assert.equal(toggles, 1, 'Restart must not reset or toggle the correctly persisted plugin')
  assert.equal(restarted.togglePerformed, false)
  assert.equal(
    restarted.initialInventory.find((entry) => entry.id === 'milkup.diagrams').checked,
    'true',
  )
  assert.equal(restarted.installedIdentity.version, '1.3.0')
  assert.equal(restarted.installedIdentity.source, 'public-details-ui')
  assert.equal(closes, 2)
})

test('persisted inventory still rejects reset state, other enabled plugins, identity and version changes', async () => {
  assert(inspectPersistedGuiPluginInventory(pluginCards(true), pluginInventory))
  for (const modify of [
    (cards) => {
      cards[0].checked = 'false'
    },
    (cards) => {
      cards[1].checked = 'true'
    },
    (cards) => {
      cards[1].availableVersionText = '1.0.2 · 下次开启时应用'
    },
    (cards) => {
      cards[0].availableVersionText = '1.4.0 · 下次开启时应用'
    },
    (cards) => {
      cards.push({ ...cards[1], id: 'milkup.unknown' })
    },
    (cards) => {
      cards.push({ ...cards[0] })
    },
  ]) {
    const cards = pluginCards(true)
    modify(cards)
    assert.throws(() => inspectPersistedGuiPluginInventory(cards, pluginInventory))
  }
  let clicks = []
  await assert.rejects(
    () =>
      prepareGuiPluginState({
        phase: 'persisted',
        inventory: pluginInventory,
        readState: async () => ({ cards: pluginCards(true) }),
        readInstalledIdentity: async () => 'milkup.diagrams · v1.2.0',
        pointer: async (selector) => {
          clicks.push(selector)
        },
        closeMenu: async () => {},
        timeoutMs: 20,
        pollIntervalMs: 1,
      }),
    /Actual enabled plugin identity/,
  )
  assert(!clicks.some((selector) => selector.includes('[role="switch"]')))
  await assert.rejects(
    () =>
      prepareGuiPluginState({
        phase: 'fresh',
        inventory: pluginInventory,
        readState: async () => ({ cards: pluginCards(true) }),
        readInstalledIdentity: async () => '',
        pointer: async () => assert.fail('Fresh enabled state must be rejected before any toggle'),
        closeMenu: async () => {},
      }),
    /Fresh bundled plugin must be disabled/,
  )
})
const samples = (duration = 75000, count = 1) =>
  Array.from({ length: duration / 1000 + 1 }, (_, i) => ({
    elapsedMs: i * 1000,
    imageCount: count,
    pending: 0,
    admitted: 1,
    mode: 'live',
    dirty: false,
    path: 'C:\\fixtures\\ordinary.md',
    sourceVisible: false,
    geometry: 'unchanged',
    imageSources: 'same-lease',
    notices: '[]',
  }))
const close = (kind) => ({
  kind,
  productPid: 42,
  preDrained: kind === 'idle',
  realUiCloseRequested: true,
  deadlineMs: 15000,
  exitCode: 0,
  signal: null,
  exitedWithinDeadline: true,
  stdioDrained: true,
  innerCleanupVerified: true,
  forcedTermination: false,
  errors: [],
  pendingAtClick: kind === 'busy' ? 1 : 0,
  pendingRequestIds: kind === 'busy' ? ['request-1'] : [],
})
const summary = () => ({
  complete: true,
  positiveControlPassed: true,
  productVisibleConsoleCount: 0,
  unattributedVisibleConsoleCount: 0,
  overflow: false,
  observerErrors: [],
})
const rawWindows = () => ({
  ...summary(),
  childLifeVersion: 1,
  windowLifetimes: [],
  childShowEvidence: [],
  unresolvedEvents: [],
  resolvedChildEvents: [],
  knownChildShowEvents: 0,
  knownWindowShowEvents: 0,
  observationStoppedAtTick: 2300,
  workingGenerationPeak: 0,
  sharedRecordCount: 1,
  processes: [],
  windowEventHookUsed: true,
  desktopOrAclChanged: false,
  productTerminatedByObserver: false,
  positiveControl: {
    title: 'owned-console-control',
    sameInputDesktop: true,
    passed: true,
    detectedVisible: true,
    heldProcessSignaled: true,
    naturalExit: true,
    cleanupComplete: true,
    screenshotCaptured: true,
    exitCode: 0,
    jobActiveAfterStop: 0,
  },
  events: [
    {
      sequence: 1,
      elapsedMs: 20,
      productObservationInterval: false,
      positiveControlInterval: true,
      consoleCandidate: true,
      showEvent: true,
      baselineVisible: false,
      visibleNow: true,
      cloaked: 0,
      rect: [0, 0, 400, 200],
      desktopRect: [0, 0, 1920, 1080],
      intersectsDesktop: true,
      observedVisible: true,
      title: 'owned-console-control',
      hwnd: '0x01',
      pid: 8,
      processCreationFileTime: '100',
      attribution: 'unattributed',
    },
  ],
})
const passing = () => ({
  schema: 1,
  ...identity(),
  nativeCleanupVerified: true,
  logOverflow: false,
  observerSummary: summary(),
  launches: [
    { productPid: 41, identity: { creationFileTime: '123' }, windowMetrics: windowMetrics() },
    {
      productPid: 42,
      identity: { creationFileTime: '456' },
      windowMetrics: windowMetrics(42, '456'),
    },
  ],
  steps: GUI_STEPS.map((name) => {
    const step = { name, status: 'passed' }
    if (name === 'blank-start-enable' || name === 'busy-close') {
      const fresh = name === 'blank-start-enable'
      step.pluginState = {
        phase: fresh ? 'fresh' : 'persisted',
        togglePerformed: fresh,
        installedIdentity: {
          id: 'milkup.diagrams',
          version: '1.3.0',
          text: 'milkup.diagrams · v1.3.0',
          source: 'public-details-ui',
        },
        initialInventory: pluginInventory.map((item) => ({
          ...item,
          checked: String(!fresh && item.id === 'milkup.diagrams'),
          busy: null,
        })),
        finalInventory: pluginInventory.map((item) => ({
          ...item,
          checked: String(item.id === 'milkup.diagrams'),
          busy: null,
        })),
      }
    }
    if (['open-ordinary-stable', 'open-wide-stable'].includes(name))
      Object.assign(step, {
        samples: samples(),
        nativePickerAccepted: true,
        png: { fullyDecoded: true },
        exactBytesUnchanged: true,
      })
    if (name === 'open-wide-stable') {
      step.png.sha256 = 'e'.repeat(64)
      step.png.width = 3200
      step.png.height = 160
      step.wideInteraction = syntheticWideInteraction(step.png.sha256)
    }
    if (name === 'resize-wide') step.operations = Array.from({ length: 6 }, nativeResize)
    if (name === 'repeat-document-open')
      step.opens = Array.from({ length: 3 }, () => ({
        nativePickerAccepted: true,
        exactBytesUnchanged: true,
        stable: true,
      }))
    if (name === 'multi-diagram')
      Object.assign(step, {
        decodedImages: [{ fullyDecoded: true }, { fullyDecoded: true }],
        samples: samples(10000, 2),
      })
    if (name === 'idle-close') step.close = close('idle')
    if (name === 'busy-close') step.close = close('busy')
    return step
  }),
})

test('mixed-source GUI baseline is limited to the exact delivered installer and installed image', () => {
  assert.equal(validateGuiIdentity(identity()), 'current-candidate')
  const baseline = { ...identity(), ...GUI_BASELINE }
  assert.equal(validateGuiIdentity(baseline), 'delivered-beta9-baseline')
  for (const key of ['applicationCandidateSha', 'applicationSha256', 'installerSha256']) {
    const bad = structuredClone(baseline)
    bad[key] = 'c'.repeat(key.endsWith('Sha') ? 40 : 64)
    assert.throws(() => validateGuiIdentity(bad), /baseline/)
  }
  assert.throws(() => validateGuiIdentity({ ...baseline, harnessMode: 'product' }), /Explicit GUI/)
})

test('first PNG cannot substitute for a full stable idle interval', () => {
  assert.equal(
    validateStableSamples(samples(), { durationMs: 75000, imageCount: 1 }).durationMs,
    75000,
  )
  assert.throws(
    () => validateStableSamples(samples(74000), { durationMs: 75000, imageCount: 1 }),
    /Full requested/,
  )
  for (const [key, value] of [
    ['imageCount', 0],
    ['pending', 1],
    ['admitted', 2],
    ['sourceVisible', true],
    ['geometry', 'changed'],
    ['imageSources', 'replaced'],
    ['dirty', true],
    ['notices', '["late failure"]'],
  ]) {
    const bad = samples()
    bad[61][key] = value
    assert.throws(() => validateStableSamples(bad, { durationMs: 75000, imageCount: 1 }), key)
  }
  const gap = samples().filter((sample) => sample.elapsedMs < 40000 || sample.elapsedMs > 45000)
  assert.throws(
    () => validateStableSamples(gap, { durationMs: 75000, imageCount: 1 }),
    /unobserved/,
  )
})

test('busy close requires real overlap, original deadline, EOF and inner cleanup', () => {
  assert(validateGuiClose(close('idle'), 'idle'))
  assert(validateGuiClose(close('busy'), 'busy'))
  for (const [key, value] of [
    ['preDrained', true],
    ['pendingAtClick', 0],
    ['exitedWithinDeadline', false],
    ['stdioDrained', false],
    ['innerCleanupVerified', false],
    ['forcedTermination', true],
    ['deadlineMs', 30000],
    ['exitCode', 1],
  ])
    assert.throws(() => validateGuiClose({ ...close('busy'), [key]: value }, 'busy'), key)
})

test('headless or incomplete observation never establishes absence of visible consoles', () => {
  assert(validateGuiObserver(summary()))
  for (const [key, value] of [
    ['complete', false],
    ['positiveControlPassed', false],
    ['productVisibleConsoleCount', 1],
    ['unattributedVisibleConsoleCount', 1],
    ['overflow', true],
    ['observerErrors', ['lost HWND']],
  ])
    assert.throws(() => validateGuiObserver({ ...summary(), [key]: value }), key)
  assert(validateNativeWindowEvidence(rawWindows(), summary()))
  const noControl = rawWindows()
  noControl.events[0].visibleNow = false
  noControl.events[0].observedVisible = false
  noControl.events[0].showEvent = false
  assert.throws(() => validateNativeWindowEvidence(noControl, summary()), /Raw window events/)
  const flashed = rawWindows()
  flashed.sharedRecordCount++
  flashed.events.push({
    ...flashed.events[0],
    sequence: 2,
    elapsedMs: 100,
    productObservationInterval: true,
    positiveControlInterval: false,
    hwnd: '0x02',
    title: '',
    observedVisible: true,
  })
  assert.throws(() => validateNativeWindowEvidence(flashed, summary()), /strictly equal/)
})

const childLifetimeEvidence = () => {
  const raw = rawWindows()
  const event = (sequence, nativeTick, callbackTick, eventThreadId) => ({
    sequence,
    nativeTick,
    callbackTick,
    eventThreadId,
    nativeEventUptimeMs32: nativeTick % 0x100000000,
  })
  raw.processes = [
    { pid: 100, parentPid: 1, creationFileTime: '1000', image: 'product.exe' },
    { pid: 101, parentPid: 100, creationFileTime: '1100', image: 'webview.exe' },
  ]
  raw.windowLifetimes = [
    {
      id: 1,
      hwnd: '0x10',
      generation: 1,
      create: event(1, 100, 101, 11),
      confirmation: {
        sequence: 1,
        callbackTick: 101,
        className: 'Tauri Window',
        rootHwnd: '0x10',
        rootLifeId: null,
        pid: 100,
        processCreationFileTime: '1000',
        threadId: 11,
        threadCreationFileTime: '1010',
        doubleReadMatched: true,
      },
      retirement: { ...event(4, 200, 210, 11), reason: 'destroy', parentLifeId: null },
      proofReleasedAtTick: 2210,
    },
    {
      id: 2,
      hwnd: '0x11',
      generation: 1,
      create: event(2, 110, 111, 12),
      confirmation: {
        sequence: 2,
        callbackTick: 111,
        className: 'Button',
        rootHwnd: '0x10',
        rootLifeId: 1,
        pid: 101,
        processCreationFileTime: '1100',
        threadId: 12,
        threadCreationFileTime: '1110',
        doubleReadMatched: true,
      },
      retirement: { ...event(4, 200, 210, 11), reason: 'parent-destroy', parentLifeId: 1 },
      proofReleasedAtTick: 2210,
    },
  ]
  raw.childShowEvidence = [
    {
      id: 1,
      hwnd: '0x11',
      ...event(3, 150, 190, 12),
      status: 'resolved-child',
      scope: 'child',
      lifeId: 2,
      proof: {
        capturedAtTick: 220,
        threadId: 12,
        threadCreationFileTime: '1110',
        pid: 101,
        processCreationFileTime: '1100',
        heldThreadVerified: true,
        heldProcessVerified: true,
        heldThreadWait: { result: 258, exitFileTime: null },
        heldProcessWait: { result: 258, exitFileTime: null },
        currentThread: {
          status: 'same-identity',
          pid: 101,
          threadCreationFileTime: '1110',
          processCreationFileTime: '1100',
        },
      },
      reason: 'held identity and original event interval',
    },
  ]
  raw.knownChildShowEvents = 1
  raw.knownWindowShowEvents = 1
  raw.workingGenerationPeak = 2
  raw.sharedRecordCount = 4
  return raw
}

test('late child SHOW is independently resolved by exact identities and its original lifetime interval', () => {
  assert(validateNativeWindowEvidence(childLifetimeEvidence(), summary()))
  const queued = childLifetimeEvidence()
  queued.windowLifetimes[1].confirmation.callbackTick = 170
  assert(
    validateNativeChildLifetimes(queued),
    'A later snapshot still belongs to the actual generation when it precedes that generation retirement',
  )
  queued.childShowEvidence[0].nativeTick = 110
  queued.childShowEvidence[0].nativeEventUptimeMs32 = 110
  assert(
    validateNativeChildLifetimes(queued),
    'Same-tick CREATE and SHOW retain their distinct FIFO callback entrance order',
  )
  const wrongEntrance = structuredClone(queued)
  wrongEntrance.childShowEvidence[0].sequence = wrongEntrance.windowLifetimes[1].create.sequence
  assert.throws(() => validateNativeChildLifetimes(wrongEntrance), /exactly one proven window/)
  const completedLate = structuredClone(queued)
  completedLate.childShowEvidence[0].sequence =
    completedLate.windowLifetimes[1].retirement.sequence + 1
  assert.throws(
    () => validateNativeChildLifetimes(completedLate),
    /exactly one proven window/,
    'Callback completion order cannot substitute for the original event entrance order',
  )
  const wrapped = childLifetimeEvidence()
  const offset = 0x100000000 - 120
  for (const life of wrapped.windowLifetimes) {
    for (const record of [life.create, life.retirement]) {
      record.callbackTick += offset
      record.nativeTick += offset
      record.nativeEventUptimeMs32 = record.nativeTick % 0x100000000
    }
    life.confirmation.callbackTick += offset
    life.proofReleasedAtTick += offset
  }
  wrapped.observationStoppedAtTick += offset
  const show = wrapped.childShowEvidence[0]
  show.callbackTick += offset
  show.nativeTick += offset
  show.nativeEventUptimeMs32 = show.nativeTick % 0x100000000
  show.proof.capturedAtTick += offset
  assert(
    validateNativeChildLifetimes(wrapped),
    'Original 32-bit native time is independently unwrapped across rollover',
  )

  const noSuppression = rawWindows()
  noSuppression.windowLifetimes = [structuredClone(childLifetimeEvidence().windowLifetimes[0])]
  noSuppression.processes = childLifetimeEvidence().processes
  noSuppression.windowLifetimes[0].retirement = null
  noSuppression.windowLifetimes[0].proofReleasedAtTick = noSuppression.observationStoppedAtTick
  noSuppression.workingGenerationPeak = 1
  noSuppression.sharedRecordCount = 2
  assert(
    validateNativeChildLifetimes(noSuppression),
    'Observer stop releases query handles without inventing a window destroy',
  )
})

test('child classification rejects missing identities, stale generations, clock ambiguity and unproved suppression', () => {
  const rejected = [
    ['unknown SHOW', (raw) => raw.unresolvedEvents.push({ hwnd: '0xdead' })],
    ['old child hint', (raw) => raw.resolvedChildEvents.push({ previouslyObservedAsChild: true })],
    [
      'missing schema',
      (raw) => {
        delete raw.childLifeVersion
      },
    ],
    [
      'unresolved status',
      (raw) => {
        raw.childShowEvidence[0].status = 'unresolved'
      },
    ],
    [
      'missing proof',
      (raw) => {
        raw.childShowEvidence[0].proof = null
      },
    ],
    [
      'wrong child generation',
      (raw) => {
        raw.childShowEvidence[0].lifeId = 1
      },
    ],
    [
      'unaccounted suppression',
      (raw) => {
        raw.knownChildShowEvents = 0
      },
    ],
    [
      'console pretending to be child',
      (raw) => {
        raw.windowLifetimes[1].confirmation.className = 'ConsoleWindowClass'
      },
    ],
    [
      'missing exact root',
      (raw) => {
        raw.windowLifetimes[1].confirmation.rootLifeId = 99
      },
    ],
    [
      'wrong root birth',
      (raw) => {
        raw.windowLifetimes[0].confirmation.processCreationFileTime = '999'
      },
    ],
    [
      'wrong parent generation at destroy',
      (raw) => {
        raw.windowLifetimes[1].retirement.parentLifeId = 2
      },
    ],
    [
      'invented parent destroy time',
      (raw) => {
        raw.windowLifetimes[1].retirement.callbackTick++
      },
    ],
    [
      'same thread ID with a new thread birth',
      (raw) => {
        raw.childShowEvidence[0].proof.threadCreationFileTime = '1200'
      },
    ],
    [
      'same PID with new process birth',
      (raw) => {
        raw.childShowEvidence[0].proof.processCreationFileTime = '1099'
      },
    ],
    [
      'same process but another thread',
      (raw) => {
        raw.childShowEvidence[0].eventThreadId = 13
      },
    ],
    [
      'unverified held process',
      (raw) => {
        raw.childShowEvidence[0].proof.heldProcessVerified = false
      },
    ],
    [
      'proof read after handle release',
      (raw) => {
        raw.childShowEvidence[0].proof.capturedAtTick = 2220
      },
    ],
    [
      'missing retirement boundary',
      (raw) => {
        raw.windowLifetimes[1].retirement = null
        raw.windowLifetimes[1].proofReleasedAtTick = 2300
      },
    ],
    [
      'snapshot at retirement boundary',
      (raw) => {
        raw.windowLifetimes[1].confirmation.callbackTick = 200
      },
    ],
    [
      'SHOW at destroy boundary',
      (raw) => {
        raw.childShowEvidence[0].nativeTick = 200
        raw.childShowEvidence[0].nativeEventUptimeMs32 = 200
      },
    ],
    [
      'forged native clock',
      (raw) => {
        raw.childShowEvidence[0].nativeTick = 151
      },
    ],
    [
      'future original event',
      (raw) => {
        raw.childShowEvidence[0].nativeTick = 221
        raw.childShowEvidence[0].nativeEventUptimeMs32 = 221
      },
    ],
    [
      'out-of-bound delivery delay',
      (raw) => {
        raw.childShowEvidence[0].callbackTick = 2200
        raw.childShowEvidence[0].proof.capturedAtTick = 2200
      },
    ],
    [
      'unobserved CREATE',
      (raw) => {
        raw.windowLifetimes[1].create.nativeEventUptimeMs32 = null
      },
    ],
    [
      'unresolvable original CREATE clock',
      (raw) => {
        raw.windowLifetimes[1].create.nativeEventUptimeMs32 = 112
        raw.windowLifetimes[1].create.nativeTick = null
      },
    ],
    [
      'unresolvable original parent CREATE clock',
      (raw) => {
        raw.windowLifetimes[0].create.nativeEventUptimeMs32 = 102
        raw.windowLifetimes[0].create.nativeTick = null
      },
    ],
    [
      'parent lifetime ended before child SHOW',
      (raw) => {
        raw.windowLifetimes[0].retirement.nativeTick = 140
        raw.windowLifetimes[0].retirement.nativeEventUptimeMs32 = 140
        raw.windowLifetimes[1].retirement = {
          sequence: 6,
          callbackTick: 230,
          nativeTick: 210,
          nativeEventUptimeMs32: 210,
          reason: 'destroy',
          parentLifeId: null,
        }
      },
    ],
    [
      'false working peak',
      (raw) => {
        raw.workingGenerationPeak = 0
      },
    ],
  ]
  for (const [label, mutate] of rejected) {
    const raw = childLifetimeEvidence()
    mutate(raw)
    assert.throws(() => validateNativeChildLifetimes(raw), undefined, label)
  }
  const reused = childLifetimeEvidence()
  const barrier = {
    sequence: 3,
    callbackTick: 145,
    nativeTick: 140,
    nativeEventUptimeMs32: 140,
    eventThreadId: 12,
  }
  reused.windowLifetimes[1].retirement = { ...barrier, reason: 'new-create', parentLifeId: null }
  reused.windowLifetimes.push({
    id: 3,
    hwnd: '0x11',
    generation: 2,
    create: barrier,
    confirmation: null,
    retirement: null,
    proofReleasedAtTick: 2300,
  })
  reused.sharedRecordCount++
  reused.workingGenerationPeak = 3
  assert.throws(
    () => validateNativeChildLifetimes(reused),
    /exactly one proven window/,
    'An unreadable CREATE for the same HWND is a barrier even with the same PID/thread',
  )

  const ambiguous = childLifetimeEvidence()
  ambiguous.observationStoppedAtTick = 4000
  ambiguous.windowLifetimes.push({
    id: 3,
    hwnd: '0x11',
    generation: 2,
    create: {
      sequence: 6,
      callbackTick: 3000,
      nativeTick: null,
      nativeEventUptimeMs32: 0,
      eventThreadId: 12,
    },
    confirmation: null,
    retirement: null,
    proofReleasedAtTick: 4000,
  })
  ambiguous.sharedRecordCount++
  assert.throws(
    () => validateNativeChildLifetimes(ambiguous),
    /exactly one proven window/,
    'An ambiguous later CREATE time cannot be assigned away from the old SHOW',
  )
})

test('child lifetime evidence cannot silently downgrade or exceed the original shared budgets', () => {
  const historical = rawWindows()
  for (const field of [
    'childLifeVersion',
    'windowLifetimes',
    'childShowEvidence',
    'observationStoppedAtTick',
    'workingGenerationPeak',
    'sharedRecordCount',
  ])
    delete historical[field]
  assert.throws(() => validateNativeChildLifetimes(historical), /Explicit child lifetime/)
  assert(validateNativeChildLifetimes(historical, { allowLegacyChildLifetimes: true }))
  historical.knownChildShowEvents = 1
  assert.throws(
    () => validateNativeChildLifetimes(historical, { allowLegacyChildLifetimes: true }),
    /Historical unproved/,
  )

  const records = childLifetimeEvidence()
  records.events = Array.from({ length: 2048 }, () => ({}))
  records.sharedRecordCount = 2051
  assert.throws(() => validateNativeChildLifetimes(records), /2048 budget/)
  const processes = childLifetimeEvidence()
  processes.processes = Array.from({ length: 257 }, () => ({}))
  assert.throws(() => validateNativeChildLifetimes(processes))
  const shows = childLifetimeEvidence()
  shows.childShowEvidence = Array.from({ length: 129 }, () => ({}))
  assert.throws(() => validateNativeChildLifetimes(shows))
  const windows = rawWindows()
  windows.windowLifetimes = Array.from({ length: 257 }, (_, index) => ({
    id: index + 1,
    hwnd: '0x' + (index + 1).toString(16),
    generation: 1,
    create: {
      sequence: index + 1,
      nativeTick: 100 + index,
      callbackTick: 101 + index,
      nativeEventUptimeMs32: 100 + index,
      eventThreadId: 12,
    },
    confirmation: null,
    retirement: null,
    proofReleasedAtTick: 2300,
  }))
  windows.sharedRecordCount = 258
  windows.workingGenerationPeak = 256
  assert.throws(() => validateNativeChildLifetimes(windows), /peak|256-window/)
})

const directWindowShowEvidence = (scope) => {
  const raw = childLifetimeEvidence()
  const show = raw.childShowEvidence.pop()
  show.scope = scope
  show.status = 'resolved-' + scope
  if (scope === 'root') {
    show.hwnd = '0x10'
    show.lifeId = 1
    show.eventThreadId = 11
    Object.assign(show.proof, {
      pid: 100,
      processCreationFileTime: '1000',
      threadId: 11,
      threadCreationFileTime: '1010',
    })
    Object.assign(show.proof.currentThread, {
      pid: 100,
      processCreationFileTime: '1000',
      threadCreationFileTime: '1010',
    })
    raw.knownChildShowEvents = 0
  }
  const confirmation = raw.windowLifetimes.find((life) => life.id === show.lifeId).confirmation
  raw.events.push({
    ...raw.events[0],
    sequence: 2,
    elapsedMs: 40,
    kind: 'show',
    productObservationInterval: true,
    positiveControlInterval: false,
    consoleCandidate: false,
    hwnd: show.hwnd,
    pid: show.proof.pid,
    processCreationFileTime: show.proof.processCreationFileTime,
    className: confirmation.className,
    title: '',
    nativeEventUptimeMs32: show.nativeEventUptimeMs32,
    eventThreadId: show.eventThreadId,
    windowLifeShow: show,
  })
  return raw
}

test('readable child and root SHOW events retain the original generation proof instead of trusting the current class', () => {
  for (const scope of ['child', 'root']) {
    const raw = directWindowShowEvidence(scope)
    assert(validateNativeWindowEvidence(raw, summary()))
    for (const [label, mutate] of [
      [
        'wrong current HWND',
        (value) => {
          value.events[1].hwnd = '0x99'
        },
      ],
      [
        'a console hidden in negative proof',
        (value) => {
          value.events[1].consoleCandidate = true
        },
      ],
      [
        'changed current class',
        (value) => {
          value.events[1].className = 'DifferentWindowClass'
        },
      ],
      [
        'source TID disagrees',
        (value) => {
          value.events[1].eventThreadId++
        },
      ],
      [
        'source native time disagrees',
        (value) => {
          value.events[1].nativeEventUptimeMs32++
        },
      ],
      [
        'current PID differs',
        (value) => {
          value.events[1].pid++
        },
      ],
      [
        'old console HWND observed only after reuse as a current nonconsole window',
        (value) => {
          const life = value.windowLifetimes.find(
            (item) => item.id === value.events[1].windowLifeShow.lifeId,
          )
          life.confirmation.callbackTick = life.retirement.nativeTick + 1
        },
      ],
      [
        'new HWND generation with old SHOW time',
        (value) => {
          const life = value.windowLifetimes.find(
            (item) => item.id === value.events[1].windowLifeShow.lifeId,
          )
          life.create.nativeTick = 151
          life.create.nativeEventUptimeMs32 = 151
          life.create.callbackTick = 152
          life.confirmation.callbackTick = 153
        },
      ],
      [
        'proof removed with counts zeroed',
        (value) => {
          value.events[1].windowLifeShow = null
          value.knownChildShowEvents = 0
          value.knownWindowShowEvents = 0
        },
      ],
    ]) {
      const invalid = structuredClone(raw)
      mutate(invalid)
      assert.throws(
        () => validateNativeWindowEvidence(invalid, summary()),
        undefined,
        label + ': ' + scope,
      )
    }
  }
  const guessedRoot = directWindowShowEvidence('root')
  guessedRoot.childShowEvidence.push(guessedRoot.events.pop().windowLifeShow)
  assert.throws(() => validateNativeChildLifetimes(guessedRoot), /Unreadable SHOW/)
  const omitted = rawWindows()
  omitted.events[0].windowLifeShow = null
  assert(
    validateNativeWindowEvidence(omitted, summary()),
    'Explicit null on an ordinary console event is not a child claim',
  )
})

test('an exited retained object is verified by native wait facts and exact lookup, never undefined exit bytes or not-found guesses', () => {
  const exited = childLifetimeEvidence()
  exited.childShowEvidence[0].proof.heldThreadWait = { result: 0, exitFileTime: '1200' }
  assert(validateNativeChildLifetimes(exited))
  exited.childShowEvidence[0].proof.heldProcessWait = { result: 0, exitFileTime: '1300' }
  assert(validateNativeChildLifetimes(exited))
  for (const [label, mutate] of [
    [
      'missing wait evidence',
      (raw) => {
        delete raw.childShowEvidence[0].proof.heldThreadWait
      },
    ],
    [
      'failed wait',
      (raw) => {
        raw.childShowEvidence[0].proof.heldThreadWait.result = 0xffffffff
      },
    ],
    [
      'exit before birth',
      (raw) => {
        raw.childShowEvidence[0].proof.heldThreadWait.exitFileTime = '1000'
      },
    ],
    [
      'undefined live exit time presented as evidence',
      (raw) => {
        raw.childShowEvidence[0].proof.heldThreadWait.result = 258
      },
    ],
    [
      'signaled process missing exit time',
      (raw) => {
        raw.childShowEvidence[0].proof.heldProcessWait.exitFileTime = null
      },
    ],
    [
      'invalid-parameter lookup mistaken for proof',
      (raw) => {
        raw.childShowEvidence[0].proof.currentThread = { status: 'not-found', win32Error: 87 }
      },
    ],
    [
      'access denied lookup mistaken for proof',
      (raw) => {
        raw.childShowEvidence[0].proof.currentThread = { status: 'not-found', win32Error: 5 }
      },
    ],
    [
      'fresh lookup reused thread birth',
      (raw) => {
        raw.childShowEvidence[0].proof.currentThread.threadCreationFileTime = '1200'
      },
    ],
    [
      'fresh lookup different PID',
      (raw) => {
        raw.childShowEvidence[0].proof.currentThread.pid = 102
      },
    ],
  ]) {
    const raw = structuredClone(exited)
    mutate(raw)
    assert.throws(() => validateNativeChildLifetimes(raw), undefined, label)
  }
})

test('native visibility replays negative-coordinate desktops and strict screen intersections', () => {
  const negativeMonitor = rawWindows()
  negativeMonitor.events[0].desktopRect = [-1920, -1080, 1920, 1080]
  negativeMonitor.events[0].rect = [-1800, -200, -1400, 100]
  assert(validateNativeWindowEvidence(negativeMonitor, summary()))
  negativeMonitor.events[0].rect = [-2100, -100, -1800, 100]
  assert(
    validateNativeWindowEvidence(negativeMonitor, summary()),
    'Partially intersecting negative monitor remains visible',
  )

  for (const rect of [
    [1920, 30, 2200, 150],
    [-2200, 0, -1920, 200],
    [0, -1300, 100, -1080],
    [0, 1080, 100, 1200],
    [2400, 1600, 2600, 1800],
  ]) {
    const offscreen = rawWindows()
    offscreen.sharedRecordCount++
    offscreen.events.push({
      ...offscreen.events[0],
      sequence: 2,
      elapsedMs: 40,
      kind: 'poll',
      productObservationInterval: true,
      positiveControlInterval: false,
      hwnd: '0x02',
      title: '',
      rect,
      desktopRect: [-1920, -1080, 1920, 1080],
      showEvent: false,
      intersectsDesktop: false,
      observedVisible: false,
    })
    assert(
      validateNativeWindowEvidence(offscreen, summary()),
      'Outside or tangent rectangles do not intersect',
    )
    const forged = structuredClone(offscreen)
    forged.events[1].intersectsDesktop = true
    assert.throws(
      () => validateNativeWindowEvidence(forged, summary()),
      /Recorded desktop intersection/,
    )
    const conservativeShow = structuredClone(offscreen)
    conservativeShow.events[1].showEvent = true
    conservativeShow.events[1].observedVisible = true
    assert.throws(
      () => validateNativeWindowEvidence(conservativeShow, summary()),
      /strictly equal/,
      'A console SHOW still invalidates a claimed zero-console result even if its later rectangle is offscreen',
    )
  }
  const forgedInside = rawWindows()
  forgedInside.events[0].intersectsDesktop = false
  assert.throws(
    () => validateNativeWindowEvidence(forgedInside, summary()),
    /Recorded desktop intersection/,
  )
  const offscreenControl = rawWindows()
  offscreenControl.events[0].rect = [1920, 0, 2200, 100]
  offscreenControl.events[0].intersectsDesktop = false
  assert.throws(
    () => validateNativeWindowEvidence(offscreenControl, summary()),
    /Raw window events/,
    'A SHOW event alone cannot prove the positive control was actually on screen',
  )
})

test('desktop observations require legal paired fields and cannot silently downgrade new evidence', () => {
  const historical = rawWindows()
  delete historical.events[0].desktopRect
  delete historical.events[0].intersectsDesktop
  const unchanged = JSON.stringify(historical)
  assert.throws(
    () => validateNativeWindowEvidence(historical, summary()),
    /Actual desktop bounds are required/,
  )
  assert(validateNativeWindowEvidence(historical, summary(), { allowLegacyDesktopBounds: true }))
  assert.equal(
    JSON.stringify(historical),
    unchanged,
    'Historical replay must not invent screen bounds',
  )
  for (const field of ['desktopRect', 'intersectsDesktop']) {
    const partial = rawWindows()
    delete partial.events[0][field]
    assert.throws(
      () => validateNativeWindowEvidence(partial, summary(), { allowLegacyDesktopBounds: true }),
      /present together/,
    )
  }
  const mixed = rawWindows()
  mixed.sharedRecordCount++
  mixed.events.push({ ...historical.events[0], sequence: 2, elapsedMs: 40 })
  assert.throws(
    () => validateNativeWindowEvidence(mixed, summary(), { allowLegacyDesktopBounds: true }),
    /Do not mix/,
  )
  for (const invalid of [
    null,
    [0, 0, 100],
    [0, 0, 0, 100],
    [1, 0, 0, 100],
    [0, 0, 100.5, 100],
    [0, 0, 2147483648, 100],
    ['0', 0, 100, 100],
  ]) {
    const malformed = rawWindows()
    malformed.events[0].desktopRect = invalid
    assert.throws(() => validateNativeWindowEvidence(malformed, summary()), /rectangle/)
  }
  const wrongType = rawWindows()
  wrongType.events[0].intersectsDesktop = 'true'
  assert.throws(() => validateNativeWindowEvidence(wrongType, summary()))
})

test('complete GUI acceptance requires every scenario and a two-diagram decode', () => {
  assert.equal(validateGuiReport(passing()).status, 'passed')
  const absent = passing()
  absent.steps.pop()
  assert.throws(() => validateGuiReport(absent))
  const omitted = passing()
  omitted.steps[3].operations.pop()
  assert.throws(() => validateGuiReport(omitted))
  const busy = passing()
  busy.steps[7].close.preDrained = true
  assert.throws(() => validateGuiReport(busy))
  const multi = passing()
  multi.steps[5].decodedImages.pop()
  assert.throws(() => validateGuiReport(multi))
  const toggledAgain = passing()
  toggledAgain.steps[7].pluginState.togglePerformed = true
  assert.throws(() => validateGuiReport(toggledAgain), /Only the first launch/)
  const reset = passing()
  reset.steps[7].pluginState.initialInventory[0].checked = 'false'
  assert.throws(() => validateGuiReport(reset))
})

test('optional frontend diagnostics cannot affect a baseline or bypass their own cleanup', () => {
  const baseline = { ...identity(), ...GUI_BASELINE, frontendBoundaryProbeRequested: true }
  assert.throws(() => validateGuiIdentity(baseline), /baseline cannot execute/)
  const report = passing()
  report.frontendBoundaryProbeRequested = true
  report.frontendBoundaryProbeSha256 = 'd'.repeat(64)
  report.frontendBoundaryProbe = {
    status: 'diagnostic-error',
    diagnosticOnly: true,
    cleanupConfirmed: true,
  }
  assert.equal(
    validateGuiReport(report).status,
    'passed',
    'Architecture diagnostics are not product acceptance',
  )
  report.frontendBoundaryProbe.cleanupConfirmed = false
  assert.throws(() => validateGuiReport(report), /cleanup must be verified/)
})

test('diagram geometry must preserve aspect and reachable wide content', () => {
  const layout = {
    width: 900,
    height: 150,
    naturalWidth: 900,
    naturalHeight: 150,
    containerWidth: 700,
    scrollWidth: 900,
    overflowX: 'auto',
  }
  assert(validateDiagramLayout({ layout: [layout] }))
  assert.throws(() => validateDiagramLayout({ layout: [{ ...layout, overflowX: 'hidden' }] }))
  assert.throws(() => validateDiagramLayout({ layout: [{ ...layout, height: 60 }] }))
  assert.throws(() => validateDiagramLayout({ layout: [{ ...layout, scrollWidth: 700 }] }))
  assert.equal((guiFixtures.multi.match(/```mermaid/g) ?? []).length, 2)
})

test('fixed-candidate GUI requires responsive fitting while legacy baseline stays observable', () => {
  const layout = {
    width: 900,
    height: 150,
    naturalWidth: 900,
    naturalHeight: 150,
    containerWidth: 700,
    scrollWidth: 900,
    overflowX: 'auto',
    rect: { left: 12, right: 912, width: 900, height: 150 },
    presentation: {
      rect: { left: 0 },
      clientWidth: 700,
      scrollWidth: 900,
      paddingLeft: 12,
      paddingRight: 12,
      borderLeft: 0,
    },
  }
  assert(validateDiagramLayout({ layout: [layout] }, false))
  assert.throws(() => validateDiagramLayout({ layout: [layout] }, true), /fits available/)
  const fitted = structuredClone(layout)
  fitted.width = fitted.rect.width = 676
  fitted.rect.right = 688
  fitted.height = fitted.rect.height = 676 / 6
  fitted.scrollWidth = fitted.presentation.scrollWidth = 700
  assert(validateDiagramLayout({ layout: [fitted] }, true))
})

test('current native cleanup and directory authority proofs are independently required', () => {
  const proof = {
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
    denialCount: 12,
  }
  const job = {
    started: { directoryAccess: proof },
    finished: {
      directoryAccess: proof,
      successful: true,
      resourceReleaseProven: true,
      resourceCleanupUncertain: false,
    },
  }
  assert(validateCurrentNativeResourceProof(job))
  for (const key of ['resourceReleaseProven', 'resourceCleanupUncertain']) {
    const bad = structuredClone(job)
    bad.finished[key] = !bad.finished[key]
    assert.throws(() => validateCurrentNativeResourceProof(bad))
  }
  const bad = structuredClone(job)
  bad.started.directoryAccess.aclProcessesStarted = true
  assert.throws(() => validateCurrentNativeResourceProof(bad))
})

test('GUI evidence names remain closed, bounded and explicitly separated from ordinary acceptance', () => {
  const root = mkdtempSync(join(tmpdir(), 'milkup-gui-evidence-'))
  try {
    const source = join(root, 'source')
    mkdirSync(source)
    const gui = Buffer.from(JSON.stringify({ ...identity(), status: 'failed' }))
    const audit = {
      source: 'a'.repeat(40),
      applicationCandidateSha: 'a'.repeat(40),
      harnessMode: 'gui-regression',
      status: 'failed',
      passwordInLogsFilesArgumentsOrEnvironment: false,
    }
    writeFileSync(join(source, 'windows-standard-product-audit.json'), JSON.stringify(audit))
    writeFileSync(join(source, 'gui-regression.json'), gui)
    writeFileSync(
      join(source, 'evidence-files.json'),
      JSON.stringify({
        schema: 1,
        files: [
          {
            relativePath: 'gui-regression.json',
            retainedName: 'gui-regression.json',
            bytes: gui.length,
            sha256: sha(gui),
          },
        ],
      }),
    )
    assert.equal(stageEvidence(source, join(root, 'staged'), audit.source).outerStatus, 'failed')
    delete audit.harnessMode
    writeFileSync(join(source, 'windows-standard-product-audit.json'), JSON.stringify(audit))
    assert.throws(
      () => stageEvidence(source, join(root, 'wrong-mode'), audit.source),
      /explicit separate mode/,
    )
    const wrapper = readFileSync(
      new URL('../../scripts/ci/run-windows-mermaid-product-e2e.ps1', import.meta.url),
      'utf8',
    )
    for (const name of GUI_EVIDENCE_NAMES.filter((name) => !name.endsWith('-window.png')))
      assert(wrapper.includes("'" + name + "'"), 'Native wrapper must retain ' + name)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('natural view observation duration satisfies the shared stability contract', () => {
  assert.equal(
    validateStableSamples(samples(naturalViewStabilityMs), {
      durationMs: naturalViewStabilityMs,
      imageCount: 1,
    }).durationMs,
    naturalViewStabilityMs,
  )
  assert.throws(() => validateStableSamples(samples(2000), { durationMs: 2000, imageCount: 1 }))
})

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
  validateCurrentNativeResourceProof,
  validateNativeDpiObservation,
} from './mermaid-gui-contract.mjs'
import {
  guiFixtures,
  validateDiagramLayout,
  inspectPersistedGuiPluginInventory,
  prepareGuiPluginState,
  captureGuiWindowMetrics,
} from './mermaid-gui-regression.mjs'
import { stageEvidence } from './stage-mermaid-evidence.mjs'

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
      displaySettingsChanged: false,
      pid,
      creationFileTime,
      hwnd: '0x42',
      className: 'Tauri Window',
      dpi,
      dpiAwareness: 2,
      dpiAwarenessContext: '0xfffffffffffffffc',
      observerThreadDpiAwareness: 0,
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
    if (name === 'resize-wide')
      step.operations = Array.from({ length: 6 }, () => ({
        nativeWindowChanged: true,
        settled: true,
        windowMetrics: windowMetrics(),
      }))
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

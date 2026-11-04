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
} from './mermaid-gui-contract.mjs'
import { guiFixtures, validateDiagramLayout } from './mermaid-gui-regression.mjs'
import { stageEvidence } from './stage-mermaid-evidence.mjs'

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex')
const identity = () => ({
  harnessMode: 'gui-regression',
  applicationCandidateSha: 'a'.repeat(40),
  harnessCandidateSha: 'a'.repeat(40),
  applicationSha256: 'b'.repeat(64),
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
  steps: GUI_STEPS.map((name) => {
    const step = { name, status: 'passed' }
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

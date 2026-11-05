import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  requireGuiStartup,
  stopAfterFatalGuiEvidence,
  captureGuiWindowMetrics,
  acceptNativePickerResults,
  blockDependentGuiScenarios,
} from './mermaid-gui-regression.mjs'
import { GUI_STEPS, validateWideInteraction } from './mermaid-gui-contract.mjs'
import { syntheticWideInteraction } from './mermaid-gui-test-fixtures.mjs'

test('failed native startup blocks dependent product scenarios without executing them', async () => {
  const startup = { name: GUI_STEPS[0], status: 'failed', error: 'visible native window absent' }
  const report = { status: 'running', steps: [startup] }
  let productOperations = 0
  if (requireGuiStartup(report, startup)) productOperations++
  assert.equal(productOperations, 0)
  assert.equal(report.status, 'blocked')
  assert.deepEqual(
    report.steps.map((step) => step.name),
    GUI_STEPS,
  )
  for (const step of report.steps.slice(1)) {
    assert.equal(step.status, 'blocked')
    assert.equal(step.executed, false)
    assert.equal(step.blockedBy, GUI_STEPS[0])
  }
  assert.equal(report.blockedPrerequisite.error, startup.error)
  assert.equal(report.blockedPrerequisite.productScenariosExecuted, false)
})

test('successful startup leaves later product tests enabled and does not manufacture outcomes', () => {
  const startup = { name: GUI_STEPS[0], status: 'passed' }
  const report = { status: 'running', steps: [startup] }
  assert.equal(requireGuiStartup(report, startup), true)
  assert.equal(report.steps.length, 1)
  assert.equal(report.blockedPrerequisite, undefined)
})

test('startup prerequisite cannot overwrite product scenarios that already executed', () => {
  const startup = { name: GUI_STEPS[0], status: 'failed' }
  const report = { steps: [startup, { name: GUI_STEPS[1], status: 'failed' }] }
  assert.throws(() => requireGuiStartup(report, startup), /before this prerequisite/)
})

test('a failed native picker stops dependent scenarios instead of reusing its remaining dialog', () => {
  const results = [
    { status: 'fulfilled', value: null },
    { status: 'rejected', reason: Error('owned picker remains open') },
  ]
  assert.throws(
    () => acceptNativePickerResults(results),
    (error) => error.nativeFilePickerFailure === true && error.message.includes('remains open'),
  )
  const prerequisite = { name: GUI_STEPS[1], status: 'failed', error: 'owned picker remains open' }
  const report = { steps: [{ name: GUI_STEPS[0], status: 'passed' }, prerequisite] }
  blockDependentGuiScenarios(report, prerequisite)
  assert.equal(report.steps[0].status, 'passed')
  assert.equal(report.steps[1].status, 'failed')
  assert(
    report.steps.slice(2).every((step) => step.status === 'blocked' && step.executed === false),
  )
  assert.equal(report.status, 'blocked')
})

test('native picker requires both the public menu click and actual native acceptance', () => {
  const accepted = { accepted: true, nativeSendInput: true }
  assert.equal(
    acceptNativePickerResults([{ status: 'fulfilled' }, { status: 'fulfilled', value: accepted }]),
    accepted,
  )
  for (const values of [
    [
      { status: 'rejected', reason: Error('click failed') },
      { status: 'fulfilled', value: accepted },
    ],
    [{ status: 'fulfilled' }, { status: 'fulfilled', value: { accepted: false } }],
  ])
    assert.throws(
      () => acceptNativePickerResults(values),
      (error) => error.nativeFilePickerFailure === true,
    )
})

test('native startup failure retains the still-readable DOM dimensions', async () => {
  const target = {},
    saved = []
  const dom = { innerWidth: 1028, innerHeight: 760, devicePixelRatio: 1 }
  await assert.rejects(
    () =>
      captureGuiWindowMetrics({
        target,
        readNative: async () => {
          throw Error('no native main window yet')
        },
        readDom: async () => dom,
        persist: async () => saved.push(structuredClone(target)),
        expectedPid: 1,
        expectedCreation: '1',
      }),
    /no native main window/,
  )
  assert.deepEqual(saved[0].windowMetrics.dom, dom)
  assert.equal(saved[0].windowMetrics.native, null)
  assert.equal(saved[0].windowMetrics.validation.status, 'failed')
})

test('wide interaction verifies readable natural pixels, scroll reachability and restored fit without rerender', () => {
  const valid = syntheticWideInteraction()
  const png = { sha256: valid.pngSha256, width: 3200, height: 160 }
  assert(validateWideInteraction(valid, png))
  for (const mutate of [
    (x) => {
      x.natural.image.width = 800
    },
    (x) => {
      x.natural.image.height = 40
    },
    (x) => {
      x.natural.image.sourceSha256 = 'f'.repeat(64)
    },
    (x) => {
      x.scrolled.requests.admitted++
    },
    (x) => {
      x.scrolled.viewport.scrollLeft = 0
    },
    (x) => {
      x.scrolled.viewport.scrollLeft = 50
    },
    (x) => {
      x.restored.viewport.scrollLeft = 100
    },
    (x) => {
      x.natural.outer.scrollWidth = 3200
    },
    (x) => {
      x.naturalPngSha256 = 'f'.repeat(64)
    },
    (x) => {
      x.restored.dirty = true
    },
    (x) => {
      x.exactBytesUnchanged = false
    },
  ]) {
    const bad = syntheticWideInteraction()
    mutate(bad)
    assert.throws(() => validateWideInteraction(bad, png))
  }
})

test('fatal renderer audit stops new native UI operations while keeping the run failed', () => {
  const report = { status: 'running', steps: [{ name: 'blank-start-enable', status: 'passed' }] }
  const row = {
    name: 'open-ordinary-stable',
    status: 'failed',
    error: 'Frontend connection failed at frame-load',
  }
  report.steps.push(row)
  assert.equal(stopAfterFatalGuiEvidence(report, row, Error(row.error)), true)
  assert.equal(report.status, 'failed')
  assert.equal(report.blockedPrerequisite.kind, 'fatal-runtime-evidence')
  assert(report.steps.slice(2).every((s) => s.executed === false && s.status === 'blocked'))
  assert.equal(row.error, 'Frontend connection failed at frame-load')
  const normal = { steps: [] }
  assert.equal(stopAfterFatalGuiEvidence(normal, {}, undefined), false)
  assert.deepEqual(normal.steps, [])
})

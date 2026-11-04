// Explicit, opt-in GUI regression. The existing product harness and its default
// acceptance are unchanged. This entry point is also usable against one pinned
// delivered beta.9 image; application and harness identities are never conflated.
import assert from 'node:assert/strict'
import { spawn, execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createHash } from 'node:crypto'
import { createServer } from 'node:net'
import { mkdir, readFile, writeFile, lstat, realpath, readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { StringDecoder } from 'node:string_decoder'
import { setTimeout as delay } from 'node:timers/promises'
import {
  AuditLedger,
  fixtures,
  observe,
  decodeScript,
  decodeWebDriverResponse,
  validateContext,
  validateProcessIdentities,
  validatePng,
  validateResponsiveDiagram,
  parseExpectedPluginInventory,
  inspectBundledPluginInventory,
  waitForBundledPluginInventory,
  waitForNativeJobs,
  stopOwnedProductAfterFailure,
} from './mermaid-product-e2e.mjs'
import {
  GUI_STEPS,
  validateGuiIdentity,
  validateStableSamples,
  validateGuiClose,
  validateGuiReport,
  validateCurrentNativeResourceProof,
  validateNativeWindowEvidence,
  validateNativeDpiObservation,
  validateNativeGuiResize,
  verifyGuiEvidence,
} from './mermaid-gui-contract.mjs'

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex')
const samePath = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase()
const AUDIT_PREFIX = 'MILKUP_MERMAID_NATIVE_AUDIT '
const PLUGIN = 'milkup.diagrams'

export async function captureGuiWindowMetrics({
  target,
  readNative,
  readDom,
  persist,
  expectedPid,
  expectedCreation,
}) {
  const measured = {
    capturedAt: new Date().toISOString(),
    native: null,
    dom: null,
    validation: { status: 'pending' },
  }
  // Attach before reading or validating: mismatched viewport and native bounds
  // are diagnostic evidence and must survive the assertion that rejects them.
  target.windowMetrics = measured
  try {
    measured.native = await readNative()
    measured.dom = await readDom()
    measured.relationship = validateNativeDpiObservation(measured, expectedPid, expectedCreation)
    measured.validation = { status: 'passed' }
    return measured
  } catch (error) {
    measured.validation = { status: 'failed', error: String(error) }
    throw error
  } finally {
    await persist()
  }
}

export function guiNativeResizeOperations(native) {
  const { width, height } = native.desktopRect ?? {}
  assert(Number.isInteger(width) && Number.isInteger(height), 'Actual native desktop dimensions')
  assert(width >= 900 && height >= 640, 'Existing desktop must fit distinct product window sizes')
  const narrow = { mode: 'normal', width: 800, height: 560 }
  const wide = {
    mode: 'normal',
    width: Math.min(1180, width - 64),
    height: Math.min(820, height - 88),
  }
  // The screen is never reconfigured. These are outer window sizes; actual
  // minimum-size enforcement and CSS/client bounds are measured afterward.
  if (wide.height <= narrow.height) wide.height = Math.min(height - 24, 600)
  assert(wide.width > narrow.width && wide.height > narrow.height)
  return [narrow, wide, { mode: 'maximize' }, { mode: 'restore' }, { ...narrow }, { ...wide }]
}

export function inspectPersistedGuiPluginInventory(cards, inventory) {
  assert(Array.isArray(cards), 'Actual persisted plugin cards required')
  assert(Array.isArray(inventory) && inventory.some((item) => item.id === PLUGIN))
  assert.equal(
    new Set(cards.map((item) => item.id)).size,
    cards.length,
    'Unique persisted plugin IDs',
  )
  const expected = new Set(inventory.map((item) => item.id))
  for (const card of cards) assert(expected.has(card.id), 'Unexpected persisted plugin: ' + card.id)
  const others = inventory.filter((item) => item.id !== PLUGIN)
  const observedOthers = others.length
    ? inspectBundledPluginInventory(
        cards.filter((item) => item.id !== PLUGIN),
        others,
      )
    : []
  const card = cards.find((item) => item.id === PLUGIN)
  if (!card || !observedOthers || cards.length !== inventory.length) return null
  assert.equal(card.checked, 'true', 'Diagrams must remain enabled after the owned restart')
  assert([null, 'false', 'true'].includes(card.busy), 'Actual persisted plugin busy state required')
  // An enabled card no longer has the pending-version label. Its installed
  // version is read through the real Details UI below, never inferred here.
  if (card.availableVersionText?.trim()) {
    assert.equal(
      card.availableVersionText.match(/^(\S+) · /)?.[1],
      inventory.find((item) => item.id === PLUGIN).version,
      'No unexpected pending version on the persisted Diagrams card',
    )
    return null
  }
  if (
    card.busy === 'true' ||
    card.switchDisabled !== false ||
    card.ariaDisabled === 'true' ||
    !(
      card.rect?.width > 0 &&
      card.rect?.height > 0 &&
      card.switchRect?.width > 0 &&
      card.switchRect?.height > 0
    )
  )
    return null
  return [
    { id: PLUGIN, checked: 'true', busy: card.busy, versionSource: 'details-required' },
    ...observedOthers,
  ]
}

export async function prepareGuiPluginState({
  phase,
  inventory,
  readState,
  readInstalledIdentity,
  pointer,
  closeMenu,
  guard = () => {},
  timeoutMs = 30000,
  pollIntervalMs = 100,
}) {
  assert(['fresh', 'persisted'].includes(phase), 'Explicit plugin startup phase required')
  const expected = parseExpectedPluginInventory(JSON.stringify(inventory))
  assert(
    expected?.some((item) => item.id === PLUGIN),
    'Exact expected Diagrams inventory required',
  )
  const waitPersisted = async () => {
    const deadline = performance.now() + timeoutMs
    do {
      guard()
      const current = await readState()
      const result = inspectPersistedGuiPluginInventory(current.cards, expected)
      if (result) return result
      await delay(pollIntervalMs)
    } while (performance.now() < deadline)
    throw Error('Timed out waiting for exact persisted plugin inventory')
  }
  const initialInventory =
    phase === 'fresh'
      ? (
          await waitForBundledPluginInventory(readState, expected, {
            guard,
            timeoutMs,
            pollIntervalMs,
          })
        ).observed
      : await waitPersisted()
  const record = { phase, initialInventory, togglePerformed: false }
  if (phase === 'fresh') {
    await pointer(`.plugin-summary-card[data-plugin-id="${PLUGIN}"] [role="switch"]`)
    record.togglePerformed = true
    // During the first enable, checked/busy and the pending offer may update
    // separately. Wait for the actual switch before enforcing persisted state.
    const deadline = performance.now() + timeoutMs
    do {
      guard()
      const card = (await readState()).cards.find((item) => item.id === PLUGIN)
      if (card?.checked === 'true') break
      assert(card?.checked === 'false', 'Observed first-enable switch state')
      assert(performance.now() < deadline, 'First-enable switch must settle')
      await delay(pollIntervalMs)
    } while (true)
  }
  await waitPersisted()
  await pointer(`.plugin-summary-card[data-plugin-id="${PLUGIN}"] [data-plugin-action="details"]`)
  const version = expected.find((item) => item.id === PLUGIN).version
  let text
  const detailsDeadline = performance.now() + timeoutMs
  do {
    guard()
    text = await readInstalledIdentity()
    if (text?.trim()) break
    assert(performance.now() < detailsDeadline, 'Actual plugin Details UI must appear')
    await delay(pollIntervalMs)
  } while (true)
  assert.equal(
    text?.trim(),
    `${PLUGIN} · v${version}`,
    'Actual enabled plugin identity/version from Details UI',
  )
  record.installedIdentity = { id: PLUGIN, version, text: text.trim(), source: 'public-details-ui' }
  await pointer('[data-plugin-action="back"]')
  record.finalInventory = await waitPersisted()
  await closeMenu()
  return record
}

export const guiFixtures = Object.freeze({
  ordinary: fixtures.ordinary,
  wide: fixtures.wide,
  multi:
    '# Two live diagrams\n\n```mermaid\nflowchart LR\nA[First] --> B[End]\n```\n\n```mermaid\nflowchart LR\nC[Second] --> D[End]\n```\n\nOutside both diagrams\n',
  busy: [
    '# Close during an admitted render',
    '',
    '```mermaid',
    'flowchart TB',
    ...Array.from({ length: 36 }, (_, i) => `B${i}[Busy render ${i}]`),
    ...Array.from({ length: 35 }, (_, i) => `B${i} --> B${i + 1}`),
    ...Array.from({ length: 30 }, (_, i) => `B${i} -.-> B${i + 5}`),
    '```',
    '',
    'Outside busy diagram',
    '',
  ].join('\n'),
})

// Public DOM observations only: no private application bridge or editor writes.
export const compactObserve = `
const e=document.querySelector('.milkup-editor'),r=x=>x?.getBoundingClientRect(),round=x=>Math.round(x*10)/10;
const visible=x=>{const b=r(x),s=x&&getComputedStyle(x);return !!b&&b.width>0&&b.height>0&&s.display!=='none'&&s.visibility!=='hidden'&&b.bottom>0&&b.top<innerHeight};
const imgs=[...document.querySelectorAll('[data-document-presentation] img')];
const images=imgs.filter(x=>x.complete&&x.naturalWidth>0&&x.currentSrc.startsWith('blob:'));
const boxes=[...document.querySelectorAll('[data-document-presentation]')];
return {mode:e?.dataset.mode,dirty:!!document.querySelector('[data-save-dot]')?.classList.contains('is-dirty'),
 path:document.querySelector('[data-stat="path"]')?.textContent??(document.querySelector('[data-title-path]')?.textContent+'/'+document.querySelector('[data-title]')?.textContent+'.md'),
 imageCount:images.length,imageSources:images.map(x=>x.currentSrc),
 sourceVisible:boxes.some(x=>x.dataset.documentPresentationStatus==='fallback')||[...document.querySelectorAll('.milkup-code-source')].some(x=>visible(x)&&/flowchart|C4Component/.test(x.textContent)),
 geometry:JSON.stringify({dpr:devicePixelRatio,editorWidth:round(r(e)?.width??0),images:images.map(x=>{const b=r(x);return [round(b.x),round(b.y),round(b.width),round(b.height),x.naturalWidth,x.naturalHeight]}),boxes:boxes.map(x=>[x.clientWidth,x.scrollWidth,x.clientHeight,x.scrollHeight])}),
 notices:JSON.stringify([...document.querySelectorAll('[data-document-presentation-notice]')].map(x=>x.textContent?.slice(0,300))),
 layout:images.map(x=>{const b=r(x),p=x.closest('[data-document-presentation]'),s=p&&getComputedStyle(p);return {width:b.width,height:b.height,naturalWidth:x.naturalWidth,naturalHeight:x.naturalHeight,rect:b.toJSON(),presentation:p?{rect:r(p).toJSON(),clientWidth:p.clientWidth,scrollWidth:p.scrollWidth,paddingLeft:parseFloat(s.paddingLeft)||0,paddingRight:parseFloat(s.paddingRight)||0,borderLeft:parseFloat(s.borderLeftWidth)||0}:null,containerWidth:p?.clientWidth,scrollWidth:p?.scrollWidth,overflowX:s?.overflowX}})};`

export function validateDiagramLayout(value, requireResponsiveFit = false) {
  assert(value.layout.length > 0)
  for (const image of value.layout) {
    if (requireResponsiveFit) {
      validateResponsiveDiagram(image)
      assert(image.containerWidth >= 200, 'Real editor presentation width required')
      continue
    }
    assert(image.width >= 32 && image.height >= 24, 'Diagram must have usable nonzero dimensions')
    assert(image.containerWidth >= 200, 'Real editor presentation width required')
    assert(image.width <= image.naturalWidth + 1, 'Do not upscale the renderer image')
    assert(
      Math.abs(image.width / image.height - image.naturalWidth / image.naturalHeight) < 0.02,
      'Display must preserve the rendered aspect ratio',
    )
    if (image.width > image.containerWidth + 1) {
      assert(
        ['auto', 'scroll'].includes(image.overflowX),
        'A wide diagram needs an actual scroll container',
      )
      assert(image.scrollWidth >= image.width - 1, 'Wide content must be reachable by scrolling')
    }
  }
  return true
}

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

async function plain(file) {
  for (let current = path.resolve(file); ; current = path.dirname(current)) {
    assert(!(await lstat(current)).isSymbolicLink(), 'No linked input or ancestor')
    if (path.dirname(current) === current) break
  }
  assert(samePath(await realpath(file), file))
}

class NativeRpc {
  constructor(child) {
    this.child = child
    this.waiting = new Map()
    this.nextId = 1
    this.stderr = ''
    this.closed = false
    const decoder = new StringDecoder('utf8')
    let pending = '',
      bytes = 0
    const fail = (error) => {
      this.error ??= error
      for (const request of this.waiting.values()) request.reject(error)
      this.waiting.clear()
    }
    child.once('error', fail)
    child.once('close', (code, signal) => {
      this.closed = true
      this.exitCode = code
      this.signal = signal
      if (this.waiting.size) fail(Error('Native observer exited before its acknowledgement'))
    })
    child.stdout.on('data', (chunk) => {
      try {
        bytes += chunk.length
        assert(bytes <= 2 * 1024 * 1024, 'Observer protocol output budget')
        pending += decoder.write(chunk)
        assert(pending.length <= 1024 * 1024, 'Observer protocol line budget')
        const lines = pending.split('\n')
        pending = lines.pop()
        for (const line of lines) {
          if (!line.trim()) continue
          const message = JSON.parse(line.replace(/^\uFEFF/, ''))
          const request = this.waiting.get(message.id)
          assert(request, 'Observer replied to an unknown command')
          this.waiting.delete(message.id)
          if (message.ok === true) request.resolve(message.result)
          else request.reject(Error('Native observer: ' + message.error))
        }
      } catch (error) {
        fail(error)
      }
    })
    child.stderr.on('data', (chunk) => {
      if (Buffer.byteLength(this.stderr) + chunk.length > 256 * 1024)
        fail(Error('Observer stderr overflow'))
      else this.stderr += chunk.toString('utf8')
    })
  }
  async call(command, fields = {}, timeoutMs = 20000) {
    if (this.error) throw this.error
    assert(!this.closed, 'Observer remains alive')
    const id = this.nextId++
    let timer
    try {
      return await new Promise((resolve, reject) => {
        timer = setTimeout(() => {
          this.waiting.delete(id)
          reject(Error('Native observer timeout: ' + command))
        }, timeoutMs)
        this.waiting.set(id, { resolve, reject })
        this.child.stdin.write(JSON.stringify({ id, command, ...fields }) + '\n')
      })
    } finally {
      clearTimeout(timer)
    }
  }
}

export async function main() {
  assert.equal(process.platform, 'win32', 'Real Windows only; unit tests do not call main')
  const required = (key) => {
    const value = process.env['MILKUP_WINDOWS_MERMAID_' + key]
    assert(value, 'Missing frozen wrapper input ' + key)
    return value
  }
  const application = path.resolve(required('APP')),
    evidence = path.resolve(required('EVIDENCE'))
  const work = path.resolve(required('WORK')),
    edgeDriver = path.resolve(required('EDGE_DRIVER'))
  const pwsh = path.resolve(required('PWSH')),
    processObserver = path.resolve(required('PROCESS_OBSERVER'))
  const expectedSid = required('EXPECTED_SID'),
    expectedSessionId = Number(required('EXPECTED_SESSION_ID'))
  const expectedAccountKind = required('EXPECTED_ACCOUNT_KIND')
  const runtimeVersion = required('RUNTIME_VERSION'),
    runtimeExe = path.resolve(required('RUNTIME_EXE'))
  const frontendBoundaryProbeRequested =
    process.env.MILKUP_WINDOWS_MERMAID_FRONTEND_BOUNDARY_PROBE === '1'
  const contextBytes = await readFile(path.join(evidence, 'standard-context.json'))
  const context = validateContext(
    JSON.parse(contextBytes.toString('utf8').replace(/^\uFEFF/, '')),
    expectedSid,
    expectedSessionId,
    expectedAccountKind,
  )
  assert(samePath(context.work, work) && samePath(context.evidence, evidence))
  for (const [environment, field] of [
    ['USERPROFILE', 'profile'],
    ['APPDATA', 'roamingAppData'],
    ['LOCALAPPDATA', 'localAppData'],
  ])
    assert(
      process.env[environment] && samePath(process.env[environment], context.knownFolders[field]),
    )
  const helperPath = path.join(
    path.dirname(processObserver),
    'run-windows-mermaid-gui-observer.ps1',
  )
  const helperSource = path.join(path.dirname(processObserver), 'WindowsMermaidGuiObserver.cs')
  for (const file of [
    application,
    evidence,
    work,
    edgeDriver,
    pwsh,
    processObserver,
    helperPath,
    helperSource,
    runtimeExe,
  ])
    await plain(file)
  assert.equal(hash(await readFile(application)), required('APP_SHA256'))
  const report = {
    schema: 1,
    status: 'running',
    harnessMode: required('HARNESS_MODE'),
    applicationCandidateSha: required('APPLICATION_CANDIDATE_SHA'),
    harnessCandidateSha: required('HARNESS_CANDIDATE_SHA'),
    application,
    applicationSha256: required('APP_SHA256'),
    installerSha256: process.env.MILKUP_WINDOWS_MERMAID_INSTALLER_SHA256 ?? null,
    harnessSha256: hash(await readFile(fileURLToPath(import.meta.url))),
    contractSha256: hash(await readFile(new URL('./mermaid-gui-contract.mjs', import.meta.url))),
    frontendBoundaryProbeRequested,
    context,
    contextSha256: hash(contextBytes),
    expectedAccountKind,
    startedAt: new Date().toISOString(),
    runtime: {
      version: runtimeVersion,
      executable: runtimeExe,
      sha256: hash(await readFile(runtimeExe)),
      installedEvergreen: true,
    },
    observerInputs: {
      scriptSha256: hash(await readFile(helperPath)),
      sourceSha256: hash(await readFile(helperSource)),
    },
    steps: [],
    launches: [],
    inputs: [],
    processIdentities: [],
    screenshotProofs: [],
    diagramProofs: [],
    logOverflow: false,
    nativeCleanupVerified: false,
    fixtureProofs: {},
    errors: [],
    boundaries: [
      'Product acceptance uses public UI; the separately opted-in frontend diagnostic alone creates owned frames and calls fixed read-only bridge_status.',
      'Self-authored fixtures only; no system IME or DPI matrix acceptance.',
      'Application source and harness source are independently identified.',
      'A failed baseline remains failed; outer account cleanup does not establish product cleanup.',
    ],
  }
  report.identityKind = validateGuiIdentity(report)
  if (frontendBoundaryProbeRequested) {
    assert.equal(report.identityKind, 'current-candidate')
    report.frontendBoundaryProbeSha256 = hash(
      await readFile(new URL('./mermaid-frontend-boundary-probe.mjs', import.meta.url)),
    )
  }
  const ledger = new AuditLedger(expectedSid, expectedSessionId, expectedAccountKind)
  const productLogs = new Map()
  const reportFile = path.join(evidence, 'gui-regression.json')
  await writeFile(reportFile, '{}\n', { flag: 'wx' })
  const persist = async () => {
    const auditBytes = Buffer.from(JSON.stringify(ledger.events) + '\n')
    assert(auditBytes.length <= 2 * 1024 * 1024, 'Bounded native audit evidence')
    await writeFile(path.join(evidence, 'gui-native-audit.json'), auditBytes)
    report.nativeAudit = {
      file: 'gui-native-audit.json',
      sha256: hash(auditBytes),
      events: ledger.events.length,
    }
    const bytes = Buffer.from(JSON.stringify(report) + '\n')
    assert(bytes.length <= 1024 * 1024, 'GUI report remains within wrapper read budget')
    await writeFile(reportFile, bytes)
  }
  const fixtureRoot = path.join(work, 'gui-fixtures'),
    profileRoot = path.join(work, 'gui-profiles')
  await mkdir(fixtureRoot)
  await mkdir(profileRoot)
  const files = {}
  for (const [name, source] of Object.entries(guiFixtures)) {
    files[name] = path.join(fixtureRoot, `gui-${name}-中文.md`)
    await writeFile(files[name], source, { flag: 'wx' })
    await writeFile(path.join(evidence, `fixture-gui-${name}.md`), source, { flag: 'wx' })
    report.fixtureProofs[name] = { bytes: Buffer.byteLength(source), sha256: hash(source) }
  }
  for (const root of new Set([
    context.knownFolders.roamingAppData,
    context.knownFolders.localAppData,
  ])) {
    const entries = await readdir(path.join(root, 'app.milkup.desktop')).catch((error) => {
      if (error.code === 'ENOENT') return []
      throw error
    })
    assert.equal(entries.length, 0, 'Fresh product profile only')
  }
  const driverPort = await freePort(),
    births = new Map()
  let driver,
    product,
    launch,
    session,
    observer,
    fatal,
    driverClosed = false,
    driverLog = ''
  const guard = () => {
    if (fatal) throw fatal
    assert(!report.logOverflow, 'Bounded logs must be complete')
    if (driver && (driver.exitCode !== null || driver.signalCode !== null))
      throw Error('Owned EdgeDriver exited')
    if (product && (product.exitCode !== null || product.signalCode !== null))
      throw Error('Owned product exited unexpectedly')
  }
  const until = async (check, label, timeoutMs = 45000, checkGuard = true) => {
    const deadline = performance.now() + timeoutMs
    do {
      if (checkGuard) guard()
      const value = await check()
      if (value) return value
      await delay(100)
    } while (performance.now() < deadline)
    throw Error('Timed out: ' + label)
  }
  const request = async (method, route, body, timeoutMs = 15000) => {
    const response = await fetch(`http://127.0.0.1:${driverPort}${route}`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    })
    return decodeWebDriverResponse(await response.text(), response.status)
  }
  const execute = (script, ...args) =>
    request('POST', `/session/${session}/execute/sync`, { script, args })
  const state = () => execute(observe)
  const measureWindow = (target) =>
    captureGuiWindowMetrics({
      target,
      readNative: () => observer.call('measureProduct'),
      readDom: () =>
        execute(
          'return {innerWidth,innerHeight,devicePixelRatio,screenAvailWidth:screen.availWidth,screenAvailHeight:screen.availHeight}',
        ),
      persist,
      expectedPid: product.pid,
      expectedCreation: launch.identity.creationFileTime,
    })
  const compact = async (started = performance.now()) => {
    const value = await execute(compactObserve)
    const jobs = [...ledger.jobs.values()].filter((job) => job.productPid === product.pid)
    return {
      ...value,
      imageSources: hash(JSON.stringify(value.imageSources)),
      elapsedMs: Math.round(performance.now() - started),
      pending: ledger.pending(product.pid),
      admitted: jobs.length,
    }
  }
  const identities = async (includeProduct = true) => {
    const expected = new Map([[process.pid, process.execPath]])
    if (driver) expected.set(driver.pid, edgeDriver)
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
      { windowsHide: true, timeout: 15000, maxBuffer: 1024 * 1024, encoding: 'utf8' },
    )
    const values = JSON.parse(stdout.replace(/^\uFEFF/, ''))
    validateProcessIdentities(
      values,
      expected,
      expectedSid,
      expectedSessionId,
      births,
      expectedAccountKind,
    )
    report.processIdentities.push({ at: new Date().toISOString(), values })
    return values
  }
  const pointer = async (selector, beforeDispatch) => {
    for (let attempt = 0; attempt < 20; attempt++) {
      const target = await execute(
        `const e=document.querySelector(arguments[0]);if(!e)return null;const r=e.getBoundingClientRect(),x=(r.left+r.right)/2,y=(r.top+r.bottom)/2,h=document.elementFromPoint(x,y);let p=e.parentElement;while(p&&!(p.scrollHeight>p.clientHeight+1&&/(auto|scroll)/.test(getComputedStyle(p).overflowY)))p=p.parentElement;const b=p?.getBoundingClientRect();return {x,y,hit:!!h&&(h===e||e.contains(h)),disabled:!!e.disabled,scroll:b?{x:(b.left+b.right)/2,y:(b.top+b.bottom)/2,top:b.top}:null}`,
        selector,
      )
      assert(target && !target.disabled, 'Actual enabled UI target ' + selector)
      if (!target.hit) {
        assert(target.scroll, 'UI target can be revealed with real wheel input')
        await request('POST', `/session/${session}/actions`, {
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
                  duration: 100,
                },
              ],
            },
          ],
        })
        continue
      }
      beforeDispatch?.()
      report.inputs.push({
        at: new Date().toISOString(),
        selector,
        kind: 'W3C-pointer',
        x: target.x,
        y: target.y,
      })
      return request('POST', `/session/${session}/actions`, {
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
                duration: 20,
              },
              { type: 'pointerDown', button: 0 },
              { type: 'pointerUp', button: 0 },
            ],
          },
        ],
      })
    }
    throw Error('UI target did not become pointer-accessible: ' + selector)
  }
  const closeMenu = async () => {
    if ((await state()).menu) await pointer('[data-menu-close]')
  }
  const preparePlugin = async (phase) => {
    if (!(await state()).menu) await pointer('[data-menu-toggle]')
    await pointer('[data-menu-section="plugins"]')
    const inventory = parseExpectedPluginInventory(
      process.env.MILKUP_WINDOWS_MERMAID_EXPECTED_PLUGIN_INVENTORY,
    )
    return prepareGuiPluginState({
      phase,
      inventory,
      readState: state,
      readInstalledIdentity: () =>
        execute("return document.querySelector('.plugin-detail-heading p')?.textContent??null"),
      pointer,
      closeMenu,
      guard,
    })
  }
  const startProduct = async (name) => {
    assert(!product, 'Previous held product must be retired')
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
    await observer.call('phase', { name: 'product-' + name })
    product = spawn(application, [], { stdio: ['ignore', 'pipe', 'pipe'], env })
    launch = {
      name,
      productPid: product.pid,
      arguments: [],
      startedAt: new Date().toISOString(),
      profile,
    }
    report.launches.push(launch)
    const current = launch
    productLogs.set(current.productPid, '')
    product.once('error', (error) => {
      fatal = error
    })
    product.once('exit', (exitCode, signal) =>
      Object.assign(current, {
        exitCode,
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
        if (
          Buffer.byteLength(productLogs.get(current.productPid)) + Buffer.byteLength(text) >
          512 * 1024
        ) {
          report.logOverflow = true
          return
        }
        productLogs.set(current.productPid, productLogs.get(current.productPid) + text)
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
    const owned = (await identities()).find((value) => value.pid === product.pid)
    current.identity = owned
    await observer.call('setProduct', {
      pid: product.pid,
      image: application,
      creationFileTime: owned.creationFileTime,
    })
    await until(
      () =>
        fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1000) }).then(
          (response) => response.ok,
          () => false,
        ),
      'Owned WebView startup',
      60000,
    )
    const attached = await request(
      'POST',
      '/session',
      {
        capabilities: {
          alwaysMatch: {
            browserName: 'webview2',
            'ms:edgeChromium': true,
            'ms:edgeOptions': { debuggerAddress: `127.0.0.1:${port}` },
          },
        },
      },
      60000,
    )
    session = attached.sessionId
    assert(session)
    assert.equal(attached.capabilities?.browserVersion, runtimeVersion)
    current.windowRect = await request('GET', `/session/${session}/window/rect`)
    assert(current.windowRect.width >= 640 && current.windowRect.height >= 480)
    await until(async () => {
      const value = await state()
      return ['idle', 'ready'].includes(value.loading) && value.editor?.width > 0
    }, 'Blank startup ready')
    const initial = await state()
    assert(
      (initial.protocol === 'tauri:' && initial.hostname === 'localhost') ||
        (['http:', 'https:'].includes(initial.protocol) && initial.hostname === 'tauri.localhost'),
    )
    assert.equal(initial.visibility, 'visible')
    assert.equal(initial.developmentProbe, 'undefined')
    assert.equal(initial.diagnostics, 'undefined')
    assert.equal(
      initial.mode,
      'live',
      'Measure natural initial live mode without forced mode/zoom changes',
    )
    current.initial = {
      mode: initial.mode,
      path: initial.path,
      devicePixelRatio: initial.devicePixelRatio,
    }
    await measureWindow(current)
    await persist()
  }
  const openFile = async (name) => {
    if (!(await state()).menu) await pointer('[data-menu-toggle]')
    await pointer('[data-menu-section="file"]')
    const picker = observer.call('chooseFile', { path: files[name] }, 30000)
    // The native chooser may keep the WebDriver click pending until selection.
    const results = await Promise.allSettled([pointer('[data-command="open-sample"]'), picker])
    for (const result of results) if (result.status === 'rejected') throw result.reason
    const selection = results[1].value
    assert.equal(selection.accepted, true, 'Actual owned native file picker accepted exact fixture')
    await until(async () => {
      const value = await state()
      return value.loading === 'ready' && value.path && samePath(value.path, files[name])
    }, 'Actual menu-open document path')
    assert.equal((await state()).mode, 'live')
    return selection
  }
  const settle = async (count = 1) => {
    let stable, since
    return until(
      async () => {
        const value = await compact()
        if (value.imageCount !== count || value.pending !== 0 || value.sourceVisible) {
          stable = undefined
          return false
        }
        const key = [value.geometry, value.imageSources, value.admitted].join(':')
        if (key !== stable) {
          stable = key
          since = performance.now()
          return false
        }
        if (performance.now() - since < 1500) return false
        validateDiagramLayout(value, report.identityKind === 'current-candidate')
        return value
      },
      'Decoded diagrams and native work settle',
      60000,
    )
  }
  const decodeImages = async (name, expected = 1) => {
    const images = (await state()).images
    assert.equal(images.length, expected)
    const results = []
    const script = decodeScript
      .replace(
        'const supplied=arguments[0],done=',
        'const supplied=arguments[0],index=arguments[1],done=',
      )
      .replace("if(images.length!==1)throw Error('Exactly one accepted diagram required');", '')
      .replace(
        'const image=images.find(e=>e.complete&&e.naturalWidth>0);',
        'const image=images[index];',
      )
    for (let index = 0; index < expected; index++) {
      const decoded = await request(
        'POST',
        `/session/${session}/execute/async`,
        { script, args: [null, index] },
        30000,
      )
      assert.equal(decoded.ok, true, decoded.error)
      const { base64, ...data } = decoded.value
      const bytes = Buffer.from(base64, 'base64'),
        png = validatePng(bytes)
      assert.equal(data.width, png.width)
      assert.equal(data.height, png.height)
      const nativeMatch = ledger.matchPng(product.pid, png)
      results.push({ ...data, ...png, nativeMatch })
      if (
        (index === 0 && ['ordinary', 'wide', 'multi'].includes(name)) ||
        (name === 'multi' && index === 1)
      ) {
        const file = index === 1 ? 'gui-multi-2-diagram.png' : `gui-${name}-diagram.png`
        await writeFile(path.join(evidence, file), bytes)
        report.diagramProofs = report.diagramProofs.filter((item) => item.file !== file)
        report.diagramProofs.push({ file, bytes: bytes.length, sha256: hash(bytes) })
      }
    }
    return results
  }
  const exactBytes = async (name) => {
    assert(
      (await readFile(files[name])).equals(Buffer.from(guiFixtures[name])),
      'Document source remains byte-exact',
    )
    return true
  }
  const stability = async (row, durationMs, imageCount = 1) => {
    row.samples = []
    const started = performance.now()
    do {
      const sample = await compact(started)
      delete sample.layout
      row.samples.push(sample)
      if (row.samples.length % 20 === 0) await persist()
      if (sample.elapsedMs - row.samples[0].elapsedMs >= durationMs) break
      await delay(250)
    } while (true)
    // Validate after collecting the entire interval, retaining fallback/churn
    // evidence rather than abandoning the baseline after its first bad sample.
    return validateStableSamples(row.samples, { durationMs, imageCount })
  }
  const screenshot = async (name) => {
    const bytes = Buffer.from(await request('GET', `/session/${session}/screenshot`), 'base64')
    validatePng(bytes, 32 * 1024 * 1024)
    const file = `gui-${name}-window.png`
    await writeFile(path.join(evidence, file), bytes, { flag: 'wx' })
    report.screenshotProofs.push({ file, bytes: bytes.length, sha256: hash(bytes) })
  }
  const closeProduct = async (kind, row) => {
    assert(product, 'Held product exists')
    const current = product,
      record = launch,
      pid = current.pid
    const close = (row.close = {
      kind,
      productPid: pid,
      preDrained: false,
      pendingAtClick: 0,
      pendingRequestIds: [],
      realUiCloseRequested: false,
      deadlineMs: 15000,
      forcedTermination: false,
      errors: [],
    })
    let clickedAt
    try {
      if (kind === 'idle') {
        await waitForNativeJobs(
          ledger,
          pid,
          () => current.exitCode === null && current.signalCode === null,
        )
        close.preDrained = true
      }
      await closeMenu()
      assert.equal(
        (await state()).dirty,
        false,
        'No discard prompt for unchanged authored fixtures',
      )
      const capture = row.name === 'failure-cleanup' ? 'failure-cleanup' : kind + '-close'
      await screenshot(capture)
      row.screenshot = `gui-${capture}-window.png`
      try {
        await pointer('[data-window-control="close"]', () => {
          close.pendingRequestIds = [...ledger.jobs.values()]
            .filter((job) => job.productPid === pid && !job.finished)
            .map((job) => job.requestId)
          close.pendingAtClick = close.pendingRequestIds.length
          clickedAt = performance.now()
          close.clickedAt = new Date().toISOString()
          close.realUiCloseRequested = true
        })
      } catch (error) {
        close.actionResponseError = String(error)
      }
      assert(clickedAt !== undefined, 'Real pointer close was dispatched')
      const deadline = clickedAt + 15000
      while (
        current.exitCode === null &&
        current.signalCode === null &&
        performance.now() < deadline
      )
        await delay(50)
      close.exitedWithinDeadline =
        Number.isFinite(record.exitObservedMonotonicMs) &&
        record.exitObservedMonotonicMs <= deadline
      assert.equal(
        close.exitedWithinDeadline,
        true,
        'Original 15-second held-process close deadline',
      )
      await until(() => !!record.stdioClosedAt, 'Product stdio EOF', 10000, false)
      close.stdioDrained = true
      close.exitCode = current.exitCode
      close.signal = current.signalCode
      assert.equal(close.exitCode, 0)
      assert.equal(close.signal, null)
      close.nativeRequests = ledger.verifyAll(pid).map((job) => ({
        requestId: job.requestId,
        successful: job.finished.successful,
        cleanupVerified: true,
      }))
      close.innerCleanupVerified = true
      validateGuiClose(close, kind)
    } catch (error) {
      close.errors.push(String(error))
    } finally {
      if (current.exitCode === null && current.signalCode === null) {
        try {
          const stopped = await stopOwnedProductAfterFailure({
            current,
            expectedPid: pid,
            observeIdentity: () => identities(),
            verifyIdentity: () => {},
          })
          close.forcedTermination = stopped.forcedTermination
        } catch (error) {
          close.errors.push('Owned fallback: ' + error)
          close.outerTerminationRequired = true
        }
      }
      try {
        await until(() => !!record.stdioClosedAt, 'Failure cleanup stdio EOF', 10000, false)
      } catch (error) {
        close.errors.push(String(error))
      }
      if (session) {
        try {
          await request('DELETE', `/session/${session}`, undefined, 5000)
        } catch (error) {
          close.detachError = String(error)
        }
        session = undefined
      }
      await writeFile(path.join(evidence, `${record.name}-product.log`), productLogs.get(pid) ?? '')
      if (record.stdioClosedAt) productLogs.delete(pid)
      product = undefined
      launch = undefined
      await persist()
    }
    validateGuiClose(close, kind)
  }
  const step = async (name, action) => {
    const row = { name, status: 'running', startedAt: new Date().toISOString() }
    report.steps.push(row)
    await observer.call('phase', { name })
    try {
      await action(row)
      row.status = 'passed'
    } catch (error) {
      row.status = 'failed'
      row.error = String(error)
      report.errors.push(name + ': ' + error)
    } finally {
      if (session && product && product.exitCode === null) {
        try {
          await screenshot(name)
          row.screenshot = `gui-${name}-window.png`
        } catch (error) {
          row.screenshotError = String(error)
          row.status = 'failed'
          report.errors.push(name + ': Required screenshot failed: ' + error)
        }
      }
      row.finishedAt = new Date().toISOString()
      await persist()
    }
    return row
  }
  try {
    observer = new NativeRpc(
      spawn(
        pwsh,
        [
          '-NoLogo',
          '-NoProfile',
          '-File',
          helperPath,
          '-NodePath',
          process.execPath,
          '-EvidenceDirectory',
          evidence,
          '-FixtureRoot',
          fixtureRoot,
          '-ExpectedSid',
          expectedSid,
          '-ExpectedSessionId',
          String(expectedSessionId),
          '-ExpectedAccountKind',
          expectedAccountKind,
        ],
        { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true },
      ),
    )
    report.observerStart = await observer.call('start')
    report.positiveControl = await observer.call('positiveControl', {}, 30000)
    assert.equal(
      report.positiveControl.detectedVisible,
      true,
      'Observer must detect a deliberately visible console on this same real desktop',
    )
    driver = spawn(
      edgeDriver,
      [
        `--port=${driverPort}`,
        '--log-level=WARNING',
        `--log-path=${path.join(evidence, 'edgedriver-native.log')}`,
      ],
      { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true },
    )
    driver.once('error', (error) => {
      fatal = error
    })
    driver.once('close', () => {
      driverClosed = true
    })
    for (const stream of [driver.stdout, driver.stderr])
      stream.on('data', (bytes) => {
        if (Buffer.byteLength(driverLog) + bytes.length > 512 * 1024) report.logOverflow = true
        else driverLog += bytes.toString('utf8')
      })
    await until(
      () =>
        request('GET', '/status').then(
          () => true,
          () => false,
        ),
      'EdgeDriver ready',
      15000,
    )
    let probeCleanupFailure
    await step('blank-start-enable', async (row) => {
      await startProduct('gui-idle')
      if (frontendBoundaryProbeRequested) {
        try {
          const { runFrontendBoundaryProbe } = await import('./mermaid-frontend-boundary-probe.mjs')
          report.frontendBoundaryProbe = await runFrontendBoundaryProbe({ request, session })
          assert.equal(
            report.frontendBoundaryProbe.cleanupConfirmed,
            true,
            'Optional probe must remove its own frames and restore the main frame',
          )
        } catch (error) {
          probeCleanupFailure = error
          report.frontendBoundaryProbe = {
            status: 'cleanup-or-main-frame-unconfirmed',
            cleanupConfirmed: false,
            error: String(error),
            diagnosticOnly: true,
          }
          throw error
        }
      }
      row.pluginState = await preparePlugin('fresh')
      row.arguments = []
      row.modeAndZoomUnchanged = true
    })
    if (probeCleanupFailure) throw probeCleanupFailure
    for (const name of ['ordinary', 'wide'])
      await step(`open-${name}-stable`, async (row) => {
        row.picker = await openFile(name)
        row.nativePickerAccepted = true
        row.layout = (await settle()).layout
        row.png = (await decodeImages(name))[0]
        row.exactBytesUnchanged = await exactBytes(name)
        await stability(row, 75000)
        row.finalPng = (await decodeImages(name))[0]
        assert.equal(row.finalPng.sha256, row.png.sha256)
      })
    await step('resize-wide', async (row) => {
      row.operations = []
      row.initialNativeWindow = await observer.call('measureProduct')
      for (const operation of guiNativeResizeOperations(row.initialNativeWindow)) {
        const item = { operation, settled: false }
        row.operations.push(item)
        item.nativeControl = await observer.call('resizeProduct', operation, 10000)
        item.before = item.nativeControl.before.windowRect
        item.after = item.nativeControl.after.windowRect
        item.nativeWindowChanged =
          item.before.width !== item.after.width || item.before.height !== item.after.height
        await persist()
        assert(item.nativeWindowChanged, 'Native window dimensions must actually change')
        item.layout = (await settle()).layout
        await measureWindow(item)
        validateNativeGuiResize(item, product.pid, launch.identity.creationFileTime)
        await stability(item, 10000)
        item.settled = true
      }
    })
    await step('repeat-document-open', async (row) => {
      row.opens = []
      for (const name of ['ordinary', 'wide', 'ordinary']) {
        const item = { name }
        row.opens.push(item)
        item.picker = await openFile(name)
        item.nativePickerAccepted = true
        item.layout = (await settle()).layout
        await stability(item, 3000)
        item.stable = true
        item.exactBytesUnchanged = await exactBytes(name)
      }
    })
    await step('multi-diagram', async (row) => {
      row.picker = await openFile('multi')
      row.nativePickerAccepted = true
      row.layout = (await settle(2)).layout
      row.decodedImages = await decodeImages('multi', 2)
      await stability(row, 10000, 2)
      row.exactBytesUnchanged = await exactBytes('multi')
    })
    await step('idle-close', (row) => closeProduct('idle', row))
    await step('busy-close', async (row) => {
      await startProduct('gui-busy')
      row.pluginState = await preparePlugin('persisted')
      row.picker = await openFile('busy')
      await until(
        () => ledger.pending(product.pid) > 0,
        'Actually admitted in-flight native render',
        15000,
      )
      await closeProduct('busy', row)
    })
  } catch (error) {
    report.errors.push(String(error))
    if (!report.positiveControl?.detectedVisible) report.status = 'blocked'
  } finally {
    if (product) {
      const cleanup = { name: 'failure-cleanup' }
      report.failureCleanup = cleanup
      try {
        await closeProduct('idle', cleanup)
      } catch (error) {
        report.errors.push('Failure close: ' + error)
      }
    }
    try {
      const jobs = ledger.verifyAll()
      if (report.identityKind === 'current-candidate')
        for (const job of jobs) validateCurrentNativeResourceProof(job)
      report.nativeCleanupVerified = true
    } catch (error) {
      report.errors.push('Native final verification: ' + error)
    }
    if (driver) {
      try {
        await identities(false)
        driver.kill()
        await until(() => driverClosed, 'Held driver exit and stdio EOF', 10000, false)
      } catch (error) {
        report.errors.push('Driver cleanup: ' + error)
      }
    }
    if (observer) {
      try {
        report.observerSummary = await observer.call('stop', {}, 30000)
        const windowBytes = await readFile(path.join(evidence, 'native-window-events.json'))
        assert(windowBytes.length <= 2 * 1024 * 1024)
        report.nativeWindowEvidence = {
          file: 'native-window-events.json',
          sha256: hash(windowBytes),
          bytes: windowBytes.length,
        }
        observer.child.stdin.end()
        await until(() => observer.closed, 'Observer final exit', 10000, false)
        assert.equal(observer.exitCode, 0)
      } catch (error) {
        report.errors.push('Observer finalization: ' + error)
      }
      await writeFile(path.join(evidence, 'gui-observer-stderr.log'), observer.stderr)
    }
    await writeFile(path.join(evidence, 'edgedriver-stdio.log'), driverLog)
    try {
      if (fatal) throw fatal
      validateGuiReport(report)
      validateNativeWindowEvidence(
        JSON.parse(await readFile(path.join(evidence, 'native-window-events.json'), 'utf8')),
        report.observerSummary,
      )
      assert.deepEqual(report.errors, [])
      report.status = 'passed'
      await persist()
      verifyGuiEvidence(
        report,
        await readFile(path.join(evidence, 'gui-native-audit.json')),
        await readFile(path.join(evidence, 'native-window-events.json')),
      )
    } catch (error) {
      report.errors.push('Final contract: ' + error)
      if (report.status !== 'blocked') report.status = 'failed'
    }
    report.finishedAt = new Date().toISOString()
    await persist()
  }
  console.log(
    JSON.stringify({
      status: report.status,
      applicationCandidateSha: report.applicationCandidateSha,
      harnessCandidateSha: report.harnessCandidateSha,
      steps: report.steps.map(({ name, status }) => ({ name, status })),
    }),
  )
  if (report.status !== 'passed') process.exitCode = report.status === 'blocked' ? 77 : 1
  return report
}

if (process.argv[1] && samePath(fileURLToPath(import.meta.url), process.argv[1]))
  main().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })

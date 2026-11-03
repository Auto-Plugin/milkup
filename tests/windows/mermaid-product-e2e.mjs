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

export function validateContext(context, expectedSid, expectedSessionId) {
  assert.equal(context.status, 'ready', 'Standard-context readiness')
  assert.equal(context.actualSid, expectedSid, 'Actual standard actor SID')
  assert.equal(context.expectedSid, expectedSid)
  assert.equal(context.pureStandard, true, 'No administrator membership, including deny-only')
  assert.equal(context.interactive, true, 'Actual interactive desktop available')
  assert(
    Number.isSafeInteger(expectedSessionId) && expectedSessionId > 0,
    'Non-service Windows session',
  )
  assert.equal(context.sessionId, expectedSessionId)
  assert.equal(context.expectedSessionId, expectedSessionId)
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
    assert.equal(value.token?.sid, expectedSid)
    assert.equal(value.token?.sessionId, expectedSessionId)
    assert.equal(value.token?.pureStandardUser, true)
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

export class AuditLedger {
  constructor(expectedSid) {
    this.expectedSid = expectedSid
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
  verifyOwnership(value) {
    for (const field of ['hostSid', 'childSid', 'browserSid'])
      assert.equal(value[field], this.expectedSid, `Same-login ${field}`)
    for (const field of [
      'hostPureStandard',
      'appContainer',
      'zeroCapabilities',
      'browserAppContainer',
      'browserZeroCapabilities',
      'browserInOwnedJob',
    ]) {
      assert.equal(value[field], true, `Native ${field}`)
    }
    assert(Number.isSafeInteger(value.browserPid) && value.browserPid > 0, 'Observed browser PID')
  }
  verifyFinished(job) {
    const finish = job.finished
    assert(finish, 'Native completion audit required; outer process termination is insufficient')
    assert.equal(finish.hostSid, this.expectedSid)
    assert.equal(finish.hostPureStandard, true)
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
      for (const field of ['childSid', 'browserSid', 'browserPid'])
        assert.equal(finish[field], null, 'No identity for an uncreated helper/browser')
      for (const field of [
        'appContainer',
        'zeroCapabilities',
        'browserAppContainer',
        'browserZeroCapabilities',
        'browserInOwnedJob',
      ])
        assert.equal(finish[field], false, 'No ownership claims for an uncreated helper/browser')
    }
    if (job.started || finish.successful || (!finish.cancelled && !finish.deadlineExpired)) {
      assert(job.started, 'Rendering requires actual ready/ownership audit')
      this.verifyOwnership(finish)
      assert.equal(finish.browserPid, job.started.browserPid)
      assert.equal(finish.ownedJobCreated, true)
      assert.equal(finish.profileCreated, true)
    } else if (finish.ownedJobCreated) {
      assert.equal(finish.childSid, this.expectedSid)
      assert.equal(finish.appContainer, true)
      assert.equal(finish.zeroCapabilities, true)
      if (finish.browserSid !== null) this.verifyOwnership(finish)
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
 cards:[...document.querySelectorAll('.plugin-summary-card[data-plugin-id]')].map(e=>({id:e.dataset.pluginId,text:e.textContent,checked:e.querySelector('[role="switch"]')?.getAttribute('aria-checked'),busy:e.querySelector('[role="switch"]')?.getAttribute('aria-busy'),rect:rect(e)})),
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
  const runId = required('RUN_ID'),
    candidateSha = required('CANDIDATE_SHA')
  const processObserver = path.resolve(required('PROCESS_OBSERVER')),
    pwsh = path.resolve(required('PWSH'))
  const expectedBinarySha = required('APP_SHA256'),
    runtimeVersion = required('RUNTIME_VERSION'),
    runtimeExe = path.resolve(required('RUNTIME_EXE'))
  assert(/^[A-Za-z0-9_-]{1,80}$/.test(runId) && /^[a-f0-9]{40}$/.test(candidateSha))
  assert(/^[a-f0-9]{64}$/.test(expectedBinarySha) && /^\d+\.\d+\.\d+\.\d+$/.test(runtimeVersion))
  for (const file of [application, edgeDriver, runtimeExe, processObserver, pwsh, work, evidence])
    await noLinks(file)
  const contextBytes = await readFile(path.join(evidence, 'standard-context.json'))
  const context = validateContext(
    JSON.parse(contextBytes.toString('utf8').replace(/^\uFEFF/, '')),
    expectedSid,
    expectedSessionId,
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
  const ledger = new AuditLedger(expectedSid),
    driverPort = await freePort()
  const report = {
    status: 'running',
    startedAt: new Date().toISOString(),
    candidateSha,
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
  const request = async (method, route, body) => {
    report.lastRequest = { method, route, at: new Date().toISOString() }
    const response = await fetch(`http://127.0.0.1:${driverPort}${route}`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(route === '/session' ? 60000 : 30000),
    })
    const value = await response.json()
    assert(response.ok && !value.value?.error, `${method} ${route}: ${JSON.stringify(value)}`)
    return value.value ?? value
  }
  const execute = (script, ...args) =>
    request('POST', `/session/${session}/execute/sync`, { script, args })
  const executeAsync = (script, ...args) =>
    request('POST', `/session/${session}/execute/async`, { script, args })
  const state = () => execute(observe)
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
    validateProcessIdentities(values, expected, expectedSid, expectedSessionId, identityBirths)
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
  const pointer = async (selector, left = false) => {
    for (let attempt = 0; attempt < 24; attempt++) {
      const target = await execute(
        `const e=document.querySelector(arguments[0]);if(!e)return null;const r=e.getBoundingClientRect(),x=arguments[1]?r.left+Math.min(8,r.width/2):(r.left+r.right)/2,y=(r.top+r.bottom)/2;
let parent=e.parentElement;while(parent&&!(parent.scrollHeight>parent.clientHeight+1&&/(auto|scroll)/.test(getComputedStyle(parent).overflowY)))parent=parent.parentElement;
const p=parent?.getBoundingClientRect(),hit=document.elementFromPoint(x,y);return {x,y,rect:r.toJSON(),disabled:!!e.disabled,hit:!!hit&&(e===hit||e.contains(hit)),scroll:p?{x:(p.left+p.right)/2,y:(p.top+p.bottom)/2,top:p.top,bottom:p.bottom}:null}`,
        selector,
        left,
      )
      assert(target && !target.disabled, 'Visible enabled UI target: ' + selector)
      if (target.hit && target.rect.width > 0 && target.rect.height > 0) {
        report.inputs.push({
          at: new Date().toISOString(),
          kind: 'W3C-pointer-actions',
          selector,
          x: target.x,
          y: target.y,
        })
        await request('POST', `/session/${session}/actions`, {
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
        })
        return
      }
      assert(target.scroll, 'UI target has a scrollable parent')
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
                duration: 150,
              },
            ],
          },
        ],
      })
      await delay(150)
    }
    assert.fail('Could not expose UI target: ' + selector)
  }
  const menu = async () => {
    if (!(await state()).menu) await pointer('[data-menu-toggle]')
    await pointer('[data-menu-section="plugins"]')
    if (await execute('return !!document.querySelector(\'[data-plugin-action="back"]\')'))
      await pointer('[data-plugin-action="back"]')
  }
  const closeMenu = async () => {
    if ((await state()).menu) await pointer('[data-menu-close]')
    await until(async () => !(await state()).menu, 'Menu closed')
  }
  const switchPlugin = async (enabled) => {
    await menu()
    const before = await state()
    const card = before.cards.find((item) => item.id === PLUGIN)
    assert(card && card.checked === String(!enabled), 'Actual plugin switch starting state')
    await pointer(`.plugin-summary-card[data-plugin-id="${PLUGIN}"] [role="switch"]`)
    await until(async () => {
      const next = (await state()).cards.find((item) => item.id === PLUGIN)
      return next?.checked === String(enabled) && next.busy !== 'true'
    }, 'Plugin toggle settled')
    const after = await state()
    assert.deepEqual(
      after.cards.map((item) => item.id),
      before.cards.map((item) => item.id),
      'Plugin cards retain order',
    )
    assert.equal(after.version, before.version)
    assert.equal(after.dirty, before.dirty)
    for (const previous of before.cards) {
      const next = after.cards.find((item) => item.id === previous.id)
      assert(Math.abs(next.rect.y - previous.rect.y) <= 1, 'Plugin card retained its position')
    }
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
      Object.assign(current, { exitCode: code, signal, exitedAt: new Date().toISOString() }),
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
      record = launch
    if (successful) {
      await observeProcesses()
      record.nativeJobs = (await drain()).map((job) => ({
        requestId: job.requestId,
        successful: job.finished.successful,
        cleanupVerified: true,
      }))
      assert.equal((await state()).dirty, false)
      await pointer('[data-window-control="close"]').catch((error) => {
        record.closePointerError = String(error)
      })
      await until(
        () => current.exitCode !== null || current.signalCode !== null,
        'Application exits after real close button',
        15000,
        false,
      )
      assert.equal(current.exitCode, 0, 'Product closes normally after real UI close')
      assert.equal(current.signalCode, null, 'Product was not terminated by a signal')
      record.closedByUi = true
    }
    if (session) {
      await request('DELETE', `/session/${session}`).catch((error) => {
        record.detachDiagnostic = String(error)
      })
      session = undefined
    }
    if (current.exitCode === null && current.signalCode === null) {
      record.outerTerminationRequired = true
      current.kill()
      await until(
        () => current.exitCode !== null || current.signalCode !== null,
        'Owned failed product stopped',
        5000,
        false,
      )
      if (successful) throw Error('Outer product termination cannot satisfy acceptance')
    }
    await until(() => record.stdioClosedAt, 'Product stdout/stderr fully drained', 5000, false)
    if (successful) {
      if (fatal) throw fatal
      assert.equal(logOverflow, false, 'Complete product diagnostics')
      ledger.verifyAll(record.productPid)
    }
    await writeFile(path.join(evidence, `${record.fixture}-product.log`), record.applicationOutput)
    delete record.applicationOutput
    product = undefined
  }
  try {
    await persist()
    driver = spawn(
      edgeDriver,
      [`--port=${driverPort}`, `--log-path=${path.join(evidence, 'edgedriver-native.log')}`],
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
      let current = await state()
      assert.equal(current.cards.find((card) => card.id === PLUGIN)?.checked, 'false')
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

// Native installed WebView observations; all editor/plugin mutations use W3C input.
// Single runner-account health evidence, not the dual-account isolation audit.
import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import {
  observe,
  decodeScript,
  startupPerformanceScript,
} from '../../tests/windows/mermaid-product-e2e.mjs'
const [
  phase,
  driverPort,
  debugPort,
  document,
  output,
  documentHealth,
  productPid,
  productBirth,
  productImage,
  nativeIme,
  previousPhase = 'before',
] = process.argv.slice(2)
assert(['before', 'upgrade', 'after'].includes(phase))
assert(['before', 'upgrade', 'update'].includes(previousPhase))
for (const port of [driverPort, debugPort]) assert(/^\d{4,5}$/.test(port) && +port < 65536)
const record = {
  status: 'running',
  phase,
  inputs: [],
  observations: [],
  boundary:
    'Installed real input/edit/save and persistent plugin switch only; no isolation/IME audit',
}
const file = path.join(output, `repair-health-${phase}.json`)
const persist = () => writeFile(file, JSON.stringify(record, null, 2))
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex')
const deadline = Date.now() + 180000
let session
const request = async (method, route, body) => {
  assert(Date.now() < deadline, 'Complete health check exceeded 180 seconds')
  record.lastRequest = { method, route, at: new Date().toISOString() }
  const response = await fetch(`http://127.0.0.1:${driverPort}${route}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(
      Math.max(1, Math.min(route === '/session' ? 60000 : 15000, deadline - Date.now())),
    ),
  })
  const result = await response.json()
  if (!response.ok || result.value?.error) throw Error(JSON.stringify(result).slice(0, 3000))
  return Object.hasOwn(result, 'value') ? result.value : result
}
const execute = (script, ...args) =>
  request('POST', `/session/${session}/execute/sync`, { script, args })
const state = () => execute(observe)
const until = async (fn, label, limit = 30000) => {
  const end = Math.min(deadline, Date.now() + limit)
  while (Date.now() < end) {
    const value = await fn()
    if (value) return value
    await delay(100)
  }
  throw Error('Timed out: ' + label)
}
// Observe readiness and begin the full strict decode in the same DOM task.
// No failed PNG, duplicate owner, revoked Blob or WebDriver error is retried.
const readyDecodeScript =
  `
const pendingImages=[...document.querySelectorAll('[data-document-presentation] img')];
if(pendingImages.length===0 || (pendingImages.length===1 && (!pendingImages[0].complete || pendingImages[0].naturalWidth===0))){arguments[arguments.length-1]({ok:true,pending:true});return;}
` + decodeScript
const decodeAccepted = (label) =>
  until(async () => {
    const result = await request('POST', `/session/${session}/execute/async`, {
      script: readyDecodeScript,
      args: [null],
    })
    if (result.pending === true) {
      record.pendingImageObservations = (record.pendingImageObservations ?? 0) + 1
      return false
    }
    assert.equal(result.ok, true)
    return result
  }, label)
const actions = async (type, list) => {
  record.inputs.push({ type, actions: list, at: new Date().toISOString() })
  assert(record.inputs.length <= 100)
  await request('POST', `/session/${session}/actions`, {
    actions: [
      {
        type,
        id: type,
        ...(type === 'pointer' ? { parameters: { pointerType: 'mouse' } } : {}),
        actions: list,
      },
    ],
  })
}
const chord = (key) =>
  actions('key', [
    { type: 'keyDown', value: '\uE009' },
    { type: 'keyDown', value: key },
    { type: 'keyUp', value: key },
    { type: 'keyUp', value: '\uE009' },
  ])
const typeText = (text) =>
  actions(
    'key',
    [...text]
      .map((value) => (value === '\n' ? '\uE007' : value))
      .flatMap((value) => [
        { type: 'keyDown', value },
        { type: 'keyUp', value },
      ]),
  )
const click = async (selector) => {
  const point = await until(
    () =>
      execute(
        `const e=document.querySelector(arguments[0]);if(!e)return null;const r=e.getBoundingClientRect(),x=Math.round(r.left+r.width/2),y=Math.round(r.top+r.height/2),h=document.elementFromPoint(x,y);return r.width&&r.height&&!e.disabled&&h&&(e===h||e.contains(h))?{x,y}:null`,
        selector,
      ),
    'visible real click target ' + selector,
  )
  await actions('pointer', [
    { type: 'pointerMove', origin: 'viewport', duration: 0, ...point },
    { type: 'pointerDown', button: 0 },
    { type: 'pointerUp', button: 0 },
  ])
}
const menu = async () => {
  if (!(await state()).menu) await click('[data-menu-toggle]')
  await click('[data-menu-section="plugins"]')
  return until(async () => {
    const c = (await state()).cards.find((v) => v.id === 'milkup.diagrams')
    return c && c.busy !== 'true' ? c : false
  }, 'plugin initialization')
}
try {
  await persist()
  await until(async () => {
    try {
      return (await request('GET', '/status')).ready
    } catch {
      return false
    }
  }, 'owned driver ready')
  record.devTools = await until(
    async () => {
      try {
        const response = await fetch(`http://127.0.0.1:${debugPort}/json/version`, {
          signal: AbortSignal.timeout(1000),
        })
        if (!response.ok) return false
        const value = await response.json()
        assert(typeof value.webSocketDebuggerUrl === 'string')
        return value
      } catch (error) {
        record.lastDevToolsError = String(error)
        return false
      }
    },
    'owned WebView2 loopback readiness before attachment',
    45000,
  )
  await persist()
  const response = await request('POST', '/session', {
    capabilities: {
      alwaysMatch: {
        browserName: 'webview2',
        'ms:edgeChromium': true,
        'ms:edgeOptions': { debuggerAddress: `127.0.0.1:${debugPort}` },
      },
    },
  })
  session = record.sessionId = response.sessionId
  assert(session)
  await persist()
  await request('POST', `/session/${session}/timeouts`, {
    script: 15000,
    pageLoad: 15000,
    implicit: 0,
  })
  const opened = await until(async () => {
    const s = await state()
    return s.loading === 'ready' &&
      path.resolve(s.path).toLowerCase() === path.resolve(document).toLowerCase()
      ? s
      : false
  }, 'exact installed document')
  assert(['tauri:', 'http:', 'https:'].includes(opened.protocol))
  assert(['tauri.localhost', 'localhost'].includes(opened.hostname) || opened.protocol === 'tauri:')
  assert.equal(opened.developmentProbe, 'undefined')
  record.observations.push({ name: 'opened', state: opened })
  if (phase === 'before') {
    // Fresh installed profile, before any keyboard or pointer input. The after
    // phase intentionally retains a disabled plugin and is not a cold sample.
    const decoded = await decodeAccepted('initial installed default diagram without input')
    assert.equal(record.inputs.length, 0)
    assert.equal(decoded.ok, true)
    const { base64, ...image } = decoded.value
    assert(image.fullyDecoded && image.nonuniform)
    record.initialDecodedImage = image
    record.startupPerformance = await execute(startupPerformanceScript)
    record.startupPerformance.inputsBeforeObservation = record.inputs.length
    await writeFile(
      path.join(output, 'repair-health-initial-image.png'),
      Buffer.from(base64, 'base64'),
    )
    await persist()
  }
  const bytes = await readFile(document)
  if (phase !== 'before') {
    const before = JSON.parse(
      await readFile(
        path.join(
          output,
          previousPhase === 'update'
            ? 'in-app-update-ui.json'
            : `repair-health-${previousPhase}.json`,
        ),
        'utf8',
      ),
    )
    assert.equal(
      before.status,
      previousPhase === 'update' ? 'passed-ui-await-native-restart' : 'passed',
    )
    assert.equal(sha(bytes), before.saved.sha256, 'Repair retained real edited document')
    record.retainedDocumentSha256 = sha(bytes)
  }
  let card = await menu()
  assert.equal(
    card.checked,
    phase === 'before' ? 'true' : 'false',
    'Plugin switch persists across repair',
  )
  record.pluginBefore = card
  await click('.plugin-summary-card[data-plugin-id="milkup.diagrams"] [role="switch"]')
  card = await until(async () => {
    const c = (await state()).cards.find((v) => v.id === 'milkup.diagrams')
    return c?.checked === (phase === 'before' ? 'false' : 'true') && c.busy !== 'true' ? c : false
  }, 'real plugin switch settled')
  record.pluginAfter = card
  await click('[data-menu-close]')
  await chord('1')
  await until(async () => (await state()).mode === 'source', 'editable source mode')
  const sourceLine = await execute(
    `const root=document.querySelector('.milkup-editor'),b=root.getBoundingClientRect();const e=[...root.querySelectorAll('.milkup-line')].find(e=>{const r=e.getBoundingClientRect();return r.height>0&&r.top>=b.top&&r.bottom<=Math.min(b.bottom,innerHeight)});return e?'.milkup-line[data-line="'+e.dataset.line+'"]':null`,
  )
  assert(sourceLine, 'Actual visible source line required')
  await click(sourceLine)
  await until(async () => (await state()).editorFocused, 'editor real focus')
  await chord('\uE010') // Ctrl+End
  await until(
    async () => (await state()).cursor === bytes.toString('utf8').length,
    'exact final caret',
  )
  const suffix = `REPAIR-${phase.toUpperCase()}\n`
  await typeText(suffix)
  await until(async () => (await state()).dirty, 'real typed edit')
  await chord('s')
  const expected = Buffer.concat([bytes, Buffer.from(suffix)])
  await until(async () => {
    const s = await state()
    return !s.dirty && !s.saving && (await readFile(document)).equals(expected)
  }, 'exact saved edited bytes')
  record.saved = { sha256: sha(expected), bytes: expected.length }
  if (nativeIme === 'true') {
    const { verifyNativeImeCommit } = await import('../ci/native-ime-contract.mjs')
    const mode = phase === 'before' ? 'source' : 'live'
    record.nativeIme = {
      status: 'running',
      mode,
      events: [],
      boundary:
        'Native Pinyin and punctuation in the owned standard-account installation, no DPI claim',
    }
    await chord(mode === 'source' ? '1' : '2')
    await until(async () => (await state()).mode === mode, 'native IME editor mode')
    await chord('\uE010')
    await until(
      async () =>
        (await state()).cursor === expected.toString('utf8').length &&
        (await state()).editorFocused,
      'native IME final caret',
    )
    await execute(
      `window.__milkupNativeImeEvents=[];window.__milkupNativeImeOverflow=false;for(const type of ['compositionstart','compositionupdate','compositionend','beforeinput','input'])document.addEventListener(type,e=>{if(window.__milkupNativeImeEvents.length>=600){window.__milkupNativeImeOverflow=true;return}window.__milkupNativeImeEvents.push({type:e.type,data:e.data??null,inputType:e.inputType??null,composing:e.isComposing===true,trusted:e.isTrusted,time:e.timeStamp,target:e.target?.tagName})},true)`,
    )
    const helper = fileURLToPath(new URL('../ci/windows-owned-ime-input.exe', import.meta.url))
    record.nativeIme.helperSha256 = sha(await readFile(helper))
    await persist()
    try {
      record.nativeIme.helperOutput = execFileSync(
        helper,
        [productPid, productBirth, productImage],
        { encoding: 'utf8', timeout: 30000, maxBuffer: 32768, windowsHide: true },
      )
    } catch (error) {
      record.nativeIme.helperOutput = String(error.stdout ?? '')
      throw error
    } finally {
      record.nativeIme.events = await execute('return window.__milkupNativeImeEvents')
      record.nativeIme.eventOverflow = await execute('return window.__milkupNativeImeOverflow')
      await persist()
    }
    assert.equal(record.nativeIme.eventOverflow, false)
    assert.match(record.nativeIme.helperOutput, /targetLayoutRestored=true/)
    assert.match(record.nativeIme.helperOutput, /ownedUserProfileRestored=true/)
    record.nativeIme.provenance = verifyNativeImeCommit(record.nativeIme.events)
    const nativeExpected = Buffer.concat([expected, Buffer.from('中文，。？！：；')])
    await chord('s')
    await until(
      async () => !(await state()).dirty && (await readFile(document)).equals(nativeExpected),
      'one exact native Chinese commit and punctuation',
    )
    await delay(2600)
    assert((await readFile(document)).equals(nativeExpected), 'No delayed duplicate native commit')
    await chord('z')
    await chord('s')
    await until(
      async () => !(await state()).dirty && !(await readFile(document)).equals(nativeExpected),
      'native input undo changes saved document',
    )
    record.nativeIme.undoSha256 = sha(await readFile(document))
    await chord('y')
    await chord('s')
    await until(
      async () => !(await state()).dirty && (await readFile(document)).equals(nativeExpected),
      'native input redo restores exact bytes',
    )
    record.nativeIme.savedSha256 = sha(nativeExpected)
    record.nativeIme.status = 'passed'
    record.saved = { sha256: sha(nativeExpected), bytes: nativeExpected.length }
    await persist()
  }
  if (phase !== 'before') {
    await chord('\uE011')
    await chord('2')
    const decoded = await decodeAccepted('restored plugin renders actual image')
    assert.equal(decoded.ok, true)
    const { base64, ...image } = decoded.value
    assert(image.fullyDecoded && image.nonuniform)
    record.decodedImage = image
    await writeFile(
      path.join(output, `repair-health-${phase}-image.png`),
      Buffer.from(base64, 'base64'),
    )
  }
  if (phase === 'upgrade') {
    // Exercise the new version, then retain an intentional disabled setting for
    // the independent older-version recovery check. Mutations remain real UI.
    await menu()
    await click('.plugin-summary-card[data-plugin-id="milkup.diagrams"] [role="switch"]')
    record.pluginRetainedForRecovery = await until(async () => {
      const c = (await state()).cards.find((v) => v.id === 'milkup.diagrams')
      return c?.checked === 'false' && c.busy !== 'true' ? c : false
    }, 'upgraded version persists explicit disabled setting')
    await click('[data-menu-close]')
  }
  if (phase === 'after' && documentHealth === 'true') {
    const { checkInstalledDocuments } = await import('./installed-document-health.mjs')
    const result = await checkInstalledDocuments(
      {
        execute,
        state,
        click,
        chord,
        typeText,
        until,
        actions,
        capture: async (name) =>
          writeFile(
            path.join(output, name),
            Buffer.from(await request('GET', `/session/${session}/screenshot`), 'base64'),
          ),
      },
      { document, output, pid: productPid, birth: productBirth, image: productImage },
    )
    record.documentHealth = result.report
    record.saved = result.saved
  }
  if (!record.documentHealth?.close.saveRequested)
    await writeFile(
      path.join(output, `repair-health-${phase}.png`),
      Buffer.from(await request('GET', `/session/${session}/screenshot`), 'base64'),
    )
  record.status = 'passed'
} catch (error) {
  record.status = 'failed'
  record.error = error.stack
  if (session) {
    try {
      record.failureState = await state()
      await writeFile(
        path.join(output, `repair-health-${phase}.png`),
        Buffer.from(await request('GET', `/session/${session}/screenshot`), 'base64'),
      )
    } catch (diagnosticError) {
      record.diagnosticError = String(diagnosticError)
    }
  }
  process.exitCode = 1
} finally {
  await persist()
}
// The owning PowerShell closes the actual app, then detaches this session. A
// successful health script never closes/kills the product or its driver itself.

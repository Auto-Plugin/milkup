// Native installed WebView observations; all editor/plugin mutations use W3C input.
// Single runner-account health evidence, not the dual-account isolation audit.
import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { observe, decodeScript } from '../../tests/windows/mermaid-product-e2e.mjs'
const [phase, driverPort, debugPort, document, output] = process.argv.slice(2)
assert(['before', 'after'].includes(phase))
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
    signal: AbortSignal.timeout(Math.max(1, Math.min(15000, deadline - Date.now()))),
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
    [...text].flatMap((value) => [
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
  const response = await request('POST', '/session', {
    capabilities: {
      alwaysMatch: {
        browserName: 'MicrosoftEdge',
        'ms:edgeOptions': { debuggerAddress: `127.0.0.1:${debugPort}`, detach: true },
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
  const bytes = await readFile(document)
  if (phase === 'after') {
    const before = JSON.parse(
      await readFile(path.join(output, 'repair-health-before.json'), 'utf8'),
    )
    assert.equal(before.status, 'passed')
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
  await click('.milkup-line[data-line="0"]')
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
  if (phase === 'after') {
    await chord('\uE011')
    await chord('2')
    await until(
      async () => (await state()).images.some((i) => i.complete && i.naturalWidth > 0),
      'restored plugin renders actual image',
    )
    const decoded = await request('POST', `/session/${session}/execute/async`, {
      script: decodeScript,
      args: [null],
    })
    assert.equal(decoded.ok, true)
    const { base64, ...image } = decoded.value
    assert(image.fullyDecoded && image.nonuniform)
    record.decodedImage = image
    await writeFile(path.join(output, 'repair-health-image.png'), Buffer.from(base64, 'base64'))
  }
  await writeFile(
    path.join(output, `repair-health-${phase}.png`),
    Buffer.from(await request('GET', `/session/${session}/screenshot`), 'base64'),
  )
  record.status = 'passed'
} catch (error) {
  record.status = 'failed'
  record.error = error.stack
  process.exitCode = 1
} finally {
  await persist()
}
// The owning PowerShell closes the actual app, then detaches this session. A
// successful health script never closes/kills the product or its driver itself.

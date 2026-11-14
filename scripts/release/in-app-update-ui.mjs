// Actual installed UI input; DOM scripts observe only, never dispatch updater IPC.
import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { observe } from '../../tests/windows/mermaid-product-e2e.mjs'
const [driverPort, debugPort, document, output, productImage] = process.argv.slice(2)
for (const port of [driverPort, debugPort]) assert(/^\d{4,5}$/.test(port) && +port < 65536)
const record = {
  status: 'running',
  inputs: [],
  cases: [],
  scope:
    'Real About UI and protected installation confirmation; native restart verified separately',
}
const file = path.join(output, 'in-app-update-ui.json')
const persist = () => writeFile(file, JSON.stringify(record, null, 2))
const sha = (b) => createHash('sha256').update(b).digest('hex')
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

const about = async () => {
  if (!(await state()).menu) await click('[data-menu-toggle]')
  await click('[data-menu-section="about"]')
}
const updateState = () =>
  execute(
    `const e=document.querySelector('[data-application-updates]');return {text:e?.innerText,updateError:e?.querySelector('[role="alert"]')?.textContent??null,actions:[...e?.querySelectorAll('[data-application-update-action]')??[]].map(b=>b.dataset.applicationUpdateAction),version:document.querySelector('[data-app-version]')?.textContent,confirmVisible:!!document.querySelector('[data-close-confirm]:not([hidden])')}`,
  )
const endpointMode = (value) => writeFile(path.join(output, 'endpoint-mode.txt'), value)
async function edit(marker, save = true) {
  if ((await state()).menu) await click('[data-menu-close]')
  await chord('1')
  const line = await execute(
    `const root=document.querySelector('.milkup-editor'),b=root.getBoundingClientRect();const e=[...root.querySelectorAll('.milkup-line')].find(e=>{const r=e.getBoundingClientRect();return r.height>0&&r.top>=b.top&&r.bottom<=Math.min(b.bottom,innerHeight)});return e?'.milkup-line[data-line="'+e.dataset.line+'"]':null`,
  )
  assert(line)
  await click(line)
  await chord('\uE010')
  const bytes = await readFile(document)
  await until(
    async () => (await state()).cursor === bytes.toString('utf8').length,
    'real final caret',
  )
  await typeText(marker)
  await until(async () => (await state()).dirty, 'real typed edit after failed update')
  const expected = Buffer.concat([bytes, Buffer.from(marker)])
  if (save) {
    await chord('s')
    await until(
      async () => !(await state()).dirty && (await readFile(document)).equals(expected),
      'failure left old editor usable and saving exact bytes',
    )
  }
  return expected
}
async function rejected(name, pattern) {
  const value = await until(async () => {
    const s = await updateState()
    return s.updateError ? s : false
  }, name)
  assert.match(value.updateError, pattern)
  assert.match(value.version, /2\.0\.0-beta\.10/)
  assert(!value.actions.includes('install'), 'Rejected bytes must never offer installation')
  const expected = await edit(`UPDATE-REJECTED-${name}\n`)
  record.cases.push({
    name,
    state: value,
    savedSha256: sha(expected),
    savedBytes: expected.length,
    oldImageSha256: sha(await readFile(productImage)),
  })
  await persist()
  await about()
}
try {
  await persist()
  await until(
    async () => {
      try {
        return (
          await fetch(`http://127.0.0.1:${debugPort}/json/version`, {
            signal: AbortSignal.timeout(1000),
          })
        ).ok
      } catch {
        return false
      }
    },
    'owned WebView ready',
    45000,
  )
  const created = await request('POST', '/session', {
    capabilities: {
      alwaysMatch: {
        browserName: 'webview2',
        'ms:edgeChromium': true,
        'ms:edgeOptions': { debuggerAddress: `127.0.0.1:${debugPort}` },
      },
    },
  })
  session = record.sessionId = created.sessionId
  assert(session)
  await request('POST', `/session/${session}/timeouts`, {
    script: 15000,
    pageLoad: 15000,
    implicit: 0,
  })
  await until(async () => {
    const s = await state()
    return (
      s.loading === 'ready' &&
      path.resolve(s.path).toLowerCase() === path.resolve(document).toLowerCase()
    )
  }, 'exact prepared document')
  await about()
  await rejected('manifest-signature', /signature|签名|Signature/)
  await endpointMode('download-error')
  await click('[data-application-update-action="check"]')
  await until(
    async () => (await updateState()).actions.includes('download'),
    'verified manifest available',
  )
  await click('[data-application-updates] [data-application-update-action="download"]')
  await rejected('download-http', /503|download|下载|status/i)
  await endpointMode('bad-artifact')
  await click('[data-application-updates] [data-application-update-action="download"]')
  await rejected('artifact-signature', /signature|签名|Signature/)
  await endpointMode('valid')
  await click('[data-application-updates] [data-application-update-action="download"]')
  record.ready = await until(
    async () => {
      const s = await updateState()
      return s.actions.includes('install') ? s : false
    },
    'real downloaded verified package ready',
    60000,
  )
  assert(!record.ready.updateError)
  // Force the actual protected save-before-install path, with a unique unsaved marker.
  const expected = await edit('UPDATE-SAVED-BY-PROTECTED-INSTALL\n', false)
  await about()
  await click('[data-application-updates] [data-application-update-action="install"]')
  await until(
    async () => (await updateState()).confirmVisible,
    'protected native-host install prompt',
  )
  record.confirmation = await execute(
    `const e=document.querySelector('[data-close-confirm]');return {text:e.innerText,discardHidden:e.querySelector('[data-close-confirm-action="discard"]').hidden}`,
  )
  assert(record.confirmation.discardHidden)
  assert.match(record.confirmation.text, /2\.0\.0-beta\.11/)
  record.installRequestedAt = new Date().toISOString()
  await persist()
  try {
    await click('[data-close-confirm-action="save"]')
  } catch (error) {
    record.finalInputDisconnect = String(error)
  }
  await until(
    async () => (await readFile(document)).equals(expected),
    'protected install saved exact pending document',
  )
  record.saved = { bytes: expected.length, sha256: sha(expected) }
  record.status = 'passed-ui-await-native-restart'
} catch (error) {
  record.status = 'failed'
  record.error = String(error)
  try {
    record.finalState = await updateState()
  } catch {}
  throw error
} finally {
  await persist()
}

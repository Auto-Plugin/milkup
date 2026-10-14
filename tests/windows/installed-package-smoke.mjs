// Drives the installed production binary; no source bundle, IPC mutation,
// browser security overrides, synthetic composition or Vite server is used.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import path from 'node:path'

assert.equal(process.platform, 'win32', 'Windows installed-package acceptance only')
const required = (name) => {
  assert(process.env[name], `Missing ${name}`)
  return path.resolve(process.env[name])
}
const application = required('MILKUP_WINDOWS_INSTALLED_APP')
const edgeDriver = required('MILKUP_WINDOWS_EDGE_DRIVER')
const work = required('MILKUP_WINDOWS_SMOKE_WORK')
const evidence = required('MILKUP_WINDOWS_SMOKE_EVIDENCE')
await mkdir(work) // Refuse to reuse fixtures or erase previous evidence.
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex')
const normalized = (value) => value.replaceAll('\\', '/').toLowerCase()
const result = {
  status: 'started',
  application,
  applicationSha256: hash(await readFile(application)),
  inputMethod: 'Edge WebDriver W3C trusted key actions; not real IME',
  realImeAccepted: false,
  nativeFilePickerAccepted: false,
  cases: [],
}
let session, driver, driverError
let driverOutput = ''
const saveResult = () =>
  writeFile(path.join(evidence, 'installed-smoke.json'), JSON.stringify(result, null, 2))
const request = async (method, route, body) => {
  result.lastRequest = { method, route, startedAt: new Date().toISOString() }
  const response = await fetch('http://127.0.0.1:9515' + route, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(route === '/session' && method === 'POST' ? 90000 : 45000),
  }).catch((error) => {
    throw new Error(`${method} ${route}: ${error}`, { cause: error })
  })
  const data = await response.json()
  if (!response.ok || data.value?.error) throw Error(JSON.stringify(data))
  return data.value ?? data
}
const execute = (script, ...args) =>
  request('POST', `/session/${session}/execute/sync`, { script, args })
async function until(check, label, milliseconds = 25000) {
  const deadline = Date.now() + milliseconds
  while (Date.now() < deadline) {
    if (driverError) throw driverError
    if (await check()) return
    await delay(100)
  }
  throw Error('Timed out: ' + label)
}
async function keys(value, control = false) {
  const actions = []
  if (control) actions.push({ type: 'keyDown', value: '\uE009' })
  for (const key of value)
    actions.push({ type: 'keyDown', value: key }, { type: 'keyUp', value: key })
  if (control) actions.push({ type: 'keyUp', value: '\uE009' })
  await request('POST', `/session/${session}/actions`, {
    actions: [{ type: 'key', id: 'keyboard', actions }],
  })
}
const state = () =>
  execute(`
 const app=document.querySelector('#app'), t=s=>document.querySelector(s)?.textContent;
 return {url:location.href, path:t('[data-stat="path"]')??(t('[data-title-path]')+'/'+t('[data-title]')+'.md'), loading:app?.dataset.loading,
 saving:app?.dataset.saving==='true', dirty:document.querySelector('[data-save-dot]')?.classList.contains('is-dirty'),
 mode:document.querySelector('.milkup-editor')?.dataset.mode, visibility:document.visibilityState,
 cursor:Number(document.querySelector('.milkup-cursor')?.dataset.position)};
`)
async function open(file) {
  const response = await request('POST', '/session', {
    // The same Windows capabilities produced by tauri-driver 2.0.5, sent
    // directly so the native driver's launch diagnostics can be retained.
    capabilities: {
      alwaysMatch: {
        browserName: 'webview2',
        'ms:edgeChromium': true,
        'ms:edgeOptions': { binary: application, args: [file] },
      },
    },
  })
  session = response.sessionId
  assert(session, 'WebDriver session ID')
  await until(async () => {
    const p = await state()
    return p.path && normalized(p.path) === normalized(file) && p.loading === 'ready'
  }, 'installed production CLI open')
  const p = await state()
  assert(!/^https?:\/\/(localhost|127\.0\.0\.1):1420/.test(p.url), 'Production origin only')
  assert.equal(p.visibility, 'visible')
  const rect = await request('GET', `/session/${session}/window/rect`)
  assert(rect.width > 0 && rect.height > 0, 'Visible application window')
  return { ...p, windowRect: rect, capabilities: response.capabilities }
}
async function close() {
  if (!session) return
  await request('DELETE', `/session/${session}`)
  session = undefined
}
async function savedBytes(file, expected) {
  await until(async () => {
    const p = await state()
    return !p.dirty && !p.saving && (await readFile(file)).equals(expected)
  }, 'complete saved bytes')
}
try {
  driver = spawn(
    edgeDriver,
    ['--port=9515', '--verbose', `--log-path=${path.join(evidence, 'native-driver.log')}`],
    {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      env: { ...process.env, TAURI_WEBVIEW_AUTOMATION: 'true' },
    },
  )
  driver.once('error', (error) => {
    driverError = error
  })
  for (const stream of [driver.stdout, driver.stderr])
    stream.on('data', (chunk) => {
      // Keep bounded diagnostics; this is driver output, never document evidence.
      if (driverOutput.length < 2 * 1024 * 1024) driverOutput += chunk.toString()
    })
  await until(
    async () => {
      if (driver.exitCode !== null) throw Error('EdgeDriver exited before readiness')
      return request('GET', '/status').then(
        () => true,
        () => false,
      )
    },
    'native driver',
    15000,
  )
  for (const size of ['ordinary', 'native-1m'])
    for (const mode of ['source', 'live']) {
      const name = `${size}-${mode}`
      const file = path.join(work, `${name}-中文.md`)
      const original = Buffer.from(
        '# Windows v2 中文😀\r\n\r\n' +
          (size === 'ordinary' ? 'body\r\n' : ('body ' + 'x'.repeat(57) + '\r\n').repeat(16384)),
      )
      const expected = Buffer.concat([Buffer.from('WINV2'), original])
      await writeFile(file, original, { flag: 'wx' })
      const entry = {
        name,
        file,
        originalBytes: original.length,
        originalSha256: hash(original),
        status: 'started',
      }
      result.cases.push(entry)
      entry.open = await open(file)
      await keys(mode === 'source' ? '1' : '2', true)
      await until(async () => (await state()).mode === mode, 'view mode')
      await execute(
        `document.querySelector('.milkup-input-proxy').focus();window.__packageKeys=[];addEventListener('keydown',e=>window.__packageKeys.push({key:e.key,trusted:e.isTrusted}),true)`,
      )
      await keys('\uE011', true) // Ctrl+Home, before the first Unicode scalar.
      await until(async () => (await state()).cursor === 0, 'document start')
      await keys('WINV2')
      await until(async () => (await state()).dirty, 'native typing committed')
      await keys('s', true)
      await savedBytes(file, expected)
      await keys('z', true)
      await keys('s', true)
      await savedBytes(file, original)
      await keys('y', true)
      await keys('s', true)
      await savedBytes(file, expected)
      entry.input = await execute('return window.__packageKeys')
      assert(entry.input.length >= 5 && entry.input.every((event) => event.trusted))
      entry.savedBytes = expected.length
      entry.savedSha256 = hash(await readFile(file))
      await writeFile(
        path.join(evidence, name + '.png'),
        Buffer.from(await request('GET', `/session/${session}/screenshot`), 'base64'),
      )
      await close()
      entry.reopen = await open(file)
      assert(
        (await readFile(file)).equals(expected),
        'Complete bytes retained on installed-app reopen',
      )
      await close()
      entry.closeMethod =
        'WebDriver session deletion after save; not unsaved-close dialog acceptance'
      entry.status = 'passed'
      await saveResult()
    }
  result.status = 'passed'
} catch (error) {
  result.status = 'failed'
  result.error = String(error)
  if (session) {
    result.failureState = await state().catch(() => null)
    await request('GET', `/session/${session}/screenshot`)
      .then((png) => writeFile(path.join(evidence, 'failure.png'), Buffer.from(png, 'base64')))
      .catch(() => {})
  }
  throw error
} finally {
  await close().catch((error) => {
    result.cleanupError = String(error)
  })
  if (driver && driver.exitCode === null) driver.kill()
  await writeFile(path.join(evidence, 'driver.log'), driverOutput)
  await saveResult()
}

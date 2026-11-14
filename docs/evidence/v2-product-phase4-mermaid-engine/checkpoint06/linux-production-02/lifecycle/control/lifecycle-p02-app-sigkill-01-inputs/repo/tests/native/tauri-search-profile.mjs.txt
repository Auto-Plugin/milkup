import assert from 'node:assert/strict'
import { mkdir, copyFile, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
import {
  beginNativeStartup,
  waitForNativeWindow,
  cleanupNativeApplication,
  nativeRequestTimeout,
} from '../helpers/native-startup.mjs'
const root = process.env.MILKUP_NATIVE_EVIDENCE_DIR
assert(root)
await mkdir(root, { recursive: true })
const original = process.env.MILKUP_SEARCH_FIXTURE
assert(original)
const file = path.resolve(root, 'numbered.md')
await copyFile(original, file)
const bytes = await readFile(file)
const metadata = {
  bytes: bytes.length,
  sha256: createHash('sha256').update(bytes).digest('hex'),
  query: 'tailneedle',
}
await writeFile(path.join(root, 'fixture.json'), JSON.stringify(metadata, null, 2))
const application = path.resolve('apps/desktop/src-tauri/target/debug/milkup-desktop')
let sid
async function request(method, route, body) {
  const response = await fetch('http://127.0.0.1:4444' + route, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(nativeRequestTimeout(method, route)),
  })
  const data = await response.json()
  if (!response.ok || data.value?.error) throw Error(JSON.stringify(data))
  return data.value ?? data
}
const execute = (script, ...args) =>
  request('POST', `/session/${sid}/execute/sync`, { script, args })
const delay = (ms) => new Promise((r) => setTimeout(r, ms))
async function until(fn, label, limit = 15000) {
  const start = Date.now()
  while (Date.now() - start < limit) {
    const value = await fn()
    if (value) return value
    await delay(100)
  }
  throw Error('Timeout: ' + label)
}
async function actions(keys) {
  await request('POST', `/session/${sid}/actions`, {
    actions: [{ type: 'key', id: 'native-keyboard', actions: keys }],
  })
}
const key = (value) =>
  actions([
    { type: 'keyDown', value },
    { type: 'keyUp', value },
  ])
const shortcut = (value) =>
  actions([
    { type: 'keyDown', value: '\uE009' },
    { type: 'keyDown', value },
    { type: 'keyUp', value },
    { type: 'keyUp', value: '\uE009' },
  ])
const results = []
try {
  const started = beginNativeStartup()
  const pending = request('POST', '/session', {
    capabilities: { alwaysMatch: { 'tauri:options': { application, args: [file] } } },
  })
  pending.catch(() => {})
  await waitForNativeWindow(started)
  sid = (await pending).sessionId
  await until(
    () =>
      execute(
        'return window.__searchProfileReady && window.__searchProbe().path===arguments[0] && window.__searchProbe().loading==="ready"',
        file,
      ),
    'native CLI file and instrumentation',
  )
  for (const mode of ['source', 'live']) {
    await key('\uE00C')
    await shortcut(mode === 'source' ? '1' : '2')
    await shortcut('f')
    await shortcut('a')
    await execute('window.__resetSearchProfile()')
    for (const char of metadata.query) await key(char)
    let lastProgress = 0
    await until(
      async () => {
        const state = await execute(
          'return {...window.__searchProbe(),matches:undefined,readCount:window.__searchProfile.reads.length}',
        )
        if (Date.now() - lastProgress > 5000) {
          console.log(JSON.stringify(state))
          lastProgress = Date.now()
        }
        return state.phase === 'done'
      },
      'complete original full-file search',
      125000,
    )
    const result = await execute(
      'window.__searchProfile.enabled=false;return {profile:window.__searchProfile,state:window.__searchProbe(),label:document.querySelector("[data-search-result-count]").textContent}',
    )
    assert.equal(result.state.complete, true)
    assert.equal(result.state.matches.length, 1)
    result.mode = mode
    results.push(result)
    await writeFile(path.join(root, 'profile.json'), JSON.stringify({ metadata, results }, null, 2))
    await writeFile(
      path.join(root, mode + '.png'),
      Buffer.from(await request('GET', `/session/${sid}/screenshot`), 'base64'),
    )
    console.log(
      JSON.stringify({
        mode,
        searchMs: result.profile.searchMs,
        reads: result.profile.reads.length,
        ipcReadMs: result.profile.reads.reduce((n, x) => n + x.ms, 0),
        updateMs: result.profile.updates.reduce((n, x) => n + x.ms, 0),
        renderMs: result.profile.renders.reduce((n, x) => n + x, 0),
        maxTimerGapMs: result.profile.maxTimerGapMs,
      }),
    )
  }
} catch (error) {
  if (sid) {
    const data = await execute(
      'return {profile:window.__searchProfile,state:window.__searchProbe()}',
    ).catch(() => ({}))
    await writeFile(
      path.join(root, 'failure.json'),
      JSON.stringify({ error: String(error), ...data }, null, 2),
    )
    await writeFile(
      path.join(root, 'failure.png'),
      Buffer.from(await request('GET', `/session/${sid}/screenshot`), 'base64'),
    )
  }
  throw error
} finally {
  if (sid) await request('DELETE', `/session/${sid}`).catch(() => {})
  cleanupNativeApplication(application)
}

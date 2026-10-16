import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile, readdir, stat } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { tmpdir } from 'node:os'
import {
  beginNativeStartup,
  waitForNativeWindow,
  cleanupNativeApplication,
  nativeRequestTimeout,
} from '../helpers/native-startup.mjs'
const root = process.env.MILKUP_NATIVE_EVIDENCE_DIR
assert(root)
await mkdir(root, { recursive: true })
const file = path.resolve(root, 'unicode.md')
const marker = '😀İ I i ı Σ ΟΣ 中文😀\r\n'
const row = 'x'.repeat(62) + '\r\n'
let document = marker + row.repeat(Math.ceil((1024 * 1024 - 32 - Buffer.byteLength(marker)) / 64))
document += marker
document += row.repeat(Math.ceil((2 * 1024 * 1024 - Buffer.byteLength(document)) / 64)) + marker
await writeFile(file, document)
const positions = []
let at = document.indexOf(marker)
while (at >= 0) {
  positions.push(at)
  at = document.indexOf(marker, at + marker.length)
}
const iPositions = positions.flatMap((at) => [at + 2, at + 4, at + 6])
const expectedReplace = Buffer.from(
  iPositions
    .toReversed()
    .reduce((text, at) => text.slice(0, at) + '$1😀' + text.slice(at + 1), document),
)
const bytes = await readFile(file)
const metadata = {
  bytes: bytes.length,
  sha256: createHash('sha256').update(bytes).digest('hex'),
  query: 'i / Σ / ς / 中文😀',
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
  if (!response.ok || (data.value?.error && !('ok' in data.value)))
    throw Error(JSON.stringify(data))
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
const probe = () => execute('return window.__searchProbe()')
const focus = (selector) => execute('document.querySelector(arguments[0]).focus()', selector)
const text = (value) =>
  actions(
    [...value].flatMap((value) => [
      { type: 'keyDown', value },
      { type: 'keyUp', value },
    ]),
  )
const enter = '\uE007',
  escape = '\uE00C'
async function click(selector) {
  await focus(selector)
  await key(enter)
}
async function query(value, expected, limit = 125000) {
  await shortcut('f')
  await focus('[data-search-input]')
  await shortcut('a')
  await text(value)
  await until(
    async () => {
      const p = await probe()
      if (p.phase === 'failed')
        throw Error(
          p.notice +
            ' ' +
            (await execute('return document.querySelector("[data-search-message]").textContent')),
        )
      return p.query === value && p.phase === 'done'
    },
    'search ' + value,
    limit,
  )
  const p = await probe()
  assert.equal(p.matchCount, expected)
  assert.equal(p.complete, true)
  assert(p.matches.length <= 128)
  return p
}
async function saved(expected) {
  await key(escape)
  await shortcut('s')
  await until(
    () =>
      execute(
        'return document.querySelector("#app").dataset.saving!=="true"&&!window.__searchProbe().dirty&&window.__searchProbe().pending===0',
      ),
    'save ready',
    20000,
  )
  const actual = await readFile(file)
  assert.equal(actual.length, expected.length)
  assert.equal(
    createHash('sha256').update(actual).digest('hex'),
    createHash('sha256').update(expected).digest('hex'),
  )
}
const lifecycle = []
async function sessionTempDirs() {
  const pids = []
  for (const pid of await readdir('/proc')) {
    if (!/^\d+$/.test(pid)) continue
    try {
      if ((await readFile(`/proc/${pid}/cmdline`, 'utf8')).split('\0')[0] === application)
        pids.push(pid)
    } catch {}
  }
  assert.equal(pids.length, 1, 'one owned application for temporary-directory observation')
  return (await readdir(tmpdir())).filter((name) => name.startsWith(`milkup-search-${pids[0]}-`))
}
async function reopen() {
  const before = process.platform === 'linux' ? await sessionTempDirs() : []
  if (process.platform === 'linux')
    assert(
      (
        await Promise.all(
          before.map((name) =>
            stat(path.join(tmpdir(), name, 'before.utf8')).then(
              () => true,
              () => false,
            ),
          ),
        )
      ).some(Boolean),
      'replacement history exists before closing',
    )
  await execute(
    'localStorage.setItem("milkup.desktop.nativeTestPaths",JSON.stringify({open:arguments[0]}))',
    file,
  )
  await shortcut('n')
  await until(() => execute('return !window.__searchProbe().path'), 'new empty')
  if (process.platform === 'linux') {
    await until(
      async () => (await sessionTempDirs()).length === 0,
      'native history and search temporary directories released',
    )
    lifecycle.push({ beforeCloseDirectories: before.length, afterCloseDirectories: 0 })
    await writeFile(path.join(root, 'lifecycle.json'), JSON.stringify(lifecycle, null, 2))
  }
  await shortcut('o')
  await until(
    async () => {
      const p = await probe()
      return p.path === file && p.loading === 'ready'
    },
    'reopen',
    20000,
  )
}
async function check(name, fn) {
  const started = performance.now()
  await fn()
  results.push({ name, ms: performance.now() - started, status: 'PASS' })
  console.log('PASS ' + name)
  await writeFile(path.join(root, 'results.json'), JSON.stringify(results, null, 2))
}
async function screenshot(name) {
  await delay(250)
  await writeFile(
    path.join(root, name + '.png'),
    Buffer.from(await request('GET', `/session/${sid}/screenshot`), 'base64'),
  )
}
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
        'return window.__searchProfileReady&&window.__searchProbe().path===arguments[0]&&window.__searchProbe().loading==="ready"',
        file,
      ),
    'CLI ready',
    20000,
  )
  for (const mode of ['source', 'live']) {
    await key(escape)
    await shortcut(mode === 'source' ? '1' : '2')
    await check(mode + ' locale expansion original UTF16 coordinates', async () => {
      const p = await query('i', 9)
      assert.deepEqual(
        p.matches.map((x) => x.from),
        iPositions,
      )
      assert.deepEqual(
        p.matches.map((x) => x.text),
        ['İ', 'I', 'i', 'İ', 'I', 'i', 'İ', 'I', 'i'],
      )
      await click('[data-search-case]')
      await until(async () => {
        const p = await probe()
        return p.phase === 'done' && p.matchCount === 3
      }, 'case sensitive')
      await click('[data-search-case]')
      await until(async () => {
        const p = await probe()
        return p.phase === 'done' && p.matchCount === 9
      }, 'case insensitive')
      const sigma = await query('Σ', 3)
      assert.deepEqual(
        sigma.matches.map((x) => x.from),
        positions.map((x) => x + 10),
      )
      const final = await query('ς', 3)
      assert.deepEqual(
        final.matches.map((x) => x.from),
        positions.map((x) => x + 13),
      )
      const cjk = await query('中文😀', 3)
      assert.deepEqual(
        cjk.matches.map((x) => x.from),
        positions.map((x) => x + 15),
      )
      await screenshot(mode + '-unicode')
    })
    await check(mode + ' Unicode replace literal dollars save reopen undo redo', async () => {
      await query('i', 9)
      await focus('[data-replace-input]')
      await shortcut('a')
      await text('$1😀')
      await click('[data-replace-all]')
      await until(async () => {
        const p = await probe()
        if (!p.replacing && p.notice.includes('失败')) throw Error(p.notice)
        return !p.replacing && p.dirty
      }, 'Unicode commit')
      await saved(expectedReplace)
      await shortcut('z')
      await saved(bytes)
      await shortcut('y')
      await saved(expectedReplace)
      await screenshot(mode + '-unicode-replaced')
      await shortcut('z')
      await saved(bytes)
      await reopen()
    })
  }

  await check('native IPC failure and cancellation preserve disk bytes', async () => {
    const apiFile = path.join(root, 'api-failure.md')
    const original = Buffer.from('x'.repeat(8192))
    await writeFile(apiFile, original)
    const ipc = (command, args) =>
      request('POST', `/session/${sid}/execute/async`, {
        script:
          'const done=arguments[arguments.length-1];window.__TAURI_INTERNALS__.invoke(arguments[0],arguments[1]).then(value=>done({ok:true,value})).catch(error=>done({ok:false,error:String(error)}))',
        args: [command, args],
      })
    const doc = 'phase14-failure'
    assert.equal((await ipc('open_large_text_file', { documentId: doc, path: apiFile })).ok, true)
    const search = {
      documentId: doc,
      expectedVersion: 0,
      searchId: 'failure-search',
      generation: 2,
      query: 'x',
      caseSensitive: false,
      asciiFoldSafe: true,
    }
    assert.equal((await ipc('begin_large_text_search', { request: search })).ok, true)
    const stale = await ipc('begin_large_text_search', {
      request: { ...search, generation: 1, searchId: 'stale' },
    })
    assert.equal(stale.ok, false)
    assert.match(stale.error, /superseded/)
    const step = await ipc('step_large_text_search', { searchId: search.searchId })
    assert.equal(step.value.complete, true)
    assert.equal(step.value.matchCount, 8192)
    const failure = await ipc('begin_large_text_replacement', {
      request: {
        documentId: doc,
        expectedVersion: 0,
        searchId: search.searchId,
        replacementId: 'budget',
        insert: 'a'.repeat(1024 * 1024),
        selectedIndex: null,
      },
    })
    assert.equal(failure.ok, false)
    assert.match(failure.error, /4 GiB/)
    assert.deepEqual(await readFile(apiFile), original)
    assert.equal((await ipc('cancel_large_text_search', { searchId: search.searchId })).ok, true)
    assert.equal(
      (await ipc('page_large_text_search', { searchId: search.searchId, start: 0 })).ok,
      false,
    )
    assert.equal((await ipc('close_large_text_file', { documentId: doc })).ok, true)
    await writeFile(
      path.join(root, 'native-failure-results.json'),
      JSON.stringify({ stale, failure }, null, 2),
    )
  })
  console.log(JSON.stringify({ passed: results.length, fixture: metadata, positions }))
} catch (error) {
  if (sid) {
    await writeFile(
      path.join(root, 'failure.json'),
      JSON.stringify({ error: String(error), state: await probe().catch(() => ({})) }, null, 2),
    )
    await screenshot('failure').catch(() => {})
  }
  throw error
} finally {
  if (sid) await request('DELETE', `/session/${sid}`).catch(() => {})
  cleanupNativeApplication(application)
}

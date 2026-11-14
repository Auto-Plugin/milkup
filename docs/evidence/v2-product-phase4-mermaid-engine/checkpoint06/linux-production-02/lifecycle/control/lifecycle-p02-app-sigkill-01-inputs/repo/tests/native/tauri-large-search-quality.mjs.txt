import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { observeNativeMemory } from '../helpers/native-process-memory.mjs'
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
const xtest = process.env.MILKUP_NATIVE_XTEST === '1'
const xkey = (value) =>
  ({ '\uE009': 'Control_L', '\uE00C': 'Escape', '\uE007': 'Return', '\uE011': 'Home' })[value] ??
  value
async function actions(keys) {
  if (xtest) {
    for (const event of keys)
      execFileSync('xdotool', [event.type === 'keyDown' ? 'keydown' : 'keyup', xkey(event.value)], {
        env: { ...process.env, DISPLAY: process.env.DISPLAY ?? ':99' },
      })
    return
  }

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
console.log('KEYBOARD_TRANSPORT ' + (xtest ? 'XTest' : 'WebDriver'))
const finishMemory = observeNativeMemory()
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
async function reopen() {
  await execute(
    'localStorage.setItem("milkup.desktop.nativeTestPaths",JSON.stringify({open:arguments[0]}))',
    file,
  )
  await shortcut('n')
  await until(() => execute('return !window.__searchProbe().path'), 'new empty')
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
  if (
    process.env.MILKUP_NATIVE_CASE_REGEX &&
    !new RegExp(process.env.MILKUP_NATIVE_CASE_REGEX).test(name)
  )
    return
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
  if (xtest) {
    const windows = execFileSync('xdotool', ['search', '--class', 'milkup-desktop'], {
      encoding: 'utf8',
      env: { ...process.env, DISPLAY: process.env.DISPLAY ?? ':99' },
    })
      .trim()
      .split('\n')
    execFileSync('xdotool', ['windowfocus', '--sync', windows.at(-1)], {
      env: { ...process.env, DISPLAY: process.env.DISPLAY ?? ':99' },
    })
  }
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
    for (const [needle, count] of [
      ['BEGIN', 1],
      ['row0819200', 1],
      ['tailneedle', 1],
      ['nonexistentneedle', 0],
    ])
      await check(mode + ' ' + needle, () => query(needle, count))
    await check(mode + ' dense complete results and wrap to last', async () => {
      await execute('window.__resetSearchProfile()')
      await query('x', 83558400)
      await click('[data-search-previous]')
      await until(async () => {
        const p = await probe()
        return p.matchOffset === 83558399
      }, 'last dense page')
      const p = await probe()
      assert.equal(p.matches[0].line, 1638401)
      assert.equal(p.matches[0].lineOffset, 61)
      await writeFile(
        path.join(root, mode + '-dense.json'),
        JSON.stringify(
          await execute('return {profile:window.__searchProfile,state:window.__searchProbe()}'),
          null,
          2,
        ),
      )
      await screenshot(mode + '-dense')
      await execute('window.__searchProfile.enabled=false')
    })
    await check(mode + ' rapid query supersession', async () => {
      await shortcut('f')
      await shortcut('a')
      await text('x')
      await delay(250)
      await shortcut('a')
      await text('row0819200')
      await delay(250)
      await shortcut('a')
      await text('tailneedle')
      await until(
        async () => {
          const p = await probe()
          return p.query === 'tailneedle' && p.phase === 'done'
        },
        'latest query',
        20000,
      )
      assert.equal((await probe()).matchCount, 1)
    })
    await check(mode + ' edit during search invalidates old version', async () => {
      await shortcut('f')
      await shortcut('a')
      await text('x')
      await delay(300)
      const inputStarted = performance.now()
      await focus('.milkup-input-proxy')
      await shortcut('\uE011')
      await text('Q')
      await until(async () => {
        const p = await probe()
        return p.dirty && p.version > 0
      }, 'edit accepted')
      await writeFile(
        path.join(root, mode + '-input-response.json'),
        JSON.stringify(
          { nativeKeyboardToVersionMs: performance.now() - inputStarted, state: await probe() },
          null,
          2,
        ),
      )
      await until(
        async () => {
          const p = await probe()
          return p.phase === 'done'
        },
        'search after edit',
        30000,
      )
      assert.equal((await probe()).matchCount, 83558400)
      await key(escape)
      await shortcut('z')
      await saved(bytes)
    })
    await check(mode + ' cancel full replacement before commit', async () => {
      await query('row', 1638400)
      await focus('[data-replace-input]')
      await shortcut('a')
      await text('R')
      await click('[data-replace-all]')
      await until(async () => (await probe()).replacing, 'preparation started')
      await click('[data-replace-cancel]')
      await until(async () => !(await probe()).replacing, 'cancel finished', 15000)
      assert.equal((await probe()).dirty, false)
      await saved(bytes)
    })
    await check(mode + ' single replacement saved and whole undo redo', async () => {
      await query('tailneedle', 1)
      await focus('[data-replace-input]')
      await shortcut('a')
      await text('TAIL')
      await click('[data-replace-one]')
      await until(
        async () => {
          const p = await probe()
          return !p.replacing && p.dirty
        },
        'single commit',
        20000,
      )
      const expected = Buffer.from(bytes.toString('utf8').replace('tailneedle', 'TAIL'))
      await saved(expected)
      await shortcut('z')
      await saved(bytes)
      await shortcut('y')
      await saved(expected)
      await shortcut('z')
      await saved(bytes)
    })
    await check(mode + ' full replacement saved reopened and entire history', async () => {
      await query('row', 1638400)
      await focus('[data-replace-input]')
      await shortcut('a')
      await text('R')
      await click('[data-replace-all]')
      await until(
        async () => {
          const p = await probe()
          if (!p.replacing && p.notice.includes('失败')) throw Error(p.notice)
          return !p.replacing && p.dirty
        },
        'all commit',
        25000,
      )
      const expected = Buffer.from(bytes.toString('utf8').replaceAll('row', 'R'))
      await saved(expected)
      await screenshot(mode + '-replaced')
      await shortcut('z')
      await saved(bytes)
      await shortcut('y')
      await saved(expected)
      await reopen()
      await query('R0819200', 1)
      await key(escape)
      // Restore the independently verified fixture through real search replacement.
      await query('R', 1638400)
      await focus('[data-replace-input]')
      await shortcut('a')
      await text('row')
      await click('[data-replace-all]')
      await until(
        async () => {
          const p = await probe()
          return !p.replacing && p.dirty
        },
        'restore all',
        25000,
      )
      await saved(bytes)
      await reopen()
    })
  }
  console.log(JSON.stringify({ passed: results.length, fixture: metadata }))
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
  await writeFile(path.join(root, 'memory.json'), JSON.stringify(await finishMemory(), null, 2))
  if (sid) await request('DELETE', `/session/${sid}`).catch(() => {})
  cleanupNativeApplication(application)
}

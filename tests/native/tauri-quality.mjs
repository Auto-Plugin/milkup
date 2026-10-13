// Real Tauri/WebKit + real disk regression. Start tauri-driver and the Vite
// desktop server first; file picker paths are supplied through the existing
// native test seam. This does NOT claim OS file-picker or system IME coverage.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, writeFile, readFile, chmod, stat } from 'node:fs/promises'
import path from 'node:path'

const base = process.env.TAURI_DRIVER_URL ?? 'http://127.0.0.1:4444'
const output = process.env.MILKUP_NATIVE_EVIDENCE_DIR ?? `/tmp/milkup-native-quality-${Date.now()}`
const application =
  process.env.TAURI_APP_PATH ?? path.resolve('apps/desktop/src-tauri/target/debug/milkup-desktop')
await mkdir(output, { recursive: true })
const results = []
let sid
let nativeWindowId
function x11Windows() {
  return execFileSync('xwininfo', ['-root', '-tree'], {
    encoding: 'utf8',
    env: { ...process.env, DISPLAY: process.env.DISPLAY ?? ':99' },
  })
}
function nativeWindowGone() {
  if (!nativeWindowId) return false
  // A successful root-window query is required; a dead X server is not a pass.
  return !x11Windows().includes(nativeWindowId + ' ')
}
async function windowClosed() {
  try {
    const handles = await req('GET', `/session/${sid}/window/handles`)
    return handles.length === 0 && (!nativeWindowId || nativeWindowGone())
  } catch (error) {
    if (/no such window|invalid session id/i.test(String(error)))
      return !nativeWindowId || nativeWindowGone()
    if (String(error).includes('Session terminated without a reply') && nativeWindowGone())
      return true
    throw error
  }
}
async function req(method, route, body) {
  if (process.env.MILKUP_NATIVE_TRACE) console.log(method, route, body?.script?.slice(0, 100) ?? '')
  const r = await fetch(base + route, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  }).catch((error) => {
    throw Error(`${method} ${route}: ${error}`)
  })
  const j = await r.json()
  if (!r.ok || (j.value?.error && !('ok' in j.value))) throw Error(JSON.stringify(j))
  return 'value' in j ? j.value : j
}
const execute = (script, ...args) => req('POST', `/session/${sid}/execute/sync`, { script, args })
const delay = (ms) => new Promise((r) => setTimeout(r, ms))
async function until(fn, label) {
  for (let i = 0; i < 100; i++) {
    const value = await fn()
    if (value) return value
    await delay(100)
  }
  throw Error(`Timeout: ${label}`)
}
async function ipc(command, args = {}) {
  return req('POST', `/session/${sid}/execute/async`, {
    script:
      'const done=arguments[arguments.length-1];window.__TAURI_INTERNALS__.invoke(arguments[0],arguments[1]).then(v=>done({ok:true,value:v})).catch(e=>done({ok:false,error:String(e)}))',
    args: [command, args],
  })
}
async function key(...values) {
  await req('POST', `/session/${sid}/actions`, {
    actions: [
      {
        type: 'key',
        id: 'keyboard',
        actions: values.flatMap((value) => [
          { type: 'keyDown', value },
          { type: 'keyUp', value },
        ]),
      },
    ],
  })
}
async function chord(...values) {
  await req('POST', `/session/${sid}/actions`, {
    actions: [
      {
        type: 'key',
        id: 'keyboard',
        actions: [
          ...values.map((value) => ({ type: 'keyDown', value })),
          ...values.toReversed().map((value) => ({ type: 'keyUp', value })),
        ],
      },
    ],
  })
}
const shortcut = (char) => chord('\uE009', char)
const text = (value) => key(...value)
const editor = () =>
  execute(
    'return (document.querySelector(".milkup-editor-content")?.textContent ?? "").replace(/\\u200b/g, "")',
  )
const confirming = () => execute('return !document.querySelector("[data-close-confirm]").hidden')
const focus = () => execute('document.querySelector(".milkup-input-proxy")?.focus()')
async function choose(action) {
  await execute(
    'document.querySelector(arguments[0]).focus()',
    `.dialog-button[data-close-confirm-action="${action}"]`,
  )
  await key('\uE007')
}
async function paths(open, saveAs) {
  await execute(
    'localStorage.setItem("milkup.desktop.nativeTestPaths", JSON.stringify(arguments[0]))',
    { open, saveAs },
  )
}
async function ready() {
  await until(
    () =>
      execute(
        'return ["idle", "ready"].includes(document.querySelector("#app").dataset.loading) && document.querySelector("#app").dataset.saving !== "true"',
      ),
    'idle document workflow',
  )
}
async function fresh() {
  await ready()
  await focus()
  await shortcut('n')
  await delay(200)
  if (await confirming()) await choose('discard')
  await until(async () => (await editor()) === '', 'fresh draft')
  await ready()
  await focus()
}
async function shot(name) {
  // DOM assertions can become true before WebKit's compositor presents a frame.
  await req('POST', `/session/${sid}/execute/async`, {
    script:
      'const done = arguments[arguments.length - 1]; requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(done, 200)))',
    args: [],
  })
  await writeFile(
    path.join(output, `${name}.png`),
    Buffer.from(await req('GET', `/session/${sid}/screenshot`), 'base64'),
  )
}
async function check(name, action) {
  if (process.env.MILKUP_NATIVE_CASE && !name.includes(process.env.MILKUP_NATIVE_CASE)) return
  await action()
  results.push({ name, result: 'PASS' })
  console.log(`PASS ${name}`)
}
async function start() {
  const session = await req('POST', '/session', {
    capabilities: { alwaysMatch: { browserName: 'wry', 'tauri:options': { application } } },
  })
  sid = session.sessionId
  await until(
    () => execute('return !!document.querySelector(".milkup-input-proxy")'),
    'native editor',
  )
  nativeWindowId = undefined
  if (process.platform === 'linux') {
    await until(() => {
      const matches = [...x11Windows().matchAll(/(0x[0-9a-f]+) "milkup": \("milkup-desktop"/g)]
      if (matches.length !== 1) return false
      nativeWindowId = matches[0][1]
      return true
    }, 'one native X11 window')
  }
}
try {
  await start()
  assert.deepEqual(await ipc('bridge_status'), { ok: true, value: 'ok' })
  for (const [kind, char] of [
    ['new', 'n'],
    ['open', 'o'],
    ['close', 'w'],
  ]) {
    const open = path.join(output, `${kind}-open.md`)
    const saved = path.join(output, `${kind}-saved.md`)
    await writeFile(open, `${kind} opened fixture`)
    await paths(open, saved)
    await check(`${kind}: cancel, focus, discard`, async () => {
      await fresh()
      await text(`${kind} unsaved`)
      await shortcut(char)
      await until(confirming, 'confirmation')
      assert.equal(
        await execute('return document.activeElement.dataset.closeConfirmAction'),
        'cancel',
      )
      // Tab and Shift+Tab must stay inside the confirmation dialog.
      for (let i = 0; i < 6; i++) await key('\uE004')
      assert.equal(
        await execute('return !!document.activeElement.closest("[data-close-confirm]")'),
        true,
      )
      await chord('\uE008', '\uE004')
      await key('\uE00C')
      await until(async () => !(await confirming()), 'cancel')
      assert.equal(await editor(), `${kind} unsaved`)
      assert.equal(
        await execute('return document.activeElement.classList.contains("milkup-input-proxy")'),
        true,
      )
      await text(' retained')
      await shortcut(char)
      await until(confirming, 'confirm again')
      if (kind === 'new') await shot('native-confirm')
      await choose('discard')
      await until(
        async () => (await editor()) === (kind === 'open' ? `${kind} opened fixture` : ''),
        'discard transition',
      )
    })
    await check(`${kind}: save then transition with disk bytes`, async () => {
      await fresh()
      await text(`${kind} saved bytes`)
      await shortcut(char)
      await until(confirming, 'confirmation')
      await choose('save')
      await until(async () => !(await confirming()), 'saved transition')
      await until(
        async () => (await editor()) === (kind === 'open' ? `${kind} opened fixture` : ''),
        'destination',
      )
      assert.equal(await readFile(saved, 'utf8'), `${kind} saved bytes`)
    })
  }
  await check('real missing-directory save failure retains draft and supports retry', async () => {
    await fresh()
    await text('keep after disk failure')
    await paths(undefined, path.join(output, 'missing-parent', 'failed.md'))
    await shortcut('n')
    await until(confirming, 'confirmation')
    await choose('save')
    await until(
      () =>
        execute(
          'return document.querySelector("[data-close-confirm]").innerText.includes("保存失败")',
        ),
      'visible error',
    )
    assert.equal(await editor(), 'keep after disk failure')
    await shot('native-save-error')
    await paths(undefined, path.join(output, 'retry.md'))
    await choose('save')
    await until(async () => !(await confirming()) && (await editor()) === '', 'retry')
    assert.equal(await readFile(path.join(output, 'retry.md'), 'utf8'), 'keep after disk failure')
  })
  await check(
    'native save catches external write before watcher and saves rescue copy',
    async () => {
      const file = path.join(output, 'race.md'),
        copy = path.join(output, 'race-copy.md')
      await writeFile(file, 'original')
      await paths(file, copy)
      await shortcut('o')
      await until(async () => (await editor()) === 'original', 'open race fixture')
      await ready()
      await ipc('unwatch_markdown_file', { documentId: `file:${file}` })
      await focus()
      await text('local ')
      await until(async () => (await editor()) === 'local original', 'local edit committed')
      await writeFile(file, 'external before watcher')
      await shortcut('s')
      await until(
        () => execute('return document.body.innerText.includes("refusing to overwrite")'),
        'native conflict error',
      )
      assert.equal(await editor(), 'local original')
      assert.equal(await readFile(file, 'utf8'), 'external before watcher')
      await shot('native-disk-conflict')
      await chord('\uE009', '\uE008', 's')
      await until(async () => {
        try {
          return (await readFile(copy, 'utf8')) === 'local original'
        } catch {
          return false
        }
      }, 'rescue copy')
      assert.equal(await readFile(file, 'utf8'), 'external before watcher')
    },
  )
  await check(
    'real readonly failure preserves bytes and recovers after permissions restored',
    async () => {
      const file = path.join(output, 'readonly.md')
      await fresh()
      await writeFile(file, 'readonly base')
      await paths(file, undefined)
      await shortcut('o')
      await until(async () => (await editor()) === 'readonly base', 'open readonly fixture')
      await ready()
      await focus()
      await text('local ')
      await chmod(file, 0o444)
      try {
        await shortcut('s')
        await until(
          () => execute('return document.body.innerText.includes("read-only")'),
          'readonly error',
        )
        assert.equal(await readFile(file, 'utf8'), 'readonly base')
        assert.equal(await editor(), 'local readonly base')
      } finally {
        await chmod(file, 0o600)
      }
      await shortcut('s')
      await until(
        async () => (await readFile(file, 'utf8')) === 'local readonly base',
        'retry saved',
      )
    },
  )
  await check(
    'native large file disk save, conflict guard and active buffer lifecycle',
    async () => {
      const file = path.join(output, 'large-ipc.md')
      const first = 'phase4-first',
        second = 'phase4-second'
      await writeFile(file, 'large original\n')
      await chmod(file, 0o640)
      assert.equal((await ipc('open_large_text_file', { documentId: first, path: file })).ok, true)
      assert.equal(
        (
          await ipc('apply_large_text_file_changes', {
            documentId: first,
            expectedVersion: 0,
            changes: [{ fromUtf16: 0, toUtf16: 0, insert: 'local ' }],
          })
        ).ok,
        true,
      )
      assert.equal((await ipc('open_large_text_file', { documentId: second, path: file })).ok, true)
      assert.equal(
        (await ipc('flush_large_text_file', { documentId: first, expectedVersion: 1 })).ok,
        true,
      )
      assert.equal(await readFile(file, 'utf8'), 'local large original\n')
      assert.equal((await stat(file)).mode & 0o777, 0o640)
      await ipc('close_large_text_file', { documentId: second })
      assert.equal(
        (
          await ipc('apply_large_text_file_changes', {
            documentId: first,
            expectedVersion: 1,
            changes: [{ fromUtf16: 0, toUtf16: 0, insert: 'dirty ' }],
          })
        ).ok,
        true,
      )
      await chmod(file, 0o444)
      const readonly = await ipc('flush_large_text_file', { documentId: first, expectedVersion: 2 })
      assert.equal(readonly.ok, false)
      assert.match(readonly.error, /read-only/)
      assert.equal(await readFile(file, 'utf8'), 'local large original\n')
      await chmod(file, 0o640)
      await writeFile(file, 'external replacement')
      const conflict = await ipc('flush_large_text_file', { documentId: first, expectedVersion: 2 })
      assert.equal(conflict.ok, false)
      assert.match(conflict.error, /changed outside/)
      const alias = await ipc('flush_large_text_file_as', {
        documentId: first,
        expectedVersion: 2,
        path: path.dirname(file) + '/./' + path.basename(file),
      })
      assert.equal(alias.ok, false)
      assert.match(alias.error, /changed outside/)
      assert.equal(await readFile(file, 'utf8'), 'external replacement')
      await ipc('close_large_text_file', { documentId: first })
    },
  )
  await check('native window close event: cancel and save', async () => {
    await fresh()
    await text('native window draft')
    await paths(undefined, path.join(output, 'window-saved.md'))
    await ipc('window_control', { action: 'close' })
    await until(confirming, 'OS close protection')
    await key('\uE00C')
    await until(async () => !(await confirming()), 'OS close cancel')
    assert.equal(await editor(), 'native window draft')
    await text(' retained')
    await ipc('window_control', { action: 'close' })
    await until(confirming, 'OS close protection again')
    await shot('native-window-close')
    await choose('save')
    await until(async () => {
      try {
        return (
          (await readFile(path.join(output, 'window-saved.md'), 'utf8')) ===
          'native window draft retained'
        )
      } catch {
        return false
      }
    }, 'window bytes saved')
    await until(windowClosed, 'window closed')
  })
  await req('DELETE', `/session/${sid}`).catch(() => {})
  sid = undefined
  await start()
  // Clear the persistent test picker override while this final window is still alive.
  await execute('localStorage.removeItem("milkup.desktop.nativeTestPaths")')
  await check('native window close event: discard', async () => {
    await focus()
    await text('discard window draft')
    await ipc('window_control', { action: 'close' })
    await until(confirming, 'OS close protection')
    await choose('discard').catch((error) => {
      if (!String(error).includes('Session terminated without a reply')) throw error
    })
    await until(windowClosed, 'discard closes window')
  })
} catch (error) {
  results.push({ result: 'FAIL', error: String(error) })
  if (sid) await shot('native-failure').catch(() => {})
  throw error
} finally {
  await writeFile(
    path.join(output, 'results.json'),
    JSON.stringify(
      {
        engine: 'Tauri / WebKitGTK',
        filePicker: 'test path selection seam; Rust I/O is real',
        systemIme: 'not tested',
        results,
      },
      null,
      2,
    ),
  )
  if (sid) {
    await execute('localStorage.removeItem("milkup.desktop.nativeTestPaths")').catch(() => {})
    await req('DELETE', `/session/${sid}`).catch(() => {})
  }
}
console.log(`Native quality evidence: ${output}`)

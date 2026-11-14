// Bounded normal-document native code-picker smoke; no DOM writes or plugin/API calls.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { startProduction } from '../helpers/native-production.mjs'
import { nativeFixture, x } from '../helpers/native-updates-fixture.mjs'

assert.equal(process.env.MILKUP_NATIVE_EXCLUSIVE_DISPLAY, '1')
assert(process.env.TAURI_APP_PATH && process.env.MILKUP_NATIVE_EXPECTED_BINARY_SHA256)
assert(!process.env.WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS && !process.env.LD_PRELOAD)
const binary = await realpath(process.env.TAURI_APP_PATH)
assert(!binary.includes('/target/'), 'Use the frozen current-source binary copy')
const profile = await realpath(process.env.MILKUP_NATIVE_PROFILE_ROOT)
for (const name of ['XDG_CONFIG_HOME', 'XDG_CACHE_HOME', 'XDG_DATA_HOME'])
  assert((await realpath(process.env[name])).startsWith(profile + path.sep))
const sha = (value) => createHash('sha256').update(value).digest('hex')
assert.equal(
  sha(await readFile(process.env.TAURI_APP_PATH)),
  process.env.MILKUP_NATIVE_EXPECTED_BINARY_SHA256,
)
const output = process.env.MILKUP_NATIVE_EVIDENCE_DIR
assert(output)
await mkdir(output, { recursive: true })
const body = 'const 名 = "😀 <img src=x>"; // 原文保持'
const results = []
for (const fixture of [
  {
    id: 'missing-language',
    opening: '```',
    next: '```javascript',
    key: 'Down',
    target: 'javascript',
    originalLanguage: '',
  },
  {
    id: 'known-to-plain',
    opening: '```js title="demo"',
    next: '```text title="demo"',
    key: 'Home',
    target: '',
    originalLanguage: 'javascript',
  },
]) {
  const file = path.join(output, fixture.id + '.md')
  const original = fixture.opening + '\r\n' + body + '\r\n```\r\n'
  const edited = fixture.next + '\r\n' + body + '\r\n```\r\n'
  await writeFile(file, original, { flag: 'wx' })
  const runOutput = path.join(output, fixture.id)
  await mkdir(runOutput)
  let app
  const ui = nativeFixture(() => app)
  const row = { name: fixture.id, passed: false }
  try {
    app = await startProduction(file, runOutput, { diagnostics: false })
    if (
      await app.execute(
        'return !!document.querySelector("[data-recovery-close]")?.getClientRects().length',
      )
    )
      await ui.click('[data-recovery-close]')
    await app.key('ctrl+0')
    await app.key('ctrl+2')
    x('windowsize', ui.windowId(), '1100', '760')
    await ui.ready('.milkup-code-language')
    await app.until(
      () => app.execute('return Number(document.querySelector("#app").dataset.appearanceZoom)===1'),
      'native zoom reset',
    )
    row.initial = await app.execute(
      'return {theme:document.documentElement.dataset.theme,keywords:document.querySelectorAll(".milkup-code-token-keyword").length,languages:[...document.querySelectorAll("[data-code-language]")].map(e=>e.dataset.codeLanguage)}',
    )
    const point = await app.until(async () => {
      if (
        await app.execute(
          'return !!document.querySelector("[data-recovery-close]")?.getClientRects().length',
        )
      ) {
        await app.key('Escape')
        return false
      }
      const target = await app.execute(
        `const e=document.querySelector('.milkup-code-language'),r=e.getBoundingClientRect();return {x:(r.left+r.right)/2,y:(r.top+r.bottom)/2,hit:e===document.elementFromPoint((r.left+r.right)/2,(r.top+r.bottom)/2)}`,
      )
      return target.hit ? target : false
    }, 'unobscured native code language picker')
    assert(point.hit)
    x(
      'mousemove',
      '--window',
      ui.windowId(),
      String(Math.round(point.x)),
      String(Math.round(point.y)),
      'click',
      '1',
    )
    await app.key(fixture.key)
    await app.key('Return')
    const opening = () =>
      app.execute('return document.querySelector(".milkup-code-source")?.textContent')
    const observe = () =>
      app.execute(
        `return {opening:document.querySelector('.milkup-code-source')?.textContent,body:document.querySelectorAll('.milkup-code-source')[1]?.textContent,keywords:document.querySelectorAll('.milkup-code-token-keyword').length,languages:[...document.querySelectorAll('[data-code-language]')].map(e=>e.dataset.codeLanguage),images:document.querySelectorAll('.milkup-code-source img').length,focus:document.activeElement?.outerHTML.slice(0,300)}`,
      )
    await app.until(
      async () => (await opening()) === fixture.next,
      'native language selection changed fence only',
    )
    try {
      await app.until(
        async () => {
          const state = await observe()
          return (
            state.languages.every((language) => language === fixture.target) &&
            (fixture.target ? state.keywords > 0 : state.keywords === 0)
          )
        },
        'language highlighting updated',
        5000,
      )
    } catch (error) {
      row.highlightError = String(error)
    }
    row.selected = await observe()
    assert.equal(row.selected.body, body)
    assert.equal(
      row.selected.languages.length,
      3,
      'Only opening, body and closing fence are code lines',
    )
    row.highlightPassed =
      row.selected.languages.every((language) => language === fixture.target) &&
      (fixture.target ? row.selected.keywords > 0 : row.selected.keywords === 0)
    assert.equal(row.selected.images, 0)
    await app.shot('selected-webdriver')
    execFileSync(
      '/usr/bin/import',
      [
        '-display',
        process.env.DISPLAY,
        '-window',
        'root',
        path.join(runOutput, 'selected-system.png'),
      ],
      { env: process.env, timeout: 10000 },
    )
    await app.key('ctrl+z')
    await app.until(
      async () => (await opening()) === fixture.opening,
      'Undo restores original fence',
    )
    row.undo = await observe()
    assert.equal(row.undo.body, body)
    assert.equal(row.undo.languages.length, 3)
    assert(row.undo.languages.every((language) => language === fixture.originalLanguage))
    assert(fixture.originalLanguage ? row.undo.keywords > 0 : row.undo.keywords === 0)
    await app.key('ctrl+shift+z')
    await app.until(async () => (await opening()) === fixture.next, 'Redo restores language edit')
    row.redo = await observe()
    assert.equal(row.redo.languages.length, 3)
    assert(row.redo.languages.every((language) => language === fixture.target))
    assert(fixture.target ? row.redo.keywords > 0 : row.redo.keywords === 0)
    await app.key('ctrl+1')
    row.source = await app.execute(
      `return {mode:document.querySelector('.milkup-editor').dataset.mode,opening:document.querySelector('.milkup-line[data-line="1"]').textContent,body:document.querySelector('.milkup-line[data-line="2"]').textContent,pickers:document.querySelectorAll('.milkup-code-language').length}`,
    )
    assert.equal(row.source.mode, 'source')
    assert.equal(row.source.opening, fixture.next)
    assert.equal(row.source.body, body)
    assert.equal(row.source.pickers, 0)
    await app.key('ctrl+s')
    await app.until(
      async () => !(await app.probe()).dirty && (await readFile(file, 'utf8')) === edited,
      'saved source bytes match expected CRLF document',
    )
    row.originalSha256 = sha(original)
    row.savedSha256 = sha(await readFile(file))
    row.expectedSha256 = sha(edited)
    row.functionalPassed = true
    row.passed = row.highlightPassed
  } catch (error) {
    row.error = String(error)
    row.stack = error.stack
    await app?.shot('failure').catch(() => {})
  } finally {
    await app?.close()
  }
  results.push(row)
  await writeFile(
    path.join(output, 'results.json'),
    JSON.stringify(
      {
        binary,
        profile,
        binarySha256: process.env.MILKUP_NATIVE_EXPECTED_BINARY_SHA256,
        boundary:
          'Linux native normal small document, observed theme recorded per case, 100% native zoom; not large/windowed document, Windows, OS DPI or IME.',
        results,
      },
      null,
      2,
    ),
  )
}
console.log(
  'BETA3 NATIVE CODE',
  results.map((row) => ({
    name: row.name,
    functionalPassed: row.functionalPassed,
    highlightPassed: row.highlightPassed,
  })),
)
if (!results.every((row) => row.passed)) process.exitCode = 1

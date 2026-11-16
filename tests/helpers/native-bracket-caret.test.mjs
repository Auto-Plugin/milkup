import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { bracketFixture, delayedBracket, idleMinimumMs } from './native-bracket-caret.mjs'
function model(fail = '') {
  const fixture = bracketFixture(), result = {}, events = []; let now = 0, position = 0, text = fixture.original, disk = fixture.original
  const snap = () => ({ position, editorFocused: !(fail === 'focus' && now >= 3000), nativeFocus: 'owned-window', mode: 'live', scrollTop: fail === 'scroll' && now >= 3000 ? 500 : 200, scrollLeft: 0 })
  const io = {
    now: () => now, persist: async () => { events.push(['persist', result.stage, result.status]) },
    delay: async ms => { now += ms; if (fail === 'late-caret' && now >= 3000) position = text.length },
    place: async n => { position = n; events.push(['place', n]) },
    type: async value => { events.push(['type', value, now]); text = text.slice(0, position) + value + text.slice(position); position += value.length },
    snapshot: async () => snap(), ready: async expected => { assert.equal(position, expected); return snap() },
    save: async expected => { disk = fail === 'disk' ? text + 'WRONG' : text; assert.equal(disk, expected); events.push(['saved']) },
    reopen: async expected => { assert.equal(fail === 'reopen' ? 'wrong document' : disk, expected); events.push(['reopened']) },
  }
  return { io, fixture, result, events }
}
test('synthetic fixture has line and document suffix; this test is not native evidence', async () => {
  const m = model(); assert(m.fixture.position > 100); assert(m.fixture.original.slice(m.fixture.position).startsWith(') 后缀'))
  assert(m.fixture.original.endsWith('ISSUE255-DOCUMENT-END\n'))
  await delayedBracket(m.io, m.fixture, m.result)
  assert.equal(m.result.status, 'contract-passed'); assert(m.result.idleMs >= idleMinimumMs)
  const keys = m.events.filter(e => e[0] === 'type'); assert.deepEqual(keys.map(e => e[1]), ['Ab12', 'Z']); assert(keys[1][2] >= 3200)
  assert.equal(m.events.filter(e => e[0] === 'place').length, 1)
  assert(m.events.some(e => e[0] === 'reopened'))
})
for (const failure of ['late-caret', 'focus', 'scroll', 'disk', 'reopen']) test('reject and preserve phase evidence: ' + failure, async () => {
  const m = model(failure); await assert.rejects(delayedBracket(m.io, m.fixture, m.result)); assert.equal(m.result.status, 'failed'); assert(m.result.error); assert(m.result.samples.length)
  assert.equal(m.events.at(-1)[0], 'persist'); assert.equal(m.events.at(-1)[2], 'failed')
  if (['late-caret', 'focus', 'scroll'].includes(failure)) assert(!m.events.some(e => e[0] === 'type' && e[1] === 'Z'))
})
test('installed daily wrapper actually invokes bounded native case before existing GUI', () => {
  const shell = readFileSync(new URL('../../scripts/ci/run-linux-installed-gui.sh', import.meta.url), 'utf8')
  const runner = readFileSync(new URL('../../scripts/ci/linux-installed-bracket-caret.mjs', import.meta.url), 'utf8')
  assert(shell.indexOf('linux-installed-bracket-caret.mjs') < shell.indexOf('node scripts/ci/linux-installed-gui.mjs'))
  assert(shell.includes('180s node scripts/ci/linux-installed-bracket-caret.mjs'))
  for (const value of ['MILKUP_NATIVE_EXPECTED_BINARY_SHA256', 'manifest.installer.sha256', 'manifest.sourceSha', 'WM_DELETE_WINDOW', 'same owned process', "app.text(value)", 'delayedBracket']) assert(runner.includes(value))
  assert(!runner.includes('dispatchEvent')); assert(!runner.includes('localStorage.setItem'))
})

test('language-switch gap rides along without being counted as bracket/native success', () => {
  const runner = readFileSync(new URL('../../scripts/ci/linux-installed-bracket-caret.mjs', import.meta.url), 'utf8')
  assert(runner.includes("record.issue94 = { status: 'not-executed', nativePassed: false"))
  for (const text of ['currentCandidateNeedsUiVerification: true', 'survives cancellation', 'normal reopen retains entire file']) assert(runner.includes(text))
})

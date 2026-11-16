// Shared orchestration only. A fake/DOM adapter never establishes native acceptance.
import assert from 'node:assert/strict'
export const idleMinimumMs = 3200
export function bracketFixture(id = 'ISSUE255') {
  assert(/^[A-Z0-9_-]{1,40}$/.test(id))
  const before = Array.from({ length: 24 }, (_, i) => `BEFORE-${i}\n\n`).join('')
  const line = `前文 () 后缀 ${id}-LINE-END`
  const after = '\n\n' + Array.from({ length: 24 }, (_, i) => `AFTER-${i}\n\n`).join('') + id + '-DOCUMENT-END\n'
  const original = before + line + after, position = before.length + '前文 ('.length
  return { original, position, expected: original.slice(0, position) + 'Ab12Z' + original.slice(position), id }
}
export function assertStable(sample, baseline, position) {
  assert.equal(sample.position, position, 'Caret remains at the real insertion point')
  assert(typeof sample.nativeFocus === 'string' && sample.nativeFocus.length > 0, 'Observed native window focus required')
  assert(['live', 'source'].includes(sample.mode), 'Observed editable document mode required')
  assert.equal(sample.editorFocused, true, 'Editor focus retained without refocusing')
  assert.equal(sample.nativeFocus, baseline.nativeFocus, 'Native focus retained')
  assert.equal(sample.mode, baseline.mode, 'Document mode unchanged')
  for (const key of ['scrollTop', 'scrollLeft']) {
    assert(Number.isFinite(sample[key]) && Number.isFinite(baseline[key]), 'Measured editor scroll')
    assert(Math.abs(sample[key] - baseline[key]) <= 1, 'No delayed scroll jump: ' + key)
  }
}
export async function delayedBracket(io, fixture, result) {
  result.status = 'running'; result.samples = []; result.expected = fixture.expected
  try {
    result.stage = 'native-place-and-type'; await io.persist()
    await io.place(fixture.position)
    await io.type('Ab12')
    const baseline = await io.ready(fixture.position + 4)
    assertStable(baseline, baseline, fixture.position + 4)
    const started = io.now()
    result.samples.push({ elapsedMs: 0, ...baseline }); await io.persist()
    result.stage = 'idle-without-input'
    while (io.now() - started < idleMinimumMs) {
      await io.delay(100)
      const elapsedMs = io.now() - started
      const sample = await io.snapshot()
      result.samples.push({ elapsedMs, ...sample }); await io.persist()
      assertStable(sample, baseline, fixture.position + 4)
    }
    result.idleMs = io.now() - started
    assert(result.idleMs >= idleMinimumMs, 'At least three seconds of actual idle')
    // Deliberately no focus(), selection mutation or navigation before this key.
    result.stage = 'native-mark-at-existing-caret'; await io.persist()
    await io.type('Z')
    const marked = await io.ready(fixture.position + 5)
    assertStable(marked, baseline, fixture.position + 5)
    result.marked = marked; await io.persist()
    result.stage = 'save-exact-whole-file'; await io.persist()
    await io.save(fixture.expected)
    result.stage = 'normal-close-and-reopen'; await io.persist()
    await io.reopen(fixture.expected)
    result.status = 'contract-passed'; result.stage = 'complete'
  } catch (error) {
    result.status = 'failed'; result.error = String(error); throw error
  } finally { await io.persist() }
}

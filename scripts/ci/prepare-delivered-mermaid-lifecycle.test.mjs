import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createHash } from 'node:crypto'
import { recoverComparisonInput } from './prepare-delivered-mermaid-lifecycle.mjs'
const hash = (b) => createHash('sha256').update(b).digest('hex')
const installed = Buffer.from('PE fixture __TAURI_BUNDLE_TYPE_VAR_NSS suffix'),
  compiled = Buffer.from('PE fixture __TAURI_BUNDLE_TYPE_VAR_UNK suffix')
const expected = {
  installedSha: hash(installed),
  compiledSha: hash(compiled),
  bytes: installed.length,
  markerOffset: 11,
}
test('comparison reconstruction preserves original input and binds complete compiled digest', () => {
  const copy = Buffer.from(installed)
  assert.deepEqual(recoverComparisonInput(installed, expected), compiled)
  assert.deepEqual(installed, copy)
})
for (const field of ['installedSha', 'compiledSha', 'bytes', 'markerOffset'])
  test('reject mismatched ' + field, () =>
    assert.throws(() =>
      recoverComparisonInput(installed, {
        ...expected,
        [field]: typeof expected[field] === 'number' ? expected[field] + 1 : '0'.repeat(64),
      }),
    ),
  )
test('reject extra bundle marker and unrelated mutations even with matching extracted digest', () => {
  for (const b of [
    Buffer.concat([installed, Buffer.from('__TAURI_BUNDLE_TYPE_VAR_NSS')]),
    Buffer.from(installed.toString().replace('suffix', 'mutate')),
  ])
    assert.throws(() =>
      recoverComparisonInput(b, { ...expected, bytes: b.length, installedSha: hash(b) }),
    )
})

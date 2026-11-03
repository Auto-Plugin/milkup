import assert from 'node:assert/strict'
import { test } from 'node:test'
import { inspectDependencies } from './inspect-mermaid-windows-dependencies.mjs'

function image() {
  const bytes = Buffer.alloc(128)
  bytes.write('MZ')
  bytes.writeUInt32LE(64, 0x3c)
  bytes.write('PE\0\0', 64)
  bytes.writeUInt16LE(0x8664, 68)
  bytes.writeUInt16LE(0x20b, 88)
  return bytes
}
const imports = `Dump of file candidate.exe
  Image has the following dependencies:
    KERNEL32.dll
    api-ms-win-crt-runtime-l1-1-0.dll
    ucrtbase.dll
  Summary
`
test('records actual system and API-set dependencies without requiring the external VC DLL', () => {
  const result = inspectDependencies(image(), imports, image())
  assert.deepEqual(result.dlls, [
    'API-MS-WIN-CRT-RUNTIME-L1-1-0.DLL',
    'KERNEL32.DLL',
    'UCRTBASE.DLL',
  ])
  assert.equal(result.apiSets.length, 1)
  assert.equal(result.readOnly, true)
  assert.equal(result.source.importsSha256.length, 64)
})
for (const dependency of [
  'VCRUNTIME140.dll',
  'msvcp140.dll',
  'concrt140.dll',
  'vcomp140.dll',
  'ucrtbased.dll',
  'WebView2Loader.dll',
]) {
  test(`rejects an unexplained external dependency: ${dependency}`, () => {
    assert.throws(() => inspectDependencies(image(), imports + `    ${dependency}\n`, image()))
  })
}
test('refuses wrong architecture, invalid PE, and empty dependency evidence', () => {
  const wrong = image()
  wrong.writeUInt16LE(0x14c, 68)
  assert.throws(() => inspectDependencies(wrong, imports, image()))
  assert.throws(() => inspectDependencies(Buffer.alloc(128), imports, image()))
  assert.throws(() => inspectDependencies(image(), 'tool could not open file', image()))
})

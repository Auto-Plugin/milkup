import assert from 'node:assert/strict'
import { test } from 'node:test'
import { verifyInstalledBinary } from './verify-installed-binary.mjs'

const built = Buffer.from('PE prefix\0__TAURI_BUNDLE_TYPE_VAR_UNK\0unchanged application data')
const installed = Buffer.from('PE prefix\0__TAURI_BUNDLE_TYPE_VAR_NSS\0unchanged application data')

test('accepts exactly the Tauri NSIS transformation and records both hashes', () => {
  const result = verifyInstalledBinary(built, installed)
  assert.equal(result.status, 'passed')
  assert.equal(result.installedSha256, result.expectedInstalledSha256)
  assert.notEqual(result.installedSha256, result.builtSha256)
})
test('rejects changed application bytes outside the bundle marker', () => {
  const altered = Buffer.from(installed)
  altered[altered.length - 1] ^= 1
  assert.throws(() => verifyInstalledBinary(built, altered), /Unexpected installed bytes/)
})
test('rejects unpatched output and an incorrect bundle type', () => {
  assert.throws(() => verifyInstalledBinary(built, built), /Unexpected installed bytes/)
  assert.throws(
    () => verifyInstalledBinary(built, Buffer.from(installed.toString().replace('_NSS', '_MSI'))),
    /Unexpected installed bytes/,
  )
})
test('rejects truncated or extended output', () => {
  assert.throws(() => verifyInstalledBinary(built, installed.subarray(1)), /length changed/)
  assert.throws(
    () => verifyInstalledBinary(built, Buffer.concat([installed, Buffer.from('x')])),
    /length changed/,
  )
})
test('rejects missing or ambiguous original markers', () => {
  assert.throws(() => verifyInstalledBinary(installed, installed), /marker is missing/)
  assert.throws(
    () =>
      verifyInstalledBinary(Buffer.concat([built, built]), Buffer.concat([installed, installed])),
    /Ambiguous/,
  )
})

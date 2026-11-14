import assert from 'node:assert/strict'
import path from 'node:path'
import test from 'node:test'
import vm from 'node:vm'
import { within } from '../../plugins/diagrams/scripts/build-support.mjs'

// Run the actual helper body with Node's platform path primitives. This exercises
// Windows separators on any runner; it does not claim Windows filesystem tests.
function check(platform, root, file) {
  return vm.runInNewContext(`(${within.toString()})(root, file)`, {
    root,
    file,
    relative: platform.relative,
    isAbsolute: platform.isAbsolute,
    sep: platform.sep,
  })
}

for (const [name, platform, root, child, outside, sibling] of [
  [
    'win32',
    path.win32,
    'C:\\plugin\\src',
    'C:\\plugin\\src\\nested\\entry.js',
    'C:\\private\\entry.js',
    'C:\\plugin\\src-other\\entry.js',
  ],
  [
    'posix',
    path.posix,
    '/plugin/src',
    '/plugin/src/nested/entry.js',
    '/private/entry.js',
    '/plugin/src-other/entry.js',
  ],
]) {
  test(`${name}: nested source input remains permitted`, () =>
    assert.ok(check(platform, root, child)))
  test(`${name}: ancestor escape is rejected`, () =>
    assert.equal(Boolean(check(platform, root, outside)), false))
  test(`${name}: same-prefix sibling is rejected`, () =>
    assert.equal(Boolean(check(platform, root, sibling)), false))
  test(`${name}: root itself is not a contained file`, () =>
    assert.equal(Boolean(check(platform, root, root)), false))
}
test('win32: cross-drive and different UNC-share inputs are rejected', () => {
  assert.equal(Boolean(check(path.win32, 'C:\\plugin\\src', 'D:\\private\\entry.js')), false)
  assert.equal(
    Boolean(check(path.win32, '\\\\server\\share\\plugin', '\\\\server\\other\\entry.js')),
    false,
  )
})

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mappedEngineFiles } from './linux-private-runtime.mjs'
const line = (name, inode = 42) => `7f000-7f100 r-xp 00000000 08:01 ${inode} /tmp/private/lib/${name}\n`
const a = line('libwebkit2gtk-4.1.so.0.21.0')
const b = line('libjavascriptcoregtk-4.1.so.0.16.0', 43)
test('maps exact library files once across multiple segments', () => {
  assert.equal(mappedEngineFiles(a + a + b).size, 2)
})
test('rejects missing, mixed, deleted and conflicting runtime evidence', () => {
  for (const text of [a, b, a + b + a.replace('/tmp/private', '/usr'),
    a + b.replace(/\n$/, ' (deleted)\n'), a + b + a.replace('42 ', '44 '),
    a + line('libjavascriptcoregtk-4.1.so.0.16.0', 0)])
    assert.throws(() => mappedEngineFiles(text))
})

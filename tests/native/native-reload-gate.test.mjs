import assert from 'node:assert/strict'
import test from 'node:test'
import vm from 'node:vm'
import { installNativeReloadGate } from '../helpers/native-reload-gate.mjs'
function setup() {
  const calls = [],
    timers = new Map()
  let resolve, reject
  const original = function (...args) {
    calls.push({ args, receiver: this })
    return new Promise((yes, no) => {
      resolve = yes
      reject = no
    })
  }
  const bridge = { invoke: original }
  const c = vm.createContext({
    __TAURI_INTERNALS__: bridge,
    performance,
    setTimeout: (fn) => {
      timers.set(1, fn)
      return 1
    },
    clearTimeout: (id) => timers.delete(id),
  })
  vm.runInContext(`(${installNativeReloadGate.toString()})('/synthetic/a.md')`, c)
  return {
    bridge,
    calls,
    timers,
    original,
    gate: c.__reloadAcceptanceGate,
    resolve: (value) => resolve(value),
    reject: (error) => reject(error),
  }
}
test('real response and receiver unchanged, delivery waits for explicit release', async () => {
  const f = setup(),
    result = { file: { path: '/synthetic/a.md' }, documentId: 'A', text: 'REAL' }
  const p = f.bridge.invoke('reload_markdown_file', { path: '/synthetic/a.md', documentId: 'A' })
  let delivered = false
  p.then(() => (delivered = true))
  f.resolve(result)
  await Promise.resolve()
  await Promise.resolve()
  assert.equal(f.calls.length, 1)
  assert.equal(f.calls[0].receiver, f.bridge)
  assert.equal(f.gate.received, true)
  assert.equal(delivered, false)
  f.gate.release()
  assert.equal(await p, result)
  assert.deepEqual(
    Array.from(f.gate.events, (e) => e.phase),
    ['invoked', 'native-result', 'delivered'],
  )
  f.gate.restore()
  f.gate.restore()
  assert.equal(f.bridge.invoke, f.original)
  assert.equal(f.timers.size, 0)
})
test('other commands and other paths are untouched', async () => {
  for (const [command, path] of [
    ['save_markdown_file', '/synthetic/a.md'],
    ['reload_markdown_file', '/synthetic/b.md'],
  ]) {
    const f = setup(),
      p = f.bridge.invoke(command, { path })
    f.resolve('UNCHANGED')
    assert.equal(await p, 'UNCHANGED')
    assert.equal(f.gate.calls, 0)
    f.gate.restore()
  }
})
test('native errors propagate, never become successful fake responses', async () => {
  const f = setup(),
    p = f.bridge.invoke('reload_markdown_file', { path: '/synthetic/a.md' })
  f.reject(new Error('read refused'))
  await assert.rejects(p, /read refused/)
  assert.equal(f.gate.received, false)
  f.gate.restore()
})
test('cleanup releases held result; hard bound marks timeout, never passing', async () => {
  for (const timeout of [false, true]) {
    const f = setup(),
      p = f.bridge.invoke('reload_markdown_file', { path: '/synthetic/a.md' })
    f.resolve('REAL')
    await Promise.resolve()
    if (timeout) f.timers.get(1)()
    else f.gate.restore()
    assert.equal(await p, 'REAL')
    assert.equal(f.gate.timedOut, timeout)
    if (timeout) f.gate.restore()
    assert.equal(f.timers.size, 0)
  }
})
test('cleanup before native completion cannot strand the later response', async () => {
  const f = setup(),
    p = f.bridge.invoke('reload_markdown_file', { path: '/synthetic/a.md' })
  f.gate.restore()
  f.resolve('REAL')
  assert.equal(await p, 'REAL')
  assert.equal(f.timers.size, 0)
})
test('duplicate reload and release-before-result are explicit harness failures', () => {
  const f = setup()
  assert.throws(() => f.gate.release(), /not arrived/)
  f.bridge.invoke('reload_markdown_file', { path: '/synthetic/a.md' })
  assert.throws(
    () => f.bridge.invoke('reload_markdown_file', { path: '/synthetic/a.md' }),
    /Only one/,
  )
  f.gate.restore()
})

// Run: node --experimental-vm-modules --test src/plugin_dom_bootstrap.test.mjs
// Protocol/closure regression only. Real WebKit layout and confinement are separate gates.
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { definePlugin } from '../../../../packages/plugin-sdk/src/index.js'
const source = await readFile(new URL('./plugin_dom_bootstrap.js', import.meta.url), 'utf8')
const RPC = 'milkup.plugin.isolation.rpc.v1'
const RENDER = 'milkup.plugin.document-render.v1'
const manifest = {
  id: 'test.dom',
  host: 'dom',
  permissions: ['document:read'],
  contributes: { documentRenderers: [{ id: 'test.renderer', contexts: ['text'] }] },
}
async function harness(exports) {
  const context = vm.createContext({ TextEncoder, AbortController })
  const module = new vm.SyntheticModule(
    Object.keys(exports),
    function () {
      for (const [key, value] of Object.entries(exports)) this.setExport(key, value)
    },
    { context },
  )
  await module.link(() => {})
  await module.evaluate()
  const script = new vm.Script(source, { importModuleDynamically: async () => module })
  script.runInContext(context)
  context.__milkupDomInit('private-native-token', structuredClone(manifest))
  const endpoint = context.__milkupDom
  return {
    context,
    send(message) {
      endpoint('private-native-token', message)
    },
    async take() {
      for (let i = 0; i < 100; i++) {
        const message = vm.runInContext("this.__milkupDom('private-native-token', null)", context)
        if (message !== null) return JSON.parse(message)
        await new Promise((resolve) => setImmediate(resolve))
      }
      throw new Error('No bootstrap response')
    },
  }
}
function activation(id = 'a1') {
  return {
    protocol: RPC,
    type: 'request',
    id,
    method: 'activate',
    payload: { pluginId: manifest.id },
  }
}
function render(id = 'r1') {
  return {
    protocol: RENDER,
    type: 'render',
    id,
    payload: { pluginId: manifest.id, rendererId: 'test.renderer', request: { source: '文😀' } },
  }
}
test('actual SDK default definePlugin activation exposes only declared document renderers', async () => {
  let seen
  const host = await harness({
    default: definePlugin({
      activate(context) {
        seen = context
        return {
          documentRenderers: {
            'test.renderer': async (request) => ({ fragments: [], source: request.source }),
            'undeclared.renderer': () => ({}),
          },
        }
      },
    }),
  })
  host.send(activation())
  assert.deepEqual((await host.take()).value, {
    commands: [],
    renderers: [],
    documentRenderers: ['test.renderer'],
  })
  assert.deepEqual(Object.keys(seen.host), [])
  assert.equal(Object.isFrozen(seen.host), true)
  assert.equal(seen.permissions[0], 'document:read')
  assert.equal(host.context.__milkupDomInit, undefined)
  assert.equal(host.context.__milkupDom('guessed-token', render('fake')), null)
  assert.equal(host.context.__milkupDom('guessed-token', null), null)
  vm.runInContext(
    "const original = globalThis; const fake = { __milkupDom() { throw Error('token intercepted'); } }; original.globalThis = fake; original.window = fake; original.self = fake;",
    host.context,
  )
  host.send(render())
  assert.equal((await host.take()).value.source, '文😀')
  assert.throws(() =>
    vm.runInContext("'use strict'; this.__milkupDom = () => 'forged'", host.context),
  )
  host.send({
    protocol: RPC,
    type: 'request',
    id: 'd1',
    method: 'dispose',
    payload: { pluginId: manifest.id },
  })
  assert.equal((await host.take()).ok, true)
  host.send({
    protocol: RPC,
    type: 'request',
    id: 'd2',
    method: 'deactivate',
    payload: { pluginId: manifest.id },
  })
  assert.equal((await host.take()).ok, true)
})
test('named module exports and asynchronous render results obey the same wire contract', async () => {
  const host = await harness({
    documentRenderers: { 'test.renderer': async () => ({ fragments: [] }) },
  })
  host.send(activation())
  assert.deepEqual((await host.take()).value.documentRenderers, ['test.renderer'])
  host.send(render())
  assert.deepEqual(await host.take(), {
    protocol: RENDER,
    type: 'result',
    id: 'r1',
    ok: true,
    value: { fragments: [] },
  })
})
test('invalid default namespace is a lifecycle failure', async () => {
  const host = await harness({ default: 42 })
  host.send(activation())
  const result = await host.take()
  assert.equal(result.ok, false)
  assert.match(result.error.message, /module export/)
})
test('oversize result fails as one whole result and cancellation waits for handler settlement', async () => {
  let resolve
  const host = await harness({
    default: definePlugin({
      documentRenderers: {
        'test.renderer': () =>
          new Promise((done) => {
            resolve = done
          }),
      },
    }),
  })
  host.send(activation())
  await host.take()
  host.send(render())
  await new Promise((done) => setImmediate(done))
  host.send({ protocol: RENDER, type: 'cancel', id: 'r1' })
  resolve({ fragments: [] })
  assert.equal((await host.take()).error, 'aborted')
  host.send(render('r2'))
  await new Promise((done) => setImmediate(done))
  resolve({ text: 'x'.repeat(262144) })
  assert.equal((await host.take()).error, 'invalid-output')
})

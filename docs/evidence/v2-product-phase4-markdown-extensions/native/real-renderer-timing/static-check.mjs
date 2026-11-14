import vm from 'node:vm'
import { readFile, writeFile } from 'node:fs/promises'
import { createHash, webcrypto } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import assert from 'node:assert/strict'
const root = '/workspace/milkup-markdown-extensions-phase4-evidence'
const directory = root + '/native/real-renderer-timing'
const script = await readFile(directory + '/install-observer.js', 'utf8')
const blobs = new Map(),
  revoked = [],
  sent = [],
  checks = []
class MockWorker {
  listeners = new Map()
  constructor(url, options) {
    this.options = options
  }
  addEventListener(type, fn) {
    this.listeners.set(type, fn)
  }
  postMessage(message, ...args) {
    sent.push({ message, args })
  }
  terminate() {
    this.terminated = true
  }
}
let next = 0
const scope = {
  Worker: MockWorker,
  Blob,
  TextEncoder,
  crypto: webcrypto,
  performance,
  Date,
  URL: {
    createObjectURL(blob) {
      const url = 'blob:diagnostic-' + ++next
      blobs.set(url, blob)
      return url
    },
    revokeObjectURL(url) {
      revoked.push(url)
    },
  },
  addEventListener() {},
}
scope.window = scope
vm.runInNewContext(script, scope)
const plugin = 'milkup.math'
const originalSpecifier =
  'data:text/javascript,export default Object.freeze({documentRenderers:{}})'
const original = {
  protocol: 'milkup.plugin.worker-supervisor.v1',
  type: 'forward',
  message: {
    protocol: 'milkup.plugin.worker.init.v1',
    type: 'init',
    payload: { manifest: { id: plugin }, moduleSpecifier: originalSpecifier },
  },
}
const worker = new scope.Worker('original-production-supervisor.js', {
  name: 'milkup-supervisor-' + plugin,
})
worker.postMessage(original)
assert.equal(original.message.payload.moduleSpecifier, originalSpecifier)
assert.notEqual(sent[0].message, original)
assert.equal(sent[0].message.message.payload.manifest, original.message.payload.manifest)
assert.equal(sent[0].message.protocol, original.protocol)
const wrapperUrl = sent[0].message.message.payload.moduleSpecifier
const wrapper = await blobs.get(wrapperUrl).text()
assert(wrapper.includes('await import(' + JSON.stringify(originalSpecifier) + ')'))
assert(wrapper.includes('export default originalModule.default;'))
assert(!wrapper.includes('setTimeout'))
assert(!wrapper.includes('fetch('))
assert(!wrapper.includes('new Worker'))
await writeFile(directory + '/static-wrapper-sample.mjs', wrapper)
execFileSync(process.execPath, ['--check', directory + '/static-wrapper-sample.mjs'])
checks.push(
  'exact original module specifier imported; default export unchanged; factory URL and manifest untouched; original init immutable',
)
const raw = {
  protocol: 'milkup.plugin.worker-supervisor.v1',
  type: 'forward',
  message: {
    protocol: 'milkup.plugin.document-render.v1',
    type: 'render',
    id: 'render_1',
    payload: { test: true },
  },
}
worker.postMessage(raw)
assert.equal(sent[1].message, raw)
checks.push('render frame passed by identity; no deadline/worker/network changes in child wrapper')
assert.equal(revoked.length, 0)
worker.terminate()
assert.equal(revoked[0], wrapperUrl)
assert.equal(worker.terminated, true)
checks.push('wrapper URL retained until owned Worker terminate')
const nonTarget = new scope.Worker('plain.js', { name: 'milkup-plugin-other' })
nonTarget.postMessage(original)
assert.equal(sent[2].message, original)
checks.push('non-target Worker init unchanged')
await new Promise((resolve) => setTimeout(resolve, 10))
assert(scope.__rendererTimingProbe.modules[0].wrapperSha256)
checks.push('wrapper and original specifier SHA-256 metadata produced')
const artifacts = []
for (const [name, folder] of [
  ['math', 'external-crlf-final'],
  ['diagrams', 'external'],
]) {
  const path = root + '/' + name + '/' + folder + '/dist/milkup.' + name + '-1.0.0.milkup-plugin'
  const bytes = await readFile(path)
  artifacts.push({
    path,
    bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  })
}
await writeFile(
  directory + '/static-verification.json',
  JSON.stringify(
    {
      diagnosticOnly: true,
      passed: true,
      checks,
      observerPath: directory + '/install-observer.js',
      observerSha256: createHash('sha256').update(script).digest('hex'),
      actualPackages: artifacts,
      limitations: [
        'Mock transport/static syntax validation only; no browser or real pipeline validation in this check.',
        'Actual factory bytes and packages remain unchanged, but init moduleSpecifier is intentionally replaced for diagnostic instrumentation.',
        'Child stamps include validation/microtask/scheduling time; they do not measure CPU time or independently establish supervisor deadline start/receive time.',
        'Debug delivery may be lost if supervisor terminates before forwarding; absence of an end marker is not proof that business computation hung.',
      ],
    },
    null,
    2,
  ) + '\n',
)
console.log('Static timing-wrapper checks passed; no browser/process build run.')

// Diagnostic only: original production RPC client, actual Node Worker, no UI.
import { build } from '/workspace/milkup/node_modules/esbuild/lib/main.js'
import { Worker } from 'node:worker_threads'
import { once } from 'node:events'
import { writeFile, readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import assert from 'node:assert/strict'
const root = '/workspace/milkup'
const output = new URL('./result.json', import.meta.url)
const clientPath = `${root}/packages/plugin/src/document-render-rpc.ts`
const bundled = await build({
  stdin: {
    contents: `export {createDocumentRenderRpcClient} from ${JSON.stringify(clientPath)}`,
    resolveDir: root,
    loader: 'ts',
  },
  bundle: true,
  write: false,
  platform: 'node',
  format: 'esm',
  target: 'node22',
})
const { createDocumentRenderRpcClient } = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`
)
const payload = {
  pluginId: 'diagnostic',
  rendererId: 'test',
  request: {
    documentId: 'doc',
    version: 1,
    from: 0,
    to: 5,
    source: 'hello',
    fromLine: 1,
    toLine: 1,
    completeStart: true,
    completeEnd: true,
    contextKnown: true,
    protectedRanges: [],
    blocks: [],
    selection: { anchor: 0, head: 0 },
    theme: 'light',
    target: 'screen',
    width: 400,
  },
}
async function trial(name, { stall = false, gate = false, runaway = false } = {}) {
  // Independent shared observations survive termination. No main-thread message
  // delivery is necessary to establish when the Worker completed computation.
  const memory = new SharedArrayBuffer(BigInt64Array.BYTES_PER_ELEMENT * 3)
  const stamps = new BigInt64Array(memory)
  const worker = new Worker(
    `
    const { parentPort, workerData } = require('node:worker_threads');
    const stamps = new BigInt64Array(workerData.memory);
    parentPort.on('message', m => {
      if (m.type !== 'render') return;
      Atomics.store(stamps, 0, BigInt(Date.now()));
      if (workerData.runaway) { while (true) {} }
      const value = {fragments: [], complete: true};
      Atomics.store(stamps, 1, BigInt(Date.now()));
      parentPort.postMessage({protocol:m.protocol,type:'result',id:m.id,ok:true,value});
      Atomics.store(stamps, 2, BigInt(Date.now()));
    });
    parentPort.postMessage('ready');
  `,
    { eval: true, workerData: { memory, runaway } },
  )
  await once(worker, 'message')
  let issued, terminated, timeoutAt, stallEnd, received, delivered, gateTimer
  let termination
  const events = []
  const listeners = new Map()
  const endpoint = {
    postMessage(message) {
      events.push({ event: `send:${message.type}`, at: Date.now() })
      worker.postMessage(message)
    },
    on(type, listener) {
      const wrapper = (message) => {
        received = Date.now()
        if (gate) {
          // Mechanism control ONLY: artificial delivery withholding is not a
          // claim about Node or WebKit's natural event-loop ordering.
          gateTimer = setTimeout(
            () => {
              delivered = Date.now()
              listener(message)
            },
            Math.max(0, issued + 2200 - Date.now()),
          )
        } else {
          delivered = Date.now()
          listener(message)
        }
      }
      listeners.set(listener, wrapper)
      worker.on(type, wrapper)
    },
    off(type, listener) {
      worker.off(type, listeners.get(listener))
      listeners.delete(listener)
    },
  }
  const client = createDocumentRenderRpcClient(endpoint, () => {
    timeoutAt = Date.now()
    terminated = true
    termination = worker.terminate()
  })
  try {
    // Begin from a timer turn, matching a normal deferred render update.
    const result = await new Promise((resolve) =>
      setTimeout(() => {
        issued = Date.now()
        const pending = client.render(payload).then(
          () => ({ status: 'resolved' }),
          (error) => ({ status: 'rejected', code: error.code }),
        )
        if (stall) {
          const end = performance.now() + 2400
          while (performance.now() < end) {}
          stallEnd = Date.now()
        }
        pending.then(resolve)
      }, 0),
    )
    if (termination) await termination
    const start = Number(Atomics.load(stamps, 0)),
      end = Number(Atomics.load(stamps, 1)),
      posted = Number(Atomics.load(stamps, 2))
    const completedBeforeDeadline = end > 0 && end - issued < 2000
    return {
      name,
      diagnosticOnly: true,
      artificialDeliveryGate: gate,
      ...result,
      issued,
      workerStart: start || null,
      workerEnd: end || null,
      workerPostReturned: posted || null,
      received: received ?? null,
      delivered: delivered ?? null,
      stallEnd: stallEnd ?? null,
      timeoutAt: timeoutAt ?? null,
      terminated: !!terminated,
      workerElapsedMs: end ? end - start : null,
      completedBeforeDeadline,
      falseTimeoutProven: result.code === 'timeout' && completedBeforeDeadline,
      events,
    }
  } finally {
    clearTimeout(gateTimer)
    client.dispose()
    await worker.terminate()
  }
}
const trials = []
trials.push(await trial('baseline'))
trials.push(await trial('natural-main-stall', { stall: true }))
trials.push(await trial('controlled-delivery-gate', { gate: true }))
trials.push(await trial('actual-cpu-runaway', { runaway: true }))
assert.equal(trials[0].status, 'resolved')
assert.equal(trials[2].falseTimeoutProven, true)
assert.equal(trials[3].code, 'timeout')
assert.equal(trials[3].terminated, true)
assert.equal(trials[3].workerEnd, null)
const report = {
  diagnosticOnly: true,
  engine: process.version,
  originalClientSha256: createHash('sha256')
    .update(await readFile(clientPath))
    .digest('hex'),
  budgetMs: 2000,
  originalClientUnmodified: true,
  trials,
  conclusion: trials[1].falseTimeoutProven
    ? 'Natural Node main-thread stall misclassified a Worker that demonstrably completed within 2s. This is not a WebKit reproduction.'
    : 'Natural Node scheduling delivered the completed result before the expired timer. Controlled gating proves the deadline includes transport dispatch, but the native failure remains unproven.',
}
await writeFile(output, JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify(report, null, 2))

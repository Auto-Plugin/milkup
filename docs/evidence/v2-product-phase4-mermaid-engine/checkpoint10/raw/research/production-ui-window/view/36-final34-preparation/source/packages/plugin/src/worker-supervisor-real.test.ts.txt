import { afterEach, describe, expect, it } from 'vitest'
import { Worker } from 'node:worker_threads'
import { buildSync } from 'esbuild'
import { createSupervisedPluginWorkerEndpoint } from './worker-supervisor'
import { createDocumentRenderRpcClient } from './document-render-rpc'

const payload = {
  pluginId: 'test',
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
    theme: 'light' as const,
    target: 'screen' as const,
    width: 400,
  },
}
const children = new Set<Worker>()
afterEach(async () => {
  await Promise.all([...children].map((worker) => worker.terminate()))
  children.clear()
})
function createSupervisor(runaway: boolean) {
  const memory = new SharedArrayBuffer(4 * BigInt64Array.BYTES_PER_ELEMENT)
  const stamps = new BigInt64Array(memory)
  const childSource = `const {parentPort,workerData}=require('node:worker_threads');const s=new BigInt64Array(workerData.memory);
    parentPort.on('message',m=>{if(m.type!=='render')return;Atomics.store(s,0,BigInt(Date.now()));
    if(workerData.runaway){while(true){}}
    Atomics.store(s,1,BigInt(Date.now()));parentPort.postMessage({protocol:m.protocol,type:'result',id:m.id,ok:true,value:{fragments:[],complete:true}});});`
  const entry = `import {Worker,parentPort,workerData} from 'node:worker_threads';
    import {initializePluginWorkerSupervisor} from './worker-supervisor';
    const s=new BigInt64Array(workerData.memory);
    initializePluginWorkerSupervisor(parentPort,()=>{const child=new Worker(${JSON.stringify(childSource)},{eval:true,workerData});
      return {postMessage:m=>child.postMessage(m),on:(t,f)=>child.on(t,f),off:(t,f)=>child.off(t,f),
        terminate:()=>{Atomics.store(s,2,BigInt(Date.now()));void child.terminate()}}});
    parentPort.postMessage('ready');`
  const script = buildSync({
    stdin: { contents: entry, resolveDir: import.meta.dirname, loader: 'ts' },
    bundle: true,
    write: false,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
  }).outputFiles[0]!.text
  const worker = new Worker(script, { eval: true, workerData: { memory, runaway } })
  children.add(worker)
  const ready = new Promise<void>((resolve, reject) => {
    worker.once('message', () => resolve())
    worker.once('error', reject)
  })
  return { worker, stamps, ready }
}
describe('actual independently supervised Workers', () => {
  it('accepts an already completed render after the main thread stalls beyond 2 seconds', async () => {
    const { worker, stamps, ready } = createSupervisor(false)
    await ready
    const endpoint = createSupervisedPluginWorkerEndpoint(worker)
    const client = createDocumentRenderRpcClient(endpoint, () => {
      throw Error('false timeout')
    })
    const pending = client.render(payload)
    const end = performance.now() + 2400
    while (performance.now() < end) {}
    await expect(pending).resolves.toMatchObject({ complete: true })
    expect(Number(Atomics.load(stamps, 1))).toBeGreaterThan(0)
    expect(Number(Atomics.load(stamps, 2))).toBe(0) // Successful render retains plugin state.
    client.dispose()
    endpoint.terminate?.()
  }, 10000)
  it('terminates a real infinite loop while the main thread is still blocked', async () => {
    const { worker, stamps, ready } = createSupervisor(true)
    await ready
    const endpoint = createSupervisedPluginWorkerEndpoint(worker)
    let notified = false
    const client = createDocumentRenderRpcClient(endpoint, () => {
      notified = true
    })
    const before = Date.now(),
      pending = client.render(payload).catch((e) => e.code)
    const end = performance.now() + 2400
    while (performance.now() < end) {}
    const unblocked = Date.now(),
      killed = Number(Atomics.load(stamps, 2))
    expect(killed).toBeGreaterThan(before + 1900)
    expect(killed).toBeLessThan(unblocked)
    expect(Number(Atomics.load(stamps, 1))).toBe(0)
    expect(await pending).toBe('timeout')
    expect(notified).toBe(true)
    client.dispose()
    endpoint.terminate?.()
  }, 10000)
})

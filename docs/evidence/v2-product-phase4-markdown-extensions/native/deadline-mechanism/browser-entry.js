import { createDocumentRenderRpcClient } from './packages/plugin/src/document-render-rpc.ts'
const protocol = 'milkup.plugin.document-render.v1'
const payload = {
  pluginId: 'diagnostic',
  rendererId: 'test',
  request: {
    documentId: 'diagnostic',
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
function worker(source) {
  const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }))
  return {
    value: new Worker(url),
    dispose() {
      this.value.terminate()
      URL.revokeObjectURL(url)
    },
  }
}
function waitMessage(worker, predicate) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup()
      reject(Error('Diagnostic Worker observation timed out'))
    }, 5000)
    const message = (e) => {
      if (predicate(e.data)) {
        cleanup()
        resolve(e.data)
      }
    }
    const error = (e) => {
      cleanup()
      reject(Error(e.message || 'Diagnostic Worker failed'))
    }
    function cleanup() {
      clearTimeout(timer)
      worker.removeEventListener('message', message)
      worker.removeEventListener('error', error)
    }
    worker.addEventListener('message', message)
    worker.addEventListener('error', error)
  })
}
async function trial(name, { stall = false, runaway = false } = {}) {
  // This observer neither forwards nor delays the original RPC. It receives
  // independent timestamps through a second MessagePort and outlives renderer.
  const observer = worker(`const events=[];onmessage=e=>{
    if(e.data.type==='init'){const port=e.data.port;port.onmessage=m=>{if(events.length<32)events.push({...m.data,observerWall:Date.now()})};port.start();postMessage({type:'ready'})}
    else if(e.data.type==='snapshot')postMessage({type:'snapshot',events});
  }`)
  const renderer = worker(`let port,runaway;onmessage=e=>{
    const m=e.data;
    if(m.type==='init'){port=m.port;runaway=m.runaway;postMessage({type:'ready'});return}
    if(m.protocol!=='${protocol}'||m.type!=='render')return;
    const started=performance.now();port.postMessage({event:'start',id:m.id,wall:Date.now(),mono:started});
    if(runaway){while(true){}}
    const value={fragments:[],complete:true};
    port.postMessage({event:'complete',id:m.id,wall:Date.now(),elapsed:performance.now()-started});
    postMessage({protocol:m.protocol,type:'result',id:m.id,ok:true,value});
    port.postMessage({event:'post-returned',id:m.id,wall:Date.now(),elapsed:performance.now()-started});
  }`)
  const channel = new MessageChannel()
  let client,
    issued,
    timeoutAt,
    terminated = false,
    stallEnd
  const events = []
  const receive = (e) => {
    if (e.data.protocol === protocol)
      events.push({ event: 'receive', wall: Date.now(), id: e.data.id, type: e.data.type })
  }
  try {
    const observerReady = waitMessage(observer.value, (m) => m.type === 'ready')
    const rendererReady = waitMessage(renderer.value, (m) => m.type === 'ready')
    observer.value.postMessage({ type: 'init', port: channel.port1 }, [channel.port1])
    renderer.value.postMessage({ type: 'init', port: channel.port2, runaway }, [channel.port2])
    await Promise.all([observerReady, rendererReady])
    renderer.value.addEventListener('message', receive)
    // Original Worker endpoint: no wrapper, delivery gate or message filtering.
    client = createDocumentRenderRpcClient(renderer.value, () => {
      timeoutAt = Date.now()
      terminated = true
      renderer.value.terminate()
    })
    const result = await new Promise((resolve) =>
      setTimeout(() => {
        issued = Date.now()
        const pending = client.render(payload).then(
          () => ({ status: 'resolved' }),
          (e) => ({ status: 'rejected', code: e.code }),
        )
        if (stall) {
          const until = performance.now() + 2400
          while (performance.now() < until) {}
          stallEnd = Date.now()
        }
        pending.then(resolve)
      }, 0),
    )
    // Allow independent observer-port events to settle before requesting its log.
    await new Promise((resolve) => setTimeout(resolve, 100))
    const observation = waitMessage(observer.value, (m) => m.type === 'snapshot')
    observer.value.postMessage({ type: 'snapshot' })
    const snapshot = await observation
    const completion = snapshot.events.find((e) => e.event === 'complete')
    return {
      name,
      artificialDeliveryGate: false,
      ...result,
      issued,
      stallEnd: stallEnd ?? null,
      timeoutAt: timeoutAt ?? null,
      terminated,
      workerEvents: snapshot.events,
      mainEvents: events,
      completedBeforeDeadline: !!completion && completion.wall - issued < 2000,
      falseTimeoutProven:
        result.code === 'timeout' && !!completion && completion.wall - issued < 2000,
    }
  } finally {
    client?.dispose()
    renderer.value.removeEventListener('message', receive)
    renderer.dispose()
    observer.dispose()
  }
}
globalThis.runDeadlineBrowserProbe = async () => {
  const trials = []
  trials.push(await trial('baseline'))
  trials.push(await trial('natural-main-stall', { stall: true }))
  trials.push(await trial('actual-cpu-runaway', { runaway: true }))
  return {
    diagnosticOnly: true,
    budgetMs: 2000,
    userAgent: navigator.userAgent,
    originalEndpointUnmodified: true,
    artificialDeliveryGate: false,
    trials,
    controlsPassed:
      trials[0].status === 'resolved' && trials[2].code === 'timeout' && trials[2].terminated,
    conclusion: trials[1].falseTimeoutProven
      ? 'Natural browser stall terminated a Worker observed completing before its deadline; engine-specific mechanism reproduced, not proof of original invocation.'
      : 'Natural browser stall did not establish false timeout; original native invocation remains unresolved.',
  }
}

// Standalone diagnostic prototype. No production code or RPC budget is changed.
globalThis.runSupervisorDeadlineProbe = async function () {
  const childSource = `
    onmessage=e=>{
      if(e.data.type==='ping'){postMessage({type:'pong',wall:Date.now()});return}
      if(e.data.type!=='run')return;
      const started=Date.now();postMessage({type:'started',wall:started});
      if(e.data.runaway){while(true){}}
      const end=performance.now()+50;while(performance.now()<end){}
      postMessage({type:'result',start:started,end:Date.now()});
    };
    postMessage({type:'ready',wall:Date.now()});
  `
  const supervisorSource = `
    const childURL=URL.createObjectURL(new Blob([${JSON.stringify(childSource)}],{type:'text/javascript'}));
    let child,deadline,watchdog,heartbeat,done=false,issued;
    const events=[];
    const record=(event,more={})=>events.push({event,wall:Date.now(),...more});
    function finish(status){if(done)return;done=true;clearTimeout(watchdog);clearInterval(heartbeat);child.terminate();record('child-terminated');URL.revokeObjectURL(childURL);postMessage({type:'finished',status,issued,deadline,events})}
    try{child=new Worker(childURL)}catch(e){postMessage({type:'unsupported',message:String(e)});}
    if(child){
      child.onerror=e=>{record('child-error',{message:e.message});finish('child-error')};
      child.onmessage=e=>{
        const m=e.data;
        if(m.type==='ready'){record('child-ready',{originWall:m.wall});child.postMessage({type:'ping'});return}
        if(m.type==='pong'){record('child-prewarmed',{originWall:m.wall});postMessage({type:'ready',wall:Date.now()});return}
        if(m.type==='started'){record('child-started',{originWall:m.wall});return}
        if(m.type==='result'){
          record('child-result-received',{originStart:m.start,originEnd:m.end});
          // A late result cannot win merely because the timeout task was queued.
          finish(Date.now()<=deadline?'result':'late-result');
        }
      };
    }
    onmessage=e=>{
      if(e.data.type==='ping'){record('supervisor-prewarmed');postMessage({type:'pong',wall:Date.now()});return}
      if(e.data.type!=='run'||!child)return;
      issued=Date.now();deadline=issued+2000;record('armed');
      heartbeat=setInterval(()=>{if(events.length<100)record('heartbeat')},100);
      watchdog=setTimeout(()=>{record('watchdog-fired');finish('timeout')},2000);
      child.postMessage({type:'run',runaway:e.data.runaway});
      postMessage({type:'armed',wall:Date.now()});
    };
  `
  async function trial(name, stall, runaway) {
    const url = URL.createObjectURL(new Blob([supervisorSource], { type: 'text/javascript' }))
    const supervisor = new Worker(url)
    let mainStallStart, mainStallEnd, mainArmed, mainFinished
    try {
      return await new Promise((resolve, reject) => {
        const outer = setTimeout(() => {
          cleanup()
          reject(Error('Supervisor diagnostic exceeded 8 seconds'))
        }, 8000)
        const cleanup = () => clearTimeout(outer)
        supervisor.onerror = (e) => {
          cleanup()
          reject(Error(e.message || 'Supervisor Worker failed'))
        }
        supervisor.onmessage = (e) => {
          const m = e.data
          if (m.type === 'unsupported') {
            cleanup()
            resolve({ name, unsupported: true, ...m })
            return
          }
          if (m.type === 'ready') {
            supervisor.postMessage({ type: 'ping' })
            return
          }
          if (m.type === 'pong') {
            supervisor.postMessage({ type: 'run', runaway })
            return
          }
          if (m.type === 'armed') {
            mainArmed = Date.now()
            if (stall) {
              mainStallStart = Date.now()
              const until = performance.now() + 2400
              while (performance.now() < until) {}
              mainStallEnd = Date.now()
            }
            return
          }
          if (m.type === 'finished') {
            mainFinished = Date.now()
            cleanup()
            const internal = m.events.filter(
              (x) =>
                mainStallStart !== undefined && x.wall > mainStallStart && x.wall < mainStallEnd,
            )
            const terminated = m.events.find((x) => x.event === 'child-terminated')
            resolve({
              name,
              diagnosticOnly: true,
              prewarmed: true,
              stall,
              runaway,
              ...m,
              mainArmed,
              mainStallStart: mainStallStart ?? null,
              mainStallEnd: mainStallEnd ?? null,
              mainFinished,
              internalDuringMainStall: internal,
              terminationElapsed: terminated ? terminated.wall - m.issued : null,
              resultReceivedDuringMainStall: internal.some(
                (x) => x.event === 'child-result-received',
              ),
              watchdogRanDuringMainStall: internal.some((x) => x.event === 'watchdog-fired'),
            })
          }
        }
      })
    } finally {
      supervisor.terminate()
      URL.revokeObjectURL(url)
    }
  }
  const trials = []
  trials.push(await trial('prewarmed-baseline', false, false))
  if (!trials[0].unsupported) {
    trials.push(await trial('prewarmed-main-stall-fast-child', true, false))
    trials.push(await trial('prewarmed-main-stall-runaway-child', true, true))
  }
  return {
    diagnosticOnly: true,
    budgetMs: 2000,
    userAgent: navigator.userAgent,
    nestedWorkerPrototype: true,
    productionCodeChanged: false,
    trials,
  }
}

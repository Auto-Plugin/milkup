import json,hashlib,sys
from pathlib import Path
run=sys.argv[1]
base=Path('/workspace/milkup-export-print-evidence/milestone01/native-ui');root=base/'runs'/run
log=base/'logs'/f'{run}-driver.log'
plan=json.loads((root/'plan.json').read_text());observations=json.loads((root/'observations.json').read_text())
events=[dict(json.loads(line.split('DOM_NATIVE_TIMING ',1)[1]),logLine=i) for i,line in enumerate(log.read_text().splitlines(),1) if 'DOM_NATIVE_TIMING ' in line]
outputs=[]
for o in observations:
 if 'artifact' not in o:continue
 ids=[e['requestId'] for e in o.get('traces',[]) if e['phase']=='dispatch']
 outputs.append({'name':o['name'],'at':o['at'],'elapsedMs':o.get('elapsedMs'),'statuses':o.get('statuses'),'notice':o.get('document',{}).get('notice'),'diagramRegistry':[r for r in o.get('registry',[]) if r['id']=='milkup.diagrams'],'requestIds':ids,'artifact':{k:v for k,v in o['artifact'].items() if k not in ['diagrams']},'diagramCount':len(o['artifact']['diagrams']) if 'diagrams' in o['artifact'] else None})
requests=[];last={}
for dispatch in [e for e in events if e['phase']=='dispatch']:
 es=[e for e in events if (e['instanceId'],e['requestId'])==(dispatch['instanceId'],dispatch['requestId'])];ps={e['phase']:e for e in es}
 def duration(a,b):return (ps[b]['monotonicNs']-ps[a]['monotonicNs'])/1e6 if a in ps and b in ps else None
 previous=last.get(dispatch['instanceId'])
 requests.append({'instanceId':dispatch['instanceId'],'requestId':dispatch['requestId'],'request':ps.get('render-request',{}).get('request'),'outputNames':[o['name'] for o in outputs if dispatch['requestId'] in o['requestIds']],'queueWaitMs':None,'queueWaitStatus':'not measured: no frontend enqueue/pump timestamp','durationsMs':{'ownerDispatchToAccept':duration('dispatch','owner-result-accepted'),'dispatchToHelperDequeue':duration('dispatch','helper-dequeued'),'dequeueToEvalSubmit':duration('helper-dequeued','helper-eval-submitted'),'evalSubmitToCallback':duration('helper-eval-submitted','helper-eval-callback'),'evalCallbackToResultDrain':duration('helper-eval-callback','helper-result-drained'),'drainToForward':duration('helper-result-drained','helper-frame-forwarded'),'forwardToOwnerReceive':duration('helper-frame-forwarded','owner-frame-received'),'ownerReceiveToAccept':duration('owner-frame-received','owner-result-accepted')},'gapFromPriorOwnerAcceptanceMs':(dispatch['monotonicNs']-previous)/1e6 if previous is not None else None,'phases':es})
 if 'owner-result-accepted' in ps:last[dispatch['instanceId']]=ps['owner-result-accepted']['monotonicNs']
completion=json.loads((root/'completion.json').read_text()) if (root/'completion.json').exists() else None
failure=json.loads((root/'failure.json').read_text()) if (root/'failure.json').exists() else None
terminalStatus='failed' if failure else 'completed' if completion else 'running'

summary={'run':run,'complete':completion is not None,'terminalStatus':terminalStatus,'failure':{'error':failure.get('error'),'stack':failure.get('stack')} if failure else None,'binarySha256':plan['binarySha256'],'binaryMatchesRequested':plan['binarySha256']=='6e6c004030fe06146b58d9e40cbd22c7c7d3315c306ceb741f3f58e119ed9d2a','sourceSha256':hashlib.sha256((root/'source.md').read_bytes()).hexdigest(),'inputs':{str(p):hashlib.sha256(p.read_bytes()).hexdigest() for p in [log,root/'plan.json',root/'observations.json']},'packages':[{'id':p['manifest']['id'],'version':p['manifest']['version'],'sha256':p['sha256']} for p in plan['packages']],'requests':requests,'outputs':outputs,'deadlineEvents':[e for e in events if e['phase'] in ['deadline-observed','control-emitted']],'completion':completion,'processLifecycleFile':str(root/'process-lifecycle.json') if (root/'process-lifecycle.json').exists() else None,'interpretation':['Only owner dispatch-to-accept is execution/serialization/transport duration measured against the unchanged native 2s bound.','Dispatch-to-helper-dequeue is post-dispatch transport/scheduling already inside that native budget; it is not frontend RPC queue waiting.','Gaps between accepted jobs and next dispatch include host processing/admission and frontend scheduling; no queue wait duration can be derived from these gaps.','End-to-end output elapsed includes collection, user chooser interactions and writing, so it cannot be compared to the 2s individual renderer bound.','Warnings in output observations remain evidence even when all native diagrams requests are accepted; native traces do not report other worker providers.','This production success does not reproduce or resolve the historic native Print04 timeout.']}
out=Path(__file__).parent/(run.removeprefix('p5-m06-')+'-timing.json');out.write_text(json.dumps(summary,ensure_ascii=False,indent=2)+'\n')
print(out)
for r in requests:print(r['requestId'],r['request'],r['outputNames'],r['durationsMs']['ownerDispatchToAccept'])
for o in outputs:print(o['name'],o['elapsedMs'],o['diagramCount'],o['statuses'])

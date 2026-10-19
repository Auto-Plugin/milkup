from pathlib import Path
import json,math,statistics,hashlib,datetime
root=Path(__file__).resolve().parent
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
result={'generatedUtc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'scope':'Candidate03 versus candidate04; production runs only. All samples retained; no diagnostic timings mixed.','candidates':{},'functional':{},'inputs':{},'screenshots':[],'cleanup':[]}
for candidate,prefix in [('03','p7-candidate-m02-outline-'),('04','p7-candidate-m02-outline04-')]:
 result['candidates'][candidate]={}
 for case in ['large','dense']:
  run=root/'runs'/f'{prefix}{case}-01'; measurements=json.loads((run/'measurements.json').read_text()); groups={}
  for m in measurements:
   group=m['name'].rsplit('-',1)[0] if m['name'].rsplit('-',1)[-1].isdigit() else m['name']
   groups.setdefault(group,[]).append(m)
  summaries={}
  for group,items in groups.items():
   values=sorted(m['elapsedMs'] for m in items)
   summaries[group]={'count':len(items),'min':min(values),'median':statistics.median(values),'max':max(values),'p95':values[math.ceil(.95*len(values))-1] if len(values)>=20 else None,'over100':sum(v>100 for v in values),'over200':sum(v>200 for v in values),'over250':sum(v>250 for v in values),'orderedSamples':[{k:m.get(k) for k in ['name','elapsedMs','firstRowsMs','focusRank','renderProof','goal','stableFrameTimes','wheelEvents','wheelDeltaY']} for m in items]}
  result['candidates'][candidate][case]={'run':str(run.relative_to(root)),'completion':json.loads((run/'completion.json').read_text()),'groups':summaries,'measurementsSha256':sha(run/'measurements.json')}
for case in ['large','dense','keyboard','lifecycle']:
 name=f'p7-candidate-m02-outline04-{case}-01';run=root/'runs'/name
 observations=json.loads((run/'observations.json').read_text())
 selected=[]
 for x in observations:
  if case in ['keyboard','lifecycle']:
   selected.append({'name':x['name'],'at':x['at'],'document':x['document'],'virtual':x.get('outline',{}).get('virtual'),'focus':x.get('outline',{}).get('focus'),'firstTitle':next(iter(x.get('outline',{}).get('items',[])),{}).get('title'),**{k:x[k] for k in ['state','beforeInput','observedIncomplete','switching','observationMs','late','setup','tabPresses'] if k in x}})
 result['functional'][case]={'completion':json.loads((run/'completion.json').read_text()),'selectedObservations':selected,'finalDirty':observations[-1]['document']['dirty'],'finalVersion':observations[-1]['document']['version']}
 if case=='keyboard': result['functional'][case]['measurements']=json.loads((run/'measurements.json').read_text())
 result['inputs'][case]=[]
 for filename in ['plan.json','production-origin.json','harness.mjs','installed.json','measurements.json','observations.json','completion.json']:
  p=run/filename
  result['inputs'][case].append({'path':str(p.relative_to(root)),'sha256':sha(p),'bytes':p.stat().st_size})
 for p in run.glob('*.png'):result['screenshots'].append({'path':str(p.relative_to(root)),'sha256':sha(p),'bytes':p.stat().st_size,'scope':'Final screen only; intermediate focus/cursor evidence is in measurements/observations.'})
 row=json.loads((root/'control'/f'{name}-driver.json').read_text());assert 'stoppedUtc' in row;result['cleanup'].append(row)
result['fixtures']=[]
for source in [root/'runs/p7-candidate-m02-outline-large-01/outline.md',root/'runs/p7-candidate-m02-outline-dense-01/outline.md',Path('/tmp/p7-candidate-m02-outline04-lifecycle-01-source.md')]:
 result['fixtures'].append({'path':str(source),'bytes':source.stat().st_size,'sha256':sha(source)})
result['environment']={'concurrency':'Exclusive CPU/GUI arranged with Root. No other tests, builds, formatter or archive jobs during candidate04 runs were reported. Root performed only lightweight reads/document writes. This is coordination evidence, not system-wide CPU isolation.','display':127,'ports':[4477,4478],'xvfb':'Retained for Root exact-owned cleanup; display126 not touched.','helperLifecycle':'Driver PID/birth stops recorded. No claim of separately instrumented instantaneous helper teardown.'}
(root/'candidate03-vs04.json').write_text(json.dumps(result,indent=2,ensure_ascii=False)+'\n')
def fmt(v):return '—' if v is None else f'{v:.1f}'.rstrip('0').rstrip('.')
def cell(g):return '/'.join(fmt(g[k]) for k in ['min','median','max'])
lines=['# Candidate03 → candidate04 final outline comparison','','Four candidate04 runs passed functional assertions; dense collapse still misses the250 ms p95 budget. No sample was discarded or repeated. All numbers below are milliseconds. n=3 indexes and single middle/keyboard observations have no p95. Full per-sample DOM/range/frame proofs, counts above100/200/250 ms, fixture/input/screenshot hashes and cleanup records are in `candidate03-vs04.json`.','','## Frozen inputs','','-03 ELF `341d12999d07ba0b7116d463ebacde4bb52ead97279a33ad588ab599d2ddb7a2`, independent outline1.3.2 `c4f1bc3b3333fc8ae8919487cd2c20e59b622af98c97ce26e14ff9fdaf3b0f0f`.','-04 ELF `fb767f5a06555681c99323e5f2c5e763cfb4c6333f62f634e06405601ddfc9d2`, independent outline1.3.3 `80a9ce947c4abf2998eb72c36c327d5d826f0d30fa22dad61f903ff4713ca5c6`.','-Original harness `b8ccb4322a8068496ffac252245150f7bb3811a1258f90e6773ac61f29534258`;04 copy `584a50dddaf3be64f826ccb06de8242fc579f447b12b5bdf1669b0b40b686356`. `candidate04-harness-fixture-only.patch` changes only fixture reuse and exact original-byte validation. Timed operations and completion predicates are unchanged.','-All titles are retained. Large is26018029 bytes/40001 lines/8775 headings. Dense is36001 lines/18000 headings. Performance/keyboard reuse original M02 sources read-only; lifecycle uses its own writable/tmp copy. All final SHA values match the originals.','','## Complete index and first visible rows','','Each profile has3 sequential full indexes, initial open then reloads; these are not3 cold processes. Full completion is distinct from first visible rows.','', '| Fixture |03 full index ordered|04 full index ordered|03 first rows ordered|04 first rows ordered|','|---|---|---|---|---|']
for case in ['large','dense']:
 gs=[result['candidates'][c][case]['groups']['index'] for c in ['03','04']]
 cols=[]
 for field in ['elapsedMs','firstRowsMs']:
  for g in gs:cols.append('/'.join(fmt(m[field]) for m in g['orderedSamples']))
 lines.append('|'+case+'|'+'|'.join(cols)+'|')
lines+=['','## Same-condition production distributions','','Fold budget is p95≤250; follow/click/ten-wheel burst budget is p95≤200. Over-budget counts are shown against the corresponding threshold; all >100/>200/>250 counts also remain in JSON.','', '|Fixture/operation|n|03 min/median/max|04 min/median/max|03 p95|04 p95|03 →04 over budget|04 result|','|---|---:|---|---|---:|---:|---|---|']
for case in ['large','dense']:
 for group,g3 in result['candidates']['03'][case]['groups'].items():
  g4=result['candidates']['04'][case]['groups'][group];threshold=250 if group in ['collapse','expand'] else 200
  timed=group in ['collapse','expand','editor-cursor-follow','outline-click','wheel-burst-10']
  budget=f"{g3['over'+str(threshold)]}/{g3['count']} → {g4['over'+str(threshold)]}/{g4['count']} (>{threshold})" if timed else 'not a distribution budget'
  status=('PASS p95' if g4['p95']<=threshold else 'FAIL p95') if timed else 'descriptive only'
  lines.append(f"|{case}/{group}|{g4['count']}|{cell(g3)}|{cell(g4)}|{fmt(g3['p95'])}|{fmt(g4['p95'])}|{budget}|{status}|")
lines+=['','Candidate04 residual slow samples: dense collapse has2/20 over250 ms (max260, p95256); large editor follow has1/20 over200 ms (max205, p95180); dense wheel has1/20 over200 ms (max262, p95167). These remain in raw records. No further tuning or repeat was performed. Combined04 changes include progress coalescing, bounded page-read concurrency and generic virtual-scroll scheduling; this comparison does not attribute every gain to a single change.','','## Keyboard and lifecycle functional evidence','','`p7-candidate-m02-outline04-keyboard-01`: trusted Shift+F6 then3 Tab presses enter the tree. End focuses rank17999 with range17840..18000/160 actual rows (130 ms); Home focuses rank0 with range0..160/160 rows (150 ms). Document version remains0/dirtyfalse, exact source SHA unchanged. These are single functional timing observations, not p95 or a screen-reader test.','','`p7-candidate-m02-outline04-lifecycle-01`: first partial index25 headings/256 scanned lines was observed. Immediately before real Source input, index was still incomplete at823 headings/8192 of40001 lines. Input creates version2 then3 and the changed first heading; latest-version full index has8775 headings. Undo/save yields version4/savedVersion4/dirtyfalse, original first heading and exact original disk SHA. A separate incomplete scan is switched to empty before completion; the empty document remains0 rows through a2000 ms observation window. Reopen completes8775 headings, with one6339 ms index observation. This proves cancellation through document replacement and stale-response isolation; it is not a separately instrumented helper teardown measurement.','','## Evidence and environment','','All04 run paths start `runs/p7-candidate-m02-outline04-` (large-01,dense-01,keyboard-01,lifecycle-01). Each has completion, plan, original harness, installed catalog, document probes, measurements and final PNG. Final-screen PNGs do not substitute for intermediate DOM/focus assertions. `candidate03-vs04.json` lists exact inputs and screenshot hashes.','','Candidate04 CPU/GUI slot had no concurrent test/build/formatter/archive work by other agents; Root performed lightweight reads/document writes. This is coordinated scheduling, not guaranteed machine-wide isolation. Candidate03 dense had the separately disclosed formatter overlap in CANDIDATE03-DIAGNOSIS.md; no slow sample is attributed to it. No diagnostic Proxy/instrumented plugin is used in this table.','','All4 owned drivers stopped using exact PID/birth checks; last stop14:08:13.421427Z. CPU/GUI released to Root; Xvfb127 retained for Root cleanup,126 untouched. M01 evidence remains frozen. No claim of per-helper instantaneous cancellation cleanup follows from driver stops.']
(root/'CANDIDATE03-VS04.md').write_text('\n'.join(lines)+'\n')
print(root/'CANDIDATE03-VS04.md')

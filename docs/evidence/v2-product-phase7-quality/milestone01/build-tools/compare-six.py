from pathlib import Path
import json,statistics,math,hashlib,datetime
root=Path('/workspace/milkup-p7-quality-evidence/milestone01');out=root/'performance-candidate';runs=root/'native-ui/runs'
cases=[('ordinary-live','p7-baseline-ordinary-live-01','ordinary EditorView'),('ordinary-source','p7-baseline-ordinary-source-01','ordinary EditorView'),('memory-source','p7-baseline-input-01','memory SourceDocumentView'),('memory-live','p7-baseline-live-01','memory SourceDocumentView'),('native-source','p7-baseline-large-source-01','native large-file SourceDocumentView') ,('native-live','p7-baseline-large-live-01','native large-file SourceDocumentView')]
def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()
def distribution(values):
 values=sorted(values);n=len(values)
 if not n:return None
 r={'n':n,'minMs':min(values),'medianMs':statistics.median(values),'maxMs':max(values),'within100msCount':sum(v<=100 for v in values),'within100msRatio':sum(v<=100 for v in values)/n}
 if n>=20:r['nearestRankP95Ms']=values[math.ceil(n*.95)-1]
 else:r['note']='Single observation, not a percentile estimate' if n==1 else 'Fewer than 20 observations; no p95 claim'
 return r
def read_run(run):
 d=json.loads((runs/run/'samples.json').read_text());diag=json.loads((runs/run/'diagnostics.json').read_text());samples=d['samples'];groups={}
 for kind in ['jump','input','delete','search']:
  groups[kind]=distribution([s['frameMs'] for s in samples if s['kind']==kind and 'frameMs' in s])
 for temp in ['first-target','unchanged-warm','after-edit']:
  groups['jump:'+temp]=distribution([s['frameMs'] for s in samples if s['kind']=='jump' and s.get('temperature')==temp])
 for kind in ['open-to-ready','save-to-ready']:groups[kind]=distribution([s['ms'] for s in samples if s['kind']==kind])
 cpu=lambda x:dict(line.split() for line in x.splitlines())
 start=cpu(d['resources'][0]['cpu']);end=cpu(d['resources'][-1]['cpu'])
 return {'run':run,'metadata':d['metadata'],'complete':d.get('complete',False),'recordCount':len(samples),'groups':groups,'violations':d['violations'],'observedSourceDocumentView':diag['backend'],'maxTimerGapMs':diag['maxTimerGap'],'longTaskSupported':diag['longTaskSupported'],'errors':diag['diagnostics']['errors'],'cspViolations':diag['diagnostics']['cspViolations'],'cpuDelta':{k:int(end[k])-int(start[k]) for k in ['usage_usec','nr_periods','nr_throttled','throttled_usec']},'loadBefore':d['resources'][0]['load'],'loadAfter':d['resources'][-1]['load'],'exactSavedFile':sha(runs/run/'original.md')==d['metadata']['sha256'],'samplesSha256':sha(runs/run/'samples.json')}
rows=[]
for case,baseline,route in cases:
 c=read_run('p7-candidate-02-'+case+'-01');b=read_run(baseline)
 assert c['metadata']['sha256']==b['metadata']['sha256'] and c['metadata']['bytes']==b['metadata']['bytes'] and c['metadata']['mode']==b['metadata']['mode'] and c['metadata']['lineBytes']==b['metadata']['lineBytes']==64 and c['metadata']['cycles']==b['metadata']['cycles']==20
 rows.append({'case':case,'route':route,'routeEvidence':'Public SourceDocumentView marker plus actual fixture size and frozen 128KiB performance/256KiB native open policy; native classification is policy inference, not an observation of private handles.','baseline':b,'candidate':c})
summary={'generatedUtc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'baselineSha256':'f15c476a4f6e7b5f254e325692d57e9bfaa798580441dd3554f6c4fe1e9d802e','candidateSha256':'8deacbf470f699ad9b0a6c2c2937adbfc7ef6194c38e8f61e707a70bdfc5f9b2','timing':'Trusted XTest keydown → observed DOM/cursor + two rAF callbacks; presentation proxy, not physical display timestamp. Nearest rank p95 only when n>=20. <=100ms ratio is empirical, not a guarantee.','matchedRuns':rows}
(out/'comparison.json').write_text(json.dumps(summary,indent=2)+'\n')
lines=['# Candidate 02 matched native performance','',f"Baseline `{summary['baselineSha256']}`; candidate `{summary['candidateSha256']}`.",'','Each matched case uses the identical fixture SHA/actual bytes, lineBytes=64, 20 cycles, fresh profile, display :127, unchanged XTest protocol and targets. All records and failures remain in native-ui/runs; execution logs/source snapshots are retained separately. No builds, browser tests or other native workloads were intentionally run in the candidate timing window.','', '| Case | Actual bytes | Input p95 baseline → candidate | Delete p95 | Jump p95 | Search single value |','|---|---:|---:|---:|---:|---:|']
for r in rows:
 b=r['baseline']['groups'];c=r['candidate']['groups'];fmt=lambda key:f"{b[key]['nearestRankP95Ms']:.1f} → {c[key]['nearestRankP95Ms']:.1f}"
 lines.append(f"| {r['case']} | {r['candidate']['metadata']['bytes']} | {fmt('input')} | {fmt('delete')} | {fmt('jump')} | {b['search']['medianMs']:.1f} → {c['search']['medianMs']:.1f} |")
lines+=['','All times milliseconds. The main table uses 20 input, 20 deletion and 80 jump samples per run. Search/open/save and the first-target jump have one observation per run; none is labeled p95.','', '| Candidate case / operation | n | min | median | max | p95 (n≥20) | ≤100ms count / ratio |','|---|---:|---:|---:|---:|---:|---:|']
for r in rows:
 for kind,g in r['candidate']['groups'].items():
  if g is None:continue
  p=f"{g['nearestRankP95Ms']:.1f}" if 'nearestRankP95Ms' in g else 'single value' if g['n']==1 else 'n<20'
  lines.append(f"| {r['case']} / {kind} | {g['n']} | {g['minMs']:.1f} | {g['medianMs']:.1f} | {g['maxMs']:.1f} | {p} | {g['within100msCount']}/{g['n']} ({g['within100msRatio']:.1%}) |")
lines+=['','## Budget failures and integrity','']
for r in rows:
 c=r['candidate'];v=c['violations'];lines.append(f"- {r['case']}: {c['recordCount']} records, complete={c['complete']}, saved bytes exact={c['exactSavedFile']}, {len(v)} target violations; cgroup throttling counter delta={c['cpuDelta']['nr_throttled']}, throttled microseconds delta={c['cpuDelta']['throttled_usec']}.")
 for s in v:lines.append(f"  - Retained {s['kind']} round {s.get('round','n/a')} {s.get('direction','')}: {s['frameMs']:.1f}ms, target {s['targetMs']}ms (DOM {s['domMs']:.1f}ms).")
lines+=['','The baseline ordinary Live nine 200ms misses and large-file search misses remain unchanged. Candidate outcomes do not erase them. A harness exit 0 means the scenario completed; the separate accepted/violations fields decide whether its timing budgets passed. Any improvement is scoped to these six fixed runs, not a claim about all documents or real system IME.','', 'All 179219-byte cases are memory-windowed, not ordinary; 65555-byte cases are ordinary. Native-large classification for the large fixtures is supported by frozen routing policy and observed view marker, not by the marker alone. WebKit longtask support and resource samples are recorded; absence of longtask records is not proof of no stalls.','', 'Initial candidate batch run-name validation failed before any driver/application start; candidate-six-console.log preserves it. The corrected prefix was the only batch change; product, thresholds and measurements were unchanged.']
(out/'README.md').write_text('\n'.join(lines)+'\n')
print('\n'.join(lines[:15]))

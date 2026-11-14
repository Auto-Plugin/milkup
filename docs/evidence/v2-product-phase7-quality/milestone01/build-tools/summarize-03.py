from pathlib import Path
import json,hashlib,statistics,math,datetime
root=Path('/workspace/milkup-p7-quality-evidence/milestone01');runs=root/'native-ui/runs';out=root/'performance-candidate-03'
cases=[('baseline','source','first','p7-baseline-ordinary-source-01'),('baseline','source','repeat','p7-baseline-ordinary-source-repeat-01'),('candidate02','source','first','p7-candidate-02-ordinary-source-01'),('candidate02','source','repeat','p7-candidate-02-ordinary-source-repeat-01'),('candidate03','source','first','p7-candidate-03-ordinary-source-01'),('baseline','live','first','p7-baseline-ordinary-live-01'),('candidate02','live','first','p7-candidate-02-ordinary-live-01'),('candidate03','live','first','p7-candidate-03-ordinary-live-01')]
def stat(values):
 values=sorted(values);n=len(values);r={'n':n,'minMs':min(values),'medianMs':statistics.median(values),'maxMs':max(values),'within100msCount':sum(v<=100 for v in values),'within100msRatio':sum(v<=100 for v in values)/n}
 if n>=20:r['p95Ms']=values[math.ceil(n*.95)-1]
 else:r['note']='Single observation; not p95' if n==1 else 'n<20; no p95'
 return r
rows=[]
for version,mode,iteration,name in cases:
 d=json.loads((runs/name/'samples.json').read_text());diag=json.loads((runs/name/'diagnostics.json').read_text());groups={};samples=d['samples']
 for kind in ['input','delete','jump','search']:
  ss=[s for s in samples if s['kind']==kind and 'frameMs' in s];groups[kind]={k:stat([s['frameMs']-s['domMs'] if k=='postDomFrameDelay' else s[k] for s in ss]) for k in ['domMs','frameMs','postDomFrameDelay']}
 for kind in ['open-to-ready','save-to-ready']:groups[kind]={'singleMs':next(s['ms'] for s in samples if s['kind']==kind)}
 for temperature in ['first-target','unchanged-warm','after-edit']:groups['jump:'+temperature]={'frameMs':stat([s['frameMs'] for s in samples if s['kind']=='jump' and s.get('temperature')==temperature])}
 parse=lambda i:dict(line.split() for line in d['resources'][i]['cpu'].splitlines());a=parse(0);b=parse(-1)
 rows.append({'version':version,'mode':mode,'iteration':iteration,'run':name,'metadata':d['metadata'],'groups':groups,'recordCount':len(samples),'complete':d.get('complete'),'violations':d['violations'],'exactSavedFile':hashlib.sha256((runs/name/'original.md').read_bytes()).hexdigest()==d['metadata']['sha256'],'samplesSha256':hashlib.sha256((runs/name/'samples.json').read_bytes()).hexdigest(),'observedSourceDocumentView':diag['backend'],'maxTimerGapMs':diag['maxTimerGap'],'errors':diag['diagnostics']['errors'],'cspViolations':diag['diagnostics']['cspViolations'],'cpuDelta':{k:int(b[k])-int(a[k]) for k in ['usage_usec','nr_throttled','throttled_usec']}})
assert len({r['metadata']['sha256'] for r in rows})==1 and all(r['metadata']['bytes']==65555 and r['metadata']['cycles']==20 and r['metadata']['lineBytes']==64 for r in rows)
result={'generatedUtc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'artifacts':{v:json.loads((root/p/'proof.json').read_text())['artifact'] for v,p in [('baseline','baseline-production'),('candidate02','candidate-production-02'),('candidate03','candidate-production-03')]},'scope':'Candidate03 retests ONLY ordinary Source and ordinary Live. No candidate03 performance claim for memory/native large-file views or outline. Existing candidate02 full six+repeat evidence remains independent.','measurement':'Trusted XTest keydown to public DOM/cursor plus two rAF callbacks; not physical screen latency. p95 nearest rank only n>=20.','rows':rows}
(out/'comparison.json').write_text(json.dumps(result,indent=2)+'\n')
lines=['# Candidate 03 ordinary editor performance','',result['scope'],'',f"Candidate03 ELF `{result['artifacts']['candidate03']['sha256']}`. Same four harness/helper source hashes as candidate02, same 65555-byte fixture, lineBytes64, 20 cycles, 143 records per run, fresh profiles. Source ran first, Live second, exactly once each. No changed thresholds, prewarming or best-run selection.",'','| Version / mode / run | Input DOM p95 | Input frame p95 | Delete DOM p95 | Delete frame p95 | Jump frame p95 | First search (single) | Violations |','|---|---:|---:|---:|---:|---:|---:|---:|']
for r in rows:
 g=r['groups'];lines.append(f"| {r['version']} / {r['mode']} / {r['iteration']} | {g['input']['domMs']['p95Ms']:.1f} | {g['input']['frameMs']['p95Ms']:.1f} | {g['delete']['domMs']['p95Ms']:.1f} | {g['delete']['frameMs']['p95Ms']:.1f} | {g['jump']['frameMs']['p95Ms']:.1f} | {g['search']['frameMs']['medianMs']:.1f} | {len(r['violations'])} |")
lines+=['','All times milliseconds. Source first+repeat aggregate baseline/candidate02 n40 remains in performance-repeat/comparison.json; versions and iterations are not pooled in this table.','', '| Candidate03 operation | n | min | median | max | p95 (n≥20) | ≤100ms |','|---|---:|---:|---:|---:|---:|---:|']
for r in rows:
 if r['version']!='candidate03':continue
 for kind,g in r['groups'].items():
  if 'frameMs' not in g:continue
  s=g['frameMs'];p=f"{s['p95Ms']:.1f}" if 'p95Ms' in s else 'single value'
  lines.append(f"| {r['mode']} / {kind} | {s['n']} | {s['minMs']:.1f} | {s['medianMs']:.1f} | {s['maxMs']:.1f} | {p} | {s['within100msCount']}/{s['n']} ({s['within100msRatio']:.1%}) |")
 for kind in ['open-to-ready','save-to-ready']:lines.append(f"\n{r['mode']} {kind}: {r['groups'][kind]['singleMs']:.1f} ms, single observation.")
 lines.append(f"\n{r['mode']}: exactSavedFile={r['exactSavedFile']}; backend marker={r['observedSourceDocumentView']}; cgroup nr_throttled delta={r['cpuDelta']['nr_throttled']}, throttled_usec delta={r['cpuDelta']['throttled_usec']}; {len(r['violations'])} budget violations.")
 for s in r['violations']:lines.append(f"- Retained {s['kind']} round {s.get('round','n/a')}: {s['frameMs']:.1f}ms > {s['targetMs']}ms.")
lines+=['','All raw samples, violations, sources, command/exit records remain preserved. A successful scenario exit does not by itself establish performance targets; use violations and the empirical ≤100ms distribution. Two-frame latency is a presentation proxy and does not establish physical display response. A single clean candidate03 run is scoped evidence, not proof of universal/stable tail bounds. Existing baseline/candidate02 failures are not erased.']
(out/'README.md').write_text('\n'.join(lines)+'\n');print('\n'.join(lines[:18]))

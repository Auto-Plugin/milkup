from pathlib import Path
import json,hashlib,statistics,math,datetime
root=Path('/workspace/milkup-p7-quality-evidence/milestone01');runs=root/'native-ui/runs';out=root/'performance-repeat'
names={'baseline':['p7-baseline-ordinary-source-01','p7-baseline-ordinary-source-repeat-01'],'candidate':['p7-candidate-02-ordinary-source-01','p7-candidate-02-ordinary-source-repeat-01']}
def dist(values):
 values=sorted(values);n=len(values)
 d={'n':n,'minMs':min(values),'medianMs':statistics.median(values),'maxMs':max(values),'within100msCount':sum(v<=100 for v in values),'within100msRatio':sum(v<=100 for v in values)/n}
 if n>=20:d['p95Ms']=values[math.ceil(n*.95)-1]
 return d
def operations(samples):
 groups={}
 for kind in ['input','delete','jump','search']:
  selected=[s for s in samples if s['kind']==kind and 'frameMs' in s]
  groups[kind]={key:dist([s['frameMs']-s['domMs'] if key=='postDomFrameDelay' else s[key] for s in selected]) for key in ['domMs','frameMs','postDomFrameDelay']}
 return groups
allrows={};raw={}
for flavor,caseNames in names.items():
 rows=[];combined=[]
 for name in caseNames:
  d=json.loads((runs/name/'samples.json').read_text());combined.extend(d['samples']);samples=d['samples'];cpu=lambda i:dict(line.split() for line in d['resources'][i]['cpu'].splitlines());a=cpu(0);b=cpu(-1)
  rows.append({'run':name,'metadata':d['metadata'],'complete':d.get('complete'),'recordCount':len(samples),'operations':operations(samples),'violations':d['violations'],'exactSavedFile':hashlib.sha256((runs/name/'original.md').read_bytes()).hexdigest()==d['metadata']['sha256'],'samplesSha256':hashlib.sha256((runs/name/'samples.json').read_bytes()).hexdigest(),'cpuDelta':{k:int(b[k])-int(a[k]) for k in ['nr_throttled','throttled_usec','usage_usec']}})
 allrows[flavor]={'runs':rows,'combinedOperations':operations(combined),'combinedViolations':[v for r in rows for v in r['violations']]}
summary={'generatedUtc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'definition':'Exactly first+one repeat; no selection or warmup. Input/delete n40 per baseline/candidate; all first failures retained. Frame proxy does not measure physical display.','results':allrows}
(out/'comparison.json').write_text(json.dumps(summary,indent=2)+'\n')
lines=['# Ordinary Source matched repeat','',summary['definition'],'','Both runs requested 65536 bytes, lineBytes=64, cycles=20; actual fixture bytes 65555. Repeat order baseline then candidate; before/between/after process inventory ran outside timing.','', '| Version / run | Input DOM p95 | Input frame p95 | Delete DOM p95 | Delete frame p95 | Input frame max | Delete frame max | Violations |','|---|---:|---:|---:|---:|---:|---:|---:|']
for flavor,data in allrows.items():
 for row in data['runs']+[{'run':'combined 40 input/40 delete','operations':data['combinedOperations'],'violations':data['combinedViolations']}]:
  op=row['operations'];lines.append(f"| {flavor} / {row['run']} | {op['input']['domMs']['p95Ms']:.1f} | {op['input']['frameMs']['p95Ms']:.1f} | {op['delete']['domMs']['p95Ms']:.1f} | {op['delete']['frameMs']['p95Ms']:.1f} | {op['input']['frameMs']['maxMs']:.1f} | {op['delete']['frameMs']['maxMs']:.1f} | {len(row['violations'])} |")
lines+=['','Full JSON includes min/median/max, p95 only n≥20, ≤100ms counts/ratios, DOM vs frame vs post-DOM delay, individual violations, file/sample hashes and CPU counters. The combined result gives equal weight to both complete runs and does not overwrite a failure.','']
for flavor,data in allrows.items():
 for row in data['runs']:
  lines.append(f"- {row['run']}: complete={row['complete']}, records={row['recordCount']}, exactSavedFile={row['exactSavedFile']}, nr_throttled delta={row['cpuDelta']['nr_throttled']}, throttled_usec delta={row['cpuDelta']['throttled_usec']}.")
(out/'README.md').write_text('\n'.join(lines)+'\n');print('\n'.join(lines))

from pathlib import Path
import json,re
root=Path('/workspace/.milkup-v2-phase20');runs=[]
for p in sorted(root.glob('regression-trace-*/samples.json')):
 d=json.loads(p.read_text());assert d['complete'];trace=json.loads((p.parent/'diagnostics.json').read_text())['spans'];native=[]
 for line in (p.parent/'driver.log').read_text().splitlines():
  m=re.search(r'PHASE20 (\d+) (\d+) (\S+) (\S+) (\S+) ([\d.]+)',line)
  if m:
   wall,id,thread,name,stage,ms=m.groups();native.append({'wallMs':int(wall)/1000,'id':int(id),'thread':thread,'name':name,'stage':stage,'elapsedMs':float(ms)})
 spans={}
 for row in native:spans.setdefault(row['id'],[]).append(row)
 checkpoints=[]
 for rows in spans.values():
  if rows[0]['name']!='checkpoint-store':continue
  stages={r['stage']:r for r in rows}
  checkpoints.append({'startWallMs':rows[0]['wallMs'],'writeMs':stages['write-end']['elapsedMs']-stages['write-begin']['elapsedMs'],'hashMs':stages['hash-end']['elapsedMs']-stages['write-end']['elapsedMs'],'publishMs':stages['commit-end']['elapsedMs']-stages['hash-end']['elapsedMs'],'totalMs':stages['end']['elapsedMs']})
 selected=[]
 for kind in ['jump','input','delete']:
  s=max((s for s in d['samples'] if s['kind']==kind),key=lambda s:s['frameMs']);nested=[{**t,'overlapMs':min(t['end'],s['twoFrames'])-max(t['start'],s['started'])} for t in trace if t['end']>=s['started'] and t['start']<=s['twoFrames']];nested.sort(key=lambda t:-t['overlapMs'])
  selected.append({'sample':s,'largestOverlappingFrontendSpans':nested[:12],'nativeEventsAroundSample':[n for n in native if s['wall']-1500<=n['wallMs']<=s['wall']+s['frameMs']]})
 runs.append({'run':p.parent.name,'checkpoints':checkpoints,'worstSamples':selected})
(root/'trace-analysis.json').write_text(json.dumps({'diagnosticOnly':True,'nestedIntervalsNotAdditive':True,'runs':runs},indent=2))
for r in runs:
 print(r['run'],[(round(c['writeMs']),round(c['hashMs']),round(c['publishMs'])) for c in r['checkpoints']])

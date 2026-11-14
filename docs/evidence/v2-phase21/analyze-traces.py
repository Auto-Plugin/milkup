import pathlib,re,json,statistics
root=pathlib.Path('/workspace/.milkup-v2-phase21');runs=[]
for p in sorted(root.glob('regression-trace-*/driver.log')):
 events=[]
 for line in p.read_text().splitlines():
  m=re.search(r'PHASE21 (\d+) (\S+) (\S+) (\S+) ([\d.]+)',line)
  if m:events.append(dict(wallUs=int(m[1]),thread=m[2],name=m[3],stage=m[4],elapsedMs=float(m[5])))
 spans=[];active={}
 for e in events:
  key=(e['thread'],e['name'])
  if e['stage']=='begin':active[key]=dict(begin=e,marks=[])
  elif key in active:
   active[key]['marks'].append(e)
   if e['stage']=='end':spans.append(active.pop(key))
 reads=[]
 for span in spans:
  if span['begin']['name']!='read-window':continue
  locked=next(e for e in span['marks'] if e['stage']=='locked');end=span['marks'][-1]
  overlap=[s for s in spans if s['begin']['name']=='write' and s['begin']['thread']!=span['begin']['thread'] and s['begin']['wallUs']<locked['wallUs'] and s['marks'][-1]['wallUs']>span['begin']['wallUs']]
  reads.append({'beginUs':span['begin']['wallUs'],'waitMs':locked['elapsedMs'],'afterLockMs':end['elapsedMs']-locked['elapsedMs'],'overlappingWrites':overlap})
 runs.append({'name':p.parent.name,'spans':spans,'readsByWait':sorted(reads,key=lambda v:-v['waitMs'])})
(root/'trace-analysis.json').write_text(json.dumps(runs,indent=2))
for run in runs:
 print(run['name'],[{k:v for k,v in r.items() if k!='overlappingWrites'} | {'overlaps':len(r['overlappingWrites'])} for r in run['readsByWait'][:2]])

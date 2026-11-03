import json, urllib.request, datetime
from pathlib import Path
p=Path(__file__).parent
for name,url in [('run','https://api.github.com/repos/Auto-Plugin/milkup/actions/runs/41708284083'),('jobs','https://api.github.com/repos/Auto-Plugin/milkup/actions/runs/41708284083/jobs')]:
    with urllib.request.urlopen(urllib.request.Request(url,headers={'Cache-Control':'no-cache','User-Agent':'milkup-evidence-observer'})) as r: raw=r.read()
    (p/(name+'.json')).write_bytes(raw)
r=json.loads((p/'run.json').read_text());j=json.loads((p/'jobs.json').read_text())
assert r['head_sha']=='0811b899ea4c4f98294046f66524d4503307d279'
s={'observedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'head':r['head_sha'],'status':r['status'],'conclusion':r['conclusion'],'jobs':[{'id':x['id'],'status':x['status'],'conclusion':x['conclusion'],'steps':[{k:s.get(k) for k in ['number','name','status','conclusion','started_at','completed_at']} for s in x.get('steps',[])]} for x in j['jobs']]}
with (p/'phase-snapshots.jsonl').open('a') as f:f.write(json.dumps(s)+'\n')
print(json.dumps({'observedAt':s['observedAt'],'status':s['status'],'conclusion':s['conclusion'],'jobs':[{'id':x['id'],'status':x['status'],'conclusion':x['conclusion'],'active':[y for y in x['steps'] if y['status']=='in_progress'],'lastCompleted':[y for y in x['steps'] if y['status']=='completed'][-2:]} for x in s['jobs']]},indent=2))

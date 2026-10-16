#!/usr/bin/env python3
"""Read-only local and exact checkpoint06-reference integrity; not product tests."""
from pathlib import Path
import argparse,hashlib,json
ap=argparse.ArgumentParser();ap.add_argument('--checkpoint06',type=Path);a=ap.parse_args();root=Path(__file__).resolve().parent;i=json.loads((root/'index.json').read_text());base=a.checkpoint06 or root.parent/'checkpoint06';errors=[]
def fail(message):errors.append(message)
def checked(p,obj):
 if not p.is_file()or p.is_symlink():fail('missing-or-symlink:'+str(p));return
 b=p.read_bytes()
 if (len(b),hashlib.sha256(b).hexdigest())!=(obj['bytes'],obj['sha256']):fail('hash-or-length:'+str(p))
if not (base/'index.json').is_file():fail('missing checkpoint06 index')
elif hashlib.sha256((base/'index.json').read_bytes()).hexdigest()!=i['baseCheckpoint']['indexSha256']:fail('checkpoint06 index mismatch')
base_objects={x['stored']:x for x in json.loads((base/'index.json').read_text()).get('objects',[])}if(base/'index.json').is_file()else{}
local={};cross={}
for x in i['objects']:
 if x['stored']in local:fail('duplicate local path')
 local[x['stored']]=x;checked(root/x['stored'],x)
for x in i['crossCheckpointObjects']:
 if x['stored']in cross:fail('duplicate cross path')
 cross[x['stored']]=x;expected=base_objects.get(x['stored'])
 if not expected or (expected['sha256'],expected['bytes'])!=(x['sha256'],x['bytes']):fail('unindexed cross object:'+x['stored'])
 if x['commit']!=i['baseCheckpoint']['commit']:fail('cross commit mismatch')
 checked(base/x['stored'],x)
used={'local':set(),'checkpoint06':set()}
for x in i['sourceAliases']:
 mapping=local if x['storage']=='local'else cross if x['storage']=='checkpoint06'else {}
 obj=mapping.get(x['stored'])
 if not obj or (obj['sha256'],obj['bytes'])!=(x['sha256'],x['bytes']):fail('invalid alias:'+x['source'])
 else:used[x['storage']].add(x['stored'])
if used['local']!=set(local)or used['checkpoint06']!=set(cross):fail('unreferenced objects')
allowed=set(local)|{'README.md','index.json','verify-index.py'}
for p in root.rglob('*'):
 if p.is_symlink():fail('symlink:'+str(p))
 if p.is_file()and str(p.relative_to(root))not in allowed:fail('unindexed file:'+str(p.relative_to(root)))
if len({x['sha256']for x in i['objects']})!=len(local):fail('duplicate local hashes')
if {x['sha256']for x in i['objects']}&{x['sha256']for x in i['crossCheckpointObjects']}:fail('unnecessary cross-checkpoint duplicate')
print(json.dumps({'ok':not errors,'counts':i['counts'],'baseCheckpoint':i['baseCheckpoint'],'errors':errors},ensure_ascii=False,indent=2));raise SystemExit(bool(errors))

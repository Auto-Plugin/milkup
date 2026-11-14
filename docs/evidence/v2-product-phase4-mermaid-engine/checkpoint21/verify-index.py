#!/usr/bin/env python3
"""Read-only archive integrity, not product tests. Supports fixed checkpoint06/07/08/09/10/11/12/13/14/15/16/17."""
from pathlib import Path
import argparse,hashlib,json
ap=argparse.ArgumentParser();ap.add_argument('--checkpoint06',type=Path);ap.add_argument('--checkpoint07',type=Path);ap.add_argument('--checkpoint08',type=Path);ap.add_argument('--checkpoint09',type=Path);ap.add_argument('--checkpoint10',type=Path);ap.add_argument('--checkpoint11',type=Path);ap.add_argument('--checkpoint12',type=Path);ap.add_argument('--checkpoint13',type=Path);ap.add_argument('--checkpoint14',type=Path);ap.add_argument('--checkpoint15',type=Path);ap.add_argument('--checkpoint16',type=Path);ap.add_argument('--checkpoint17',type=Path);ap.add_argument('--checkpoint18',type=Path);ap.add_argument('--checkpoint19',type=Path);ap.add_argument('--checkpoint20',type=Path);a=ap.parse_args();root=Path(__file__).resolve().parent;i=json.loads((root/'index.json').read_text());errors=[];maps={'local':{}};paths={};used={'local':set()}
def fail(msg):errors.append(msg)
def checked(p,x):
 if not p.is_file() or p.is_symlink():fail('missing-or-symlink:'+str(p));return
 data=p.read_bytes()
 if (len(data),hashlib.sha256(data).hexdigest())!=(x['bytes'],x['sha256']):fail('hash-or-length:'+str(p))
for name,base in i['baseCheckpoints'].items():
 p=getattr(a,name) or root.parent/name;paths[name]=p;used[name]=set();maps[name]={};mf=p/'index.json'
 if not mf.is_file():fail('missing-base:'+name);continue
 if hashlib.sha256(mf.read_bytes()).hexdigest()!=base['indexSha256']:fail('base-index:'+name)
 maps[name]={x['stored']:x for x in json.loads(mf.read_text())['objects']}
for x in i['objects']:
 if x['stored'] in maps['local']:fail('duplicate-local-path')
 maps['local'][x['stored']]=x;checked(root/x['stored'],x)
refs={}
for x in i['crossCheckpointObjects']:
 name=x['checkpoint'];key=(name,x['stored'])
 if key in refs:fail('duplicate-cross-path')
 refs[key]=x;o=maps.get(name,{}).get(x['stored'])
 if not o or (o['sha256'],o['bytes'])!=(x['sha256'],x['bytes']):fail('unindexed-cross:'+str(key))
 if x['commit']!=i['baseCheckpoints'][name]['commit']:fail('cross-commit')
 checked(paths[name]/x['stored'],x)
for x in i['sourceAliases']:
 name=x['storage'];o=maps['local'].get(x['stored']) if name=='local' else refs.get((name,x['stored']))
 if not o or (o['sha256'],o['bytes'])!=(x['sha256'],x['bytes']):fail('invalid-alias:'+x['source'])
 else:used[name].add(x['stored'])
if used['local']!=set(maps['local']):fail('unreferenced-local')
if {(k,p)for k,v in used.items()if k!='local'for p in v}!=set(refs):fail('unreferenced-cross')
allowed=set(maps['local'])|{'README.md','index.json','verify-index.py'}
for p in root.rglob('*'):
 if p.is_symlink():fail('symlink:'+str(p))
 if p.is_file() and str(p.relative_to(root))not in allowed:fail('orphan:'+str(p))
allhashes=[x['sha256']for x in i['objects']+i['crossCheckpointObjects']]
if len(set(allhashes))!=len(allhashes):fail('duplicate-object-hash')
print(json.dumps({'ok':not errors,'status':i['status'],'counts':i['counts'],'baseCheckpoints':i['baseCheckpoints'],'errors':errors},ensure_ascii=False,indent=2));raise SystemExit(bool(errors))

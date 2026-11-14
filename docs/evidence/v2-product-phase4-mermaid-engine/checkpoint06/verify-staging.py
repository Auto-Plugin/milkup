#!/usr/bin/env python3
"""Read-only byte and alias integrity check; not a product test."""
from pathlib import Path
import hashlib,json
root=Path(__file__).resolve().parent
index=json.loads((root/'index.json').read_text())
errors=[];objects={}
for obj in index['objects']:
 p=root/obj['stored']
 if not p.is_file():errors.append('missing:'+str(p));continue
 b=p.read_bytes()
 if len(b)!=obj['bytes'] or hashlib.sha256(b).hexdigest()!=obj['sha256']:errors.append('mismatch:'+str(p))
 objects[obj['stored']]=obj
for alias in index['sourceAliases']:
 obj=objects.get(alias['stored'])
 if not obj or (obj['sha256'],obj['bytes'])!=(alias['sha256'],alias['bytes']):errors.append('invalid-alias:'+alias['source'])
allowed=set(objects)|{'index.json','README.md','verify-staging.py'}
for p in root.rglob('*'):
 if p.is_file() and str(p.relative_to(root)) not in allowed:errors.append('unindexed:'+str(p.relative_to(root)))
if index['selectionMismatches']:errors.append('selection mismatches exist')
print(json.dumps({'ok':not errors,'counts':index['counts'],'errors':errors},indent=2))
raise SystemExit(bool(errors))

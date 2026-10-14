import pathlib,shutil,json,hashlib
root=pathlib.Path('/workspace/.milkup-v2-phase19');dest=pathlib.Path('/workspace/milkup/docs/evidence/v2-phase19');dest.mkdir(parents=True,exist_ok=True)
files=[p for p in root.iterdir() if p.is_file() and p.suffix in ['.json','.log','.md','.py']]
for p in root.iterdir():
 if p.is_dir() and p.name.startswith('regression-') and not p.name.startswith('regression-runtime-'):
  files.extend(f for f in p.rglob('*') if f.is_file() and f.suffix in ['.json','.png','.log','.mkv'])
records=[]
for f in sorted(files):
 if f.stat().st_size>8*1024*1024:raise RuntimeError('unexpected large evidence: '+str(f))
 rel=f.relative_to(root);to=dest/rel;to.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(f,to)
 records.append({'path':str(rel),'rawBytes':f.stat().st_size,'rawSha256':hashlib.sha256(f.read_bytes()).hexdigest()})
(dest/'raw-source-manifest.json').write_text(json.dumps(records,indent=2)+'\n')
print(len(records),'raw files copied, bytes',sum(r['rawBytes'] for r in records))

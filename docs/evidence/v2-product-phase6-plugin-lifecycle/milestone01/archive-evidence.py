from pathlib import Path
import os,json,hashlib
src=Path('/workspace/milkup-plugin-lifecycle-evidence/milestone01')
dst=Path('/workspace/milkup/docs/evidence/v2-product-phase6-plugin-lifecycle/milestone01')
assert not dst.exists(), 'Do not overwrite an existing frozen checkpoint'
dst.mkdir(parents=True)
excluded=[]
for p in sorted(src.rglob('*')):
 if not p.is_file():continue
 assert not p.is_symlink(),str(p)
 rel=p.relative_to(src)
 with p.open('rb') as f:magic=f.read(4)
 if p.name.endswith(('.milkup-plugin','.tgz','.tar.gz','.zip')) or magic==b'\x7fELF':
  excluded.append({'path':str(p),'relativePath':str(rel),'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'reason':'local binary or SDK/plugin archive, excluded from Git evidence'});continue
 target=dst/rel;target.parent.mkdir(parents=True,exist_ok=True)
 os.link(p,target)
(dst/'excluded-local-artifacts.json').write_text(json.dumps(excluded,indent=2)+'\n')
print('Archived evidence; excluded',len(excluded),'local binary/archive files')

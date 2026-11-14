from pathlib import Path
import hashlib,json,shutil,os
src=Path(__file__).resolve().parent
dst=Path('/workspace/milkup/docs/evidence/v2-product-phase6-plugin-lifecycle/milestone02')
dst.mkdir(parents=True,exist_ok=True)
excluded=[]
for base,dirs,names in os.walk(src):
 dirs[:]=[d for d in dirs if d not in ['node_modules','.git','__pycache__']]
 for name in names:
  p=Path(base)/name;rel=p.relative_to(src)
  if p.is_symlink():raise RuntimeError('Unexpected evidence symlink '+str(rel))
  data=p.read_bytes();digest=hashlib.sha256(data).hexdigest()
  if name=='milkup-desktop' or p.suffix in ['.tgz','.milkup-plugin','.pyc']:
   excluded.append({'path':str(rel),'bytes':len(data),'sha256':digest,'reason':'Locally retained executable/package artifact; exact source/build provenance retained separately'})
   continue
  out=dst/rel;out.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(p,out)
(dst/'excluded-local-artifacts.json').write_text(json.dumps(excluded,indent=2)+'\n')
shutil.copy2('/workspace/milkup/docs/evidence/v2-product-phase6-plugin-lifecycle/milestone01/verify-index.py',dst/'verify-index.py')
rows=[{'path':str(p.relative_to(dst)),'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for p in sorted(dst.rglob('*')) if p.is_file() and p.name!='final-index.json']
(dst/'final-index.json').write_text(json.dumps({'format':1,'files':rows},indent=2)+'\n')
print(json.dumps({'files':len(rows),'bytes':sum(r['bytes'] for r in rows),'excludedArtifacts':len(excluded)}))

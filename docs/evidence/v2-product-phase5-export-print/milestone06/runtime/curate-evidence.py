from pathlib import Path
import json,shutil,hashlib
source=Path('/workspace/milkup-export-print-evidence/milestone06'); dest=Path('/workspace/milkup/docs/evidence/v2-product-phase5-export-print/milestone06');native=source.parent/'milestone01/native-ui'
assert not dest.exists()
excluded=[]
for p in sorted(source.rglob('*')):
 if not p.is_file():continue
 rel=p.relative_to(source)
 if p.name=='milkup-desktop' or p.suffix in ('.milkup-plugin','.tgz') or '__pycache__' in p.parts:
  excluded.append({'path':str(rel),'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'reason':'Local executable/package preserved outside git; not uploaded'})
  continue
 out=dest/rel;out.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(p,out)
for run in sorted((native/'runs').glob('p5-m06-*')):
 if not run.is_dir():continue
 out=dest/'native'/run.name
 shutil.copytree(run,out,ignore=shutil.ignore_patterns('*.milkup-plugin'))
 for package in run.rglob('*.milkup-plugin'):
  excluded.append({'path':str(Path('native')/run.name/package.relative_to(run)),'bytes':package.stat().st_size,'sha256':hashlib.sha256(package.read_bytes()).hexdigest(),'reason':'Generated test-resource plugin package; original remains in local native run; not uploaded'})
 for folder in ['logs','control','runs/control']:
  for p in (native/folder).glob(run.name+'-*'):
   if p.is_file():
    target=out/'driver-records'/p.name;target.parent.mkdir(exist_ok=True);shutil.copy2(p,target)
(dest/'excluded-local-binaries.json').write_text(json.dumps(excluded,indent=2)+'\n')
shutil.copy2(dest.parent/'milestone05/verify-index.py',dest/'verify-index.py')
print('Copied',sum(p.is_file() for p in dest.rglob('*')),'files')
print('Excluded',len(excluded),'local executable/package files')

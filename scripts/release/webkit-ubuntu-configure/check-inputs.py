from pathlib import Path
import sys,json,hashlib,subprocess
repo=Path(sys.argv[1]).resolve();d=repo/'scripts/release/webkit-ubuntu-configure'
request=json.loads((repo/'release/webkit-ubuntu-configure-request.json').read_text())
assert request['expectedParent']=='12357f53601886e891bf23c09041b2fc91c1e607'
assert request['mode']=='authenticated-Ubuntu-configure-resource-only' and request['maximumJobMinutes']==60
assert subprocess.check_output(['git','-C',str(repo),'rev-parse','HEAD^'],text=True).strip()==request['expectedParent']
manifest=d/'inputs.lock.json'
assert hashlib.sha256(manifest.read_bytes()).hexdigest()==request['inputLockSha256']
lock=json.loads(manifest.read_text())
for name,h in lock.items():
 p=d/name;assert p.resolve().is_relative_to(d.resolve()) and p.is_file() and not p.is_symlink()
 assert hashlib.sha256(p.read_bytes()).hexdigest()==h,'Input mismatch: '+name
changed=subprocess.check_output(['git','-C',str(repo),'diff-tree','--no-commit-id','--name-only','-r','HEAD'],text=True).splitlines()
allowed={'scripts/release/webkit-ubuntu-configure/'+n for n in lock}|{'scripts/release/webkit-ubuntu-configure/inputs.lock.json','.github/workflows/webkit-ubuntu-configure.yml','release/webkit-ubuntu-configure-request.json'}
assert set(changed)==allowed,'Unexpected commit scope'
print(json.dumps({'status':'exact-parent-inputs-and-file-scope-verified','head':subprocess.check_output(['git','-C',str(repo),'rev-parse','HEAD'],text=True).strip(),'inputLockSha256':request['inputLockSha256'],'mode':request['mode'],'inputFiles':len(lock)}))

from pathlib import Path
import sys,json,hashlib,subprocess
repo=Path(sys.argv[1]).resolve();d=repo/'scripts/release/webkit-ubuntu-configure'
request=json.loads((repo/'release/webkit-ubuntu-configure-request.json').read_text())
assert request['expectedParent']=='fce75b5e24dc7e9364cd995d9f7267775bf76f10'
assert request['mode']=='authenticated-Ubuntu-configure-resource-only' and request['maximumJobMinutes']==60
assert subprocess.check_output(['git','-C',str(repo),'rev-parse','HEAD^'],text=True).strip()==request['expectedParent']
manifest=d/'inputs.lock.json'
assert hashlib.sha256(manifest.read_bytes()).hexdigest()==request['inputLockSha256']
lock=json.loads(manifest.read_text())
for name,h in lock.items():
 p=d/name;assert p.resolve().is_relative_to(d.resolve()) and p.is_file() and not p.is_symlink()
 assert hashlib.sha256(p.read_bytes()).hexdigest()==h,'Input mismatch: '+name
changed=subprocess.check_output(['git','-C',str(repo),'diff-tree','--no-commit-id','--name-only','-r','HEAD'],text=True).splitlines()
allowed={'scripts/release/webkit-ubuntu-configure/test_stream_trace.py', 'scripts/release/webkit-ubuntu-configure/configure-packages.json', 'scripts/release/webkit-ubuntu-configure/test_run.py', 'scripts/release/webkit-ubuntu-configure/test_classifier_handles.py', 'scripts/release/webkit-ubuntu-configure/test_locale_gate.py', 'scripts/release/webkit-ubuntu-configure/STREAM-LOCAL.md', '.github/workflows/webkit-ubuntu-configure.yml', 'scripts/release/webkit-ubuntu-configure/isolated_configure.py', 'scripts/release/webkit-ubuntu-configure/run.py', 'scripts/release/webkit-ubuntu-configure/trace_obligations.py', 'scripts/release/webkit-ubuntu-configure/stress_configure.py', 'scripts/release/webkit-ubuntu-configure/LOCALE-LOCAL.md', 'scripts/release/webkit-ubuntu-configure/check-inputs.py', 'release/webkit-ubuntu-configure-request.json', 'scripts/release/webkit-ubuntu-configure/inputs.lock.json', 'scripts/release/webkit-ubuntu-configure/stream_trace.py', 'scripts/release/webkit-ubuntu-configure/locale_gate.py'}
assert set(changed)==allowed,'Unexpected commit scope'
print(json.dumps({'status':'exact-parent-inputs-and-file-scope-verified','head':subprocess.check_output(['git','-C',str(repo),'rev-parse','HEAD'],text=True).strip(),'inputLockSha256':request['inputLockSha256'],'mode':request['mode'],'inputFiles':len(lock)}))

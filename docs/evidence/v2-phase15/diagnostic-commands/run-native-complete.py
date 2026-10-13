import subprocess,os,json,datetime,pathlib,hashlib
root=pathlib.Path('/tmp/milkup-v2-phase15')
binary=pathlib.Path('apps/desktop/src-tauri/target/release/milkup-desktop')
assets=pathlib.Path('apps/desktop/dist')
(root/'production-build-manifest.json').write_text(json.dumps({'binary':{'path':str(binary),'bytes':binary.stat().st_size,'sha256':hashlib.sha256(binary.read_bytes()).hexdigest()},'assets':[{'path':str(p.relative_to(assets)),'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for p in sorted(assets.rglob('*')) if p.is_file()]},indent=2)+'\n')
checks=[('production-tables-complete','tests/native/tauri-production-tables.mjs',{}),('production-unicode-final','tests/native/tauri-production-search.mjs',{}),('production-100mib-final','tests/native/tauri-production-search.mjs',{'MILKUP_PRODUCTION_CASE':'large','MILKUP_SEARCH_FIXTURE':'/tmp/milkup-v2-phase13/native-scroll-batched/original.md'})]
results=[]
for name,script,extra in checks:
 env={**os.environ,'MILKUP_NATIVE_EXCLUSIVE_DISPLAY':'1','MILKUP_NATIVE_EVIDENCE_DIR':str(root/name),**extra}
 cmd=['node',script];at=datetime.datetime.now(datetime.timezone.utc).isoformat()
 with (root/(name+'.log')).open('w') as log:r=subprocess.run(cmd,env=env,stdout=log,stderr=subprocess.STDOUT)
 results.append({'name':name,'command':cmd,'environment':{'MILKUP_NATIVE_EXCLUSIVE_DISPLAY':'1','MILKUP_NATIVE_EVIDENCE_DIR':str(root/name),**extra},'started':at,'exitCode':r.returncode})
 (root/'native-complete-checks.json').write_text(json.dumps(results,indent=2)+'\n');print(name,r.returncode,flush=True)
 if r.returncode:raise SystemExit(r.returncode)

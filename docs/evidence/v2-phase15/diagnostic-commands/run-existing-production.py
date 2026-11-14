import subprocess,os,json,pathlib,datetime
root=pathlib.Path('/tmp/milkup-v2-phase15');results=[]
for name in ['quality','windowed-unicode','block-keyboard','table-editing','navigation','windowed-blocks']:
 cmd=['node','tests/native/tauri-'+name+'.mjs'];env={**os.environ,'TAURI_APP_PATH':str(pathlib.Path('apps/desktop/src-tauri/target/release/milkup-desktop').resolve()),'MILKUP_NATIVE_EXCLUSIVE_DISPLAY':'1','MILKUP_NATIVE_EVIDENCE_DIR':str(root/('production-existing-'+name))}
 at=datetime.datetime.now(datetime.timezone.utc).isoformat()
 with (root/('production-existing-'+name+'.log')).open('w') as log:r=subprocess.run(cmd,env=env,stdout=log,stderr=subprocess.STDOUT)
 results.append({'name':name,'command':cmd,'started':at,'exitCode':r.returncode,'application':env['TAURI_APP_PATH']})
 (root/'existing-production-checks.json').write_text(json.dumps(results,indent=2)+'\n');print(name,r.returncode,flush=True)
 if r.returncode:raise SystemExit(r.returncode)

import subprocess,os,json,datetime,pathlib
root=pathlib.Path('/tmp/milkup-v2-phase16');results=[]
env=dict(os.environ,MILKUP_NATIVE_EXCLUSIVE_DISPLAY='1',TAURI_APP_PATH='/workspace/milkup/apps/desktop/src-tauri/target/release/milkup-desktop',MILKUP_NATIVE_X11_SCREENSHOT='1',MILKUP_VISUAL_LOADING_FIXTURE='/tmp/milkup-v2-phase13/native-scroll-batched/original.md')
for name,script in [('visual-final-build','visual-accessibility'),('states-final-build','visual-states'),('quality','quality'),('windowed-unicode','windowed-unicode'),('block-keyboard','block-keyboard'),('table-editing','table-editing'),('navigation','navigation'),('windowed-blocks','windowed-blocks'),('production-tables','production-tables')]:
 command=['node',f'tests/native/tauri-{script}.mjs'];env['MILKUP_NATIVE_EVIDENCE_DIR']=str(root/name)
 started=datetime.datetime.now(datetime.timezone.utc).isoformat()
 with open(root/(name+'.log'),'w') as log:r=subprocess.run(command,env=env,stdout=log,stderr=subprocess.STDOUT)
 results.append(dict(name=name,command=command,started=started,exitCode=r.returncode,application=env['TAURI_APP_PATH']))
 (root/'native-checks.json').write_text(json.dumps(results,indent=2)+'\n');print(name,r.returncode,flush=True)
 if r.returncode:break

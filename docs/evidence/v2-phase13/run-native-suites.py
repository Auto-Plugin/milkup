import os,subprocess,time,json
from pathlib import Path
root=Path('/tmp/milkup-v2-phase13');rows=[]
for name in ['windowed-blocks','table-editing','navigation','quality','windowed-unicode','block-keyboard']:
 env=dict(os.environ,DISPLAY=':99',MILKUP_NATIVE_EXCLUSIVE_DISPLAY='1',MILKUP_NATIVE_EVIDENCE_DIR=str(root/('native-'+name)))
 print('START',name,time.strftime('%FT%TZ',time.gmtime()),flush=True)
 with (root/('native-'+name+'.log')).open('w') as log:p=subprocess.run(['node','tests/native/tauri-'+name+'.mjs'],env=env,stdout=log,stderr=subprocess.STDOUT)
 rows.append({'suite':name,'exitCode':p.returncode});(root/'native-checks.json').write_text(json.dumps(rows,indent=2)+'\n');print('EXIT',name,p.returncode,flush=True)
 if p.returncode:raise SystemExit(p.returncode)

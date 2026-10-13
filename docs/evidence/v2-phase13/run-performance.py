import os,subprocess,json,time
from pathlib import Path
root=Path('/tmp/milkup-v2-phase13/performance-final');root.mkdir(exist_ok=True)
for label,size,width in [('175k-short',179200,64),('175k-long',179200,4096),('1m-short',1048576,64),('1m-long',1048576,4096),('10m-short',10485760,64),('10m-long',10485760,4096),('100m-short',104857600,64),('100m-long',104857600,4096)]:
 assert int(Path('/sys/fs/cgroup/memory.current').read_text())<8*1024**3
 env=dict(os.environ,DISPLAY=':99',MILKUP_NATIVE_EXCLUSIVE_DISPLAY='1',MILKUP_NATIVE_EVIDENCE_DIR=str(root/label),MILKUP_PROFILE_BYTES=str(size),MILKUP_PROFILE_LINE_BYTES=str(width))
 if label=='100m-short':env['MILKUP_PROFILE_CHECK_TAIL']='1'
 print('START',label,time.strftime('%FT%TZ',time.gmtime()),flush=True)
 with (root/(label+'.log')).open('w') as log:r=subprocess.run(['node','tests/native/tauri-window-performance.mjs'],env=env,stdout=log,stderr=subprocess.STDOUT)
 print('EXIT',label,r.returncode,flush=True)
 if r.returncode:raise SystemExit(r.returncode)
 d=json.loads((root/label/'profile.json').read_text());print('VIOLATIONS',json.dumps(d['targetViolations']),flush=True)

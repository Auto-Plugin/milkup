import os,subprocess,json,time,urllib.request
from pathlib import Path
root=Path('/tmp/milkup-v2-phase13')
env=dict(os.environ,MILKUP_NATIVE_EVIDENCE_DIR=str(root/'observer-final'))
log=(root/'observer-final.log').open('w')
server=subprocess.Popen(['node','tests/helpers/native-observer-server.mjs'],env=env,stdout=log,stderr=subprocess.STDOUT)
rows=[]
try:
 for _ in range(50):
  if server.poll() is not None:raise RuntimeError('observer server failed')
  try:
   urllib.request.urlopen('http://127.0.0.1:1420',timeout=1).close();break
  except OSError:time.sleep(.1)
 else:raise RuntimeError('observer server not ready')
 for label,size in [('small',4096),('memory',179200),('native',1100000)]:
  name='safety-'+label+'-release';case_env=dict(os.environ,DISPLAY=':99',MILKUP_FIXTURE_BYTES=str(size),MILKUP_NATIVE_EVIDENCE_DIR=str(root/name))
  print('START',name,time.strftime('%FT%TZ',time.gmtime()),flush=True)
  with (root/(name+'.log')).open('w') as out:p=subprocess.run(['python3','tests/native/x11-save-history.py'],env=case_env,stdout=out,stderr=subprocess.STDOUT)
  rows.append({'case':name,'exitCode':p.returncode});(root/'safety-checks.json').write_text(json.dumps(rows,indent=2)+'\n');print('EXIT',name,p.returncode,flush=True)
  if p.returncode:raise SystemExit(p.returncode)
finally:
 server.terminate()
 try:server.wait(timeout=5)
 except subprocess.TimeoutExpired:server.kill();server.wait(timeout=5)
 log.close()

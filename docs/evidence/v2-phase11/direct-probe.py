import os, subprocess, time, re, json
from pathlib import Path
root=Path('/tmp/milkup-v2-phase11/direct')
app='/workspace/milkup/apps/desktop/src-tauri/target/debug/milkup-desktop'
start=time.monotonic(); observations=[]
with (root/'application.log').open('w') as log:
 p=subprocess.Popen(['/workspace/.cloud/milkup-v2/run-native.sh',app,str(root/'windowed.md')],stdout=log,stderr=log,start_new_session=True)
 (root/'launcher.pid').write_text(str(p.pid))
 try:
  while time.monotonic()-start<60:
   try: tree=subprocess.check_output(['xwininfo','-root','-tree'],text=True,timeout=3)
   except subprocess.TimeoutExpired:
    observations.append({'ms':round((time.monotonic()-start)*1000),'event':'xwininfo timeout'});continue
   matches=list(re.finditer(r'(0x[0-9a-f]+) "[^"]*": \("milkup-desktop"[^\n]*',tree))
   for m in matches:
    if not observations or observations[-1].get('window')!=m[0]:
     observations.append({'ms':round((time.monotonic()-start)*1000),'window':m[0]})
    if '1100x760' in m[0]:
     window=m[1]; info=subprocess.check_output(['xwininfo','-id',window],text=True,timeout=3)
     if 'IsViewable' in info:
      result={'startupVisibleMs':round((time.monotonic()-start)*1000),'observations':observations,'window':window}
      (root/'startup.json').write_text(json.dumps(result,indent=2));print(json.dumps(result),flush=True)
      subprocess.run(['import','-window',window,str(root/'initial.png')],check=True,timeout=15)
      env={**os.environ,'MILKUP_NATIVE_EVIDENCE_DIR':str(root),'MILKUP_X11_WINDOW':window}
      result=subprocess.run(['python3','tests/native/x11-windowed-blocks.py'],env=env)
      raise SystemExit(result.returncode)
   time.sleep(.1)
  (root/'startup.json').write_text(json.dumps({'failed':'60s startup deadline','observations':observations},indent=2))
  subprocess.run(['ps','-eo','pid,ppid,stat,pcpu,comm,args'],stdout=(root/'processes.txt').open('w'))
  subprocess.run(['import','-window','root',str(root/'startup-failure.png')],timeout=15)
  raise RuntimeError('normal startup did not show within 60s')
 finally:
  # Only descendants of the launcher created by this diagnostic, in this session.
  rows=[tuple(map(int,line.split())) for line in subprocess.check_output(['ps','-eo','pid=,ppid='],text=True).splitlines()]
  children=[]
  def collect(parent):
   for pid,ppid in rows:
    if ppid==parent: collect(pid);children.append(pid)
  collect(p.pid)
  for pid in children:
   try: os.kill(pid,15)
   except ProcessLookupError: pass
  try: os.killpg(p.pid,15)
  except ProcessLookupError: pass

import subprocess,os,time,json,re
from pathlib import Path
from PIL import Image
root=Path('/tmp/milkup-v2-phase11/direct-ready');start=time.monotonic();wall=time.time()
p=subprocess.Popen(['/workspace/.cloud/milkup-v2/run-native.sh','/workspace/milkup/apps/desktop/src-tauri/target/debug/milkup-desktop',str(root/'windowed.md')],stdout=(root/'application.log').open('w'),stderr=subprocess.STDOUT)
(root/'launcher.pid').write_text(str(p.pid))
observations=[];window=None
while time.monotonic()-start<12:
 tree=subprocess.check_output(['xwininfo','-root','-tree'],text=True,timeout=3)
 m=re.search(r'(0x[0-9a-f]+) "milkup": \("milkup-desktop"[^\n]*1100x760',tree)
 if m:
  window=m[1];(root/'window.id').write_text(window)
  elapsed=round((time.monotonic()-start)*1000);shot=root/f'frame-{elapsed}.png'
  subprocess.run(['import','-window',window,str(shot)],check=True,timeout=5)
  colors=Image.open(shot).convert('RGB').getcolors(1000000)
  observations.append({'capturedMs':round((time.monotonic()-start)*1000),'file':shot.name,'distinctColors':len(colors) if colors else None})
 time.sleep(.5)
(root/'startup.json').write_text(json.dumps({'startUnix':wall,'observations':observations},indent=2))
print(json.dumps(observations),flush=True)
p.wait()

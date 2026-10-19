from pathlib import Path
import os,json,subprocess,sys,datetime
rows=[];zombies={}
for p in Path('/proc').iterdir():
 if not p.name.isdigit():continue
 try:
  raw=(p/'stat').read_text();name=raw.split('(',1)[1].rsplit(')',1)[0];fields=raw.rsplit(')',1)[1].split();command=(p/'cmdline').read_bytes().replace(b'\0',b' ').decode(errors='replace')
  if not any(x in name.lower() for x in ['milkup-desktop','tauri-driver','webkitwebdriver','xvfb','webprocess','networkprocess']):continue
  if fields[0]=='Z':zombies[name]=zombies.get(name,0)+1;continue
  env={}
  try: environment=(p/'environ').read_bytes().split(b'\0')
  except (PermissionError,FileNotFoundError) as e: environment=[];env['observationError']=type(e).__name__
  for item in environment:
   key,_,value=item.partition(b'=')
   if key in [b'DISPLAY',b'XDG_RUNTIME_DIR',b'XDG_CONFIG_HOME',b'MILKUP_NATIVE_RUN']:env[key.decode()]=value.decode(errors='replace')
  rows.append({'pid':int(p.name),'birth':fields[19],'pgid':os.getpgid(int(p.name)),'state':fields[0],'name':name,'command':command,'scopeEnvironment':env})
 except (FileNotFoundError,ProcessLookupError,PermissionError):pass
xdotool='/workspace/.cloud/milkup-v2/sysroot/usr/bin/xdotool';env=dict(os.environ,DISPLAY=':127')
def cmd(args):
 r=subprocess.run([xdotool,*args],env=env,text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=3);return {'args':args,'exitCode':r.returncode,'stdout':r.stdout,'stderr':r.stderr}
result={'observedUtc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'liveNativeProcesses':rows,'zombieCounts':zombies,'focusedWindow':cmd(['getwindowfocus']),'visibleMilkUpWindows':cmd(['search','--onlyvisible','--class','milkup-desktop']),'note':'Read-only between runs; no process terminated. Zombie count is not running and not fully reaped.'}
Path(sys.argv[1]).write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result,indent=2))

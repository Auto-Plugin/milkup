import os,subprocess,pathlib,time,json,signal
root=pathlib.Path(__file__).parent
for path in pathlib.Path('/proc').glob('[0-9]*/cmdline'):
 try:
  args=path.read_bytes().split(b'\0')
  if args and pathlib.Path(os.fsdecode(args[0])).name=='Xvfb' and b':127' in args:raise RuntimeError('Display 127 is already owned')
 except (FileNotFoundError,PermissionError):pass
assert not pathlib.Path('/tmp/.X127-lock').exists()
with open(root/'xvfb-127.log','w') as log:
 child=subprocess.Popen(['/workspace/.cloud/milkup-v2/sysroot/usr/bin/Xvfb',':127','-screen','0','1600x1000x24','-nolisten','tcp'],stdout=log,stderr=log,start_new_session=True)
 def birth():return pathlib.Path('/proc/'+str(child.pid)+'/stat').read_text().split(') ',1)[1].split()[19]
 identity=birth();(root/'xvfb-127.json').write_text(json.dumps({'pid':child.pid,'birth':identity,'display':':127'}))
 try:
  env=os.environ.copy();env['DISPLAY']=':127'
  for key,sub in [('XDG_CONFIG_HOME','config'),('XDG_CACHE_HOME','cache'),('XDG_DATA_HOME','data')]:
   directory=root/'profile'/sub;directory.mkdir(parents=True,exist_ok=True);env[key]=str(directory)
  for _ in range(50):
   if child.poll() is not None:raise RuntimeError('Xvfb stopped')
   test=subprocess.run(['xdpyinfo','-display',':127'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,env=env)
   if test.returncode==0:break
   time.sleep(.1)
  else:raise RuntimeError('Xvfb not ready')
  completed=subprocess.run(['python3',str(root/'run-pair.py')],env=env)
  assert completed.returncode==0
 finally:
  if child.poll() is None and birth()==identity:child.terminate()
  child.wait(timeout=5)
  (root/'xvfb-127-cleanup.json').write_text(json.dumps({'pid':child.pid,'birth':identity,'exit':child.returncode,'ownedProcessExited':True}))

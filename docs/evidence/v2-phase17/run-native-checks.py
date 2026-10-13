import subprocess,os,json,pathlib,time,socket,datetime,signal
root=pathlib.Path('/tmp/milkup-v2-phase17');results=json.loads((root/'native-checks.json').read_text())
suites=['quality','windowed-unicode','block-keyboard','table-editing','navigation','windowed-blocks','production-tables','production-search','production-search-large']
for name in suites:
 if any(r['name']==name and r['exitCode']==0 for r in results):continue
 attempt=1+sum(r['name']==name for r in results)
 suffix='' if attempt==1 else f'-attempt{attempt}'
 out=root/('regression-'+name+suffix);out.mkdir(exist_ok=True)
 profile=root/('regression-runtime-'+name+suffix);(profile/'tmp').mkdir(parents=True,exist_ok=True)
 log=open(out/'driver.log','w')
 driver=subprocess.Popen(['/workspace/.cloud/milkup-v2/run-native.sh','env',f'XDG_DATA_HOME={profile}/data',f'TMPDIR={profile}/tmp','/workspace/.cargo/bin/tauri-driver','--port','4444','--native-port','9515','--native-driver','/workspace/.cloud/milkup-v2/sysroot/usr/bin/WebKitWebDriver'],stdout=log,stderr=subprocess.STDOUT,env={**os.environ,'DISPLAY':':99'})
 try:
  deadline=time.monotonic()+5
  while True:
   try:
    with socket.create_connection(('127.0.0.1',4444),timeout=.2):break
   except OSError:
    if time.monotonic()>deadline:raise RuntimeError('driver did not bind')
    time.sleep(.1)
  env={**os.environ,'TAURI_APP_PATH':'/workspace/milkup/apps/desktop/src-tauri/target/release/milkup-desktop','MILKUP_NATIVE_EXCLUSIVE_DISPLAY':'1','MILKUP_NATIVE_EVIDENCE_DIR':str(out)}
  if name=='production-search-large':env.update({'MILKUP_PRODUCTION_CASE':'large','MILKUP_SEARCH_FIXTURE':'/tmp/milkup-v2-phase13/native-scroll-batched/original.md'})
  script='production-search' if name=='production-search-large' else name
  command=['node',f'tests/native/tauri-{script}.mjs'];started=datetime.datetime.now(datetime.timezone.utc).isoformat()
  with open(out/'run.log','w') as f:r=subprocess.run(command,env=env,stdout=f,stderr=subprocess.STDOUT)
  results.append({'name':name,'command':command,'started':started,'exitCode':r.returncode,'profile':str(profile),'output':str(out)})
  (root/'native-checks.json').write_text(json.dumps(results,indent=2))
  print(name,r.returncode,flush=True)
  if r.returncode:break
 finally:
  # Signal the actual driver descendant, not the proot wrapper (which does not forward SIGTERM).
  for cmdline in pathlib.Path('/proc').glob('[0-9]*/cmdline'):
   try:
    argv=cmdline.read_bytes().split(b'\0')
    if argv[0]!=b'/workspace/.cargo/bin/tauri-driver':continue
    pid=int(cmdline.parent.name);ancestor=pid
    for _ in range(8):
     status=pathlib.Path(f'/proc/{ancestor}/status').read_text()
     ancestor=int(next(line.split()[1] for line in status.splitlines() if line.startswith('PPid:')))
     if ancestor==driver.pid:os.kill(pid,signal.SIGTERM);break
     if ancestor<=1:break
   except (FileNotFoundError,ProcessLookupError):pass
  try:driver.wait(timeout=5)
  except subprocess.TimeoutExpired:raise RuntimeError('owned driver did not exit after SIGTERM')
  log.close()

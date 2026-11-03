# Run the entire native test in one temporary mount/PID namespace, so X11
# _NET_WM_PID and /proc refer to the same owned process identities.
import argparse, hashlib, json, os, pathlib, shutil, signal, subprocess, sys, tempfile, time, urllib.request
parser=argparse.ArgumentParser()
parser.add_argument('--binary',required=True)
parser.add_argument('--sha256',required=True)
parser.add_argument('--archive',required=True)
args=parser.parse_args()
archive=pathlib.Path(args.archive)
if archive.exists():raise RuntimeError('Evidence archive already exists')
root=pathlib.Path(tempfile.mkdtemp(prefix='milkup-mermaid-normal-close-',dir='/tmp'))
for name in ['config','cache','data','runtime','evidence','binary','native-tmp']:(root/name).mkdir(mode=0o700)
source=pathlib.Path(args.binary)
body=source.read_bytes()
if hashlib.sha256(body).hexdigest()!=args.sha256:raise RuntimeError('Candidate binary SHA mismatch')
binary=root/'binary/milkup-desktop'
with binary.open('xb') as out:out.write(body)
binary.chmod(0o700)
(root/'binary.json').write_text(json.dumps({'source':str(source),'binary':str(binary),'sha256':args.sha256,'bytes':len(body),'buildProfile':'debug','buildFeatures':['tauri/custom-protocol']},indent=2)+'\n')
del body
env=dict(os.environ)
values={'DISPLAY':':144','TAURI_DRIVER_URL':'http://127.0.0.1:4450','MILKUP_NATIVE_EXCLUSIVE_DISPLAY':'1','MILKUP_NATIVE_MERMAID_PRIVATE_RUN':'1','MILKUP_NATIVE_PROFILE_ROOT':str(root),'MILKUP_NATIVE_DRIVER_ENV_RECORD':str(root/'driver-env.json'),'MILKUP_NATIVE_EVIDENCE_DIR':str(root/'evidence'),'XDG_CONFIG_HOME':str(root/'config'),'XDG_CACHE_HOME':str(root/'cache'),'XDG_DATA_HOME':str(root/'data'),'XDG_RUNTIME_DIR':str(root/'runtime'),'TAURI_APP_PATH':str(binary),'MILKUP_NATIVE_EXPECTED_BINARY_SHA256':args.sha256}
launcher=root/'binary/observe-launch.py'
shutil.copy2('/workspace/mermaid-rebuild-evidence/linux-close-0e3912db/normal-close-reproduction/observe-launch.py',launcher)
launcher.chmod(0o700)
values.update({'TAURI_APP_PATH':str(launcher),'MILKUP_NORMAL_CLOSE_RUN':'1','MILKUP_OBSERVED_BINARY':str(binary),'MILKUP_OBSERVED_SHA256':args.sha256,'MILKUP_OBSERVED_START_RECORD':str(root/'evidence/launcher-start.json'),'MILKUP_OBSERVED_EXIT_RECORD':str(root/'evidence/launcher-exit.json'),'MILKUP_OBSERVED_APP_LOG':str(root/'evidence/application.log'),'MILKUP_NATIVE_TEMP_ROOT':str(root/'native-tmp'),'TMPDIR':str(root/'native-tmp'),'MILKUP_MERMAID_DIAGNOSTICS':'1','MILKUP_DOM_DIAGNOSTICS':'1'})
env.update(values)
record={'environment':{k:values[k] for k in ['DISPLAY','XDG_CONFIG_HOME','XDG_CACHE_HOME','XDG_DATA_HOME','XDG_RUNTIME_DIR']},'driverPort':4450,'nativePort':4451,'createdAt':time.time(),'mountWrapper':'/workspace/mermaid-rebuild-evidence/run-native-mounted.sh','pidNamespace':'display,driver,harness,application share outer test namespace; WebKit retains its own sandbox'}
(root/'driver-env.json').write_text(json.dumps(record,indent=2)+'\n')
(root/'env.sh').write_text('source /workspace/mermaid-rebuild-evidence/dependency-env.sh\n'+''.join("export %s='%s'\n"%(k,v) for k,v in values.items()))
children=[]
exitcode=1

def birth(pid):
    text=pathlib.Path('/proc/%d/stat'%pid).read_text()
    return text[text.rfind(')')+2:].split()[19]
def launch(argv,log):
    output=open(root/log,'wb')
    p=subprocess.Popen(argv,env=env,stdout=output,stderr=subprocess.STDOUT,start_new_session=True,cwd='/workspace/milkup-mermaid-rebuild')
    child={'process':p,'pid':p.pid,'birth':birth(p.pid),'argv':argv,'output':output};children.append(child)
    return p
try:
    if pathlib.Path('/tmp/.X144-lock').exists() or pathlib.Path('/tmp/.X11-unix/X144').exists():raise RuntimeError('Dedicated :144 already owned')
    xvfb=launch(['Xvfb',':144','-screen','0','1440x1000x24','-nolisten','tcp'],'xvfb.log')
    for attempt in range(100):
        if xvfb.poll() is not None:raise RuntimeError('Owned Xvfb exited')
        ready=subprocess.run(['xwininfo','-root'],env=env,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL).returncode==0
        if ready:break
        time.sleep(.05)
    if not ready:raise RuntimeError('Display readiness timeout')
    xfconf=launch(['/usr/host/lib/x86_64-linux-gnu/xfce4/xfconf/xfconfd'],'xfconfd.log')
    wm=launch(['/usr/bin/xfwm4','--compositor=off','--sm-client-disable'],'xfwm4.log')
    for attempt in range(100):
        if wm.poll() is not None:raise RuntimeError('Owned window manager exited')
        observed=subprocess.run(['xprop','-root','_NET_SUPPORTING_WM_CHECK'],env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
        if 'window id # 0x' in observed.stdout:break
        time.sleep(.05)
    else:raise RuntimeError('Window manager readiness timeout')
    sampler=launch(['python3','/workspace/mermaid-rebuild-evidence/linux-close-0e3912db/normal-close-reproduction/observe-x11.py'],'x11-observer.log')
    driver=launch(['tauri-driver','--port','4450','--native-port','4451','--native-host','127.0.0.1','--native-driver','/workspace/.cloud/milkup-v2/sysroot/usr/bin/WebKitWebDriver'],'driver.log')
    for attempt in range(100):
        if driver.poll() is not None:raise RuntimeError('Owned driver exited')
        try:
            with urllib.request.urlopen('http://127.0.0.1:4450/status',timeout=.3) as response:status=json.load(response)
            break
        except Exception:time.sleep(.1)
    else:raise RuntimeError('Driver readiness timeout')
    record.update({'root':str(root),'state':'ready','owned':[{'pid':c['pid'],'birth':c['birth'],'argv':c['argv']} for c in children],'status':status})
    (root/'session.json').write_text(json.dumps(record,indent=2)+'\n')
    print(json.dumps({'state':'ready','root':str(root),'ownedPids':[c['pid'] for c in children],'binarySha256':args.sha256}),flush=True)
    run=subprocess.run(['node','/workspace/mermaid-rebuild-evidence/linux-close-0e3912db/normal-close-reproduction/normal-close-focus.mjs'],env=env,cwd='/workspace/milkup-mermaid-rebuild',stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True,timeout=180)
    (root/'harness.log').write_text(run.stdout)
    print(run.stdout,flush=True)
    exitcode=run.returncode
    # Let the read-only sampler finish normally before tearing down its group.
    sampler.wait(timeout=5)
    observation=json.loads((root/'evidence/x11-observation-summary.json').read_text())
    if sampler.returncode != 0 or observation['overflow'] or not observation['stoppedByHarness'] or observation['retainedSamples'] < 2:
        raise RuntimeError('Focus observation incomplete or sampler did not exit naturally')
except Exception as error:
    (root/'orchestration-error.json').write_text(json.dumps({'error':str(error),'type':type(error).__name__},indent=2)+'\n')
    print(str(error),file=sys.stderr,flush=True)
finally:
    results=[]
    for c in reversed(children):
        p=c['process'];item={'pid':p.pid,'birth':c['birth']}
        if p.poll() is None:
            try:
                if birth(p.pid)!=c['birth']:raise RuntimeError('Process birth changed; not signalling')
                os.killpg(p.pid,signal.SIGTERM)
                try:p.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    if birth(p.pid)!=c['birth']:raise RuntimeError('Process birth changed; not signalling')
                    os.killpg(p.pid,signal.SIGKILL);p.wait(timeout=5)
            except Exception as error:item['error']=str(error);exitcode=1
        item['exitCode']=p.poll();results.append(item);c['output'].close()
    (root/'session-cleanup.json').write_text(json.dumps(results,indent=2)+'\n')
    archive.mkdir(parents=True,exist_ok=False)
    for name in ['driver-env.json','session.json','session-cleanup.json','binary.json','driver.log','xvfb.log','xfwm4.log','xfconfd.log','x11-observer.log','harness.log','orchestration-error.json']:
        if (root/name).exists():shutil.copy2(root/name,archive/name)
    shutil.copytree(root/'evidence',archive/'evidence')
    (archive/'run.json').write_text(json.dumps({'root':str(root),'exitCode':exitcode,'binarySha256':args.sha256,'archivedBinary':False,'cleanup':results},indent=2)+'\n')
    print(json.dumps({'state':'closed','root':str(root),'archive':str(archive),'exitCode':exitcode,'cleanup':results}),flush=True)
sys.exit(exitcode)

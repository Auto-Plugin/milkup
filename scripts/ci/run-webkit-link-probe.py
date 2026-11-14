#!/usr/bin/env python3
"""Bounded sandboxed engine-only print proof, no application install or system mutation."""
import argparse, hashlib, json, os, pathlib, shlex, subprocess, time, tempfile, socket
p=argparse.ArgumentParser();p.add_argument('mode',choices=['baseline','verify']);p.add_argument('out',type=pathlib.Path);p.add_argument('--prefix',type=pathlib.Path);p.add_argument('--manifest',type=pathlib.Path);a=p.parse_args()
assert os.getuid()!=0 and not os.environ.get('WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS')
repo=pathlib.Path(__file__).resolve().parents[2];research=repo/'research/linux-pdf-links-20261114'
a.out=a.out.resolve();a.out.mkdir(parents=True,exist_ok=False)
env=os.environ.copy();env.pop('LD_LIBRARY_PATH',None);env.pop('PKG_CONFIG_PATH',None)
for key in ['DATA','CONFIG','CACHE','STATE']:
    directory=a.out/('xdg-'+key.lower());directory.mkdir(mode=0o700);env['XDG_'+key+'_HOME']=str(directory)
# The sandbox DBus proxy uses an AF_UNIX pathname under XDG_RUNTIME_DIR.
# Deep evidence paths exceed Linux sun_path; use only our own short 0700 root.
runtime=tempfile.TemporaryDirectory(prefix='mkl-',dir='/tmp')
env['XDG_RUNTIME_DIR']=runtime.name
socket_directory=pathlib.Path(runtime.name)/'webkitgtk';socket_directory.mkdir(mode=0o700)
socket_path=socket_directory/'bus-proxy-PREFLT'
assert len(str(socket_path).encode())<=107
with socket.socket(socket.AF_UNIX) as test_socket:test_socket.bind(str(socket_path))
socket_path.unlink()
expected={}
if a.mode=='verify':
    assert a.prefix and a.manifest
    m=json.loads(a.manifest.read_text());assert m['status']=='private-runtime-built-not-accepted'
    assert pathlib.Path(m['prefix']).resolve()==a.prefix.resolve()
    for row in m['runtimeFiles']:
        if pathlib.Path(row['path']).name.startswith(('libwebkit2gtk-4.1.so.','libjavascriptcoregtk-4.1.so.')):
            file=(a.prefix/row['path']).resolve();assert hashlib.sha256(file.read_bytes()).hexdigest()==row['sha256'];expected[str(file)]=row['sha256']
    assert len(expected)==2
    env['LD_LIBRARY_PATH']=str(a.prefix/'lib/x86_64-linux-gnu')
else:assert not a.prefix and not a.manifest
flags=shlex.split(subprocess.check_output(['pkg-config','--cflags','--libs','webkit2gtk-4.1','gtk+-3.0'],text=True))
binary=a.out/'print-probe'
subprocess.run(['cc','-Wall','-Wextra','-Werror','-Wno-deprecated-declarations',str(research/'print-probe.c'),'-o',str(binary),*flags],check=True,timeout=60)
subprocess.run(['python3',str(research/'pdf_links.py'),'fixtures',str(a.out)],check=True)
report={'status':'running','mode':a.mode,'uid':os.getuid(),'harnessSha':os.environ.get('GITHUB_SHA'),'runtimeDirectory':runtime.name,'runtimeSocketBindPreflight':True,'expectedPrivateLibraries':expected,'runs':[],'scope':'GTK WebKit print engine, not installed Milkup or physical printer'}
def persist():(a.out/'native-result.json').write_text(json.dumps(report,indent=2))
def final_runtime_check(expected):
    rows=[]
    for file,digest in expected.items():
        row={'path':file,'expectedSha256':digest}
        try:
            row['actualSha256']=hashlib.sha256(pathlib.Path(file).read_bytes()).hexdigest()
            row['status']='passed' if row['actualSha256']==digest else 'failed'
        except OSError as error:row.update(status='failed',error=str(error))
        rows.append(row)
    return {'status':('passed' if all(r['status']=='passed' for r in rows) else 'failed') if rows else 'not-applicable-system-baseline','files':rows}
try:
    for name in ['links','no-links']:
        maps=a.out/(name+'-main.maps');cmd=['timeout','--signal=TERM','--kill-after=5s','55s','xvfb-run','-a','dbus-run-session','--',str(binary),str(a.out/(name+'.html')),str(a.out/(name+'.pdf')),str(maps)]
        at=time.monotonic()
        with (a.out/(name+'.log')).open('w') as log:
            proc=subprocess.Popen(cmd,env=env,stdout=log,stderr=subprocess.STDOUT)
            children={}
            while proc.poll() is None:
                assert time.monotonic()-at<65, 'Outer print deadline'
                # Capture actual WebKit child identity and mappings while alive.
                stats={}
                for path in pathlib.Path('/proc').glob('[0-9]*/stat'):
                    try:
                        fields=path.read_text().rsplit(') ',1)[1].split();stats[int(path.parent.name)]=(int(fields[1]),fields[19])
                    except (FileNotFoundError,ProcessLookupError,PermissionError):pass
                owned={proc.pid}
                for _ in range(10):
                    more={pid for pid,(ppid,birth) in stats.items() if ppid in owned};new=owned|more
                    if new==owned:break
                    owned=new
                for pid in owned-{proc.pid}:
                    try:
                        process=pathlib.Path('/proc')/str(pid);image=str((process/'exe').resolve(strict=True))
                        if pathlib.Path(image).name!='WebKitWebProcess':continue
                        identity=(pid,stats[pid][1])
                        if identity in children:continue
                        content=(process/'maps').read_text()
                        if not all(file in content for file in expected):continue
                        if expected and not pathlib.Path(image).is_relative_to(a.prefix.resolve()):continue
                        # Re-read generation after sampling, no PID-only association.
                        assert (process/'stat').read_text().rsplit(') ',1)[1].split()[19]==identity[1]
                        file=name+'-webprocess-'+str(pid)+'.maps';(a.out/file).write_text(content)
                        children[identity]={'pid':pid,'startTicks':identity[1],'image':image,'maps':file}
                    except (FileNotFoundError,ProcessLookupError,PermissionError):pass
                time.sleep(.05)
            code=proc.wait(timeout=1)
        row={'name':name,'exitCode':code,'seconds':round(time.monotonic()-at,3),'libraryMaps':maps.name,'webProcesses':list(children.values())};report['runs'].append(row);persist()
        assert code==0, 'Bounded native print failed'
        assert 'SANDBOX_ENABLED' in (a.out/(name+'.log')).read_text()
        actual=maps.read_text()
        if expected:
            assert children, 'Actual private WebKit web-process mapping proof required'
            for file in expected:assert file in actual, 'Private print host library mapping missing'
            for line in actual.splitlines():
                if 'libwebkit2gtk-4.1.so.' in line or 'libjavascriptcoregtk-4.1.so.' in line:assert any(line.endswith(file) for file in expected), 'Mixed runtime mapping'
    if a.mode=='verify':
        # Persist both controls and all source-token diagnostics before the
        # fail-closed acceptance assertion; the diagnostic is never a pass gate.
        subprocess.run(['python3',str(research/'audit_existing.py'),str(a.out),'--out',str(a.out/'independent-checks.json')],check=True,timeout=60)
    subprocess.run(['python3',str(research/'pdf_links.py'),a.mode,str(a.out)],check=True,timeout=60)
    report['status']='passed'
except Exception as e:report['status']='failed';report['error']=str(e)
finally:
    report['privateRuntimeFinalCheck']=final_runtime_check(expected)
    if report['privateRuntimeFinalCheck']['status']=='failed':report['status']='failed'
    persist();runtime.cleanup()
if report['status']!='passed':raise SystemExit(1)

#!/usr/bin/env python3
"""Build a research WebKit in a normal-user private prefix; never system install."""
import hashlib,json,os,pathlib,re,signal,subprocess,time,shutil
root=pathlib.Path(os.environ['RUNNER_TEMP'])/'milkup-webkit-research';evidence=root/'evidence';source=root/'source';build=root/'build';prefix=root/'prefix';conf=root/'apt.conf'
probe=json.loads((evidence/'result.json').read_text());assert probe['status']=='probe-complete'
assert os.getuid()!=0 and not probe['simulatedRemovals'] and not probe['wouldChangeWebKitPackages'] and probe['buildDependencySimulationSucceeded']
version=probe['sourceVersionRequested'];report={'status':'running','uid':os.getuid(),'sourceVersion':version,'prefix':str(prefix),'harnessSha':os.environ['GITHUB_SHA'],'steps':[],'samples':[],'engineBuildAttempted':False}
def persist(): (evidence/'build-result.json').write_text(json.dumps(report,indent=2)+'\n')
def run(name,args,timeout=900,env=None):
 report['stage']=name;persist();print('STAGE',name,flush=True);at=time.monotonic()
 with (evidence/(name+'.log')).open('w')as f:p=subprocess.run(args,stdout=f,stderr=subprocess.STDOUT,text=True,timeout=timeout,env=env,cwd=root)
 report['steps'].append({'name':name,'args':args,'exitCode':p.returncode,'seconds':round(time.monotonic()-at,3)});persist()
 if p.returncode:
  print((evidence/(name+'.log')).read_text()[-12000:],flush=True);raise RuntimeError(f'{name} failed: {p.returncode}')
def system_libraries():
 return {str(p):hashlib.sha256(p.read_bytes()).hexdigest()for pattern in ['libwebkit2gtk-4.1.so.*','libjavascriptcoregtk-4.1.so.*']for p in pathlib.Path('/usr/lib/x86_64-linux-gnu').glob(pattern)if p.is_file()and not p.is_symlink()}
try:
 run('install-official-build-deps',['sudo','apt-get','-c',str(conf),'-y','--no-install-recommends','--no-remove','build-dep',f'webkit2gtk={version}'],timeout=1200)
 run('install-official-gui-baseline',['sudo','apt-get','-c',str(conf),'-y','--no-install-recommends','--no-remove','install',f'libwebkit2gtk-4.1-dev={version}',f'webkitgtk-webdriver={version}','xdotool','x11-utils','poppler-utils','fonts-noto-cjk','fonts-noto-color-emoji','fonts-dejavu-core','xvfb','xauth'],timeout=900)
 report['systemLibrariesBefore']=system_libraries();assert len(report['systemLibrariesBefore'])==2;persist()
 patch=pathlib.Path(os.environ['GITHUB_WORKSPACE'])/'research/linux-pdf-unicode-20261114/0002-research-only-scalar-source-to-skia.patch'
 report['patchSha256']=hashlib.sha256(patch.read_bytes()).hexdigest()
 run('apply-research-patch',['git','-C',str(source),'apply',str(patch)])
 report['patchedSourceHashes']={str(p.relative_to(source)):hashlib.sha256(p.read_bytes()).hexdigest()for p in source.glob('Source/WebCore/platform/graphics/**/*')if p.is_file()and p.name in ['ScalarGlyphText.h','FontCascade.cpp','FontSkia.cpp','GraphicsContextSkia.cpp','DisplayListRecorderImpl.cpp']};persist()
 # Match distro hardening and GTK3 choices; debug symbols are limited to -g1 as
 # in debian/rules. No JIT, sandbox or security policy is disabled.
 flag_env={**os.environ,'DEB_BUILD_MAINT_OPTIONS':'hardening=+all optimize=-lto'}
 def flags(kind):
  s=subprocess.check_output(['dpkg-buildflags','--get',kind],env=flag_env,text=True).strip()
  return re.sub(r'(?<!\S)-g(?!\S)','-g1',s)
 cpp=flags('CPPFLAGS')+' -DNDEBUG -DG_DISABLE_CAST_CHECKS';ld=flags('LDFLAGS')+' -Wl,--reduce-memory-overheads'
 args=['cmake','-S',str(source),'-B',str(build),'-GNinja','-DPORT=GTK','-DUSE_GTK4=OFF','-DCMAKE_BUILD_TYPE=Release','-DCMAKE_C_COMPILER=clang','-DCMAKE_CXX_COMPILER=clang++','-DCMAKE_C_FLAGS_RELEASE=','-DCMAKE_CXX_FLAGS_RELEASE=',f'-DCMAKE_C_FLAGS={flags("CFLAGS")} {cpp}',f'-DCMAKE_CXX_FLAGS={flags("CXXFLAGS")} {cpp}',f'-DCMAKE_EXE_LINKER_FLAGS={ld}',f'-DCMAKE_SHARED_LINKER_FLAGS={ld}',f'-DCMAKE_INSTALL_PREFIX={prefix}','-DCMAKE_INSTALL_LIBDIR=lib/x86_64-linux-gnu','-DCMAKE_INSTALL_LIBEXECDIR=lib/x86_64-linux-gnu',f'-DCMAKE_INSTALL_RPATH={prefix}/lib/x86_64-linux-gnu','-DCMAKE_BUILD_WITH_INSTALL_RPATH=ON','-DUSE_LIBBACKTRACE=OFF','-DUSE_SYSPROF_CAPTURE=ON','-DENABLE_DOCUMENTATION=OFF','-DENABLE_BUBBLEWRAP_SANDBOX=ON','-DUSER_AGENT_BRANDING=Ubuntu','-DUSE_AVIF=OFF','-DENABLE_SPEECH_SYNTHESIS=OFF','-DENABLE_GAMEPAD=OFF','-DUSE_LD_LLD=OFF','-DCMAKE_EXPORT_COMPILE_COMMANDS=ON']
 report['configureArgs']=args;run('configure-private-gtk3',args,timeout=900)
 shutil.copyfile(build/'CMakeCache.txt',evidence/'CMakeCache.txt')
 cache=(build/'CMakeCache.txt').read_text();assert re.search(r'^ENABLE_BUBBLEWRAP_SANDBOX:BOOL=ON$',cache,re.M)and re.search(r'^USE_GTK4:BOOL=OFF$',cache,re.M)
 report['compileCommands']=len(json.loads((build/'compile_commands.json').read_text()))
 report['engineBuildAttempted']=True;report['stage']='compile-engine';persist()
 started=time.monotonic();reason=None;low_mem=0
 # Run 43561713531 reached 8395/9449 steps at the unchanged 150-minute
 # boundary with two jobs; minimum available RAM was 9.52 GiB. Use one more
 # compiler on this measured four-core host, keeping all stop reserves.
 assert (os.cpu_count() or 0)>=4, 'Measured four-core build capability required'
 report['compileParallelism']=3
 report['capacityBaselineRun']=43561713531
 args=['/usr/bin/time','-v','-o',str(evidence/'build-time.txt'),'cmake','--build',str(build),'--parallel','3']
 with (evidence/'compile-engine.log').open('w')as f:
  proc=subprocess.Popen(args,stdout=f,stderr=subprocess.STDOUT,start_new_session=True)
  while proc.poll()is None:
   mem=dict((k,v.strip())for k,v in (line.split(':',1)for line in pathlib.Path('/proc/meminfo').read_text().splitlines()))
   available=int(mem['MemAvailable'].split()[0])*1024;free=shutil.disk_usage(root).free;elapsed=time.monotonic()-started
   low_mem=low_mem+1 if available<512*1024**2 else 0
   log=build/'.ninja_log';completed=max(0,len(log.read_text().splitlines())-1)if log.exists()else 0
   sample={'elapsedSeconds':round(elapsed),'diskFreeBytes':free,'memoryAvailableBytes':available,'ninjaRecords':completed};report['samples'].append(sample);persist();print('BUILD_PROGRESS',json.dumps(sample),flush=True)
   if free<4*1024**3:reason='disk reserve below 4 GiB'
   elif low_mem>=3:reason='MemAvailable below 512 MiB for 60 seconds'
   elif elapsed>=150*60:reason='bounded 150-minute compile budget reached'
   if reason:
    os.killpg(proc.pid,signal.SIGTERM)
    try:proc.wait(timeout=15)
    except subprocess.TimeoutExpired:os.killpg(proc.pid,signal.SIGKILL);proc.wait()
    break
   time.sleep(20)
  code=proc.wait()
 report['compileExitCode']=code;report['compileSeconds']=round(time.monotonic()-started,3);report['resourceStopReason']=reason;persist()
 if code or reason:
  print((evidence/'compile-engine.log').read_text()[-16000:],flush=True);raise RuntimeError(reason or f'engine compilation failed with code {code}')
 run('install-private-prefix',['cmake','--install',str(build)],timeout=900)
 installed=(build/'install_manifest.txt').read_text().splitlines();assert installed and all(pathlib.Path(p).is_relative_to(prefix)for p in installed)
 shutil.copyfile(build/'install_manifest.txt',evidence/'install_manifest.txt')
 outputs=[p for p in prefix.rglob('*')if p.is_file()and not p.is_symlink()and ('.so' in p.name or p.name in ['WebKitWebProcess','WebKitNetworkProcess','WebKitGPUProcess','WebKitWebDriver'])]
 report['runtimeFiles']=[{'path':str(p.relative_to(prefix)),'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()}for p in outputs]
 assert any('libwebkit2gtk-4.1.so.'in f['path']for f in report['runtimeFiles'])
 report['systemLibrariesAfter']=system_libraries();assert report['systemLibrariesAfter']==report['systemLibrariesBefore']
 report['status']='private-runtime-built-not-accepted';persist()
except Exception as e:
 report['status']='blocked';report['error']=str(e);persist();print('BLOCKED',str(e),flush=True)
finally:
 if build.exists():
  report['buildDirectoryBytes']=int(subprocess.check_output(['du','-sb',str(build)],text=True).split()[0])
  for name in ['CMakeCache.txt','.ninja_log']:
   if (build/name).exists():shutil.copyfile(build/name,evidence/name.lstrip('.'))
 report['finalDiskFreeBytes']=shutil.disk_usage(root).free;persist()
if report['status']!='private-runtime-built-not-accepted':raise SystemExit(1)

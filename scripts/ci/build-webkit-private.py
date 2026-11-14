#!/usr/bin/env python3
"""Build a research WebKit in a normal-user private prefix; never system install."""
import hashlib,json,os,pathlib,re,signal,subprocess,time,shutil
from webkit_build_limits import compile_budget, stop_reason
operation_started=float(os.environ["MILKUP_RESEARCH_START_EPOCH"])
operation=os.environ['MILKUP_WEBKIT_OPERATION'];assert operation in ['preflight','resume']
links=os.environ.get('MILKUP_WEBKIT_LINKS')=='true'
root=pathlib.Path(os.environ['RUNNER_TEMP'])/'milkup-webkit-research';evidence=root/'evidence';source=root/'source';build=root/'build';prefix=root/'prefix';conf=root/'apt.conf'
probe=json.loads((evidence/'result.json').read_text());assert probe['status']=='probe-complete'
assert os.getuid()!=0 and not probe['simulatedRemovals'] and not probe['wouldChangeWebKitPackages'] and probe['buildDependencySimulationSucceeded']
version=probe['sourceVersionRequested'];report={'status':'running','uid':os.getuid(),'sourceVersion':version,'prefix':str(prefix),'harnessSha':os.environ['GITHUB_SHA'],'steps':[],'samples':[],'engineBuildAttempted':False,'fullEngineBuildAttempted':False,'linksResearch':links}
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
 run('install-official-gui-baseline',['sudo','apt-get','-c',str(conf),'-y','--no-install-recommends','--no-remove','install',f'libwebkit2gtk-4.1-dev={version}',f'webkitgtk-webdriver={version}','ccache','xdotool','x11-utils','poppler-utils','fonts-noto-cjk','fonts-noto-color-emoji','fonts-dejavu-core','xvfb','xauth','python3-pypdf'],timeout=900)
 run('configure-bounded-compiler-cache',['ccache','--max-size','2G'])
 report['compilerCacheDirectory']=os.environ['CCACHE_DIR'];report['cacheScope']='Compiler objects only, not private runtime or application data'
 report['systemLibrariesBefore']=system_libraries();assert len(report['systemLibrariesBefore'])==2;persist()
 patch=pathlib.Path(os.environ['GITHUB_WORKSPACE'])/'research/linux-pdf-unicode-20261114/0002-research-only-scalar-source-to-skia.patch'
 report['patchSha256']=hashlib.sha256(patch.read_bytes()).hexdigest()
 run('apply-research-patch',['git','-C',str(source),'apply',str(patch)])
 registration=patch.with_name('0003-register-scalar-private-header.patch')
 report['headerRegistrationPatchSha256']=hashlib.sha256(registration.read_bytes()).hexdigest()
 run('apply-header-registration',['git','-C',str(source),'apply',str(registration)])
 if links:
  run('links-cheap-preflight',['python3',str(pathlib.Path(os.environ['GITHUB_WORKSPACE'])/'scripts/ci/webkit-links-preflight.py'),'--source',str(source),'--output',str(evidence/'links-preflight')],timeout=120)
  link_patch=pathlib.Path(os.environ['GITHUB_WORKSPACE'])/'research/linux-pdf-links-20261114/0001-research-skia-uri-annotations.patch'
  report['linkPatchSha256']=hashlib.sha256(link_patch.read_bytes()).hexdigest()
  run('apply-links-research',['git','-C',str(source),'apply',str(link_patch)])
  if operation=='preflight':
   run('links-system-baseline',['python3',str(pathlib.Path(os.environ['GITHUB_WORKSPACE'])/'scripts/ci/run-webkit-link-probe.py'),'baseline',str(evidence/'links-baseline')],timeout=180)
 run('header-forwarding-preflight',['python3',str(pathlib.Path(os.environ['GITHUB_WORKSPACE'])/'scripts/ci/webkit-header-preflight.py'),'--source',str(source),'--output',str(evidence/'header-preflight')],timeout=300)
 report['patchedSourceHashes']={str(p.relative_to(source)):hashlib.sha256(p.read_bytes()).hexdigest()for p in source.glob('Source/WebCore/platform/graphics/**/*')if p.is_file()and p.name in ['ScalarGlyphText.h','FontCascade.cpp','FontSkia.cpp','GraphicsContextSkia.cpp','DisplayListRecorderImpl.cpp']};persist()
 # Match distro hardening and GTK3 choices; debug symbols are limited to -g1 as
 # in debian/rules. No JIT, sandbox or security policy is disabled.
 flag_env={**os.environ,'DEB_BUILD_MAINT_OPTIONS':'hardening=+all optimize=-lto'}
 def flags(kind):
  s=subprocess.check_output(['dpkg-buildflags','--get',kind],env=flag_env,text=True).strip()
  return re.sub(r'(?<!\S)-g(?!\S)','-g1',s)
 cpp=flags('CPPFLAGS')+' -DNDEBUG -DG_DISABLE_CAST_CHECKS';ld=flags('LDFLAGS')+' -Wl,--reduce-memory-overheads'
 args=['cmake','-S',str(source),'-B',str(build),'-GNinja','-DPORT=GTK','-DUSE_GTK4=OFF','-DCMAKE_BUILD_TYPE=Release','-DCMAKE_C_COMPILER=clang','-DCMAKE_CXX_COMPILER=clang++','-DCMAKE_C_COMPILER_LAUNCHER=ccache','-DCMAKE_CXX_COMPILER_LAUNCHER=ccache','-DCMAKE_C_FLAGS_RELEASE=','-DCMAKE_CXX_FLAGS_RELEASE=',f'-DCMAKE_C_FLAGS={flags("CFLAGS")} {cpp}',f'-DCMAKE_CXX_FLAGS={flags("CXXFLAGS")} {cpp}',f'-DCMAKE_EXE_LINKER_FLAGS={ld}',f'-DCMAKE_SHARED_LINKER_FLAGS={ld}',f'-DCMAKE_INSTALL_PREFIX={prefix}','-DCMAKE_INSTALL_LIBDIR=lib/x86_64-linux-gnu','-DCMAKE_INSTALL_LIBEXECDIR=lib/x86_64-linux-gnu',f'-DCMAKE_INSTALL_RPATH={prefix}/lib/x86_64-linux-gnu','-DCMAKE_BUILD_WITH_INSTALL_RPATH=ON','-DUSE_LIBBACKTRACE=OFF','-DUSE_SYSPROF_CAPTURE=ON','-DENABLE_DOCUMENTATION=OFF','-DENABLE_BUBBLEWRAP_SANDBOX=ON','-DUSER_AGENT_BRANDING=Ubuntu','-DUSE_AVIF=OFF','-DENABLE_SPEECH_SYNTHESIS=OFF','-DENABLE_GAMEPAD=OFF','-DUSE_LD_LLD=OFF','-DCMAKE_EXPORT_COMPILE_COMMANDS=ON']
 report['configureArgs']=args;run('configure-private-gtk3',args,timeout=900)
 shutil.copyfile(build/'CMakeCache.txt',evidence/'CMakeCache.txt')
 cache=(build/'CMakeCache.txt').read_text();assert re.search(r'^ENABLE_BUBBLEWRAP_SANDBOX:BOOL=ON$',cache,re.M)and re.search(r'^USE_GTK4:BOOL=OFF$',cache,re.M)
 report['compileCommands']=len(json.loads((build/'compile_commands.json').read_text()))
 report['engineBuildAttempted']=True;report['objectCacheProbeAttempted']=True;persist()
 run('cache-reuse-preflight',['python3',str(pathlib.Path(os.environ['GITHUB_WORKSPACE'])/'scripts/ci/webkit-cache-preflight.py'),'--build',str(build),'--output',str(evidence/'cache-preflight')],timeout=450)
 report['preflight']={'headers':'passed','restoredObjectCache':'passed'};persist()
 if operation=='preflight':
  report['status']='preflight-passed-not-engine-built';persist();raise SystemExit(0)
 report['fullEngineBuildAttempted']=True;report['stage']='compile-engine';persist()
 # Three jobs completed 2582/3263 objects in 150 minutes, with 6.84 GiB
 # minimum MemAvailable. Last-half-hour throughput predicts ~122 more minutes
 # at that rate, before final linking. Four jobs use the measured four-core host;
 # a separately bounded total retains 35 minutes for installation/native proof.
 assert (os.cpu_count() or 0)>=4, 'Measured four-core build capability required'
 meminfo=dict((k,v.strip())for k,v in (line.split(':',1)for line in pathlib.Path('/proc/meminfo').read_text().splitlines()))
 assert int(meminfo['MemTotal'].split()[0])*1024 >= 14*1024**3, 'At least 14 GiB RAM required'
 assert shutil.disk_usage(root).free >= 20*1024**3, 'At least 20 GiB initial disk reserve required'
 budget=compile_budget(time.time()-operation_started)
 started=time.monotonic();reason=None;last_progress=started;previous_completed=-1
 report['compileParallelism']=4;report['compileLinkBudgetSeconds']=budget
 report['acceptanceReserveSeconds']=35*60;report['capacityBaselineRun']=43574464936
 args=['/usr/bin/time','-v','-o',str(evidence/'build-time.txt'),'cmake','--build',str(build),'--parallel','4']
 with (evidence/'compile-engine.log').open('w')as f:
  proc=subprocess.Popen(args,stdout=f,stderr=subprocess.STDOUT,start_new_session=True)
  while proc.poll()is None:
   mem=dict((k,v.strip())for k,v in (line.split(':',1)for line in pathlib.Path('/proc/meminfo').read_text().splitlines()))
   available=int(mem['MemAvailable'].split()[0])*1024;free=shutil.disk_usage(root).free;elapsed=time.monotonic()-started
   log=build/'.ninja_log';completed=max(0,len(log.read_text().splitlines())-1)if log.exists()else 0
   sample={'elapsedSeconds':round(elapsed),'diskFreeBytes':free,'memoryAvailableBytes':available,'ninjaRecords':completed};report['samples'].append(sample);persist();print('BUILD_PROGRESS',json.dumps(sample),flush=True)
   if completed!=previous_completed:last_progress=time.monotonic();previous_completed=completed
   reason=stop_reason(elapsed,budget,available,free,time.monotonic()-last_progress)
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
 if shutil.which('ccache'):
  with (evidence/'compiler-cache-stats.txt').open('w') as f:subprocess.run(['ccache','--show-stats'],stdout=f,stderr=subprocess.STDOUT,timeout=30)
 if build.exists():
  report['buildDirectoryBytes']=int(subprocess.check_output(['du','-sb',str(build)],text=True).split()[0])
  for name in ['CMakeCache.txt','.ninja_log']:
   if (build/name).exists():shutil.copyfile(build/name,evidence/name.lstrip('.'))
 report['finalDiskFreeBytes']=shutil.disk_usage(root).free;persist()
if report['status']!='private-runtime-built-not-accepted':raise SystemExit(1)

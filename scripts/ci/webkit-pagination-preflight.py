#!/usr/bin/env python3
"""Bounded pagination preflight ONLY: official headers and four actual TUs.
No full-engine build, installation, link or native rendering is reachable here.
"""
import hashlib,json,os,pathlib,re,signal,subprocess,time,shutil
root=pathlib.Path(os.environ['RUNNER_TEMP'])/'milkup-webkit-research'
evidence=root/'evidence';source=root/'source';build=root/'build';prefix=root/'prefix';conf=root/'apt.conf'
repo=pathlib.Path(os.environ['GITHUB_WORKSPACE']);research=repo/'research/pdf-pagination-mechanism-20261116'
probe=json.loads((evidence/'result.json').read_text())
receipt=json.loads((research/'cache-input-receipt.json').read_text())
version=probe['sourceVersionRequested']
report={'status':'running','harnessSha':os.environ['GITHUB_SHA'],'scope':'Four changed actual translation units only; no engine or PDF acceptance','steps':[],'fullEngineBuildAttempted':False,'nativeAttempted':False}
started=time.monotonic()
def persist():(evidence/'pagination-build-result.json').write_text(json.dumps(report,indent=2)+'\n')
def digest(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def run(name,args,timeout=60,env=None):
 remaining=1800-(time.monotonic()-started)
 assert remaining>10,'Total preflight budget exhausted'
 timeout=min(timeout,remaining)
 report['stage']=name;persist();print('STAGE',name,flush=True)
 at=time.monotonic()
 with (evidence/(name+'.log')).open('w')as log:
  proc=subprocess.Popen(args,stdout=log,stderr=subprocess.STDOUT,cwd=root,env=env,start_new_session=True)
  try:code=proc.wait(timeout=timeout)
  except subprocess.TimeoutExpired:
   os.killpg(proc.pid,signal.SIGTERM)
   try:proc.wait(timeout=5)
   except subprocess.TimeoutExpired:os.killpg(proc.pid,signal.SIGKILL);proc.wait()
   raise RuntimeError(name+' exceeded phase/total budget; no continuation')
 report['steps'].append({'name':name,'exitCode':code,'seconds':round(time.monotonic()-at,3),'arguments':args});persist()
 assert code==0,name+' failed; retained raw log'
def system_libraries():
 return {str(p):digest(p)for pattern in ['libwebkit2gtk-4.1.so.*','libjavascriptcoregtk-4.1.so.*']for p in pathlib.Path('/usr/lib/x86_64-linux-gnu').glob(pattern)if p.is_file()and not p.is_symlink()}
try:
 assert os.getuid()!=0 and os.environ.get('GITHUB_ACTIONS')=='true'
 assert not os.environ.get('WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS')
 assert probe['status']=='probe-complete' and not probe['simulatedRemovals'] and not probe['wouldChangeWebKitPackages'] and probe['buildDependencySimulationSucceeded']
 assert version==receipt['sourceVersion'] and probe['archives']==receipt['archives'],'Authenticated source inputs differ from cache receipt'
 assert os.environ['PAGINATION_CACHE_MATCHED_KEY']==receipt['cacheKey'],'Exact cache not restored; stop before dependency work'
 report['cacheReceipt']=receipt
 report['initialDiskFreeBytes']=shutil.disk_usage(root).free
 assert report['initialDiskFreeBytes']>=12*1024**3,'12 GiB free required for source/config/header/object preflight'
 before=system_libraries();report['systemLibrariesBefore']=before;persist()
 run('install-official-build-deps',['sudo','apt-get','-c',str(conf),'-y','--no-install-recommends','--no-remove','build-dep',f'webkit2gtk={version}'],timeout=600)
 run('install-official-cache-tool',['sudo','apt-get','-c',str(conf),'-y','--no-install-recommends','--no-remove','install','ccache'],timeout=120)
 run('configure-bounded-cache',['ccache','--max-size','2G'])
 run('prepare-pagination-probe',['python3',str(research/'prepare.py'),str(source),str(evidence/'pagination-observation.patch')])
 run('check-pagination-probe',['git','-C',str(source),'apply','--check',str(evidence/'pagination-observation.patch')])
 run('apply-pagination-probe',['git','-C',str(source),'apply',str(evidence/'pagination-observation.patch')])
 report['patchSha256']=digest(evidence/'pagination-observation.patch')
 assert report['patchSha256']==digest(research/'observation-only.patch'),'Generated observation patch changed'
 flag_env={**os.environ,'DEB_BUILD_MAINT_OPTIONS':'hardening=+all optimize=-lto'}
 def flags(kind):
  s=subprocess.check_output(['dpkg-buildflags','--get',kind],env=flag_env,text=True).strip()
  return re.sub(r'(?<!\S)-g(?!\S)','-g1',s)
 cpp=flags('CPPFLAGS')+' -DNDEBUG -DG_DISABLE_CAST_CHECKS';ld=flags('LDFLAGS')+' -Wl,--reduce-memory-overheads'
 args=['cmake','-S',str(source),'-B',str(build),'-GNinja','-DPORT=GTK','-DUSE_GTK4=OFF','-DCMAKE_BUILD_TYPE=Release','-DCMAKE_C_COMPILER=clang','-DCMAKE_CXX_COMPILER=clang++','-DCMAKE_C_COMPILER_LAUNCHER=ccache','-DCMAKE_CXX_COMPILER_LAUNCHER=ccache','-DCMAKE_C_FLAGS_RELEASE=','-DCMAKE_CXX_FLAGS_RELEASE=',f'-DCMAKE_C_FLAGS={flags("CFLAGS")} {cpp}',f'-DCMAKE_CXX_FLAGS={flags("CXXFLAGS")} {cpp}',f'-DCMAKE_EXE_LINKER_FLAGS={ld}',f'-DCMAKE_SHARED_LINKER_FLAGS={ld}',f'-DCMAKE_INSTALL_PREFIX={prefix}','-DCMAKE_INSTALL_LIBDIR=lib/x86_64-linux-gnu','-DCMAKE_INSTALL_LIBEXECDIR=lib/x86_64-linux-gnu',f'-DCMAKE_INSTALL_RPATH={prefix}/lib/x86_64-linux-gnu','-DCMAKE_BUILD_WITH_INSTALL_RPATH=ON','-DUSE_LIBBACKTRACE=OFF','-DUSE_SYSPROF_CAPTURE=ON','-DENABLE_DOCUMENTATION=OFF','-DENABLE_BUBBLEWRAP_SANDBOX=ON','-DUSER_AGENT_BRANDING=Ubuntu','-DUSE_AVIF=OFF','-DENABLE_SPEECH_SYNTHESIS=OFF','-DENABLE_GAMEPAD=OFF','-DUSE_LD_LLD=OFF','-DCMAKE_EXPORT_COMPILE_COMMANDS=ON']
 report['configureArgs']=args;assert args==receipt['configureArgs'],'Configured ABI/flags/paths differ from pinned cache inputs'
 run('configure-private-gtk3',args,timeout=420)
 shutil.copyfile(build/'CMakeCache.txt',evidence/'CMakeCache.txt')
 cache=(build/'CMakeCache.txt').read_text();assert re.search(r'^ENABLE_BUBBLEWRAP_SANDBOX:BOOL=ON$',cache,re.M)and re.search(r'^USE_GTK4:BOOL=OFF$',cache,re.M)
 report['compileCommands']=len(json.loads((build/'compile_commands.json').read_text()))
 report['toolchain']={name:subprocess.check_output([name,'--version'],text=True,timeout=10).splitlines()[0]for name in ['clang++','ccache','cmake','ninja']}
 report['compilerSha256']=digest(pathlib.Path(shutil.which('clang++')).resolve())
 run('cache-first-invocation-proof',['python3',str(repo/'scripts/ci/webkit-cache-preflight.py'),'--build',str(build),'--output',str(evidence/'pagination-cache-preflight')],timeout=400)
 report['firstCacheInvocation']=json.loads((evidence/'pagination-cache-preflight/result.json').read_text());persist()
 inherited=[]
 if os.environ.get('PAGINATION_OPERATION')=='pagination-segment':
  old=json.loads((research/'evidence/43789957637/pagination-build-result.json').read_text())
  for field in ['patchSha256','compilerSha256','configureArgs','toolchain']:
   assert report[field]==old[field],'Inherited compiler/ABI mismatch: '+field
  inherited=['--inherit',str(research/'evidence/43789957637/original-artifact.zip')]
 run('four-actual-tu-gate',['python3',str(repo/'scripts/ci/webkit-pagination-object-preflight.py'),'--source',str(source),'--build',str(build),'--output',str(evidence/'pagination-object-gate'),*inherited],timeout=1100)
 gate=json.loads((evidence/'pagination-object-gate/result.json').read_text());assert gate['status']=='passed'
 report['actualTranslationUnits']=gate['sourceHashes']
 report['status']='passed-four-tu-only-not-native'
except Exception as e:
 report['status']='failed';report['error']=str(e)
finally:
 report['seconds']=round(time.monotonic()-started,3)
 report['systemLibrariesAfter']=system_libraries()
 if report.get('systemLibrariesBefore')!=report['systemLibrariesAfter']:
  report['status']='failed';report['systemLibraryMismatch']=True
 if shutil.which('ccache'):
  with (evidence/'pagination-cache-stats.txt').open('w')as log:subprocess.run(['ccache','--show-stats'],stdout=log,stderr=subprocess.STDOUT,timeout=10)
 report['finalDiskFreeBytes']=shutil.disk_usage(root).free;persist()
print(json.dumps(report,indent=2))
raise SystemExit(0 if report['status']=='passed-four-tu-only-not-native'else 1)

#!/usr/bin/env python3
"""One explicitly selected cached continuation, reachable only after actual TU success."""
import hashlib,json,os,pathlib,shutil,signal,subprocess,time
root=pathlib.Path(os.environ['RUNNER_TEMP'])/'milkup-webkit-research';evidence=root/'evidence';build=root/'build';prefix=root/'prefix'
def digest(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def cache_stats():return {k:int(v)for k,v in (line.split()for line in subprocess.check_output(['ccache','--print-stats'],text=True,timeout=10).splitlines())}
def libs():return {str(p):digest(p)for pat in ['libwebkit2gtk-4.1.so.*','libjavascriptcoregtk-4.1.so.*']for p in pathlib.Path('/usr/lib/x86_64-linux-gnu').glob(pat)if p.is_file()and not p.is_symlink()}
report={'status':'running','harnessSha':os.environ['GITHUB_SHA'],'engineBuildAttempted':False,'nativeAttempted':False,'maxSeconds':1200,'maxNewCacheMisses':64,'samples':[]}
segment=os.environ.get('PAGINATION_OPERATION')=='pagination-segment'
if segment:
 elapsed=time.time()-int(os.environ['PAGINATION_START_EPOCH'])
 report.update(maxSeconds=min(5400,10800-elapsed-3600),maxNewCacheMisses=1024,acceptanceAndRetentionReserveSeconds=3600)
def persist():(evidence/'pagination-continuation.json').write_text(json.dumps(report,indent=2)+'\n')
def stop(proc):
 os.killpg(proc.pid,signal.SIGTERM)
 try:proc.wait(timeout=10)
 except subprocess.TimeoutExpired:os.killpg(proc.pid,signal.SIGKILL);proc.wait()
try:
 assert os.getuid()!=0 and os.environ['PAGINATION_OPERATION']in ['pagination-diagnostic','pagination-segment']
 assert not os.environ.get('WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS')
 pre=json.loads((evidence/'pagination-build-result.json').read_text());gate=json.loads((evidence/'pagination-object-gate/result.json').read_text())
 assert pre['harnessSha']==report['harnessSha'] and pre['status']=='passed-four-tu-only-not-native'
 assert gate['status']=='passed'and len(gate['sourceHashes'])==4 and gate['uniqueObjectCommands']==4
 assert pre['patchSha256']=='3a84a75ae9aad83e8f93940c4d55b886c6cf2cba069ca087893fa2efe2e443c8'
 assert pre['firstCacheInvocation']['status']=='passed'
 assert all(s['hitDelta']==1 and s['missDelta']==0 for s in pre['firstCacheInvocation']['samples'])
 if segment:
  assert report['maxSeconds']>=1800,'Insufficient segment and retention reserve'
  transfer=json.loads((evidence/'pagination-cache-roundtrip.json').read_text())
  assert transfer['status']=='passed'and pathlib.Path(transfer['restoredCache'])==pathlib.Path(os.environ['CCACHE_DIR'])
  assert gate['inheritedFromRun']==43789957637 and gate['actualCompilesThisRun']==0
  for name in ['compile_commands.json','build.ninja','CMakeCache.txt']:
   shutil.copyfile(build/name,evidence/('segment-'+name))
  with(evidence/'segment-full-command-graph.txt').open('w')as log:
   subprocess.run(['ninja','-C',str(build),'-t','commands'],stdout=log,check=True,timeout=60)
 assert (os.cpu_count()or 0)>=4
 mem=lambda:{k:v.strip()for k,v in (line.split(':',1)for line in pathlib.Path('/proc/meminfo').read_text().splitlines())}
 assert int(mem()['MemTotal'].split()[0])*1024>=14*1024**3
 assert shutil.disk_usage(root).free>=20*1024**3
 before=libs();report['systemLibrariesBefore']=before
 first=cache_stats();report['cacheStatsBefore']=first;report['engineBuildAttempted']=True;persist()
 start=time.monotonic();reason=None;proc=None;last_progress=start;last_size=0
 with (evidence/'pagination-cached-build.log').open('w')as log:
  proc=subprocess.Popen(['cmake','--build',str(build),'--parallel','4'],stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
  try:
   while proc.poll()is None:
    now=cache_stats();row={'seconds':round(time.monotonic()-start,3),'newMisses':now['cache_miss']-first['cache_miss'],'newHits':now['direct_cache_hit']+now['preprocessed_cache_hit']-first['direct_cache_hit']-first['preprocessed_cache_hit'],'freeBytes':shutil.disk_usage(root).free,'availableMemoryBytes':int(mem()['MemAvailable'].split()[0])*1024}
    report['samples'].append(row);persist();print(json.dumps(row),flush=True)
    progress=(build/'.ninja_log').stat().st_size if(build/'.ninja_log').exists()else 0
    if progress!=last_size:last_progress=time.monotonic();last_size=progress
    row['ninjaLogBytes']=progress;row['secondsWithoutCompletedEdge']=round(time.monotonic()-last_progress,3)
    if row['seconds']>=report['maxSeconds']:reason='bounded segment deadline; retention and acceptance reserve retained'
    elif row['newMisses']>report['maxNewCacheMisses']:reason='bounded new object count reached'
    elif segment and row['secondsWithoutCompletedEdge']>=900:reason='no completed Ninja edge for 15 minutes'
    elif row['freeBytes']<8*1024**3:reason='disk reserve'
    elif row['availableMemoryBytes']<2*1024**3:reason='memory reserve'
    if reason:stop(proc);break
    time.sleep(5)
  finally:
   if proc.poll()is None:stop(proc)
  report['compileExitCode']=proc.returncode;report['stopReason']=reason;report['compileSeconds']=round(time.monotonic()-start,3);report['cacheStatsAfter']=cache_stats();persist()
  assert not reason and proc.returncode==0,'Bounded cache continuation failed'
  assert report['cacheStatsAfter']['cache_miss']-first['cache_miss']<=report['maxNewCacheMisses']
 with (evidence/'pagination-private-install.log').open('w')as log:
  subprocess.run(['cmake','--install',str(build)],stdout=log,stderr=subprocess.STDOUT,check=True,timeout=300)
 manifest=(build/'install_manifest.txt').read_text().splitlines();assert manifest and all(pathlib.Path(p).is_relative_to(prefix)for p in manifest)
 shutil.copyfile(build/'install_manifest.txt',evidence/'pagination-install-manifest.txt')
 runtime=[p for p in prefix.rglob('*')if p.is_file()and not p.is_symlink()and ('.so'in p.name or p.name in ['WebKitWebProcess','WebKitNetworkProcess','WebKitGPUProcess'])]
 report['runtimeFiles']=[{'path':str(p.relative_to(prefix)),'bytes':p.stat().st_size,'sha256':digest(p)}for p in runtime]
 assert any(p['path'].endswith('WebKitWebProcess')for p in report['runtimeFiles'])
 assert any('libwebkit2gtk-4.1.so.'in p['path']for p in report['runtimeFiles'])
 report['systemLibrariesAfter']=libs();assert report['systemLibrariesAfter']==before
 report['prefix']=str(prefix);report['status']='private-observation-runtime-built-not-accepted'
except Exception as error:report.update(status='failed',error=str(error))
finally:
 if segment:
  import re
  if(build/'.ninja_log').exists():shutil.copyfile(build/'.ninja_log',evidence/'segment-ninja_log')
  log=evidence/'pagination-cached-build.log'
  if log.exists():
   completed=sorted(set(re.findall(r'Building (?:CXX|C|ASM) object (\S+)',log.read_text())))
   report['uniqueCompletedObjects']=len(completed)
   (evidence/'segment-completed-objects.json').write_text(json.dumps(completed,indent=2)+'\n')
 persist()
raise SystemExit(0 if report['status']=='private-observation-runtime-built-not-accepted'else 1)

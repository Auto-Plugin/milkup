"""One representative WebCore frontier, clean-job continuation, bounded normal build.
No install, runtime execution, production package or native-PDF acceptance claim.
"""
import argparse,copy,gzip,hashlib,json,os,pathlib,re,shlex,shutil,signal,subprocess,time,traceback
import current_tu_gate as gate
import current_segment as seg
import frontier_checkpoint as checkpoint
HERE=gate.HERE
LEGACY_MANIFEST=HERE/'evidence/43864252208/resume-checkpoint-manifest.json.gz'
LEGACY_SHA='acd9c6c96cf12828654c1ab17be025dbcbd264ce6c3cc24a838595d8b43cf655'
LEGACY_PRODUCER='817db1398ac62d5465fbc76f3684171e4ff335ed'
HARNESS=['current_engine.py','frontier_checkpoint.py','current_segment.py','current_tu_gate.py','current_object_restore.py','current_source_archive.py','package_boundary.py']

def select_owned(table,known):
 # PID plus Linux process start ticks, including descendants that start their
 # own process group. A recycled PID is never adopted from the remembered set.
 owned={pid for pid,birth in known.items()if pid in table and table[pid]['birth']==birth}
 changed=True
 while changed:
  changed=False
  for pid,row in table.items():
   if pid not in known and row['parent']in owned:
    owned.add(pid);known[pid]=row['birth'];changed=True
 return {pid:table[pid]for pid in owned}

def footprint(known):
 table={}
 for p in pathlib.Path('/proc').iterdir():
  if not p.name.isdigit():continue
  try:
   stat=(p/'stat').read_text();fields=stat[stat.rfind(')')+2:].split()
   text=(p/'status').read_text();m=re.search(r'^VmRSS:\s+(\d+) kB',text,re.M)
   table[int(p.name)]={'parent':int(fields[1]),'group':int(fields[2]),'birth':int(fields[19]),'state':fields[0],'rssKiB':int(m[1])if m else 0}
  except (OSError,ValueError,IndexError,ProcessLookupError,PermissionError):continue
 owned=select_owned(table,known);live={p:r for p,r in owned.items()if r['state']!='Z'}
 return {'sampledTreeRssKiB':sum(r['rssKiB']for r in owned.values()),'sampledTreeProcesses':len(live),'owned':live}

def signal_owned(known,signum):
 for pid,row in footprint(known)['owned'].items():
  try:
   raw=pathlib.Path('/proc/'+str(pid)+'/stat').read_text();fields=raw[raw.rfind(')')+2:].split()
   if int(fields[19])==row['birth']:os.kill(pid,signum)
  except (OSError,ProcessLookupError,ValueError,IndexError):pass

def stop_reason(elapsed,limit,available,free,idle):
 if available<2*1024**3:return 'available memory below 2 GiB'
 if free<8*1024**3:return 'free disk below 8 GiB'
 if elapsed>=limit:return 'explicit stage deadline'
 if idle>=1800:return 'no completed Ninja edge for 30 minutes'
 return None

def identity_files():
 files={str(HERE/name):checkpoint.digest(HERE/name)for name in HARNESS}
 for p in [gate.REPO/'scripts/ci/webkit-pagination-object-preflight.py',gate.REPO/'.github/workflows/linux-webkit-build-research.yml']:
  files[str(p)]=checkpoint.digest(p)
 return files

class EngineGate(seg.Segment):
 def __init__(self,root,start,mode,incoming,expected,attempt_complete):
  super().__init__(root,start,'build');self.engine_mode=mode;self.incoming=incoming;self.expected=expected;self.attempt_complete=attempt_complete
  self.deadline=start+(54*60 if mode=='frontier'else 340*60)
  self.report.update(mode=mode,scope='original normal graph WebCore frontier and exact clean-job continuation',jobLimitSeconds=3600 if mode=='frontier'else 355*60,workLimitSeconds=54*60 if mode=='frontier'else 340*60,fullEngineBuilt=False,runtimeInstalled=False,nativePdfExecuted=False,attemptComplete=attempt_complete)
  self.full_entries={};self.generic_identity=None;self.frontier=[];self.helpers={};self.snapshot_number=0
 def after_sdk(self):
  self.run('real-frontier-contracts',['python3','-m','unittest','discover','-s',str(HERE),'-p','test_frontier_checkpoint.py','-v'],180,gate.REPO,{**os.environ,'PYTHONDONTWRITEBYTECODE':'1'})
 def prepare_engine(self):
  gate.Gate.execute(self);seg.Segment.prepare_batch(self)
  plan=self.run('normal-all-command-graph',['ninja','-t','commands','all'],90,self.build)
  database=json.loads((self.build/'compile_commands.json').read_text());self.full_entries=checkpoint.compile_entries(database,plan,self.build);self.helpers=checkpoint.helper_commands(plan)
  assert self.helpers.keys()==checkpoint.HELPERS
  self.frontier=list(dict.fromkeys(seg.target_of(e.get('arguments')or shlex.split(e['command']))for e in self.report['selectedUnits'].values()))
  assert len(self.frontier)==10 and all(t in self.full_entries and 'Source/WebCore/'in t for t in self.frontier)
  generators={}
  for line in plan.splitlines():
   for arg in shlex.split(line):
    path=pathlib.Path(arg)
    if not path.is_absolute()or path.is_relative_to(self.root):continue
    if path.is_file()and os.access(path,os.X_OK):generators[str(path)]={'resolved':str(path.resolve()),'sha256':checkpoint.digest(path.resolve())}
  cache=gate.boundary.cache_values(self.build/'CMakeCache.txt')
  for key in ['CMAKE_LINKER','CMAKE_AR','CMAKE_RANLIB']:
   path=pathlib.Path(cache[key]);assert path.is_file();generators[str(path)]={'resolved':str(path.resolve()),'sha256':checkpoint.digest(path.resolve())}
  self.generic_identity={'schema':checkpoint.SCHEMA,'configuration':self.identity['configuration'],'graph':self.identity['graph'],'harnessFiles':identity_files(),'generatorAndLinkTools':generators}
  db_targets={seg.target_of(e.get('arguments')or shlex.split(e['command']))for e in database}
  self.report['normalGraph']={'allCompilerTargets':len(self.full_entries),'compileDatabaseEntries':len(database),'notInDefaultAll':sorted(db_targets-self.full_entries.keys()),'frontier':self.frontier,'pchTargets':[t for t,e in self.full_entries.items()if e['kind']=='pch'],'identitySha256':seg.canonical(self.generic_identity)}
  (self.out/'engine-entries.json.gz').write_bytes(gzip.compress(json.dumps(self.full_entries,sort_keys=True).encode(),mtime=0));self.persist()
 def monitored(self,name,args,limit):
  remaining=self.deadline-time.time();assert remaining>600,'Keep archive/evidence reserve'
  limit=min(limit,remaining-600);self.report['stage']=name;self.persist()
  (self.out/(name+'-command.json')).write_text(json.dumps({'arguments':args,'cwd':str(self.build),'timeoutSeconds':limit},indent=2))
  at=time.monotonic();last=at;oldstate=None;samples=[];reason=None
  env={**os.environ,'CCACHE_DISABLE':'1'}
  with (self.out/(name+'.log')).open('w')as log:
   proc=subprocess.Popen(args,cwd=self.build,env=env,stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
   raw=pathlib.Path('/proc/'+str(proc.pid)+'/stat').read_text();known={proc.pid:int(raw[raw.rfind(')')+2:].split()[19])}
   while proc.poll()is None:
    now=time.monotonic();native=self.build/'.ninja_log';state=(native.stat().st_size,native.stat().st_mtime_ns)if native.exists()else None
    if state!=oldstate:last=now;oldstate=state
    available=int(re.search(r'^MemAvailable:\s+(\d+)',pathlib.Path('/proc/meminfo').read_text(),re.M)[1])*1024;free=shutil.disk_usage(self.root).free
    sample=footprint(known);row={'elapsedSeconds':round(now-at,3),'availableBytes':available,'freeBytes':free,'nativeLogBytes':state[0]if state else 0,**{k:v for k,v in sample.items()if k!='owned'}};samples.append(row)
    reason=stop_reason(now-at,limit,available,free,now-last)
    if reason:
     signal_owned(known,signal.SIGTERM)
     try:proc.wait(timeout=10)
     except subprocess.TimeoutExpired:signal_owned(known,signal.SIGKILL);proc.wait()
     break
    try:proc.wait(timeout=10)
    except subprocess.TimeoutExpired:pass
   code=proc.wait()
   if footprint(known)['sampledTreeProcesses']:
    signal_owned(known,signal.SIGKILL)
    until=time.monotonic()+5
    while footprint(known)['sampledTreeProcesses']and time.monotonic()<until:time.sleep(.1)
    assert not footprint(known)['sampledTreeProcesses'],'Build process tree still alive; do not capture mutable outputs'
  elapsed=round(time.monotonic()-at,3);(self.out/(name+'-resource-samples.json')).write_text(json.dumps(samples,indent=2))
  self.report['steps'].append({'name':name,'seconds':elapsed,'exitCode':code,'stopReason':reason,'sampledPeakTreeRssKiB':max((x['sampledTreeRssKiB']for x in samples),default=None),'sampleCount':len(samples)});self.persist()
  return code,reason
 def phase(self,name,targets,old,limit,require_new=True):
  plan=self.run(name+'-plan',['ninja','-t','commands',*targets],90,self.build);selected=checkpoint.compile_entries(json.loads((self.build/'compile_commands.json').read_text()),plan,self.build)
  assert all(self.full_entries[t]==e for t,e in selected.items())
  if name=='normal-all-objects':assert not any('-shared'in shlex.split(line)for line in plan.splitlines()),'Shared links must remain in the single-job final phase'
  code,reason=self.monitored(name,['ninja','-v','-d','keepdepfile','-k','0','-j','2',*targets],limit)
  log=(self.out/(name+'.log')).read_text();actual=[]
  for args in seg.commands(log):
   if args and pathlib.Path(args[0]).name=='ccache':
    t=seg.target_of(args);assert t in selected and args==selected[t]['command'],'Unexpected compiler edge';actual.append(t)
  expected=set(selected)-set(old)
  self.report.setdefault('nativePhases',[]).append({'name':name,'requestedTargets':targets,'planCompilerTargets':len(selected),'actualCompiles':actual,'oldRecompiles':sorted(set(actual)&set(old)),'expectedNewCount':len(expected),'exitCode':code,'stopReason':reason});self.persist()
  assert not(set(actual)&set(old)),'Old object was recompiled; preserve evidence'
  assert code==0 and not reason,name+' failed or reached explicit boundary'
  assert len(actual)==len(set(actual))and set(actual)==expected,'Actual new compiler set differs from original graph'
  if require_new:assert actual,'No forward progress'
  return set(selected)
 def import_legacy(self):
  pinned=json.loads(gzip.decompress(LEGACY_MANIFEST.read_bytes()));assert pinned['identity']['harnessSha']==LEGACY_PRODUCER
  assert pinned['identity']['configuration']==self.generic_identity['configuration']and pinned['identity']['graph']==self.generic_identity['graph'],'Pinned predecessor source/config/graph mismatch'
  for e in pinned['identity']['entries']:assert e['command']==self.full_entries[e['target']]['command']
  m,payload=seg.load_checkpoint(self.incoming,LEGACY_SHA,pinned['identity']);assert m==pinned,'Exact reviewed predecessor receipt required'
  seg.restore_checkpoint(m,payload,self.build,self.source)
  old=set(m['targets']);self.phase('imported-28-native-skip',list(m['targets']),old,120,False)
  self.report['predecessorImport']={'producerSha':LEGACY_PRODUCER,'checkpointSha256':LEGACY_SHA,'objects':len(old),'freshOldCompiles':0,'sourceConfigAndGraphExact':True};self.persist();return old
 def snapshot(self,label):
  if not self.generic_identity:return
  self.snapshot_number+=1;context=self.out/('snapshot-context-'+str(self.snapshot_number)+'.json')
  context.write_text(json.dumps({'build':str(self.build),'source':str(self.source),'entries':self.full_entries,'identity':self.generic_identity,'frontier':self.frontier,'helpers':self.helpers}))
  folder=self.out/'checkpoints'/label;folder.mkdir(parents=True,exist_ok=False)
  self.run('checkpoint-'+label,['python3',str(HERE/'current_engine.py'),'pack','--context',str(context),'--output',str(folder)],600,self.build)
  receipt=json.loads((folder/'receipt.json').read_text());self.report.setdefault('checkpoints',[]).append({'label':label,**receipt});self.persist();context.unlink()
  if os.environ.get('GITHUB_OUTPUT'):
   with open(os.environ['GITHUB_OUTPUT'],'a')as f:f.write('checkpoint_sha256='+receipt['archiveSha256']+'\n')
  return receipt
 def import_frontier(self):
  assert self.expected and re.fullmatch('[a-f0-9]{64}',self.expected)
  staging=self.root/'incoming-frontier';m=checkpoint.load_archive(self.incoming,self.expected,self.generic_identity,staging)
  assert m['frontier']==self.frontier
  try:checkpoint.load_archive(self.incoming,'0'*64,self.generic_identity,self.root/'rejected-frontier-transport')
  except AssertionError as e:assert 'Damaged frontier archive'in str(e);self.report['frontierTransportMismatchRejectedBeforeWrite']=True
  else:raise AssertionError('Wrong frontier transport digest accepted')
  assert not (self.root/'rejected-frontier-transport').exists()
  wrong=copy.deepcopy(self.generic_identity);wrong['graph']={}
  try:checkpoint.check_identity(m,wrong)
  except AssertionError:self.report['frontierIdentityMismatchRejected']=True
  else:raise AssertionError('Wrong frontier identity accepted')
  source=next(pathlib.Path(n)for n in m['inputs']if pathlib.Path(n).is_relative_to(self.source));data=source.read_bytes();st=source.stat()
  try:
   source.write_bytes(data+b'\n/* changed source negative control */\n')
   try:checkpoint.validate_existing(m,self.build,self.source)
   except AssertionError as e:assert 'Changed compiler input'in str(e);self.report['frontierChangedInputRejectedBeforeWrite']=True
   else:raise AssertionError('Changed frontier input accepted')
  finally:source.write_bytes(data);os.utime(source,ns=(st.st_atime_ns,st.st_mtime_ns))
  def regenerate(name,args,limit,cwd,env=None):
   if name.startswith('regenerate-pch-'):
    assert cwd==self.build;code,reason=self.monitored(name,args,limit);assert code==0 and not reason,'Original PCH regeneration failed'
    return (self.out/(name+'.log')).read_text()
   return self.run(name,args,limit,cwd,env)
  proof=checkpoint.restore(m,staging,self.build,self.source,regenerate,self.full_entries,self.helpers);self.report['frontierRestore']=proof;self.persist()
  old=set(m['entries']);self.phase('restored-webcore-frontier-skip',self.frontier,old,300,False)
  for target,e in m['entries'].items():assert checkpoint.digest(self.build/target)==m['records'][target]['sha256'],'Old restored bytes changed'
  return old
 def complete_normal_build(self,old):
  # Original object targets first; this keeps final shared links out of the
  # parallel compiler phase. Only upstream small build-time helpers may link.
  self.report['engineBuildAttempted']=True;self.persist()
  remaining=self.deadline-time.time();budget=min(270*60,remaining-45*60)
  assert budget>=30*60,'Insufficient full-object budget with final-link/archive reserve'
  self.phase('normal-all-objects',list(self.full_entries),old,budget)
  self.snapshot('all-objects')
  plan=self.run('normal-final-link-plan',['ninja','-n','-v','all'],90,self.build)
  # Actual normal execution validates whether a manifest refresh was pending;
  # a dry-run alone is never link/compile evidence.
  code,reason=self.monitored('normal-final-links',['ninja','-v','-d','keepdepfile','-k','0','-j','1','all'],35*60)
  log=(self.out/'normal-final-links.log').read_text();compiled=[a for a in seg.commands(log)if a and pathlib.Path(a[0]).name=='ccache']
  self.report['finalLink']={'exitCode':code,'stopReason':reason,'compilerCommands':len(compiled),'singleJob':True,'normalAllTarget':True};self.persist()
  assert code==0 and not reason and not compiled,'Normal final link failed or unexpectedly compiled'
  assert seg.graph_identity(self.build)==self.generic_identity['graph'],'Graph/configuration changed during normal build'
  self.report['fullEngineBuilt']=True;self.persist();self.snapshot('linked')
  inventory=[]
  for root in [self.build/'lib',self.build/'bin']:
   for p in sorted(root.rglob('*')):
    if not p.is_file()or p.is_symlink():continue
    with p.open('rb')as f:magic=f.read(4)
    if magic!=b'\x7fELF':continue
    name=str(p.relative_to(self.build));inventory.append({'path':name,'bytes':p.stat().st_size,'sha256':checkpoint.digest(p)})
    logname='elf-'+re.sub('[^A-Za-z0-9_-]','_',name)
    self.run(logname,['readelf','-h','-d','--version-info',str(p)],60,self.build)
  (self.out/'normal-elf-inventory.json').write_text(json.dumps(inventory,indent=2));assert any('libwebkit2gtk-4.1.so'in r['path']for r in inventory)
 def execute(self):
  self.prepare_engine()
  if self.engine_mode=='frontier':
   old=self.import_legacy();selected=self.phase('representative-webcore-frontier',self.frontier,old,40*60)
   assert sum(self.full_entries[t]['kind']=='pch'for t in selected)>=2 and sum('Source/WebCore/'in t and t.endswith('.o')for t in selected)>=10
   self.snapshot('frontier');self.report['status']='passed-representative-frontier-not-engine-or-package'
  else:
   old=self.import_frontier()
   # A distinct downstream WebCore batch first, reusing the accepted PCH(s).
   further=[t for t,e in self.full_entries.items()if t.startswith('Source/WebCore/CMakeFiles/WebCore.dir/')and e['kind']=='object'and t not in old][:8]
   assert len(further)==8
   progressed=self.phase('downstream-webcore-progress',further,old,20*60);old|=progressed;self.snapshot('continued')
   if self.attempt_complete:self.complete_normal_build(old)
   self.report['status']='passed-normal-engine-build-not-package'if self.report['fullEngineBuilt']else'passed-webcore-continuation-not-engine-or-package'
  self.persist()
 def retain(self):
  original=self.report['objects'];self.report['objects']=[]
  gate.Gate.retain(self);self.report['objects']=original
  self.report['objectRetention']={'format':checkpoint.SCHEMA,'checkpoints':self.report.get('checkpoints',[]),'duplicateObjectArchiveCreated':False};self.persist()

def pack(context,output):
 data=json.loads(context.read_text());manifest,payload=checkpoint.capture(pathlib.Path(data['build']),pathlib.Path(data['source']),data['entries'],data['identity'],data['frontier'],data['helpers'])
 archive=output/'frontier.tar.gz';checkpoint.write_archive(archive,manifest,payload)
 (output/'manifest.json.gz').write_bytes(gzip.compress(json.dumps(manifest,sort_keys=True).encode(),mtime=0))
 receipt={'archiveSha256':checkpoint.digest(archive),'archiveBytes':archive.stat().st_size,'schema':checkpoint.SCHEMA,'identitySha256':seg.canonical(data['identity']),'compiledObjects':manifest['compiledObjectCount'],'pchRecords':manifest['pchCount'],'inputRecords':len(manifest['inputs']),'generatedInputsArchived':sum(r['kind']=='generated'for r in manifest['records'].values()),'runtimeBytesArchived':False,'pchBytesArchived':False}
 (output/'receipt.json').write_text(json.dumps(receipt,indent=2)+'\n');print(json.dumps(receipt))

def main():
 p=argparse.ArgumentParser();sub=p.add_subparsers(dest='command',required=True)
 packer=sub.add_parser('pack');packer.add_argument('--context',type=pathlib.Path,required=True);packer.add_argument('--output',type=pathlib.Path,required=True)
 runner=sub.add_parser('run');runner.add_argument('--root',type=pathlib.Path,required=True);runner.add_argument('--started',type=float,required=True);runner.add_argument('--mode',choices=['frontier','resume'],required=True);runner.add_argument('--incoming',type=pathlib.Path,required=True);runner.add_argument('--expected-sha');runner.add_argument('--attempt-complete',action='store_true')
 a=p.parse_args()
 if a.command=='pack':pack(a.context,a.output);return 0
 g=EngineGate(a.root.resolve(),a.started,a.mode,a.incoming,a.expected_sha,a.attempt_complete)
 try:g.execute()
 except Exception as e:
  g.report.update(status='failed',error=str(e),traceback=traceback.format_exc(limit=12));g.persist()
  if g.generic_identity and (g.build/'.ninja_deps').exists():
   try:g.snapshot('stopped-completed-objects')
   except Exception as x:g.report['stoppedCheckpointError']=repr(x);g.persist()
 finally:
  try:g.retain()
  except Exception as e:g.report.update(status='failed',retentionError=repr(e));g.persist()
 print(json.dumps({k:g.report.get(k)for k in ['status','stage','error','elapsedSeconds','fullEngineBuilt']},indent=2));return 0 if str(g.report['status']).startswith('passed-')else 1
if __name__=='__main__':raise SystemExit(main())

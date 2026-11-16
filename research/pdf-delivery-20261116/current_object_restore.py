"""Clean-job validation of exact 2.54.2 selected objects; never a full engine link.
Recompile original PCH/TUs, compare bytes, restore pinned prior bytes and prove
Ninja metadata and an explicitly relocatable partial link. No timestamp shortcut
is used before independent fresh object/depfile equivalence is established.
"""
import argparse,copy,gzip,hashlib,io,json,os,pathlib,re,shlex,shutil,tarfile,time,traceback,zipfile
import current_tu_gate as gate
HERE=pathlib.Path(__file__).resolve().parent
SOURCE_RUN=43852458294
ARTIFACT=HERE/'evidence/43852458294/original.zip'
ARTIFACT_SHA='0ad80c72160dbda4d6f5968a10977d9db7d0f355016d9785469a14c060e5027f'
PASS='passed-cross-job-selected-object-restore-not-engine-or-package'
def sha(data):return hashlib.sha256(data).hexdigest()
def identity(report,generated,inventory):
 return {**{k:report[k]for k in ['sourceVersion','sourceArchiveSha256','patchSha256','patchedSourceHashes','configuration','configureOptions','compilerSha256','compileDatabaseSha256','tools']},'generatedHeaders':generated,'installedSdkInventorySha256':sha(inventory)}
def require_identity(old,current):
 assert old.keys()==current.keys(),'Identity field set mismatch'
 for k in old:assert old[k]==current[k],('Restore identity mismatch',k)
def object_payload(data,receipt):
 assert len(data)==receipt['bytes']and sha(data)==receipt['sha256'],'Object archive identity mismatch'
 expected={r['path']:r for r in receipt['files']};assert len(expected)==len(receipt['files'])==20
 total=0;payload={}
 with tarfile.open(fileobj=io.BytesIO(data),mode='r:gz')as tar:
  for m in tar:
   path=pathlib.PurePosixPath(m.name)
   assert m.isfile()and not path.is_absolute()and '..'not in path.parts and m.name in expected and m.name not in payload,'Unexpected object member'
   r=expected[m.name];assert m.size==r['bytes']<=256*1024**2;total+=m.size;assert total<=512*1024**2
   b=tar.extractfile(m).read();assert len(b)==m.size and sha(b)==r['sha256'],'Object member hash mismatch';payload[m.name]=b
 assert payload.keys()==expected.keys();return payload

def seed_rule(index,command,target,source,pch_inputs=()):
 # Keep the expanded command string exactly, not a re-quoted approximation:
 # Ninja records the same command hash as the original configured graph.
 assert '\n'not in command and '\r'not in command
 def path(p):
  s=str(p);assert not any(c in s for c in ['\n','\r',':',' ']);return s.replace('$','$$')
 rule=f'verified_original_{index}'
 return (f'rule {rule}\n  command = '+command.replace('$','$$')+'\n  depfile = '+path(target)+'.d\n  deps = gcc\n'
  +'build '+path(target)+': '+rule+' '+path(source)+(' | '+' '.join(path(p)for p in pch_inputs)if pch_inputs else'')+'\n')
def restore_equivalent(payload,build):
 # Validate every member first. A mismatch cannot leave a partial restoration.
 times={}
 for name,data in payload.items():
  p=build/name;assert p.resolve().is_relative_to(build.resolve())and p.is_file()and not p.is_symlink()
  assert gate.digest(p)==sha(data),'Fresh compilation differs from prior object or depfile: '+name
  s=p.stat();times[name]=(s.st_atime_ns,s.st_mtime_ns,s.st_mode&0o777)
 for name,data in payload.items():
  p=build/name;tmp=p.with_name(p.name+'.verified-restore');assert not tmp.exists()
  tmp.write_bytes(data);os.chmod(tmp,times[name][2]);os.replace(tmp,p)
  os.utime(p,ns=times[name][:2]);assert gate.digest(p)==sha(data)
 return {'files':len(payload),'bytes':sum(map(len,payload.values())),'freshByteEquivalenceRequired':True,'freshMetadataMtimePreserved':True}

def plan_compiles(log,targets):
 planned=[]
 for line in log.splitlines():
  if not re.match(r'^\[\d+/\d+\] ',line):continue
  command=line.split('] ',1)[1];a=shlex.split(command)
  if '-o'in a and a[a.index('-o')+1]in targets:planned.append(a[a.index('-o')+1])
 return planned
def require_expanded_plan(log):
 assert '--regenerate-during-build'not in log,'Pending manifest regeneration is not an expanded compilation plan'

def settled_inspection_graph(graph):
 # This snapshot is inspected only after the real manifest refresh and a
 # byte-identical config/graph check. Every compilation/link/header edge stays
 # verbatim. Exclude just the already-settled CMake manifest output edge, whose
 # always-checked glob stamp makes Ninja dry-run stop before target expansion.
 lines=graph.splitlines(keepends=True);indexes=[i for i,l in enumerate(lines)if l.startswith('build ')and ': RERUN_CMAKE 'in l]
 assert len(indexes)==1,'One exact CMake manifest edge required';start=indexes[0];end=start+1
 outputs=lines[start][6:].split(': ',1)[0].split();assert outputs[0]=='build.ninja'
 assert all(pathlib.PurePosixPath(v).name=='cmake_install.cmake'for v in outputs[1:]),'Unexpected manifest output'
 while end<len(lines)and lines[end].startswith((' ','\t')):
  assert lines[end].strip()=='pool = console','Unexpected manifest edge property';end+=1
 block=''.join(lines[start:end]);snapshot=''.join(lines[:start]+lines[end:])
 assert graph==''.join(lines[:start])+block+''.join(lines[end:])
 return snapshot,{'originalSha256':sha(graph.encode()),'snapshotSha256':sha(snapshot.encode()),'removedBlockSha256':sha(block.encode()),'removedBlock':block,'onlyManifestEdgeExcluded':True,'compilationAndLinkEdgesUnchanged':True}

class RestoreGate(gate.Gate):
 def __init__(self,root,start):
  super().__init__(root,start)
  assert gate.digest(ARTIFACT)==ARTIFACT_SHA and ARTIFACT.stat().st_size==10077772
  self.oldzip=zipfile.ZipFile(ARTIFACT);self.old=json.loads(self.oldzip.read('result.json'))
  assert self.old['status']=='passed-actual-selected-TUs-not-engine-or-package'
  self.payload=object_payload(self.oldzip.read('selected-objects.tar.gz'),self.old['objectRetention'])
  self.seed=self.build/'verified-selected.ninja';self.rules=[]
  self.report.update(scope='clean-job selected-object restore and relocatable partial link only',sourceRun=SOURCE_RUN,sourceArtifactSha256=ARTIFACT_SHA,legacy2526CacheRestored=False,fullEngineLinkAttempted=False,crossJobSelectedObjectsRestored=False)
  self.persist()
 def before_compilation(self):
  # The base TU gate ran exact name generators directly. Register their normal
  # Ninja command/dependency state too; otherwise a full-graph dry run can
  # correctly request regeneration even though the header bytes already exist.
  available=(self.out/'ninja-targets.log').read_text();targets=set(l.rsplit(': ',1)[0]for l in available.splitlines())
  names=gate.contract.generated_webcore_headers(targets,self.build)
  plan=self.run('restore-name-header-plan',['ninja','-t','commands',*names],30,self.build)
  gate.contract.validate_header_plan(plan)
  actual=self.run('restore-name-header-metadata',['ninja','-v','-j','4',*names],60,self.build)
  approved={tuple(shlex.split(line))for line in plan.splitlines()};observed=0
  for line in actual.splitlines():
   if not re.match(r'^\[\d+/\d+\] ',line):continue
   args=shlex.split(line.split('] ',1)[1])
   if len(args)==3 and pathlib.Path(args[0]).name=='cmake'and args[1:] == ['-P',str(self.build/'CMakeFiles/VerifyGlobs.cmake')]:continue
   assert tuple(args)in approved,'Unreviewed header command';observed+=1
  self.report['normalNameHeaderMetadata']={'commands':observed,'noCompilerOrLinker':True}
  generated={str(p.relative_to(self.build)):gate.digest(p)for p in self.build.rglob('*.h')if p.is_file()and not p.is_symlink()}
  (self.out/'generated-header-sha256.json').write_text(json.dumps(generated,indent=2)+'\n')
  old=identity(self.old,json.loads(self.oldzip.read('generated-header-sha256.json')),self.oldzip.read('installed-package-inventory.log'))
  current=identity(self.report,json.loads((self.out/'generated-header-sha256.json').read_text()),(self.out/'installed-package-inventory.log').read_bytes())
  require_identity(old,current);controls=[]
  for key in old:
   bad=copy.deepcopy(current);bad[key]={'deliberatelyWrongIdentity':True}
   try:require_identity(old,bad)
   except AssertionError:controls.append({'field':key,'rejected':True,'objectsWritten':0})
   else:raise AssertionError('Mismatch control was accepted: '+key)
  self.report['restoreIdentity']={'matched':True,'sha256':sha(json.dumps(current,sort_keys=True).encode()),'negativeControls':controls};self.persist()
 def compile_attempt(self,name,cmd,env):
  target=cmd[cmd.index('-o')+1];source=cmd[cmd.index('-c')+1]
  graph=(self.out/(name.removeprefix('compile-')+'-graph.log')).read_text()
  lines=[line for line in graph.splitlines()if shlex.split(line)==cmd];assert len(lines)==1
  pch=[cmd[i+2]for i,v in enumerate(cmd)if v=='-include-pch']
  if '-emit-pch'in cmd:pch=[str((self.build/target).with_suffix(''))]
  self.rules.append(seed_rule(len(self.rules),lines[0],target,source,pch));self.seed.write_text(''.join(self.rules))
  result=super().compile_attempt(name,['ninja','-f',str(self.seed),'-d','keepdepfile','-v',target],env)
  if result:
   actual=(self.out/(name+'.log')).read_text();executed=[l.split('] ',1)[1]for l in actual.splitlines()if re.match(r'^\[\d+/\d+\] ',l)]
   assert executed==lines,'Selected Ninja invocation differs from actual configured command'
  return result
 def after_compilation(self):
  old_pch={r['target']:r['sha256']for r in self.old['precompiledHeaders']};new_pch={r['target']:r['sha256']for r in self.report['precompiledHeaders']}
  assert old_pch==new_pch,'Regenerated original-parameter PCH bytes differ'
  self.report['regeneratedPchByteEquality']=True
  # Demonstrate object mismatch rejection before any payload is written.
  bad=dict(self.payload);first=next(iter(bad));bad[first]=bad[first]+b'mismatch-negative-control'
  try:restore_equivalent(bad,self.build)
  except AssertionError as e:
   assert 'Fresh compilation differs'in str(e);self.report['objectMismatchControl']={'rejected':True,'objectsWritten':0}
  else:raise AssertionError('Wrong object accepted')
  self.report['restoration']=restore_equivalent(self.payload,self.build)
  self.report.update(crossJobSelectedObjectsRestored=True,oldCacheRestored=True,restoredSourceVersion='2.54.2');self.persist()
  targets=[r['target']for r in self.report['objects']];all_targets=targets+[r['target']for r in self.report['precompiledHeaders']]
  log=self.run('restored-selected-dry-run',['ninja','-f',str(self.seed),'-n','-v',*all_targets],30,self.build)
  assert 'ninja: no work to do.'in log and not plan_compiles(log,set(all_targets)),'Restored selected graph is dirty'
  self.report['selectedNinjaNoop']=True
  # Normal graph is inspected, never executed: unrelated order-only work may
  # remain, but no restored object/PCH may be scheduled for recompilation.
  log=self.run('restored-full-graph-dry-run',['ninja','-n','-v',*targets],60,self.build)
  self.report['normalDryRunManifestPending']='--regenerate-during-build'in log;self.persist()
  names=['build.ninja','CMakeFiles/rules.ninja','compile_commands.json','cmakeconfig.h','CMakeCache.txt']
  before={n:gate.digest(self.build/n)for n in names}
  refreshed=self.run('restore-refresh-manifest',['ninja','-v','build.ninja'],60,self.build)
  allowed=[['cmake','-P',str(self.build/'CMakeFiles/VerifyGlobs.cmake')],['cmake','--regenerate-during-build','-S'+str(self.source),'-B'+str(self.build)]]
  for line in refreshed.splitlines():
   if not re.match(r'^\[\d+/\d+\] ',line):continue
   args=shlex.split(line.split('] ',1)[1]);args[0]=pathlib.Path(args[0]).name
   assert args in allowed,'Unexpected manifest refresh command'
  assert before=={n:gate.digest(self.build/n)for n in names},'Graph/config changed during manifest refresh'
  snapshot,proof=settled_inspection_graph((self.build/'build.ninja').read_text())
  inspection=self.build/'restored-normal-inspection.ninja';inspection.write_text(snapshot)
  (self.out/'normal-graph-snapshot-proof.json').write_text(json.dumps(proof,indent=2)+'\n')
  log=self.run('restored-expanded-graph-dry-run',['ninja','-f',str(inspection),'-n','-v',*targets],60,self.build)
  require_expanded_plan(log)
  dirty=plan_compiles(log,set(all_targets));self.report['normalGraphSelectedRecompiles']=dirty
  self.report['normalGraphPlannedCommands']=len(re.findall(r'^\[\d+/\d+\] ',log,re.M))
  self.report['normalGraphInspection']={'actualManifestRefresh':True,'identityUnchanged':before,'snapshotSha256':proof['snapshotSha256'],'onlySettledManifestEdgeExcluded':True,'compilationAndLinkEdgesUnchanged':True,'expanded':True};self.persist()
  cache=gate.boundary.cache_values(self.build/'CMakeCache.txt');linker=pathlib.Path(cache['CMAKE_LINKER']);assert linker.is_file()
  self.report['partialLinker']={'path':str(linker),'sha256':gate.digest(linker.resolve())}
  partial=self.build/'restored-selected-partial.o'
  self.run('restored-relocatable-link',[str(linker),'-r','--fatal-warnings','-o',str(partial),*targets],90,self.build)
  header=self.run('partial-elf-header',['readelf','-h',str(partial)],15,self.build)
  assert re.search(r'Type:\s+REL',header)and 'Advanced Micro Devices X86-64'in header
  self.run('partial-elf-symbols',['readelf','-sW',str(partial)],30,self.build)
  self.report['relocatableLink']={'passed':True,'bytes':partial.stat().st_size,'sha256':gate.digest(partial),'fullSharedLibraryLink':False,'binaryRetained':False};self.persist()
  # Content binding for any later incremental-state proposal. Host dependencies
  # are read only, never retimed or modified. No future reuse is presumed.
  paths=set()
  for name in self.payload:
   if name.endswith('.d'):
    text=(self.build/name).read_text().replace('\\\n','');parts=shlex.split(text);assert parts[0].endswith(':');paths.update(parts[1:])
  inputs={}
  for name in sorted(paths):
   path=pathlib.Path(name);path=path if path.is_absolute()else self.build/path
   assert path.is_file();s=path.stat();inputs[str(path)]={'sha256':gate.digest(path),'bytes':s.st_size,'mtimeNs':s.st_mtime_ns,'resolved':str(path.resolve())}
  (self.out/'current-object-inputs.json').write_text(json.dumps(inputs,indent=2)+'\n')
  self.report['currentInputFiles']=len(inputs)
  for name in ['.ninja_log','.ninja_deps','verified-selected.ninja']:
   p=self.build/name;assert p.is_file()and p.stat().st_size<16*1024**2;shutil.copyfile(p,self.out/name.removeprefix('.'))
  self.report['incrementalMetadataRetained']=True;self.resource('restore-and-partial-link-complete');self.persist()
  assert not dirty,'Normal graph still schedules restored selected compilation; evidence retained'
  self.report['normalGraphCompilationReadinessProven']=True;self.persist()
 def execute(self):
  super().execute();self.report['status']=PASS;self.persist()
 def retain(self):
  super().retain()
  if self.report.get('crossJobSelectedObjectsRestored'):
   self.report['objectRetention']['crossJobRestoreProven']=True
   self.report['objectRetention']['restoreProofScope']='same 2.54.2 selected bytes after independent clean recompilation; not full-engine cache'
   self.persist()
def main():
 p=argparse.ArgumentParser();p.add_argument('--root',type=pathlib.Path,required=True);p.add_argument('--started',type=float,required=True);a=p.parse_args();g=RestoreGate(a.root.resolve(),a.started)
 try:g.execute()
 except Exception as e:g.report.update(status='failed',error=str(e),traceback=traceback.format_exc(limit=12));g.persist()
 finally:
  try:g.retain()
  except Exception as e:g.report.update(status='failed',retentionError=repr(e));g.persist()
 print(json.dumps({k:g.report.get(k)for k in ['status','stage','error','elapsedSeconds']},indent=2));return 0 if g.report['status']==PASS else 1
if __name__=='__main__':raise SystemExit(main())

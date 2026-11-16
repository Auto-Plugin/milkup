"""Two clean jobs: real new objects, content-bound checkpoint, zero old compiles.
No PCH or 2.52.6 cache is used. Original Ninja compiler edges execute unchanged.
"""
import argparse,copy,hashlib,io,json,os,pathlib,re,shlex,shutil,struct,tarfile,time,traceback
import current_tu_gate as gate
import current_object_restore as restored
SCHEMA='milkup-current2542-native-objects-v1'
FIRST=24;NEXT=4;MAX_BYTES=256*1024**2
PASS='passed-real-object-segment-not-engine-or-package'
GRAPH_FILES=['build.ninja','CMakeFiles/rules.ninja','compile_commands.json','cmakeconfig.h','CMakeCache.txt']
def graph_identity(build):return {name:gate.digest(build/name)for name in GRAPH_FILES}
def generated_identity(build):return {str(p.relative_to(build)):gate.digest(p)for p in build.rglob('*.h')if p.is_file()and not p.is_symlink()}
def sha(b):return hashlib.sha256(b).hexdigest()
def canonical(v):return sha(json.dumps(v,sort_keys=True,separators=(',',':')).encode())
def object_bytes(b):
 assert len(b)>=64 and b[:6]==b'\x7fELF\x02\x01'and struct.unpack_from('<HH',b,16)==(1,62),'Expected AMD64 ELF relocatable object only'
def commands(log):
 return [shlex.split(l.split('] ',1)[1])for l in log.splitlines()if re.match(r'^\[\d+/\d+\] ',l)]
def target_of(a):return a[a.index('-o')+1]if '-o'in a else None
def match_original(entry,cmd,build):
 expected=entry.get('arguments')or shlex.split(entry['command']);target=target_of(expected)
 assert expected.count('-c')==expected.count('-o')==1 and pathlib.Path(expected[0]).name in ['clang','clang++']
 assert pathlib.Path(expected[expected.index('-c')+1]).suffix=='.c'and '-include-pch'not in expected
 assert pathlib.Path(entry['directory'])==build and (build/target).resolve().is_relative_to(build)
 assert pathlib.Path(cmd[0]).name=='ccache'and cmd[1]==expected[0];actual=cmd[1:].copy()
 assert actual.count('-MD')==1;actual.remove('-MD')
 for flag,value in [('-MT',target),('-MF',target+'.d')]:
  assert actual.count(flag)==1;i=actual.index(flag);assert actual[i+1]==value;del actual[i:i+2]
 assert actual==expected,'Actual compiler flags differ from configured compile DB'
 return target

def select_entries(database,plan,build,count=FIRST+NEXT):
 by_target={target_of(e.get('arguments')or shlex.split(e['command'])):e for e in database};selected=[];seen=set()
 for line in plan.splitlines():
  args=shlex.split(line);target=target_of(args)
  if not target or target in seen or not target.startswith('Source/bmalloc/CMakeFiles/bmalloc.dir/libpas/')or not target.endswith('.c.o'):continue
  assert target in by_target;entry=by_target[target];match_original(entry,args,build)
  selected.append({'target':target,'entry':entry,'command':args});seen.add(target)
  if len(selected)==count:break
 assert len(selected)==count,'Enough previously uncompiled actual dependency objects required'
 return selected

def log_rows(path,targets):
 lines=path.read_text().splitlines();assert lines and lines[0]in ['# ninja log v5','# ninja log v7'];rows={}
 for line in lines[1:]:
  fields=line.split('\t');assert len(fields)==5,'Unknown Ninja log layout'
  if fields[3]not in targets:continue
  assert all(v.isdigit()for v in fields[:3])and re.fullmatch('[a-f0-9]{1,16}',fields[4]);rows[fields[3]]=line
 assert set(rows)==set(targets),'Every completed object needs a native Ninja log record'
 return lines[0],rows

def input_records(build,source,targets):
 names=set()
 for target in targets:
  fields=shlex.split((build/(target+'.d')).read_text().replace('\\\n',''));assert fields and fields[0]==target+':'
  for name in fields[1:]:
   p=pathlib.Path(name);p=p if p.is_absolute()else build/p;names.add(str(p.resolve()))
 records={}
 for name in sorted(names):
  p=pathlib.Path(name);owned=p.is_relative_to(build)or p.is_relative_to(source)
  assert owned or p.is_relative_to('/usr')or p.is_relative_to('/lib'),'Unknown compiler input root'
  assert p.is_file()and not p.is_symlink();s=p.stat()
  records[name]={'sha256':gate.digest(p),'bytes':s.st_size,'mtimeNs':s.st_mtime_ns,'owned':owned}
 assert records and len(records)<20000;return records

def check_inputs(records,build,source):
 # Validate every input before restoring any object or changing owned metadata.
 for name,row in records.items():
  p=pathlib.Path(name);assert p.is_absolute()and p.resolve()==p and p.is_file()and not p.is_symlink()
  owned=p.is_relative_to(build)or p.is_relative_to(source);assert owned==row['owned']
  assert owned or p.is_relative_to('/usr')or p.is_relative_to('/lib')
  stat=p.stat();assert stat.st_size==row['bytes']and gate.digest(p)==row['sha256'],'Changed compiler input: '+name
  if not owned:assert stat.st_mtime_ns==row['mtimeNs'],'Host metadata drift; never retime SDK inputs'

def validate_payload(manifest,payload):
 expected={r['path']:r for r in manifest['files']};assert len(expected)==len(manifest['files'])==len(payload)
 assert expected.keys()==payload.keys();total=0
 for name,data in payload.items():
  row=expected[name];p=pathlib.PurePosixPath(name)
  assert not p.is_absolute()and '..'not in p.parts and str(p)==name
  assert name in ['metadata/ninja_deps','metadata/selected-ninja-log']or (name in manifest['targets']or name.removesuffix('.d')in manifest['targets'])
  assert len(data)==row['bytes']and sha(data)==row['sha256'],'Damaged checkpoint member'
  total+=len(data);assert total<=MAX_BYTES
  if name.endswith('.o'):object_bytes(data)
 assert 0<len(manifest['targets'])<=FIRST+NEXT

def check_identity(actual,expected):
 assert actual.get('schema')==SCHEMA and actual==expected,'Wrong current-version checkpoint identity'

def load_checkpoint(archive,expected_sha,identity):
 return load_checkpoint_bytes(archive.read_bytes(),expected_sha,identity)

def load_checkpoint_bytes(data,expected_sha,identity):
 assert len(data)<=MAX_BYTES and sha(data)==expected_sha,'Checkpoint archive hash mismatch'
 payload={}
 with tarfile.open(fileobj=io.BytesIO(data),mode='r:gz')as tar:
  for member in tar:
   p=pathlib.PurePosixPath(member.name)
   assert member.isfile()and not p.is_absolute()and '..'not in p.parts and str(p)==member.name
   assert member.name not in payload and member.size<=32*1024**2
   payload[member.name]=tar.extractfile(member).read();assert len(payload[member.name])==member.size
   assert sum(map(len,payload.values()))<=MAX_BYTES
 manifest=json.loads(payload.pop('manifest.json'));assert manifest['schema']==SCHEMA;check_identity(manifest['identity'],identity)
 validate_payload(manifest,payload);return manifest,payload

def restore_checkpoint(manifest,payload,build,source):
 validate_payload(manifest,payload);check_inputs(manifest['inputs'],build,source)
 assert not (build/'.ninja_deps').exists(),'Fresh dependency log required before restoration'
 for target in manifest['targets']:
  for name in [target,target+'.d']:assert not (build/name).exists(),'Never overwrite existing compilation'
 header,rows=log_rows_from_bytes(payload['metadata/selected-ninja-log'],manifest['targets'])
 current=(build/'.ninja_log').read_text();assert current.splitlines()[0]==header
 # All content checks finished. Only verified owned source/build timestamps are
 # restored. Host package files remain completely untouched.
 for name,row in manifest['inputs'].items():
  if row['owned']:
   p=pathlib.Path(name);os.utime(p,ns=(p.stat().st_atime_ns,row['mtimeNs']))
 files={r['path']:r for r in manifest['files']}
 for target in manifest['targets']:
  for name in [target,target+'.d']:
   p=build/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(payload[name]);os.utime(p,ns=(files[name]['mtimeNs'],files[name]['mtimeNs']))
 (build/'.ninja_deps').write_bytes(payload['metadata/ninja_deps'])
 with (build/'.ninja_log').open('a')as out:
  if not current.endswith('\n'):out.write('\n')
  for target in manifest['targets']:out.write(rows[target]+'\n')

def log_rows_from_bytes(data,targets):
 lines=data.decode().splitlines();assert lines[0]in ['# ninja log v5','# ninja log v7'];rows={}
 for line in lines[1:]:
  fields=line.split('\t');assert len(fields)==5 and fields[3]in targets and fields[3]not in rows
  assert all(v.isdigit()for v in fields[:3])and re.fullmatch('[a-f0-9]{1,16}',fields[4]);rows[fields[3]]=line
 assert set(rows)==set(targets);return lines[0],rows

def verify_native_deps(text,targets,build):
 rows=re.findall(r'^(.+): #deps \d+, deps mtime (\d+) \((VALID|STALE)\)$',text,re.M)
 assert len(rows)==len(targets)and {r[0]for r in rows}==set(targets),'Exact native dependency target set required'
 for target,mtime,status in rows:
  assert status=='VALID'and int(mtime)==(build/target).stat().st_mtime_ns,'Native dependency output time must match actual object'

def capture_manifest(build,source,targets,identity):
 header,rows=log_rows(build/'.ninja_log',targets);payload={};files=[]
 for target in targets:
  for name in [target,target+'.d']:
   p=build/name;payload[name]=p.read_bytes();files.append({'path':name,'bytes':len(payload[name]),'sha256':sha(payload[name]),'mtimeNs':p.stat().st_mtime_ns})
 payload['metadata/ninja_deps']=(build/'.ninja_deps').read_bytes()
 payload['metadata/selected-ninja-log']=(header+'\n'+'\n'.join(rows[t]for t in targets)+'\n').encode()
 for name in ['metadata/ninja_deps','metadata/selected-ninja-log']:files.append({'path':name,'bytes':len(payload[name]),'sha256':sha(payload[name])})
 manifest={'schema':SCHEMA,'identity':identity,'targets':targets,'files':files,'inputs':input_records(build,source,targets)};validate_payload(manifest,payload)
 return manifest,payload

def write_checkpoint(archive,manifest,payload):
 data={**payload,'manifest.json':json.dumps(manifest,sort_keys=True,separators=(',',':')).encode()}
 with tarfile.open(archive,'w:gz')as tar:
  for name,content in data.items():
   info=tarfile.TarInfo(name);info.size=len(content);info.mode=0o600;tar.addfile(info,io.BytesIO(content))

class Segment(gate.Gate):
 def __init__(self,root,start,mode,incoming=None,expected=None):
  super().__init__(root,start);self.mode=mode;self.incoming=incoming;self.expected=expected;self.entries=[]
  self.report.update(scope='real current-version dependency objects and clean-job checkpoint; not full engine/package',mode=mode,sourceHarnessSha=os.environ.get('GITHUB_SHA'),legacyCacheUsed=False,fullSharedLink=False)
 def before_compilation(self):return False
 def prepare_batch(self):
  before=graph_identity(self.build)
  refreshed=self.run('segment-settle-manifest',['ninja','-v','build.ninja'],60,self.build)
  allowed=[['cmake','-P',str(self.build/'CMakeFiles/VerifyGlobs.cmake')],['cmake','--regenerate-during-build','-S'+str(self.source),'-B'+str(self.build)]]
  for args in commands(refreshed):
   args[0]=pathlib.Path(args[0]).name;assert args in allowed,'Unexpected manifest preparation'
  assert graph_identity(self.build)==before,'Manifest changed after validated configuration'
  available=(self.out/'ninja-targets.log').read_text();assert 'bmalloc_CopyPrivateHeaders: phony'in available
  plan=self.run('segment-private-header-plan',['ninja','-t','commands','bmalloc_CopyPrivateHeaders'],30,self.build);gate.contract.validate_header_plan(plan)
  actual=self.run('segment-private-headers',['ninja','-v','-j','4','bmalloc_CopyPrivateHeaders'],120,self.build)
  if re.search(r'^\[\d+/\d+\] ',actual,re.M):gate.contract.validate_header_execution(actual,plan,self.build)
  plan=self.run('segment-dependency-order',['ninja','-t','commands','bmalloc'],30,self.build)
  self.entries=select_entries(json.loads((self.build/'compile_commands.json').read_text()),plan,self.build)
  assert all(not (self.build/e['target']).exists()for e in self.entries)
  self.report['segmentEntries']=self.entries;self.report['objects']=[];self.report['priorSelectedTUsExecuted']=False;self.report['PchUsed']=False
  generated=generated_identity(self.build)
  (self.out/'generated-header-sha256.json').write_text(json.dumps(generated,indent=2)+'\n')
  self.identity={'graph':graph_identity(self.build),'schema':SCHEMA,'harnessSha':os.environ.get('GITHUB_SHA'),'configuration':restored.identity(self.report,generated,(self.out/'installed-package-inventory.log').read_bytes()),'entries':self.entries}
  self.report['checkpointIdentitySha256']=canonical(self.identity);self.persist()
  deps=self.run('segment-fresh-deps',['ninja','-t','deps'],15,self.build);assert not deps.strip()and not (self.build/'.ninja_deps').exists(),'Fresh job must have no compiled dependency state'
 def execute_batch(self,entries,name,expected_compiles):
  targets=[e['target']for e in entries];by_target={e['target']:e['command']for e in self.entries}
  plan=self.run(name+'-plan',['ninja','-t','commands',*targets],30,self.build)
  for line in plan.splitlines():
   args=shlex.split(line)
   if '-c'in args and '-o'in args:assert target_of(args)in targets and args==by_target[target_of(args)]
   else:
    gate.contract.validate_header_plan(line)
    assert not any(str(self.build/'bin/')in a for a in args),'Unbuilt helper execution is outside this batch'
  try:log=self.run(name,['ninja','-v','-d','keepdepfile','-k','0','-j','2',*targets],900,self.build,{**os.environ,'CCACHE_DISABLE':'1'},allow_nonzero=True)
  finally:self.completed()
  assert self.report['steps'][-1]['exitCode']==0,name+' compilation failed; completed evidence retained'
  compiled=[]
  for args in commands(log):
   if '-c'in args and '-o'in args:
    target=target_of(args);assert target in targets and args==by_target[target];compiled.append(target)
   elif any(pathlib.Path(a).name in ['clang','clang++','gcc','g++','ccache','ld','ar']for a in args):raise AssertionError('Unexpected compiler/linker invocation')
  assert len(compiled)==len(set(compiled))and set(compiled)==set(expected_compiles),'Actual compiler invocations differ from the expected new-only batch'
  self.report.setdefault('actualBatches',[]).append({'stage':name,'targets':targets,'actualCompiles':compiled,'expectedCompiles':expected_compiles});self.persist();self.resource(name+'-complete')
 def completed(self):
  if not self.entries:return
  rows=[]
  for e in self.entries:
   p=self.build/e['target'];d=self.build/(e['target']+'.d')
   if p.is_file()and d.is_file():
    try:object_bytes(p.read_bytes());log_rows(self.build/'.ninja_log',[e['target']])
    except AssertionError:continue
    rows.append({'target':e['target'],'source':e['entry']['file'],'bytes':p.stat().st_size,'sha256':gate.digest(p),'command':e['command']})
  self.report['objects']=rows;self.persist()
 def checkpoint(self,entries):
  assert graph_identity(self.build)==self.identity['graph'],'Graph or ABI changed during batch'
  assert generated_identity(self.build)==self.identity['configuration']['generatedHeaders'],'Generated input set changed during batch'
  targets=[e['target']for e in entries];assert len(targets)==len(self.report['objects'])
  deps=self.run('segment-completed-deps',['ninja','-t','deps'],30,self.build)
  verify_native_deps(deps,targets,self.build)
  manifest,payload=capture_manifest(self.build,self.source,targets,self.identity)
  folder=self.out/'checkpoint';folder.mkdir();archive=folder/'checkpoint.tar.gz';write_checkpoint(archive,manifest,payload)
  self.report['checkpoint']={'sha256':gate.digest(archive),'bytes':archive.stat().st_size,'targets':targets,'inputCount':len(manifest['inputs']),'containsRuntime':False,'containsPch':False};self.persist()
  return archive
 def partial_link(self,entries):
  linker=gate.boundary.cache_values(self.build/'CMakeCache.txt')['CMAKE_LINKER'];output=self.build/'segment-partial.o'
  self.run('segment-partial-link',[linker,'-r','--fatal-warnings','-o',str(output),*[e['target']for e in entries]],90,self.build)
  object_bytes(output.read_bytes());self.report['partialLink']={'sha256':gate.digest(output),'bytes':output.stat().st_size,'kind':'ELF REL only','fullEngine':False};self.persist()
 def execute(self):
  super().execute();self.prepare_batch();first=self.entries[:FIRST]
  if self.mode=='build':
   self.execute_batch(first,'segment-new-batch',[e['target']for e in first]);completed=first
  else:
   assert self.incoming and self.expected and re.fullmatch('[a-f0-9]{64}',self.expected)
   manifest,payload=load_checkpoint(self.incoming,self.expected,self.identity);assert manifest['targets']==[e['target']for e in first]
   rejected=[]
   paths=[(k,)for k in self.identity]+[('configuration',k)for k in self.identity['configuration']]
   for path in paths:
    bad=copy.deepcopy(manifest['identity']);parent=bad
    for key in path[:-1]:parent=parent[key]
    parent[path[-1]]={'changedIdentityControl':True}
    try:check_identity(bad,self.identity)
    except AssertionError:rejected.append('.'.join(path))
    else:raise AssertionError('Wrong checkpoint identity accepted')
   self.report['identityMismatchRejectedBeforeWrite']=rejected
   damaged_archive=bytearray(self.incoming.read_bytes());damaged_archive[len(damaged_archive)//2]^=1
   try:load_checkpoint_bytes(bytes(damaged_archive),self.expected,self.identity)
   except AssertionError:self.report['damagedArchiveRejectedBeforeWrite']=True
   else:raise AssertionError('Damaged archive accepted')
   damaged=dict(payload);damaged[first[0]['target']]=damaged[first[0]['target']]+b'corruption'
   try:validate_payload(manifest,damaged)
   except AssertionError:self.report['damagedObjectRejectedBeforeWrite']=True
   else:raise AssertionError('Damaged object accepted')
   source=pathlib.Path(first[0]['entry']['file']);assert str(source.resolve())in manifest['inputs'];data=source.read_bytes();stat=source.stat()
   try:
    source.write_bytes(data+b'\n/* changed input control */\n')
    try:check_inputs(manifest['inputs'],self.build,self.source)
    except AssertionError as e:assert 'Changed compiler input'in str(e);self.report['actualChangedInputRejectedBeforeWrite']=True
    else:raise AssertionError('Changed real input accepted')
   finally:source.write_bytes(data);os.utime(source,ns=(stat.st_atime_ns,stat.st_mtime_ns))
   assert all(not (self.build/e['target']).exists()for e in first)
   restore_checkpoint(manifest,payload,self.build,self.source);self.report['restoredWithoutFreshCompilation']=FIRST;self.persist()
   self.execute_batch(first,'segment-restored-skip',[])
   assert all(gate.digest(self.build/e['target'])==sha(payload[e['target']])for e in first)
   self.execute_batch(self.entries,'segment-forward-progress',[e['target']for e in self.entries[FIRST:]])
   self.report['newUniqueObjectsAfterRestore']=NEXT;completed=self.entries
  self.partial_link(completed);archive=self.checkpoint(completed)
  self.report['status']=PASS;self.persist()
  if os.environ.get('GITHUB_OUTPUT'):
   with open(os.environ['GITHUB_OUTPUT'],'a')as out:out.write('checkpoint_sha256='+gate.digest(archive)+'\n')

def main():
 p=argparse.ArgumentParser();p.add_argument('--root',type=pathlib.Path,required=True);p.add_argument('--started',type=float,required=True);p.add_argument('--mode',choices=['build','resume'],required=True);p.add_argument('--incoming',type=pathlib.Path);p.add_argument('--expected-sha');a=p.parse_args();g=Segment(a.root.resolve(),a.started,a.mode,a.incoming,a.expected_sha)
 try:g.execute()
 except Exception as e:g.report.update(status='failed',error=str(e),traceback=traceback.format_exc(limit=12));g.persist()
 finally:
  try:g.completed();g.retain()
  except Exception as e:g.report.update(status='failed',retentionError=repr(e));g.persist()
 print(json.dumps({k:g.report.get(k)for k in ['status','stage','error','elapsedSeconds']},indent=2));return 0 if g.report['status']==PASS else 1
if __name__=='__main__':raise SystemExit(main())

"""Content-bound normal Ninja frontier. No ELF executables/shared runtimes or PCH bytes cached.
Generated compiler inputs are included with original graph/output provenance.
PCHs and build-time helper executables must be rebuilt and byte-verified.
"""
import hashlib,json,os,pathlib,re,shlex,shutil,stat,struct,tarfile
import current_segment as seg
SCHEMA='milkup-current2542-frontier-v3'
MAX_TOTAL=8*1024**3
MAX_MEMBER=256*1024**2
HELPERS={'bin/LLIntSettingsExtractor','bin/LLIntOffsetsExtractor'}
META={'metadata/ninja_log','metadata/ninja_deps'}
def digest(p):
 h=hashlib.sha256()
 with p.open('rb')as f:
  while b:=f.read(1024**2):h.update(b)
 return h.hexdigest()
def relative(name,build):
 p=pathlib.Path(name);p=p if p.is_absolute()else build/p
 assert '..'not in p.parts and p.is_relative_to(build),'Output outside owned build'
 return str(p.relative_to(build))
def safe_path(build,name):
 p=pathlib.PurePosixPath(name);assert not p.is_absolute()and '..'not in p.parts and str(p)==name
 result=build/name;assert result.parent.resolve().is_relative_to(build),'Output parent escapes build'
 return result

def native_rows(build):
 lines=(build/'.ninja_log').read_text().splitlines();assert lines[0]in ['# ninja log v5','# ninja log v7'];rows={}
 for line in lines[1:]:
  fields=line.split('\t');assert len(fields)==5 and all(v.isdigit()for v in fields[:3])and re.fullmatch('[a-f0-9]{1,16}',fields[4])
  relative(fields[3],build);rows[fields[3]]=line
 return lines[0],rows

def compile_entries(database,plan,build):
 expected={seg.target_of(e.get('arguments')or shlex.split(e['command'])):e for e in database};found={}
 for line in plan.splitlines():
  a=shlex.split(line)
  if not a or pathlib.Path(a[0]).name!='ccache':continue
  assert len(a)>2 and pathlib.Path(a[1]).name in ['clang','clang++'],'Unknown compiler launcher'
  target=seg.target_of(a);assert target in expected
  e=expected[target];args=e.get('arguments')or shlex.split(e['command']);actual=a[1:].copy()
  assert args.count('-c')==args.count('-o')==1 and pathlib.Path(e['directory'])==build
  assert actual.count('-MD')==1;actual.remove('-MD')
  for flag,value in [('-MT',target),('-MF',target+'.d')]:
   assert actual.count(flag)==1;i=actual.index(flag);assert actual[i+1]==value;del actual[i:i+2]
  assert actual==args,'Original compiler command changed'
  assert target.endswith(('.o','.pch'))and relative(target,build)==target
  item={'target':target,'command':a,'source':e['file'],'kind':'pch'if '-emit-pch'in a else'object'}
  assert item['kind']!='pch'or ('-fno-pch-timestamp'in a and '-include-pch'not in a),'PCH must be deterministic leaf with original flags'
  assert target not in found or found[target]==item;found[target]=item
 assert found;return found

def helper_commands(plan):
 found={}
 for line in plan.splitlines():
  a=shlex.split(line)
  if '-c'in a or '-o'not in a:continue
  target=seg.target_of(a)
  if target in HELPERS:
   assert a[:2]==[':','&&']and '/usr/bin/clang++'in a and a[-2:]==['&&',':']
   assert target not in found or found[target]==line;found[target]=line
 return found

def link_entries(plan,build):
 found={}
 for line in plan.splitlines():
  a=shlex.split(line);deps=[v.split('--dependency-file=',1)[1]for v in a if v.startswith('--dependency-file=')]
  if not deps or '/usr/bin/clang++'not in a:continue
  assert '-c'not in a and len(deps)==1 and '-o'in a
  target=seg.target_of(a);assert relative(target,build)==target
  assert target.startswith(('bin/','lib/')) and '/usr/bin/clang++'in a
  depfile=relative(deps[0],build);assert depfile.endswith('.d')
  item={'command':line,'depfile':depfile};assert target not in found or found[target]==item;found[target]=item
 return found

def dep_names(file,target,build):
 lines=[shlex.split(line)for line in file.read_text().replace('\\\n','').splitlines()if line.strip()]
 assert lines and lines[0][0]in [target+':',str(build/target)+':'],'Exact depfile target required'
 names=lines[0][1:]
 # Linker depfiles can contain empty phony rules for their inputs.
 for row in lines[1:]:assert len(row)==1 and row[0].endswith(':')and row[0][:-1]in names,'Unexpected extra dependency rule'
 return names

def dependency_inputs(build,source,pairs):
 names={}
 for target,file in pairs:
  for name in dep_names(file,target,build):
   p=pathlib.Path(name);p=p if p.is_absolute()else build/p;names[str(p.resolve())]=None
 assert len(names)<=60000
 for name in names:
  p=pathlib.Path(name);owned=p.is_relative_to(build)or p.is_relative_to(source)
  assert owned or p.is_relative_to('/usr')or p.is_relative_to('/lib')
  assert p.is_file()and not p.is_symlink();st=p.stat()
  names[name]={'sha256':digest(p),'bytes':st.st_size,'mtimeNs':st.st_mtime_ns,'owned':owned}
 return names

def check_identity(manifest,identity):
 assert manifest.get('schema')==SCHEMA and manifest['identity']==identity,'Frontier identity mismatch'

def describe(p,build,source,kind=None):
 name=str(p.relative_to(build));row={'path':name}
 if p.is_symlink():
  resolved=p.resolve();assert (resolved.is_file()or resolved.is_dir())and (resolved.is_relative_to(build)or resolved.is_relative_to(source))
  if resolved.is_dir():return {**row,'kind':'directory-symlink','target':os.readlink(p),'resolved':str(resolved)}
  return {**row,'kind':'symlink','target':os.readlink(p),'resolved':str(resolved),'sha256':digest(resolved),'bytes':resolved.stat().st_size,'mtimeNs':resolved.stat().st_mtime_ns}
 if not p.exists():return {**row,'kind':'missing'}
 if p.is_dir():return {**row,'kind':'directory','mtimeNs':p.stat().st_mtime_ns}
 assert p.is_file(),'Unknown output type';st=p.stat();assert not(st.st_mode&0o7000),'Special executable mode forbidden'
 with p.open('rb')as f:magic=f.read(8)
 if kind is None:
  if magic.startswith(b'\x7fELF')or magic==b'!<arch>\n'or p.suffix=='.gresource':kind='link'
  else:kind='generated'
 if kind=='object':
  with p.open('rb')as f:seg.object_bytes(f.read(64))
 if kind=='pch':assert magic.startswith(b'CPCH'),'Original Clang PCH required'
 return {**row,'kind':kind,'bytes':st.st_size,'sha256':digest(p),'mtimeNs':st.st_mtime_ns,'mode':stat.S_IMODE(st.st_mode)}

def compiler_inputs(build,source,targets):
 return dependency_inputs(build,source,[(t,build/(t+'.d'))for t in targets])

def capture(build,source,entries,identity,frontier,helper_plan,links=None,evidence=None):
 links=links or {}
 header,logs=native_rows(build)
 import subprocess
 deps=subprocess.check_output(['ninja','-t','deps'],cwd=build,text=True,timeout=60)
 if evidence:
  import gzip
  evidence.mkdir(parents=True,exist_ok=True)
  for name,data in [('native-deps.txt',deps.encode()),('native-ninja-log.txt',(build/'.ninja_log').read_bytes())]:
   assert len(data)<=64*1024**2;(evidence/(name+'.gz')).write_bytes(gzip.compress(data,mtime=0))
 completed=re.findall(r'^(.+): #deps \d+, deps mtime (\d+) \((VALID|STALE)\)$',deps,re.M)
 assert completed and len(completed)<=4000
 targets=[];completed_links=[];absent_links=[]
 for target,mtime,status in completed:
  assert target in entries or target in links,('Unknown original dependency target',target,status)
  if target in links and not(build/target).exists()and target not in logs:
   assert status=='STALE';absent_links.append(target);continue
  assert target in logs and status=='VALID',('Invalid dependency/log record',target,status)
  assert (build/target).is_file()and (build/target).stat().st_mtime_ns==int(mtime),('Output mtime mismatch',target)
  (targets if target in entries else completed_links).append(target)
 selected={t:entries[t]for t in targets}
 link_inputs={t:dependency_inputs(build,source,[(t,build/links[t]['depfile'])])for t in completed_links}
 inputs=compiler_inputs(build,source,targets)
 for t,e in selected.items():
  a=e['command']
  if '-include-pch'in a:
   i=a.index('-include-pch');assert a[i+1]=='-Xclang';p=pathlib.Path(a[i+2]);assert p.is_relative_to(build)
   inputs[str(p)]={'sha256':digest(p),'bytes':p.stat().st_size,'mtimeNs':p.stat().st_mtime_ns,'owned':True}
 records={}
 for target,line in logs.items():
  name=relative(target,build);p=build/name
  kind=entries[name]['kind']if name in selected else None
  records[name]=describe(p,build,source,kind)
 for t in targets:
  records[t]=describe(build/t,build,source,selected[t]['kind']);records[t+'.d']=describe(build/(t+'.d'),build,source,'depfile')
 for t in completed_links:records[links[t]['depfile']]=describe(build/links[t]['depfile'],build,source,'depfile')
 all_inputs={**inputs,**{n:r for rows in link_inputs.values()for n,r in rows.items()}}
 for name,row in all_inputs.items():
  p=pathlib.Path(name)
  if p.is_relative_to(build)and str(p.relative_to(build))not in records:records[str(p.relative_to(build))]=describe(p,build,source)
 for name in HELPERS:
  if name in records and records[name]['kind']=='link':assert name in helper_plan
 payload={}
 for name,row in records.items():
  if row['kind']in ['object','generated','depfile']:
   assert row['bytes']<=MAX_MEMBER;payload['build/'+name]=build/name
 payload['metadata/ninja_log']=build/'.ninja_log';payload['metadata/ninja_deps']=build/'.ninja_deps'
 files={k:{'bytes':p.stat().st_size,'sha256':digest(p)}for k,p in payload.items()}
 assert sum(x['bytes']for x in files.values())<=MAX_TOTAL and len(records)<50000
 manifest={'schema':SCHEMA,'identity':identity,'frontier':frontier,'entries':selected,'inputs':inputs,'records':records,'files':files,'logHeader':header,'logs':logs,'helpers':helper_plan,'links':links,'linkInputs':link_inputs,'absentUnrestoredLinks':absent_links,'producerSha':os.environ.get('GITHUB_SHA'),'compiledObjectCount':sum(e['kind']=='object'for e in selected.values()),'pchCount':sum(e['kind']=='pch'for e in selected.values()),'runtimeBytesArchived':False,'pchBytesArchived':False}
 return manifest,payload

def write_archive(path,manifest,payload):
 import io
 data=json.dumps(manifest,sort_keys=True,separators=(',',':')).encode();assert len(data)<=32*1024**2
 with tarfile.open(path,'w:gz',compresslevel=1)as out:
  info=tarfile.TarInfo('manifest.json');info.size=len(data);info.mode=0o600;out.addfile(info,io.BytesIO(data))
  for name,p in payload.items():
   assert p.is_file()and not p.is_symlink();row=manifest['files'][name];assert p.stat().st_size==row['bytes']and digest(p)==row['sha256']
   info=tarfile.TarInfo(name);info.size=row['bytes'];info.mode=0o600
   with p.open('rb')as f:out.addfile(info,f)
 assert path.stat().st_size<=2*1024**3,'Compressed frontier budget exceeded'

def load_archive(archive,expected,identity,staging):
 assert archive.stat().st_size<=2*1024**3 and digest(archive)==expected,'Damaged frontier archive'
 with tarfile.open(archive,'r:gz')as tar:
  first=tar.next();assert first and first.name=='manifest.json'and first.isfile()and first.size<=32*1024**2
  manifest=json.load(tar.extractfile(first));check_identity(manifest,identity)
  assert len(manifest['records'])<50000 and sum(x['bytes']for x in manifest['files'].values())<=MAX_TOTAL
  assert not staging.exists();staging.mkdir();seen=set()
  while member:=tar.next():
   assert member.name!='manifest.json','Duplicate manifest'
   assert member.isfile()and member.name in manifest['files']and member.name not in seen
   row=manifest['files'][member.name];assert member.size==row['bytes']<=MAX_MEMBER
   p=safe_path(staging,member.name);p.parent.mkdir(parents=True,exist_ok=True)
   with tar.extractfile(member)as src,p.open('wb')as dest:shutil.copyfileobj(src,dest,1024**2)
   assert digest(p)==row['sha256'],'Damaged frontier member';seen.add(member.name)
  assert seen==manifest['files'].keys(),'Missing frontier member'
 return manifest

def validate_existing(manifest,build,source):
 # All host/source and existing generated input checks happen before restoring.
 all_inputs={**manifest['inputs'],**{n:r for rows in manifest.get('linkInputs',{}).values()for n,r in rows.items()}}
 for name,row in all_inputs.items():
  p=pathlib.Path(name);assert p.is_absolute()and p.resolve()==p
  owned=p.is_relative_to(build)or p.is_relative_to(source);assert owned==row['owned']
  assert owned or p.is_relative_to('/usr')or p.is_relative_to('/lib')
  if p.is_relative_to(build)and not p.exists():
   rec=manifest['records'].get(str(p.relative_to(build)));assert rec and rec['sha256']==row['sha256'];continue
  assert p.is_file()and p.stat().st_size==row['bytes']and digest(p)==row['sha256'],'Changed compiler input: '+name
  if not owned:assert p.stat().st_mtime_ns==row['mtimeNs'],'Host metadata drift'
 for name,row in manifest['records'].items():
  p=safe_path(build,name)
  if row['kind']in ['object','pch']:assert not p.exists(),'No old object/PCH may be precompiled'
  elif p.exists()or p.is_symlink():
   if row['kind']=='directory':assert p.is_dir()and not p.is_symlink()
   elif row['kind']=='directory-symlink':assert p.is_symlink()and os.readlink(p)==row['target']and str(p.resolve())==row['resolved']and p.resolve().is_dir()
   elif row['kind']=='symlink':assert p.is_symlink()and os.readlink(p)==row['target']and str(p.resolve())==row['resolved']and digest(p.resolve())==row['sha256']
   elif row['kind']=='missing':raise AssertionError('Previously missing output unexpectedly exists: '+name)
   elif row['kind']=='link':assert not p.exists(),'No existing executable/runtime restored as input'
   else:assert p.is_file()and not p.is_symlink()and digest(p)==row['sha256'],'Existing generated file differs: '+name

def restore(manifest,staging,build,source,run,entries,helpers,links=None):
 assert manifest.get('links',{})==(links or {}),'Original dependency-tracked linker edges changed'
 validate_existing(manifest,build,source)
 assert not (build/'.ninja_deps').exists(),'Clean generated-only job required'
 for name,e in manifest['entries'].items():assert name in entries and e==entries[name],'Original compiler edge changed'
 assert manifest['helpers']==helpers,'Original generator link edge changed'
 for name,row in manifest['records'].items():
  p=safe_path(build,name)
  if row['kind']=='directory':p.mkdir(parents=True,exist_ok=True)
  elif row['kind']in ['symlink','directory-symlink']and not p.is_symlink():
   target=(p.parent/row['target']).resolve();assert str(target)==row['resolved']and (target.is_relative_to(source)or target.is_relative_to(build))
   p.parent.mkdir(parents=True,exist_ok=True);p.symlink_to(row['target'])
  elif row['kind']in ['generated','depfile']:
   p.parent.mkdir(parents=True,exist_ok=True)
   if not p.exists():shutil.copyfile(staging/'build'/name,p)
   assert digest(p)==row['sha256'];assert row['mode']&~0o777==0;os.chmod(p,row['mode']);os.utime(p,ns=(row['mtimeNs'],row['mtimeNs']))
 # PCH source/header inputs must already match. No cached PCH binary is loaded.
 nonpch={n:r for n,r in manifest['inputs'].items()if not (pathlib.Path(n).is_relative_to(build)and manifest['records'][str(pathlib.Path(n).relative_to(build))]['kind']=='pch')}
 seg.check_inputs(nonpch,build,source)
 for name,row in nonpch.items():
  if row['owned']:os.utime(name,ns=(row['mtimeNs'],row['mtimeNs']))
 regenerated=[]
 for target,e in manifest['entries'].items():
  if e['kind']!='pch':continue
  run('regenerate-pch-'+str(len(regenerated)),e['command'],600,build,{**os.environ,'CCACHE_DISABLE':'1'})
  row=manifest['records'][target];p=build/target;assert p.stat().st_size==row['bytes']and digest(p)==row['sha256'],'Regenerated PCH differs'
  d=build/(target+'.d');assert digest(d)==manifest['records'][target+'.d']['sha256'];os.utime(p,ns=(row['mtimeNs'],row['mtimeNs']));regenerated.append(target)
 seg.check_inputs(manifest['inputs'],build,source)
 for name,e in manifest['entries'].items():
  if e['kind']!='object':continue
  row=manifest['records'][name];p=build/name;p.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(staging/'build'/name,p)
  assert digest(p)==row['sha256']
  with p.open('rb')as f:seg.object_bytes(f.read(64))
  assert row['mode']&~0o777==0;os.chmod(p,row['mode']);os.utime(p,ns=(row['mtimeNs'],row['mtimeNs']))
 rebuilt=[]
 for name,line in helpers.items():
  if name not in manifest['records']:continue
  if name in manifest.get('linkInputs',{}):seg.check_inputs(manifest['linkInputs'][name],build,source)
  p=build/name;run('regenerate-helper-'+pathlib.Path(name).name,['/bin/sh','-c',line],180,build)
  row=manifest['records'][name];assert p.stat().st_size==row['bytes']and digest(p)==row['sha256'],'Regenerated build helper differs';os.utime(p,ns=(row['mtimeNs'],row['mtimeNs']));rebuilt.append(name)
  if name in manifest.get('links',{}):
   dep=manifest['links'][name]['depfile'];assert digest(build/dep)==manifest['records'][dep]['sha256'],'Regenerated link dependencies differ'
 # Restore original owned input times after regenerating helpers/PCH depfiles.
 for name,row in manifest['inputs'].items():
  if row['owned']:os.utime(name,ns=(row['mtimeNs'],row['mtimeNs']))
 for name,row in manifest['records'].items():
  if row['kind']in ['object','pch','generated','depfile']:
   p=build/name;assert digest(p)==row['sha256'];os.utime(p,ns=(row['mtimeNs'],row['mtimeNs']))
 for name,row in manifest['records'].items():
  if row['kind']=='directory':os.utime(build/name,ns=(row['mtimeNs'],row['mtimeNs']))
 shutil.copyfile(staging/'metadata/ninja_deps',build/'.ninja_deps')
 current=(build/'.ninja_log').read_text();assert current.splitlines()[0]==manifest['logHeader']
 with (build/'.ninja_log').open('a')as out:
  if not current.endswith('\n'):out.write('\n')
  for name,line in manifest['logs'].items():
   rec=manifest['records'][relative(name,build)]
   if rec['kind']!='link'or relative(name,build)in rebuilt:out.write(line+'\n')
 return {'restoredObjects':manifest['compiledObjectCount'],'regeneratedPch':regenerated,'regeneratedHelpers':rebuilt,'runtimeBytesRestored':False}

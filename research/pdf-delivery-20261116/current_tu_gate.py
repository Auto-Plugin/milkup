"""One bounded official-current-source/configure/actual-TU gate, never an engine build.
No old cache restore, runtime install, application launch, or native acceptance.
"""
import argparse,gzip,hashlib,importlib.util,json,os,pathlib,re,shlex,shutil,signal,subprocess,tarfile,time,traceback,urllib.request
import package_boundary as boundary
HERE=pathlib.Path(__file__).resolve().parent;REPO=HERE.parents[1]
SOURCE_SHA=boundary.SOURCE_SHA;PATCH_SHA='855e58cc8ad531cc32e893b8274983a6264e6fdfc248c13e80c5ef0e01d7a4e5'
SOURCE_URL='https://webkitgtk.org/releases/webkitgtk-2.54.2.tar.xz'
EXTRA_SDK_PACKAGES=['clang','cmake','ninja-build','ccache','libgtk-3-dev','libsoup-3.0-dev','libavif-dev','libmanette-0.2-dev','flite1-dev','libbacktrace-dev','libsysprof-capture-4-dev','libgstreamer-plugins-bad1.0-dev']
REQUIRED_GST_MODULES=['gstreamer-1.0','gstreamer-app-1.0','gstreamer-pbutils-1.0','gstreamer-video-1.0','gstreamer-mpegts-1.0','gstreamer-tag-1.0','gstreamer-gl-1.0','gstreamer-audio-1.0','gstreamer-fft-1.0']
# Required after OptionsGTK by Skia / Source, checked before configure as well.
REQUIRED_POST_GTK_MODULES=['fontconfig >= 2.13.0','expat','libwebpmux','sysprof-capture-4']
def module(path):
 spec=importlib.util.spec_from_file_location('strict_object_contract',path);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
contract=module(REPO/'scripts/ci/webkit-pagination-object-preflight.py')
def digest(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def official_sources(text,read):
 rows=[]
 for stanza in re.split(r'\n\s*\n',text.strip()):
  fields={k:v.strip()for k,v in re.findall(r'^([A-Za-z-]+):\s*(.*)$',stanza,re.M)}
  if not fields:continue
  assert fields.get('Signed-By')=='/usr/share/keyrings/ubuntu-archive-keyring.gpg'
  assert fields.get('Suites') and all(x in ['resolute','resolute-updates','resolute-security','resolute-backports']for x in fields['Suites'].split())
  official=lambda u:bool(re.fullmatch(r'https?://(?:[a-z0-9-]+\.)?(?:archive|security)\.ubuntu\.com/ubuntu/?',u))
  uris=[]
  for uri in fields['URIs'].split():
   if uri.startswith('mirror+file:'):
    path=uri.removeprefix('mirror+file:');assert path in ['/etc/apt/apt-mirrors.txt','/etc/apt/apt-security-mirrors.txt']
    values=[l.split()[0]for l in read(path).splitlines()if l.strip()and not l.lstrip().startswith('#')]
    values=[u for u in values if official(u)];assert values;uri=values[0]
   assert official(uri);uris.append(uri)
  assert uris
  stanza=re.sub(r'^Types:.*$','Types: deb deb-src',stanza,flags=re.M)
  rows.append(re.sub(r'^URIs:.*$','URIs: '+' '.join(uris),stanza,flags=re.M))
 assert rows;return '\n\n'.join(rows)+'\n'
def validate_apt_plan(text):
 assert not re.search(r'^Remv ',text,re.M),'Dependency removal forbidden'
 installs=re.findall(r'^Inst (\S+)',text,re.M)
 assert not any(re.search('webkit|javascriptcore',p,re.I)for p in installs),'System runtime changes forbidden'
 return installs

def validate_config(cache,config,log,recipe,provided):
 values=boundary.cache_values(cache)
 # Unused command-line settings may look correct in cache. Reject the warning,
 # and independently inspect actual exposed generated definitions.
 assert 'Manually-specified variables were not used by the project'not in log,'Unconsumed CMake option'
 for key,value in provided.items():assert values.get(key)==value,('Configure mismatch',key,values.get(key))
 definitions={}
 for key,value in [('ENABLE_2022_GLIB_API','0'),('ENABLE_DEVELOPER_MODE','0'),('ENABLE_BUBBLEWRAP_SANDBOX','1'),('HAVE_GTK_UNIX_PRINTING','1')]:
  found=re.findall(r'^#define '+key+r'\s+(\S+)\s*$',config.read_text(),re.M)
  assert found==[value],('Generated option mismatch',key,found);definitions[key]=value
 assert re.findall(r'^#define WEBKITGTK_API_VERSION\s+"([^"]+)"',config.read_text(),re.M)==['4.1']
 return {'definitions':definitions,'api':'4.1','configSha256':digest(config),'cacheSha256':digest(cache),'finalPrefix':recipe['prefix']}
def selected_entries(commands,sources,source):
 selected={}
 for rel in sources:
  found=[e for e in commands if contract.unit_contains(e,(source/rel).resolve())]
  assert len(found)==1,('Unique actual TU',rel,len(found));selected[rel]=found[0]
 targets={ (e.get('arguments')or shlex.split(e['command']))[(e.get('arguments')or shlex.split(e['command'])).index('-o')+1]for e in selected.values()}
 assert 1<=len(targets)<=len(sources)==10,'Changed-source/TU budget'
 return selected
def selected_pch_entries(commands,selected,build):
 # Keep the actual Release PCH flags. Compile only explicitly referenced PCHs,
 # not a Ninja umbrella target or every PCH in the full engine database.
 required=set()
 for entry in selected.values():
  args=entry.get('arguments')or shlex.split(entry['command'])
  for i,value in enumerate(args):
   if value!='-include-pch':continue
   assert i>0 and args[i-1]=='-Xclang' and args[i+1]=='-Xclang','Exact Clang PCH argument form required'
   path=pathlib.Path(args[i+2]);assert path.is_absolute()and path.is_relative_to(build)and '..'not in path.parts
   assert path.name=='cmake_pch.hxx.pch';required.add(path)
 assert len(required)<=len(selected)<=10
 result=[]
 for path in sorted(required):
  found=[]
  for e in commands:
   if not e['file'].endswith('/cmake_pch.hxx.cxx'):continue
   a=e.get('arguments')or shlex.split(e['command'])
   if a.count('-o')==1 and (build/a[a.index('-o')+1])==path:found.append(e)
  assert len(found)==1,('Unique configured PCH producer required',str(path),len(found))
  entry=found[0];a=entry.get('arguments')or shlex.split(entry['command'])
  assert pathlib.Path(entry['directory'])==build and pathlib.Path(entry['file'])==path.with_suffix('.cxx')
  assert '-emit-pch'in a and a[a.index('-x')+1]=='c++-header'and '-include-pch'not in a,'PCH must be a leaf header compilation'
  result.append(entry)
 return result
def pch_input_contract(graph,entries,build):
 rows=[]
 for entry in entries:
  a=entry.get('arguments')or shlex.split(entry['command']);target=a[a.index('-o')+1]
  matches=[line for line in graph.splitlines()if line.startswith('build '+target+': ')]
  assert len(matches)==1,'Unique PCH edge required'
  edge=matches[0].split(': ',1)[1].split()
  assert edge[0].startswith('CXX_COMPILER__')and edge.count('|')==edge.count('||')==1
  explicit=edge[1:edge.index('|')];implicit=edge[edge.index('|')+1:edge.index('||')];order=edge[edge.index('||')+1:]
  assert explicit==[entry['file']]and implicit==[target.removesuffix('.pch')]
  assert len(order)==1 and order[0].startswith('cmake_object_order_depends_target_WebCore')
  rows.append({'target':target,'explicit':explicit,'implicit':implicit,'orderOnly':order,'orderOnlyExecuted':False})
 return rows
PCH_GENERATED_HEADERS=['CSSPropertyNames.h','CSSValueKeywords.h','EventInterfaces.h','EventTargetInterfaces.h','FrameTreeSyncData.h','HTMLElementTypeHelpers.h','HTMLNames.h','HTTPHeaderNames.h','Settings.h','StyleComputedStyleProperties.h','WebKitFontFamilyNames.h']
def retain_configuration_stream(stream,destination,expected_bytes,part_limit=32*1024**2,total_limit=128*1024**2):
 # Same 32 MiB per-part bound, lossless split for real larger Ninja/compile DB.
 # The manifest is reconstructible with exact order, sizes and SHA-256, not a
 # truncated proxy. All files together remain bounded by the caller as well.
 assert 0<=expected_bytes<=total_limit,'Configuration evidence total budget exceeded'
 assert 0<part_limit<=32*1024**2
 destination.parent.mkdir(parents=True,exist_ok=True)
 whole=hashlib.sha256();rows=[];count=0
 while True:
  data=stream.read(part_limit)
  if not data:break
  count+=len(data);assert count<=expected_bytes,'Configuration changed while retaining'
  whole.update(data);name=destination.name+f'.part-{len(rows):03d}.gz';path=destination.with_name(name)
  with path.open('wb')as raw:
   with gzip.GzipFile(fileobj=raw,mode='wb',mtime=0,filename='')as out:out.write(data)
  rows.append({'file':name,'rawBytes':len(data),'rawSha256':hashlib.sha256(data).hexdigest(),'storedBytes':path.stat().st_size,'storedSha256':digest(path)})
 assert count==expected_bytes,'Configuration truncated while retaining'
 receipt={'encoding':'ordered-gzip-parts','rawBytes':count,'rawSha256':whole.hexdigest(),'parts':rows}
 destination.with_name(destination.name+'.parts.json').write_text(json.dumps(receipt,indent=2)+'\n')
 return receipt
class Gate:
 def before_compilation(self):pass
 def after_compilation(self):pass
 def __init__(self,root,start):
  assert 0<=time.time()-start<=180,'Workflow start clock must be recent'
  self.root=root;root.mkdir(parents=True,exist_ok=False);self.out=root/'evidence';self.out.mkdir();self.source=root/'source';self.build=root/'build';self.deadline=start+1560;self.start=start
  self.report={'status':'running','scope':'configure/generated headers/selected actual TUs only','harnessSha':os.environ.get('GITHUB_SHA'),'sourceVersion':'2.54.2','sourceArchiveSha256':SOURCE_SHA,'patchSha256':PATCH_SHA,'engineBuildAttempted':False,'runtimeInstalled':False,'oldCacheRestored':False,'jobLimitSeconds':1800,'workLimitSeconds':1560,'steps':[],'objects':[]}
  self.persist()
 def persist(self):(self.out/'result.json').write_text(json.dumps(self.report,indent=2)+'\n')
 def resource(self,label):
  mem={k:v.strip()for k,v in (l.split(':',1)for l in pathlib.Path('/proc/meminfo').read_text().splitlines())}
  row={'label':label,'seconds':round(time.time()-self.start,3),'freeBytes':shutil.disk_usage(self.root).free,'cpuCount':os.cpu_count(),'meminfo':mem,'image':os.environ.get('ImageVersion')}
  for p in ['/sys/fs/cgroup/memory.max','/sys/fs/cgroup/cpu.max']:
   if pathlib.Path(p).exists():row[p]=pathlib.Path(p).read_text().strip()
  self.report.setdefault('resources',[]).append(row);self.persist()
  assert row['freeBytes']>=8*1024**3,'8 GiB disk reserve required'
  assert int(mem['MemAvailable'].split()[0])*1024>=2*1024**3,'2 GiB available memory reserve required'
 def run(self,name,args,limit=180,cwd=None,env=None,allow_nonzero=False):
  remain=self.deadline-time.time();assert remain>10,'Work deadline; evidence reserve retained'
  limit=min(limit,remain);self.report['stage']=name;self.persist()
  (self.out/(name+'-command.json')).write_text(json.dumps({'arguments':args,'cwd':str(cwd or self.root),'timeoutSeconds':limit},indent=2))
  at=time.monotonic();timed=False
  with (self.out/(name+'.log')).open('w')as log:
   proc=subprocess.Popen(args,cwd=cwd or self.root,env=env,stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
   try:code=proc.wait(timeout=limit)
   except subprocess.TimeoutExpired:
    timed=True;os.killpg(proc.pid,signal.SIGTERM)
    try:proc.wait(timeout=5)
    except subprocess.TimeoutExpired:os.killpg(proc.pid,signal.SIGKILL);proc.wait()
    code=proc.returncode
  self.report['steps'].append({'name':name,'seconds':round(time.monotonic()-at,3),'exitCode':code,'timedOut':timed});self.persist()
  assert not timed and (code==0 or allow_nonzero),name+' failed; original log retained'
  p=self.out/(name+'.log');assert p.stat().st_size<64*1024**2,'Log budget exceeded'
  return p.read_text()
 def compile_attempt(self,name,cmd,env):
  log=self.run(name,cmd,180,self.build,env,allow_nonzero=True);step=self.report['steps'][-1]
  if step['exitCode']==0:return True
  # Only an ordinary, diagnosed compiler exit can be collected and continued.
  # Timeouts, killed processes, unknown exits and resource failures stop work.
  clean=re.sub(r'\x1b\[[0-9;]*m','',log)
  assert step['exitCode']==1 and 'error:'in clean,'Nonordinary compiler failure; stop'
  self.report.setdefault('compileFailures',[]).append({'stage':name,'exitCode':step['exitCode'],'log':name+'.log'})
  self.persist();self.resource('compiler-error-collected');return False
 def execute(self):
  assert os.getuid()!=0 and os.environ.get('GITHUB_ACTIONS')=='true'
  for name in ['WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS','WEBKIT_EXEC_PATH','WEBKIT_INJECTED_BUNDLE_PATH','LD_LIBRARY_PATH','LD_PRELOAD']:
   assert not os.environ.get(name),'Forbidden override present: '+name
  assert digest(HERE/'normal-path-2.54.2.patch')==PATCH_SHA
  self.resource('initial')
  sources=official_sources(pathlib.Path('/etc/apt/sources.list.d/ubuntu.sources').read_text(),lambda p:pathlib.Path(p).read_text())
  (self.root/'official.sources').write_text(sources);(self.out/'official.sources').write_text(sources)
  for p in ['lists/partial','cache/archives/partial']:(self.root/p).mkdir(parents=True)
  conf=self.root/'apt.conf';conf.write_text(f'Dir::Etc::sourcelist "{self.root}/official.sources";\nDir::Etc::sourceparts "-";\nDir::State::lists "{self.root}/lists";\nDir::Cache "{self.root}/cache";\nAcquire::Languages "none";\n')
  self.run('apt-update',['apt-get','-c',str(conf),'update'],150)
  metadata=self.run('dependency-source-metadata',['apt-cache','-c',str(conf),'showsrc','webkit2gtk'],30)
  versions=sorted(set(re.findall(r'^Version: ([0-9A-Za-z.+:~\-]+)$',metadata,re.M)));assert versions
  version=versions[0]
  for v in versions[1:]:
   if subprocess.run(['dpkg','--compare-versions',v,'gt',version]).returncode==0:version=v
  self.report['dependencySourceVersion']=version;self.persist()
  extra=EXTRA_SDK_PACKAGES
  plans=[['build-dep','webkit2gtk='+version],['install',*extra]]
  for i,plan in enumerate(plans):
   text=self.run('dependencies-plan-'+str(i),['apt-get','-c',str(conf),'--simulate','--no-install-recommends','--no-remove',*plan],60)
   self.report.setdefault('dependencyPlans',[]).append({'operation':plan,'installs':validate_apt_plan(text)});self.persist()
  for i,plan in enumerate(plans):self.run('dependencies-install-'+str(i),['sudo','apt-get','-c',str(conf),'-y','--no-install-recommends','--no-remove',*plan],300)
  self.run('installed-package-inventory',['dpkg-query','-W','-f=${binary:Package}\t${Version}\t${Architecture}\n'],30)
  self.run('required-gstreamer-sdk',['pkg-config','--print-errors','--exists',*[name+' >= 1.18.4'for name in REQUIRED_GST_MODULES]],30)
  self.run('required-gstreamer-versions',['pkg-config','--modversion',*REQUIRED_GST_MODULES],30)
  self.run('required-post-gtk-sdk',['pkg-config','--print-errors','--exists',*REQUIRED_POST_GTK_MODULES],30)
  self.run('required-post-gtk-versions',['pkg-config','--modversion','fontconfig','expat','libwebpmux','sysprof-capture-4'],30)
  for name in ['cmake','ninja','clang','clang++','gperf','unifdef','bwrap','xdg-dbus-proxy']:
   actual=pathlib.Path(shutil.which(name)or'');assert actual.is_file()
   self.report.setdefault('tools',{})[name]={'path':str(actual),'resolved':str(actual.resolve()),'sha256':digest(actual.resolve())};self.persist()
   self.run('tool-'+name.replace('+','p'),[str(actual),'-V'if name=='unifdef'else'--version'],15)
  # Download/extraction runs in a timed child so network/decompression cannot
  # outlive the same process-group deadline.
  self.run('official-source',['python3',str(HERE/'current_source_archive.py'),str(self.root/'source.tar.xz'),str(self.source)],180)
  self.run('patch-check',['git','apply','--check',str(HERE/'normal-path-2.54.2.patch')],30,self.source)
  self.run('patch-apply',['git','apply',str(HERE/'normal-path-2.54.2.patch')],30,self.source)
  lock=json.loads((HERE/'normal-path-2.54.2.json').read_text())
  for rel,h in lock['outputs'].items():assert digest(self.source/rel)==h,('Patched source identity',rel)
  self.report['patchedSourceHashes']=lock['outputs'];self.resource('source-and-dependencies-ready')
  recipe=json.loads((HERE/'qa-final-path-profile.json').read_text());assert recipe==boundary.profile(PATCH_SHA)
  options={**recipe['cmake'],'CMAKE_C_COMPILER':'/usr/bin/clang','CMAKE_CXX_COMPILER':'/usr/bin/clang++','CMAKE_C_COMPILER_LAUNCHER':'ccache','CMAKE_CXX_COMPILER_LAUNCHER':'ccache','CMAKE_EXPORT_COMPILE_COMMANDS':'ON','ENABLE_DOCUMENTATION':'OFF'}
  # Distro hardening remains enabled. Reduce debug detail only; no LTO for this
  # exact TU recipe. Record flags; a future package must use the same profile.
  flag_env={**os.environ,'DEB_BUILD_MAINT_OPTIONS':'hardening=+all optimize=-lto'}
  def flags(kind):return re.sub(r'(?<!\S)-g(?!\S)','-g1',subprocess.check_output(['dpkg-buildflags','--get',kind],env=flag_env,text=True).strip())
  options.update(CMAKE_C_FLAGS_RELEASE='',CMAKE_CXX_FLAGS_RELEASE='',CMAKE_C_FLAGS=flags('CFLAGS')+' '+flags('CPPFLAGS'),CMAKE_CXX_FLAGS=flags('CXXFLAGS')+' '+flags('CPPFLAGS'),CMAKE_EXE_LINKER_FLAGS=flags('LDFLAGS'),CMAKE_SHARED_LINKER_FLAGS=flags('LDFLAGS'))
  self.report['configureOptions']=options;self.persist()
  log=self.run('configure',['cmake','-S',str(self.source),'-B',str(self.build),'-GNinja',*[f'-D{k}={v}'for k,v in options.items()]],300)
  cache=self.build/'CMakeCache.txt';config=self.build/'cmakeconfig.h'
  self.report['configuration']=validate_config(cache,config,log,recipe,options)
  self.run('compiler-version',['/usr/bin/clang++','--version'],15)
  self.run('pkgconfig-dependencies',['pkg-config','--modversion','gtk+-3.0','gtk+-unix-print-3.0','libsoup-3.0','glib-2.0','harfbuzz','icu-uc'],15)
  self.report['compilerSha256']=digest(pathlib.Path('/usr/bin/clang++').resolve())
  self.run('manifest-refresh',['ninja','build.ninja'],60,self.build)
  commands=json.loads((self.build/'compile_commands.json').read_text());sources=[r for r in lock['outputs']if r.endswith('.cpp')]
  selected=selected_entries(commands,sources,self.source);self.report['selectedUnits']=selected;self.report['compileDatabaseSha256']=digest(self.build/'compile_commands.json');self.persist()
  available=self.run('ninja-targets',['ninja','-t','targets','all'],30,self.build);targets=set(l.rsplit(': ',1)[0]for l in available.splitlines())
  headers=contract.HEADER_TARGETS+(['ANGLE-webgl-headers']if 'ANGLE-webgl-headers'in targets else[])
  assert set(headers)<=targets
  plan=self.run('header-plan',['ninja','-t','commands',*headers],45,self.build);self.report['headerPlanLines']=contract.validate_header_plan(plan);self.persist()
  actual=self.run('generate-headers',['ninja','-v','-j','4',*headers],240,self.build)
  self.report['headerExecution']=contract.validate_header_execution(actual,plan,self.build)
  for name,target in zip(contract.NAME_INPUTS,contract.generated_webcore_headers(targets,self.build)):
   graph=self.run(name+'-header-graph',['ninja','-t','commands',target],30,self.build)
   cwd,cmd=contract.name_generator_command(graph,name,self.source,self.build);self.run(name+'-header-generate',cmd,30,cwd)
  generated={str(p.relative_to(self.build)):digest(p)for p in self.build.rglob('*.h')if p.is_file()and not p.is_symlink()}
  assert 0<len(generated)<20000
  (self.out/'generated-header-sha256.json').write_text(json.dumps(generated,indent=2)+'\n')
  self.resource('headers-ready')
  invoked=set();fresh_cache=self.root/'unused-fresh-ccache';assert not fresh_cache.exists();fresh_cache.mkdir()
  pch_entries=selected_pch_entries(commands,selected,self.build);self.report['selectedPchEntries']=pch_entries;self.report['precompiledHeaders']=[];self.persist()
  self.report['pchInputs']=pch_input_contract((self.build/'build.ninja').read_text(),pch_entries,self.build)
  pch_lock=json.loads((HERE/'pch-audit/source-lock.json').read_text())
  for rel,h in pch_lock['files'].items():assert digest(self.source/rel)==h,('PCH source preimage',rel)
  self.report['pchGeneratedInputs']={}
  for name in PCH_GENERATED_HEADERS:
   p=self.build/'WebCore/DerivedSources'/name;assert p.is_file(),('PCH generated input missing',name)
   self.report['pchGeneratedInputs'][name]=digest(p)
  self.persist()
  if self.before_compilation() is False:return
  failed_pch=set()
  for index,entry in enumerate(pch_entries):
   args=entry.get('arguments')or shlex.split(entry['command']);target=args[args.index('-o')+1]
   graph=self.run(f'pch-{index}-graph',['ninja','-t','commands',target],30,self.build)
   exact,cmd=contract.original_command(entry,graph,self.build);assert exact==target
   output=self.build/target;assert not output.exists();output.parent.mkdir(parents=True,exist_ok=True)
   inputs={}
   for input_path in [pathlib.Path(entry['file']),output.with_suffix('')]:
    assert input_path.is_file()and input_path.stat().st_size<1024**2
    rel=input_path.relative_to(self.build);saved=self.out/'pch-inputs'/rel;saved.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(input_path,saved);inputs[str(rel)]=digest(input_path)
   if not self.compile_attempt(f'compile-pch-{index}',cmd,{**os.environ,'CCACHE_DISABLE':'1','CCACHE_DIR':str(fresh_cache)}):
    failed_pch.add(str(output));continue
   assert output.is_file()and output.stat().st_size>0
   self.report['precompiledHeaders'].append({'target':target,'bytes':output.stat().st_size,'sha256':digest(output),'command':cmd,'inputHashes':inputs,'binaryRetained':False});self.persist();self.resource('pch-complete')
  for rel,entry in selected.items():
   args=entry.get('arguments')or shlex.split(entry['command']);target=args[args.index('-o')+1]
   if target in invoked:continue
   dependencies=[args[i+2]for i,value in enumerate(args)if value=='-include-pch']
   if any(p in failed_pch for p in dependencies):
    self.report.setdefault('skippedUnits',[]).append({'source':rel,'target':target,'reason':'Required PCH compilation failed'});self.persist();continue
   graph=self.run(pathlib.Path(rel).stem+'-graph',['ninja','-t','commands',target],30,self.build)
   exact,cmd=contract.original_command(entry,graph,self.build);assert exact==target
   unit=pathlib.Path(entry['file']);saved=self.out/'actual-units'/unit.name;saved.parent.mkdir(exist_ok=True);saved.write_bytes(unit.read_bytes())
   invoked.add(target);output=(self.build/target).resolve();assert not output.exists();output.parent.mkdir(parents=True,exist_ok=True)
   self.report['currentObject']={'source':rel,'target':target};self.persist()
   if not self.compile_attempt('compile-'+pathlib.Path(rel).stem,cmd,{**os.environ,'CCACHE_DISABLE':'1','CCACHE_DIR':str(fresh_cache)}):continue
   assert output.is_file()and output.stat().st_size>0
   self.report['objects'].append({'target':target,'source':rel,'unit':entry['file'],'unitSha256':digest(pathlib.Path(entry['file'])),'bytes':output.stat().st_size,'sha256':digest(output),'command':cmd});self.persist();self.resource('object-complete')
  assert not self.report.get('compileFailures')and not self.report.get('skippedUnits')and len(invoked)==len(self.report['objects']),'Selected compilations failed; independent results retained'
  self.after_compilation()
  self.report['status']='passed-actual-selected-TUs-not-engine-or-package';self.persist()
 def retain(self):
  # Only our successfully compiled objects and depfiles. No runtime, cache,
  # credentials, source tree or arbitrary filesystem paths enter this archive.
  # Retain incomplete configuration on failure too, rather than losing the
  # cache/tool diagnostics before generated ABI checks can run.
  configuration_files={};configuration_bytes=0
  for rel in ['CMakeCache.txt','cmakeconfig.h','compile_commands.json','build.ninja','CMakeFiles/rules.ninja','CMakeFiles/CMakeConfigureLog.yaml']:
   p=self.build/rel
   if not p.is_file():continue
   size=p.stat().st_size;configuration_bytes+=size
   assert configuration_bytes<=128*1024**2,'Configuration evidence total budget exceeded'
   q=self.out/'graph'/rel;q.parent.mkdir(parents=True,exist_ok=True)
   if size<=32*1024**2:shutil.copyfile(p,q);configuration_files[rel]={'encoding':'raw','rawBytes':size,'rawSha256':digest(p)}
   else:
    with p.open('rb')as stream:configuration_files[rel]=retain_configuration_stream(stream,q,size)
  self.report['retainedConfigurationFiles']=configuration_files
  rows=[];total=0
  for obj in self.report['objects']:
   for target in [obj['target'],obj['target']+'.d']:
    p=self.build/target
    if not p.is_file():continue
    assert not p.is_symlink()and p.resolve().is_relative_to(self.build.resolve());size=p.stat().st_size
    assert size<=256*1024**2;total+=size;assert total<=512*1024**2
    rows.append({'path':target,'bytes':size,'sha256':digest(p)})
  if rows:
   archive=self.out/'selected-objects.tar.gz'
   with tarfile.open(archive,'w:gz')as tar:
    for row in rows:tar.add(self.build/row['path'],arcname=row['path'],recursive=False)
   self.report['objectRetention']={'files':rows,'bytes':archive.stat().st_size,'sha256':digest(archive),'crossJobRestoreProven':False,'identity':{'sourceArchive':SOURCE_SHA,'patch':PATCH_SHA,'compiler':self.report.get('compilerSha256'),'compileDatabase':self.report.get('compileDatabaseSha256'),'configuration':self.report.get('configuration')}}
  else:self.report['objectRetention']={'files':[],'reason':'No completed actual objects'}
  self.report['elapsedSeconds']=round(time.time()-self.start,3);self.persist()
def main():
 p=argparse.ArgumentParser();p.add_argument('--root',type=pathlib.Path,required=True);p.add_argument('--started',type=float,required=True);a=p.parse_args();g=Gate(a.root.resolve(),a.started)
 try:g.execute()
 except Exception as e:g.report.update(status='failed',error=str(e),traceback=traceback.format_exc(limit=12));g.persist()
 finally:
  try:g.retain()
  except Exception as e:g.report.update(status='failed',retentionError=repr(e));g.persist()
 print(json.dumps({k:g.report.get(k)for k in ['status','stage','error','elapsedSeconds']},indent=2))
 return 0 if g.report['status']=='passed-actual-selected-TUs-not-engine-or-package'else 1
if __name__=='__main__':raise SystemExit(main())

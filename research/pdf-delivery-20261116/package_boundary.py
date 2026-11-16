"""Fail-closed, non-installing final-prefix staging audit for an isolated QA package.
It never copies a research prefix, runs ELF payloads, calls a package manager or
sets loader variables. A passing staging audit is not runtime/native acceptance.
"""
import argparse,hashlib,json,os,pathlib,re,stat,subprocess
HERE=pathlib.Path(__file__).resolve().parent
VERSION='2.54.2';SOURCE_SHA='a76345b391bef6211fb5ab6cfab2e86b285d18cda17cbb9ade595f1252b86065'
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def profile(patch_sha):
 assert re.fullmatch('[0-9a-f]{64}',patch_sha)
 prefix=f'/opt/milkup/runtime-qa/webkitgtk-{VERSION}-{patch_sha[:16]}'
 lib=prefix+'/lib/x86_64-linux-gnu';helper=lib+'/webkit2gtk-4.1'
 return {'version':VERSION,'sourceArchiveSha256':SOURCE_SHA,'patchSha256':patch_sha,'prefix':prefix,'lib':lib,'helper':helper,'cmake':{'PORT':'GTK','CMAKE_BUILD_TYPE':'Release','DEVELOPER_MODE':'OFF','ENABLE_BUBBLEWRAP_SANDBOX':'ON','USE_GTK4':'OFF','ENABLE_MINIBROWSER':'OFF','CMAKE_INSTALL_PREFIX':prefix,'LIB_INSTALL_DIR':lib,'LIBEXEC_INSTALL_DIR':helper,'CMAKE_INSTALL_RPATH':lib,'CMAKE_INSTALL_RPATH_USE_LINK_PATH':'OFF','CMAKE_SKIP_INSTALL_RPATH':'OFF'},'scope':'QA final-path recipe only; no source build, package, installation or maintenance promise'}
def cache_values(path):
 result={}
 for line in path.read_text().splitlines():
  m=re.fullmatch(r'([^#/][^:=]*):[^=]+=(.*)',line)
  if m:assert m[1]not in result;result[m[1]]=m[2]
 return result

def elf(path):
 def read(*args):return subprocess.check_output(['readelf',*args,str(path)],text=True,timeout=15,stderr=subprocess.STDOUT)
 header=read('-h');dynamic=read('-d');notes=read('-n')
 assert 'ELF64'in header and 'Advanced Micro Devices X86-64'in header,'Exact amd64 ELF required'
 assert re.search(r'Type:\s+DYN',header),'PIE/shared ELF only'
 build=re.findall(r'Build ID: ([0-9a-f]+)',notes);assert len(build)==1 and len(build[0])>=16,'Build ID required'
 paths=re.findall(r'\((RPATH|RUNPATH)\).*?\[(.*?)\]',dynamic);assert len(paths)==1,'Exactly one explicit final runtime path required'
 needed=re.findall(r'\(NEEDED\).*?\[(.*?)\]',dynamic);soname=re.findall(r'\(SONAME\).*?\[(.*?)\]',dynamic)
 assert len(soname)<=1 and len(needed)==len(set(needed))
 return {'buildId':build[0],'rpathKind':paths[0][0],'searchPath':paths[0][1],'needed':needed,'soname':soname[0]if soname else None}

def audit(stage,recipe,manifest,cache,compile_commands,generated_config):
 stage=stage.resolve();prefix=pathlib.PurePosixPath(recipe['prefix']);values=cache_values(cache)
 assert recipe==profile(recipe['patchSha256']),'Exact approved QA profile required'
 for k,v in recipe['cmake'].items():assert values.get(k)==v,('Configure mismatch',k)
 assert manifest['scope']=='isolated-qa-candidate-not-release'
 assert manifest['sourceArchiveSha256']==SOURCE_SHA and manifest['patchSha256']==recipe['patchSha256']
 assert manifest['sourceVersion']==VERSION
 assert re.fullmatch('[0-9a-f]{64}',manifest['compileCommandsSha256']) and re.fullmatch('[0-9a-f]{64}',manifest['generatedConfigSha256'])
 assert sha(compile_commands)==manifest['compileCommandsSha256'] and sha(generated_config)==manifest['generatedConfigSha256'],'Build evidence identity mismatch'
 commands=json.loads(compile_commands.read_text());assert isinstance(commands,list) and commands,'Compile graph required'
 config=generated_config.read_text()
 for name,value in [('ENABLE_2022_GLIB_API','0'),('ENABLE_DEVELOPER_MODE','0'),('ENABLE_BUBBLEWRAP_SANDBOX','1')]:
  assert re.findall(r'^#define '+name+r'\s+(\S+)\s*$',config,re.M)==[value],('Generated option mismatch',name)
 assert manifest['applicationSourceSha'] and re.fullmatch('[0-9a-f]{40}',manifest['applicationSourceSha'])
 # Every runtime and resource file is enumerated, never a broad copied prefix.
 rows=manifest['files'];assert 6<=len(rows)<=5000
 paths={r['path']for r in rows};assert len(paths)==len(rows)
 entries=list(stage.rglob('*'))
 assert all(not p.is_symlink() for p in entries),'No symlink payload or directory aliases'
 assert all(not(p.stat().st_mode & 0o7022) for p in entries),'No unsafe payload directories or files'
 actual={str(pathlib.PurePosixPath('/')/p.relative_to(stage))for p in entries if not p.is_dir()}
 assert actual==paths,'Extra/missing payload; no implicit development/QA files'
 roles={};files={};sonames={};host=manifest['hostLibraries'];assert host
 for name,row in host.items():
  assert '/'not in name and row['package'] and row['version'] and re.fullmatch('[0-9a-f]{64}',row['sha256'])
  assert not any(x in name.lower()for x in ['webkit','javascriptcore']),'Runtime family must not fall back to host'
 for row in rows:
  rel=pathlib.PurePosixPath(row['path']);assert rel.is_absolute() and '..'not in rel.parts and rel.is_relative_to(prefix)
  p=stage/str(rel).lstrip('/');assert p.resolve().is_relative_to(stage)
  assert not p.is_symlink(),'Explicit real runtime files only in initial candidate'
  st=p.stat();assert stat.S_ISREG(st.st_mode) and not(st.st_mode&0o7022),'No set-id/sticky/group/world writable payload'
  assert st.st_nlink==1 and st.st_size==row['bytes'] and sha(p)==row['sha256'],'Payload identity/alias mismatch'
  role=row['role'];roles.setdefault(role,[]).append(row['path'])
  assert role in {'application','webkit','javascriptcore','web-process','network-process','gpu-process','injected-bundle','resource','license','sbom'},role
  if role in {'resource','license','sbom'}:
   assert not(st.st_mode&0o111);continue
  assert st.st_mode&0o100
  e=elf(p);assert e['searchPath']==recipe['lib'],'No build/temp/origin/global loader override'
  if e['soname']:
   assert e['soname']not in sonames;sonames[e['soname']]=row['path']
   # The SONAME is installed as a real file; no missing soname symlink fallback.
   assert rel.name==e['soname'],'Install the exact SONAME, not an unresolved version-name-only file'
  files[row['path']]=e
 for role in ['application','webkit','javascriptcore','web-process','network-process','gpu-process','injected-bundle','sbom']:
  assert len(roles.get(role,[]))==1,('Required exact component',role)
 assert roles.get('license'),'Source notices required'
 expected={'application':recipe['prefix']+'/bin/milkup-desktop','webkit':recipe['lib']+'/libwebkit2gtk-4.1.so.0','javascriptcore':recipe['lib']+'/libjavascriptcoregtk-4.1.so.0','web-process':recipe['helper']+'/WebKitWebProcess','network-process':recipe['helper']+'/WebKitNetworkProcess','gpu-process':recipe['helper']+'/WebKitGPUProcess','injected-bundle':recipe['helper']+'/injected-bundle/libwebkit2gtkinjectedbundle.so'}
 for role,name in expected.items():assert roles[role]==[name],('Final component path',role)
 for name,e in files.items():
  assert set(e['needed'])<=set(sonames)|set(host),('Unreviewed host dependency',name,set(e['needed'])-set(sonames)-set(host))
 for role in ['application','web-process','network-process','gpu-process']:
  assert 'libwebkit2gtk-4.1.so.0'in files[roles[role][0]]['needed'],('No explicit private WebKit dependency',role)
 assert 'libjavascriptcoregtk-4.1.so.0'in files[roles['webkit'][0]]['needed']
 # A real inventory from the actual complete build is mandatory. Unknown static
 # third-party license/source inventory cannot be turned into a complete SBOM.
 sbom=json.loads((stage/roles['sbom'][0].lstrip('/')).read_text())
 assert sbom['bomFormat']=='CycloneDX' and sbom['specVersion']=='1.6'
 assert sbom['metadata']['properties']==[{'name':'milkup:scope','value':'isolated-qa-not-release'},{'name':'milkup:static-dependency-inventory','value':'complete-build-derived'}]
 components=sbom['components'];assert components and len(components)<=2000
 for c in components:
  assert c['name'] and c['version'] and c['licenses'] and c['externalReferences'] and c['hashes']
  assert any(h.get('alg')=='SHA-256'and re.fullmatch('[0-9a-f]{64}',h.get('content',''))for h in c['hashes'])
  assert all(x.get('expression')and x['expression']not in ['UNKNOWN','NOASSERTION']for x in c['licenses'])
 names={c['name']for c in components};assert {'WebKitGTK','JavaScriptCore','Skia'}<=names
 assert manifest['maintenance']['state']=='unassigned-not-production-approved','No invented maintenance owner'
 return {'status':'staging-boundary-passed-not-installed-or-native-accepted','prefix':recipe['prefix'],'payloadCount':len(rows),'elf':files,'hostLibraries':host,'sourceVersion':VERSION,'patchSha256':recipe['patchSha256'],'limits':['Actual build provenance and installed mappings still require native validation','No normal runtime package currently built','No security-update owner or production approval','No sandbox, installation/recovery/IME/PDF result inferred']}
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('stage',type=pathlib.Path);p.add_argument('recipe',type=pathlib.Path);p.add_argument('manifest',type=pathlib.Path);p.add_argument('cache',type=pathlib.Path);p.add_argument('compile_commands',type=pathlib.Path);p.add_argument('generated_config',type=pathlib.Path);p.add_argument('output',type=pathlib.Path);a=p.parse_args();r=audit(a.stage,json.loads(a.recipe.read_text()),json.loads(a.manifest.read_text()),a.cache,a.compile_commands,a.generated_config);a.output.write_text(json.dumps(r,indent=2)+'\n');print(r['status'])

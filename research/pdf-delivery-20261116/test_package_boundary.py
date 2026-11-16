"""Real synthetic ELF exercises only the checker; never a WebKit/package claim."""
import copy,importlib.util,json,pathlib,subprocess,tempfile,unittest
HERE=pathlib.Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('boundary',HERE/'package_boundary.py');b=importlib.util.module_from_spec(spec);spec.loader.exec_module(b)
class Boundary(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  cls.tmp=tempfile.TemporaryDirectory(prefix='qa-boundary-fixture-');cls.root=pathlib.Path(cls.tmp.name);cls.stage=cls.root/'stage';cls.stage.mkdir()
  cls.recipe=json.loads((HERE/'qa-final-path-profile.json').read_text());r=cls.recipe
  cls.cache=cls.root/'CMakeCache.txt';cls.cache.write_text(''.join(k+':STRING='+v+'\n'for k,v in r['cmake'].items()))
  cls.commands=cls.root/'compile_commands.json';cls.commands.write_text(json.dumps([{'file':'synthetic-only.c','command':'cc synthetic-only.c','directory':str(cls.root)}]))
  cls.config=cls.root/'config.h';cls.config.write_text('/* synthetic checker fixture only */\n#define ENABLE_2022_GLIB_API 0\n#define ENABLE_DEVELOPER_MODE 0\n#define ENABLE_BUBBLEWRAP_SANDBOX 1\n')
  cls.rows=[]
  def file(rel,role,data):
   p=cls.stage/rel.lstrip('/');p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(data);p.chmod(0o644);cls.rows.append({'path':rel,'role':role,'bytes':len(data),'sha256':b.sha(p)});return p
  def elf(rel,role,source,soname=None,dependency=None):
   p=cls.stage/rel.lstrip('/');p.parent.mkdir(parents=True,exist_ok=True)
   src=cls.root/(role+'.c');src.write_text(source)
   args=['cc','-fPIC',str(src),'-Wl,--build-id=sha1','-Wl,-rpath,'+r['lib'],'-o',str(p)]
   if soname:args+=['-shared','-Wl,-soname,'+soname]
   else:args+=['-pie']
   if dependency:args+=['-Wl,--no-as-needed','-Wl,-rpath-link,'+str(dependency.parent),str(dependency)]
   subprocess.run(args,check=True,capture_output=True);p.chmod(0o755)
   cls.rows.append({'path':rel,'role':role,'bytes':p.stat().st_size,'sha256':b.sha(p)});return p
  jsc=elf(r['lib']+'/libjavascriptcoregtk-4.1.so.0','javascriptcore','int fixture_jsc(void){return 0;}','libjavascriptcoregtk-4.1.so.0')
  web=elf(r['lib']+'/libwebkit2gtk-4.1.so.0','webkit','extern int fixture_jsc(void); int fixture_web(void){return fixture_jsc();}','libwebkit2gtk-4.1.so.0',jsc)
  for role,name in [('application',r['prefix']+'/bin/milkup-desktop'),('web-process',r['helper']+'/WebKitWebProcess'),('network-process',r['helper']+'/WebKitNetworkProcess'),('gpu-process',r['helper']+'/WebKitGPUProcess')]:
   elf(name,role,'int main(void){return 0;}',dependency=web)
  elf(r['helper']+'/injected-bundle/libwebkit2gtkinjectedbundle.so','injected-bundle','int fixture_bundle(void){return 0;}','libwebkit2gtkinjectedbundle.so',web)
  file(r['prefix']+'/share/licenses/FIXTURE.txt','license',b'SYNTHETIC TEST ONLY, not real notices or a deliverable')
  sbom={'bomFormat':'CycloneDX','specVersion':'1.6','metadata':{'properties':[{'name':'milkup:scope','value':'isolated-qa-not-release'},{'name':'milkup:static-dependency-inventory','value':'complete-build-derived'}]},'components':[{'name':n,'version':'synthetic-fixture','licenses':[{'expression':'MIT'}],'externalReferences':[{'type':'source-distribution','url':'https://example.invalid/synthetic'}],'hashes':[{'alg':'SHA-256','content':'0'*64}]}for n in ['WebKitGTK','JavaScriptCore','Skia']]}
  file(r['prefix']+'/share/sbom.json','sbom',json.dumps(sbom).encode())
  needed=set()
  for row in cls.rows:
   if row['role']not in ['license','sbom']:needed.update(b.elf(cls.stage/row['path'].lstrip('/'))['needed'])
  host={n:{'package':'synthetic-fixture','version':'fixture','sha256':'0'*64}for n in needed if n not in ['libwebkit2gtk-4.1.so.0','libjavascriptcoregtk-4.1.so.0']}
  cls.manifest={'scope':'isolated-qa-candidate-not-release','sourceVersion':b.VERSION,'sourceArchiveSha256':b.SOURCE_SHA,'patchSha256':r['patchSha256'],'compileCommandsSha256':b.sha(cls.commands),'generatedConfigSha256':b.sha(cls.config),'applicationSourceSha':'0'*40,'files':cls.rows,'hostLibraries':host,'maintenance':{'state':'unassigned-not-production-approved'}}
 @classmethod
 def tearDownClass(cls):cls.tmp.cleanup()
 def check(self,m=None,r=None):return b.audit(self.stage,r or self.recipe,m or self.manifest,self.cache,self.commands,self.config)
 def test_real_elf_positive_is_explicitly_not_native_acceptance(self):
  result=self.check();self.assertEqual(len(result['elf']),7);self.assertIn('not-installed-or-native',result['status'])
 def test_manifest_and_scope_mutations_fail_closed(self):
  for label,mutate in [
   ('hash',lambda m:m['files'][0].update(sha256='f'*64)),
   ('missing-helper',lambda m:m['files'].pop(3)),
   ('host-runtime',lambda m:m['hostLibraries'].update({'libwebkit2gtk-4.1.so.0':{'package':'fixture','version':'fixture','sha256':'0'*64}})),
   ('unknown-host',lambda m:m.update(hostLibraries={'unrelated.so':{'package':'fixture','version':'fixture','sha256':'0'*64}})),
   ('wrong-source',lambda m:m.update(sourceArchiveSha256='f'*64)),
   ('wrong-build-evidence',lambda m:m.update(compileCommandsSha256='f'*64)),
   ('release',lambda m:m.update(scope='release')),
   ('missing-sbom',lambda m:m['files'][-1].update(role='resource'))]:
   with self.subTest(label=label):
    m=copy.deepcopy(self.manifest);mutate(m)
    with self.assertRaises(AssertionError):self.check(m)
 def test_directory_symlink_and_extra_file_rejected(self):
  p=self.stage/'unexpected';p.symlink_to('/tmp',target_is_directory=True)
  try:
   with self.assertRaisesRegex(AssertionError,'symlink'):self.check()
  finally:p.unlink()
  p.write_text('extra')
  try:
   with self.assertRaisesRegex(AssertionError,'Extra/missing'):self.check()
  finally:p.unlink()
 def test_unsafe_permissions_rejected(self):
  p=self.stage/self.rows[0]['path'].lstrip('/');p.chmod(0o777)
  try:
   with self.assertRaisesRegex(AssertionError,'unsafe'):self.check()
  finally:p.chmod(0o755)
 def test_real_elf_wrong_search_path_rejected_even_with_matching_hash(self):
  row=self.rows[0];p=self.stage/row['path'].lstrip('/');original=p.read_bytes()
  changed=original.replace(b'/opt/milkup',b'/tmp/milkup');self.assertNotEqual(original,changed);p.write_bytes(changed)
  m=copy.deepcopy(self.manifest);m['files'][0]['sha256']=b.sha(p)
  try:
   with self.assertRaisesRegex(AssertionError,'loader override'):self.check(m)
  finally:p.write_bytes(original)
 def test_unknown_license_rejected_even_with_matching_hash(self):
  row=self.rows[-1];p=self.stage/row['path'].lstrip('/');original=p.read_bytes();data=json.loads(original)
  data['components'][0]['licenses']=[{'expression':'NOASSERTION'}];p.write_text(json.dumps(data))
  m=copy.deepcopy(self.manifest);m['files'][-1].update(sha256=b.sha(p),bytes=p.stat().st_size)
  try:
   with self.assertRaises(AssertionError):self.check(m)
  finally:p.write_bytes(original)
 def test_generated_developer_define_cannot_be_hidden_by_cache(self):
  original=self.config.read_text();self.config.write_text(original.replace('ENABLE_DEVELOPER_MODE 0','ENABLE_DEVELOPER_MODE 1'))
  m=copy.deepcopy(self.manifest);m['generatedConfigSha256']=b.sha(self.config)
  try:
   with self.assertRaisesRegex(AssertionError,'Generated option mismatch'):self.check(m)
  finally:self.config.write_text(original)
 def test_developer_sandbox_and_prefix_config_rejected(self):
  original=self.cache.read_text()
  for key,value in [('DEVELOPER_MODE','ON'),('ENABLE_BUBBLEWRAP_SANDBOX','OFF'),('CMAKE_INSTALL_PREFIX','/tmp/research'),('CMAKE_INSTALL_RPATH','/tmp/research/lib')]:
   with self.subTest(key=key):
    self.cache.write_text(original.replace(key+':STRING='+self.recipe['cmake'][key],key+':STRING='+value))
    try:
     with self.assertRaisesRegex(AssertionError,'Configure mismatch'):self.check()
    finally:self.cache.write_text(original)
if __name__=='__main__':unittest.main()

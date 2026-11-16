"""Offline positive/negative contracts for the complete new non-engine path."""
import ast,copy,hashlib,json,os,pathlib,shlex,subprocess,tarfile,tempfile,time,unittest,zipfile
from unittest import mock
import current_tu_gate as gate
import current_source_archive as archive
HERE=pathlib.Path(__file__).resolve().parent
class CurrentGate(unittest.TestCase):
 def test_locked_dependency_audit_and_post_gtk_metadata(self):
  base=HERE/'dependency-audit';lock=json.loads((base/'source-lock.json').read_text())
  self.assertEqual(lock['archiveSha256'],gate.SOURCE_SHA)
  self.assertEqual(gate.digest(base/'official-cmake-inputs.zip'),lock['selectedArchiveSha256'])
  with zipfile.ZipFile(base/'official-cmake-inputs.zip')as z:
   for name in z.namelist():self.assertEqual(hashlib.sha256(z.read(name)).hexdigest(),lock['scannedFiles'][name])
   skia=z.read('Source/ThirdParty/skia/CMakeLists.txt').decode()
   for requirement in ['Fontconfig 2.13.0 REQUIRED','WebP REQUIRED COMPONENTS mux','EXPAT REQUIRED']:self.assertIn(requirement,skia)
  with tempfile.TemporaryDirectory()as t:
   env={**os.environ,'PKG_CONFIG_PATH':'','PKG_CONFIG_LIBDIR':t,'PKG_CONFIG_SYSROOT_DIR':''}
   command=['pkg-config','--print-errors','--exists',*gate.REQUIRED_POST_GTK_MODULES]
   self.assertNotEqual(subprocess.run(command,env=env,capture_output=True).returncode,0)
   for name in ['fontconfig','expat','libwebpmux','sysprof-capture-4']:
    (pathlib.Path(t)/(name+'.pc')).write_text('Name: '+name+'\nDescription: isolated metadata contract\nVersion: 50.0\nLibs: -l'+name+'\n')
   self.assertEqual(subprocess.run(command,env=env,capture_output=True).returncode,0)
   (pathlib.Path(t)/'libwebpmux.pc').unlink()
   self.assertNotEqual(subprocess.run(command,env=env,capture_output=True).returncode,0)
 def test_official_sources_and_wrong_origin(self):
  text='Types: deb\nURIs: mirror+file:/etc/apt/apt-mirrors.txt\nSuites: resolute resolute-updates\nComponents: main universe\nSigned-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg\n'
  good=gate.official_sources(text,lambda p:'https://untrusted.invalid/ubuntu\nhttp://archive.ubuntu.com/ubuntu/\n')
  self.assertIn('Types: deb deb-src',good);self.assertNotIn('untrusted',good)
  for bad in [text.replace('resolute-updates','noble'),text.replace('/usr/share/keyrings/ubuntu-archive-keyring.gpg','/tmp/key'),text.replace('mirror+file:/etc/apt/apt-mirrors.txt','https://untrusted.invalid/')]:
   with self.assertRaises(AssertionError):gate.official_sources(bad,lambda p:'http://archive.ubuntu.com/ubuntu/')
 def test_dependency_plan_rejects_runtime_and_removal(self):
  self.assertEqual(gate.validate_apt_plan('Inst clang (1 Ubuntu)\n'),['clang'])
  for s in ['Inst libwebkit2gtk-4.1-0 (1 Ubuntu)','Inst libjavascriptcoregtk-4.1-0 (1 Ubuntu)','Remv unrelated-package']:
   with self.assertRaises(AssertionError):gate.validate_apt_plan(s)
 def test_archive_limits_and_traversal(self):
  a=tarfile.TarInfo('webkitgtk-2.54.2/file');a.size=3
  self.assertEqual(archive.validate_members([a])['expandedRegularBytes'],3)
  for name in ['/etc/a','webkitgtk-2.54.2/../../a','other/file']:
   b=copy.copy(a);b.name=name
   with self.assertRaises(AssertionError):archive.validate_members([b])
  b=copy.copy(a);b.type=tarfile.CHRTYPE
  with self.assertRaises(AssertionError):archive.validate_members([b])
  with self.assertRaises(AssertionError):archive.validate_members([a,a])
  b=copy.copy(a);b.size=129*1024**2
  with self.assertRaises(AssertionError):archive.validate_members([b])
 def test_exact_known_official_duplicate_is_not_general_overwrite_permission(self):
  a=tarfile.TarInfo(archive.DUPLICATE_PATH);a.size=990;a.mode=0o664
  # Use the retained authenticated original content, not a synthetic digest.
  import zipfile
  snapshot=HERE/'evidence/43846281602/gtk-theme-original.zip'
  with zipfile.ZipFile(snapshot)as z:data=z.read('gtk-theme.css')
  self.assertEqual(len(data),990);self.assertEqual(hashlib.sha256(data).hexdigest(),archive.DUPLICATE_SHA)
  result=archive.validate_members([a,copy.copy(a)],lambda m:data);self.assertEqual(result['identicalDuplicateOccurrences'],2)
  for members,reader in [([a,a,a],lambda m:data),([a,a],lambda m:b'x'*990),([a],lambda m:data)]:
   with self.assertRaises(AssertionError):archive.validate_members(members,reader)
  b=copy.copy(a);b.name='webkitgtk-2.54.2/another.css'
  with self.assertRaises(AssertionError):archive.validate_members([b,b],lambda m:data)
 def test_real_pkgconfig_reproduces_missing_module_and_reads_official_metadata(self):
  self.assertIn('libgstreamer-plugins-bad1.0-dev',gate.EXTRA_SDK_PACKAGES)
  self.assertIn('gstreamer-mpegts-1.0',gate.REQUIRED_GST_MODULES)
  source=(HERE/'evidence/43847602183/GStreamerChecks.cmake').read_text()
  self.assertIn('list(APPEND GSTREAMER_COMPONENTS video mpegts tag gl)',source)
  with tempfile.TemporaryDirectory()as t:
   root=pathlib.Path(t);env={**os.environ,'PKG_CONFIG_LIBDIR':str(root),'PKG_CONFIG_PATH':''}
   def dependency(name,version='1.28.2'):
    (root/(name+'.pc')).write_text('Name: '+name+'\nDescription: controlled metadata dependency only\nVersion: '+version+'\nLibs: -lfixture\n')
   dependency('gstreamer-1.0');dependency('gstreamer-base-1.0')
   command=['pkg-config','--print-errors','--exists','gstreamer-mpegts-1.0 >= 1.18.4']
   missing=subprocess.run(command,env=env,text=True,capture_output=True);self.assertNotEqual(missing.returncode,0);self.assertIn('gstreamer-mpegts-1.0',missing.stderr)
   official=(HERE/'evidence/43847602183/gstreamer-mpegts-1.0.pc.txt').read_text();(root/'gstreamer-mpegts-1.0.pc').write_text(official)
   valid=subprocess.run(command,env=env,text=True,capture_output=True);self.assertEqual(valid.returncode,0,valid.stderr)
   libs=subprocess.check_output(['pkg-config','--libs','gstreamer-mpegts-1.0'],env=env,text=True);self.assertIn('-lgstmpegts-1.0',libs)
   dependency('gstreamer-base-1.0','1.27.0')
   self.assertNotEqual(subprocess.run(command,env=env,capture_output=True).returncode,0)
   (root/'gstreamer-base-1.0.pc').unlink()
   self.assertNotEqual(subprocess.run(command,env=env,capture_output=True).returncode,0)
 def test_failed_configure_retains_partial_cache_without_claiming_generated_success(self):
  with tempfile.TemporaryDirectory()as t:
   g=gate.Gate(pathlib.Path(t)/'gate',time.time());g.build.mkdir();cache=g.build/'CMakeCache.txt';cache.write_text('PARTIAL:STRING=failed-configure\n')
   g.report['status']='failed';g.retain();result=json.loads((g.out/'result.json').read_text())
   self.assertIn('CMakeCache.txt',result['retainedConfigurationFiles']);self.assertNotIn('cmakeconfig.h',result['retainedConfigurationFiles']);self.assertEqual(result['status'],'failed')
 def test_generated_config_and_unconsumed_settings(self):
  with tempfile.TemporaryDirectory()as t:
   root=pathlib.Path(t);cache=root/'CMakeCache.txt';config=root/'cmakeconfig.h';r=json.loads((HERE/'qa-final-path-profile.json').read_text())
   cache.write_text(''.join(k+':STRING='+v+'\n'for k,v in r['cmake'].items()))
   good='#define ENABLE_2022_GLIB_API 0\n#define ENABLE_DEVELOPER_MODE 0\n#define ENABLE_BUBBLEWRAP_SANDBOX 1\n#define HAVE_GTK_UNIX_PRINTING 1\n#define WEBKITGTK_API_VERSION "4.1"\n';config.write_text(good)
   self.assertEqual(gate.validate_config(cache,config,'Configured',r,r['cmake'])['api'],'4.1')
   for bad in [good.replace('HAVE_GTK_UNIX_PRINTING 1','HAVE_GTK_UNIX_PRINTING 0'),good.replace('ENABLE_DEVELOPER_MODE 0','ENABLE_DEVELOPER_MODE 1'),good.replace('"4.1"','"6.0"'),good.replace('ENABLE_BUBBLEWRAP_SANDBOX 1','ENABLE_BUBBLEWRAP_SANDBOX 0')]:
    config.write_text(bad)
    with self.assertRaises(AssertionError):gate.validate_config(cache,config,'Configured',r,r['cmake'])
   config.write_text(good)
   with self.assertRaisesRegex(AssertionError,'Unconsumed'):gate.validate_config(cache,config,'Manually-specified variables were not used by the project: DEVELOPER_MODE',r,r['cmake'])
 def test_header_plan_and_execution_cannot_compile_engine(self):
  c=gate.contract;build=pathlib.Path('/tmp/build');plan='/usr/bin/cmake -E make_directory /tmp/build/headers\n'
  self.assertEqual(c.validate_header_plan(plan),1)
  self.assertEqual(c.validate_header_execution('[1/1] '+plan,plan,build)['commands'],1)
  for bad in ['/usr/bin/clang++ -c unrelated.cpp -o unrelated.o','/usr/bin/ccache /usr/bin/clang++ -c x.cpp','/usr/bin/ld x.o','/usr/bin/cmake --regenerate-during-build -S x -B y','/usr/bin/cmake -P /tmp/build/CMakeFiles/VerifyGlobs.cmake']:
   with self.assertRaises(AssertionError):c.validate_header_plan(bad)
  with self.assertRaises(AssertionError):c.validate_header_execution('[1/1] /usr/bin/cmake -E remove /tmp/unreviewed\n',plan,build)
 def test_actual_tu_command_matches_original_flags(self):
  c=gate.contract;build=pathlib.Path('/tmp/build');args=['/usr/bin/clang++','-Werror=undefined-inline','-I/tmp/src','-o','a.o','-c','/tmp/src/a.cpp'];entry={'directory':str(build),'file':'/tmp/src/a.cpp','arguments':args}
  full=['/usr/bin/ccache',*args[:3],'-MD','-MT','a.o','-MF','a.o.d',*args[3:]]
  target,cmd=c.original_command(entry,shlex.join(full),build);self.assertEqual(target,'a.o');self.assertEqual(cmd,full)
  for bad in [full+['&&','ninja','all'],[x.replace('undefined-inline','unused-variable')for x in full],full+['-Wno-error']]:
   with self.assertRaises(AssertionError):c.original_command(entry,shlex.join(bad),build)
 def test_selected_real_units_resolve_unified_includes(self):
  with tempfile.TemporaryDirectory()as t:
   root=pathlib.Path(t);source=root/'source';source.mkdir();build=root/'build';build.mkdir();commands=[];rels=[]
   for i in range(10):
    name=f'a{i}.cpp';rels.append(name);(source/name).write_text('// actual source\n');unit=build/f'UnifiedSource-{i}.cpp';unit.write_text('#include "'+name+'"\n')
    commands.append({'directory':str(build),'file':str(unit),'arguments':['/usr/bin/clang++','-I'+str(source),'-o',f'a{i}.o','-c',str(unit)]})
   self.assertEqual(len(gate.selected_entries(commands,rels,source)),10)
   with self.assertRaises(AssertionError):gate.selected_entries(commands+commands[:1],rels,source)
 def test_stage_failure_preserves_receipt_and_no_false_objects(self):
  with tempfile.TemporaryDirectory()as t:
   root=pathlib.Path(t)/'gate';g=gate.Gate(root,time.time())
   with self.assertRaisesRegex(AssertionError,'intentional failed'):g.run('intentional',['/bin/sh','-c','printf bounded-failure; exit 7'],5)
   g.report['status']='failed';g.persist();g.retain()
   result=json.loads((g.out/'result.json').read_text());self.assertEqual(result['steps'][0]['exitCode'],7);self.assertEqual(result['objectRetention']['files'],[])
   self.assertEqual((g.out/'intentional.log').read_text(),'bounded-failure')
 def test_object_retention_contains_only_completed_outputs(self):
  with tempfile.TemporaryDirectory()as t:
   g=gate.Gate(pathlib.Path(t)/'gate',time.time());g.build.mkdir();p=g.build/'obj/a.o';p.parent.mkdir();p.write_bytes(b'fake-object-for-archive-contract-only');(g.build/'secret.txt').write_text('must-not-archive')
   g.report['objects']=[{'target':'obj/a.o'}];g.retain()
   with tarfile.open(g.out/'selected-objects.tar.gz')as tar:self.assertEqual(tar.getnames(),['obj/a.o'])
   self.assertFalse(g.report['objectRetention']['crossJobRestoreProven'])
 def test_full_workflow_wiring_and_python_syntax(self):
  for p in HERE.glob('*.py'):ast.parse(p.read_text(),filename=str(p))
  workflow=(gate.REPO/'.github/workflows/linux-webkit-build-research.yml').read_text()
  job=workflow.split('\n  current-source-preflight:\n')[1]
  self.assertIn('timeout-minutes: 30',job);self.assertIn('timeout-minutes: 27',job);self.assertIn('if: always()',job)
  self.assertIn("inputs.operation != 'current-source-preflight'",workflow)
  self.assertNotIn('actions/cache',job);self.assertNotIn('continue-on-error',job)
  for command in ['PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s research/pdf-delivery-20261116 -p \'test_current_gate.py\' -v','python3 research/pdf-delivery-20261116/current_tu_gate.py --root "$RUNNER_TEMP/milkup-current-source-gate" --started "$CURRENT_GATE_STARTED"']:
   self.assertIn(command,job);subprocess.run(['bash','-n','-c',command],check=True)
  source=(HERE/'current_tu_gate.py').read_text();self.assertNotIn("'--build'",source);self.assertNotIn("'--install'",source);self.assertIn("'CCACHE_DISABLE':'1'",source)
  self.assertEqual(hashlib.sha256((HERE/'normal-path-2.54.2.patch').read_bytes()).hexdigest(),gate.PATCH_SHA)
if __name__=='__main__':unittest.main()

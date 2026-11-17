import hashlib,io,json,os,pathlib,tarfile,tempfile,unittest
from unittest import mock
import hosted_admission as a
import hosted_verify as v
import durable_probe as d
class Admission(unittest.TestCase):
 def setUp(self):self.t=tempfile.TemporaryDirectory();self.p=pathlib.Path(self.t.name)
 def tearDown(self):self.t.cleanup()
 def source(self):
  root=self.p/'source';root.mkdir();(root/'one.c').write_text('int one;');alias=root/a.ALIAS;alias.parent.mkdir(parents=True);alias.symlink_to(a.LINK);return root,{'one.c':d.sha(root/'one.c')},{a.ALIAS:a.LINK}
 def test_exact_alias_and_regular_source(self):
  root,files,aliases=self.source();a.verify_source(root,files,aliases);(root/'one.c').write_text('changed')
  with self.assertRaises(ValueError):a.verify_source(root,files,aliases)
 def test_no_added_file_or_alias(self):
  root,files,aliases=self.source();(root/'unexpected').write_text('x')
  with self.assertRaises(ValueError):a.verify_source(root,files,aliases)
  (root/'unexpected').unlink();(root/'other').symlink_to('one.c')
  with self.assertRaises(ValueError):a.verify_source(root,files,aliases)
 def test_declared_alias_must_stay_dangling(self):
  root,files,aliases=self.source();p=(root/a.ALIAS).resolve();p.parent.mkdir(parents=True,exist_ok=True);p.write_text('unexpected target')
  with self.assertRaises(ValueError):a.verify_source(root,files,aliases)
 def test_archive_alias_authenticated_and_missing_regular_rejected(self):
  archive=self.p/'test.tar.xz'
  with tarfile.open(archive,'w:xz')as t:
   m=tarfile.TarInfo('webkitgtk-2.54.2/one.c');m.size=1;t.addfile(m,io.BytesIO(b'x'));m=tarfile.TarInfo('webkitgtk-2.54.2/'+a.ALIAS);m.type=tarfile.SYMTYPE;m.linkname=a.LINK;t.addfile(m)
  files,aliases=a.expected_source(archive,{'inputs':{},'outputs':{},'newFiles':[]});self.assertEqual(files,{'one.c':hashlib.sha256(b'x').hexdigest()});root,_,_=self.source();(root/'one.c').unlink()
  with self.assertRaises(ValueError):a.verify_source(root,files,aliases)
 def test_source_member_traversal_rejected(self):
  for n in ['../x','/x','a/../x','a//b']:
   with self.assertRaises(ValueError):a.relative(n)
 def test_no_raw_data_in_public_outcome(self):
  bad=a.compact();bad['error']='SECRET /home/private'
  with self.assertRaises(ValueError):a.validate(bad)
  (self.p/'status.json').write_text(json.dumps(bad))
  with mock.patch('builtins.print')as out:r=a.publish(self.p)
  self.assertEqual(r,a.compact());self.assertNotIn('SECRET',str(out.call_args))
 def test_false_completion_rejected(self):
  for k in ['fullBuildAdmitted','fullEngineBuilt','completeSbom','privateEvidenceDurable','mapCompared']:
   bad=a.compact();bad[k]=True
   with self.assertRaises(ValueError):a.validate(bad)
  with self.assertRaises(ValueError):a.validate(a.compact(status='passed-configure-admission-only'))
 def test_pinned_entry_dependencies(self):a.pins()
 def test_readonly_verifier_rejects_changed_generated_file(self):
  source,files,aliases=self.source();build=self.p/'build';build.mkdir();archive=self.p/'source.tar.xz';archive.write_bytes(b'fixture')
  for name in a.META:
   p=build/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_text('{}')
  (build/'compile_commands.json').write_text(json.dumps([{}]*2833));(build/'CMakeCache.txt').write_text('PORT:STRING=GTK\n');generated=build/'generated.h';generated.write_text('fixture');tool=self.p/'tool';tool.write_bytes(b'tool')
  m={'schema':1,'harnessSha':'fixture','fullBuildAdmitted':False,'sourceRoot':str(source),'buildRoot':str(build),'archive':str(archive),'archiveSha256':d.sha(archive),'patchSha256':d.PINS['normal-path-2.54.2.patch'],'sourceFiles':files,'aliases':aliases,'metadata':{n:d.sha(build/n)for n in a.META},'tools':{'fixture':{'resolved':str(tool),'sha256':d.sha(tool)}},'generatedFiles':{'generated.h':d.sha(generated)},'compilerTargets':2833,'configureOptions':{'PORT':'GTK'},'configuration':{'api':'4.1','configSha256':d.sha(build/'cmakeconfig.h')}}
  p=self.p/'admission.json';p.write_text(json.dumps(m));h=d.sha(p)
  with mock.patch.object(a,'pins'),mock.patch.object(a,'SOURCE',d.sha(archive)),mock.patch.object(d,'product_check',return_value={'cmake':{'PORT':'GTK'}}),mock.patch.dict(os.environ,{'GITHUB_SHA':'fixture'}):
   self.assertTrue(v.verify(p,h));generated.write_text('mutated')
   with self.assertRaises(ValueError):v.verify(p,h)
 def test_workflow_exact_branch_no_upload_no_full_build(self):
  text=(a.REPO/'.github/workflows/provenance-configure.yml').read_text();self.assertIn('branches: [dot/provenance-configure-20261117]',text);self.assertIn('scripts/ci',text);self.assertNotIn('upload-artifact',text);self.assertNotIn('secrets.',text);self.assertNotIn('inputs.',text);self.assertIn('45m python3',text)
if __name__=='__main__':unittest.main()

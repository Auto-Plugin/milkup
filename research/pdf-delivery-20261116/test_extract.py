import importlib.util,json,pathlib,re,shutil,subprocess,sys,tempfile,unittest
import prepare,restore_sources
HERE=pathlib.Path(__file__).resolve().parent
class NormalPath(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  cls.temp=tempfile.TemporaryDirectory();cls.root=pathlib.Path(cls.temp.name);cls.source=restore_sources.restore('2.52.6',cls.root/'source');cls.tree=cls.root/'normal';cls.patch=cls.root/'normal.patch';cls.receipt=prepare.build(cls.source,cls.patch,cls.tree)
 @classmethod
 def tearDownClass(cls):cls.temp.cleanup()
 def test_exact_patch_and_no_research_or_paint_hook(self):
  self.assertEqual(self.patch.read_bytes(),(HERE/'normal-path-2.52.6.patch').read_bytes())
  for rel in ['page/PrintContext.cpp','rendering/RenderBox.cpp','rendering/RenderLayer.cpp','rendering/RenderBlock.cpp']:
   self.assertEqual((self.tree/'Source/WebCore'/rel).read_bytes(),(self.source/'Source/WebCore'/rel).read_bytes())
  added=''.join(x[1:]for x in self.patch.read_text().splitlines(True)if x.startswith('+')and not x.startswith('+++'))
  for token in ['MILKUP_','std::getenv','std::fprintf','probe-','Research','document.title()']:self.assertNotIn(token,added)
 def test_wrong_preimage_rejected(self):
  with tempfile.TemporaryDirectory()as d:
   root=pathlib.Path(d)/'source';shutil.copytree(self.source,root)
   p=root/'Source/WebCore/Headers.cmake';p.write_text(p.read_text()+'\n# changed\n')
   with self.assertRaises(AssertionError):prepare.build(root,pathlib.Path(d)/'out.patch')
 def test_real_compiled_policy_headers(self):
  folder=self.tree/'Source/WebCore/rendering'
  for filename in ['test_link_policy.cpp','../pdf-pagination-behavior-20261116/test_policy.cpp']:
   path=(HERE/filename).resolve();exe=self.root/path.stem
   subprocess.run(['c++','-std=c++20','-Wall','-Wextra','-Werror','-I'+str(folder),str(path),'-o',str(exe)],check=True,timeout=30)
   subprocess.run([str(exe)],check=True,timeout=5)
 def test_protected_text_and_real_harfbuzz(self):
  original=HERE.parent/'linux-pdf-unicode-20261114';sys.path.insert(0,str(original))
  spec=importlib.util.spec_from_file_location('normal_digit_probe',original/'test_digit_probe.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
  extracted=self.root/'extracted-text';extracted.mkdir()
  cascade=(self.tree/'Source/WebCore/platform/graphics/FontCascade.cpp').read_text()
  start=cascade.index('static std::optional<ScalarGlyphText> makeIndependentAsciiDigitText(');end=cascade.index('\n#endif',start)
  (extracted/'independent-digit-text.inc').write_text(cascade[start:end]+'\n')
  shutil.copyfile(self.tree/'Source/WebCore/platform/graphics/ScalarGlyphText.h',extracted/'ScalarGlyphText.h')
  shutil.copyfile(original/'scalar-glyph-text-test.cpp',extracted/'scalar-glyph-text-test.cpp')
  m.HERE=extracted;r=m.run(self.root/'metadata');self.assertEqual(r['status'],'passed-local-metadata-only');self.assertEqual(len(r['samples']),9)
  self.assertIn('sourceFrom || sourceTo != sourceRun->length()',cascade)
 def test_text_and_page_policies_unchanged_except_comments(self):
  strip=lambda s:re.sub(r'/\*.*?\*/|//[^\n]*','',s,flags=re.S).strip()
  for p,orig in [('platform/graphics/ScalarGlyphText.h',HERE.parent/'linux-pdf-unicode-20261114/ScalarGlyphText.h'),('rendering/FragmentKeepPolicy.h',HERE.parent/'pdf-pagination-behavior-20261116/FragmentKeepPolicy.h'),('rendering/RootTrailingMarginPolicy.h',HERE.parent/'pdf-pagination-behavior-20261116/RootTrailingMarginPolicy.h')]:
   self.assertEqual(strip((self.tree/'Source/WebCore'/p).read_text()),strip(orig.read_text()))
if __name__=='__main__':unittest.main()

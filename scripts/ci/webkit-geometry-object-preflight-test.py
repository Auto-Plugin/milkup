import importlib.util,pathlib,unittest,tempfile
p=pathlib.Path(__file__).with_name('webkit-geometry-object-preflight.py');s=importlib.util.spec_from_file_location('gate',p);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
class Gate(unittest.TestCase):
 def test_exact_official_name_generator(self):
  source=pathlib.Path('/tmp/source');build=pathlib.Path('/tmp/build')
  line='cd /tmp/build/Source/WebCore && /usr/bin/perl /tmp/source/Source/WebCore/dom/make_names.pl --outputDir /tmp/build/WebCore/DerivedSources --attrs /tmp/source/Source/WebCore/svg/xlinkattrs.in'
  cwd,args=m.name_generator_command('clang++ unrelated.cpp\n'+line,'XLink',source,build)
  self.assertEqual(cwd,build/'Source/WebCore');self.assertEqual(args[0],'/usr/bin/perl')
  for graph in [line+'\n'+line,line.replace('--outputDir /tmp/build','--outputDir /outside'),line.replace('/usr/bin/perl','/usr/bin/sh'),line.replace(' && ',' ; ')]:
   with self.subTest(graph=graph),self.assertRaises(AssertionError):m.name_generator_command(graph,'XLink',source,build)
 def test_generated_header_output_selection(self):
  build=pathlib.Path('/tmp/native-gate')
  required=['WebCore/DerivedSources/'+name+'Names.h'for name in ['XLink','XMLNS','XML']]
  targets=set(required+['WebCore/DerivedSources/DOMJITAbstractHeapRepository.h','WebCore/DerivedSources/x.o','JavaScriptCore/DerivedSources/LLIntAssembly.h'])
  self.assertEqual(m.generated_webcore_headers(targets,build),required)
  with self.assertRaises(AssertionError):m.generated_webcore_headers(set(required[1:]),build)
 def test_real_unified_relative_include_resolution(self):
  with tempfile.TemporaryDirectory()as d:
   root=pathlib.Path(d);source=root/'source';source.mkdir();(source/'page').mkdir();actual=source/'page/PrintContext.cpp';actual.write_text('// exact source')
   unit=root/'UnifiedSource-12.cpp';unit.write_text('#include "page/PrintContext.cpp"\n')
   entry={'file':str(unit),'directory':str(root),'arguments':['clang++','-I'+str(source)]}
   self.assertTrue(m.unit_contains(entry,actual.resolve()))
   entry['arguments']=['clang++'];self.assertFalse(m.unit_contains(entry,actual.resolve()))
   unit.write_text('#include "'+str(actual)+'"\n');self.assertTrue(m.unit_contains(entry,actual.resolve()))
 def test_header_only_plan(self):
  self.assertEqual(m.validate_header_plan('/usr/bin/python3 make-headers.py\n/usr/bin/cmake -E copy file.h target.h'),2)
  for compiler in ['clang++','clang','g++','gcc','ccache','clang++-22','ld.lld','ar']:
   with self.subTest(compiler=compiler),self.assertRaises(AssertionError):m.validate_header_plan('"/usr/bin/'+compiler+'" -c unrelated.cpp -o x.o')
 def test_incomplete_regeneration_plan_rejected(self):
  with self.assertRaises(AssertionError):m.validate_header_plan('[0/2] cmake -P VerifyGlobs.cmake\n[1/2] cmake --regenerate-during-build')
 def test_execution_matches_reviewed_graph(self):
  build=pathlib.Path('/tmp/native-gate');plan='/usr/bin/python3 make-headers.py'
  log='[0/2] /usr/bin/cmake -P /tmp/native-gate/CMakeFiles/VerifyGlobs.cmake\n[1/1] '+plan
  self.assertEqual(m.validate_header_execution(log,plan,build),{'commands':1,'globChecks':1})
  for extra in ['cmake --regenerate-during-build','clang++ -c unrelated.cpp','python3 unexpected.py','/usr/bin/cmake -P /other/VerifyGlobs.cmake',plan]:
   with self.subTest(extra=extra),self.assertRaises(AssertionError):m.validate_header_execution(log+'\n[2/2] '+extra,plan,build)
 def test_exact_old_error_required(self):
  error="x.h:824:22: error: inline function 'WebCore::RenderObject::localToAbsoluteQuad' is not defined [-Werror,-Wundefined-inline]"
  self.assertTrue(m.expected_old_failure(1,error))
  self.assertFalse(m.expected_old_failure(0,error));self.assertFalse(m.expected_old_failure(1,error+'\ny: error: another defect'))
  self.assertFalse(m.expected_old_failure(1,'fatal error: missing generated.h'))
 def test_actual_command_identity(self):
  build=pathlib.Path('/tmp/native-gate');args=['/usr/bin/clang++','-Werror=undefined-inline','-o','A.o','-c','/tmp/native-gate/UnifiedSource.cpp']
  entry={'directory':str(build),'file':args[-1],'arguments':args}
  actual=['/usr/bin/ccache']+args[:2]+['-MD','-MT','A.o','-MF','A.o.d']+args[2:]
  target,cmd=m.original_command(entry,' '.join(actual),build);self.assertEqual(target,'A.o');self.assertEqual(cmd,actual)
  with self.assertRaises(AssertionError):m.original_command(entry,' '.join(actual).replace('-Werror=undefined-inline','-Wno-undefined-inline'),build)
  with self.assertRaises(AssertionError):m.original_command(entry,' '.join(actual)+' ; echo unsafe',build)
if __name__=='__main__':unittest.main()

import copy,gzip,hashlib,io,json,os,pathlib,shlex,shutil,subprocess,tarfile,tempfile,unittest,zipfile
from unittest.mock import patch
import frontier_checkpoint as f
class FrontierContracts(unittest.TestCase):
 def fixture(self,root,pch=False):
  source=root/'source';build=root/'build';source.mkdir();build.mkdir();(build/'bin').mkdir()
  cc=shutil.which('clang++')if pch else shutil.which('cc');self.assertTrue(cc)
  ninja=os.environ.get('MILKUP_NINJA_TEST_BINARY')or shutil.which('ninja');self.assertTrue(ninja)
  (source/'helper.c').write_text('#include <stdio.h>\nint main(void){puts("#define VALUE 42");return 0;}\n')
  (source/'consumer.c').write_text('#include "generated.h"\nint answer(void){return VALUE;}\n')
  (source/'later.c').write_text('#include "generated.h"\nint later(void){return VALUE+1;}\n')
  flags=' -x c++'if pch else'';extra=' -Xclang -include-pch -Xclang '+str(build/'header.pch')if pch else''
  graph='rule cc\n  command = '+cc+flags+' -I. -MD -MT $out -MF $out.d -c $in -o $out\n  depfile = $out.d\n  deps = gcc\n'
  graph+='rule consumer\n  command = '+cc+flags+extra+' -I. -MD -MT $out -MF $out.d -c $in -o $out\n  depfile = $out.d\n  deps = gcc\n'
  link=cc+' helper.o -o bin/LLIntSettingsExtractor'
  graph+='rule link\n  command = '+link+'\nrule generate\n  command = bin/LLIntSettingsExtractor > generated.h\n  restat = 1\nrule initialize\n  command = touch initialized\nbuild initialized: initialize\n'
  graph+='build helper.o: cc '+str(source/'helper.c')+'\nbuild bin/LLIntSettingsExtractor: link helper.o\nbuild generated.h: generate bin/LLIntSettingsExtractor\n'
  entries={};pchcmd=None
  if pch:
   (source/'header.cxx').write_text('#include "generated.h"\n')
   pchcmd=[cc,'-I.','-Xclang','-fno-pch-timestamp','-Xclang','-emit-pch','-x','c++-header','-MD','-MT','header.pch','-MF','header.pch.d','-c',str(source/'header.cxx'),'-o','header.pch']
   graph+='rule pch\n  command = '+shlex.join(pchcmd)+'\n  depfile = header.pch.d\n  deps = gcc\nbuild header.pch: pch '+str(source/'header.cxx')+' | generated.h\n'
   entries['header.pch']={'target':'header.pch','source':str(source/'header.cxx'),'command':pchcmd,'kind':'pch'}
  for name,rule in [('helper','cc'),('consumer','consumer'),('later','consumer')]:
   a=[cc]+(['-x','c++']if pch else[])
   if pch and name!='helper':a+=['-Xclang','-include-pch','-Xclang',str(build/'header.pch')]
   a+=['-I.','-MD','-MT',name+'.o','-MF',name+'.o.d','-c',str(source/(name+'.c')),'-o',name+'.o']
   entries[name+'.o']={'target':name+'.o','source':str(source/(name+'.c')),'command':a,'kind':'object'}
   if name!='helper':graph+='build '+name+'.o: '+rule+' '+str(source/(name+'.c'))+' | '+('header.pch'if pch else'generated.h')+'\n'
  (build/'build.ninja').write_text(graph)
  identity={'schema':f.SCHEMA,'compiler':f.digest(pathlib.Path(cc).resolve()),'graph':hashlib.sha256(graph.encode()).hexdigest()}
  def run(args):return subprocess.check_output([ninja,*args],cwd=build,text=True,stderr=subprocess.STDOUT,timeout=60)
  def restore_run(name,args,limit,cwd,env=None):return subprocess.check_output(args,cwd=cwd,text=True,stderr=subprocess.STDOUT,env=env,timeout=limit)
  return source,build,entries,identity,graph,run,restore_run,{'bin/LLIntSettingsExtractor':link},ninja
 def exercise(self,pch):
  with tempfile.TemporaryDirectory()as d:
   root=pathlib.Path(d);source,build,entries,identity,graph,run,restore_run,helpers,ninja=self.fixture(root,pch)
   with patch.dict(os.environ,{'PATH':str(pathlib.Path(ninja).parent)+os.pathsep+os.environ['PATH']}):
    run(['-v','-d','keepdepfile','initialized','consumer.o'])
    m,payload=f.capture(build,source,entries,identity,['consumer.o'],helpers)
    self.assertEqual(m['compiledObjectCount'],2);self.assertEqual(m['pchCount'],int(pch))
    self.assertNotIn('build/bin/LLIntSettingsExtractor',payload);self.assertNotIn('build/header.pch',payload)
    archive=root/'checkpoint.tar.gz';f.write_archive(archive,m,payload);h=f.digest(archive)
    shutil.rmtree(build);build.mkdir();(build/'bin').mkdir();(build/'build.ninja').write_text(graph);run(['initialized'])
    staging=root/'staging';loaded=f.load_archive(archive,h,identity,staging)
    # Re-hash an intentionally damaged archive: the per-member receipt must
    # still reject it; an outer SHA check alone is insufficient.
    bad=root/'corrupt-member.tar.gz'
    with tarfile.open(archive,'r:gz')as src,tarfile.open(bad,'w:gz')as dest:
     for info in src:
      content=src.extractfile(info).read()
      if info.name=='build/consumer.o':content=bytes([content[0]^1])+content[1:]
      dest.addfile(info,io.BytesIO(content))
    with self.assertRaisesRegex(AssertionError,'Damaged frontier member'):f.load_archive(bad,f.digest(bad),identity,root/'bad-member')
    self.assertFalse((build/'consumer.o').exists())
    wrong={**identity,'graph':'changed'}
    with self.assertRaisesRegex(AssertionError,'identity'):f.load_archive(archive,h,wrong,root/'wrong')
    with self.assertRaisesRegex(AssertionError,'Damaged'):f.load_archive(archive,'0'*64,identity,root/'damaged')
    old=(source/'consumer.c').read_bytes();(source/'consumer.c').write_bytes(old+b'\n/* altered */\n')
    with self.assertRaisesRegex(AssertionError,'Changed compiler input'):f.restore(loaded,staging,build,source,restore_run,entries,helpers)
    self.assertFalse((build/'consumer.o').exists());self.assertFalse((build/'generated.h').exists());(source/'consumer.c').write_bytes(old)
    proof=f.restore(loaded,staging,build,source,restore_run,entries,helpers)
    self.assertEqual(proof['restoredObjects'],2);self.assertEqual(proof['regeneratedHelpers'],['bin/LLIntSettingsExtractor'])
    self.assertEqual(len(proof['regeneratedPch']),int(pch));self.assertIn('no work to do',run(['-v','-d','keepdepfile','consumer.o']))
    log=run(['-v','-d','keepdepfile','later.o']);self.assertIn('-o later.o',log);self.assertNotIn('-o consumer.o',log)
    for t in ['helper.o','consumer.o']:self.assertEqual(f.digest(build/t),m['records'][t]['sha256'])
 def test_real_generated_input_and_regenerated_helper_skip_old_objects(self):self.exercise(False)
 @unittest.skipUnless(shutil.which('clang++'),'Real Clang PCH fixture runs in SDK-equipped CI; local compiler unavailable')
 def test_real_clang_pch_regeneration_and_native_graph_reuse(self):self.exercise(True)
 def test_real_webcore_graph_contains_generated_helpers_pch_and_downstream(self):
  with zipfile.ZipFile(f.seg.restored.ARTIFACT)as z:
   r=json.loads(z.read('result.json'));meta=r['retainedConfigurationFiles']['compile_commands.json'];raw=z.read('graph/compile_commands.json')if meta['encoding']=='raw'else b''.join(gzip.decompress(z.read('graph/'+x['file']))for x in meta['parts'])
   plan=z.read('FontCascade-graph.log').decode();build=pathlib.Path(next(iter(r['selectedUnits'].values()))['directory']);entries=f.compile_entries(json.loads(raw),plan,build)
   self.assertGreater(len(entries),350);self.assertTrue(any(e['kind']=='pch'for e in entries.values()));self.assertTrue(any('Source/WebCore/'in t for t in entries));self.assertEqual(set(f.helper_commands(plan)),f.HELPERS)
   self.assertTrue(all('-fno-pch-timestamp'in e['command']for e in entries.values()if e['kind']=='pch'))
 def test_paths_and_checkpoint_identity_fail_closed(self):
  with tempfile.TemporaryDirectory()as d:
   b=pathlib.Path(d)
   for name in ['../outside','/tmp/outside','a/../../b']:
    with self.assertRaises(AssertionError):f.safe_path(b,name)
   outside=b/'source';outside.mkdir();(b/'escape').symlink_to('/usr')
   with self.assertRaises(AssertionError):f.safe_path(b,'escape/file')
  for identity in [{'schema':'old'},{'schema':f.SCHEMA,'compiler':'new'}]:
   with self.assertRaises(AssertionError):f.check_identity({'schema':f.SCHEMA,'identity':identity},{'schema':f.SCHEMA})
if __name__=='__main__':unittest.main()

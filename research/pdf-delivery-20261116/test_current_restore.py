import copy,hashlib,json,os,pathlib,shlex,shutil,subprocess,tempfile,unittest,zipfile
import current_object_restore as restore
class RestoreContract(unittest.TestCase):
 def test_original_identity_and_payload_are_pinned(self):
  self.assertEqual(restore.gate.digest(restore.ARTIFACT),restore.ARTIFACT_SHA)
  with zipfile.ZipFile(restore.ARTIFACT)as z:
   report=json.loads(z.read('result.json'));old=restore.identity(report,json.loads(z.read('generated-header-sha256.json')),z.read('installed-package-inventory.log'))
   restore.require_identity(old,copy.deepcopy(old))
   for name in old:
    wrong=copy.deepcopy(old);wrong[name]={'wrong':True}
    with self.assertRaises(AssertionError):restore.require_identity(old,wrong)
   missing=copy.deepcopy(old);missing.pop('tools')
   with self.assertRaises(AssertionError):restore.require_identity(old,missing)
   data=z.read('selected-objects.tar.gz');payload=restore.object_payload(data,report['objectRetention']);self.assertEqual(len(payload),20)
   with self.assertRaises(AssertionError):restore.object_payload(data+b'changed',report['objectRetention'])
   bad=copy.deepcopy(report['objectRetention']);bad['files'][0]['sha256']='0'*64
   with self.assertRaises(AssertionError):restore.object_payload(data,bad)
 def test_no_partial_restore_on_mismatch(self):
  with tempfile.TemporaryDirectory()as t:
   b=pathlib.Path(t);(b/'a.o').write_bytes(b'a');(b/'b.o').write_bytes(b'b');before=(b/'a.o').stat().st_mtime_ns
   with self.assertRaises(AssertionError):restore.restore_equivalent({'a.o':b'a','b.o':b'wrong'},b)
   self.assertEqual((b/'a.o').stat().st_mtime_ns,before);self.assertEqual((b/'b.o').read_bytes(),b'b')
   with self.assertRaises(AssertionError):restore.restore_equivalent({'../foreign':b'x'},b)
 def test_real_ninja_restored_objects_keep_exact_command_and_dependency_state(self):
  ninja=os.environ.get('MILKUP_NINJA_TEST_BINARY')or shutil.which('ninja')
  if not ninja:self.skipTest('No local Ninja; actual runner dependency path must provide it')
  cxx=shutil.which('c++');ld=shutil.which('ld');self.assertTrue(cxx and ld)
  with tempfile.TemporaryDirectory()as t:
   b=pathlib.Path(t);header=b/'prefix.hxx';header.write_text('inline int value() { return 42; }\n')
   (b/'a.cpp').write_text('int alpha(){return value();}\n');(b/'b.cpp').write_text('int beta(){return value()+1;}\n');(b/'foreign.cpp').write_text('int foreign(){return 0;}\n')
   definitions=[];targets=['prefix.hxx.gch','a.o','b.o']
   for i,target in enumerate(targets):
    source=header if i==0 else b/(target[0]+'.cpp')
    cmd=[cxx,'-MD','-MT',target,'-MF',target+'.d']+(['-x','c++-header']if i==0 else['-include',str(header)])+['-o',target,'-c',str(source)]
    definitions.append(restore.seed_rule(i,shlex.join(cmd),target,source,()if i==0 else('prefix.hxx.gch',)))
   seed=b/'seed.ninja';seed.write_text(''.join(definitions))
   def run(args):return subprocess.check_output(args,cwd=b,text=True,stderr=subprocess.STDOUT,timeout=30)
   run([ninja,'-f',str(seed),'-d','keepdepfile','-v',*targets])
   payload={name:(b/name).read_bytes()for name in ['a.o','a.o.d','b.o','b.o.d']}
   # A second compiler process produces fresh state, then old bytes replace it.
   for name in [*targets,*(x+'.d'for x in targets),'.ninja_log','.ninja_deps']:(b/name).unlink()
   run([ninja,'-f',str(seed),'-d','keepdepfile','-v',*targets])
   restore.restore_equivalent(payload,b)
   noop=run([ninja,'-f',str(seed),'-n','-v',*targets]);self.assertIn('no work to do',noop)
   full=b/'full.ninja';text=''.join(definitions).replace(' | prefix.hxx.gch\n',' | prefix.hxx.gch || foreign.o\n')
   text+='rule unrelated\n  command = '+shlex.join([cxx,'-c',str(b/'foreign.cpp'),'-o','foreign.o'])+'\nbuild foreign.o: unrelated '+str(b/'foreign.cpp')+'\n';full.write_text(text)
   dry=run([ninja,'-f',str(full),'-n','-v','a.o','b.o']);self.assertFalse(restore.plan_compiles(dry,set(targets)));self.assertFalse((b/'foreign.o').exists())
   run([ld,'-r','--fatal-warnings','-o','partial.o','a.o','b.o']);self.assertIn('REL (Relocatable file)',run(['readelf','-h','partial.o']))
   header.write_text('inline int value() { return 43; }\n')
   dirty=run([ninja,'-f',str(full),'-n','-v','a.o','b.o']);self.assertTrue(restore.plan_compiles(dirty,set(targets)))
 def test_real_manifest_dry_run_is_not_compilation_proof(self):
  ninja=os.environ.get('MILKUP_NINJA_TEST_BINARY')or shutil.which('ninja')
  if not ninja:self.skipTest('No local Ninja')
  with tempfile.TemporaryDirectory()as t:
   b=pathlib.Path(t);(b/'input').write_text('first');(b/'verify').write_text('stamp')
   graph=('rule verify\n  command = true\n  restat = 1\nrule RERUN_CMAKE\n  command = echo --regenerate-during-build && touch build.ninja\n  generator = 1\n'
    'rule compile\n  command = cp input object\nbuild force: phony\nbuild verify: verify force\nbuild build.ninja: RERUN_CMAKE verify\n  pool = console\nbuild object: compile input\n')
   (b/'build.ninja').write_text(graph)
   def run(args):return subprocess.check_output([ninja,*args],cwd=b,text=True,stderr=subprocess.STDOUT,timeout=30)
   run(['-v','object']);before=(b/'build.ninja').read_bytes();run(['-v','build.ninja']);self.assertEqual(before,(b/'build.ninja').read_bytes())
   blocked=run(['-n','-v','object']);self.assertIn('--regenerate-during-build',blocked)
   with self.assertRaises(AssertionError):restore.require_expanded_plan(blocked)
   snapshot,proof=restore.settled_inspection_graph(graph);self.assertTrue(proof['compilationAndLinkEdgesUnchanged'])
   (b/'inspection.ninja').write_text(snapshot);expanded=run(['-f','inspection.ninja','-n','-v','object']);restore.require_expanded_plan(expanded);self.assertIn('no work to do',expanded)
   import time
   time.sleep(0.02);(b/'input').write_text('changed')
   changed=run(['-f','inspection.ninja','-n','-v','object']);self.assertIn('cp input object',changed)
   with self.assertRaises(AssertionError):restore.settled_inspection_graph(graph.replace('build build.ninja:', 'build build.ninja stolen.o:'))
 def test_actual_failed_receipt_and_exact_graph_snapshot(self):
  import gzip
  path=restore.HERE/'evidence/43856901779/original.zip'
  with zipfile.ZipFile(path)as z:
   with self.assertRaises(AssertionError):restore.require_expanded_plan(z.read('restored-full-graph-dry-run.log').decode())
   r=json.loads(z.read('result.json'));meta=r['retainedConfigurationFiles']['build.ninja']
   graph=(z.read('graph/build.ninja')if meta['encoding']=='raw'else b''.join(gzip.decompress(z.read('graph/'+v['file']))for v in meta['parts'])).decode()
   snapshot,proof=restore.settled_inspection_graph(graph)
   self.assertEqual(graph.replace(proof['removedBlock'],'',1),snapshot)
   edges=lambda text:[l for l in text.splitlines()if l.startswith('build ')and ': RERUN_CMAKE 'not in l]
   self.assertEqual(edges(graph),edges(snapshot));self.assertNotIn(': RERUN_CMAKE ',snapshot)
 def test_restore_workflow_is_manual_bounded_and_not_engine_build(self):
  workflow=(restore.gate.REPO/'.github/workflows/linux-webkit-build-research.yml').read_text()
  job=workflow.split('\n  current-source-restore:\n')[1]
  self.assertIn("inputs.operation != 'current-source-restore'",workflow)
  for value in ['timeout-minutes: 30','timeout-minutes: 27','if: always()',"-p 'test_current*.py'",'current_object_restore.py']:
   self.assertIn(value,job)
  self.assertNotIn('actions/cache',job);self.assertNotIn('continue-on-error',job)
  for line in job.splitlines():
   if line.strip().startswith('run: '):subprocess.run(['bash','-n','-c',line.strip()[5:]],check=True)
 def test_seed_cannot_change_or_expand_original_command(self):
  command='/usr/bin/clang++ -DVALUE=$value -o a.o -c /tmp/a.cpp'
  text=restore.seed_rule(0,command,'a.o','/tmp/a.cpp');self.assertIn('$$value',text)
  with self.assertRaises(AssertionError):restore.seed_rule(0,command+'\nextra command','a.o','/tmp/a.cpp')
if __name__=='__main__':unittest.main()

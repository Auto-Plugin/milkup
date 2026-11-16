import ast,copy,gzip,hashlib,io,json,os,pathlib,shlex,shutil,subprocess,tarfile,tempfile,time,unittest,zipfile
import current_segment as seg
class SegmentContract(unittest.TestCase):
 def test_real_graph_batch_preserves_commands_and_avoids_prior_objects(self):
  with zipfile.ZipFile(seg.restored.ARTIFACT)as z:
   r=json.loads(z.read('result.json'));meta=r['retainedConfigurationFiles']['compile_commands.json']
   raw=z.read('graph/compile_commands.json')if meta['encoding']=='raw'else b''.join(gzip.decompress(z.read('graph/'+v['file']))for v in meta['parts'])
   db=json.loads(raw);build=pathlib.Path(next(iter(r['selectedUnits'].values()))['directory'])
   rows=seg.select_entries(db,z.read('FontCascade-graph.log').decode(),build)
   self.assertEqual(len(rows),28);self.assertFalse({v['target']for v in rows}&{v['target']for v in r['objects']})
   for row in rows:
    self.assertNotIn('-include-pch',row['command']);bad=row['command']+['-DCHANGED_FLAG=1']
    with self.assertRaises(AssertionError):seg.match_original(row['entry'],bad,build)
 def test_real_checkpoint_restore_skips_old_and_compiles_only_successor(self):
  ninja=os.environ.get('MILKUP_NINJA_TEST_BINARY')or shutil.which('ninja');cc=shutil.which('cc')
  if not ninja or not cc:self.skipTest('Real Ninja and C compiler required')
  with tempfile.TemporaryDirectory()as t:
   root=pathlib.Path(t);source=root/'source';build=root/'build';source.mkdir();build.mkdir()
   h=source/'value.h';h.write_text('#define VALUE 42\n')
   for name in ['a','b','c']:(source/(name+'.c')).write_text('#include "value.h"\nint '+name+'(void){return VALUE;}\n')
   graph='rule cc\n  command = '+cc+' -MD -MT $out -MF $out.d -c $in -o $out\n  depfile = $out.d\n  deps = gcc\nrule stamp\n  command = touch initialized\nbuild initialized: stamp\n'
   graph+=''.join('build '+n+'.o: cc '+str(source/(n+'.c'))+'\n'for n in ['a','b','c'])
   (build/'build.ninja').write_text(graph)
   def run(args):return subprocess.check_output([ninja,*args],cwd=build,text=True,stderr=subprocess.STDOUT,timeout=30)
   first=run(['-v','-d','keepdepfile','a.o','b.o']);self.assertEqual(len(seg.commands(first)),2)
   identity={'schema':seg.SCHEMA,'testCompiler':seg.gate.digest(pathlib.Path(cc).resolve()),'graph':seg.sha(graph.encode())}
   seg.verify_native_deps(run(['-t','deps']),['a.o','b.o'],build)
   manifest,payload=seg.capture_manifest(build,source,['a.o','b.o'],identity);archive=root/'checkpoint.tar.gz';seg.write_checkpoint(archive,manifest,payload);digest=seg.gate.digest(archive)
   # Remove the entire old build directory: no old object/state survives locally.
   shutil.rmtree(build);build.mkdir();(build/'build.ninja').write_text(graph);run(['initialized']);os.utime(h,None)
   loaded,files=seg.load_checkpoint(archive,digest,identity)
   for wrong in [b'corrupted',archive.read_bytes()+b'changed']:
    with self.assertRaises(AssertionError):seg.load_checkpoint_bytes(wrong,digest,identity)
   wrong_identity={**identity,'schema':'old-2526-schema'}
   with self.assertRaises(AssertionError):seg.load_checkpoint(archive,digest,wrong_identity)
   damaged=dict(files);damaged['a.o']+=b'corrupt'
   with self.assertRaises(AssertionError):seg.restore_checkpoint(loaded,damaged,build,source)
   h.write_text('#define VALUE 99\n')
   with self.assertRaisesRegex(AssertionError,'Changed compiler input'):seg.restore_checkpoint(loaded,files,build,source)
   self.assertFalse((build/'a.o').exists());self.assertFalse((build/'.ninja_deps').exists())
   h.write_text('#define VALUE 42\n');seg.restore_checkpoint(loaded,files,build,source)
   skipped=run(['-v','-d','keepdepfile','a.o','b.o']);self.assertIn('no work to do',skipped)
   more=run(['-v','-d','keepdepfile','a.o','b.o','c.o']);compiled=seg.commands(more);self.assertEqual(len(compiled),1);self.assertEqual(seg.target_of(compiled[0]),'c.o')
   self.assertEqual((build/'a.o').read_bytes(),files['a.o']);self.assertEqual((build/'b.o').read_bytes(),files['b.o'])
   h.write_text('#define VALUE 43\n');dirty=run(['-n','-v','a.o','b.o']);self.assertEqual(len(seg.commands(dirty)),2)
 def test_host_inputs_are_never_retimed(self):
  with tempfile.TemporaryDirectory()as t:
   p=pathlib.Path(shutil.which('cc')).resolve();st=p.stat();row={str(p):{'sha256':seg.gate.digest(p),'bytes':st.st_size,'mtimeNs':st.st_mtime_ns,'owned':False}}
   seg.check_inputs(row,pathlib.Path(t)/'build',pathlib.Path(t)/'source');row[str(p)]['mtimeNs']+=1
   with self.assertRaisesRegex(AssertionError,'Host metadata drift'):seg.check_inputs(row,pathlib.Path(t)/'build',pathlib.Path(t)/'source')
   self.assertEqual(p.stat().st_mtime_ns,st.st_mtime_ns)
 def test_archive_paths_unknown_schema_and_elf_are_rejected(self):
  with tempfile.TemporaryDirectory()as t:
   archive=pathlib.Path(t)/'bad.tar.gz'
   with tarfile.open(archive,'w:gz')as tar:
    info=tarfile.TarInfo('../escape');info.size=1;tar.addfile(info,io.BytesIO(b'x'))
   with self.assertRaises(AssertionError):seg.load_checkpoint(archive,seg.gate.digest(archive),{'schema':seg.SCHEMA})
  with self.assertRaises(AssertionError):seg.object_bytes(b'not an object')
 def test_only_segment_hook_skips_prior_selected_compilation(self):
  self.assertIsNone(seg.gate.Gate.before_compilation(None));self.assertIs(seg.Segment.before_compilation(None),False)
  source=(seg.gate.HERE/'current_tu_gate.py').read_text();self.assertIn('if self.before_compilation() is False:return',source)
  ast.parse((seg.gate.HERE/'current_segment.py').read_text())
 def test_workflow_has_two_clean_bounded_jobs_and_no_automatic_repeat(self):
  workflow=(seg.gate.REPO/'.github/workflows/linux-webkit-build-research.yml').read_text()
  self.assertIn("inputs.operation != 'current-object-segment'",workflow)
  for name in ['current-segment-build','current-segment-resume']:
   job=workflow.split('\n  '+name+':\n')[1].split('\n  current-',1)[0]
   self.assertIn('timeout-minutes: 30',job);self.assertIn('if: always()',job);self.assertNotIn('continue-on-error',job)
   self.assertIn('-p \'test_current*.py\'',job)
  resume=workflow.split('\n  current-segment-resume:\n')[1]
  self.assertIn('needs: current-segment-build',resume);self.assertIn('needs.current-segment-build.outputs.checkpoint_sha256',resume)
  self.assertIn('actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093',resume)
if __name__=='__main__':unittest.main()

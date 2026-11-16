import ast,gzip,json,pathlib,re,subprocess,unittest
import current_engine as e
class EngineContracts(unittest.TestCase):
 def test_predecessor_is_exact_and_not_legacy_relabeling(self):
  m=json.loads(gzip.decompress(e.LEGACY_MANIFEST.read_bytes()));self.assertEqual(m['identity']['harnessSha'],e.LEGACY_PRODUCER);self.assertEqual(len(m['targets']),28)
  s=(e.HERE/'current_engine.py').read_text();self.assertIn("assert m==pinned",s);self.assertIn("pinned['identity']['configuration']==self.generic_identity['configuration']",s)
  self.assertIn('regenerated', (e.HERE/'frontier_checkpoint.py').read_text())
 def test_resource_and_stall_boundaries(self):
  g=1024**3
  self.assertIsNone(e.stop_reason(1,100,3*g,9*g,0))
  for values in [(100,100,3*g,9*g,0),(1,100,g,9*g,0),(1,100,3*g,g,0),(1,100,3*g,9*g,1800)]:self.assertIsNotNone(e.stop_reason(*values))
 def test_owned_sampling_includes_separate_child_groups_but_rejects_pid_reuse(self):
  known={10:100};table={10:{'parent':1,'group':10,'birth':100},11:{'parent':10,'group':11,'birth':200},12:{'parent':11,'group':12,'birth':300},13:{'parent':1,'group':13,'birth':400}}
  self.assertEqual(set(e.select_owned(table,known)),{10,11,12})
  table[11]['parent']=1;del table[10];table[12]['birth']=999
  self.assertEqual(set(e.select_owned(table,known)),{11})
 def test_original_command_and_single_link_phase_are_explicit(self):
  s=(e.HERE/'current_engine.py').read_text();ast.parse(s)
  self.assertIn("'-j','2'",s);self.assertIn("'-j','1','all'",s);self.assertIn("'-shared'in shlex.split",s)
  self.assertIn('remaining-45*60',s);self.assertIn('270*60',s);self.assertIn('35*60',s)
  self.assertIn("g.snapshot('stopped-completed-objects')",s);self.assertNotIn('continue-on-error',s)
 def test_workflow_is_bounded_manual_same_run_and_no_paid_runner(self):
  s=(e.gate.REPO/'.github/workflows/linux-webkit-build-research.yml').read_text()
  for name,limit in [('current-webcore-frontier',60),('current-engine-continuation',355),('current-engine-normal',355)]:
   j=s.split('\n  '+name+':\n')[1].split('\n  current-',1)[0]
   self.assertIn('runs-on: ubuntu-26.04',j);self.assertIn('timeout-minutes: '+str(limit),j);self.assertIn('if: always()',j);self.assertNotIn('continue-on-error',j)
  for script in re.findall(r'^        run: \|\n((?:          .*\n|\n)+)',s,re.M):
   subprocess.run(['bash','-n','-c','\n'.join(line[10:]for line in script.splitlines())],check=True)
  self.assertIn('run-id: 43864252208',s);self.assertIn('needs: current-webcore-frontier',s);self.assertIn('needs.current-webcore-frontier.outputs.checkpoint_sha256',s)
  self.assertIn("inputs.operation != 'current-engine-continuation'",s)
 def test_same_job_normal_mode_does_not_claim_fresh_checkpoint_restore(self):
  s=(e.gate.REPO/'.github/workflows/linux-webkit-build-research.yml').read_text()
  j=s.split('\n  current-engine-normal:\n')[1]
  self.assertNotIn('needs:',j);self.assertIn('run-id: 43864252208',j)
  self.assertIn('--mode normal',j);self.assertNotIn('--mode resume',j)
  self.assertIn("inputs.operation != 'current-engine-normal'",s)
  source=(e.HERE/'current_engine.py').read_text()
  self.assertIn("if self.engine_mode=='normal':self.complete_normal_build(selected)",source)
if __name__=='__main__':unittest.main()

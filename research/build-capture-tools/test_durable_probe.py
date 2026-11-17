import hashlib,json,pathlib,tempfile,unittest
import durable_probe as d
class Probe(unittest.TestCase):
 def setUp(self):self.t=tempfile.TemporaryDirectory();self.root=pathlib.Path(self.t.name)
 def tearDown(self):self.t.cleanup()
 def test_real_over64mib_lossless_private_fixture_and_safe_public(self):
  private=self.root/'private';public=self.root/'public';self.assertEqual(d.run('smoke',private,0),0);m=d.verify_private(private/'synthetic-parts');self.assertEqual(m['rawBytes'],96*1024**2);self.assertEqual(len(m['parts']),12)
  receipt=d.publish(private,public);self.assertEqual(receipt['status'],'passed-scaffold-only');self.assertFalse(receipt['configured']);self.assertFalse(receipt['privateEvidenceDurable']);self.assertLess((public/'status.json').stat().st_size,4096);self.assertEqual([x.name for x in public.iterdir()],['status.json'])
  part=private/'synthetic-parts/000.gz';part.write_bytes(part.read_bytes()+b'corrupt')
  with self.assertRaises(ValueError):d.verify_private(private/'synthetic-parts')
 def test_arbitrary_private_error_and_unknown_fields_never_escape(self):
  private=self.root/'private';private.mkdir();sentinel='SECRET /home/private-person/confidential-audit.txt token=do-not-export';(private/'state.json').write_text(json.dumps({'schema':1,'status':'failed','phase':'sdk','fullEngineBuilt':False,'completeSbom':False,'error':sentinel}));public=self.root/'public';r=d.publish(private,public);self.assertEqual(r['status'],'incomplete');self.assertNotIn('SECRET',(public/'status.json').read_text());self.assertNotIn('private-person',(public/'status.json').read_text())
 def test_contract_failure_is_retained_not_green(self):
  private=self.root/'private';public=self.root/'public';self.assertEqual(d.run('smoke',private,7),1);r=d.publish(private,public);self.assertEqual(r['errorCode'],'contracts-failed');self.assertEqual(r['status'],'failed')
 def test_missing_state_incomplete(self):self.assertEqual(d.publish(self.root/'missing',self.root/'public')['status'],'incomplete')
 def test_budget_rejects_before_retaining(self):
  p=self.root/'large'
  with p.open('wb') as f:f.truncate(d.MAX_RAW+1)
  with self.assertRaises(ValueError):d.retain_private(p,self.root/'output')
  self.assertFalse((self.root/'output').exists())
 def test_source_alias_rejected(self):
  p=self.root/'x';p.write_bytes(b'fixture');link=self.root/'alias';link.symlink_to(p)
  with self.assertRaises(ValueError):d.retain_private(link,self.root/'output')
 def test_public_symlink_and_extra_files_rejected(self):
  public=self.root/'public';public.mkdir();(public/'raw-audit').write_text('must-not-upload')
  with self.assertRaises(ValueError):d.publish(self.root/'missing',public)
 def test_same_product_pins(self):self.assertEqual(d.product_check()['cmake']['ENABLE_BUBBLEWRAP_SANDBOX'],'ON')
 def test_workflow_is_push_smoke_only_and_no_broad_upload(self):
  text=(d.HERE.parents[1]/'.github/workflows/provenance-smoke.yml').read_text()
  self.assertIn('branches: [dot/provenance-smoke-20261117]',text);self.assertIn("github.event_name == 'push'",text);self.assertIn('PROBE_MODE: smoke',text)
  self.assertNotIn('workflow_dispatch',text);self.assertNotIn('inputs.',text);self.assertNotIn('/evidence/',text);self.assertNotIn('secrets.',text);self.assertNotIn('sudo ',text);self.assertNotIn('configure',text)
  self.assertEqual(text.count('uses: actions/upload-artifact@'),1);self.assertIn('path: ${{ runner.temp }}/provenance-public/status.json',text);self.assertIn('durable-receipt-check:',text);self.assertIn('240s python3 -m unittest',text);self.assertIn('180s python3',text)
  legacy=(d.HERE.parents[1]/'.github/workflows/linux-webkit-build-research.yml').read_bytes();self.assertEqual(hashlib.sha1(b'blob '+str(len(legacy)).encode()+b'\0'+legacy).hexdigest(),'3e6ef886f12b81f65a96d8d5cbc39abdf9e0660d')
 def test_configure_hook_stops_before_pch_or_tu(self):
  source=(d.RESEARCH/'current_tu_gate.py').read_text();hook=source.index('if self.before_compilation() is False:return');self.assertLess(hook,source.index("self.compile_attempt(f'compile-pch-"));self.assertLess(hook,source.index("self.compile_attempt('compile-'+"));self.assertIn('return False',(d.HERE/'durable_probe.py').read_text())
 def test_minimal_or_inconsistent_pass_rejected(self):
  for status in ['passed-scaffold-only','passed-configure-only']:
   with self.assertRaises(ValueError):d.validate({'schema':1,'status':status,'phase':'complete','fullEngineBuilt':False,'completeSbom':False})
if __name__=='__main__':unittest.main()

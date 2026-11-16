#!/usr/bin/env python3
import importlib.util,pathlib,tempfile,unittest,json,subprocess,shutil
from unittest.mock import patch
HERE=pathlib.Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('transfer',HERE/'webkit-pagination-cache.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class Transfer(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.root=pathlib.Path(self.tmp.name)
  self.cache=self.root/'cache';self.cache.mkdir();self.bundle=self.root/'bundle';self.restored=self.root/'restored'
  self.identity={k:m.canonical(k)for k in m.objects.IDENTITY_FIELDS}
  for name in ['a/b/knownR','a/b/knownM']:
   p=self.cache/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(b'ccache-format-replaced-by-inspector-test')
  (self.cache/'private.pem').write_text('not selected');(self.cache/'ccache.conf').write_text('not selected')
 def capture(self):
  with patch.object(m,'inspect'):return m.capture(self.cache,self.bundle,self.identity)
 def test_roundtrip_excludes_unrelated_files(self):
  r=self.capture();self.assertEqual(len(r['entries']),2)
  m.restore(self.bundle,self.restored,self.identity)
  self.assertFalse((self.restored/'private.pem').exists());self.assertFalse((self.restored/'ccache.conf').exists())
 def test_every_identity_change_rejected_before_copy(self):
  self.capture()
  for field in self.identity:
   with self.assertRaises(AssertionError):m.restore(self.bundle,self.restored,{**self.identity,field:'0'*64})
   self.assertFalse(self.restored.exists())
 def test_truncated_entry_rejected(self):
  self.capture();(self.bundle/'a/b/knownR').write_bytes(b'truncated')
  with self.assertRaises(AssertionError):m.restore(self.bundle,self.restored,self.identity)
 def test_symlink_rejected(self):
  (self.cache/'link').symlink_to('/etc/hosts')
  with self.assertRaises(AssertionError):self.capture()
  self.assertFalse(self.bundle.exists())
 def test_capacity_and_time_fail_without_complete_bundle(self):
  with patch.object(m,'LIMIT',1),self.assertRaises(AssertionError):self.capture()
  self.assertFalse(self.bundle.exists())
  with patch.object(m,'inspect'),self.assertRaises(AssertionError):m.capture(self.cache,self.bundle,self.identity,budget=0)
 def test_real_compiler_object_envelope_and_runtime_rejection(self):
  compiler=shutil.which('cc');self.assertIsNotNone(compiler)
  source=self.root/'sample.c';source.write_text('int sample(void) { return 42; }\n')
  subprocess.run([compiler,'-c',str(source),'-o',str(self.root/'sample.o')],check=True)
  self.assertTrue(m.objects.read_object(self.root,'sample.o').startswith(b'\x7fELF'))
  subprocess.run([compiler,'-shared','-fPIC',str(source),'-o',str(self.root/'runtime.o')],check=True)
  with self.assertRaises(ValueError):m.objects.read_object(self.root,'runtime.o')
 def test_workflow_has_always_retention_without_acceptance_bypass(self):
  flow=(HERE.parents[1]/'.github/workflows/linux-webkit-build-research.yml').read_text().split('\n  pagination-preflight:\n')[1]
  self.assertIn("always() && inputs.operation == 'pagination-segment' && steps.cache-transfer.outcome == 'success'",flow)
  self.assertIn("steps.pagination-engine.outcome == 'success'",flow)
  self.assertNotIn('continue-on-error',flow)
if __name__=='__main__':unittest.main()

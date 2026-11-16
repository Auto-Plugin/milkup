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
 def test_behavior_identity_roundtrip_and_no_legacy_downgrade(self):
  original=dict(self.identity)
  self.assertEqual(m.cache_key(original),m.objects.key(original))
  self.identity['behaviorInputs']=m.canonical({'patch':'candidate','source':'exact','headers':'exact'})
  # Reproduce the failed run's schema mismatch before checking the fix.
  with self.assertRaises(ValueError):m.objects.key(self.identity)
  receipt=self.capture()
  self.assertTrue(receipt['key'].startswith('pagination-behavior-objects-v1-'))
  for wrong in [original,{**self.identity,'behaviorInputs':'0'*64}]:
   with self.assertRaises(AssertionError):m.restore(self.bundle,self.restored,wrong)
   self.assertFalse(self.restored.exists())
  m.restore(self.bundle,self.restored,self.identity)
  self.assertEqual((self.restored/'a/b/knownR').read_bytes(),(self.cache/'a/b/knownR').read_bytes())
 def test_behavior_key_rejects_unknown_missing_or_non_digest_fields(self):
  good={**self.identity,'behaviorInputs':m.canonical('candidate')}
  for wrong in [{**good,'token':'0'*64},{**good,'behaviorInputs':'/tmp/source'},
                {k:v for k,v in good.items()if k!='compiler'}]:
   with self.assertRaises(ValueError):m.cache_key(wrong)
  for field in good:
   self.assertNotEqual(m.cache_key(good),m.cache_key({**good,field:'0'*64}))
 def test_legacy_inventory_bridge_requires_every_header_hash(self):
  old=m.ROOT/'research/pdf-pagination-mechanism-20261116/evidence/43794564331/generated-header-sha256.json'
  data=json.loads(old.read_text());evidence=self.root/'evidence';p=evidence/'pagination-object-gate/generated-header-sha256.json';p.parent.mkdir(parents=True)
  p.write_text(json.dumps(dict(reversed(list(data.items())))))
  current={**self.identity,'generatedHeaders':m.canonical(data)}
  restored=m.incoming_identity(current,evidence,'43794564331')
  self.assertEqual(restored['generatedHeaders'],m.digest(old))
  self.assertNotEqual(m.digest(p),m.digest(old))
  data[next(iter(data))]='0'*64;p.write_text(json.dumps(data))
  with self.assertRaises(AssertionError):m.incoming_identity({**current,'generatedHeaders':m.canonical(data)},evidence,'43794564331')
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

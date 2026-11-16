#!/usr/bin/env python3
import ast,hashlib,importlib.util,json,os,pathlib,tempfile,unittest
from unittest.mock import patch
import native_probe as native
import inherited_tests
import support_integrity
HERE=pathlib.Path(__file__).resolve().parent
class NativeContracts(unittest.TestCase):
 def test_original_support_integrity_except_exact_reviewed_hooks(self):
  receipt=json.loads((HERE/'support/source-receipt.json').read_text())
  for name in ['launch_helper.py']:
   self.assertEqual(hashlib.sha256((HERE/'support'/name).read_bytes()).hexdigest(),receipt[name])
  support_integrity.verify_audit((HERE/'support/pagination_audit.py').read_bytes(),receipt['pagination_audit.py'])
  s=(HERE/'support/calibrate.py').read_text();self.assertEqual(s.count('verify_private_libraries(libs)'),1)
  original=s.replace('verify_private_libraries(libs)',"assert all(x.startswith('/usr/lib/') for x in libs)")
  self.assertEqual(hashlib.sha256(original.encode()).hexdigest(),receipt['calibrate.py'])
 def test_uri_representation_delta_cannot_change_thresholds_or_original_receipt(self):
  original=(HERE/'support/pagination_audit.py').read_bytes()
  receipt=json.loads((HERE/'support/source-receipt.json').read_text())['pagination_audit.py']
  delta=(HERE.parent/'pdf-combined-20261116/support-uri-serialization.patch').read_bytes()
  for changed in [original+b'\n',original.replace(b'mw-2',b'mw-20'),original.replace(b'len(pages) >= 3',b'len(pages) >= 1')]:
   self.assertNotEqual(changed,original)
   with self.assertRaises(AssertionError):support_integrity.verify_audit(changed,receipt)
  with self.assertRaises(AssertionError):support_integrity.verify_audit(original,support_integrity.AFTER)
  with self.assertRaises(AssertionError):support_integrity.verify_audit(original,receipt,delta+b'\n')
 def test_private_runtime_binding_rejects_system_wrong_bytes_and_mutation(self):
  with tempfile.TemporaryDirectory()as tmp:
   p=pathlib.Path(tmp);paths=[];rows=[]
   for name in ['libwebkit2gtk-4.1.so.0','libjavascriptcoregtk-4.1.so.0']:
    f=p/name;f.write_bytes(b'known');paths.append(str(f));rows.append({'path':name,'bytes':5,'sha256':native.sha(f)})
   m={'status':'private-observation-runtime-built-not-accepted','prefix':tmp,'runtimeFiles':rows}
   verify,_=native.runtime_verifier(p,m);verify(paths)
   with self.assertRaises(AssertionError):verify(['/usr/lib/libwebkit2gtk-4.1.so.0',paths[1]])
   pathlib.Path(paths[0]).write_bytes(b'wrong')
   with self.assertRaises(AssertionError):verify(paths)
   verify,_=native.runtime_verifier(p,m)
   with self.assertRaises(AssertionError):verify(paths)
 def test_pdf_coordinates_and_known_failure_remain_independent(self):
  def word(t):return {'text':t,'box':[10,20,30,40]}
  current={'errors':['a4-portrait: T: orphan heading'],'papers':[{'pages':[{'words':[word('TABLESECTION')]},{'words':[word('TABLELEFT'),word('TABLERIGHT'),word('TAA')]}]}]}
  obs={'finalVisibleBoxPages':{1:[1],4:[2],5:[2],6:[2]}}
  with patch.object(native.contract,'observations',return_value=obs):
   self.assertEqual(native.compare_diagnostic_pdf('baseline-baseline',current,current,None),obs)
   changed=json.loads(json.dumps(current));changed['papers'][0]['pages'][1]['words'][0]['box'][0]+=1
   with self.assertRaises(AssertionError):native.compare_diagnostic_pdf('baseline-baseline',changed,current,None)
   changed=json.loads(json.dumps(current));changed['errors']=[]
   with self.assertRaises(AssertionError):native.compare_diagnostic_pdf('baseline-baseline',changed,current,None)
  obs['finalVisibleBoxPages'][1]=[1,2]
  with patch.object(native.contract,'observations',return_value=obs),self.assertRaises(AssertionError):native.compare_diagnostic_pdf('baseline-baseline',current,current,None)
  obs['finalVisibleBoxPages'][1]=[1]
  obs['finalVisibleBoxPages'][6]=[1]
  with patch.object(native.contract,'observations',return_value=obs),self.assertRaises(AssertionError):native.compare_diagnostic_pdf('baseline-baseline',current,current,None)
 def test_fixed_patch_and_four_tu_success_gate_precede_build(self):
  p=HERE.parents[1]/'scripts/ci/webkit-pagination-continue.py';s=p.read_text();ast.parse(s)
  self.assertLess(s.index("gate['status']=='passed'"),s.index("['cmake','--build'"))
  self.assertIn('3a84a75ae9aad83e8f93940c4d55b886c6cf2cba069ca087893fa2efe2e443c8',s)
  self.assertEqual(hashlib.sha256((HERE/'observation-only.patch').read_bytes()).hexdigest(),'3a84a75ae9aad83e8f93940c4d55b886c6cf2cba069ca087893fa2efe2e443c8')
  self.assertIn("'maxSeconds':1200,'maxNewCacheMisses':64",s)
  self.assertIn("row['newMisses']>report['maxNewCacheMisses']",s)
  self.assertIn("row['seconds']>=report['maxSeconds']",s)
  self.assertIn("acceptanceAndRetentionReserveSeconds=3600",s)
if __name__=='__main__':
 names=['test_lineage_requires_stable_birth_image_uid_and_guardian','test_repeated_headers_required_on_each_data_page','test_frames_are_bounded_and_partial_retained','test_exact_reference_rejects_missing_or_wrong_page_coordinates','test_short_table_does_not_require_fragmentation_but_long_still_does','test_fd_transfer_and_stop_eof']
 suite=unittest.TestSuite([unittest.defaultTestLoader.loadTestsFromTestCase(NativeContracts),*(inherited_tests.Contracts(n)for n in names)])
 r=unittest.TextTestRunner(verbosity=2).run(suite);raise SystemExit(0 if r.wasSuccessful()else 1)

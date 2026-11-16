import importlib.util,json,pathlib,subprocess,tempfile,unittest,hashlib
HERE=pathlib.Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('behavior_prepare',HERE/'prepare.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
SOURCE=pathlib.Path('/tmp/milkup-webkit-header-preflight/source')
class Candidate(unittest.TestCase):
 def test_exact_policy_compiles_and_boundary_invariants(self):
  with tempfile.TemporaryDirectory() as d:
   binary=pathlib.Path(d)/'policy';subprocess.run(['c++','-std=c++20','-Wall','-Wextra','-Werror',str(HERE/'test_policy.cpp'),'-o',str(binary)],check=True);subprocess.run([str(binary)],check=True)
 def test_original_failure_precedes_candidate(self):
  p=HERE.parent/'pdf-pagination-mechanism-20261116/evidence/43808221193/offline-recheck.json';r=json.loads(p.read_text());row=r['cases'][0]
  self.assertEqual(row['retainedProductErrors'],['a4-portrait: T: orphan heading']);self.assertEqual(len(row['retainedHeaderErrors']),3)
  self.assertEqual(row['maxCoordinateDeltaPt'],0)
 def test_patch_and_observer_compose_without_changing_inputs(self):
  if not SOURCE.exists():self.skipTest('Matched source is obtained separately in CI')
  with tempfile.TemporaryDirectory() as d:
   root=pathlib.Path(d);locks=json.loads((HERE/'source-lock.json').read_text());locks.update(json.loads((HERE.parent/'pdf-pagination-mechanism-20261116/source-lock.json').read_text()))
   for rel,h in locks.items():
    data=(SOURCE/'Source/WebCore'/rel).read_bytes();self.assertEqual(hashlib.sha256(data).hexdigest(),h)
    dest=root/'Source/WebCore'/rel;dest.parent.mkdir(parents=True,exist_ok=True);dest.write_bytes(data)
   patch=root/'candidate.patch';m.build(root,patch);self.assertEqual(patch.read_bytes(),(HERE/'candidate.patch').read_bytes())
   subprocess.run(['git','apply','--unsafe-paths',str(HERE.parent/'pdf-pagination-mechanism-20261116/observation-only.patch')],cwd=root,check=True)
   subprocess.run(['git','apply','--check',str(patch)],cwd=root,check=True)
   subprocess.run(['git','apply',str(patch)],cwd=root,check=True)
   # Force negative: matching filenames are insufficient; one changed source byte rejects.
   with self.assertRaises(AssertionError):m.build(root,root/'wrong.patch')
 def test_new_acceptance_rejects_original_native_failure(self):
  import sys
  sys.path.insert(0,str(HERE))
  import behavior_contract
  old=HERE.parent/'pdf-pagination-mechanism-20261116/evidence/43808221193/native-original.zip'
  import zipfile
  with zipfile.ZipFile(old) as z:
   current=json.loads(z.read('observed-baseline-baseline/pagination-audit.json'))
   with self.assertRaisesRegex(AssertionError,'Original content/orphan/clipping'):
    behavior_contract.verify_pdf(current,None)
  for paper in behavior_contract.PAPERS:
   html='@page{size:A4;margin:16mm}'
   adapted=behavior_contract.adapted_html(html,paper)
   self.assertIn('margin:16mm',adapted)
   self.assertIn(paper['pageSize'].upper(),adapted)
 def test_payload_and_cleanup_are_original_except_explicit_paper(self):
  base=(HERE.parent/'pdf-pagination-mechanism-20261116/observed_render.py').read_text()
  expected=base.replace('def render(binary,guard,html,out,env):',"def render(binary,guard,html,out,env,paper):\n    assert paper['pageSize'] in ['a4','letter'] and paper['orientation'] in ['portrait','landscape']")
  expected=expected.replace("'pageSize':'a4','landscape':False", "'pageSize':paper['pageSize'],'landscape':paper['orientation']=='landscape'")
  expected=expected.replace("(out/'a4-portrait.pdf')", "(out/(paper['name']+'.pdf'))")
  self.assertEqual(expected,(HERE/'paper_render.py').read_text())
 def test_no_dom_rewrite_or_global_table_unbreakable(self):
  text=(HERE/'candidate.patch').read_text()
  self.assertNotIn('mkp-',text);self.assertNotIn('MILKUP_PAGINATION_PROBE',text)
  self.assertNotIn('setBreakInside',text);self.assertNotIn('setStyle',text)
  self.assertIn('pageTop - tableAbsolute',text)
  self.assertIn('m_printHeaderOffsets.clear()',text)
if __name__=='__main__':unittest.main()

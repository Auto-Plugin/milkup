import copy,hashlib,importlib.util,json,os,pathlib,subprocess,sys,tempfile,unittest
HERE=pathlib.Path(__file__).resolve().parent
def load(name,path):
 spec=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
c=load('combined_contract_test',HERE/'contract.py');p=load('combined_prepare_test',HERE/'prepare.py')
class Combined(unittest.TestCase):
 def test_owned_font_delivery_keeps_bytes_and_avoids_web_font_fallback(self):
  base=HERE.parent/'pdf-pagination-mechanism-20261116';sys.path[:0]=[str(HERE.parent/'pdf-pagination-behavior-20261116'),str(base),str(base/'support')]
  n=load('combined_native_test',HERE/'native.py')
  with tempfile.TemporaryDirectory()as tmp:
   root=pathlib.Path(tmp);fixture=root/'fixture';fixture.mkdir()
   r=n.local_digit_fixtures(fixture)
   self.assertEqual(r['fontSha256'],'abc2db27dd79b379653fc34ec37c6adef941d6b53e3a690f47ee64c837339dd2')
   html=(fixture/'digit-candidate.html').read_text();self.assertNotIn('@font-face',html);self.assertNotIn('data:font',html)
   self.assertIn("font-family:'MilkupDigitCollisionResearch'",html)
   self.assertEqual((fixture/'digit-baseline.html').read_text(),html)
   env=os.environ.copy()
   for key in ['DATA','CONFIG','CACHE','STATE']:
    p=root/key;p.mkdir();env['XDG_'+key+'_HOME']=str(p)
   before=subprocess.check_output(['fc-match','--format','%{file}\n','MilkupDigitCollisionResearch'],env=env,text=True).strip()
   receipt=n.prepare_owned_font(fixture,env);self.assertNotEqual(before,receipt['fcMatch']);self.assertEqual(r['fontSha256'],receipt['sha256'])
 def test_page_boundaries_reject_missing_or_not_final_layout(self):
  rows=[dict(kind='page',phase=phase,page=page,printing=True,layoutReady=True)for page in [1,2]for phase in ['begin','end']]
  def text(r):return '\n'.join(c.PREFIX+json.dumps(v)for v in r)
  self.assertEqual(c.pages(text(rows),2)['records'],4)
  for change in [lambda r:r.pop(),lambda r:r[1].update(page=2),lambda r:r[0].update(layoutReady=False),lambda r:r[0].update(printing=False),lambda r:r[0].update(phase='end'),lambda r:r[0].update(kind='error')]:
   r=copy.deepcopy(rows);change(r)
   with self.assertRaises(AssertionError):c.pages(text(r),2)
 def test_combined_result_never_inherits_missing_or_failed_cases(self):
  rows=[dict(case=n,identityPassed=True,pageBoundary={'status':'passed'})for n in c.NAMES]
  self.assertTrue(c.complete(rows,{'status':'passed'}));self.assertFalse(c.complete(rows[:-1],{'status':'passed'}));self.assertFalse(c.complete(rows[::-1],{'status':'passed'}));self.assertFalse(c.complete(rows,{'status':'failed'}))
  rows[0]['identityPassed']=False;self.assertFalse(c.complete(rows,{'status':'passed'}))
 def test_original_documents_require_same_run_fidelity(self):
  r={'results':[dict(case=str(i),paginationPassed=True,uriDiagnosticPassed=True,mappingDiagnostics=[{'exact':True}for _ in range(3)])for i in range(7)],'rootMarginControls':[{'passed':True,'combinedFidelity':True}for _ in range(2)]}
  c.original_fidelity(r)
  for mutate in [lambda x:x['results'].pop(),lambda x:x['results'][0].update(uriDiagnosticPassed=False),lambda x:x['results'][1]['mappingDiagnostics'][0].update(exact=False),lambda x:x['rootMarginControls'][0].pop('combinedFidelity')]:
   v=copy.deepcopy(r);mutate(v)
   with self.assertRaises(AssertionError):c.original_fidelity(v)
 def test_every_stream_requires_same_kernel_process_and_unmodified_bytes(self):
  base=HERE.parent/'pdf-pagination-mechanism-20261116';sys.path[:0]=[str(base),str(base/'support')]
  import process_capture
  lines=[prefix+b'{}\n'for prefix in process_capture.PREFIXES]
  rows=[dict(pid=7,uid=1,pidfdId='first',sha256=hashlib.sha256(x).hexdigest())for x in lines]
  process=dict(pid=7,uid=1,image='/exact/WebKitWebProcess',noNewPrivs=1,seccomp=2,capEff=0)
  self.assertEqual(process_capture.bind_records(b''.join(lines),rows,{'first':process}),'first')
  for i in range(len(rows)):
   altered=copy.deepcopy(rows);altered[i]['pidfdId']='second'
   with self.assertRaises(AssertionError):process_capture.bind_records(b''.join(lines),altered,{'first':process,'second':process})
  with self.assertRaises(AssertionError):process_capture.bind_records(b''.join(lines),rows[:-1],{'first':process})
 def test_exact_composition_and_tampered_preimage(self):
  source=pathlib.Path('/tmp/milkup-combined-source')
  if not source.exists():self.skipTest('Local matched overlay; CI composer and actual TU gates remain mandatory')
  with tempfile.TemporaryDirectory()as tmp:
   root=pathlib.Path(tmp)
   for rel,h in json.loads((HERE/'source-lock.json').read_text()).items():
    if h is not None:
     f=root/rel;f.parent.mkdir(parents=True,exist_ok=True);f.write_bytes((source/rel).read_bytes())
   out=root/'combined.patch';receipt=p.build(root,out)
   self.assertEqual(out.read_bytes(),(HERE/'combined.patch').read_bytes())
   self.assertEqual(receipt,json.loads((HERE/'source-receipt.json').read_text()))
   subprocess.run(['git','apply','--check',str(out)],cwd=root,check=True)
   original=(root/p.PC).read_text();(root/p.PC).write_text(original+'\n')
   with self.assertRaises(AssertionError):p.build(root,out)
if __name__=='__main__':unittest.main()

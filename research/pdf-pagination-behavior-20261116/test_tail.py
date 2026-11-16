import copy,hashlib,importlib.util,json,pathlib,subprocess,sys,tempfile,unittest
HERE=pathlib.Path(__file__).resolve().parent;BASE=HERE.parent/'pdf-pagination-mechanism-20261116'
sys.path[:0]=[str(HERE),str(BASE),str(BASE/'support')]
import tail_contract,prepare_tail,process_capture

def fixture():
 rows=[]
 for phase,result in [('before',6995),('after',7011)]:rows.append(dict(kind='margin',role=1,node=7,phase=phase,content=6995,result=result,pending=16,collapseBefore=False,collapseAfter=False,borderPaddingAfter=0,scrollbar=0,collapsedAfter=0))
 base={'pages':{}}
 for page in range(1,10):
  rect=[0,(page-1)*875,651,page*875];base['pages'][page]={'header':{'rect':rect}}
  rows.append(dict(kind='document',page=page,document=[0,0,651,7011],pageRect=rect))
  for role in range(1,5):rows.append(dict(kind='box',page=page,role=role,node=role+6,top=0,height=6995,marginBefore=0,marginAfter=16,collapsedAfter=16,before=0,after=0,quad=[0,0,651,6995],layout=[0,0,651,6995],visual=[0,0,651,6995]))
 for n,r in enumerate(rows,1):r.update(seq=n,tick=n)
 return rows,base

def log(rows):return '\n'.join(tail_contract.PREFIX+json.dumps(r)for r in rows)

class Tail(unittest.TestCase):
 def test_observed_margin_not_a_pdf_waiver(self):
  rows,base=fixture();r=tail_contract.parse(log(rows),base)
  self.assertEqual(r['marginTransitions'][0]['addedHeight'],16)
  self.assertEqual(len(r['pages']),9);self.assertIn('independent',r['scope'])
 def test_reject_missing_reordered_identity_clock_geometry_and_unknown(self):
  changes=[lambda r:r.pop(),lambda r:r[1].update(seq=9),lambda r:r[1].update(tick=0),lambda r:r[3].update(node=32),lambda r:r[2].update(pageRect=[0,0,651,874]),lambda r:r[3].update(quad=[0,5,5,0]),lambda r:r[3].update(height=float('nan')),lambda r:r[1].update(phase='ignored'),lambda r:r[7].update(document=[0,0,651,7000])]
  for change in changes:
   rows,base=fixture();change(rows)
   with self.subTest(change=change),self.assertRaises((AssertionError,KeyError)):tail_contract.parse(log(rows),base)
 def test_both_logs_need_same_kernel_webprocess_and_exact_bytes(self):
  lines=[b'MILKUP_PAGINATION {}\n',b'MILKUP_TAIL {}\n']
  rows=[dict(pid=17,uid=1,pidfdId='a',sha256=hashlib.sha256(x).hexdigest())for x in lines]
  process=dict(pid=17,uid=1,image='/exact/WebKitWebProcess',noNewPrivs=1,seccomp=2,capEff=0)
  self.assertEqual(process_capture.bind_records(b''.join(lines),rows,{'a':process}),'a')
  with self.assertRaises(AssertionError):process_capture.bind_records(b''.join(lines),rows[:1],{'a':process})
  rows[1]['pidfdId']='b'
  with self.assertRaises(AssertionError):process_capture.bind_records(b''.join(lines),rows,{'a':process,'b':process})
 def test_source_anchor_and_diagnostic_only_delta(self):
  source=pathlib.Path('/tmp/milkup-webkit-header-preflight/source')
  if not source.exists():self.skipTest('Matching source local precheck only; CI actual TU gate is mandatory')
  spec=importlib.util.spec_from_file_location('observation',BASE/'prepare.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
  with tempfile.TemporaryDirectory()as td:
   root=pathlib.Path(td)
   for rel in set(json.loads((BASE/'source-lock.json').read_text()))|set(json.loads((HERE/'source-lock.json').read_text())):
    p=root/'Source/WebCore'/rel;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes((source/'Source/WebCore'/rel).read_bytes())
   obs=root/'obs.patch';m.prepare(root,obs);subprocess.run(['git','apply',str(obs)],cwd=root,check=True)
   subprocess.run(['git','apply',str(HERE/'candidate.patch')],cwd=root,check=True)
   p=root/'tail.patch';r=prepare_tail.build(root,p)
   self.assertEqual(p.read_bytes(),(HERE/'tail-observation.patch').read_bytes())
   subprocess.run(['git','apply','--check',str(p)],cwd=root,check=True)
   self.assertEqual(r['behaviorPatchSha256'],'660f13b8e61ed2e6af4a1bec7602e08755b4deb685e4af9d6c639053286f210f')
   originals={rel:(root/'Source/WebCore'/rel).read_text()for rel in ['rendering/RenderBlockFlow.cpp','page/PrintContext.cpp']}
   prepare_tail.build(root,p,write=True)
   for rel,old in originals.items():
    new=(root/'Source/WebCore'/rel).read_text()
    # Every added production-TU line is an include or a read-only recorder.
    stripped='\n'.join(x for x in new.splitlines() if 'MilkupTailResearch' not in x)+'\n'
    self.assertEqual(stripped,old)
if __name__=='__main__':unittest.main()

import copy,hashlib,os,pathlib,sys,unittest
HERE=pathlib.Path(__file__).resolve().parent;BASE=HERE.parent/'pdf-pagination-mechanism-20261116'
sys.path[:0]=[str(HERE),str(BASE),str(BASE/'support')]
import stock_capture,stock_probe,fixtures
from behavior_contract import PAPERS,adapted_html

class StockTests(unittest.TestCase):
 def row(self):
  return {'pidfdId':'1:2','pid':42,'birth':100,'uid':os.getuid(),'image':'/usr/lib/x/WebKitWebProcess','noNewPrivs':1,'seccomp':2,'capEff':0,'lineage':[{'pid':42,'birth':100},{'pid':41}], 'mappedFiles':{'webkit':{},'jsc':{}},'imageFile':{'inode':12}}
 def test_stock_identity_and_negative_controls(self):
  row=self.row();self.assertEqual(stock_capture.bind_stock(b'',[],{'1:2':row}),'1:2')
  for key,value in [('image','/usr/bin/milkup-desktop'),('pidfdId','other'),('birth',101),('noNewPrivs',0),('seccomp',0),('capEff',1),('mappedFiles',{}),('imageFile',{})]:
   bad=copy.deepcopy(row);bad[key]=value
   with self.subTest(key=key),self.assertRaises(AssertionError):stock_capture.bind_stock(b'',[],{'1:2':bad})
  with self.assertRaises(AssertionError):stock_capture.bind_stock(b'',[],{'1:2':row,'other':row})
  with self.assertRaises(AssertionError):stock_capture.bind_stock(b'MILKUP_PAGINATION fake',[],{'1:2':row})
  with self.assertRaises(AssertionError):stock_capture.bind_stock(b'',[{}],{'1:2':row})
 def test_original_flow_is_preserved(self):
  a=(HERE/'paper_render.py').read_text();b=(HERE/'stock_render.py').read_text()
  self.assertEqual(a.replace('from process_capture import Observer','from stock_capture import StockObserver as Observer'),b)
  original=(BASE/'process_capture.py').read_text().split(' def __exit__(self,kind,value,tb):')[1]
  current=(HERE/'stock_capture.py').read_text().split(' def __exit__(self,kind,value,tb):')[1]
  self.assertEqual(original.replace('bind_records(', 'bind_stock(').replace('kernel-sender-bound','live-stock-webprocess-bound'),current)
 def test_exact_inputs_and_page_only_change(self):
  raw=(BASE/'fixtures/baseline-baseline.html').read_text();annotated=fixtures.annotate(raw)
  self.assertEqual(hashlib.sha256(raw.encode()).hexdigest(),'2cb840a7643c5172004787ef47d697b66dfdeb604691d50e14e1181d84a64b92')
  for p in [PAPERS[0],PAPERS[2],PAPERS[3]]:
   text=adapted_html(annotated,p)
   if p['name']!='a4-portrait':text=text.replace('@page{size:LETTER '+p['orientation']+';margin:16mm}','@page{size:A4;margin:16mm}')
   self.assertEqual(text,annotated)
 def test_exact_coordinate_gate(self):
  row={'width':10,'height':20,'words':[{'text':'a','box':[1,2,3,4]}]*693}
  self.assertEqual(stock_probe.exact_coordinates([row],[row])['words'],693)
  bad=copy.deepcopy(row);bad['words'][0]['box'][0]+=.000001
  with self.assertRaises(AssertionError):stock_probe.exact_coordinates([bad],[row])
 def test_no_private_build_or_unbounded_retry(self):
  s=(HERE/'prepare_stock.py').read_text()
  self.assertNotIn("run('source-download'",s);self.assertNotIn('dpkg-source',s)
  self.assertIn("'libwebkit2gtk-4.1-0='+version",s)
  s=(HERE/'stock_probe.py').read_text();self.assertIn('for paper in [PAPERS[0],PAPERS[2],PAPERS[3]]',s)
  self.assertIn("if not safe:raise",s);self.assertIn("'failed-original-pagination-contract'",s)
if __name__=='__main__':unittest.main()

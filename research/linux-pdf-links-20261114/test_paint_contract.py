import copy,json,pathlib,subprocess,tempfile,unittest
import paint_contract as p
import layout_contract as l
from test_layout_contract import records,parse

class PaintContract(unittest.TestCase):
 def clip_case(self):
  rows=records();node=next(r for r in rows if r.get('idHex')=='probe-clipped'.encode().hex())
  node['fragments']=[[8,235.875,182.104,259.875]];node['clips']=[[8,235.875,73,253.875]]
  pages=parse(rows);clip={'kind':'clip','page':1,'path':'box','phase':32,'scale':1,'ctm':pages[1]['header']['ctm'],'raw':node['clips'][0],'actual':[8,236,73,254]}
  return pages,{'clips':[clip]}
 def test_independent_actual_clip_without_tolerance_change(self):
  pages,paint=self.clip_case();changed,proof=p.actual_clip_pages(pages,paint)
  self.assertEqual(changed[1]['elements']['probe-clipped']['clips'],[[8,236,73,254]])
  self.assertEqual(pages[1]['elements']['probe-clipped']['clips'],[[8,235.875,73,253.875]])
  self.assertEqual(proof[0]['snappingPrediction'],[8,236,73,254])
  self.assertEqual(l.rounding_bound(pages[1]['header']['ctm']),l.rounding_bound(changed[1]['header']['ctm']))
 def test_missing_wrong_clip_or_unproven_snapping_rejected(self):
  for mutation in [lambda x:x['clips'].clear(),lambda x:x['clips'][0]['raw'].__setitem__(0,9),lambda x:x['clips'][0]['actual'].__setitem__(1,237),lambda x:x['clips'].append({**x['clips'][0],'actual':[8,235,73,253]})]:
   pages,paint=self.clip_case();mutation(paint)
   with self.assertRaises(AssertionError):p.actual_clip_pages(pages,paint)
 def test_paint_phase_and_completeness(self):
  pages=parse(records(False),False);rows=[{'kind':'begin','page':1,'dedup':False},{'kind':'end','page':1}]
  log='\n'.join(p.PREFIX+json.dumps(x)for x in rows);p.parse(log,pages,False,False)
  for bad in [rows[:-1],rows+[{'kind':'error'}],[{'kind':'begin','page':1,'dedup':True},rows[1]]]:
   with self.assertRaises(AssertionError):p.parse('\n'.join(p.PREFIX+json.dumps(x)for x in bad),pages,False,False)
 def test_call_vs_item_multiplicity_and_false_emission(self):
  pages=parse(records());rows=[{'kind':'begin','page':1,'dedup':False}]
  for i,ident in enumerate(l.IDS):
   raw=[[0,0,10,10]]*(2 if ident=='probe-neighbor'else 1)
   rows.append({'kind':'focus','page':1,'call':i+1,'phase':64,'idHex':ident.encode().hex(),'raw':raw,'emitted':len(raw),'ctm':[1,0,0,1,0,0]})
  rows.append({'kind':'end','page':1})
  log=lambda x:'\n'.join(p.PREFIX+json.dumps(r)for r in x)
  parsed=p.parse(log(rows),pages,False,True);neighbor=[r for r in parsed['focus']if r['id']=='probe-neighbor']
  self.assertEqual(len(neighbor),1);self.assertEqual(neighbor[0]['duplicateItems'],1)
  twice=copy.deepcopy(rows);n=copy.deepcopy(next(r for r in rows if r.get('idHex')=='probe-neighbor'.encode().hex()));n['call']=99;twice.insert(-1,n)
  self.assertEqual(len([r for r in p.parse(log(twice),pages,False,True)['focus']if r['id']=='probe-neighbor']),2)
  bad=copy.deepcopy(rows);bad[1]['emitted']=0
  with self.assertRaises(AssertionError):p.parse(log(bad),pages,False,True)
 def test_exact_cpp_dedup_is_per_call(self):
  helper=pathlib.Path(__file__).with_name('unique-per-call.inc').read_text()
  code='#include <algorithm>\n#include <array>\n#include <vector>\n#include <cassert>\nusing Rect=std::array<int,4>;\nstruct Rects:std::vector<Rect>{using std::vector<Rect>::vector;void append(const Rect&r){push_back(r);}};\n'+helper+'''
int main(){Rect a{0,0,10,10},b{10,0,20,10},c{0,20,10,30};
Rects input{a,a,b,c,b};auto one=uniquePerCall(input);assert(one==Rects({a,b,c}));
// Separate pages/calls/links retain identical areas; no shared state or URI key.
auto otherPage=uniquePerCall(input);assert(otherPage==one);
auto otherLink=uniquePerCall(Rects{a});assert(otherLink==Rects{a});
assert(input.size()==5);assert(uniquePerCall(Rects{}).empty());}
'''
  with tempfile.TemporaryDirectory()as d:
   root=pathlib.Path(d);src=root/'case.cpp';src.write_text(code)
   subprocess.run(['c++','-std=c++20','-Wall','-Wextra','-Werror',str(src),'-o',str(root/'case')],check=True,timeout=30)
   subprocess.run([str(root/'case')],check=True,timeout=5)
 def test_fixture_pair_identical_and_clip_identity(self):
  with tempfile.TemporaryDirectory()as d:
   root=pathlib.Path(d);p.fixtures(root)
   for suffix in ['links','no-links']:
    a=(root/('paint-baseline-'+suffix+'.html')).read_bytes();b=(root/('paint-candidate-'+suffix+'.html')).read_bytes()
    self.assertEqual(a,b);self.assertEqual(a.count(b'id="clip-parent"'),1)
 def test_probes_are_separate_and_gated(self):
  root=pathlib.Path(__file__).parent;header=(root/'paint-probe-header.inc').read_text();prepare=(root/'prepare_paint_probe.py').read_text()
  self.assertIn('MILKUP_PAINT_PROBE',header);self.assertIn('MILKUP_PAINT_DEDUP',header)
  self.assertIn('records <= 512',header);self.assertIn('raw.size() > 64',header)
  for forbidden in ['getDeviceClipBounds','SkClipStack','setURLForRect','getClientRects','beforeprint']:self.assertNotIn(forbidden,header)
  self.assertIn('rawPrintClip, clipRect, deviceScaleFactor',prepare)

if __name__=='__main__':unittest.main()

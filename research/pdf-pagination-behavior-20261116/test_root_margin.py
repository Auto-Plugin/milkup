import hashlib,importlib.util,json,pathlib,subprocess,sys,tempfile,unittest,types
from unittest.mock import patch
HERE=pathlib.Path(__file__).resolve().parent;BASE=HERE.parent/'pdf-pagination-mechanism-20261116'
sys.path.insert(0,str(HERE));import prepare_root_margin,prepare_tail

class RootMargin(unittest.TestCase):
 def test_fixed_unit_contract_preserves_content_forced_progress_and_nonpositive_margin(self):
  with tempfile.TemporaryDirectory()as td:
   root=pathlib.Path(td);source=root/'test.cpp';binary=root/'test'
   source.write_text('#include "'+str(HERE/'RootTrailingMarginPolicy.h')+'"\n#include <cassert>\nint main(){ using WebCore::PrintFragmentPolicy::rootTrailingMargin;\n'
   'assert(rootTrailingMargin(1024,332)==332); // 16px -> actual 5.1875px remainder\n'
   'assert(rootTrailingMargin(1024,2048)==1024);assert(rootTrailingMargin(-1024,332)==-1024);\n'
   'assert(rootTrailingMargin(0,0)==0);assert(rootTrailingMargin(1024,0)==0);\n'
   'assert(rootTrailingMargin(1024,-1)==1024); // invalid geometry does not silently discard\n'
   'for(int content=1;content<200000;content+=37){for(int margin=-1024;margin<4096;margin+=64){\n'
   'int page=56000;int remaining=(page-content%page)%page;int used=rootTrailingMargin(margin,remaining);\n'
   'if(margin<=0)assert(used==margin);else{assert(used>=0&&used<=margin&&used<=remaining);assert(content+used>=content);}}}\n'
   'assert(112000+rootTrailingMargin(1024,0)==112000); // two forced pages retained\n'
   'assert(112100+rootTrailingMargin(1024,55900)==113124); // content already beyond page retained\n'
   '}\n')
   subprocess.run(['c++','-std=c++20','-Wall','-Wextra','-Werror',str(source),'-o',str(binary)],check=True,timeout=30);subprocess.run([str(binary)],check=True,timeout=5)
 def test_intentional_blank_and_actual_gray_page_are_not_discarded(self):
  import root_margin_controls as controls
  class Page:
   def __init__(self,text='',gray=False):self.text=text;self.gray=gray
   def get_text(self):return self.text
   def get_images(self):return []
   def get_pixmap(self,**kw):return types.SimpleNamespace(width=10,height=10,samples=bytes([237 if self.gray else 255])*300)
  class Doc(list):
   def __enter__(self):return self
   def __exit__(self,*args):pass
  def verify(case,pages,errors=None):
   fake=types.SimpleNamespace(open=lambda _:Doc(pages),Matrix=lambda *x:x,csRGB=None)
   with patch.dict(sys.modules,{'fitz':fake}),patch('calibrate.header_contract',return_value={'errors':[]}):
    return controls.verify_control(case,{'papers':[{}],'errors':errors or [f'a4-portrait: page {case[3]}: blank page']},None)
  forced=controls.CASES[0];pages=[Page('original')for _ in range(6)];pages[4]=Page();pages[5]=Page('FORCEDAFTERBLANK')
  self.assertTrue(verify(forced,pages)['passed'])
  with self.assertRaises(AssertionError):verify(forced,pages[:4]+pages[5:])
  pages[4]=Page(gray=True)
  with self.assertRaises(AssertionError):verify(forced,pages)
  overflow=controls.CASES[1];pages=[Page('original')for _ in range(7)];pages[4]=Page('OVERFLOWSTART');pages[5]=Page(gray=True);pages[6]=Page('OVERFLOWEND')
  self.assertTrue(verify(overflow,pages)['passed'])
  pages[5]=Page()
  with self.assertRaises(AssertionError):verify(overflow,pages)
  pages[5]=Page(gray=True)
  with self.assertRaises(AssertionError):verify(overflow,pages,['a4-portrait: page 6: blank page','lost row'])
  raw=(BASE/'fixtures/baseline-short-room.html').read_text()
  for case in controls.CASES:
   result=controls.html_control(raw,case[1]);self.assertEqual(result.replace(case[1],''),raw)
 def test_locked_actual_delta_and_eligibility(self):
  source=pathlib.Path('/tmp/milkup-webkit-header-preflight/source')
  if not source.exists():self.skipTest('Matched source local precheck; CI actual TU required')
  spec=importlib.util.spec_from_file_location('observation',BASE/'prepare.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
  with tempfile.TemporaryDirectory()as td:
   root=pathlib.Path(td)
   for rel in set(json.loads((BASE/'source-lock.json').read_text()))|set(json.loads((HERE/'source-lock.json').read_text())):
    p=root/'Source/WebCore'/rel;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes((source/'Source/WebCore'/rel).read_bytes())
   obs=root/'obs.patch';m.prepare(root,obs);subprocess.run(['git','apply',str(obs)],cwd=root,check=True);subprocess.run(['git','apply',str(HERE/'candidate.patch')],cwd=root,check=True)
   prepare_tail.build(root,root/'tail.patch',write=True)
   delta=root/'root.patch';r=prepare_root_margin.build(root,delta)
   self.assertEqual(delta.read_bytes(),(HERE/'root-margin.patch').read_bytes());subprocess.run(['git','apply','--check',str(delta)],cwd=root,check=True)
   text=delta.read_text()
   for term in ['isDocumentElementRenderer()','document().printing()','writingMode().isHorizontal()','!enclosingFragmentedFlow()','state->isPaginated()','state->pageLogicalHeight()','borderBoxLogicalHeight > 0_lu','!borderAndPaddingAfter()','!scrollbarLogicalHeight()','IncludePageBoundary']:
    self.assertIn(term,text)
   self.assertNotIn('setLogicalHeight',text);self.assertNotIn('documentRect',text)
   self.assertEqual(set(r['sources']),{'rendering/RenderBlockFlow.cpp','rendering/RootTrailingMarginPolicy.h'})
if __name__=='__main__':unittest.main()

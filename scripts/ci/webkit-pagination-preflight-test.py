#!/usr/bin/env python3
"""Inherited real-command guards plus narrow pagination scope negative controls."""
import ast,importlib.util,json,pathlib,unittest
HERE=pathlib.Path(__file__).resolve().parent
ROOT=HERE.parents[1]
def load(name,path):
 spec=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
gate=load('pagination_gate',HERE/'webkit-pagination-object-preflight.py')
inherited=load('inherited_contract',HERE/'webkit-geometry-object-preflight-test.py');inherited.m=gate
class Pagination(unittest.TestCase):
 def test_exact_four_sources_and_inherited_guards(self):
  self.assertEqual(set(gate.SOURCES),{'Source/WebCore/page/PrintContext.cpp','Source/WebCore/rendering/RenderBlockFlow.cpp','Source/WebCore/rendering/RenderBlock.cpp','Source/WebCore/rendering/RenderTable.cpp'})
  def functions(path):return {n.name:ast.dump(n,include_attributes=False)for n in ast.parse(path.read_text()).body if isinstance(n,ast.FunctionDef)}
  old=functions(HERE/'webkit-geometry-object-preflight.py');new=functions(HERE/'webkit-pagination-object-preflight.py')
  for name in ['validate_header_plan','validate_header_execution','unit_contains','original_command','generated_webcore_headers','name_generator_command']:
   self.assertEqual(old[name],new[name],name)
 def test_no_full_build_or_install_continuation(self):
  for name in ['webkit-pagination-preflight.py','webkit-pagination-object-preflight.py']:
   source=(HERE/name).read_text();tree=ast.parse(source)
   for node in ast.walk(tree):
    if isinstance(node,ast.List):
     strings=[x.value for x in node.elts if isinstance(x,ast.Constant) and isinstance(x.value,str)]
     if 'all' in strings:self.assertEqual(strings,['ninja','-C','-t','targets','all'])
   for denied in ["'--build'", "'--install'", "'WebKit'", 'cmake --build']:
    # --build is only the CLI path argument when invoking/parsing the narrow gates.
    if denied=="'--build'":continue
    self.assertNotIn(denied,source)
  flow=(ROOT/'.github/workflows/linux-webkit-build-research.yml').read_text()
  self.assertIn("inputs.operation != 'pagination-preflight'",flow)
  narrow=flow.split('\n  pagination-preflight:\n')[1]
  self.assertNotIn('build-webkit-private.py',narrow);self.assertNotIn('cache/save@',narrow)
  self.assertIn('timeout-minutes: 45',narrow);self.assertIn('fail-on-cache-miss: true',narrow)
 def test_retained_native_failure_is_exact_missing_inline(self):
  import re
  raw=(ROOT/'research/pdf-pagination-mechanism-20261116/evidence/43788232168/RenderTable-original-compiler.txt').read_text()
  plain=re.sub(r'\x1b\[[0-9;]*m','',raw)
  errors=[line for line in plain.splitlines()if 'error:'in line]
  self.assertEqual(len(errors),1)
  self.assertIn("inline function 'WebCore::ContainerNode::renderer' is not defined",errors[0])
  self.assertIn('undefined-inline',errors[0])
  self.assertIn('element->renderer()',plain)
 def test_header_and_cache_identity_receipt(self):
  r=ROOT/'research/pdf-pagination-mechanism-20261116'
  h=(r/'probe.h.inc').read_text()
  for required in ['#include "ContainerNodeInlines.h"','#include "RenderObjectInlines.h"','#include "RenderBoxInlines.h"','#include "ElementTraversal.h"','box->absoluteQuads(quads, nullptr);']:
   self.assertIn(required,h)
  receipt=json.loads((r/'cache-input-receipt.json').read_text())
  self.assertEqual(receipt['priorRun'],43672149274)
  self.assertEqual(receipt['sourceVersion'],'2.52.6-0ubuntu0.26.04.1')
  self.assertEqual(len(receipt['archives']),4)
  self.assertIn('-DENABLE_BUBBLEWRAP_SANDBOX=ON',receipt['configureArgs'])
if __name__=='__main__':
 suite=unittest.TestSuite([unittest.defaultTestLoader.loadTestsFromModule(inherited),unittest.defaultTestLoader.loadTestsFromTestCase(Pagination)])
 result=unittest.TextTestRunner(verbosity=2).run(suite);raise SystemExit(0 if result.wasSuccessful()else 1)

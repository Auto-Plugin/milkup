"""Compose independently locked research deltas after the passed pagination candidate.

No fuzzy patching or replacement of either final-print observer. No full source
copy, build, runtime installation or native acceptance is performed here.
"""
import difflib,hashlib,importlib.util,json,pathlib,subprocess,tempfile
HERE=pathlib.Path(__file__).resolve().parent
UNICODE=HERE.parent/'linux-pdf-unicode-20261114'
LINKS=HERE.parent/'linux-pdf-links-20261114'
PAGE=HERE.parent/'pdf-pagination-behavior-20261116'
OBS=HERE.parent/'pdf-pagination-mechanism-20261116'
PC='Source/WebCore/page/PrintContext.cpp'
PATCHES=[UNICODE/'0002-research-only-scalar-source-to-skia.patch',UNICODE/'0003-register-scalar-private-header.patch',LINKS/'0001-research-skia-uri-annotations.patch',LINKS/'0002-research-fragment-uri-regions.patch']
def sha(data):return hashlib.sha256(data).hexdigest()
def module(name,path):
 spec=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
def once(s,a,b):assert s.count(a)==1,a;return s.replace(a,b)
def apply(root,patch,*extra):
 subprocess.run(['git','apply',*extra,'--check',str(patch)],cwd=root,check=True,capture_output=True)
 subprocess.run(['git','apply',*extra,str(patch)],cwd=root,check=True,capture_output=True)
def build(source,out,write=False):
 lock=json.loads((HERE/'source-lock.json').read_text());original={}
 for rel,h in lock.items():
  p=source/rel
  assert (sha(p.read_bytes())if p.exists()else None)==h,'Exact combined preimage: '+rel
  original[rel]=p.read_text()if p.exists()else ''
 receipt={'inputs':lock,'priorPaginationRootPatchSha256':sha((PAGE/'root-margin.patch').read_bytes()),'deltas':{}}
 with tempfile.TemporaryDirectory(prefix='combined-source-')as tmp:
  root=pathlib.Path(tmp)
  for rel,s in original.items():
   if lock[rel]is not None:
    p=root/rel;p.parent.mkdir(parents=True,exist_ok=True);p.write_text(s)
  # Reconstruct the pristine PrintContext solely inside the bounded overlay.
  # All actual pagination files remain unchanged until the explicit composition.
  for patch in [PAGE/'tail-observation.patch',OBS/'observation-only.patch']:
   apply(root,patch,'--reverse','--include='+PC)
  assert sha((root/PC).read_bytes())=='938541c51de207aa15b45133d341c40cba36f4a912e1be48c38bca9418eb0d3e'
  for patch in PATCHES[:3]:apply(root,patch);receipt['deltas'][patch.name]=sha(patch.read_bytes())
  layout=root/'layout.patch';receipt['layout']=module('combined_layout',LINKS/'prepare_layout_probe.py').prepare(root,layout);apply(root,layout)
  apply(root,PATCHES[3]);receipt['deltas'][PATCHES[3].name]=sha(PATCHES[3].read_bytes())
  paint=root/'paint.patch';receipt['paint']=module('combined_paint',LINKS/'prepare_paint_probe.py').prepare(root,paint);apply(root,paint)
  digit=root/'digit.patch';receipt['digit']=module('combined_digit',UNICODE/'prepare_digit_probe.py').prepare(root,digit);apply(root,digit)
  assert receipt['digit']['patchSha256']=='fe7952f48491b1b3a75759789795831c9f3638aff1768cbf1fd48a4f784a20a3'
  s=(root/PC).read_text()
  s=once(s,'#include "config.h"','#include "config.h"\n#include "../rendering/MilkupPaginationResearch.h"\n#include "../rendering/MilkupTailResearch.h"')
  s=once(s,'void PrintContext::spoolPage(',(HERE/'page-envelope.inc').read_text()+'\nvoid PrintContext::spoolPage(')
  anchor='    milkupPrintLayoutProbe(*frame.document(), ctx, pageRect, pageNumber, !frame.view()->needsLayout());'
  s=once(s,anchor,'    milkupCombinedPage(*frame.document(), pageNumber, "begin", !frame.view()->needsLayout());\n    MilkupPaginationResearch::finalPage(*frame.document(), ctx, pageRect, pageNumber, !frame.view()->needsLayout());\n    MilkupTailResearch::finalPage(*frame.document(), pageRect, pageNumber);\n'+anchor)
  s=once(s,'    MilkupPrintResearch::end();','    MilkupPrintResearch::end();\n    milkupCombinedPage(*frame.document(), pageNumber, "end", !frame.view()->needsLayout());')
  (root/PC).write_text(s)
  # Check explicit ordering and exactly one actual native paint invocation.
  calls=['ctx.clip(pageRect);','milkupCombinedPage(*frame.document(), pageNumber, "begin"','MilkupPaginationResearch::finalPage','MilkupTailResearch::finalPage','milkupPrintLayoutProbe(*frame.document()','MilkupPrintResearch::begin(*frame.document()','frame.view()->paintContents(ctx, pageRect);','MilkupPrintResearch::end();','milkupCombinedPage(*frame.document(), pageNumber, "end"']
  positions=[s.index(c)for c in calls];assert positions==sorted(positions)
  assert all(s.count(c)==1 for c in calls)
  changed={rel:(root/rel).read_text()for rel in lock if (root/rel).exists()and (root/rel).read_text()!=original[rel]}
  patch=''.join(''.join(difflib.unified_diff(original[rel].splitlines(True),s.splitlines(True),fromfile='a/'+rel if original[rel]else'/dev/null',tofile='b/'+rel))for rel,s in sorted(changed.items()))
  out.write_text(patch)
  if write:
   for rel,s in changed.items():(source/rel).write_text(s)
  receipt.update(patchSha256=sha(patch.encode()),outputs={rel:sha(s.encode())for rel,s in changed.items()},spoolCallOrder=calls,scope='Combined research source only; actual TU/runtime and full original contracts remain mandatory')
  return receipt

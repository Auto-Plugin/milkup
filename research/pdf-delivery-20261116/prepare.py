"""Locked normal-path extraction, not a built or accepted runtime package.
Read only the supplied pristine source. Never install or modify system files.
"""
import argparse,difflib,hashlib,json,pathlib,subprocess,tempfile
HERE=pathlib.Path(__file__).resolve().parent
U=HERE.parent/'linux-pdf-unicode-20261114';L=HERE.parent/'linux-pdf-links-20261114';P=HERE.parent/'pdf-pagination-behavior-20261116'
C='Source/WebCore/'
def sha(b):return hashlib.sha256(b).hexdigest()
def once(s,a,b):
 assert s.count(a)==1,('exact anchor',a[:100]);return s.replace(a,b)
def apply(root,path):
 subprocess.run(['git','apply','--check',str(path)],cwd=root,check=True,capture_output=True)
 subprocess.run(['git','apply',str(path)],cwd=root,check=True,capture_output=True)
def build(source,out,tree=None):
 lock=json.loads((HERE/'source-lock-2.52.6.json').read_text());original={}
 for rel,h in lock.items():
  p=source/rel;assert (sha(p.read_bytes())if p.exists()else None)==h,('preimage',rel)
  original[rel]=p.read_text()if p.exists()else ''
 with tempfile.TemporaryDirectory(prefix='milkup-normal-path-')as tmp:
  root=pathlib.Path(tmp)
  for rel,s in original.items():
   if lock[rel]is not None:
    p=root/rel;p.parent.mkdir(parents=True,exist_ok=True);p.write_text(s)
  inputs=[U/'0002-research-only-scalar-source-to-skia.patch',U/'0003-register-scalar-private-header.patch',L/'0001-research-skia-uri-annotations.patch',L/'0002-research-fragment-uri-regions.patch',P/'candidate.patch']
  for p in inputs:apply(root,p)
  # Exact independent-cluster guard, with no nominal-only environment override.
  p=root/(C+'platform/graphics/FontCascade.cpp');s=p.read_text()
  marker="// This function assumes the GlyphBuffer's initial advance has already been incorporated into the start point."
  helper=(U/'independent-digit-text.inc').read_text().replace('// Research only. Caller must retain','// Caller must retain')
  s=once(s,marker,'#if USE(SKIA)\n'+helper+'#endif\n\n'+marker)
  s=once(s,'        if (complete)\n            sourceText = makeScalarGlyphText(source, offsets, glyphs, nominal);','''        if (complete) {
            // Never infer a cluster end from a partial draw/selection span.
            sourceText = sourceFrom || sourceTo != sourceRun->length()
                ? makeScalarGlyphText(source, offsets, glyphs, nominal)
                : makeIndependentAsciiDigitText(source, offsets, glyphs, nominal);
        }''')
  s=once(s,'// Research subset: prove complete scalar coverage before font splitting.','// Prove complete scalar coverage before font splitting.');p.write_text(s)
  p=root/(C+'platform/graphics/ScalarGlyphText.h');p.write_text(once(p.read_text(),'// Research-only source metadata bridge; not an installed WebKit patch.','// Bounded source metadata for unchanged glyphs.'))
  # Root-margin behavior is copied exactly; only observer include context removed.
  p=root/(C+'rendering/RenderBlockFlow.cpp');s=p.read_text();s=once(s,'#include "FragmentKeepPolicy.h"','#include "FragmentKeepPolicy.h"\n#include "RootTrailingMarginPolicy.h"')
  patch=(P/'root-margin.patch').read_text();start=patch.index('+        auto trailingMargin =');end=patch.index('\n     }',start)
  body='\n'.join(line[1:]for line in patch[start:end].splitlines()if line.startswith('+'))
  s=once(s,'        borderBoxLogicalHeight += marginInfo.margin();',body);p.write_text(s)
  (root/(C+'rendering/RootTrailingMarginPolicy.h')).write_text((P/'RootTrailingMarginPolicy.h').read_text())
  p=root/(C+'rendering/FragmentKeepPolicy.h');p.write_text(once(p.read_text(),'/* Research candidate for the existing WebCore print fragmenter. LGPL-2.1-or-later. */','/* WebCore print fragment policy. SPDX-License-Identifier: LGPL-2.1-or-later */'))
  # Exact fragments remain in this call's actual graphics context. No page-global
  # or URL-global set and no change to Skia's current clip/transform handling.
  p=root/(C+'rendering/OutlinePainter.cpp');s=p.read_text()
  s=once(s,'#include "config.h"','#include "config.h"\n#include "PrintLinkAnnotationPolicy.h"')
  s=once(s,'    // Research candidate: keep each clickable inline fragment separate. A union','    // Keep each clickable inline fragment separate. A union')
  s=once(s,'    for (auto& rect : focusRingRects) {\n        if (!rect.isEmpty())\n            m_paintInfo.context().setURLForRect(url, rect);','    for (auto& rect : uniquePrintLinkFragments(focusRingRects)) {\n        if (!rect.isEmpty())\n            m_paintInfo.context().setURLForRect(url, rect);');p.write_text(s)
  (root/(C+'rendering/PrintLinkAnnotationPolicy.h')).write_text((HERE/'PrintLinkAnnotationPolicy.h').read_text())
  # Private forwarding headers are explicit, including the pagination helpers.
  p=root/(C+'Headers.cmake');s=p.read_text();s=once(s,'    rendering/RenderBlock.h','    rendering/FragmentKeepPolicy.h\n    rendering/RootTrailingMarginPolicy.h\n    rendering/PrintLinkAnnotationPolicy.h\n    rendering/RenderBlock.h');p.write_text(s)
  # Preserve fallback semantics while removing misleading research-only comment.
  p=root/(C+'platform/graphics/displaylists/DisplayListRecorderImpl.cpp');s=p.read_text();s=s.replace('this research subset','this source-metadata path');p.write_text(s)
  final={str(p.relative_to(root)):p.read_text()for p in root.rglob('*')if p.is_file()}
  changed={r:s for r,s in final.items()if s!=original.get(r,'')}
  for r,s in changed.items():
   added=''.join(line[1:]for line in difflib.unified_diff(original.get(r,'').splitlines(True),s.splitlines(True))if line.startswith('+')and not line.startswith('+++'))
   assert not any(x in added for x in ['MILKUP_','MilkupPrintResearch','MilkupPaginationResearch','MilkupTailResearch','std::getenv','std::fprintf','probe-','document.title()']),('research leak',r)
  patch=''.join(''.join(difflib.unified_diff(original.get(r,'').splitlines(True),s.splitlines(True),fromfile='a/'+r if original.get(r)else'/dev/null',tofile='b/'+r))for r,s in sorted(changed.items()))
  out.write_text(patch)
  if tree is not None:
   assert not tree.exists();tree.mkdir(parents=True)
   for r,s in final.items():p=tree/r;p.parent.mkdir(parents=True,exist_ok=True);p.write_text(s)
  return {'status':'normal-path-source-only-not-compiled','base':'WebKitGTK 2.52.6 exact extracted baseline, not current-security delivery','inputs':lock,'sourceDeltas':{str(p.relative_to(HERE.parent)):sha(p.read_bytes())for p in inputs},'patchSha256':sha(patch.encode()),'outputs':{r:sha(s.encode())for r,s in sorted(changed.items())},'scope':'No observer, environment, fixture gate or altered clip; actual TU/current release rebase/final-path package still required'}
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('source',type=pathlib.Path);p.add_argument('output',type=pathlib.Path);p.add_argument('--tree',type=pathlib.Path);a=p.parse_args();r=build(a.source,a.output,a.tree);a.output.with_suffix('.json').write_text(json.dumps(r,indent=2)+'\n');print(json.dumps({'status':r['status'],'files':len(r['outputs']),'sha256':r['patchSha256']}))

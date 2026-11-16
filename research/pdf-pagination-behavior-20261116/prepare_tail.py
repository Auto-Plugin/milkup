"""Read-only tail diagnostic on the exact observation + behavior sources."""
import pathlib,json,hashlib,difflib
HERE=pathlib.Path(__file__).resolve().parent
BASE=HERE.parent/'pdf-pagination-mechanism-20261116'
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def once(s,a,b):assert s.count(a)==1,a;return s.replace(a,b)
def build(source,out,write=False):
 core=source/'Source/WebCore'
 assert sha(core/'rendering/MilkupPaginationResearch.h')==sha(BASE/'probe.h.inc')
 expected=json.loads((HERE/'tail-source-lock.json').read_text())
 original={rel:(core/rel).read_text()for rel in expected}
 for rel,h in expected.items():assert sha(core/rel)==h,rel
 modified=dict(original)
 rel='rendering/RenderBlockFlow.cpp';s=modified[rel]
 s=once(s,'#include "MilkupPaginationResearch.h"','#include "MilkupPaginationResearch.h"\n#include "MilkupTailResearch.h"')
 start=s.index('LayoutUnit RenderBlockFlow::handleAfterSideOfBlock(');end=s.index('\n}',start)+2
 body=s[start:end]
 args='*this, PHASE, contentBoxLogicalHeight, borderBoxLogicalHeight, marginInfo.margin(), marginInfo.canCollapseWithMarginBefore(), marginInfo.canCollapseWithMarginAfter()'
 body=once(body,'    // If we can\'t collapse with children then add in the bottom margin.', '    MilkupTailResearch::margin('+args.replace('PHASE','"before"')+');\n    // If we can\'t collapse with children then add in the bottom margin.')
 body=once(body,'    return borderBoxLogicalHeight;', '    MilkupTailResearch::margin('+args.replace('PHASE','"after"')+');\n    return borderBoxLogicalHeight;')
 modified[rel]=s[:start]+body+s[end:]
 rel='page/PrintContext.cpp';s=modified[rel]
 s=once(s,'#include "../rendering/MilkupPaginationResearch.h"','#include "../rendering/MilkupPaginationResearch.h"\n#include "../rendering/MilkupTailResearch.h"')
 s=once(s,'    frame.view()->paintContents(ctx, pageRect);','    MilkupTailResearch::finalPage(*frame.document(), pageRect, pageNumber);\n    frame.view()->paintContents(ctx, pageRect);')
 modified[rel]=s
 rel='rendering/MilkupTailResearch.h';modified[rel]=(HERE/'tail.h.inc').read_text();original[rel]=''
 patch=''
 for rel,s in modified.items():patch+=''.join(difflib.unified_diff(original[rel].splitlines(True),s.splitlines(True),fromfile='a/Source/WebCore/'+rel if original[rel]else'/dev/null',tofile='b/Source/WebCore/'+rel))
 out.write_text(patch)
 if write:
  for rel,s in modified.items():(core/rel).write_text(s)
 return {'patchSha256':sha(out),'sources':{r:hashlib.sha256(s.encode()).hexdigest()for r,s in modified.items()},'behaviorPatchSha256':sha(HERE/'candidate.patch'),'scope':'Read-only tail margin/layout/visual-overflow diagnosis; no pagination change'}

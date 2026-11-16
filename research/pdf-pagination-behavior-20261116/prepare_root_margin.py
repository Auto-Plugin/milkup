"""Narrow behavior delta only after exact observed tail sources."""
import difflib,hashlib,json,pathlib
HERE=pathlib.Path(__file__).resolve().parent
FLOW='rendering/RenderBlockFlow.cpp'
HEADER='rendering/RootTrailingMarginPolicy.h'
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def build(source,out,write=False):
 core=source/'Source/WebCore';p=core/FLOW;original=p.read_text()
 assert sha(p)==json.loads((HERE/'root-margin-source-lock.json').read_text())[FLOW]
 old='#include "MilkupTailResearch.h"';assert original.count(old)==1
 new=original.replace(old,old+'\n#include "RootTrailingMarginPolicy.h"')
 start=new.index('LayoutUnit RenderBlockFlow::handleAfterSideOfBlock(');end=new.index('\n}',start)+2;body=new[start:end]
 old='        borderBoxLogicalHeight += marginInfo.margin();';assert body.count(old)==1
 body=body.replace(old,'''        auto trailingMargin = marginInfo.margin();
        auto* state = view().frameView().layoutContext().layoutState();
        // Match the existing legacy before-margin page-edge restriction for the
        // document element's trailing collapsed margin. Do not reduce content,
        // explicit size, forced-break progress, border/padding or visual overflow.
        if (isDocumentElementRenderer() && document().printing() && writingMode().isHorizontal()
            && !enclosingFragmentedFlow() && state && state->isPaginated() && state->pageLogicalHeight()
            && borderBoxLogicalHeight > 0_lu && !borderAndPaddingAfter() && !scrollbarLogicalHeight())
            trailingMargin = PrintFragmentPolicy::rootTrailingMargin(trailingMargin,
                pageRemainingLogicalHeightForOffset(borderBoxLogicalHeight, IncludePageBoundary));
        borderBoxLogicalHeight += trailingMargin;''')
 new=new[:start]+body+new[end:];header=(HERE/'RootTrailingMarginPolicy.h').read_text()
 patch=''.join(difflib.unified_diff(original.splitlines(True),new.splitlines(True),fromfile='a/Source/WebCore/'+FLOW,tofile='b/Source/WebCore/'+FLOW))
 patch+=''.join(difflib.unified_diff([],header.splitlines(True),fromfile='/dev/null',tofile='b/Source/WebCore/'+HEADER))
 out.write_text(patch)
 if write:p.write_text(new);(core/HEADER).write_text(header)
 return {'patchSha256':sha(out),'sources':{FLOW:hashlib.sha256(new.encode()).hexdigest(),HEADER:sha(HERE/'RootTrailingMarginPolicy.h')},'scope':'Document-root positive trailing margin only; no PDF rewrite or content-height reduction'}

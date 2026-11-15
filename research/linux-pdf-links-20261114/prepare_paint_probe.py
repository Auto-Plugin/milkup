"""Research A/B instrumentation on exact matched source; never edits source itself."""
import argparse,difflib,hashlib,json,pathlib
HERE=pathlib.Path(__file__).resolve().parent
EXPECTED={
 'page/PrintContext.cpp':'155aa2cfd18d2b733c476c4dcf595e1e06022c9db32e35414c2883934a3930c5',
 'rendering/OutlinePainter.cpp':'5339f0a1c59fbb4669a12cf8d96e80b4e57bf483c3c37a2fd9cebaf79fa6b8e6',
 'rendering/RenderBox.cpp':'04a7eb360a2fec32f2b828697fe087fdb283f25f3039ba2a3113a39814c34052',
 'rendering/RenderLayer.cpp':'07832dbc913d4d65770564133ff908e5702548dd6c6953d0f2e6dc24dc21fc4a',
}
def once(s,old,new):
 assert s.count(old)==1,old
 return s.replace(old,new)
def prepare(source,output):
 changes={};originals={}
 for rel,digest in EXPECTED.items():
  p=source/'Source/WebCore'/rel;s=p.read_text();assert hashlib.sha256(s.encode()).hexdigest()==digest,rel
  originals[rel]=s;changes[rel]=once(s,'#include "config.h"','#include "config.h"\n#include "MilkupPrintResearch.h"')
 rel='page/PrintContext.cpp';s=changes[rel]
 s=once(s,'    frame.view()->paintContents(ctx, pageRect);','    MilkupPrintResearch::begin(*frame.document(), pageNumber);\n    frame.view()->paintContents(ctx, pageRect);\n    MilkupPrintResearch::end();');changes[rel]=s
 rel='rendering/OutlinePainter.cpp';s=changes[rel]
 s=once(s,'    for (auto& rect : focusRingRects) {\n        if (!rect.isEmpty())\n            m_paintInfo.context().setURLForRect(url, rect);','    auto emittedRects = MilkupPrintResearch::focus(renderer, m_paintInfo.context(), static_cast<unsigned>(m_paintInfo.phase), focusRingRects);\n    for (auto& rect : emittedRects) {\n        if (!rect.isEmpty())\n            m_paintInfo.context().setURLForRect(url, rect);');changes[rel]=s
 rel='rendering/RenderBox.cpp';s=changes[rel]
 old='    FloatRect clipRect = snapRectToDevicePixels((isControlClip ? controlClipRect(accumulatedOffset) : overflowClipRect(accumulatedOffset, OverlayScrollbarSizeRelevancy::IgnoreOverlayScrollbarSize, paintInfo.phase)), deviceScaleFactor);'
 new='    auto rawPrintClip = isControlClip ? controlClipRect(accumulatedOffset) : overflowClipRect(accumulatedOffset, OverlayScrollbarSizeRelevancy::IgnoreOverlayScrollbarSize, paintInfo.phase);\n    FloatRect clipRect = snapRectToDevicePixels(rawPrintClip, deviceScaleFactor);\n    MilkupPrintResearch::clip("box", *this, paintInfo.context(), static_cast<unsigned>(paintInfo.phase), rawPrintClip, clipRect, deviceScaleFactor);'
 changes[rel]=once(s,old,new)
 rel='rendering/RenderLayer.cpp';s=changes[rel]
 old='        auto snappedClipRect = snapRectToDevicePixelsIfNeeded(adjustedClipRect, renderer());\n        context.clip(snappedClipRect);'
 new='        auto snappedClipRect = snapRectToDevicePixelsIfNeeded(adjustedClipRect, renderer());\n        MilkupPrintResearch::clip("layer", renderer(), context, 0, adjustedClipRect, snappedClipRect, renderer().document().deviceScaleFactor());\n        context.clip(snappedClipRect);'
 suffix='\n        regionContextStateSaver.pushClip(enclosingIntRect(snappedClipRect));'
 changes[rel]=once(s,old+suffix,new+suffix)
 rel='Headers.cmake';originals[rel]=(source/'Source/WebCore'/rel).read_text();changes[rel]=once(originals[rel],'    page/PrintContext.h','    page/PrintContext.h\n    page/MilkupPrintResearch.h')
 header=(HERE/'paint-probe-header.inc').read_text().replace('// UNIQUE_PER_CALL_INSERT',(HERE/'unique-per-call.inc').read_text())
 rel='page/MilkupPrintResearch.h';originals[rel]='';changes[rel]=header
 patch=''.join(''.join(difflib.unified_diff(originals[rel].splitlines(True),s.splitlines(True),fromfile=('a/Source/WebCore/'+rel if originals[rel]else'/dev/null'),tofile='b/Source/WebCore/'+rel))for rel,s in changes.items())
 output.write_text(patch)
 return {'scope':'research only, explicit fixture/env gated; no global URL dedup','inputs':EXPECTED,'outputs':{p:hashlib.sha256(s.encode()).hexdigest()for p,s in changes.items()},'patchSha256':hashlib.sha256(patch.encode()).hexdigest()}
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('source',type=pathlib.Path);p.add_argument('output',type=pathlib.Path);a=p.parse_args();print(json.dumps(prepare(a.source,a.output),indent=2))

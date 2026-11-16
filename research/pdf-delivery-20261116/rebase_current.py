"""Explicit source-locked 2.54.2 adaptation. No fuzzy/source-version fallback.
This prepares reviewable source only, not an ABI/build/native acceptance claim.
"""
import argparse,difflib,hashlib,json,pathlib,shutil,subprocess,tempfile
from prepare import once,sha,HERE,C
EXPECTED_REJECTS={'Headers.cmake','platform/graphics/FontCascade.cpp','platform/graphics/FontCascade.h','platform/graphics/skia/GraphicsContextSkia.h','rendering/OutlinePainter.cpp','rendering/RenderTable.cpp','rendering/RenderTable.h','rendering/RenderTableSection.cpp'}
def build(source,normal2526,out,tree=None):
 receipt=json.loads((source/'source-receipt.json').read_text())
 assert receipt==json.loads((HERE/'source-receipt-2.54.2.json').read_text()),'Official selected-source lock changed'
 normal_receipt=json.loads((HERE/'normal-path-2.52.6.json').read_text())
 for rel,h in normal_receipt['outputs'].items():assert sha((normal2526/rel).read_bytes())==h,'Normal-source lock: '+rel
 assert receipt['sourceVersion']=='2.54.2' and receipt['sha256']=='a76345b391bef6211fb5ab6cfab2e86b285d18cda17cbb9ade595f1252b86065'
 assert sha((HERE/'normal-path-2.52.6.patch').read_bytes())=='9dff7a751f6521dd60a7b5837c39f6e846d979ccbf11df907e11e57196d83083'
 original={}
 for rel,row in receipt['files'].items():
  p=source/rel;assert sha(p.read_bytes())==row['sha256'],rel;original[rel]=p.read_text()
 old=lambda rel:(normal2526/(C+rel)).read_text()
 with tempfile.TemporaryDirectory(prefix='milkup-current-rebase-')as t:
  root=pathlib.Path(t)
  for rel,s in original.items():p=root/rel;p.parent.mkdir(parents=True,exist_ok=True);p.write_text(s)
  applied=subprocess.run(['git','apply','--reject',str(HERE/'normal-path-2.52.6.patch')],cwd=root,capture_output=True,text=True)
  rejects={str(p.relative_to(root)).removeprefix(C).removesuffix('.rej'):sha(p.read_bytes())for p in root.rglob('*.rej')}
  assert applied.returncode==1 and set(rejects)==EXPECTED_REJECTS,('reviewed rejection set changed',rejects)
  def edit(rel,fn):
   p=root/(C+rel);p.write_text(fn(p.read_text()))
  edit('Headers.cmake',lambda s:once(s,'    rendering/RenderBlock.h','    rendering/FragmentKeepPolicy.h\n    rendering/RootTrailingMarginPolicy.h\n    rendering/PrintLinkAnnotationPolicy.h\n    rendering/RenderBlock.h'))
  fc=old('platform/graphics/FontCascade.cpp')
  helper=fc[fc.index('#if USE(SKIA)\n// Caller must retain'):fc.index('// This function assumes the GlyphBuffer\'s initial advance')]
  start=fc.index('    std::optional<ScalarGlyphText> sourceText;');end=fc.index('    RefPtr fontData = glyphBuffer.fontAt(0);',start);metadata=fc[start:end]
  oldsig='void FontCascade::drawGlyphBuffer(GraphicsContext& context, const GlyphBuffer& glyphBuffer, FloatPoint& point, CustomFontNotReadyAction customFontNotReadyAction) const'
  newsig=oldsig.replace('customFontNotReadyAction) const','customFontNotReadyAction, const TextRun* sourceRun, unsigned sourceFrom, unsigned sourceTo) const')
  def cascade(s):
   s=once(s,'#include "GraphicsContext.h"','#include "GraphicsContext.h"\n#if USE(SKIA)\n#include "ScalarGlyphText.h"\n#include <skia/core/SkFont.h>\n#endif')
   marker="// This function assumes the GlyphBuffer's initial advance has already been incorporated into the start point."
   s=once(s,marker,helper+marker)
   s=once(s,oldsig+'\n{\n    ASSERT(glyphBuffer.isFlattened());',newsig+'\n{\n    ASSERT(glyphBuffer.isFlattened());\n'+metadata.rstrip())
   call='context.drawGlyphs(fontData.get(), glyphBuffer.glyphs(lastFrom, glyphCount), glyphBuffer.advances(lastFrom, glyphCount), startPoint, m_fontDescription.usedFontSmoothing());'
   assert s.count(call)==2;s=s.replace(call,'drawSpan(fontData.get(), lastFrom, glyphCount, startPoint);')
   # 2.54 splits recording into a public glyph-only API. Carry source only from
   # the TextRun caller; all glyph-only callers retain the no-source fallback.
   s=once(s,'return displayListForGlyphBuffer(context, glyphBuffer, customFontNotReadyAction);','return displayListForGlyphBuffer(context, glyphBuffer, customFontNotReadyAction, &run, from, destination);')
   s=once(s,'const GlyphBuffer& glyphBuffer,  CustomFontNotReadyAction customFontNotReadyAction) const','const GlyphBuffer& glyphBuffer, CustomFontNotReadyAction customFontNotReadyAction, const TextRun* sourceRun, unsigned sourceFrom, unsigned sourceTo) const')
   s=once(s,'drawGlyphBuffer(recordingContext, glyphBuffer, startPoint, customFontNotReadyAction, &run, from, destination);','drawGlyphBuffer(recordingContext, glyphBuffer, startPoint, customFontNotReadyAction, sourceRun, sourceFrom, sourceTo);')
   return s
  edit('platform/graphics/FontCascade.cpp',cascade)
  def cascade_h(s):
   for a in ['void drawGlyphBuffer(GraphicsContext&, const GlyphBuffer&, FloatPoint&, CustomFontNotReadyAction) const;','RefPtr<const DisplayList::DisplayList> displayListForGlyphBuffer(GraphicsContext&, const GlyphBuffer&, CustomFontNotReadyAction) const;']:
    s=once(s,a,a.replace('CustomFontNotReadyAction) const;','CustomFontNotReadyAction, const TextRun* = nullptr, unsigned sourceFrom = 0, unsigned sourceTo = 0) const;'))
   return s
  edit('platform/graphics/FontCascade.h',cascade_h)
  edit('platform/graphics/skia/GraphicsContextSkia.h',lambda s:once(s,'    void drawSkiaText(', '    void drawGlyphsWithSourceText(const Font&, std::span<const GlyphBufferGlyph>, std::span<const GlyphBufferAdvance>, const FloatPoint&, FontSmoothingMode, const ScalarGlyphText&) final;\n    void drawSkiaText('))
  uri=old('rendering/OutlinePainter.cpp');start=uri.index('#if USE(SKIA)\n    // Keep each clickable inline fragment');end=uri.index('\n#endif',start)+len('\n#endif');block=uri[start:end].replace('element->protectedDocument()->completeURL(href)','protect(element->document())->encodingParseURL(href)')
  edit('rendering/OutlinePainter.cpp',lambda s:once(s,'    m_paintInfo.context().setURLForRect(protect(element->document())->encodingParseURL(href), urlRect);',block))
  # 2.54 removed unused public section accessors; preserve its weak fields and
  # restore the narrow read-only accessors used by the retained print policy.
  h=old('rendering/RenderTable.h');start=h.index('    // Print-only, rebuilt');end=h.index('    RenderTableSection* header() const;',start);methods=h[start:end]
  edit('rendering/RenderTable.h',lambda s:once(s,'    // This function returns 0 if the table has no section.',methods+'    RenderTableSection* header() const;\n    RenderTableSection* footer() const;\n    RenderTableSection* firstBody() const;\n\n    // This function returns 0 if the table has no section.'))
  def table(s):
   s=once(s,'RenderTable::~RenderTable() = default;','''RenderTable::~RenderTable() = default;

RenderTableSection* RenderTable::header() const { return m_head.get(); }
RenderTableSection* RenderTable::footer() const { return m_foot.get(); }
RenderTableSection* RenderTable::firstBody() const { return m_firstBody.get(); }''')
   anchor='                section->paint(info, childPoint);'
   return once(s,anchor,anchor+'''
                if (section == header() && document().printing()) {
                    for (auto offset : m_printHeaderOffsets)
                        section->paint(info, childPoint + LayoutSize(0_lu, offset - section->logicalTop()));
                }''')
  edit('rendering/RenderTable.cpp',table)
  section=old('rendering/RenderTableSection.cpp');start=section.index('        if (auto headerHeight = table()->repeatedPrintHeaderHeight();');end=section.index('        // Set the row',start);rowPolicy=section[start:end]
  # New layoutCells lambda runs under rowStatePusher. Adjust m_rowPos before
  # row location/state is built, preserving the new upstream cell-layout order.
  edit('rendering/RenderTableSection.cpp',lambda s:once(s,'    for (size_t rowIndex = 0; rowIndex < numberOfRows; rowIndex++) {\n\n        auto layoutCells =', '    for (size_t rowIndex = 0; rowIndex < numberOfRows; rowIndex++) {\n'+rowPolicy+'\n        auto layoutCells ='))
  for p in root.rglob('*.rej'):p.unlink()
  final={str(p.relative_to(root)):p.read_text()for p in root.rglob('*')if p.is_file()}
  changed={r:s for r,s in final.items()if s!=original.get(r,'')}
  for r,s in changed.items():assert not any(x in s for x in ['MILKUP_','MilkupPrintResearch','MilkupPaginationResearch','MilkupTailResearch']),r
  patch=''.join(''.join(difflib.unified_diff(original.get(r,'').splitlines(True),s.splitlines(True),fromfile='a/'+r if original.get(r)else'/dev/null',tofile='b/'+r))for r,s in sorted(changed.items()))
  out.write_text(patch)
  if tree is not None:
   assert not tree.exists();tree.mkdir(parents=True)
   for r,s in final.items():p=tree/r;p.parent.mkdir(parents=True,exist_ok=True);p.write_text(s)
  return {'status':'explicit-current-source-rebase-not-compiled','version':'2.54.2','sourceArchiveSha256':receipt['sha256'],'inputs':{r:receipt['files'][r]['sha256']for r in changed if r in original},'newFiles':[r for r in changed if r not in original],'outputs':{r:sha(s.encode())for r,s in sorted(changed.items())},'patchSha256':sha(patch.encode()),'reviewedRejectedHunks':rejects,'adaptations':['Keep Ref/fontData.get ownership','Carry TextRun through new displayListForGlyphBuffer; glyph-only fallback unchanged','Keep encodingParseURL, not old completeURL','Restore read-only weak section accessors','Run row shift before new rowStatePusher/layoutCells, preserve new cell-growth order','Keep nullptr border reset and current headers/public method location'],'scope':'Source only; current APIs and layout require actual TU and native validation; no old cache/runtime acceptance inheritance'}
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('source',type=pathlib.Path);p.add_argument('normal2526',type=pathlib.Path);p.add_argument('output',type=pathlib.Path);p.add_argument('--tree',type=pathlib.Path);a=p.parse_args();r=build(a.source,a.normal2526,a.output,a.tree);a.output.with_suffix('.json').write_text(json.dumps(r,indent=2)+'\n');print(json.dumps({'status':r['status'],'files':len(r['outputs']),'sha256':r['patchSha256']}))

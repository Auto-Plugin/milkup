#!/usr/bin/env python3
"""Research behavior patch on exact Ubuntu 2.52.6. No application/CSS rewrite."""
import pathlib,hashlib,json,difflib,sys
HERE=pathlib.Path(__file__).resolve().parent
BASE=HERE.parent/'pdf-pagination-mechanism-20261116'
def once(s,a,b):
 assert s.count(a)==1,('unique source anchor',a[:90]);return s.replace(a,b)
def build(source,out):
 locked=json.loads((HERE/'source-lock.json').read_text());original={}
 for rel,h in locked.items():
  p=source/'Source/WebCore'/rel;assert hashlib.sha256(p.read_bytes()).hexdigest()==h,rel;original[rel]=p.read_text()
 modified=dict(original)
 f=modified['rendering/RenderBlockFlow.cpp']
 f=once(f,'#include "RenderTableCellInlines.h"','#include "RenderTableCellInlines.h"\n#include "RenderTableSection.h"\n#include "RenderTableRow.h"\n#include "FragmentKeepPolicy.h"')
 f=once(f,'LayoutUnit RenderBlockFlow::adjustForUnsplittableChild(', (HERE/'keep.cpp.inc').read_text()+'LayoutUnit RenderBlockFlow::adjustForUnsplittableChild(')
 anchor='    bool isUnsplittable = childBoxIsUnsplittableForFragmentation(child);'
 f=once(f,anchor,'''    if (document().printing() && writingMode().isHorizontal() && !enclosingFragmentedFlow()) {
        if (auto prefix = leadingTableFragment(child)) {
            auto pageHeight = pageLogicalHeightForOffset(logicalOffset);
            if (pageHeight) {
                auto shift = PrintFragmentPolicy::firstFragmentShift(pageHeight,
                    pageRemainingLogicalHeightForOffset(logicalOffset, ExcludePageBoundary),
                    *prefix + childBeforeMargin, alwaysPageBreak(child.style().breakBefore()));
                if (shift)
                    return logicalOffset + shift;
            }
        }
    }
'''+anchor)
 modified['rendering/RenderBlockFlow.cpp']=f
 h=modified['rendering/RenderTable.h']
 h=once(h,'    RenderTableSection* header() const;', '''    // Print-only, rebuilt from row layout on every full table layout.
    LayoutUnit repeatedPrintHeaderHeight() const { return m_repeatedPrintHeaderHeight; }
    void recordPrintHeaderOffset(LayoutUnit offset)
    {
        if (!m_printHeaderOffsets.contains(offset))
            m_printHeaderOffsets.append(offset);
    }
    RenderTableSection* header() const;''')
 h=once(h,'    mutable Vector<SingleThreadWeakPtr<RenderTableCaption>> m_captions;', '''    LayoutUnit m_repeatedPrintHeaderHeight;
    Vector<LayoutUnit> m_printHeaderOffsets;
    mutable Vector<SingleThreadWeakPtr<RenderTableCaption>> m_captions;''')
 modified['rendering/RenderTable.h']=h
 t=modified['rendering/RenderTable.cpp']
 t=once(t,'    recalcSectionsIfNeeded();\n    // FIXME: We should do this recalc lazily', '    m_repeatedPrintHeaderHeight = 0_lu;\n    m_printHeaderOffsets.clear();\n    recalcSectionsIfNeeded();\n    // FIXME: We should do this recalc lazily')
 a='''        for (RenderTableSection* section = topSection(); section; section = sectionBelow(section))
            section->layoutRows();'''
 t=once(t,a,'''        for (RenderTableSection* section = topSection(); section; section = sectionBelow(section)) {
            section->layoutRows();
            if (section == header() && document().printing() && writingMode().isHorizontal()
                && !enclosingFragmentedFlow() && !isTransformed() && !section->hasSelfPaintingLayer()) {
                auto pageHeight = view().frameView().layoutContext().layoutState()->pageLogicalHeight();
                auto headerHeight = section->logicalHeight();
                bool safe = pageHeight > 0_lu && headerHeight > 0_lu && headerHeight < pageHeight;
                // Do not inject repeated paint over a spanning/over-height cell.
                // Such tables retain their original fragmentation until a full
                // cell-fragment implementation is available.
                for (auto* body = firstBody(); safe && body; body = sectionBelow(body)) {
                    if (body == footer())
                        break;
                    for (auto* row = body->firstRow(); safe && row; row = row->nextRow()) {
                        for (auto* cell = row->firstCell(); cell; cell = cell->nextCell()) {
                            if (cell->rowSpan() != 1 || cell->logicalHeight() + headerHeight > pageHeight) {
                                safe = false;
                                break;
                            }
                        }
                    }
                }
                if (safe)
                    m_repeatedPrintHeaderHeight = headerHeight;
            }
        }''')
 a='''            box.paint(info, childPoint);'''
 t=once(t,a,a+'''
            if (&box == header() && document().printing()) {
                for (auto offset : m_printHeaderOffsets)
                    box.paint(info, childPoint + LayoutSize(0_lu, offset - box.logicalTop()));
            }''')
 a='''                section->paint(info, childPoint);'''
 t=once(t,a,a+'''
                if (section == header() && document().printing()) {
                    for (auto offset : m_printHeaderOffsets)
                        section->paint(info, childPoint + LayoutSize(0_lu, offset - section->logicalTop()));
                }''')
 modified['rendering/RenderTable.cpp']=t
 s=modified['rendering/RenderTableSection.cpp']
 s=once(s,'#include "RenderTableSection.h"','#include "RenderTableSection.h"\n#include "FragmentKeepPolicy.h"')
 anchor='''    for (size_t rowIndex = 0; rowIndex < numberOfRows; rowIndex++) {
        // Set the row's x/y position and width/height.'''
 s=once(s,anchor,'''    for (size_t rowIndex = 0; rowIndex < numberOfRows; rowIndex++) {
        if (auto headerHeight = table()->repeatedPrintHeaderHeight(); headerHeight > 0_lu && this != table()->header()) {
            auto* state = view().frameView().layoutContext().layoutState();
            auto pageHeight = state->pageLogicalHeight();
            auto* row = m_grid[rowIndex].rowRenderer;
            auto rowHeight = m_rowPos[rowIndex + 1] - m_rowPos[rowIndex] - vspacing;
            if (pageHeight > 0_lu && row && rowHeight > 0_lu) {
                auto absolute = state->pageLogicalOffset(this, m_rowPos[rowIndex]);
                auto tableAbsolute = absolute - m_rowPos[rowIndex] - logicalTop();
                auto phase = intMod(absolute, pageHeight);
                bool continuation = absolute - phase > tableAbsolute;
                bool forced = alwaysPageBreak(row->style().breakBefore())
                    || (!rowIndex && alwaysPageBreak(style().breakBefore()))
                    || (rowIndex && m_grid[rowIndex - 1].rowRenderer && alwaysPageBreak(m_grid[rowIndex - 1].rowRenderer->style().breakAfter()));
                auto shift = PrintFragmentPolicy::rowShift(pageHeight, phase, rowHeight, headerHeight, continuation, forced);
                if (shift) {
                    for (size_t i = rowIndex; i <= numberOfRows; ++i)
                        m_rowPos[i] += shift;
                    absolute += shift;
                    phase = intMod(absolute, pageHeight);
                }
                auto pageTop = absolute - phase;
                if (pageTop > tableAbsolute && phase >= headerHeight)
                    table()->recordPrintHeaderOffset(pageTop - tableAbsolute);
            }
        }
        // Set the row's x/y position and width/height.''')
 modified['rendering/RenderTableSection.cpp']=s
 patch=''
 for rel,text in modified.items():
  path='Source/WebCore/'+rel
  patch+=''.join(difflib.unified_diff(original[rel].splitlines(True),text.splitlines(True),fromfile='a/'+path,tofile='b/'+path))
 patch+=''.join(difflib.unified_diff([], (HERE/'FragmentKeepPolicy.h').read_text().splitlines(True),fromfile='/dev/null',tofile='b/Source/WebCore/rendering/FragmentKeepPolicy.h'))
 out.write_text(patch)
 return {'status':'candidate-generated-not-compiled','patchSha256':hashlib.sha256(patch.encode()).hexdigest(),'source':locked,'modified':{k:hashlib.sha256(v.encode()).hexdigest() for k,v in modified.items() if v!=original[k]}}
if __name__=='__main__':print(json.dumps(build(pathlib.Path(sys.argv[1]),pathlib.Path(sys.argv[2])),indent=2))

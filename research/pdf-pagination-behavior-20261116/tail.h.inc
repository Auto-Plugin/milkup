// RESEARCH ONLY: original document, post-layout coordinates; no behavior mutation.
#pragma once
#include "MilkupPaginationResearch.h"
#include "RenderView.h"
#include "RenderObjectNode.h"

namespace WebCore::MilkupTailResearch {
inline unsigned sequence = 0;
inline bool eligible(const RenderBox& box)
{
    return std::getenv("MILKUP_PAGINATION_TAIL") && MilkupPaginationResearch::eligible(box.document());
}
inline unsigned role(const RenderBox& box)
{
    if (box.isRenderView()) return 1;
    if (box.isDocumentElementRenderer()) return 2;
    if (box.isBody()) return 3;
    if (box.parent() && box.parent()->isBody() && !box.nextSibling()) return 4;
    return 0;
}
inline bool reserve(const RenderBox& box)
{
    if (!eligible(box) || !role(box)) return false;
    if (sequence >= 1024) { MilkupPaginationResearch::fail("tail-budget"); return false; }
    return true;
}
inline void margin(const RenderBox& box, const char* phase, LayoutUnit content, LayoutUnit result, LayoutUnit pending, bool collapseBefore, bool collapseAfter)
{
    if (!reserve(box)) return;
    std::fprintf(stderr, "MILKUP_TAIL {\"kind\":\"margin\",\"seq\":%u,\"tick\":%lld,\"role\":%u,\"node\":%u,\"phase\":\"%s\",\"content\":%.17g,\"result\":%.17g,\"pending\":%.17g,\"collapseBefore\":%s,\"collapseAfter\":%s,\"borderPaddingAfter\":%.17g,\"scrollbar\":%.17g,\"collapsedAfter\":%.17g}\n", ++sequence, MilkupPaginationResearch::tick(), role(box), MilkupPaginationResearch::node(box), phase, content.toDouble(), result.toDouble(), pending.toDouble(), collapseBefore ? "true" : "false", collapseAfter ? "true" : "false", box.borderAndPaddingAfter().toDouble(), static_cast<double>(box.scrollbarLogicalHeight()), box.collapsedMarginAfter().toDouble());
}
inline void finalBox(const RenderBox& box, int page)
{
    if (!reserve(box)) return;
    auto layout = box.layoutOverflowRect(); auto visual = box.visualOverflowRect();
    Vector<FloatQuad> quads; box.absoluteQuads(quads, nullptr);
    if (box.needsLayout() || !box.writingMode().isHorizontal() || quads.size() != 1 || !quads[0].isRectilinear()) { MilkupPaginationResearch::fail("tail-final-box"); return; }
    auto q = quads[0].boundingBox();
    std::fprintf(stderr, "MILKUP_TAIL {\"kind\":\"box\",\"seq\":%u,\"tick\":%lld,\"page\":%d,\"role\":%u,\"node\":%u,\"top\":%.17g,\"height\":%.17g,\"marginBefore\":%.17g,\"marginAfter\":%.17g,\"collapsedAfter\":%.17g,\"before\":%u,\"after\":%u,\"quad\":[%.17g,%.17g,%.17g,%.17g],\"layout\":[%.17g,%.17g,%.17g,%.17g],\"visual\":[%.17g,%.17g,%.17g,%.17g]}\n", ++sequence, MilkupPaginationResearch::tick(), page + 1, role(box), MilkupPaginationResearch::node(box), box.logicalTop().toDouble(), box.logicalHeight().toDouble(), box.marginBefore().toDouble(), box.marginAfter().toDouble(), box.collapsedMarginAfter().toDouble(), static_cast<unsigned>(box.style().breakBefore()), static_cast<unsigned>(box.style().breakAfter()), static_cast<double>(q.x()), static_cast<double>(q.y()), static_cast<double>(q.maxX()), static_cast<double>(q.maxY()), layout.x().toDouble(), layout.y().toDouble(), layout.maxX().toDouble(), layout.maxY().toDouble(), visual.x().toDouble(), visual.y().toDouble(), visual.maxX().toDouble(), visual.maxY().toDouble());
}
inline void finalPage(Document& document, const IntRect& pageRect, int page)
{
    auto* view = document.renderView();
    if (!view || !reserve(*view)) return;
    auto d = view->documentRect();
    std::fprintf(stderr, "MILKUP_TAIL {\"kind\":\"document\",\"seq\":%u,\"tick\":%lld,\"page\":%d,\"document\":[%d,%d,%d,%d],\"pageRect\":[%d,%d,%d,%d]}\n", ++sequence, MilkupPaginationResearch::tick(), page + 1, d.x(), d.y(), d.maxX(), d.maxY(), pageRect.x(), pageRect.y(), pageRect.maxX(), pageRect.maxY());
    finalBox(*view, page);
    for (RefPtr element = document.documentElement(); element; element = ElementTraversal::next(*element)) {
        auto* box = dynamicDowncast<RenderBox>(element->renderer());
        if (box && role(*box)) finalBox(*box, page);
    }
    std::fflush(stderr);
}
}

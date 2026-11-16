// RESEARCH ONLY: synthetic fixture, diagnostic reads, no layout mutation.
#pragma once
#include "Document.h"
#include "ElementInlines.h"
#include "GraphicsContext.h"
#include "RenderBlock.h"
#include "RenderBox.h"
#include "RenderObjectInlines.h"
#include "RenderObjectDocument.h"
#include <chrono>
#include <cstdio>
#include <cstdlib>

namespace WebCore::MilkupPaginationResearch {
inline unsigned sequence = 0;
inline unsigned nextCall = 0;
inline unsigned activeCall = 0;
inline unsigned nodeCount = 0;
inline const RenderBox* nodes[32] { };
inline const Document* ownerDocument = nullptr;
inline bool failed = false;
inline unsigned pageCount = 0;

inline unsigned role(const RenderBox& box)
{
    if (!box.element()) return 0;
    auto id = box.element()->getIdAttribute();
    if (id == "mkp-heading"_s) return 1;
    if (id == "mkp-wrapper"_s) return 2;
    if (id == "mkp-table"_s) return 3;
    if (id == "mkp-header"_s) return 4;
    if (id == "mkp-header-row"_s) return 5;
    if (id == "mkp-first-row"_s) return 6;
    return 0;
}
inline bool eligible(Document& document)
{
    return std::getenv("MILKUP_PAGINATION_PROBE") && document.printing()
        && document.title() == "MILKUP_PAGINATION_LAYOUT_V1"_s;
}
inline void fail(const char* reason)
{
    if (!failed) std::fprintf(stderr, "MILKUP_PAGINATION {\"kind\":\"error\",\"reason\":\"%s\"}\n", reason);
    failed = true;
}
inline bool reserve(Document& document)
{
    if (!eligible(document) || failed) return false;
    if (ownerDocument && ownerDocument != &document) { fail("document-replaced"); return false; }
    ownerDocument = &document;
    if (sequence >= 4096) { fail("record-budget"); return false; }
    return true;
}
inline unsigned node(const RenderBox& box)
{
    for (unsigned i = 0; i < nodeCount; ++i) if (nodes[i] == &box) return i + 1;
    if (nodeCount == 32) { fail("node-budget"); return 0; }
    nodes[nodeCount++] = &box;
    return nodeCount;
}
inline long long tick()
{
    return std::chrono::duration_cast<std::chrono::nanoseconds>(std::chrono::steady_clock::now().time_since_epoch()).count();
}
inline void record(const char* kind, const RenderBox& box, double value = 0, unsigned call = 0, unsigned parent = 0)
{
    auto r = role(box);
    if (!r || !reserve(box.document())) return;
    auto identity = node(box);
    if (failed) return;
    auto* block = dynamicDowncast<RenderBlock>(box);
    std::fprintf(stderr, "MILKUP_PAGINATION {\"kind\":\"%s\",\"seq\":%u,\"tick\":%lld,\"role\":%u,\"node\":%u,\"call\":%u,\"parent\":%u,\"value\":%.17g,\"top\":%.17g,\"height\":%.17g,\"width\":%.17g,\"marginBefore\":%.17g,\"marginAfter\":%.17g,\"block\":%s,\"strut\":%.17g,\"before\":%u,\"after\":%u,\"inside\":%u,\"dirty\":%s,\"horizontal\":%s}\n",
        kind, ++sequence, tick(), r, identity, call, parent, value,
        box.logicalTop().toDouble(), box.logicalHeight().toDouble(), box.logicalWidth().toDouble(),
        box.marginBefore().toDouble(), box.marginAfter().toDouble(), block ? "true" : "false",
        block ? block->paginationStrut().toDouble() : 0.0,
        static_cast<unsigned>(box.style().breakBefore()), static_cast<unsigned>(box.style().breakAfter()), static_cast<unsigned>(box.style().breakInside()),
        box.needsLayout() ? "true" : "false", box.writingMode().isHorizontal() ? "true" : "false");
}
struct Scope {
    const RenderBox& box;
    const char* label;
    unsigned call { 0 };
    unsigned parent { 0 };
    Scope(const RenderBox& b, const char* name, double value = 0) : box(b), label(name)
    {
        if (!role(b) || !reserve(b.document())) return;
        parent = activeCall;
        call = ++nextCall;
        activeCall = call;
        record(name, box, value, call, parent);
    }
    void point(const char* name, double value = 0) { if (call) record(name, box, value, call, parent); }
    LayoutUnit result(LayoutUnit value) { point("return", value.toDouble()); return value; }
    ~Scope() { if (call) { record("end", box, 0, call, parent); activeCall = parent; } }
};
inline void finalPage(Document& document, GraphicsContext& context, const IntRect& rect, int page, bool ready)
{
    if (!reserve(document)) return;
    if (++pageCount > 32 || activeCall || !ready) { fail("final-phase"); return; }
    auto m = context.getCTM();
    if (m.b() || m.c() || m.a() <= 0 || m.d() <= 0) { fail("unsupported-ctm"); return; }
    std::fprintf(stderr, "MILKUP_PAGINATION {\"kind\":\"page\",\"seq\":%u,\"tick\":%lld,\"page\":%d,\"rect\":[%d,%d,%d,%d],\"ctm\":[%.17g,%.17g,%.17g,%.17g,%.17g,%.17g]}\n", ++sequence, tick(), page + 1, rect.x(), rect.y(), rect.maxX(), rect.maxY(), m.a(), m.b(), m.c(), m.d(), m.e(), m.f());
    unsigned seen = 0;
    for (RefPtr element = document.documentElement(); element; element = ElementTraversal::next(*element)) {
        auto* box = dynamicDowncast<RenderBox>(element->renderer());
        if (!box || !role(*box)) continue;
        auto r = role(*box);
        if (seen & (1u << r) || box->needsLayout() || !box->writingMode().isHorizontal()) { fail("final-box"); return; }
        seen |= 1u << r;
        record("final", *box);
        Vector<FloatQuad> quads;
        box->absoluteQuads(quads);
        if (quads.isEmpty() || quads.size() > 32) { fail("fragments"); return; }
        for (auto& quad : quads) {
            if (!quad.isRectilinear() || !reserve(document)) { fail("fragment-shape"); return; }
            auto q = quad.boundingBox();
            std::fprintf(stderr, "MILKUP_PAGINATION {\"kind\":\"quad\",\"seq\":%u,\"tick\":%lld,\"page\":%d,\"role\":%u,\"node\":%u,\"rect\":[%.17g,%.17g,%.17g,%.17g]}\n", ++sequence, tick(), page + 1, r, node(*box), static_cast<double>(q.x()), static_cast<double>(q.y()), static_cast<double>(q.maxX()), static_cast<double>(q.maxY()));
        }
    }
    if (seen != 126 || !reserve(document)) { fail("missing-roles"); return; }
    std::fprintf(stderr, "MILKUP_PAGINATION {\"kind\":\"page-end\",\"seq\":%u,\"tick\":%lld,\"page\":%d}\n", ++sequence, tick(), page + 1);
    std::fflush(stderr);
}
}

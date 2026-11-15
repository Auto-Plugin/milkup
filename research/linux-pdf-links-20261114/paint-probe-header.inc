// RESEARCH ONLY: synthetic fixture, finite record/rectangle budgets, no product use.
#pragma once
#include "AffineTransform.h"
#include "Document.h"
#include "ElementInlines.h"
#include "GraphicsContext.h"
#include "LayoutRect.h"
#include "RenderElement.h"
#include "RenderElementInlines.h"
#include "RenderObjectDocument.h"
#include <wtf/text/CString.h>
#include <algorithm>
#include <cstdio>
#include <cstdlib>
#include <string>

namespace WebCore::MilkupPrintResearch {
inline unsigned activePage = 0;
inline unsigned records = 0;
inline unsigned focusCalls = 0;
inline bool dedup = false;

// UNIQUE_PER_CALL_INSERT

inline bool eligible(Document& document)
{
    return std::getenv("MILKUP_PAINT_PROBE") && document.printing() && document.title() == "MILKUP_PRINT_LAYOUT_V1"_s;
}
inline bool allowRecord()
{
    if (++records <= 512)
        return true;
    if (records == 513)
        std::fprintf(stderr, "MILKUP_PAINT {\"kind\":\"error\",\"reason\":\"budget\"}\n");
    return false;
}
inline std::string hex(const String& value)
{
    auto bytes = value.utf8();
    std::string result;
    if (bytes.length() > 128)
        return result;
    constexpr char digits[] = "0123456789abcdef";
    for (unsigned char byte : bytes.span()) {
        result.push_back(digits[byte >> 4]);
        result.push_back(digits[byte & 15]);
    }
    return result;
}
inline void matrix(const AffineTransform& m)
{
    std::fprintf(stderr, "[%.17g,%.17g,%.17g,%.17g,%.17g,%.17g]", m.a(), m.b(), m.c(), m.d(), m.e(), m.f());
}
inline void rectangle(const FloatRect& r)
{
    std::fprintf(stderr, "[%.17g,%.17g,%.17g,%.17g]", static_cast<double>(r.x()), static_cast<double>(r.y()), static_cast<double>(r.maxX()), static_cast<double>(r.maxY()));
}
inline void begin(Document& document, int page)
{
    if (!eligible(document))
        return;
    activePage = page + 1;
    dedup = std::getenv("MILKUP_PAINT_DEDUP") != nullptr;
    if (allowRecord())
        std::fprintf(stderr, "MILKUP_PAINT {\"kind\":\"begin\",\"page\":%u,\"dedup\":%s}\n", activePage, dedup ? "true" : "false");
}
inline void end()
{
    if (activePage && allowRecord())
        std::fprintf(stderr, "MILKUP_PAINT {\"kind\":\"end\",\"page\":%u}\n", activePage);
    activePage = 0;
    std::fflush(stderr);
}
inline Vector<LayoutRect> focus(const RenderElement& renderer, GraphicsContext& context, unsigned phase, const Vector<LayoutRect>& raw)
{
    if (!activePage || !eligible(renderer.document()) || !renderer.element())
        return raw;
    auto id = renderer.element()->getIdAttribute().string();
    if (!id.startsWith("probe-"_s))
        return raw;
    if (raw.size() > 64) {
        std::fprintf(stderr, "MILKUP_PAINT {\"kind\":\"error\",\"reason\":\"rectangles\"}\n");
        return raw;
    }
    auto emitted = dedup ? uniquePerCall(raw) : raw;
    if (!allowRecord())
        return raw;
    auto identity = hex(id);
    std::fprintf(stderr, "MILKUP_PAINT {\"kind\":\"focus\",\"page\":%u,\"call\":%u,\"phase\":%u,\"idHex\":\"%s\",\"block\":%s,\"inline\":%s,\"emitted\":%zu,\"ctm\":", activePage, ++focusCalls, phase, identity.c_str(), renderer.isRenderBlock() ? "true" : "false", renderer.isRenderInline() ? "true" : "false", emitted.size());
    matrix(context.getCTM());
    std::fprintf(stderr, ",\"raw\":[");
    bool comma = false;
    for (const auto& r : raw) {
        if (comma) std::fprintf(stderr, ",");
        rectangle(FloatRect(r));
        comma = true;
    }
    std::fprintf(stderr, "]}\n");
    return emitted;
}
inline void clip(const char* path, const RenderElement& renderer, GraphicsContext& context, unsigned phase, const LayoutRect& raw, const FloatRect& actual, float scale)
{
    if (!activePage || !eligible(renderer.document()) || !renderer.element() || renderer.element()->getIdAttribute() != "clip-parent"_s || !allowRecord())
        return;
    std::fprintf(stderr, "MILKUP_PAINT {\"kind\":\"clip\",\"page\":%u,\"path\":\"%s\",\"phase\":%u,\"scale\":%.17g,\"ctm\":", activePage, path, phase, static_cast<double>(scale));
    matrix(context.getCTM());
    std::fprintf(stderr, ",\"raw\":"); rectangle(FloatRect(raw));
    std::fprintf(stderr, ",\"actual\":"); rectangle(actual);
    std::fprintf(stderr, "}\n");
}
}

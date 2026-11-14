// RESEARCH ONLY. Insert into PrintContext.cpp, never into a production runtime.
// Reads layout, not OutlinePainter, GraphicsContext::setURLForRect or PDF output.
static void milkupPrintLayoutProbe(Document& document, GraphicsContext& context, const IntRect& pageRect, int pageNumber, bool layoutReady)
{
    if (!std::getenv("MILKUP_PRINT_LAYOUT_PROBE"))
        return;
    // Only our synthetic local fixture is eligible; never log arbitrary documents.
    if (document.title() != "MILKUP_PRINT_LAYOUT_V1"_s)
        return;
    static unsigned pages = 0;
    if (++pages > 8) {
        std::fprintf(stderr, "MILKUP_LAYOUT {\"kind\":\"error\",\"reason\":\"page-budget\"}\n");
        return;
    }
    auto ctm = context.getCTM();
    bool complete = document.printing() && layoutReady && !ctm.b() && !ctm.c() && ctm.a() > 0 && ctm.d() > 0;
    std::fprintf(stderr, "MILKUP_LAYOUT {\"kind\":\"page\",\"page\":%d,\"printing\":%s,\"layoutReady\":%s,\"ctm\":[%.17g,%.17g,%.17g,%.17g,%.17g,%.17g],\"pageRect\":[%d,%d,%d,%d]}\n",
        pageNumber + 1, document.printing() ? "true" : "false", layoutReady ? "true" : "false", ctm.a(), ctm.b(), ctm.c(), ctm.d(), ctm.e(), ctm.f(), pageRect.x(), pageRect.y(), pageRect.maxX(), pageRect.maxY());
    auto hex = [](const String& value) {
        auto bytes = value.utf8();
        std::string result;
        if (bytes.length() > 2048)
            return result;
        constexpr char digits[] = "0123456789abcdef";
        for (unsigned char byte : bytes.span()) {
            result.push_back(digits[byte >> 4]);
            result.push_back(digits[byte & 15]);
        }
        return result;
    };
    unsigned elements = 0;
    for (RefPtr child = document.documentElement(); child; child = ElementTraversal::next(*child)) {
        // Fixture IDs cover anchors AND their exact no-link span controls.
        auto id = child->getIdAttribute().string();
        if (!id.startsWith("probe-"_s))
            continue;
        if (++elements > 32) { complete = false; break; }
        auto* renderer = child->renderer();
        if (!renderer) { complete = false; continue; }
        Vector<FloatQuad> quads;
        renderer->absoluteQuads(quads);
        if (quads.isEmpty() || quads.size() > 64) { complete = false; continue; }
        auto uri = child->getAttribute(HTMLNames::hrefAttr);
        auto idHex = hex(id);
        auto uriHex = hex(uri);
        if (idHex.empty() || (!uri.isEmpty() && uriHex.empty())) { complete = false; continue; }
        // The selected fixtures use only axis-aligned, rectangular overflow clips.
        // Record each ancestor clip independently; no annotation clip API is read.
        std::fprintf(stderr, "MILKUP_LAYOUT {\"kind\":\"element\",\"page\":%d,\"idHex\":\"%s\",\"uriHex\":\"%s\",\"fragments\":[", pageNumber + 1, idHex.c_str(), uriHex.c_str());
        bool comma = false;
        for (auto& quad : quads) {
            if (!quad.isRectilinear()) complete = false;
            auto rect = quad.boundingBox();
            std::fprintf(stderr, "%s[%.17g,%.17g,%.17g,%.17g]", comma ? "," : "", static_cast<double>(rect.x()), static_cast<double>(rect.y()), static_cast<double>(rect.maxX()), static_cast<double>(rect.maxY()));
            comma = true;
        }
        std::fprintf(stderr, "],\"clips\":[");
        comma = false;
        unsigned depth = 0;
        for (auto* ancestor = renderer->parent(); ancestor; ancestor = ancestor->parent()) {
            if (++depth > 32) { complete = false; break; }
            auto* box = dynamicDowncast<RenderBox>(*ancestor);
            if (!box || !box->hasNonVisibleOverflow()) continue;
            auto localClip = box->overflowClipRect(LayoutPoint());
            auto quad = box->localToAbsoluteQuad(FloatQuad(FloatRect(localClip)));
            if (!quad.isRectilinear()) complete = false;
            auto rect = quad.boundingBox();
            std::fprintf(stderr, "%s[%.17g,%.17g,%.17g,%.17g]", comma ? "," : "", static_cast<double>(rect.x()), static_cast<double>(rect.y()), static_cast<double>(rect.maxX()), static_cast<double>(rect.maxY()));
            comma = true;
        }
        std::fprintf(stderr, "]}\n");
    }
    std::fprintf(stderr, "MILKUP_LAYOUT {\"kind\":\"end\",\"page\":%d,\"elements\":%u,\"complete\":%s}\n", pageNumber + 1, elements, complete ? "true" : "false");
    std::fflush(stderr);
}

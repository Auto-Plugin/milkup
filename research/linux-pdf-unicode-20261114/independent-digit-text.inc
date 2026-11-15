// Research only. Caller must retain LTR/horizontal TextRun and actual offset
// provenance guards. This does not infer source characters from glyph IDs.
static std::optional<ScalarGlyphText> makeIndependentAsciiDigitText(
    std::u16string_view source, std::span<const uint32_t> offsets,
    std::span<const uint32_t> drawnGlyphs, std::span<const uint32_t> nominalGlyphs)
{
    if (source.empty() || source.size() > ScalarGlyphText::maxBytes / 4
        || offsets.size() != drawnGlyphs.size() || offsets.size() != nominalGlyphs.size())
        return std::nullopt;
    // acceptedGlyphs is deliberately NOT described as a font cmap. Unchanged
    // glyphs retain the nominal requirement; only a valid ASCII digit source
    // may supply a different actual shaped glyph. No output glyph is changed.
    std::vector<uint32_t> acceptedGlyphs(nominalGlyphs.begin(), nominalGlyphs.end());
    for (size_t i = 0; i < offsets.size(); ++i) {
        if (drawnGlyphs[i] == nominalGlyphs[i])
            continue;
        if (offsets[i] >= source.size() || source[offsets[i]] < u'0' || source[offsets[i]] > u'9'
            || !nominalGlyphs[i] || nominalGlyphs[i] >= 0xFFFF
            || !drawnGlyphs[i] || drawnGlyphs[i] >= 0xFFFF)
            return std::nullopt;
        acceptedGlyphs[i] = drawnGlyphs[i];
    }
    // The unchanged helper proves complete one-scalar/one-glyph coverage of
    // the WHOLE span: exact increasing UTF-16 offsets, no repeated/missing
    // clusters, extra glyphs, ligatures or malformed surrogate pairs. Preserve
    // original text for Skia's existing extended-map/ActualText conflict path.
    return makeScalarGlyphText(source, offsets, drawnGlyphs, acceptedGlyphs);
}

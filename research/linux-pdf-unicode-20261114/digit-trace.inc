// Synthetic engine probe only: never enabled by the application.
static void milkupDigitTrace(std::u16string_view source, std::span<const uint32_t> offsets,
    std::span<const uint32_t> glyphs, std::span<const uint32_t> nominal, bool accepted)
{
    if (!std::getenv("MILKUP_DIGIT_PROBE"))
        return;
    bool changed = false;
    for (size_t i = 0; i < offsets.size(); ++i) {
        if (offsets[i] < source.size() && source[offsets[i]] >= u'0' && source[offsets[i]] <= u'9'
            && glyphs[i] != nominal[i])
            changed = true;
    }
    if (!changed)
        return;
    static unsigned records = 0;
    if (++records > 512 || source.size() > 256 || glyphs.size() > 256) {
        std::fprintf(stderr, "MILKUP_DIGIT_OVERFLOW\n");
        return;
    }
    std::fprintf(stderr, "MILKUP_DIGIT_V1 {\"accepted\":%s,\"source\":[", accepted ? "true" : "false");
    for (size_t i = 0; i < source.size(); ++i)
        std::fprintf(stderr, "%s%u", i ? "," : "", static_cast<unsigned>(source[i]));
    std::fprintf(stderr, "],\"glyphs\":[");
    for (size_t i = 0; i < glyphs.size(); ++i)
        std::fprintf(stderr, "%s[%u,%u,%u]", i ? "," : "", offsets[i], glyphs[i], nominal[i]);
    std::fprintf(stderr, "]}\n");
}

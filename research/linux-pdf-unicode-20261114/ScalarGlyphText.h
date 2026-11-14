// Research-only source metadata bridge; not an installed WebKit patch.
// Copyright (C) 2026 LarryZhu-dev. SPDX-License-Identifier: BSD-2-Clause
#pragma once
#include <cstdint>
#include <limits>
#include <optional>
#include <span>
#include <string>
#include <string_view>
#include <vector>

namespace WebCore {
// Deliberately narrow: one LTR source scalar per unchanged nominal glyph.
// Ligatures, reordered/repeated offsets, synthetic/missing glyphs and partial
// surrogate pairs are rejected, never reverse-mapped or normalized.
struct ScalarGlyphText {
    static constexpr size_t maxBytes = 1024 * 1024;
    std::string utf8;
    std::vector<uint32_t> clusters;

    bool validFor(size_t glyphCount) const
    {
        if (utf8.empty() || utf8.size() > maxBytes || clusters.size() != glyphCount || !glyphCount)
            return false;
        size_t byte = 0, glyph = 0;
        while (byte < utf8.size()) {
            if (glyph == glyphCount || clusters[glyph++] != byte)
                return false;
            uint8_t first = static_cast<uint8_t>(utf8[byte++]);
            uint32_t scalar = first;
            unsigned continuation = 0;
            uint32_t minimum = 0;
            if (first >= 0xC2 && first <= 0xDF) { scalar = first & 0x1F; continuation = 1; minimum = 0x80; }
            else if (first >= 0xE0 && first <= 0xEF) { scalar = first & 0x0F; continuation = 2; minimum = 0x800; }
            else if (first >= 0xF0 && first <= 0xF4) { scalar = first & 7; continuation = 3; minimum = 0x10000; }
            else if (first >= 0x80) return false;
            for (unsigned i = 0; i < continuation; ++i) {
                if (byte >= utf8.size()) return false;
                uint8_t next = static_cast<uint8_t>(utf8[byte++]);
                if ((next & 0xC0) != 0x80) return false;
                scalar = (scalar << 6) | (next & 0x3F);
            }
            if (scalar < minimum || scalar > 0x10FFFF || (scalar >= 0xD800 && scalar <= 0xDFFF))
                return false;
        }
        return glyph == glyphCount;
    }

    std::optional<ScalarGlyphText> slice(size_t first, size_t count) const
    {
        if (!validFor(clusters.size()) || !count || first >= clusters.size() || count > clusters.size() - first)
            return std::nullopt;
        const size_t start = clusters[first];
        const size_t end = first + count == clusters.size() ? utf8.size() : clusters[first + count];
        ScalarGlyphText result;
        result.utf8 = utf8.substr(start, end - start);
        for (size_t i = first; i < first + count; ++i)
            result.clusters.push_back(clusters[i] - start);
        return result;
    }
};

inline std::optional<ScalarGlyphText> makeScalarGlyphText(
    std::u16string_view source, std::span<const uint32_t> offsets,
    std::span<const uint32_t> drawnGlyphs, std::span<const uint32_t> nominalGlyphs)
{
    if (source.empty() || source.size() > ScalarGlyphText::maxBytes / 4
        || offsets.size() != drawnGlyphs.size() || offsets.size() != nominalGlyphs.size())
        return std::nullopt;
    ScalarGlyphText result;
    size_t index = 0;
    for (size_t offset = 0; offset < source.size(); ++index) {
        if (index >= offsets.size() || offsets[index] != offset
            || !drawnGlyphs[index] || drawnGlyphs[index] == 0xFFFF
            || drawnGlyphs[index] != nominalGlyphs[index])
            return std::nullopt;
        uint32_t scalar = source[offset++];
        if (scalar >= 0xD800 && scalar <= 0xDBFF) {
            if (offset == source.size()) return std::nullopt;
            uint32_t low = source[offset++];
            if (low < 0xDC00 || low > 0xDFFF) return std::nullopt;
            scalar = 0x10000 + ((scalar - 0xD800) << 10) + low - 0xDC00;
        } else if (scalar >= 0xDC00 && scalar <= 0xDFFF)
            return std::nullopt;
        result.clusters.push_back(static_cast<uint32_t>(result.utf8.size()));
        if (scalar < 0x80) result.utf8.push_back(static_cast<char>(scalar));
        else if (scalar < 0x800) {
            result.utf8.push_back(static_cast<char>(0xC0 | (scalar >> 6)));
            result.utf8.push_back(static_cast<char>(0x80 | (scalar & 0x3F)));
        } else if (scalar < 0x10000) {
            result.utf8.push_back(static_cast<char>(0xE0 | (scalar >> 12)));
            result.utf8.push_back(static_cast<char>(0x80 | ((scalar >> 6) & 0x3F)));
            result.utf8.push_back(static_cast<char>(0x80 | (scalar & 0x3F)));
        } else {
            result.utf8.push_back(static_cast<char>(0xF0 | (scalar >> 18)));
            result.utf8.push_back(static_cast<char>(0x80 | ((scalar >> 12) & 0x3F)));
            result.utf8.push_back(static_cast<char>(0x80 | ((scalar >> 6) & 0x3F)));
            result.utf8.push_back(static_cast<char>(0x80 | (scalar & 0x3F)));
        }
    }
    if (index != offsets.size() || !result.validFor(drawnGlyphs.size()))
        return std::nullopt;
    return result;
}
}

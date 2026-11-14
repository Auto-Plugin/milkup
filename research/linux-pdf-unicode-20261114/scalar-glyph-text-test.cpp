#include "ScalarGlyphText.h"
#include <cassert>
#include <iostream>
using namespace WebCore;
int main()
{
    const std::u16string original = u"文⽂风⻛又⼜月⽉";
    const std::vector<uint32_t> offsets {0,1,2,3,4,5,6,7};
    // Each original/radical pair deliberately shares a glyph ID.
    const std::vector<uint32_t> glyphs {146,146,170,170,128,128,39,39};
    auto data = makeScalarGlyphText(original, offsets, glyphs, glyphs);
    assert(data && data->utf8 == "文⽂风⻛又⼜月⽉");
    assert(data->clusters == std::vector<uint32_t>({0,3,6,9,12,15,18,21}));
    // Every possible fallback font partition preserves each source byte once.
    unsigned partitions = 0;
    for (unsigned mask = 0; mask < 128; ++mask) {
        std::string joined; size_t start = 0;
        for (size_t i = 0; i < 8; ++i) {
            if (i == 7 || (mask & (1u << i))) {
                auto part = data->slice(start, i + 1 - start);
                assert(part && part->validFor(i + 1 - start));
                joined += part->utf8; start = i + 1;
            }
        }
        assert(joined == data->utf8); ++partitions;
    }
    const std::vector<uint32_t> supplementaryOffsets {0,1,3};
    const std::vector<uint32_t> supplementaryGlyphs {146,8,146};
    auto supplementary = makeScalarGlyphText(u"文🙂⽂", supplementaryOffsets, supplementaryGlyphs, supplementaryGlyphs);
    assert(supplementary && supplementary->utf8 == "文🙂⽂");
    assert(supplementary->slice(1,1)->utf8 == "🙂");
    // Owned bytes remain valid after the TextRun and temporary slices disappear.
    ScalarGlyphText cached = *data;
    data.reset();
    assert(cached.utf8 == "文⽂风⻛又⼜月⽉");
    unsigned rejected = 0;
    auto reject = [&](auto source, auto positions, auto actual, auto nominal) {
        assert(!makeScalarGlyphText(source, positions, actual, nominal)); ++rejected;
    };
    auto bad = offsets;
    bad[2] = bad[1]; reject(original, bad, glyphs, glyphs); // repeated cluster
    bad = offsets; std::swap(bad[0],bad[1]); reject(original,bad,glyphs,glyphs); // RTL/reordering
    bad = offsets; bad[0]=1; reject(original,bad,glyphs,glyphs); // missing source prefix
    bad = offsets; bad[7]=99; reject(original,bad,glyphs,glyphs);
    auto changed = glyphs; changed[2]=77; reject(original,offsets,changed,glyphs); // substitution
    changed = glyphs; changed[0]=0; reject(original,offsets,changed,changed); // missing glyph
    changed = glyphs; changed[0]=0xFFFF; reject(original,offsets,changed,changed); // deleted glyph
    reject(original,std::vector<uint32_t>{0},std::vector<uint32_t>{1},std::vector<uint32_t>{1}); // ligature
    reject(std::u16string(1,0xD800),std::vector<uint32_t>{0},std::vector<uint32_t>{1},std::vector<uint32_t>{1});
    reject(std::u16string(1,0xDC00),std::vector<uint32_t>{0},std::vector<uint32_t>{1},std::vector<uint32_t>{1});
    reject(std::u16string(ScalarGlyphText::maxBytes/4+1,u'a'),offsets,glyphs,glyphs);
    assert(!cached.slice(0,0) && !cached.slice(8,1) && !cached.slice(1,SIZE_MAX));
    for (std::string malformed : {std::string("\xC0\xAF",2),std::string("\xED\xA0\x80",3),std::string("\xF4\x90\x80\x80",4),std::string("\xE4\xB8",2)}) {
        ScalarGlyphText invalid {malformed,{0}}; assert(!invalid.validFor(1)); ++rejected;
    }
    cached.clusters[1]=1; assert(!cached.validFor(8)); ++rejected;
    std::cout << "{\"status\":\"passed\",\"fallbackPartitions\":" << partitions
        << ",\"rejectedInvalidCases\":" << rejected
        << ",\"scope\":\"compiled metadata algorithm only; not patched WebKit or PDF acceptance\"}\n";
}

/* Copyright (C) 2026 LarryZhu-dev. SPDX-License-Identifier: BSD-2-Clause */
#pragma once
#include <set>
#include <tuple>

namespace WebCore {
// One element, one paint call, one current transform/clip/page. Never retain
// URLs or rectangles across calls. Exact raw layout units preserve neighboring
// and overlapping but nonidentical fragments; emission keeps source order.
template<typename Rectangles>
Rectangles uniquePrintLinkFragments(const Rectangles& input)
{
    std::set<std::tuple<int, int, int, int>> seen;
    Rectangles result;
    for (const auto& rect : input) {
        if (rect.isEmpty())
            continue;
        auto key = std::tuple { rect.x().rawValue(), rect.y().rawValue(), rect.width().rawValue(), rect.height().rawValue() };
        if (seen.insert(key).second)
            result.append(rect);
    }
    return result;
}
}

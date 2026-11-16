#pragma once
#include <algorithm>

namespace WebCore::PrintFragmentPolicy {
// The caller restricts this to the printing document element's positive trailing
// collapsed margin, without after border/padding/scrollbar. Existing content
// height (including forced breaks and real overflow) is never reduced here.
template<class Unit>
constexpr Unit rootTrailingMargin(Unit margin, Unit remaining)
{
    if (margin <= Unit { } || remaining < Unit { })
        return margin;
    return std::min(margin, remaining);
}
}

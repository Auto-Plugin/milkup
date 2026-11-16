/* Research candidate for the existing WebCore print fragmenter. LGPL-2.1-or-later. */
#pragma once

namespace WebCore::PrintFragmentPolicy {
// All units come from final layout. Never move an over-height first fragment,
// override an explicit page break, or move from an already empty page.
template<typename Unit>
Unit firstFragmentShift(Unit pageHeight, Unit remaining, Unit prefixHeight, bool forcedBreak)
{
    if (forcedBreak || pageHeight <= Unit { } || remaining <= Unit { }
        || remaining >= pageHeight || prefixHeight <= Unit { } || prefixHeight > pageHeight)
        return { };
    return prefixHeight > remaining ? remaining : Unit { };
}

// A repeated header needs space in layout, not a paint-time overlay. Oversized
// rows keep the existing fragmentation path rather than looping or cropping.
template<typename Unit>
Unit rowShift(Unit pageHeight, Unit pageOffset, Unit rowHeight, Unit headerHeight, bool continuation, bool forcedBreak)
{
    if (pageHeight <= Unit { } || pageOffset < Unit { } || pageOffset >= pageHeight
        || headerHeight <= Unit { } || rowHeight <= Unit { }
        || headerHeight + rowHeight > pageHeight)
        return { };
    if (forcedBreak && pageOffset > Unit { })
        return pageHeight - pageOffset + headerHeight;
    if (continuation && pageOffset < headerHeight)
        return headerHeight - pageOffset;
    if (rowHeight > pageHeight - pageOffset)
        return pageHeight - pageOffset + headerHeight;
    return { };
}
}

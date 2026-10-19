# WebKit long-block heading pagination: source assessment

Status: read-only design, no engine or converter patch, no patched-engine execution. The user retained existing dependencies and selected WebKit engine repair; Chromium results remain research only. The frozen failure fixtures and expectations are unchanged.

## Observed result and scope

The retained native baseline reproduces TABLE575 heading/first-content pages 16/17, CODE575 21/22 and LIST575 26/27. Whole-unit avoidance fixes short blocks but not these long blocks. Adjacent avoid chains and a single-table caption experiment fail. A code/list split experiment changes semantic containers and was not adopted. See `../webkit-candidates/comparison.json`, `design-review.json` and `baseline-pixel-review.json` for actual artifacts. This assessment does not replace those observations with a source-level assertion of success.

The source is the official `webkitgtk-2.52.6` tag. `sources.json` pins the downloaded bytes. Installed distribution patches, optimized runtime branches and exact causal execution have not been traced. Line anchors below refer to the downloaded files, not a potentially reformatted browser preview.

## Source facts

1. [RenderBlock::childBoxIsUnsplittableForFragmentation](https://github.com/WebKit/WebKit/blob/webkitgtk-2.52.6/Source/WebCore/rendering/RenderBlock.cpp#L2769-L2776) classifies applicable `break-inside: avoid` as unsplittable.
2. [RenderBlockFlow::adjustForUnsplittableChild](https://github.com/WebKit/WebKit/blob/webkitgtk-2.52.6/Source/WebCore/rendering/RenderBlockFlow.cpp#L2229-L2264) returns without moving an unsplittable child when its height exceeds a uniform page. Keeping this oversized escape is necessary. Treating an entire long block as atomic cannot bind only its first content to a preceding heading.
3. [applyBeforeBreak/applyAfterBreak](https://github.com/WebKit/WebKit/blob/webkitgtk-2.52.6/Source/WebCore/rendering/RenderBlockFlow.cpp#L1877-L1929) handle forced page/column breaks. These functions do not implement adjacent sibling `avoid`. This is a statement about these inspected functions, not a claim that every WebKit fragmentation implementation lacks it.
4. [adjustBlockChildForPagination](https://github.com/WebKit/WebKit/blob/webkitgtk-2.52.6/Source/WebCore/rendering/RenderBlockFlow.cpp#L1931-L2022) can receive a child's pagination strut. It propagates it outward only at the parent's initial block side under additional conditions; otherwise it moves that child. A preceding nonempty heading makes this condition inapplicable. [layoutBlockChildren/layoutBlockChild](https://github.com/WebKit/WebKit/blob/webkitgtk-2.52.6/Source/WebCore/rendering/RenderBlockFlow.cpp#L861-L954) process siblings in order, maintaining collapsed margins, block height and float state. These observations explain a plausible loss of the earlier legal breakpoint, but require runtime instrumentation to prove the exact causal path.
5. [computeLineAdjustmentForPagination](https://github.com/WebKit/WebKit/blob/webkitgtk-2.52.6/Source/WebCore/rendering/RenderBlockFlow.cpp#L2057-L2169) already considers real line geometry, widows/orphans, first-line struts and oversized lines. It expressly excludes table cells from the first-line strut propagation branch. These line metrics are a useful basis for code/list content, not a complete table solution.
6. [RenderTableSection::layoutRows](https://github.com/WebKit/WebKit/blob/webkitgtk-2.52.6/Source/WebCore/rendering/RenderTableSection.cpp#L616-L679) lays out cells and adjusts row heights for pagination, with an explicit stability limitation. [RenderTable::layout](https://github.com/WebKit/WebKit/blob/webkitgtk-2.52.6/Source/WebCore/rendering/RenderTable.cpp#L652-L673) bounds recursive relayout when sections move. [markForPaginationRelayoutIfNeeded](https://github.com/WebKit/WebKit/blob/webkitgtk-2.52.6/Source/WebCore/rendering/RenderTable.cpp#L1706-L1719) dirties sections when the table's page offset changes. A table fix must cooperate with this machinery and retain the same table and column calculation.

[CSS Fragmentation Level 3](https://www.w3.org/TR/css-break-3/#unforced-breaks) allows avoidance constraints to be relaxed when necessary; it does not prescribe one unique breakpoint choice. The product acceptance condition is specifically that a heading and an available first content fragment fit together, not that an arbitrarily large block must fit one page.

## Smallest defensible engine direction

First instrument the existing nine cases, logging child identities, logical tops, remaining page height, first-content line/row offsets, applied break values and strut propagation. Confirm whether the above block-flow path is actually used before proposing a patch. Keep logging out of release builds.

The candidate is a generic pagination constraint, not heading-tag recognition: remember a legal earlier breakpoint for a sibling avoidance chain, and reconsider it when the next block's first content is pushed to a later page. Bind the preceding chain plus the next block's smallest admissible first fragment. Do not bind the whole next block. Current converter headings already express `break-after: avoid`; the product HTML need not change.

For code and list content, use laid-out line/child geometry, including widows/orphans and nested first in-flow content. A source newline or whole list item is not necessarily the smallest fragment: either can exceed a page. Never split text nodes, normalize Unicode, reconstruct list numbering or copy the heading.

For tables, supply first-fragment constraints from the existing single table after column widths are known: top captions/header participation and the first admissible body content. A complete first row can exceed a page, so using its total height alone repeats the original bug. Colspans, rowspans, collapsed borders and repeated headers require explicit tests. Do not propagate a cell strut indiscriminately or split the table into separately sized tables.

A correct move requires restoring/replaying relevant parent state (height, margin collapsing, float influence and fragment ranges), or an equivalent preflight measurement before committing sibling positions. Simply subtracting a heading's height from the child's new top is unsafe. The existing child-relayout helpers are a potential integration point; they are not by themselves proof of a safe rollback implementation.

Bound retries and preserve forward progress: forced breaks win; a heading plus admissible first fragment that exceeds an empty page must relax avoidance and fragment naturally. Keep the existing oversized guard. Do not turn `avoid` into `always`, remove the table-cell exclusion without a table-specific design, or permit an unbounded relayout loop.

This is not a one-line fix. The likely narrow ownership is block-flow sibling fragmentation plus a table first-fragment interface. The code/list path can be developed and measured first, but partial success must not be reported as fixing table pagination. No product-ready patch is supplied by this assessment.

## Acceptance gates independent of implementation

- Frozen original nine cases: heading and first real marker on the same page; all required markers exactly once; no added blank pages; compare key-page pixels against retained WebKit failures. Page numbers may change and are not hardcoded as success expectations.
- Three oversized first-unit cases: first row / logical code line / list item exceed a page. Preserve all 360 chunk markers, source Unicode clusters, trailing content, natural fragmentation and bounded termination. Report poor column widths or excessive whitespace separately even when marker counts pass.
- Short blocks still stay together; ordinary heading+paragraph and warning grouping remain intact. A heading taller than a page and an unbreakable first piece must soften constraints without clipping or loops.
- Table tests: auto/fixed sizing, header present/absent, row/colspans, repeated headers, long first cell, same-table widths and source order. Code tests: leading blank lines, tabs, trailing spaces, combining sequences and ZWJ clusters. Lists: non-1 ordered start, nested first item and source fallback.
- Layout controls: forced breaks, avoidance chains longer than one sibling, empty/self-collapsing siblings, nested wrappers, margins/floats and non-default writing directions. Screen layout and source DOM/text must remain unchanged.
- Run the actual patched WebKit native helper, then real packaged export/print. Passing an unrelated engine or a serializer-generated stand-in is not acceptance. Preserve exact Poppler and MuPDF extraction failures, including expanded Arabic logical order, separately from pagination geometry.

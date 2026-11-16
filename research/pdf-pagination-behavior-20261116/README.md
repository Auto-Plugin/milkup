# Legacy native print first-fragment candidate (research only)

Base: db2218fb / native 43808221193; retained evidence 2702fd2c.
No product or production runtime is changed. No CSS/HTML rewrite or new engine.

The source-bound patch computes a leading heading/table first fragment from
actual layout, including header, first data row and collapsed offsets. It does
not use full table height as the requested keep extent. Explicit forced breaks
and a fragment larger than a page are not overridden.

The separate repeated-header path reserves header space before moving each
ordinary body row to a continuation page. It records table-relative slots
within the existing layout and paints the original header at those slots for
normal and collapsed-border phases. Plans are cleared on full relayout.
This is not a paint-only overlay. Screen, columns, transformed/self-painting
headers, rowspan and cells taller than usable page height keep their existing
path; these are explicit remaining coverage/implementation limits, not passes.

Source review: matched RenderBlockFlow's break-before/after only implements
forced breaks; full-wrapper avoidance abandons a wrapper higher than a page.
RenderTable currently paints sections only once and has no repeated-header
space reservation. Upstream WebKit issue 17205 remains an existing public
reference, not an issue opened by this work:
https://bugs.webkit.org/show_bug.cgi?id=17205
The historical Blink change 81c0fc6d4 also separates row-space reservation from
repeated painting; it cannot be directly transplanted because current WebKit
lacks that revision's row-strut APIs. No Chromium runtime is introduced.

Local checks: exact original source hashes; generated patch composes with the
unchanged observation patch; original native orphan failure is rejected by the
new contract; real C++ fixed-unit policy tests cover tight/roomy, exact fit,
forced break, first fragment over a page, zero/negative bounds, idempotent row
slots and 300 ordered rows under four page budgets. These are algorithm and
wiring checks, NOT WebKit layout acceptance. Original package/guard/FD cleanup
flow is identical except explicit A4/Letter and orientation parameters.

One proposed bounded manual run requires the exact 43808221193 object archive
14199955883, validates the base restore before mutation, compiles the three
changed actual TUs with official generated headers/strict flags, then permits
at most 2400 seconds / 160 new compiler misses for reconstruction. This is
bounded incremental work, not a cold fallback. Source/compiler/base flags,
patch and changed header inputs are recorded. A failed compile stops native
execution. New cache receipts include behavior inputs and cannot masquerade
as the observation-only cache.

Native target gate: four unchanged original A4 controls, then original long
content in A4 landscape / Letter portrait / Letter landscape with matching
paper declaration and actual helper settings. Original content/row order,
heading keep, clipping/raster and repeated-header thresholds are preserved.
Kernel sender identity, exact mapped libraries, bwrap ancestry, default sandbox,
1024x768 and normal exit remain mandatory. Old stock failures are retained;
coordinates are expected to change only in this behavior test. Text mapping
and URI annotations are separately recorded and overall product acceptance
stays false. Oversized first rows, forced-break and margin behavior have only
local policy checks until a distinct native fixture gate exists. No release
claim is possible from this targeted batch, even if it passes.

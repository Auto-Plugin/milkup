# Narrow root-margin correction from observed native cause

Evidence: 43818472547, unchanged seven original inputs. Last paragraph/body end
at 6994.8125 CSS px; HTML root adds the body's collapsed 16px margin, yielding
7010.8125 / snapped document height7011. At 875px per page, the 11px excess is
white background. RenderView adds zero. Six other direction/layout cases pass.

The additive `root-margin.patch` changes only the document element's after-side
margin addition in legacy printing. It is horizontal, paginated, positive-height,
without fragmented flow or after border/padding/scrollbar. The positive trailing
margin is limited to the remaining page extent, using the existing exact
IncludePageBoundary convention; nonpositive margins are unchanged. Actual
content height, forced-break progress, explicit size, borders, padding, and
children's layout/visual overflow are not reduced. This mirrors the existing
before-margin boundary restriction; it is not PDF trimming or a global margin
reset. It still requires native verification and broader upstream review.

The source is locked after the exact behavior and read-only tail patches. The
policy is compiled with 1/64px fixed-unit counterexamples, including the real
16px/5.1875px values, zero/negative margins, an exact boundary, existing forced
page progress and content already beyond the prior boundary. Real TU compilation
and final native layout remain separate mandatory gates.

The original seven cases retain all original thresholds. Two separately labelled
research controls extend the original short-room HTML (same package/guard):
- A forced break into a 1px empty block, then another forced break to a unique
  marker. The intentional fifth blank page must remain, marker on page six.
- A 1900px gray box after a forced break, with unique start/end markers. It must
  retain the non-text gray sixth page, start on five/end on seven. Raster proof
  requires more than half that page non-white; text-only emptiness cannot discard it.

These controls have explicit expected text-free middle pages. They do not change
or excuse the blank-page rejection in any of the seven original documents. All
original row/marker/clip/header checks still run for their original content, and
missing markers, loss of the intentional blank or the gray content fail. Missing
cases or any failure leaves the overall result failed. Same-WebProcess identity,
private library bytes, default sandbox and normal cleanup are unchanged.

Dispatch is explicit: operation=pagination-segment, pagination_behavior=true,
pagination_tail=root-margin, pagination_restore_run=43808221193. The proven
six-field cache is reused; neither new seven-field artifact is fed into that
restore stage. Same 2400s/160-miss continuation cap; no cold fallback. No product
or engine rebuild beyond this one necessary research correction; no production
runtime delivery claim. Main, releases, notifications, safety and production
configuration are untouched.

# One bounded paint-phase A/B probe

Base evidence: accepted actual-TU gate 43660565818 and strict failed native probe
43661203007, both 835fece0. No repeat of old TU gate or application installations.

Matched source paths:

- OutlinePainter::collectFocusRingRectsForBlock appends a block's own rectangle,
  then, if unclipped, appends inline-child line rectangles. The positioned neighbor
  can therefore have equal block/line rectangles. This is a hypothesis until the
  raw collection and call multiplicity are observed at native print time.
- RenderBox::pushContentsClip computes overflowClipRect then snaps at document
  deviceScaleFactor before context.clip. RenderLayer::clipToRect has a separate
  snapping path. Capture their actual arguments independently from annotation
  output, with page, phase, CTM, raw/actual clip and scale.

Research instrumentation is eligible only while printing the exact synthetic
fixture title under an explicit environment flag. Budgets: 8 layout pages, 512
paint records and 64 rectangles per call. Native errors, missing records, wrong
phases or ambiguous clips fail closed. New private header is explicitly registered
and includes actual inline-definition headers. No compiler warnings are disabled.

Same-build A/B: baseline preserves all focus rectangles. Candidate removes only
exact duplicates within one collection; it has no cross-call, URI or page cache.
Both use byte-identical HTML, with a named clip ancestor added to the existing
fixture. Every raw rectangle, phase and call must remain identical across A/B.
Existing wrapped fragments, adjacency and cross-page links must all survive the
strict one-to-one annotation contract. The C++ helper itself is compiled locally
against duplicate/distinct/adjacent/separate-call cases; this is not WebKit proof.

Clip gate: bind actual raw painting clip to the independent post-layout ancestor,
check source-defined device snapping arithmetic, then substitute only that
ancestor's proven paint clip. Preserve the original unsnapped-layout result and
do not change numeric tolerance. Positive, negative and A/B outcomes are separate.
Original Chinese/radical/digit PDFs remain checked, and U+0000 can still make the
overall run fail even if geometry passes.

Reuse exact baseline proof only through a commit-comparison whitelist that cannot
include product code, old engine patches or glyph bridge changes. One manual
continuation, existing 20-minute compile/link and 55-minute job limits, current
cache reusability/resource gates, private prefix and unchanged sandbox. No automatic
follow-up dispatch. Build or native failure is retained, not hidden or retried here.

## Delivery is still separate

Preferred maintainable route: upstream fixes and official distro backports, then
validate the official runtime version through this matrix and keep Milkup linked
to distro-managed WebKitGTK/JavaScriptCore. Verify each supported distro security
update (codepoints, intentional radicals/digits, pagination, URI geometry, sandbox)
without LD_LIBRARY_PATH overrides in the product. This preserves normal security
updates rather than pinning a research binary. No such upstream/distro acceptance
is claimed here.

A downstream runtime would require a named security maintainer, reproducible
source/build provenance and SBOM, timely upstream security patch rebuilds,
multi-distro ABI/regression coverage and a supported signed distribution/update
path. None is configured or authorized by this research. Do not ship this private
prefix, replace system libraries, or declare PDF fidelity complete while the digit
mapping defect and broader link/transform scope remain unresolved.

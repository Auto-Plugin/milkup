# Independent print geometry and digit diagnosis (research only)

The 43624922086 failure and its PDFs remain immutable. No previous pass is inferred.
This candidate introduces a separate opt-in `geometry_research` profile, never an
ordinary-push workflow. It preserves the original verifier and adds no product dependency.

## Independent print-layout oracle

`prepare_layout_probe.py` binds the exact 2.52.6 PrintContext.cpp SHA and generates
an instrumentation patch. In `spoolPage`, after `begin` has set printing layout,
page computation and CTM/clip setup, before painting, it records `printing` and
`!needsLayout`, page rectangle, CTM, `RenderObject::absoluteQuads` and each ancestor
RenderBox rectangular overflow clip. It never reads the tested annotation method,
OutlinePainter focus-ring collection, PDF annotation values or screen DOM. It
never dispatches beforeprint or triggers an extra layout. Its only eligible input
has the fixed synthetic title, with the probe explicitly enabled in the isolated
process environment. Output is bounded (8 pages, 32 elements, 64 fragments, 32
ancestors); unknown/incomplete records fail closed. The controlled HTML bytes are
verified by the harness. This oracle is deliberately not a general arbitrary-HTML
geometry validator: only axis-aligned, non-rounded rectangular clipping and the
fixed fixture stylesheet are supported. An actual C++ build and native records
are still required; Python tests are not native evidence.

GTK's exact `startPage` records a picture in paper points; `endPrint` replays that
picture without another layout transform into a PDF page of the same size.
GraphicsContextSkia::getCTM returns the recording canvas matrix. Thus the native
matrix maps absolute layout fragments into top-left paper points; PDF rectangles
are separately converted from bottom-left using MediaBox height, with Rotate=0
required. No font metrics enter the oracle. Numerical tolerance is derived from
two LayoutUnit edge quantizations plus a stated bounded float32 operation budget,
not from the observed prior 10-point difference.

Fixtures require two immediately adjacent links, explicit wrapped lines with a
neighbor inside the old bounding union but outside every actual fragment, a
rectangle cropped on both axes, and a single linked run crossing pages. Native
layout must prove these properties; otherwise the fixture cannot pass by missing
the condition. The no-anchor control retains identical IDs/styles/layout and must
have zero annotations. Tests reject missing pages/end markers, false printing or
pending layout, missing/duplicate elements, wrong target/page, whole-page bounds,
unioned fragments, absent clips and unsupported transforms. Source/token fidelity
is separate and remains required even if geometry passes.

Exact source shows OutlinePainter unions focus-ring rectangles before calling
setURLForRect. The additional research-only `0002-research-fragment-uri-regions.patch`
keeps URI fragments separate on Skia, leaving the internal-destination path and
other backends unchanged. This is a candidate fix for the static union counterexample,
not a claimed native pass. The independent oracle must test its output.

## Source -> shaping -> glyph -> PDF

`check_digit_chain.py` runs real local HarfBuzz, compiles the existing
ScalarGlyphText algorithm with those actual results, and correlates the retained
system/private positive/negative PDFs. Local Noto Sans CJK SC face 2, version 2.004,
SHA b76b0433203017ca80401b2ee0dd69350349871c4b19d504c34dbdd80541690a:

- ASCII source `0..9` has nominal glyphs 17..26.
- English `locl=1` applies GSUB lookup 42, producing glyphs 63153..63162.
  These glyphs have no reverse cmap. `locl=0` is only a diagnostic control.
- Chinese/Japanese language controls retain nominal glyphs in these samples.
- The actual current C++ metadata guard rejects the English substituted run;
  five other tested language/feature cases are accepted.
- All four retained PDFs encode exactly these ten glyph IDs as /gF6B1../gF6BA
  with ToUnicode U+0000. This is present in the system baseline too.
- Skia's exact PDF source can populate an extended cmap for a one-glyph cluster
  with source text and no nominal Unicode, but only when `c.fUtf8Text` exists.

This is a reproducible mechanism, not a recorded CI shaping trace: the original
CI font file/hash, run locale, offsets, bridge decision and Skia text payload were
not captured. The glyph ID match alone cannot prove all those internal events.
No glyph heuristic, global character replacement, GSUB disabling or relaxed
nominal guard is applied. A future source-aware substitution bridge must preserve
actual cluster/source identity, ligature/reordering exclusions and per-font
partitioning; Chinese/radical success does not close the digit defect.

## Bounded native decision

As checked, no equivalent task is running. Cache 10530265169 from 43624922086
exists (435274825 bytes), with the older proven cache retained as fallback. Metadata
is not a hit: the exact-SHA preflight must prove first-object hits before the one
engine continuation. The geometry build is capped at 20 minutes and its job at
55 minutes; it stops rather than falling back to a long uncached build. The normal
system baseline remains part of cheap preflight. The engine run prints only the
two geometry controls plus the original two text controls in the private prefix.
It does not install Milkup, change system WebKit/sandbox or rerun installation,
IME, update or other acceptance matrices. Known missing digits remain a failing
text gate; successful geometry would not make overall fidelity green.

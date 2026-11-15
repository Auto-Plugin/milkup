# Independent ASCII digit research delta

This is not a product dependency or a release fix. No system runtime changes.
The completed paint A/B run 43668937059 remains the original failing baseline;
its duplicate/clip diagnosis is retained, not rerun as a new hypothesis.

## Evidence and contract

Local HarfBuzz 10.2.0 with Noto Sans CJK SC face 2, font SHA-256
`b76b0433203017ca80401b2ee0dd69350349871c4b19d504c34dbdd80541690a`,
shapes English digits nominal 17–26 to locl glyphs 63153–63162. Original
retained PDFs map these glyphs to U+0000. The old nominal-only helper rejects
the span. This correlation is not itself a recording of the original CI shaper.

The research delta changes only FontCascade.cpp after the existing scalar
patch. The shared ScalarGlyphText header and its nominal-only default remain
byte-identical. An internal helper permits an actual non-nominal glyph only
for a source ASCII digit with a valid nominal glyph. It then uses the existing
whole-span validation: every UTF-16 scalar exactly once, exactly one actual
glyph per scalar, increasing source offsets, no missing or repeated cluster,
no synthetic/deleted glyph, no partial surrogate. FontCascade still requires
LTR TextRun, horizontal font, checked source offsets and bounded complete span.
The new exception additionally requires the **entire TextRun** (`from == 0`,
`to == length`), so a partial selection cutting a multi-scalar digit ligature
cannot masquerade as an independent cluster. Partial runs retain nominal-only
behavior, even if that leaves a digit fidelity gap there.
It does not replace glyphs/advances/fonts, normalize characters, guess source
from a reverse cmap, disable locl, or permit arbitrary GSUB substitution.

Actual HarfBuzz cluster indices enter ComplexTextRun in
ComplexTextControllerHarfBuzz.cpp and are passed to GlyphBuffer by
ComplexTextController.cpp. The new proof applies to this actual stream, not
an array rebuilt from text character positions. The native trace records the
stream separately; acceptance requires the real digit source and glyph IDs.

The local nine shaping cases compile the exact helper. English digits become
eligible; Chinese-locale digits and intentional Chinese/radical aliases remain
eligible. Synthetic two-digits-to-one-uncoded-glyph aliases preserve distinct
original source bytes. Ligature, composition, repeated combining cluster,
Arabic RTL and Indic reordered cluster remain rejected. Malformed/gapped/
reordered offsets, invalid/missing glyphs and substitutions of non-ASCII digits
remain rejected. The existing 128 font partitions and 16 invalid cases pass.
These tests do not claim correct extraction of unsupported complex clusters.

SkPDFDevice.cpp already checks a glyph's Unicode mapping, adds an unmapped
single-glyph cluster to the extended map, and uses per-occurrence ActualText
when the same glyph's mapping conflicts. The native gate must prove this
behavior with the synthetic 1212 font; source metadata alone cannot prove it.

## One bounded native continuation

No equivalent run was active at preparation. Compiler cache from 43668937059
was listed at 439,788,023 bytes. Inherited original geometry gate remains bound
to 43660565818, but does **not** certify the new delta. Before the full cached
build, compile only the actual configured FontCascade TU using generated
headers, original compiler arguments, CCACHE_DISABLE=1, strict warnings and a
180-second object deadline. Header generation plan rejects unrelated compiler
or linker commands. Failure stops before full build.

One explicit digit workflow runs only after cheap tests, patch application and
cache proof. Original job/time/memory/disk/sandbox limits remain. The private
runtime maps must be proven in host and owned WebProcess, with final hashes and
unchanged system libraries. No application installation matrix is selected.

The digit A/B uses the same runtime with an explicit research-only nominal
control. The identical embedded collision font/HTML is hashed; native trace
must show baseline rejection and candidate acceptance for exact single-digit
clusters. Candidate must extract/search all ten digits and 1212 and emit
ActualText for conflicting glyph occurrences. The negative page's extracted
text must stay identical; both pages must render to identical 72-dpi pixels.
This is an invariant check, not a claim of general RTL/ligature PDF fidelity.

Only candidate geometry is rechecked with the existing independent actual
paint-clip oracle. Original linked/unlinked Chinese, intentional radicals,
multipage and WRAP digit token contracts must all pass independently. No old
duplicate A/B rerun, geometry tolerance change or replacement PDF text allowed.
Raw source/font/trace/PDF evidence is retained even on failure.

## Delivery boundary

A successful private probe would still need upstream/distro review, regression
coverage across fonts/backends and maintained distribution security updates.
Preferred delivery is an upstream fix backported by the distro; an independently
shipped engine would require ongoing security rebuild/ABI/dependency ownership.
No proposal is sent upstream and no private prefix becomes a product dependency
in this task. GUI clipboard, physical print and production packaging remain
separate evidence requirements.

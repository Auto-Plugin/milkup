# Research-only original-text transport for WebKitGTK 2.52.6

**Not an installable fix. No patched WebKit library has been compiled or executed.**
The installed Milkup candidate still fails exact Unicode PDF acceptance. The actual
Ubuntu 26.04 run uses the unchanged system WebKit and the same verified b877 DEB.

## Evidence and selected mechanism

[Installed counterexample run 43560107745](https://github.com/Auto-Plugin/milkup/actions/runs/43560107745)
puts the original characters and real radicals next to each other in the same
font, bold font, a NotoColorEmoji fallback span, a wrapped paragraph and a later
page. Both paper settings fail all six exact-Unicode cases. The PDFs contain
adjacent identical text codes in the same font (`9292`, `aaaa`, `8080`, `2727`)
for the original/radical pairs. Replacing the entire ToUnicode mapping therefore
cannot recover both source characters. Negative controls explicitly reject a
radical-to-ideograph global substitution. No such substitution is used in output.

The exact upstream source chain is:

1. [FontCascade::drawText / drawGlyphBuffer](https://raw.githubusercontent.com/WebKit/WebKit/webkitgtk-2.52.6/Source/WebCore/platform/graphics/FontCascade.cpp)
   has the original TextRun and source offsets, but drops that information before
   dispatching font-separated glyph spans.
2. [Font::buildTextBlob](https://raw.githubusercontent.com/WebKit/WebKit/webkitgtk-2.52.6/Source/WebCore/platform/graphics/skia/FontSkia.cpp)
   allocates glyph/position-only Skia runs.
3. [SkPDFDevice](https://raw.githubusercontent.com/WebKit/WebKit/webkitgtk-2.52.6/Source/ThirdParty/skia/src/pdf/SkPDFDevice.cpp)
   already supports per-cluster ActualText when supplied original UTF-8 and cluster
   offsets disagree with a glyph's reverse font mapping. Without source text it
   cannot distinguish the two original characters sharing a glyph.

The review patch retains original text before font splitting and supplies it to
that existing mechanism. It does not rewrite Unicode characters, fonts, glyph IDs,
advances, layout, link annotations, pagination or the output PDF after generation.
It does not introduce Chromium, hidden text overlays, rasterization, extra font
installation in the product, script permission changes or sandbox changes.

A font-only workaround was not selected: changing a shared glyph's reverse mapping
breaks genuine radicals; changing font families changes metrics/fallback and still
provides no general original-character provenance. A PDF-only replacement has the
same ambiguity demonstrated by the retained adjacent same-code counterexamples.

## Implemented narrow prototype

`0002-research-only-scalar-source-to-skia.patch` changes 12 verified upstream files
and adds the standalone `ScalarGlyphText.h`. It is based on upstream tag
`webkitgtk-2.52.6`, **not a claim to include Ubuntu's complete downstream source and
build configuration**.

- The producer accepts only a complete LTR sequence with one Unicode scalar per
  unchanged nominal glyph, using actual source offsets and each glyph's font.
- It rejects missing/deleted glyphs, mismatched nominal glyph IDs, repeated or
  reordered offsets, ligatures, incomplete source coverage, surrogate splits and
  oversized metadata. This deliberately leaves complex-script cases unsupported.
- Text is owned, unnormalized UTF-8. Each fallback font span gets its exact source
  slice and rebased byte offsets, rather than the remaining text of the full line.
- Local Normal display-list items own the metadata. Local TextBlob items copy it
  into the Skia blob when recorded. Direct GraphicsContextSkia also handles it.
- Skia's existing text-aware allocation and per-cluster PDF handling are used;
  the original glyph position computation is retained.

**Unsupported contexts retain the old glyph-only behavior.** This is explicitly
not a complete repair: remote/GPU IPC and decomposed effects are not covered;
RTL/bidi, ligatures, text transforms, missing-glyph cases, vertical text and all SVG/
canvas entry points still require engine-level coverage. The ordinary nominal-glyph
validation may also reject runs in real WebKit that the standalone tests cannot
observe. No quality claim is made for those paths. Metadata slicing currently
revalidates the source packet per span; pathological fallback fragmentation needs
performance review before production use.

## Actual validation

- Compiled `scalar-glyph-text-test.cpp` with C++20, warnings-as-errors, ASan and
  UBSan. It passed all 128 font-partition combinations of the four alias pairs,
  supplementary-plane and owned-lifetime checks, plus 16 invalid-input cases.
- This executes the exact new metadata implementation, not a separately rewritten
  model. **It does not compile FontCascade, WebCore, Skia or the browser.**
- All 12 upstream input hashes were verified. The complete patch applied and
  reversed cleanly, restoring every original byte (`patch-validation.json`).
- Real Ubuntu 26.04 installed tests preserved the failure: run 43560107745,
  harness 940d4a03, unchanged b877 application and package. GUI save/reopen/normal
  close passed, PDF A4 6 pages and Letter landscape 8 pages retained all 100 body
  markers. All six Unicode cases failed in both outputs.
- The wrapped Letter marker itself split across a line. The raw harness reports
  `actual=null` for that one case; independent offline review locates markers after
  removing only ASCII layout whitespace and confirms the same Unicode failure.
  The harness parser has been corrected for future runs; no new native run is
  claimed for that parser-only correction.
- Both baseline PDFs have zero link annotations despite the source hyperlink.
  Therefore link preservation is an additional open baseline issue, not a passed
  invariant. Source inspection finds the base `setURLForRect` no-op with no Skia
  override in the inspected version; this is a lead, not an executed link repair.

## Build and distribution blocker

The original local workspace has only about 6–7 GiB free and is not a suitable
full-engine build host. This limit does **not** describe the isolated Ubuntu 26.04
Actions runner. [Capability run 43561448307](https://github.com/Auto-Plugin/milkup/actions/runs/43561448307)
obtained complete official Ubuntu source `2.52.6-0ubuntu0.26.04.1`, validated all
archive SHA-256 values against authenticated APT metadata, extracted 418,378,881
bytes / 34,435 files, and applied this patch cleanly. Its official build-dependency
simulation resolves 217 installs with no removals or WebKit runtime replacement.
The runner has 4 CPUs, 16,366,640 kB total RAM, 3 GiB swap and 90,928,648,192 bytes
free after source extraction. These are measured prerequisites, not proof that a
complete build fits.

[Build run 43561713531](https://github.com/Auto-Plugin/milkup/actions/runs/43561713531)
uses harness `de2b69c4`, normal-user compilation, the distro GTK3/Clang/hardening
configuration, sandbox enabled and an isolated install prefix. It stops its own
compile process group at 150 minutes, free disk below 4 GiB, or available memory
below 512 MiB for about 60 seconds. It does not install modified system libraries.
At the time this note was written the build was still running: no compiled engine
or actual patched-engine PDF result is claimed. Resource/time recommendations must
be refined from the retained build result rather than treating these limits as a
proven minimum specification.

The next workflow revision prepares the exact previously tested b877 application
DEB and records actual main/output-helper `/proc/PID/maps`, process birth, private
runtime inode/hash and unchanged system-library hashes before accepting PDF output.
It retains original/radical pairs, fallback, wrapping, two paper settings and text
search/extraction evidence. That preparation has only local harness checks so far.

The patch adds an internal virtual method and owned display-list state. A complete,
matching WebKit/WebProcess/GPU build is required; installing a single object or
preloading guessed internal symbols would not be a valid deployment. Private
runtime loading, security updates, downstream patch compatibility, ABI/IPC and
package size have not been verified. System WebKit was not modified.

The next executable gate requires an isolated full matching build, staged in a
private prefix with its exact runtime identity verified, followed by the same
installed-app counterexamples and visual/page/link/search checks. The source patch
must not be shipped as a proven fix or installed over the system library. The
original DEB and baseline failing PDFs remain intact.

## Reproduce the completed local checks

```sh
c++ -std=c++20 -Wall -Wextra -Werror -fsanitize=address,undefined \
  -fno-omit-frame-pointer scalar-glyph-text-test.cpp -o /tmp/scalar-glyph-text-test
/tmp/scalar-glyph-text-test
```

`build-review-patch.py UPSTREAM_SNAPSHOT_DIR NEW_OUTPUT_DIR` regenerates the patch
from the listed original files and local header. Use the manifest to verify inputs
before execution. It creates a separate temporary Git checkout, never edits system
libraries, and does not build or run WebKit.

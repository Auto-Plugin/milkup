# Offline diagnosis of run 43624922086

Run: https://github.com/Auto-Plugin/milkup/actions/runs/43624922086
Actual tested SHA: `44b43d47ce0744616310a0a5588d8d4136cd4909`.
The completed read-only monitor was checked first; no equivalent active CI or
local monitor was found. This analysis dispatched no new CI and changed no engine,
system runtime, sandbox setting or product package.

Original artifact 14126200714 is 928856 bytes, ZIP SHA-256
`4c49f475e8b59903a8868516bcb6f8fbf0da1ac8f2ffe0536eb1ff5aaeafe332`.
Download length, digest, safe paths and CRC were checked. Original files are
unchanged. `offline-audit-43624922086.json` is a separate diagnostic, explicitly
not an acceptance report. `audit_existing.py` reproduces its checks from these
PDFs and the system baseline in preflight 43624541999.

## What actually ran

Private engine compilation exited 0 in 360.151 seconds. Both native prints exited
0 (3.104 and 0.543 seconds). Main and actual WebKitWebProcess mappings were recorded
for each print, with process birth ticks, and bound to the private library hashes:

- WebKit: `2ad0c5686500cb3978fa493ed116904b3a1f639e2e51c7a62fbccfbd226e280d`
- JavaScriptCore: `0780da5c018100ca0a8e342c9ee3f8eb993db28a2855938efc90e602b72c7a2a`

System library hashes matched before/after the build. Installed application steps
were deliberately unselected. The PDF assertion subsequently failed. Its exception
also skipped the final private-library hash recheck: no post-print immutability
proof may be invented from the earlier mappings. The harness now puts this check
in its finalization path; local tests require failure on changed/missing files and
verify the actual function is called in `finally`. This correction is not a new
native result and does not turn the old run green.

## First failure is an invalid geometric proxy, not a proved misplaced annotation

All pages have MediaBox/CropBox `[0,0,595,842]`, rotation 0. PDF content starts with
the expected vertical flip, and the observed paint CTM scales by 0.9033013. The
offline content-stream interpreter independently transforms painted blue underline
rectangles. These and an annotation-disabled raster inspection place the clickable
rectangles at the corresponding painted links. No PDF was rewritten or rasterized
as a replacement output.

Coordinates below are PDF points from the top-left, `[left,top,right,bottom]`.
URI targets are preserved exactly in the JSON audit.

| Page/target | Annotation | Poppler word-box union | Independent element layout |
| --- | --- | --- | --- |
| 1 `/one?x=1&y=2` | `[7.226,152.545,69.230,174.224]` | `[7.226,142.360,69.619,179.938]` | Not captured |
| 1 `/%E4%B8%AD%E6%96%87#target` | `[7.226,188.677,71.883,210.356]` | `[7.226,178.492,71.773,216.070]` | Not captured |
| 2 `/wrapped` | `[7.226,80.281,182.283,232.036]` | `[7.226,70.096,166.150,237.749]` (digits missing) | Not captured |
| 3 `/last` | `[34.325,166.094,101.791,187.774]` | `[34.325,155.910,101.423,193.487]` | Not captured |

The first annotation is 10.185 points below the word box at the top and 5.713
points above it at the bottom. The same offsets repeat for the other links;
Poppler's word box is 37.577 points tall for the one-line text, whereas the visible
glyph ink is only about 11 points tall. Comparing word/font boxes to element click
boxes edge-by-edge is not a sound definition of correctness. The source confirms
`OutlinePainter::addPDFURLAnnotationForLink` uses the union of renderer focus-ring
rects; it does not use a PDF extractor's font boxes. Skia then applies transforms
and clipping. No larger tolerance has been substituted for missing layout proof.

Independent underline paint examples:

- `/one`: `[7.226,170.724,69.554,171.627]`
- second page-1 link: `[7.226,206.856,72.264,207.759]`
- `/wrapped`: seven line underlines, first
  `[7.226,98.460,182.467,99.363]`, last
  `[7.226,228.535,122.849,229.439]`
- translated `/last`: `[34.325,184.273,102.073,185.177]`

Paint is independent evidence of placement, **not** a substitute for a captured
element layout box. The current four URI/page pairs are exact, rectangles are
bounded, and the two page-1 targets are disjoint and correspond to their own ink.
This excludes a gross whole-page, wrong-page, wrong-target or swapped adjacent-link
result in this fixture. It does not prove exact click boundaries, wrapped-link
neighbor exclusion, overflow clipping or internal PDF destinations. No independent
print-time element boxes or explicit overflow-clip fixture exist in this artifact.

## Checks hidden by the first assertion

These were rerun separately on the same original positive and negative PDFs:

- Three pages and each page marker: pass for both.
- Exact URI/page set: four expected pairs for positive; zero for negative.
- Chinese sentence twice and intentional original-character/radical sequence
  twice: pass for both.
- Original no-link/Unicode contract: pass independently.
- Positive/negative extracted text and word boxes: identical. Raster comparisons
  with annotation painting disabled also match pixel-for-pixel on all three pages
  at 2x, supporting unchanged visible content, not a new layout acceptance.
- **Full link text: fail for both.** All twenty `WRAP00` through `WRAP19` tokens
  lose the digit suffix in Poppler extraction. pypdf returns NUL characters and
  another independent reader returns different fallback characters. The glyphs
  visibly draw as digits, but their ten ToUnicode entries map to `U+0000`.
- System baseline has the same digit loss and ten null mappings, so this is not
  introduced by the URI patch. It is an unresolved text-mapping limitation.
  The research scalar-text path intentionally rejects non-nominal/reordered
  mappings; exact shaping/fallback causality still needs source-to-glyph evidence.
  Do not remove that guard or replace extracted characters by heuristic.

PDF identities:

- Positive, 61442 bytes:
  `87670018b8c1c0e2d40263eaa85c5957e60669b4b3547e7e7de412da3179fee3`
- Negative, 60535 bytes:
  `d4de4d979fcd19b55260689214ba0e256f029afe782b58b301e3398e80cc433e`

Local Poppler differs from the runner only by three page-separator newline bytes
in the stored text comparison; annotation/word geometry and original PDF hashes
agree. Reader/version differences are retained, not normalized into an acceptance.

## Minimum next gate, not dispatched

1. Keep the original fixture and failures. Capture bounded, identified
   **print-layout** fragment boxes independently from the annotation adapter,
   after printing layout has completed, with HTML hash, element ID/URI, page rect,
   transform and effective clip. `beforeprint` alone is insufficient: matched
   `WebPage::beginPrinting` dispatches that event before `PrintContext::begin`
   performs synchronous print layout. Do not claim screen bounds are print bounds.
2. Define the expected rectangle from those fragments and clips, and compare using
   justified layout-unit/float conversion error, not a larger empirical 7-point
   threshold. Add a wrapped link beside another link and an explicit clipped-link
   case; reject wrong URI/page, whole-page rectangles, neighbor overlap, missing or
   extra annotations and bad transforms. Missing layout evidence must fail closed.
3. Preserve a separate all-source-token and ToUnicode gate, including the failing
   digits. Independent evidence is needed before widening the scalar mapping
   research patch. Chinese success does not cover this loss.
4. After local contract/preflight checks, only a narrow private-engine run is needed
   to validate new capture/fixes. Do not reinstall Milkup or repeat accepted IME,
   update, package or full GUI matrices. Original linked libraries were not retained
   by the prior workflow, so an existing PDF can answer the above offline questions
   but cannot supply new DOM measurements.

No new CI has been dispatched for this diagnosis. The URI bridge remains research;
the product-delivery/security-update boundary in README.md is unchanged.

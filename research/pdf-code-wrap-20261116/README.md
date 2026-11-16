# Code wrapping and real line-number alignment — preparation only

No product change, native export, workflow dispatch or active-build polling was performed. This is an independent next-same-package case, not a replacement for any existing fixture or threshold.

## What is and is not already covered

Larry's [historical comment on #117](https://github.com/Auto-Plugin/milkup/issues/117#issuecomment-3673366024) describes forced PDF code wrapping without moving subsequent line numbers. It does not prove a v2 defect.

The installed `58c78973` report for run `43688690760` checked 100 **short** code lines (`CAA HAMBURGEFONS ENDCAA`, etc.), content/order and independent rendered guards. Later pagination fixtures retained those rows. No forced multi-visual-line code plus separate gutter-baseline contract was found in the reviewed reports. `a30cc640` prepares the final-prefix installation boundary and daily entry; it explicitly leaves same-package PDF acceptance as a separate step.

Reviewed integration `546796b005390642ee5cc655440b4b350a730717` serializes ordinary code to `<pre><code>` in `packages/export/src/static-html.ts:398` and `markdown-html.ts:83`. Its export CSS uses `white-space:pre-wrap; overflow-wrap:anywhere; word-break:break-all`. No code line-number gutter emitter or switch was found in these product/plugin output paths. The test called “preserves ... line numbers” in `output-presentations.test.ts` checks request `fromLine`, not visual code numbering. File hashes are in `review.json`.

Therefore:

- Code wrapping/pagination is ready for a new installed native PDF observation.
- Real automatic line-number alignment is **not exercised** if the actual candidate still does not emit line numbers. Do not add numbers to source or inject a gutter/CSS and call that product acceptance.
- The absence of this feature is not evidence that the historical defect recurs, nor a claim that it was fixed.

## Fixture and independent contract

`fixture/code-wrap.md` is 5,898 bytes: one ordinary text code fence, 50 source lines, two initial short controls, then 24 long/short pairs. Every long source line has 24 unique eight-letter tokens; tokens are literal source content, **not line numbers**. No HTML, manual `<br>`, page break, renderer hook, modified CSS or engine switch is used.

The actual export must automatically wrap each long line into at least two visual rows and span at least two pages. The checker uses actual PDF character origins (baselines), not word-box top approximations. It requires:

- exact complete searchable source characters and reading order, with no missing/duplicated/substituted tokens;
- monotonic within-row and across-row positions;
- the next source line below the final visual row, using the independently measured short-control line advance;
- at least one actual page transition within the code block;
- every character inside its page rectangle;
- when real product numbering exists, exactly one searchable number per source line, left of the code and within **0.5 PDF points** of its first baseline, including the short line after wrapped code.

All page character coordinates and 144 dpi page images are retained. Page-bound containment alone cannot prove absence of internal glyph clipping. Native page images must be independently reviewed against those coordinates and the complete source; retain that review and any clipping failure. Images never replace the PDF content checks. The report always starts as `pending-native-provenance-and-raster-review`, with `installedNativeAcceptance:false`; a zero CLI exit only means these automated checks passed.

## Next existing same-package native PDF run (do not launch separately)

Use the existing final-prefix/package/process/sandbox gates and the normal application export UI. Open the exact Markdown fixture and export A4 portrait without changing product CSS/font size to make it pass. Preserve source SHA before/after, original PDF, actual app/package/runtime identity and normal close evidence. Keep existing A4/Letter and text/link/pagination tests unchanged. No extra build is needed solely for this case.

```sh
python3 -c 'import fitz; print(fitz.VersionBind)'
python3 research/pdf-code-wrap-20261116/gate.py audit \
  "$NATIVE_PDF" research/pdf-code-wrap-20261116/fixture/expectations.json \
  "$NEW_EVIDENCE_DIR" --line-number-mode required --provenance "$NATIVE_RECEIPT"
```

The receipt must accompany the existing independently verified app/package SHA, candidate, actual runtime mapping, source/document SHA, export settings and normal-close evidence. This small audit stores provenance but does not replace their verification. Existing output directories are rejected so earlier failures cannot be overwritten.

If source review and the actual exported document confirm **no line-number emitter**, use explicit `--line-number-mode absent` for the separate code-content/wrap check. It reports `not-exercised-no-product-line-number-emitter`; never promote this to a line-number pass. If any numbering is present, use `required`; misaligned/missing/duplicated numbering fails. Do not silently change modes after a failed numbered test.

## Local validation and limits

`python3 -m unittest discover -s research/pdf-code-wrap-20261116 -v`: **6 passed**. Controls cover historical stationary numbers, absent gutter, missing/duplicate/reordered text, off-page clipping, altered baselines/x-order, absent wrapping/page transition. A real PDF parser/raster roundtrip uses a clearly labelled **synthetic PyMuPDF-created 3-page PDF**, preserved under `synthetic-evidence/`; this is not Milkup/WebKit output. No native result or v2 defect is inferred.

No current CI was queried or changed. No product, main, production channel, security, notification or publishing settings changed.

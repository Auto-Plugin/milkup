# Print-file04 actual output review

**FAIL: rich diagram rendering and full-page equivalence.** Actual GTK print-to-file produced a seven-page PDF, but Mermaid became fenced source fallback on page 2. The PDF has an explicit renderer warning on page 7. PDF05 A4 contains the rendered diagram. Only page 1 is pixel-identical; pages 2–7 differ at 1250px longest edge. The original comparison assertion fails and `run.exit=1` is retained.

Both PDFs have exactly one occurrence of each P5-PAGE-1…100 marker and all four core markers; source hashes match. All seven printed pages were visually inspected: no observed body clipping/overlap, mathematics and footnote reference/body/return-link text remain readable. The PDF source fallback is not successful rich diagram output. No physical printer was tested.

Exact Poppler and MuPDF extraction retains the existing FAIL for Chinese diagram labels, source code quotation marks and emoji. No Unicode normalization was used to improve those results.

`renderer-observed-failure.json` preserves the actual sequence: render_1 deadline after 2000.313 ms; the UI notice says milkup.diagrams timed out, with the final registry failed/disabled. No native-errors.json was produced and the inspected logs do not contain explicit render_1037. The deeper timeout cause is unproven. `BadWindow` remains in the original harness log despite successful UI completion. Existing P4 renderer reliability remains open; no diagram implementation change or retry was performed.

`comparison.json` contains both PDF hashes, page dimensions, all marker counts and every page's exact decoded RGB comparison. `printed/page-2.png`, `printed/page-7.png` and `exported/page-2.png` show the decisive visual evidence. Original PDFs and producer-run artifacts are curated separately by the parent; this directory does not duplicate them.

Replay `compare.py` in the original external evidence directory to regenerate all 14 page rasters and extraction. The script intentionally exits nonzero when equivalence fails. `verify-index.py` checks this compact archive.

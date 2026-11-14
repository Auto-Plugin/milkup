# Output content acceptance fixtures

These sources and expectations are independent of the output engine. Preserve Markdown bytes: combining forms, Unicode aliases, tabs and trailing code spaces are intentional. Each manifest records source SHA-256 values.

- `unicode-fidelity.md` is a real Markdown document for the normal plugin/UI route. `unicode-expectations.json` declares original codepoints and logical units, not engine glyph IDs. The source contains both ordinary CJK characters and visually similar Kangxi radicals.
- `pagination-cases.json` references nine frozen Markdown sources. An isolated boundary harness converts each source normally, then adds only the stated exterior filler and section page start. That controlled experiment is separate from normal GUI export acceptance.
- `oversized-cases.json` references three additional sources whose first real table row, logical code line or ordered-list item is taller than one page. All 120 internal chunk markers must survive. The frozen 950c native-helper test renders this extension with all markers retained; production GUI acceptance remains separate.

Run the independent assertions from the repository root after capturing the actual PDF:

```sh
python3 tests/native/p5-output-content-audit.py --kind unicode --pdf ACTUAL.pdf --output AUDIT.json --scope production
python3 tests/native/p5-output-content-audit.py --kind pagination --pdf ACTUAL.pdf --output AUDIT.json --scope production
python3 tests/native/p5-output-content-audit.py --kind pagination --manifest tests/fixtures/p5-output/acceptance/oversized-cases.json --pdf ACTUAL.pdf --output AUDIT.json --scope production
```

The checker requires Poppler `pdftotext`; Unicode comparison additionally requires PyMuPDF. It checks all expected markers and their page relation, without hardcoding engine page numbers. ASCII marker scanning uses Poppler raw reading order to avoid interleaving table columns. Global counts can join across pages after excluding only manifest-declared repeated table header labels; per-page heading/first-content checks use the original raw page streams. Unicode comparisons never use this marker-only whitespace/header handling. Use `--scope native-helper` for test-binary helper runs. Exit 1 means an assertion failed. Text passing does not replace actual page-pixel review or provenance: retain binary, source, input and output hashes plus the normal GUI/native run record.

Unicode reports keep Poppler raw, Poppler layout and MuPDF results separate. No NFC/NFKC, bidi reversal, glyph alias substitution or joiner removal is allowed. Whole-phrase equality and each logical unit's exact source-codepoint count are separate measurements. Code quote text must match exactly in raw and MuPDF output; Poppler layout's geometric spacing differences remain visible in its phrase result.

The current standalone Chromium experiment fixes the tested original CJK/quote/combining/ligature/emoji/SVG losses, but expanded Arabic logical extraction still fails. This remains a red assertion, not an expected-pass exception. Arabic glyph appearance and reading order require separate visual review. The experimental PDFs do not establish success of the integrated product backend.

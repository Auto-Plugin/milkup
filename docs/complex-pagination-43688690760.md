# Installed Linux complex pagination: a real orphan heading, not lost code

Run [43688690760](https://github.com/Auto-Plugin/milkup/actions/runs/43688690760)
finished **failure**. Keep that original result. Both actual application exports
and normal close succeeded; the independent pagination gate found an A4 table
heading orphan. The separate code-guard failures were a measurement error,
resolved offline using the same PDFs and original rasters, without a new CI run
or relaxed threshold. Overall PDF fidelity is still not accepted.

## Provenance and native flow

- QA SHA `e6fe7f6dd252e7b17acf3c5ed81d4d06b5d1811f`.
- Reused installed source `58c78973101acb0a22ca0cb5d24ef24bd9edc199`, product
  equivalent to integration `0e4e8c580353710db9b7f0ec4820522d305ec9fc`.
- Deb SHA-256 `9e71e2b6f6c5cd030f7307d35679ded1d4f5605127d77320db1d455d90c1ddde`;
  executable `42394c4bdcaeea078c7d553acbe6edc7a75f13b16ce5b70cba2d0a3a02176ed6`.
- Ubuntu 26.04, UID 1001, default sandbox, distribution WebKitGTK and
  JavaScriptCore `2.52.6-0ubuntu0.26.04.1`, Noto CJK
  `1:20240730+repack1-1build1`, Poppler `26.01.0-2ubuntu0.3`.
  Application `/proc` mappings identify system `/usr/lib` libraries.
- One fresh profile, synthetic Markdown SHA-256
  `a48d14baea38632464f88813009563508ffb7ae2a8c1822285bb7308d9ef0fcb`.
  Actual plugin controls and native chooser, no injected output HTML/CSS.
- One launch PID 5502 / birth 9291, WM_DELETE_WINDOW normal close with exact
  process disappearance; no forced cleanup. Source bytes unchanged. OS exit
  code was not collected. Own installation removed after the flow.
- No product rebuild, repeated installation matrix, private engine, queue,
  recovery or second native run. Local pagination preflight: 4 tests including
  missing/duplicate/clipped/off-page/split/order/orphan/blank/orientation negatives.

## Same-document results

| Check | A4 portrait | Letter landscape |
| --- | --- | --- |
| Pages / every page box in points | 8 / 595×842 | 11 / 792×612 |
| Unique markers exactly once | 386/386 | 386/386 |
| Table rows / code lines | 72/100 | 72/100 |
| Table pages | 2–5 | 2–7 |
| Code pages | 5–8 | 7–11 |
| Blank pages / off-page words | 0/0 | 0/0 |
| Row start/end same page/baseline and in order | passed | passed |
| Table heading and first row same page | **failed: title page 1, TAA page 2** | passed: page 2 |
| Independent rendered guards | 172, intact under bounded check | 172, intact under bounded check |

A4 PDF SHA-256:
`1985f3d22c1abddefb306f787dacbfe9ed2cb01ff0e7597c1a5b65ef782a4162`.
Letter PDF SHA-256:
`d87f35802e92fcd2d22b6e42dc6a3b51dec538089ee5683a90d0ff65b3c8a1b2`.

The A4 title visibly sits at the bottom of page 1, with table header/first row
starting page 2. This is confirmed by both Poppler coordinates and rendered
page bands. The current serializer wraps a title plus the **entire** table in
an avoid-break `heading-lead` element. For a many-page table that constraint
cannot be satisfied; the actual result does not keep the title with first data.
We have not proved every internal WebKit pagination decision from this output.

## Code-guard measurement correction

Original Poppler code word boxes were about 34.8 points high, versus about
21.76 points line advance. Cropping those boxes included ink from the previous
line: most interior samples had 50–51 pixel ink height, while the first line
had only its own 20 pixels. Comparing that contaminated median falsely marked
the first line as clipped.

`review-pagination-glyph-bounds.py` matches independent MuPDF font bounds to
the original word intervals, then crops the **unchanged Poppler 144 dpi raster**.
The independent bounds are about 14.26 points high for the A4 code font.
All 172 guards per PDF pass with the original two-pixel sampling threshold.
Missing guards and eight-pixel clipping negatives still reject for table/code,
width/height. This corrects the sampled region, not the acceptance tolerance.
The raw failed audit is unmodified. Page-edge composites contain an intentional
join between top and bottom bands; that montage seam is not a PDF clipping defect.

This establishes the stated rows/markers and sampled glyph integrity, not
pixel-perfect rendering of arbitrary characters. Full PDFs and all rendered
pages remain available for review.

## Product candidate, not yet native-accepted

Isolated branch `dot/export-table-caption-20261115`, candidate `d6a0dc18`, changes
only `packages/export/src/static-html.ts` and its tests. A heading immediately
before a real table becomes the table's single caption. It preserves one table,
one header, every original row, inline presentation/reference identities and
source order. It avoids asking the engine to keep an entire multi-page table
unbroken; other block grouping remains unchanged. No row splitting, source
truncation, repeated title or Unicode replacement.

All 76 export tests, export TypeScript check and formatting pass locally,
including a 120-row preservation test and existing safety/reference cases.
Candidate HTML for the exact captured source and both paper settings is saved.
**No candidate PDF or installed native validation has run.** The caption's
actual pagination behavior must be checked before integrating it or calling
the orphan-heading problem fixed. Integration remains `0e4e8c58`.

## Separate fidelity limitations

- Chinese source `中文春风又绿明月` is not extracted exactly in either PDF;
  the known ordinary-character/radical mapping issue remains. Intentional
  `⽂⾵⼜⽉` extracts exactly in this sample.
- `WRAP0123456789` happens to extract exactly here. This does not negate the
  previously isolated numeric ToUnicode defect with a different shaping context.
- The `LINKDIAGNOSTIC` text is present but both PDFs have zero URI annotations.
  Link support remains unaccepted on the default runtime.
- Complex scripts, ligatures, broad font fallback, oversized individual cells,
  manual viewer clipboard/search and physical printing are not covered.
- Private WebKit research fixes were neither loaded nor put into the package;
  normal maintainable distribution delivery is still a separate open issue.

## Evidence retention

Original artifact `14151117902`, 2,229,319 bytes, SHA-256
`0cde8e2e975995f2fd51480cf93aa8310925dcd3ae0ad2f68409910b5a180e71`,
expires **2026-11-22 07:11:26 UTC**. Archive digest, ZIP CRC, safe paths and
expanded-size bound checked. Temporary workspace:
`/workspace/milkup-pagination-evidence/43688690760/` contains original ZIP,
PDFs, source, raw failed audit, native result, screenshots, complete page rasters,
independent glyph/byte review, local test log and candidate HTML.
A private Library archive retains PDFs and text/HTML records with provenance;
browser screenshots are excluded. It is evidence retention, not a release.
No main merge, production configuration, notification or safety-policy changes.

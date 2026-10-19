# First-output readiness: actual artifact comparison

The P6 fresh-output artifacts preserve rendered footnotes on the first HTML, A4 PDF, Letter PDF and GTK Print to File output. The edited HTML also follows the saved new document revision. This is a targeted readiness/content result, not a claim that all PDF limitations or P6 lifecycle scenarios are complete.

Production binary SHA256: `58652f2cea9361b6ee562a65f7405259f2320f9ac170bf9598a798e58905789e`. The accepted runs below each have `completion.json` and their corresponding `runs/control/*-p6-command.json` reports exit 0. Editor preview may render before export: “fresh/cold output” means no harness export warmup, not proof of the renderer's first-ever invocation.

| Actual artifact | Content and visual result | Evidence |
| --- | --- | --- |
| P5 m06 product print first, 7 pages | Footnotes remained literal source; incomplete and footnote fallback warnings, five warnings total | [Old page 2](before-after/p5-first-page-2.png), [old page 7](before-after/p5-first-page-7.png) |
| P6 HTML02 first, document version 0 | Two MathML formulas, one diagram presentation (two nested SVG elements), PNG bytes preserved, numbered footnote and resolved forward/back anchors; 104 body markers exactly once | [Static report](p6-cold-html-02.html-review.json), [screen report](html02-screen/cold-first/review.json), [full overview](html02-screen/cold-first/whole-page.png), [footnote](html02-screen/cold-first/footnote-2.png) |
| P6 HTML02 edited R2, document version 1 | Saved source matches expected R2 bytes; updated Chinese diagram labels and P6R2 markers; no stale P5- marker, all 104 R2 body markers once | [R2 screen report](html02-screen/edited-r2/review.json), [full overview](html02-screen/edited-r2/whole-page.png), [updated diagram](html02-screen/edited-r2/diagram-1.png), [updated footnote](html02-screen/edited-r2/footnote-2.png) |
| P6 A4 first, 7 pages | Every existing page PNG viewed; diagram, math and numbered footnotes visible on page 2; body complete; two expected image warnings on page 7 | [PDF report](p6-cold-a4-01.pdf-review.json) |
| P6 Letter landscape first, 10 pages | Every existing page PNG viewed; diagram/math page 2, footnotes page 3, two expected image warnings grouped on page 10 | [PDF report](p6-cold-letter-01.pdf-review.json) |
| P6 Print02 first, 7 pages | Every existing page PNG viewed; all seven 794×1123 page images RGB-identical to new A4; numbered footnotes replace old source fallback | [PDF report](p6-cold-print-02.pdf-review.json), [new page 2](before-after/p6-first-page-2.png), [new page 7](before-after/p6-first-page-7.png) |

All accepted new artifacts contain only the two intended missing/remote-image warnings, with explicit placeholders. None contains the old incomplete/footnote-source warnings. PDF text checks find all 100 paragraph markers and four semantic markers exactly once. SVG geometry and actual visible Chinese nodes/arrows were examined; source-label matches alone were not treated as diagram success.

HTML's first footnote targets are `source-907` and `source-900`; R2 targets shift correctly to `source-911` and `source-904`. The offline browser clicked all four forward/back links and observed matching hashes. Both HTML files have no duplicate IDs, unsafe elements, event attributes or source fallback in the independent static audit.

## Artifact identity

The P5 and new first-output fixture source SHA256 is `8b4f460fb664ce9b2ef92314dd284404eb4bdfeb28578a34d6dfa08a608454a7`. R2's saved source SHA256 is `0c5fb591b1dbf492e735f9d158d1f76eed16f6dd71ea1f6c5831bb0d4ea78d16`; the actual document version changes from 0 to 1.

| File | SHA256 |
| --- | --- |
| P5 first print PDF | `0aa743eb069b663918296f6502456f6627d282617603e260b7aa4757cc010871` |
| P6 first HTML | `82c8f7bce5dc8a3e4b79eb9c7c98224c0a81091c98dcb5bcbc1f56367be7320d` |
| P6 R2 HTML | `200780d4de1dcd36785c621ca895a0e4c340ff18ba3d7c101846740fbe91bd44` |
| P6 A4 PDF | `e4f952a6eaae328dc16fe13983a8f64ebbb34f3c94f6551cb045a771b7766e78` |
| P6 Letter PDF | `57f4aad2dcf7c0431977070a17fb46e00f537d4ea7e89a49b10f412ef34e7260` |
| P6 Print02 PDF | `c7a5419340d70aeb1de2bcc63464f942686c8d211e25d0b8163083add389ff14` |

## Review method and retained boundaries

[Static HTML parser](review-html.py) and [PDF parser](review-pdf.py) inspect the actual native-produced files. PDF review uses existing harness PNGs without re-rendering. [Offline browser script](view-html.cjs) uses installed Chromium **154.0.8037.57**, sandbox enabled, JavaScript disabled, offline context, blocked external requests and original UTF-8 HTML through `setContent`. Requests and blocked-request arrays are both empty. Chromium is only an artifact viewer, not a product dependency or PDF backend. This does not test direct `file://` navigation policy. The browser exited 0 and closed; [log](html02-screen.log), [exit](html02-screen.exit).

Both full HTML images were inspected as scaled overviews. Every separate diagram, inline/display formula, reference/definition footnote, PNG and warning crop was viewed at displayed native detail. This is not a per-character full-length visual inspection. No clipping or overlap was observed in the inspected rich-content crops. All 24 PDF page PNGs were individually viewed.

**Still failed / not established:** Exact original Unicode copying/searching fails in both Poppler and MuPDF probes, with no normalization used to hide changes. All three new PDFs contain zero link annotations according to MuPDF, so visible footnote references are not claimed to be clickable PDF links (the prior PDF05 also had none). Existing oversized table/code/list title-pagination failures remain outside this fixture and are not fixed by this readiness change. Letter's warnings occupy page 10. GTK Print to File was tested; physical printing was not.

## Failed harness runs retained

- [HTML01 diagnostic](p6-cold-html-01.html-review.json): exit 1, no completion. Harness counted `P5-FOOTNOTE-MARKER` twice in raw HTML because the accessible label also contains it; actual body text has one. The diagnostic is not acceptance. HTML02 succeeds after the harness body-text counting correction.
- [Print01 diagnostic](p6-cold-print-01.failure-review.json): exit 1, no PDF. `xdotool` window enumeration raised `BadWindow` while the chooser was destroyed. Root's harness correction treats this observer condition as false and continues the existing bounded retry; it does not treat it as successful close. Print02 is the separate accepted retry. No unobserved product cause is inferred.

The intermediate [readiness implementation index](../../readiness/README.md) remains historical and unchanged. Public footnotes 1.0.1 package SHA256 `cf495f6bdf22dc6b24143a06fc34fdce8d2b2ecab90b8296b85fb49773b692a2` and SDK 0.3.6 proof remain in [independent package evidence](../../footnotes-external/proof.json). This review adds actual output evidence without changing product code or original failure artifacts.

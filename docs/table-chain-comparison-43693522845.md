# Final bounded table-chain comparison: rejected

Run [43693522845](https://github.com/Auto-Plugin/milkup/actions/runs/43693522845) executed QA `167b73e83fb102a7daebeeb2bb2f797be872adde` and ended **failure**, `chain-mechanism-failed`. All eight baseline/candidate cases ran, plus the ruler. No application build, installation matrix, product change or subsequent dispatch was performed. Stop this experiment: no tested scheme meets all boundaries, so there is no product diff to integrate.

## Exact inputs and preflight

Reused the unchanged `58c78973101acb0a22ca0cb5d24ef24bd9edc199` package, deb SHA-256 `9e71e2b6f6c5cd030f7307d35679ded1d4f5605127d77320db1d455d90c1ddde`, executable `42394c4bdcaeea078c7d553acbe6edc7a75f13b16ce5b70cba2d0a3a02176ed6`, embedded guard `296131695cb15814252edd02e76e111fef293b7585c4e7597101d8ec05b852fa`. The exact native helper retains GTK 12 mm margins, its loaded/guard-ready sequence and default sandbox. Default Ubuntu WebKit/JSC `2.52.6-0ubuntu0.26.04.1`, Noto CJK `1:20240730+repack1-1build1`, Poppler `26.01.0-2ubuntu0.3`, MuPDF binding `1.26.7+ds1-1build1`.

Before dispatch, reran the complete corrected audit locally on the existing short-edge PDF from 43692316332, SHA-256 `00fb9410e9011a8a29f0dd5c1c5f40c59f3008aa7f3adbb60fe1d28465940484`: heading and all three table rows on page 2, 248 markers once, 103 raster guards, zero errors. The short-table exemption only removes the inappropriate requirement to span pages. Long-table, content, order and clipping gates remain. Eight local tests passed, including wrong process birth/image/UID, missing repeat headers and header order negatives.

The full native baseline again matches all **693 words and coordinates with maximum delta 0.0 pt** against the original application PDF from 43688690760. Its 8 pages reproduce the title on page 1 and first table row on page 2. The HTML is frozen regeneration from the exact application serializer and original Markdown, not a claim that the original application captured its HTML.

## Native comparison

Only the CSS chain described in `table-chain-comparison-plan.md` was tested. It preserves heading/table/thead/tbody/th/td structure and text, changes the heading wrapper to `display:contents`, and applies avoid-break constraints across table/thead/first row. No split table, caption, copied row/title, forced page position or unbreakable whole table.

| Case | Original heading / first row | CSS chain heading / first row | Candidate result |
| --- | --- | --- | --- |
| Critical 72-row table | p1 / p2 | p1 / p2 | Orphan persists; continuation headers absent p3–5 |
| Critical 3-row short table | p2 / p2 | p1 / p2 | **Regression**: previously correct whole-table move becomes orphan |
| Roomy 72-row table | p1 / p1 | p1 / p1 | Content paginates p1–4, but continuation headers absent p2–4 |
| Roomy 3-row short table | p1 / p1 | p1 / p1 | Scoped pagination/header checks pass |

All eight PDFs retain their expected markers exactly once (386/248/352/214 by case), all table rows (72 or 3), 100 code lines and a single table heading. All 172/103 rendered guard checks pass; no content loss or clipping is reported by these bounded checks. Page counts remain 8/5/7/4. Both original and candidate long tables lack actual repeated headers despite retaining native `thead` structure. The stricter repeat-header check records that pre-existing limitation separately; importantly, the candidate fails even without it because it preserves the original orphan and regresses the short-edge case.

This establishes a limit of this particular CSS-chain mechanism on the matched default runtime. It does not prove that every possible HTML/CSS or upstream engine solution is impossible. There is no basis to ship this change. Accessibility structure is retained and locally compared; no screen-reader or tagged-PDF accessibility acceptance is claimed.

## Independent ownership and cleanup

All nine outputs record a held guardian pidfd, exact PID/birth/UID, double-read descendant lineage, system WebKit/JSC mappings and the actual packaged renderer image. Each output window has an independently agreeing `xdotool getwindowpid` and X11 `_NET_WM_PID`, followed by another ownership check. All nine windows report **1024×768**. XID `2097168` is reused between sequential outputs, but each is tied to its distinct PID/birth; XID alone is not used as identity. This proves the output window allocation, not a separate measurement of the GTK child widget.

All nine native operations returned rendering→PDF, guardian exit 0, and removal of their own private directory. The product guardian performs its designed descendant teardown after stop-pipe EOF; this is not an editor UI close test and does not assert that descendants exited without signals.

Ruler measurement stays unchanged: A4 MediaBox 595×842 pt, left edge 34.015747 pt, full-width painted span 527.244080 pt, 96 CSS px measured as 80.341949/80.341957 pt for this ruler. No assumed universal CSS/PDF ratio or tuned row count was used.

## Evidence and limits

Artifact `14153980570`, `milkup-table-calibration-43693522845`: 8,569,296 bytes, SHA-256 `e52114caa8503b12b792efed4af7ddb0aa3cd0b601a1497c953edf1a396d82b3`, expires **2026-11-22 08:15:01 UTC**. ZIP size/hash/CRC and expanded paths were verified. Local raw evidence and independent review: `/workspace/milkup-table-comparison-evidence/43693522845/`. Raw PDFs, HTML, coordinates, process maps, ownership/cleanup reports and failed comparisons are retained; the earlier failures remain unchanged.

Default-runtime Unicode/URI limitations, complex scripts, screen-reader behavior and other platforms remain outside this mechanism test. No claim is made that those defects, production delivery or all five release gaps are closed. Integration remains unchanged; no main merge, release, notification, sandbox/security or production configuration changes.

# Packaged output calibration: exact full baseline, stopped before comparison

[Run 43692316332](https://github.com/Auto-Plugin/milkup/actions/runs/43692316332), QA SHA `8d0819afc76b91780cee573251435e6be053b569`, ended **failure** with pipefail correctly propagating exit 1. It generated the ruler, full baseline and short-edge PDFs, then stopped. **No long-room/short-room output or CSS-chain comparison ran. No product candidate is accepted.**

## What is established

The original application baseline is now faithfully reproduced through the unchanged packaged output helper:

- 8 A4 pages; all **693 extracted word records** match the original per-page order, text and coordinates, with maximum coordinate difference **0.0pt** (predeclared tolerance 0.5pt).
- Title `TABLESECTION` remains on page 1; first table row `TAA` on page 2. The only baseline pagination error is `T: orphan heading`.
- All 386 unique expected markers appear once. All 72 table rows, 100 code lines and 172 independently raster-checked guards remain complete. Table rows span pages 2–5; code pages 5–8.
- New baseline PDF SHA-256 `047de71904a62f0ad49f4cc418954d143a10b803f9411eab561aca2e9da28f7e`; original PDF `1985f3d22c1abddefb306f787dacbfe9ed2cb01ff0e7597c1a5b65ef782a4162`. PDFs are not claimed byte-identical; the strict content/coordinate comparison passed.

The short-edge control generated a 5-page document (the 100-line code block remains). Its heading and all three table rows are together on page 2; 248 expected unique markers appear once, with 103 raster guards and no row/edge failures. Short-edge PDF SHA-256 `00fb9410e9011a8a29f0dd5c1c5f40c59f3008aa7f3adbb60fe1d28465940484`.

This isolates a useful contrast: the same serialized structure keeps a short table with its title, but the long original table still orphans its title. It does not yet select or validate a repair.

## Why the run stopped

The reused audit mistakenly required **every** table, including the deliberate three-row control, to cross a page boundary. Its sole short-control error was `T: did not exercise a page boundary`. That is a test-contract error, not a requirement for a short table and not evidence of a new product defect.

The original report/PDFs are untouched. A separate offline recheck makes boundary coverage explicit for the frozen fixtures: required for the 72-row long table, not for the three-row short table. All content counts, coordinates, heading association, row order and clipping checks remain unchanged. The short PDF then has no errors; the long PDF retains its orphan error. Local counterexamples prove long-table boundary checking still fails when omitted, and missing short-table data is still rejected. The updated local suite has six passing tests.

Per the single-run stopping condition, **no extra CI was dispatched** after this correction. The two remaining controls and all chain proposals remain unexecuted. Offline correction does not convert the run into native overall acceptance.

## Exact production path and measured geometry

The existing deb was extracted into the isolated job workspace, not rebuilt or installed as a new system package. The native helper and its original embedded resource guard were reused byte-for-byte:

| Input | SHA-256 |
| --- | --- |
| 58c78973101acb0a22ca0cb5d24ef24bd9edc199 deb | 9e71e2b6f6c5cd030f7307d35679ded1d4f5605127d77320db1d455d90c1ddde |
| packaged milkup-desktop | 42394c4bdcaeea078c7d553acbe6edc7a75f13b16ce5b70cba2d0a3a02176ed6 |
| original embedded output guard, 15,808 bytes | 296131695cb15814252edd02e76e111fef293b7585c4e7597101d8ec05b852fa |

The real `--milkup-internal-output-helper` executes the 12mm GTK page setup, 1024×768 view size request, custom resource scheme, loaded/guard-ready timer and existing ownership guardian. JavaScript stays disabled and the default sandbox stays enabled. The supplied snapshot/result/stop channels use the original protocol, with bounded framing and deadlines. All three outputs report guardian exit 0 and removal of only their owned temporary directory. This is backend calibration, not repeated installed application UI or normal-editor-close acceptance.

Observed ruler values:

- PDF MediaBox: 595×842pt (rounded page extent).
- Left drawn/text edge: **34.015747pt**, matching 12mm and the original application PDF.
- Full-width drawn box spans x=34.015747..561.259827pt: **527.244080pt** printable width.
- 96 CSS px measured **80.341949pt horizontally / 80.341957pt vertically** in this ruler document. These are measured values, not an assumed 0.75 conversion, and must not be treated as a universal scale for other content.
- The exact A4/12mm GTK setup implies a 186×273mm content box (527.244×773.858pt). Width is independently observed above; the 773.858pt height is configuration-derived, not an independently painted bottom-edge measurement.

X window observations include an unmapped `Document output` window of 1024×768. Review found that the old search combined PID/name filters without an explicit conjunction or window-owner recheck, so the per-process window association is **not proven** by those rows. The probe now uses `--all`, checks `getwindowpid` and rereads the process birth identity; this instrumentation fix is local/unrun. Native process birth/library maps remain separate evidence. The exact product source establishes the view size request; top-level X geometry does not independently expose the GTK child allocation. Do not overstate this as a completed strict window-identity gate.

Runtime: default WebKitGTK/JavaScriptCore `2.52.6-0ubuntu0.26.04.1`, fonts-noto-cjk `1:20240730+repack1-1build1`, Poppler `26.01.0-2ubuntu0.3`, python3-fitz `1.26.7+ds1-1build1`. Actual WebKitWebProcess identities and `/usr/lib` mappings were retained; no private engine prefix.

## HTML provenance and retained failures

The original artifact did not contain captured application HTML. The full baseline HTML was regenerated with the exact unchanged 58c/0e4 serializer and original Markdown SHA `a48d14baea38632464f88813009563508ffb7ae2a8c1822285bb7308d9ef0fcb`; HTML SHA `2cb840a7643c5172004787ef47d697b66dfdeb604691d50e14e1181d84a64b92`. It also matches the inverse of the prior isolated caption-only serializer output byte-for-byte. It is explicitly regenerated, not claimed as an original capture. The unchanged PDF coordinate comparison supplies the actual native equivalence check.

Original failures 43688690760 and 43691007753 remain intact. The latter's false-green pipeline was not reinterpreted as passing. Default-runtime Unicode mapping and URI-link defects are unchanged and outside this mechanism calibration.

## Retention and stop

Artifact **14153051816**, `milkup-table-calibration-43692316332`, 3,953,797 bytes, SHA-256 `854e66135089f57acc2570d1b379d20e12c1e77c91180fc02ff758e98f20f55d`, expires **2026-11-22 07:59:18 UTC**. Digest/length/CRC and extraction bounds verified. Raw evidence and separate `offline-review.json` are under `/workspace/milkup-calibration-evidence/43692316332/`; private persistent PDF/HTML/text retention is recorded separately, excluding browser screenshots.

The mechanism comparison has not started. The exact full baseline and existing short-edge PDF can be reused; any next authorized native work should only address still-unexecuted controls/comparison with the corrected contracts, not rebuild the application or rerun unrelated matrices. Working integration remains 8d93519b, with product bytes equivalent to 0e4e8c58. No main merge, release, production/notification/security change.

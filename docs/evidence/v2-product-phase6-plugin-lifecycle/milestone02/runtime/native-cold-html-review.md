# Production04 cold HTML independent review

2026-10-19. **PASS for the actual first HTML output rich content and the recorded output-helper/DOM-guardian retirement observations.** No native UI or producer rerun was performed. Existing native screenshots and three new offline artifact-viewer screenshots were individually inspected with `view_image`. This does not close PDF text/link/pagination or historical Print04 two-second timeout issues.

## Identity and first-output scope

- Native run: `native-ui/runs/p6-m02-cold-output-01`; trusted control exit 0 at 09:31:39.551513 UTC; `completion.json` automated checks passed.
- Production04 binary recorded in plan: `892089be0177d44e178bde43bd58711abfeed134c4e03ef6043631a22765e9d8`.
- Actual `cold-first.html`: 64,601 bytes, SHA `82c8f7bce5dc8a3e4b79eb9c7c98224c0a81091c98dcb5bcbc1f56367be7320d`. It matches the artifact manifest and the bytes consumed by the offline viewer.
- Source SHA `8b4f460fb664ce9b2ef92314dd284404eb4bdfeb28578a34d6dfa08a608454a7`, document version 0, source mode; no screen SVG warmup appears in the recorded editor DOM. The DOM timing has a single `render_1` targeting export, from 800 to 876, version 0.
- Final runtime records: diagrams 1.1.1, footnotes 1.0.1, math 1.0.0, outline 1.3.1 and export-print 1.0.0 enabled, all errors empty. External archive/version provenance remains in the run's plan; math is the enabled bundled independent extension, not a replacement viewer implementation.

## Actual content, safety and duplicates

`cold-html-review/structure.json` is an independent decoded HTML parse, using the previously retained `milestone01/native-ui/review/review-html.py` audit routine against the actual plan fixture and original PNG. Findings:

- Two real MathML elements: one inline `E=mc²`, one block sum/fraction formula. Both visibly render in [rich.png](cold-html-review/rich.png).
- One diagram presentation containing nested SVG (two SVG elements, not two diagrams), 552×75 outer viewBox, nine paths, two arrow references and three Chinese/Latin labels. The actual visible boxes read 中文输入 → 冻结内容 → HTML / PDF / 打印. The local SVG IDs are unique; this is visible geometry, not a Mermaid-source-text match.
- Footnote forward anchor `#source-907` and return anchor `#source-900` both resolve. Visible numbered reference, definition and return link are present. The footnote marker occurs once in decoded body text. It occurs twice in raw HTML because a second occurrence is an accessibility `aria-label`; that is not duplicated visible content.
- All 100 `P5-PAGE-N` body markers and four original/code/footnote/end markers occur exactly once in decoded body text. No duplicate IDs, source-fallback elements, raw `[^p5]` fallback, or `flowchart LR` fallback are present.
- Embedded PNG decodes byte-exact to original `assets/logo-fixture.png`, SHA `2bcfa8c5cf0d32a459109ab319f2594d7d1ba34ce8edf61543bff85d4c593f40`, 196 bytes; viewer confirms loaded 64×64 image. [top.png](cold-html-review/top.png) visibly shows the blue square/white L.
- Exactly two HTML warnings: missing/unavailable local image at source offsets 622–658 and remote image at 660–717. Both retain original-source placeholders. [warnings.png](cold-html-review/warnings.png) records the actual warning area. No incomplete/pending/timeout rich-content fallback warning appears. The host UI also retains its generic bounded-window information notice; this is not silently omitted from the review.
- No script/iframe/object/embed/base/form/link/foreignObject nodes or event-handler attributes were found. The fixed CSP denies scripts, network, external fonts and objects; images are data URLs. The literal `<script>alert(1)</script>` remains visible code text in the table. These checks are for this artifact, not a claim that all possible HTML inputs are safe.

## What was visually inspected

The original native `cold-first.html.chooser.png` shows the actual destination path, and `cold-first.png` shows the source-mode editor/output controls after saving. They are not falsely presented as screenshots of rendered exported HTML.

The installed Chromium 154.0.8037.57 was used only as an offline artifact viewer with its sandbox retained, temporary independent profile, no DISPLAY126, no downloads, service workers blocked, offline context, and all routed requests aborted. `viewer.cjs` passes the original unchanged UTF-8 HTML into Playwright `setContent` on about:blank. This is **not file-navigation compatibility proof**, not the product PDF engine, and not a product dependency change. Viewer request list and page-error list are empty; the self-contained data PNG loads. Browser was closed in `finally` before review completion.

The first workspace-sandbox launch failed because Chromium's existing setuid sandbox helper was not usable in that execution environment (`viewer.log`, exit 1). It was not bypassed with `--no-sandbox`. The normally approved retry outside that workspace restriction succeeded (`viewer-authorized.log`, exit 0). Both attempts remain recorded.

The three viewed screenshots cover the top/table/code/image region, formulas/diagram/footnote/first body paragraphs, and warning panel. They show legible Chinese, intact table/code, real formula structure, visible arrows, and footnote links without overlap or clipping. The remaining long body was structurally counted, not claimed to have received a full-length aesthetic pixel audit.

## Native timing and process scope

For exact DOM instance `65dd81d77ef446c00cdd723821e8980a91b39f51d4b46a10` and request `render_1`, native monotonic timings relative to dispatch:

| Phase | Milliseconds |
| --- | ---: |
| helper-dequeued | 5.496 |
| helper-eval-submitted | 5.834 |
| helper-eval-callback | 437.388 |
| helper-result-drained | 788.119 |
| owner-result-accepted | 788.950 |

This individual request completed inside the unchanged two-second owner budget. It does not establish that all future inputs or historical Print04 paths meet that budget.

The same DOM instance's guardian PID 221346 records `kill-start` and `cleanup-complete` (approximately 32.858 ms apart). That is affirmative exact-instance cleanup evidence from the native guardian. `process-lifecycle.json` itself tracks **output** helper descendants only: PIDs 221534 and 221539 appear alive during the chooser, then `current:null`, running false, windows empty at `cold-first`, before close and after close. The app PID 220949 is absent after app close. The DOM guardian is not separately listed by that output-only tracker; do not generalize its output-helper snapshots into exhaustive all-process inspection.

Retained native warnings: five GTK `WIDGET_REALIZED_FOR_EVENT` assertions, and the remote inspector server failed to bind 127.0.0.1:35375 because the address was already in use. They did not prevent this captured accepted result, but are real diagnostics, not a warning-free run. No request timeout or render_1037 line appears in this run's native timing log.

## Limits and provenance

The root plans a production05 change limited to action registration; this review identifies production04 only and is not a separate production05 execution. No inference is made about PDF searchable Unicode, PDF links, long-block orphan pagination, physical printing or the historical Print04 diagram timeout. Those remain open unless separately accepted.

The original completion/artifact manifest visual-review fields remain untouched; this document is the independent review supplement. Input and generated evidence hashes follow.

| Artifact (relative to milestone02) | SHA-256 |
| --- | --- |
| `native-ui/runs/p6-m02-cold-output-01/cold-first.html` | `82c8f7bce5dc8a3e4b79eb9c7c98224c0a81091c98dcb5bcbc1f56367be7320d` |
| `native-ui/runs/p6-m02-cold-output-01/cold-first.html.artifact.json` | `85a267c86dee745d133484f2f28eb60ee7aa727041467acb0a73225f045c7f21` |
| `native-ui/runs/p6-m02-cold-output-01/completion.json` | `5d3eb77fb124f3f029242edfbf15ddceefd84a743415244d0f75dbcd2f35efe9` |
| `native-ui/runs/p6-m02-cold-output-01/plan.json` | `7e39169a89b61bc67bbd3e0460f391821982f44f8c18a988918133aac369cc13` |
| `native-ui/runs/p6-m02-cold-output-01/source.md` | `8b4f460fb664ce9b2ef92314dd284404eb4bdfeb28578a34d6dfa08a608454a7` |
| `native-ui/runs/p6-m02-cold-output-01/observations.json` | `18cc564836202b8a4fb3217758e3e4b928c55df94f493a9396f1ca63b74ebe10` |
| `native-ui/runs/p6-m02-cold-output-01/process-lifecycle.json` | `3e41013da88d5d5b78e74e6f31871d26b1ea4ee211045716cda7c1db8925f57f` |
| `native-ui/runs/p6-m02-cold-output-01/native-timing.log` | `7fb5207282a0c8a3f496dfb50eff168ac5dda91069670faa8ff5de70a08e8082` |
| `native-ui/runs/p6-m02-cold-output-01/cold-first.png` | `5a531e391c0de20d3a46d29b03c8455afb18e52719e7c7e798aae2597b20768d` |
| `native-ui/runs/p6-m02-cold-output-01/cold-first.html.chooser.png` | `57cfe755fe38f1a31b2cc4f8285a0b8980eb45d30f235fc68d6d06b8b385b95b` |
| `runtime/cold-html-review/structure.json` | `eba5fcec279f52cf1bd9fdde0f9daeb482184409bdb5a5626d2c08d817f420a4` |
| `runtime/cold-html-review/viewer.cjs` | `e360f55d14477b3b92b8dce31965fd61c055071123d7e2511f1fae375395e264` |
| `runtime/cold-html-review/viewer.json` | `5bc5f78637ee5e3db679e53e2da5f1bd094c0b47a7197115a1274503a7ea0653` |
| `runtime/cold-html-review/viewer.log` | `0fd3062cdf38530d9475dfbf0e33557cb1060522de20049d339c7998160cfdc5` |
| `runtime/cold-html-review/viewer.exit` | `4355a46b19d348dc2f57c046f8ef63d4538ebb936000f3c9ee954a27460dd865` |
| `runtime/cold-html-review/viewer-authorized.log` | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `runtime/cold-html-review/viewer-authorized.exit` | `9a271f2a916b0b6ee6cecb2426f0b3206ef074578be55d9bc94f6f3fe3ab86aa` |
| `runtime/cold-html-review/top.png` | `000a6e60bc247025220153b719c1fe8fc667af5ec5703a51fad9be8ed612d82c` |
| `runtime/cold-html-review/rich.png` | `3d5afa2d1c07089d1c5b1dcf861ec761098f01bcd0a2e11f922dd5e25eee5915` |
| `runtime/cold-html-review/warnings.png` | `fa683ee9e723d492eb2a0066d662c46a190ccc4027a01c18c432feed487f06bd` |

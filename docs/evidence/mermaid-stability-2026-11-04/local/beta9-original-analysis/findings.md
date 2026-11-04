# beta.9 existing Windows evidence: idle rendering loop

The original installed run 41713129442 already contains repeated rendering while idle. No new Windows execution was performed for this analysis.

- Pure standard user wide fixture: eight successful outputs with identical PNG SHA-256, plus one cancelled request. The successful wide UI step ended at 2026-11-03T20:45:18.543Z. Native draining then lasted until 20:45:34.306Z. Seven further identical outputs completed during this drain.
- Filtered administrator wide fixture: two successful identical outputs plus one cancelled request; the second output completed during native draining.
- The harness wide step performs rendered/readImage/state/saved. Its native-drain function only polls the ledger every 100 ms. It does not resize, scroll, edit, or change selection during draining.
- The old drain accepted a moment with zero pending jobs. It did not require request counts to stop increasing over a sustained idle window, so this run passing did not establish idle stability.
- Both accounts displayed intrinsic 3528 x 126 PNG pixels in an editor 1028 CSS pixels wide. The old harness explicitly required natural width instead of fitting the editor.

Relevant unchanged baseline code:

- tests/windows/mermaid-product-e2e.mjs:658 (waitForNativeJobs), :1771 (native-drain), :2074 (wide fixture), :2102 (natural-width assertion).
- packages/view-dom/src/document-presentation.ts:780/:811 (whole-window size/range key), :478 (ResizeObserver), :858 (10-second deadline), :936 (unbounded automatic timeout retry), :1485 (observe each newly painted preview).
- apps/desktop/src/document-presentation-service.ts:143/:289 (no completed fence reuse; serial cold native requests for each fence).
- packages/view-dom/src/document-png-image.ts:17 (fixed natural width and maxWidth:none).

Observed repeated native work is proven by original logs. The precise DOM key oscillation still needs a browser/Windows diagnostic trace; source analysis indicates window-range changes after source lines collapse and width changes due to geometry as candidates. Do not report this inference as a confirmed precise root cause.

The JSON companion preserves exact original report paths, SHA-256 values, timestamps, request IDs, native success/cleanup fields, and teardown stages. Original reports were not modified.

## Browser diagnostic update

A standalone Chromium probe now reproduces the width feedback when actual occupying scrollbars are preserved. Playwright normally adds `--hide-scrollbars`; the reproducer explicitly omits that flag and uses the original application stylesheet. It uses the original accepted wide PNG and a simulated 200 ms provider, so this is DOM/layout evidence, not another native Windows run.

- Baseline EditorView over 6 seconds: three render calls; request width alternates between 1013 and 1028 CSS pixels.
- Intermediate patch with result caching and image fit, before stable scrollbar gutter: only two expensive render calls, but 498 sync passes and no mounted image at the final snapshot. Width alternates between 961 and 976 after correctly subtracting editor padding.
- This demonstrates that memoization alone masks repeated expensive work without fixing the geometry loop. Stable layout width must be fixed as well.
- Files: layout-probe.mjs; layout-editor-scrollbar-before.json/.png and layout-editor-scrollbar-after.json/.png. The intermediate `after` result is a failure, retained as evidence. Final validated outputs will use a distinct label/file.

The prior overlay-scrollbar probes (layout-before/after and layout-editor-before/after) did not reproduce the loop and are retained to show the platform precondition, not used to claim its absence.

## Final implemented layout and caching check

Final gutter behavior was tested from the actual updated application stylesheet, without injected CSS, in both EditorView and SourceDocumentView. Each ran for 75 seconds at rest, then three 720/1028 CSS-pixel resize round trips, then disposal during a request at a new width.

- Both views: one provider render and four sync passes during the entire idle interval. PNG remained mounted at 944.21875 x 33.71875 CSS pixels, preserving its 3528 x 126 intrinsic dimensions.
- Resize round trips: every sampled view retained one PNG; only the first occurrence of the second width required another provider render. No repeated rendering on returning to already rendered widths.
- In-flight disposal: all PNG byte/image/decoded-owner counters returned to zero.
- Exact final files: layout-editor-scrollbar-final-gutter.json/.png and layout-source-scrollbar-final-gutter.json/.png. The source-view run also enforced explicit assertions in layout-probe.mjs. The editor-view result was independently inspected against the same assertions below.
- These are real Chromium DOM/layout tests with a simulated 200 ms PNG provider. They do not establish Windows process visibility, native rendering shutdown, installed product behavior, or multi-DPI acceptance. Those still require the actual Windows product run.

Implemented in commit c88a19c1: content CSS width excludes padding; intrinsic PNG dimensions stay validated while display fits; completed fence cache is bounded to eight entries and 64 MiB of actual encoded bytes plus decoded pixel cost; authority is rechecked and private PNG references are accounted independently; only host-attested single inert PNG fences may reuse across selection/verified offsets; ordinary providers retain full-request semantics. Repeated unchanged preparation timeouts permit one automatic retry and then wait for changed input or explicit refresh. Stable scrollbar gutter and the manager attestation callback are separate parent commits.

Validation: desktop presentation service 41 tests passed; core private-PNG 14 tests passed; seven relevant view suites 157 tests passed; desktop TypeScript check passed; all nine owned source/test files passed Prettier. Initial commit attempt failed in the shared legacy lint-staged hook (missing dependency/cache path); the existing supported SKIP_SIMPLE_GIT_HOOKS=1 path was used after explicit equivalent checks. No hook was modified.

# P5 milestone06 actual artifact reviews

**The diagrams1.1.2 full-type-preload candidate was rejected.** Its preserved actual files are experiments, not product timeout fixes. The product retains diagrams1.1.1; the later generic queue-budget change must receive a separate formal-production audit. `candidate-decision.json` identifies the affected reports. Formal reports must not be placed under `rejected-candidate/` or inherit its results.

`new-print-01/review.json` remains at its original evidence path and is explicitly marked rejected-candidate. Its inspected page2 visibly contains the graph and matches PDF05/old-print01 pixels. That does not prove timeout reliability.

`rejected-candidate/multi-comparison.json` compares actual first/repeat HTML with old1.1.1 baseline: first files are byte-identical. Candidate first minus its incomplete-render warning exactly equals candidate repeat. All three independently inspected graph crops are pixel-identical across first/repeat; every graph has three readable nodes and two arrows. First and baseline retain a warning, so clean completion is not passed. Candidate repeat has no warning. Actual observed document versions are0 for both, with source hashes unchanged.

`rejected-candidate/new-multi-a4/review.json` inspects the existing actual one-page PDF raster without rerasterization. All three graphs are drawn and readable, but the incomplete-render warning remains. Exact Chinese text extraction fails; no normalization is used. No physical print or long-block pagination claim follows.

The HTML viewer used installed Chromium only as an independent offline artifact viewer (sandbox enabled, no DISPLAY, no new dependency). It loaded exact saved UTF8 bytes through setContent. This is not a product PDF-engine change or proof of direct-file navigation. The old HTML baseline is byte-identical to the inspected first candidate file, so no redundant old-file browser launch was performed.

`review-pdf-page.py` and `review-html.cjs` are independent read-only audit scripts. Their initial visual statuses stay pending until actual pixel inspection. Markers/labels alone never establish a diagram.

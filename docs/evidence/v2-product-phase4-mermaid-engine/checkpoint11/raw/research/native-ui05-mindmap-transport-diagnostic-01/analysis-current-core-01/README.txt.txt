Actual UI05 Mindmap wire: current-core offline replay

This is an offline replay, not a new native/browser run or acceptance claim. The first replay exited 0. All 17 captured target request/result pairs from this one instance pass the current complete single-result validator.

Before scrolling, render_16 returned Mindmap ready/complete after 647 ms. It arrived at observer time 31390 ms; three subsequent DOM samples before wheel input (31746, 31848, 32027 ms) contained only Gantt and Gitgraph. Mindmap canonical output is identical before and after scrolling (render_16/26/29).

Reconstructing a whole window from this run's original document and captured complete fence blocks, the three actual results render_15+14+16 fail copyDocumentPresentationAggregate. Their JSON is 92363 bytes, but the independent public image-codec shared ledger reaches 269397 canonical SVG bytes, exceeding 262144 by 7253 bytes. Each of the three two-image combinations passes, as do both captured post-wheel Gitgraph+Mindmap combinations. The presentation serializer's individual byte sum is separately 269477 bytes due to its different deterministic ID prefixes; do not mix it with the codec ledger.

No old-run AST is used. Request source slices, declarations, archive bytes and all input/source hashes were checked. Raw captures were not modified. Whole-window requests are explicitly reconstructed, not captured IPC. Private service visible priority/window state was not captured, so this proves budget inadmissibility of these actual three results and consistency with the observed two-image display, not direct observation of the service's internal branch/order or a claim that the earlier full UI failure is resolved.

summary.json is the compact result; results.json includes every matched request and all six reconstructed aggregate checks. source-manifest.json identifies the frozen current core implementation. replay.mjs and validator-metafile.json document the lightweight bundle/replay. execution.json records source/input integrity and no native/browser startup.

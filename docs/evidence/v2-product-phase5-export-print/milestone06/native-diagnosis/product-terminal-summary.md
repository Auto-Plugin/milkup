# Production queue trace terminal summary — frozen nine runs

| Run | Terminal state | Native requests / accepted | Owner dispatch → accept range (ms) | Output artifacts |
| --- | --- | ---: | ---: | ---: |
| p5-m06-product-a4 | completed | 3 / 3 | 93.576–424.566 | 1 |
| p5-m06-product-cancel | failed | 1 / 1 | 603.475–603.475 | 0 |
| p5-m06-product-cancel-02 | completed | 2 / 2 | 114.302–388.264 | 1 |
| p5-m06-product-disable-all | completed | 0 / 0 | not applicable | 0 |
| p5-m06-product-large-diagrams | completed | 6 / 6 | 103.244–943.112 | 1 |
| p5-m06-product-letter | completed | 3 / 3 | 86.760–609.030 | 1 |
| p5-m06-product-multi-html | completed | 6 / 6 | 108.395–690.529 | 2 |
| p5-m06-product-print | failed | 1 / 1 | 634.198–634.198 | 0 |
| p5-m06-product-print-02 | completed | 2 / 2 | 211.305–702.353 | 2 |

All rows retain source hashes, binary/package provenance, actual observations and individual native phases in the corresponding timing JSON. No native deadline event appears in these runs. Frontend queue-wait duration remains unmeasured; post-dispatch scheduling is not queue waiting.

Original product-print failed at filename selection and has no output PDF. Product-cancel failed during exact r2 edit/save verification: UI cancellation and a terminal native envelope are observed, but successful post-cancel retry is not proven. It remains a failed whole run.

Product-print-02 produced two actual artifacts. Their visual/text fidelity remains a separate audit. First-output incomplete warnings in HTML/A4/Letter/print are retained, not converted to a clean-rich-output pass.

Product-disable-all has no native requests or output artifact by design; observations record disabled plugin state followed by source/live typing, undo, redo and restored saves (document versions 1–8). It does not test successful diagrams output while disabled.

For product-cancel, the pointer click interval falls between dispatch+74.115 and +267.967 ms; helper drain is +600.479 ms and owner terminal acceptance +603.475 ms. The app remains present at cancellation and is absent after close. The DOM guardian has a later kill-start/cleanup-complete pair. Observed output-helper census is narrower than all persistent DOM processes.

These terminal successes do not resolve the historical 2000.313 ms native Print04 timeout. No native UI, build, heavy PDF rendering or product modification was performed for this summary.


## Cancel02 retry outcome

Cancel02 completed. The click spans dispatch+86.305 to +296.127 ms; result drain occurs at +388.128 ms, terminal owner acceptance at +388.264 ms. The separately dispatched retry uses document version 1 and settles in 114.302 ms.

The actual saved r2 source rehash is `a5913b56a09f91e1428b07f44dd7493a5da30dd9216f1a716aef8818cb6ec01d` and matches completion. Actual `retry-r2.html` rehash matches its observation and the file contains SVG. The retry retains its recorded incomplete warnings; this does not become an unconditional full-rich-content fidelity pass. The original cancel run's r2-save failure remains in the table and has not been overwritten.

All nine runs total 24 native dispatches/acceptances and zero native deadline events. Seven runs completed, two failed. Queue wait remains unmeasured. This directory is frozen after this analysis; no product/trace/UI changes were made.

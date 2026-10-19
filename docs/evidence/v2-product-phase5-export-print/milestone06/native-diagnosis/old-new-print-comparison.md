# Old/new diagrams print trace comparison

Three fresh-profile production print runs use the same instrumented desktop binary; this is a small observational comparison, not a controlled performance benchmark. No timeout occurred in these three runs. The historic Print04 2000.313 ms failure remains unresolved.

## Input and artifact identity

- Actual source SHA256 (all three, independently rehashed): `8b4f460fb664ce9b2ef92314dd284404eb4bdfeb28578a34d6dfa08a608454a7`.
- Desktop binary SHA256 (all three provenance records): `f03894c9efdc7b96729fe1e4e5dd34123bd79bf55ba4068644a41134cf4af4e1`.
- Output plugin: 1.0.0, SHA256 `08cd8532ecd209f4794f88de1880e06c16c586ae2997e326450687e1be2181b9` (recorded provenance).
- Diagrams 1.1.1 package SHA256: `2351692438a2083a72bcb8cddce28c7a530a8557734926992a3a2e3120c68a19` (independently rehashed; matches run provenance and package manifest).
- Diagrams 1.1.2 package SHA256: `2e54b8326935b28b6b727315ccef163fd288e1374514f1783e0722d539abdd78` (independently rehashed; matches run provenance and package manifest).

## Native request durations

All requests below use version 0 and source range 800–876. Times are milliseconds, rounded to three decimals; full precision and phases remain in each JSON.

| Run / diagrams | Request | Target | Dispatch → accepted | Dispatch → dequeue | Eval submit → callback | Callback → result drain |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| old-print-01 / 1.1.1 | render_1 | screen | 805.720 | 4.494 | 441.588 | 353.341 |
| old-print-01 / 1.1.1 | render_3 | screen | 228.770 | 39.749 | 60.758 | 126.677 |
| old-print-01 / 1.1.1 | render_4 | export | 152.045 | 9.484 | 59.845 | 74.318 |
| old-print-01 / 1.1.1 | render_5 | screen | 173.626 | 4.992 | 77.428 | 89.117 |
| old-print-02 / 1.1.1 | render_1 | screen | 446.759 | 2.731 | 256.852 | 186.796 |
| old-print-02 / 1.1.1 | render_3 | screen | 99.544 | 4.556 | 31.917 | 62.466 |
| old-print-02 / 1.1.1 | render_4 | export | 153.559 | 5.212 | 72.291 | 75.525 |
| new-print-01 / 1.1.2 | render_1 | screen | 589.141 | 2.775 | 315.031 | 267.766 |
| new-print-01 / 1.1.2 | render_3 | screen | 175.841 | 22.281 | 42.876 | 107.626 |
| new-print-01 / 1.1.2 | render_4 | export | 476.071 | 2.069 | 272.683 | 192.298 |

## Interpretation

- Old 1.1.1 first-screen samples span **446.759–805.720 ms**. New 1.1.2 first-screen sample is **589.141 ms**, within that observed old range.
- Old export samples: **152.045, 153.559 ms**. New export sample: **476.071 ms**. These samples do not establish a speed benefit.
- Every dispatched request has all expected phase records and an owner acceptance before 2000 ms. Final diagrams registries remain enabled, and document notices contain no timeout.
- Input evaluation callback only acknowledges that evaluation returning; bootstrap dispatch is asynchronous. Callback-to-drain includes renderer work, scheduling and polling, so it cannot be called pure response-transfer latency.
- Renderer versions differ, but there is no randomized order, matching CPU-load capture or sufficient repeated distribution. First-use variance is present in the old version itself. Do not infer a regression or a performance fix from this small sample.
- All new observations are successful runs. They do not locate the unobserved slow stage of historical Print04 and cannot close that failure.

No instrumentation/product changes, native build or UI execution were performed during this analysis.

# Candidate 02 matched native performance

Baseline `f15c476a4f6e7b5f254e325692d57e9bfaa798580441dd3554f6c4fe1e9d802e`; candidate `8deacbf470f699ad9b0a6c2c2937adbfc7ef6194c38e8f61e707a70bdfc5f9b2`.

Each matched case uses the identical fixture SHA/actual bytes, lineBytes=64, 20 cycles, fresh profile, display :127, unchanged XTest protocol and targets. All records and failures remain in native-ui/runs; execution logs/source snapshots are retained separately. No builds, browser tests or other native workloads were intentionally run in the candidate timing window.

| Case | Actual bytes | Input p95 baseline → candidate | Delete p95 | Jump p95 | Search single value |
|---|---:|---:|---:|---:|---:|
| ordinary-live | 65555 | 228.0 → 96.0 | 459.0 → 100.0 | 97.0 → 51.0 | 310.0 → 455.0 |
| ordinary-source | 65555 | 125.0 → 357.0 | 130.0 → 223.0 | 42.0 → 122.0 | 233.0 → 285.0 |
| memory-source | 179219 | 99.0 → 72.0 | 64.0 → 135.0 | 77.0 → 83.0 | 488.0 → 1628.0 |
| memory-live | 179219 | 94.0 → 140.0 | 61.0 → 70.0 | 73.0 → 73.0 | 271.0 → 342.0 |
| native-source | 10485779 | 98.0 → 83.0 | 65.0 → 60.0 | 65.0 → 167.0 | 546.0 → 643.0 |
| native-live | 10485779 | 36.0 → 96.0 | 40.0 → 59.0 | 57.0 → 134.0 | 566.0 → 477.0 |

All times milliseconds. The main table uses 20 input, 20 deletion and 80 jump samples per run. Search/open/save and the first-target jump have one observation per run; none is labeled p95.

| Candidate case / operation | n | min | median | max | p95 (n≥20) | ≤100ms count / ratio |
|---|---:|---:|---:|---:|---:|---:|
| ordinary-live / jump | 80 | 30.0 | 38.0 | 95.0 | 51.0 | 80/80 (100.0%) |
| ordinary-live / input | 20 | 31.0 | 38.0 | 145.0 | 96.0 | 19/20 (95.0%) |
| ordinary-live / delete | 20 | 31.0 | 36.0 | 113.0 | 100.0 | 19/20 (95.0%) |
| ordinary-live / search | 1 | 455.0 | 455.0 | 455.0 | single value | 0/1 (0.0%) |
| ordinary-live / jump:first-target | 1 | 39.0 | 39.0 | 39.0 | single value | 1/1 (100.0%) |
| ordinary-live / jump:unchanged-warm | 41 | 30.0 | 37.0 | 51.0 | 43.0 | 41/41 (100.0%) |
| ordinary-live / jump:after-edit | 38 | 32.0 | 40.0 | 95.0 | 71.0 | 38/38 (100.0%) |
| ordinary-live / open-to-ready | 1 | 3505.1 | 3505.1 | 3505.1 | single value | 0/1 (0.0%) |
| ordinary-live / save-to-ready | 1 | 312.5 | 312.5 | 312.5 | single value | 0/1 (0.0%) |
| ordinary-source / jump | 80 | 21.0 | 40.5 | 150.0 | 122.0 | 71/80 (88.8%) |
| ordinary-source / input | 20 | 80.0 | 120.0 | 372.0 | 357.0 | 3/20 (15.0%) |
| ordinary-source / delete | 20 | 76.0 | 114.0 | 287.0 | 223.0 | 5/20 (25.0%) |
| ordinary-source / search | 1 | 285.0 | 285.0 | 285.0 | single value | 0/1 (0.0%) |
| ordinary-source / jump:first-target | 1 | 37.0 | 37.0 | 37.0 | single value | 1/1 (100.0%) |
| ordinary-source / jump:unchanged-warm | 41 | 21.0 | 37.0 | 150.0 | 137.0 | 37/41 (90.2%) |
| ordinary-source / jump:after-edit | 38 | 22.0 | 49.0 | 137.0 | 122.0 | 33/38 (86.8%) |
| ordinary-source / open-to-ready | 1 | 4879.3 | 4879.3 | 4879.3 | single value | 0/1 (0.0%) |
| ordinary-source / save-to-ready | 1 | 259.2 | 259.2 | 259.2 | single value | 0/1 (0.0%) |
| memory-source / jump | 80 | 23.0 | 40.0 | 159.0 | 83.0 | 77/80 (96.2%) |
| memory-source / input | 20 | 21.0 | 47.0 | 99.0 | 72.0 | 20/20 (100.0%) |
| memory-source / delete | 20 | 19.0 | 40.5 | 141.0 | 135.0 | 18/20 (90.0%) |
| memory-source / search | 1 | 1628.0 | 1628.0 | 1628.0 | single value | 0/1 (0.0%) |
| memory-source / jump:first-target | 1 | 52.0 | 52.0 | 52.0 | single value | 1/1 (100.0%) |
| memory-source / jump:unchanged-warm | 41 | 23.0 | 40.0 | 159.0 | 115.0 | 38/41 (92.7%) |
| memory-source / jump:after-edit | 38 | 23.0 | 40.0 | 96.0 | 81.0 | 38/38 (100.0%) |
| memory-source / open-to-ready | 1 | 3964.4 | 3964.4 | 3964.4 | single value | 0/1 (0.0%) |
| memory-source / save-to-ready | 1 | 160.7 | 160.7 | 160.7 | single value | 0/1 (0.0%) |
| memory-live / jump | 80 | 25.0 | 40.0 | 119.0 | 73.0 | 78/80 (97.5%) |
| memory-live / input | 20 | 19.0 | 55.5 | 156.0 | 140.0 | 17/20 (85.0%) |
| memory-live / delete | 20 | 22.0 | 50.0 | 160.0 | 70.0 | 19/20 (95.0%) |
| memory-live / search | 1 | 342.0 | 342.0 | 342.0 | single value | 0/1 (0.0%) |
| memory-live / jump:first-target | 1 | 40.0 | 40.0 | 40.0 | single value | 1/1 (100.0%) |
| memory-live / jump:unchanged-warm | 41 | 28.0 | 40.0 | 119.0 | 88.0 | 39/41 (95.1%) |
| memory-live / jump:after-edit | 38 | 25.0 | 39.0 | 73.0 | 73.0 | 38/38 (100.0%) |
| memory-live / open-to-ready | 1 | 3192.0 | 3192.0 | 3192.0 | single value | 0/1 (0.0%) |
| memory-live / save-to-ready | 1 | 233.1 | 233.1 | 233.1 | single value | 0/1 (0.0%) |
| native-source / jump | 80 | 26.0 | 47.5 | 320.0 | 167.0 | 72/80 (90.0%) |
| native-source / input | 20 | 21.0 | 45.5 | 96.0 | 83.0 | 20/20 (100.0%) |
| native-source / delete | 20 | 18.0 | 33.0 | 74.0 | 60.0 | 20/20 (100.0%) |
| native-source / search | 1 | 643.0 | 643.0 | 643.0 | single value | 0/1 (0.0%) |
| native-source / jump:first-target | 1 | 66.0 | 66.0 | 66.0 | single value | 1/1 (100.0%) |
| native-source / jump:unchanged-warm | 41 | 26.0 | 49.0 | 303.0 | 171.0 | 36/41 (87.8%) |
| native-source / jump:after-edit | 38 | 27.0 | 46.5 | 320.0 | 167.0 | 35/38 (92.1%) |
| native-source / open-to-ready | 1 | 4653.7 | 4653.7 | 4653.7 | single value | 0/1 (0.0%) |
| native-source / save-to-ready | 1 | 459.8 | 459.8 | 459.8 | single value | 0/1 (0.0%) |
| native-live / jump | 80 | 25.0 | 49.5 | 339.0 | 134.0 | 70/80 (87.5%) |
| native-live / input | 20 | 19.0 | 38.5 | 157.0 | 96.0 | 19/20 (95.0%) |
| native-live / delete | 20 | 21.0 | 33.5 | 100.0 | 59.0 | 20/20 (100.0%) |
| native-live / search | 1 | 477.0 | 477.0 | 477.0 | single value | 0/1 (0.0%) |
| native-live / jump:first-target | 1 | 104.0 | 104.0 | 104.0 | single value | 0/1 (0.0%) |
| native-live / jump:unchanged-warm | 41 | 25.0 | 48.0 | 339.0 | 134.0 | 36/41 (87.8%) |
| native-live / jump:after-edit | 38 | 30.0 | 49.5 | 165.0 | 136.0 | 34/38 (89.5%) |
| native-live / open-to-ready | 1 | 3878.8 | 3878.8 | 3878.8 | single value | 0/1 (0.0%) |
| native-live / save-to-ready | 1 | 603.9 | 603.9 | 603.9 | single value | 0/1 (0.0%) |

## Budget failures and integrity

- ordinary-live: 143 records, complete=True, saved bytes exact=True, 0 target violations; cgroup throttling counter delta=3, throttled microseconds delta=98548.
- ordinary-source: 143 records, complete=True, saved bytes exact=True, 6 target violations; cgroup throttling counter delta=1, throttled microseconds delta=4299.
  - Retained input round 0 : 372.0ms, target 200ms (DOM 304.0ms).
  - Retained delete round 1 : 223.0ms, target 200ms (DOM 155.0ms).
  - Retained input round 4 : 332.0ms, target 200ms (DOM 129.0ms).
  - Retained delete round 5 : 287.0ms, target 200ms (DOM 170.0ms).
  - Retained input round 12 : 357.0ms, target 200ms (DOM 302.0ms).
  - Retained input round 19 : 268.0ms, target 200ms (DOM 234.0ms).
- memory-source: 143 records, complete=True, saved bytes exact=True, 1 target violations; cgroup throttling counter delta=1, throttled microseconds delta=48088.
  - Retained search round n/a : 1628.0ms, target 500ms (DOM 301.0ms).
- memory-live: 143 records, complete=True, saved bytes exact=True, 0 target violations; cgroup throttling counter delta=3, throttled microseconds delta=30316.
- native-source: 143 records, complete=True, saved bytes exact=True, 3 target violations; cgroup throttling counter delta=4, throttled microseconds delta=15842.
  - Retained jump round 18 home: 303.0ms, target 200ms (DOM 261.0ms).
  - Retained jump round 14 end: 320.0ms, target 200ms (DOM 247.0ms).
  - Retained search round n/a : 643.0ms, target 500ms (DOM 493.0ms).
- native-live: 143 records, complete=True, saved bytes exact=True, 1 target violations; cgroup throttling counter delta=0, throttled microseconds delta=0.
  - Retained jump round 7 home: 339.0ms, target 200ms (DOM 87.0ms).

The baseline ordinary Live nine 200ms misses and large-file search misses remain unchanged. Candidate outcomes do not erase them. A harness exit 0 means the scenario completed; the separate accepted/violations fields decide whether its timing budgets passed. Any improvement is scoped to these six fixed runs, not a claim about all documents or real system IME.

All 179219-byte cases are memory-windowed, not ordinary; 65555-byte cases are ordinary. Native-large classification for the large fixtures is supported by frozen routing policy and observed view marker, not by the marker alone. WebKit longtask support and resource samples are recorded; absence of longtask records is not proof of no stalls.

Initial candidate batch run-name validation failed before any driver/application start; candidate-six-console.log preserves it. The corrected prefix was the only batch change; product, thresholds and measurements were unchanged.

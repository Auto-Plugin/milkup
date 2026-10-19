# Candidate 03 ordinary editor performance

Candidate03 retests ONLY ordinary Source and ordinary Live. No candidate03 performance claim for memory/native large-file views or outline. Existing candidate02 full six+repeat evidence remains independent.

Candidate03 ELF `341d12999d07ba0b7116d463ebacde4bb52ead97279a33ad588ab599d2ddb7a2`. Same four harness/helper source hashes as candidate02, same 65555-byte fixture, lineBytes64, 20 cycles, 143 records per run, fresh profiles. Source ran first, Live second, exactly once each. No changed thresholds, prewarming or best-run selection.

| Version / mode / run | Input DOM p95 | Input frame p95 | Delete DOM p95 | Delete frame p95 | Jump frame p95 | First search (single) | Violations |
|---|---:|---:|---:|---:|---:|---:|---:|
| baseline / source / first | 94.0 | 125.0 | 94.0 | 130.0 | 42.0 | 233.0 | 0 |
| baseline / source / repeat | 101.0 | 156.0 | 102.0 | 161.0 | 47.0 | 220.0 | 2 |
| candidate02 / source / first | 302.0 | 357.0 | 155.0 | 223.0 | 122.0 | 285.0 | 6 |
| candidate02 / source / repeat | 87.0 | 120.0 | 82.0 | 109.0 | 41.0 | 323.0 | 0 |
| candidate03 / source / first | 32.0 | 61.0 | 30.0 | 54.0 | 54.0 | 249.0 | 0 |
| baseline / live / first | 54.0 | 228.0 | 184.0 | 459.0 | 97.0 | 310.0 | 9 |
| candidate02 / live / first | 58.0 | 96.0 | 48.0 | 100.0 | 51.0 | 455.0 | 0 |
| candidate03 / live / first | 28.0 | 48.0 | 20.0 | 42.0 | 51.0 | 324.0 | 0 |

All times milliseconds. Source first+repeat aggregate baseline/candidate02 n40 remains in performance-repeat/comparison.json; versions and iterations are not pooled in this table.

| Candidate03 operation | n | min | median | max | p95 (n≥20) | ≤100ms |
|---|---:|---:|---:|---:|---:|---:|
| source / input | 20 | 32.0 | 42.0 | 129.0 | 61.0 | 19/20 (95.0%) |
| source / delete | 20 | 32.0 | 38.0 | 62.0 | 54.0 | 20/20 (100.0%) |
| source / jump | 80 | 19.0 | 31.0 | 134.0 | 54.0 | 78/80 (97.5%) |
| source / search | 1 | 249.0 | 249.0 | 249.0 | single value | 0/1 (0.0%) |
| source / jump:first-target | 1 | 70.0 | 70.0 | 70.0 | single value | 1/1 (100.0%) |
| source / jump:unchanged-warm | 41 | 20.0 | 31.0 | 134.0 | 46.0 | 39/41 (95.1%) |
| source / jump:after-edit | 38 | 19.0 | 31.5 | 89.0 | 54.0 | 38/38 (100.0%) |

source open-to-ready: 4470.6 ms, single observation.

source save-to-ready: 176.7 ms, single observation.

source: exactSavedFile=True; backend marker=False; cgroup nr_throttled delta=0, throttled_usec delta=0; 0 budget violations.

| Candidate03 operation | n | min | median | max | p95 (n≥20) | ≤100ms |
|---|---:|---:|---:|---:|---:|---:|
| live / input | 20 | 32.0 | 37.0 | 83.0 | 48.0 | 20/20 (100.0%) |
| live / delete | 20 | 30.0 | 34.5 | 44.0 | 42.0 | 20/20 (100.0%) |
| live / jump | 80 | 29.0 | 37.0 | 84.0 | 51.0 | 80/80 (100.0%) |
| live / search | 1 | 324.0 | 324.0 | 324.0 | single value | 0/1 (0.0%) |
| live / jump:first-target | 1 | 39.0 | 39.0 | 39.0 | single value | 1/1 (100.0%) |
| live / jump:unchanged-warm | 41 | 29.0 | 36.0 | 71.0 | 50.0 | 41/41 (100.0%) |
| live / jump:after-edit | 38 | 31.0 | 38.0 | 84.0 | 53.0 | 38/38 (100.0%) |

live open-to-ready: 3254.3 ms, single observation.

live save-to-ready: 177.0 ms, single observation.

live: exactSavedFile=True; backend marker=False; cgroup nr_throttled delta=3, throttled_usec delta=10602; 0 budget violations.

All raw samples, violations, sources, command/exit records remain preserved. A successful scenario exit does not by itself establish performance targets; use violations and the empirical ≤100ms distribution. Two-frame latency is a presentation proxy and does not establish physical display response. A single clean candidate03 run is scoped evidence, not proof of universal/stable tail bounds. Existing baseline/candidate02 failures are not erased.

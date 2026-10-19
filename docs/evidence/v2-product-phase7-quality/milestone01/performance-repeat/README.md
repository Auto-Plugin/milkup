# Ordinary Source matched repeat

Exactly first+one repeat; no selection or warmup. Input/delete n40 per baseline/candidate; all first failures retained. Frame proxy does not measure physical display.

Both runs requested 65536 bytes, lineBytes=64, cycles=20; actual fixture bytes 65555. Repeat order baseline then candidate; before/between/after process inventory ran outside timing.

| Version / run | Input DOM p95 | Input frame p95 | Delete DOM p95 | Delete frame p95 | Input frame max | Delete frame max | Violations |
|---|---:|---:|---:|---:|---:|---:|---:|
| baseline / p7-baseline-ordinary-source-01 | 94.0 | 125.0 | 94.0 | 130.0 | 195.0 | 185.0 | 0 |
| baseline / p7-baseline-ordinary-source-repeat-01 | 101.0 | 156.0 | 102.0 | 161.0 | 291.0 | 299.0 | 2 |
| baseline / combined 40 input/40 delete | 101.0 | 156.0 | 102.0 | 161.0 | 291.0 | 299.0 | 2 |
| candidate / p7-candidate-02-ordinary-source-01 | 302.0 | 357.0 | 155.0 | 223.0 | 372.0 | 287.0 | 6 |
| candidate / p7-candidate-02-ordinary-source-repeat-01 | 87.0 | 120.0 | 82.0 | 109.0 | 129.0 | 111.0 | 0 |
| candidate / combined 40 input/40 delete | 234.0 | 332.0 | 94.0 | 153.0 | 372.0 | 287.0 | 6 |

Full JSON includes min/median/max, p95 only n≥20, ≤100ms counts/ratios, DOM vs frame vs post-DOM delay, individual violations, file/sample hashes and CPU counters. The combined result gives equal weight to both complete runs and does not overwrite a failure.

- p7-baseline-ordinary-source-01: complete=True, records=143, exactSavedFile=True, nr_throttled delta=4, throttled_usec delta=56319.
- p7-baseline-ordinary-source-repeat-01: complete=True, records=143, exactSavedFile=True, nr_throttled delta=0, throttled_usec delta=0.
- p7-candidate-02-ordinary-source-01: complete=True, records=143, exactSavedFile=True, nr_throttled delta=1, throttled_usec delta=4299.
- p7-candidate-02-ordinary-source-repeat-01: complete=True, records=143, exactSavedFile=True, nr_throttled delta=0, throttled_usec delta=0.

Candidate first-run slowdown did not reproduce in this single repeat. Baseline repeat itself had two budget misses. This establishes observed variation, not a proven environmental cause and not proof that the candidate regression is fixed. The aggregate candidate input p95 remains worse because the six original misses are retained. No further reruns were performed to obtain a preferred result.

Before, between, and after pair inventories observed only the two existing Xvfb processes (:126, :127), no live matching app/driver/WebKit process and no visible Milkup window. These idle observations cannot establish focus during earlier timing samples. XGetInputFocus=PointerRoot (1) caused retained xdotool BadWindow output. Owned drivers were stopped with PID/birth checks; zombies are not described as fully reaped.

# Native cleanup observation preflight

Linux private-engine Rust tests: **61 passed, 0 failed**. Windows GNU `cargo check --lib --tests`: **passed**, not Windows execution. Closed audit worst case: **4250-byte started / 7388-byte finished**, within the unchanged 8192-byte limit; Ready retains 4096 bytes.

The patch preserves the 50/250 ms join and 3-second tree-removal bounds, existing handle lifetimes, token policy, failure semantics, and cleanup gates. It records bounded numeric tree deletion facts, fixed cleanup timings, and three IPC progress snapshots per stream. Eight direct tree-observer regressions cover success, NotFound, errors, exhaustion, absence verification and closed serialization.

Commands, exact source hashes and raw-log hashes are in `native-cleanup-observation-preflight.json`. The initial stale seven-field audit assertion log is retained separately; the corrected ten-field assertion and final suite passed. Windows check emitted only two existing compatibility-wrapper dead-code warnings.

Run 41692476025 remains failed: its exact private-tree OS error is unknown. This patch requires a new real dual-account product run; no smoke, remote run or retry was launched here.

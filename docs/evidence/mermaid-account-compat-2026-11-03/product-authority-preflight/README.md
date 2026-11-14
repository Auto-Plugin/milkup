# Conditional linked-authority product preflight

The final candidate's local verification passed 51 private Rust tests and 119
Node product-audit/payload regressions. Windows GNU cross-compilation checked
the native library and its tests; it did not execute Windows or render a diagram.
The independently reviewed implementation uses actual identification-only
linked-token evidence and four native sandbox observations before source delivery.

The original byte budgets remain unchanged: maximum tested Ready is 1803/4096
bytes, started audit 4250/8192 and finished audit 5803/8192. Node's realistic
32-request report fixture is 626890 bytes; the normal run still must satisfy
all existing per-launch/report/cleanup limits. Late cancellation before the
started record retains partial parent observations without inventing helper
proofs; successful rendering still requires all four observations.

Final logs and source digests are retained beside this note. The initial local
compile failures from an incomplete JSON macro edit are also preserved, clearly
separated from the corrected final passing logs. Actual two-account Windows
body rendering, close behavior and C4 output remain pending at this preflight.

The delivered beta.8 ZIP and original installation reports remain unchanged.

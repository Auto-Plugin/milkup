# Helper process exit observations — diagnostic only

Run only after independently verifying the actual API records, ZIPs and extracted
files. This script does not repeat those integrity gates or run any Windows code.
It uses Python's standard library only and writes one new output file.

```sh
PYTHONDONTWRITEBYTECODE=1 python3 summarize-helper-process-exits.py \
  --evidence-root /workspace/mermaid-rebuild-evidence/windows-installed-41713129442/extracted/installed \
  --candidate a5556beea5cdd1570361c528b2326bc0ad8ba0c4 \
  --run 41713129442 \
  --output /workspace/mermaid-rebuild-evidence/windows-installed-41713129442/helper-process-exit-statistics.json
```

The output path must not exist. Exit code zero means statistics were produced,
never acceptance. The output explicitly records `nonAcceptance=true` and that a
signaled helper is not EOF, Job completion, or native cleanup proof.

Every retained native log event must exactly equal the corresponding sequence in
`report.nativeAudit`, including boolean versus numeric values. Missing fixture
logs remain listed. Per-request output retains both original snapshots and the
original cleanup, IPC, tree, renderer and PNG outcome fields. Missing helper
observations, explicit null, and unfinished requests remain distinct. An already
created Job with null/missing helper observation is counted as missing; nothing
is fabricated. A signaled helper can coexist with 995 and failed cleanup.

The helper snapshot schema is checked against the reviewed candidate's closed
`audit.rs` output. Schema validity supplies diagnostic consistency only. The
existing strict native ledger, PNG, Job, EOF and cleanup gates remain necessary.
Tree error 5 followed by another recorded attempt and stream error 995 are
counted independently; all original relevant fields remain available per request.

`helper-process-exit-statistics-preflight.json` retains seven synthetic checks,
script/test hashes and the exact candidate producer-source hashes. These tests
do not establish anything about the current Windows run. No actual Windows
artifact statistics had been generated when this script was prepared.

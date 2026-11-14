# Frozen production latency baseline

ELF `f15c476a4f6e7b5f254e325692d57e9bfaa798580441dd3554f6c4fe1e9d802e`; source `fa530b399a5ebbd020f9bfa7ca039378604c8282`.

Six fresh-profile runs, each 20 cycles / 143 total records; all completed. Root ran the first 179219-byte source run; this delegate ran the remaining five. Exact commands, source snapshots, input hashes, logs, individual samples and violations remain preserved.

| Route / mode | Actual bytes | Input p95/max | Delete p95/max | Jump p95/max | First search | Open / save |
|---|---:|---:|---:|---:|---:|---:|
| ordinary EditorView / source | 65555 | 125.0/195.0 | 130.0/185.0 | 42.0/50.0 | 233.0 | 3351.4/205.0 |
| ordinary EditorView / live | 65555 | 228.0/251.0 | 459.0/568.0 | 97.0/664.0 | 310.0 | 3354.9/199.0 |
| memory SourceDocumentView / source | 179219 | 99.0/102.0 | 64.0/107.0 | 77.0/120.0 | 488.0 | 3891.9/265.5 |
| memory SourceDocumentView / live | 179219 | 94.0/151.0 | 61.0/163.0 | 73.0/89.0 | 271.0 | 3296.4/154.5 |
| native large-file SourceDocumentView / source | 10485779 | 98.0/101.0 | 65.0/71.0 | 65.0/157.0 | 546.0 | 4144.8/228.2 |
| native large-file SourceDocumentView / live | 10485779 | 36.0/56.0 | 40.0/60.0 | 57.0/95.0 | 566.0 | 3193.2/293.4 |

All table times are milliseconds. p95 uses nearest rank; jumps combine 80 samples, with first-target/warm/after-edit subsets retained separately in JSON. Input and deletion each have 20 samples. Search, open and save each have one observation per run, so no statistical p95 claim is made for them.

Ordinary Live EditorView failed nine 200ms operation targets: input rounds 0/1 (251/228ms), deletion rounds 0/1/2/3 (568/220/214/459ms), clean warm Home round 19 (664ms), after-edit End round 2 (276ms), after-edit Home round 4 (212ms). Its observed SourceDocumentView marker was false and timer gap reached 662ms; no worker/CSP errors were recorded. No root cause is proven. Other five runs had no 200ms input/deletion/warm-jump violation. Both native large-file first-search observations exceeded their 500ms target: source 546ms (DOM 465ms), live 566ms (DOM 499ms). These are retained failures; no rerun replaced them. The original harness exits 0 after recording budget violations, so the orchestration explicitly stopped with exit 1 on each affected run before inspection and continuation of independent cases. Full scenarios completed without harness exception; this does not make their performance targets all pass.

The 179219-byte cases are memory-windowed, not ordinary EditorView: observed SourceDocumentView plus the frozen 128KiB/256KiB open policy establishes the distinction. The 65555-byte cases actually observed backend=false and exercise ordinary EditorView. For 10485779-byte cases, native routing is inferred from actual file size plus frozen policy and observed SourceDocumentView, not from backend=true alone.

All six final file SHA-256 values match their original fixture hashes after reversible edits and save. WebKit reports longtask unsupported, so absence of longtask entries is not a responsiveness proof. Load and cgroup CPU/memory records remain in each samples.json. No CPU throttling counter increase was observed across the source large-file run; root cause of first-search misses is not established.

Sources were minimally extended to permit an additional 65536-byte fixture; existing stress sizes, targets, cycles and event mechanics were unchanged. v1/v2 source snapshots and hashes are both retained. No product build or environment security change occurred during measurement.

All owned driver groups stopped after each run; control records may show non-running zombies, not fully reaped processes. Xvfb :127 remains for root keyboard tests. Old :126 was not touched.

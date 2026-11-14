# P6 milestone03 Windows catalog evidence

This checkpoint records exact source checks and real Windows catalog filesystem tests, separately from Linux native tests and desktop UI acceptance. It contains no installer, runtime or compiled executable.

- `environment-preflight.json` is the pre-CI observation, not the final result.
- `windows-ci-01-failed.log` preserves checkout failure before any test ran.
- `windows-ci-02.log` preserves the verified unsupported baseline RED and current backend failure (9 passed / 27 failed).
- `windows-ci-03.log` records verified baseline runtime RED and the corrected backend: 36 unit + 3 fresh-process tests passed, zero failed/ignored.
- `final-source-proof.json` reconciles exact Git LF and Windows CRLF hashes for all three Rust files and Cargo.lock.
- `windows-ci-0*-metadata.json` records run SHA, jobs, conclusions and artifact counts.
- `catalog-core/` records shared Linux tests, Windows target compilation (not runtime), and exact source hashes.
- `native/` records the Windows design, independent review, and existing DOM watchdog failure/serial rerun analysis.
- `manager/` records execution-support wording RED/GREEN, typecheck and scope review.
- `desktop-native-tests.log` is a real failure despite the external runner shell returning zero; `desktop-native-tests-serial.log` is the separate passing serial rerun.

Earlier hashes describe their exact run inputs; final source and result correspondence is recorded separately. Original failure records are not rewritten to green.

Run `python3 verify-index.py` in this directory to verify every archived byte against `final-index.json`. Passing the index validates integrity, not every test outcome. Windows source-level success does not establish WebView2/Tauri UI, installers, arbitrary power-loss durability, macOS, sidecar activation or P5 PDF acceptance.

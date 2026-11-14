# Catalog core harness verification

The independent `tests/native/catalog-core` crate directly compiles the real desktop catalog source. Shared transaction tests were extracted without production hooks. Six new shared tests and three fresh-process tests cover CAS, disk and commit failure, interrupted state recovery, sidecar refusal, and cross-process lock exclusion.

Linux completed 30 unit tests and three process tests (`linux-first.log`). Current Windows-target compilation including tests passed (`windows-check-first.log`). The exact baseline source plus the baseline runner's Rust regression also compiles for Windows (`windows-baseline-compilation.log`); this last check used a local Python materialization of the script's Rust test, not PowerShell execution.

`run-windows-baseline.ps1` verifies the fixed original source byte hash, executes a named failing Windows NTFS regression, requires runtime unsupported failure rather than compiler failure, then explicitly resets LASTEXITCODE only after successful RED validation. `run-windows.ps1` executes the full current suite. Root owns Windows CI execution and evidence; this Linux verification does not claim Windows runtime PASS or a reproduced Windows RED.

The public crate adds no dependency versions beyond the desktop lockfile and brings no Tauri/WebView2 dependency. Rust formatting passes. `sourcehashes.json` freezes source inputs for this local review, and `proof.json` records exact boundaries. No toolchain installation, CI dispatch, commit or push was performed by this agent.

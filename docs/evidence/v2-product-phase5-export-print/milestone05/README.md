# Milestone 05 evidence — selected WebKit route, unresolved output defects

Read `DECISION.md` first. Chromium product commit `3e9e0347` was withdrawn by ordinary revert `3946345e` after the explicit user choice to retain existing dependencies and pursue a WebKit engine patch. No history was rewritten. Current application/package/plugin code matches baseline `7241f8b8`; this checkpoint adds evidence, independent fixtures and a native test synchronization wait.

- `baseline-production-pdf05/`: actual original WebKit production PDF, now executed after normal approval retry. 17 pages match previously reviewed pixels; copy/search remains FAIL.
- `baseline-production/`: actual original WebKit binary `f2991198…` and independent output plugin 1.0.0 `08cd8532…`. HTML10 and Large05 each complete 32 layout cases. Large04 keeps its earlier menu-wait failure. Cancel08, Disable04 and Overwrite07 retain source hashes and process/window cleanup. Print-file04 generates a file but its diagram falls back to source; rich printing is FAIL, not passed.
- `html10-screen/`: separate exact-byte content and screen review of genuine HTML10 outputs. The Chromium viewer here is a test viewer, not the withdrawn product output backend.
- `webkit-patch/`: source-scoped review-only prerequisite diff, reference models, source hashes and build/ABI/deployment blockers. No modified engine was built or run; no complete PDF fix is claimed.
- `content/`: original failure cases, exploratory comparisons and independent Unicode/pagination audits. Unicode normalization cannot hide missing characters. Expanded Arabic extraction remains red.
- `chromium-*`, `native-integration/`, `plugin-print-cancel/`, `host/`, `production-chromium-research/`, `checks/`: withdrawn candidate research. Its passing tests do not describe new behavior in the restored product.

`distribution-size-comparison.json` measures ELF and gzip-of-ELF sizes only, not installer delta. No browsers/fonts/Runtime were bundled, downloaded or added as automatic package dependencies. No Windows build/upload, Library upload, physical printer job, Release, deployment or merge occurred.

Run `python3 verify-index.py` here to verify immutable evidence bytes. Each report's status remains authoritative: checksum verification is not a quality pass. Full original evidence and unique research binaries remain outside the checkout under `/workspace/milkup-export-print-evidence/`; no profiles or executables are committed in this archive.

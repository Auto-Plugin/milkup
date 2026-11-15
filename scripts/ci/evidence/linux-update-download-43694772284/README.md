# 43694772284: QA log-check failure before native About execution

Exact executed QA SHA: `e52d6dfc0018a0ced98acc41b022b43feb665533`, branch `dot/linux-update-download-qa-20261115`. [Run](https://github.com/Auto-Plugin/milkup/actions/runs/43694772284) ended **failure**. This was the only dispatched run; no rerun/rebuild followed.

## Actual completed work

- Ubuntu 26.04 ordinary-user WebKit preflight navigated with `sandbox=1`. AT-SPI bus/DRI3 warnings are retained; this is not IME/accessibility/accelerated-rendering acceptance.
- Local feature/installation-block contract and real ephemeral loopback TLS/signature server tests passed. Keys were generated only in memory and never committed/uploaded; those contract tests use synthetic bytes, not native application traffic.
- The original target archive was length/SHA/CRC verified; exact retained deb is package `milkup`, internal version `2.0.0-beta.10`, architecture `amd64`, 9,854,742 bytes, SHA-256 `9e71e2b6f6c5cd030f7307d35679ded1d4f5605127d77320db1d455d90c1ddde`, source `58c78973101acb0a22ca0cb5d24ef24bd9edc199`. It was only read, not installed.
- The one QA old application (`2.0.0-beta.9`, a current-source version fixture, not historical beta.9) linked successfully at **08:35:20 UTC**, after 3m54s release compilation. No installer was built. The feature disables installation at both host command and vendored updater entry points and restricts update traffic to its bounded literal-loopback authority.
- The actual Rust loopback URL test ran **1 passed, 0 failed, 0 ignored, 280 filtered out**, at **08:36:34 UTC**. It covers exact accepted URI and wrong scheme/host/port/path/query/fragment/credentials.

## Exact failure and execution boundary

Immediately afterward, the shell's test-log check used `rg`, which was absent on this runner:

```text
08:36:34.5338693Z ...sh: line 9: rg: command not found
08:36:34.5351212Z Process completed with exit code 127.
```

This is an assistant-authored QA dependency mistake, not a compiler, download, signature or product failure. The entire native About step was **skipped**. There is no application UI check/download/verify/clear/edit/close result, no real rejected-package result, no authorization dialog result and no install/restart result. The fixture executable hash step was after the failed check and did not run; the executable was deliberately excluded from artifacts, so no reusable exact fixture binary/hash was retained. A built application path in the log is not package identity evidence.

The runner was not asked to authenticate, install the target deb or change package-manager/polkit/sudo policy. Official build/GUI dependencies were provisioned in the isolated job; that is distinct from exercising the application's privilege path. Production channel JSON, Tauri configuration/capabilities and pnpm lock are unchanged from integration, as recorded separately. The test-only version/feature changes stay on this QA branch and are not suitable for product integration.

## Prepared correction; not rerun

Replaced the missing-rg check with `check-linux-update-unit.mjs`, using already-required Node. It requires exactly the named test once, a single summary, 1 pass/0 fail/0 ignored/0 measured. Local tests reject missing, zero, ignored, failed and duplicate results. All three Node contract tests pass; the corrected gate also passes against this run's original unmodified `loopback-unit.txt`. No safety or acceptance condition was relaxed.

This fixes only the known workflow blocker. It is not a new native pass. The native harness, process close and actual runtime update state remain unexecuted. The one-run budget is exhausted, so no automatic continuation was dispatched. A subsequent attempt would require a separate decision about the lost fixture executable and the additional build; this report does not authorize it.

## Raw evidence

Artifact **14154058394**, `milkup-linux-update-download-only-43694772284`, 3,067 bytes, SHA-256 `5c8f824597797d333d6afad6fe0fca01542f5b93eec7a74f0908b971b5b7c74a`; expires **2026-11-22 08:36:34 UTC**. Retrieved ZIP length/hash/CRC/path checks passed. It contains exactly `preflight.txt`, `target-identity.json`, `loopback-unit.txt`.

`job.log.gz` is a lossless gzip of the original decoded job log, 208,345 uncompressed bytes, SHA-256 `f6816019dcdeea57fe3c788a7bd4296e041b5aa8647ff17b5c86f8cf91df7a10`. No private signing/TLS key or test executable is included. Local copies: `/workspace/milkup-linux-update-download-evidence-20261115/`. The complete failure is retained rather than rewritten as a pass.

Main, product integration, production authority, notification and security settings remain unchanged; no release or publication. Windows/PDF tests were not repeated.

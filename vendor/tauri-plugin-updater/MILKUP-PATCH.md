# milkup local updater patch

This is **tauri-plugin-updater 2.10.1 with a local milkup patch**, not unmodified upstream 2.10.1. The original crate archive SHA-256 is `806d9dac662c2e4594ff03c647a552f2c9bd544e7d0f683ec58f872f952ce4af`, matching the previous application Cargo.lock checksum. The archive was read from the existing Cargo cache; no dependency was downloaded or added. Its Apache-2.0 OR MIT license files and original copyright notices are retained.

`MILKUP-PROVENANCE.json` records original and reviewed file hashes. `MILKUP-PATCH.diff` shows the complete source changes. The original vendored Cargo.toml and Cargo.lock are retained byte for byte; the latter is an upstream distribution artifact, not the application's resolution lock. The application's Cargo.lock changes only this package from registry to local path (removing source/checksum); all package versions and dependencies remain identical.

Upstream discards ShellExecuteW's result and unconditionally exits. It also invokes `on_before_exit` first; UpdaterExt supplies `AppHandle::cleanup_before_exit` as the default callback. Merely returning an error after launch would therefore leave the app already cleaned up. The local patch keeps extraction, signatures, URLs, arguments and public APIs intact and calls a private Windows launch helper. A result <=32 returns an IO error before cleanup or exit; a result >32 runs the existing callback and then the existing exit. The callback documentation now describes this ordering. This follows [Microsoft's ShellExecuteW result contract](https://learn.microsoft.com/en-us/windows/win32/api/shellapi/nf-shellapi-shellexecutew).

The helper has no public launcher API or configurable executable. Its only production caller supplies the existing updater-generated extracted path and arguments. There is no alternate signature verifier, key, endpoint, installer or download path. No claim is made that OS acceptance means installation completed, the new application started successfully, or rollback is implemented.

Validation:

- `node --test scripts/check-updater-vendor.test.mjs` checks provenance and rejects modified source, licenses, extra files and registry lock drift.
- `cargo test --locked --manifest-path apps/desktop/src-tauri/Cargo.toml -p tauri-plugin-updater --lib windows_install::tests:: -- --nocapture --test-threads=1` runs the private policy tests and, on Windows, the actual ShellExecuteW missing-path regression. List tests first and require both names to avoid accepting an empty filtered run.
- `rejected_launch_preserves_app_and_can_be_retried` tests rejected result codes and a simulated accepted result. The success case never starts a process.
- `real_missing_executable_returns_error_without_cleanup_or_exit` is Windows-only and calls the actual production helper twice with an absent executable in a new temporary directory. It checks errors, application survival, and no cleanup/exit callbacks. It creates no executable and launches no installer. It does not establish real installer acceptance, UAC cancellation, GUI behavior, or automatic rollback.

Remove this patch only after an independently reviewed upstream fix and repeat the same Windows failure regression. Do not infer Windows runtime success from Linux policy tests or mocked host errors.

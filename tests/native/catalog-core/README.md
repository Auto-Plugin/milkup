# Native catalog tests without Tauri

This private test crate compiles the actual desktop `plugin_catalog.rs` using a Rust `#[path]` module. It does not copy the implementation, link Tauri, execute `build.rs`, launch WebView2, build an installer, or upload artifacts. The desktop's shared `plugin_catalog_tests.rs` runs in both this crate and the ordinary desktop Rust unit suite.

The implementation's sole Tauri type reference is `tauri::Url`. This crate aliases itself as `tauri` and reexports the identical `url::Url` type/version used by Tauri. There is no substitute parser or filesystem mock. Direct dependencies are pinned to the desktop lockfile versions; the separate lockfile contains only their dependency closure. Keep both lockfiles aligned when intentionally updating these dependencies.

## Run

On Windows with an existing x64 MSVC Rust toolchain and MSVC linker, from the repository root:

```powershell
./tests/native/catalog-core/run-windows.ps1
```

The script runs `cargo test --locked --manifest-path tests/native/catalog-core/Cargo.toml --target x86_64-pc-windows-msvc --all-targets -- --test-threads=1`, uses a temporary target directory, preserves its previous environment value, propagates test failures and prints platform/source-hash evidence to stdout. `-Offline` requires pre-cached Cargo dependencies. `-TargetDirectory <path>` selects a different build cache. It installs no toolchain or runtime and requires actual Windows. A CI caller may retain console logs without any upload action.

On Linux:

```bash
CARGO_TARGET_DIR=/tmp/milkup-p6-catalog-core-target \
  cargo test --locked --manifest-path tests/native/catalog-core/Cargo.toml \
  --all-targets -- --test-threads=1
```

A Linux host with the Windows Rust standard library can check the Windows code without linking or running:

```bash
CARGO_TARGET_DIR=/tmp/milkup-p6-catalog-core-target \
  cargo check --locked --manifest-path tests/native/catalog-core/Cargo.toml \
  --tests --target x86_64-pc-windows-msvc
```

That last command is compilation evidence only. It does not establish Windows filesystem behavior or UI acceptance.

## Shared tests and faults

The prior 24 tests were scoped to `cfg(all(test, unix))`. Of these, 22 use platform-independent Rust/catalog APIs; `sealed_worker_snapshot_rejects_mutation_and_symlink` now runs its content-tamper portion on Windows, retaining only its symlink block under Unix. `package_symlink_never_reads_or_writes_outside` remains Unix-only. Windows reparse-point/handle tests live with the Windows disk backend; Unix symlink tests are not presented as Windows coverage.

Six additional shared regressions exercise same-ID revision CAS under concurrent calls, ordinary read preservation of live trial/startup state, backup replacement failure without primary authority loss, corrupt primary plus corrupt backup fail-closed preservation, candidate tamper between trial and commit, and explicit sidecar trial rejection. Test-only `stage-file`, `before-catalog-replace`, `gc-delete`, and free-space hooks remain inside `cfg(test)`; a directory at the backup leaf creates an additional real filesystem failure without privilege changes. Low-space tests do not fill the disk.

`tests/process_boundary.rs` executes the separate `catalog-probe` test binary in fresh OS processes. It verifies interrupted trial and startup recovery, stable repeated recovery, and native file-lock exclusion between processes. The probe links the same production catalog functions without `cfg(test)` fault hooks. Its seed commands perform legitimate catalog transitions and exit before completion; a subsequent process must recover the persisted state. This is deliberate interrupted-state coverage, not arbitrary power-loss simulation. The probe is confined to this unpublished test crate and is not linked into the desktop application.

All fixtures use unique temporary roots and clean up their own roots. Tests preserve old package bytes, raw migration backups and user data across failure/recovery. Sidecar restricted trial remains rejected. Passing these tests establishes the exercised native backend behavior; it does not establish Windows WebView2/UI behavior, all filesystem/crash failure modes, or a complete adversarial plugin sandbox.

## Actual Windows baseline RED

Before the current suite, Windows CI may run:

```powershell
./tests/native/catalog-core/run-windows-baseline.ps1
./tests/native/catalog-core/run-windows.ps1
```

The baseline runner reads the exact original catalog source from Git commit `4e0d305bab563e3fc58aa97bb18115b6bf8f69d6` into an isolated temporary crate using the same dependency lock and URL alias. Git must contain this commit. It executes a new regression that expects `read` of a fresh fixed local NTFS profile to succeed. The original backend fails that expectation with its `unsupported` error. The script accepts only the named test's runtime failure, exit 101, the exact unsupported diagnostic and `0 passed; 1 failed`; a compiler/linker error, wrong test or unexpected success fails the runner. Its successful exit therefore means **expected RED verified**, not baseline functionality passed. Current full tests must then pass separately. Temporary baseline sources are cleaned up; source hash and test output remain in stdout. No historical implementation is rewritten or committed into this crate.

The baseline source must match SHA-256 `b04225d2b48cba126f154ba65e8bdb5485b2b103589de87c0be8f907459e8fb4` after materialization; altered encoding/newlines fail before Cargo. Only after every expected-runtime-failure check succeeds does the script reset `$global:LASTEXITCODE` to zero, so GitHub PowerShell wrappers accept the verified RED step. Errors still throw; the `finally` cleanup never resets failure status.

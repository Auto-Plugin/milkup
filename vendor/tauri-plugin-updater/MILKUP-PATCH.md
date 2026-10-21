# milkup local updater patch

This is **tauri-plugin-updater 2.10.1 with a local milkup patch**, not unmodified upstream 2.10.1. The original crate archive SHA-256 is `806d9dac662c2e4594ff03c647a552f2c9bd544e7d0f683ec58f872f952ce4af`, matching the previous application Cargo.lock checksum. The archive was read from the existing Cargo cache; no dependency was downloaded or added. Its Apache-2.0 OR MIT license files and original copyright notices are retained.

`MILKUP-PROVENANCE.json` records original and reviewed file hashes. `MILKUP-PATCH.diff` shows the complete source changes. The original vendored Cargo.toml and Cargo.lock are retained byte for byte; the latter is an upstream distribution artifact, not the application's resolution lock. The application's Cargo.lock changes only this package from registry to local path (removing source/checksum); all package versions and dependencies remain identical.

Upstream discards ShellExecuteW's result and unconditionally exits. It also invokes `on_before_exit` first; UpdaterExt supplies `AppHandle::cleanup_before_exit` as the default callback. Merely returning an error after launch would therefore leave the app already cleaned up. The local patch keeps extraction, signatures, URLs, arguments and public APIs intact and calls a private Windows launch helper. A result <=32 returns an IO error before cleanup or exit; a result >32 runs the existing callback and then the existing exit. The callback documentation now describes this ordering. This follows [Microsoft's ShellExecuteW result contract](https://learn.microsoft.com/en-us/windows/win32/api/shellapi/nf-shellapi-shellexecutew).

The helper has no public launcher API or configurable executable. Its only production caller supplies the existing updater-generated extracted path and arguments. There is no alternate signature verifier, key, endpoint, installer or download path. No claim is made that OS acceptance means installation completed, the new application started successfully, or rollback is implemented.

## Signed metadata and bounded transport checkpoint

The later update checkpoint extends `src/updater.rs`; the complete diff and hashes include both patches. Cargo manifests, lockfiles and dependency versions remain unchanged.

- All manifest responses accumulate at most 256 KiB before JSON parsing. Declared lengths and actual chunks are checked; exact-limit bodies are accepted, truncation fails. Package accumulation is capped at 256 MiB before extending its buffer. These are body limits, not whole-process RSS limits.
- Manifest and package redirects are rejected, including same-origin redirects. Only HTTP 200 bodies and the manifest's existing 204 no-update response are accepted. The host still requires credential-free HTTPS and owns endpoints/public keys.
- `UpdaterBuilder::require_signed_manifest(product, channel)` is an explicit local Rust API extension, used by the milkup host. It verifies a bounded base64 payload with the existing minisign verifier and host key before parsing the signed schema/product/channel/release statement. Platform selections, version and artifact signatures are signed together; unsigned fallback is not allowed in this mode.
- `Update::has_verified_manifest()` checks the retained authenticated version/signature/URL/target selection against the upstream public fields. Changing those fields invalidates the selection. Download and install reject a changed authenticated selection. The host also rejects legacy unsigned candidates before publication, download and installation.
- Package signatures still verify the downloaded bytes independently; installation rechecks them before extraction or launch. No installation is exercised by metadata tests.

The existing upstream builder remains usable without signed metadata for isolated legacy crypto tests; milkup's production host always opts in and its publication/download gate additionally requires the verified selection. This is not exposed as a plugin-controlled trust setting. The public plugin SDK is unchanged.

The wire format, trust limits and formal release prerequisites are documented in [the update manifest protocol](../../docs/v2-update-manifest-protocol.md). In particular, authenticating a publisher's version-to-artifact statement does not inspect or prove the version inside an installer, nor provide automatic application rollback, freshness against a frozen server, or recovery from a compromised signing key.

Validation:

- `node --test scripts/check-updater-vendor.test.mjs` checks provenance and rejects modified source, licenses, extra files and registry lock drift.
- `cargo test --locked --manifest-path apps/desktop/src-tauri/Cargo.toml -p tauri-plugin-updater --lib windows_install::tests:: -- --nocapture --test-threads=1` runs the private policy tests and, on Windows, the actual ShellExecuteW missing-path regression. List tests first and require both names to avoid accepting an empty filtered run.
- `rejected_launch_preserves_app_and_can_be_retried` tests rejected result codes and a simulated accepted result. The success case never starts a process.
- `real_missing_executable_returns_error_without_cleanup_or_exit` is Windows-only and calls the actual production helper twice with an absent executable in a new temporary directory. It checks errors, application survival, and no cleanup/exit callbacks. It creates no executable and launches no installer. It does not establish real installer acceptance, UAC cancellation, GUI behavior, or automatic rollback.

Remove this patch only after an independently reviewed upstream fix and repeat the same Windows failure regression. Do not infer Windows runtime success from Linux policy tests or mocked host errors.

## Version/freshness policy handoff

`Update::verified_release()` is a further local read-only Rust API extension. It
retains the authenticated full release JSON privately and returns it only while
the selection binding and public JSON still agree. This prevents the host from
trusting later edits to the upstream mutable `raw_json` field. Download formats,
SDK APIs, dependencies, public keys and endpoints are unchanged by this vendor
addition; freshness/high-water/PE resource policy lives in the application host.

The host now rejects unsigned 204 conclusions and requires signed freshness
fields even for a no-update answer. Earlier paragraphs about freshness being
unimplemented describe the preceding checkpoint; the current scope and remaining
limits are in the [updated protocol](../../docs/v2-update-manifest-protocol.md).
The PE resource gate does **not** prove the embedded NSIS application version,
health confirmation or application rollback. Those remain release blockers.

## Raw signed handoff / offline restart verification

The native-only extension retains the exact authenticated envelope bytes in
Update and exposes them only while verified_release's complete binding holds.
verify_signed_manifest reuses the same minisign decoder with a 256 KiB envelope
bound and required product/channel scope. Its immutable VerifiedManifest carries
only raw bytes and release data: it has no download/install methods and does not
apply or bypass an install-version comparator. Freshness and current high-water
reauthorization remain mandatory host checks, including same-version restart
observations. No IPC command, JavaScript API, dependency, key, endpoint, NSIS
argument or launch behavior changes. See the native handoff checkpoint report.

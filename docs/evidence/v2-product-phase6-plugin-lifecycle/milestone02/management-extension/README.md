# P6 management extension and public SDK 0.3.7

Date: 2026-10-19. Source checkout: `/workspace/milkup`, P6 lifecycle branch.
This evidence covers the public capability, broker/RPC and independently built Worker extension. It does **not** establish native catalog persistence, native installation, host navigation or crash recovery acceptance; those are separate Root/manager/native checks.

## Boundary

`app:plugins` is an explicitly approved sensitive permission. Activation can read bounded `management.snapshot()` and `describe({pluginId,revision})`. Only a trusted command host offers `requestHostView({pluginId,revision,view:'details'|'settings'})`, consuming a caller-bound one-use host gesture. This requests host UI, not approval, installation, activation, setting writes or deletion. Candidate execution is separately gated by the runtime owner. No plugin ID special case is used.

Catalog output contains at most 512 summaries (id/title/description); the extension renders a title-initial logo/title/description only in ordinary lists. Details expose compatibility ranges, declared/approved/difference sets, entry revision, informational candidate fingerprint, sanitized diagnostics and declared setting schema/defaults. Native paths, approval tokens and stored user setting values are absent from the contract. Host adapters remain responsible for sanitizing diagnostic text. Strict closed validators reject extra fields and inconsistent permission/origin differences. Responses are at most 512 KiB, lists and strings have individual bounds, and at most 16 operations are active. Cancellation/disposal aborts pending calls and ignores late delivery; adapter work that ignores cancellation continues counting toward the broker quota until settled.

The extension offers no mutation or approval RPC. A stale revision produces guidance to refresh and requires another user action. Disable/crash recovery must remain independently available in the trusted host shell. A plugin view is not itself trusted host UI.

## Artifacts

- Public SDK: `sdk-dist/milkup-plugin-sdk-0.3.7.tgz`, SHA256 `6e521e3adffdc108166ce49d3e206fce609a9622ba10d2b1e6c646c9d078f111`.
- Independent package: `external/dist/milkup.management-1.0.0.milkup-plugin`, 14,260 bytes, SHA256 `800c6bc03eaa63e06dbd324caeb64eef719920be4defbb3e21d7ca8ba96844b0`.
- Entry SHA256 `49a7e597ae70677783b4a2ffc067d48201619f1e142e755a359f763f83b5a458`.
- Exact external derived lock, input snapshots, build metafile, logs and proof: `external/`. No node_modules or runtime is copied into evidence.

The source extension declares SDK 0.3.7 and exact development tools. External preparation replaces only that dev dependency with the reviewed local public tarball, then uses offline install with scripts disabled, followed by frozen-lock install. Build inputs are only extension source plus public SDK runtime. `external/verification.json` proves no runtime imports. `external/independent-proof.json` records an independent esbuild invocation yielding byte-identical JS and 132 dependency symlinks all within the external directory. `external/sdk-installed-integrity.json` compares all four installed public SDK files byte for byte to the tarball, without extraction. This is an external derived-lock closure, not a claim that the source package had an existing frozen dependency profile.

## Validation and failure history

- `broker-red.log`, `extension-red.log`: initial missing-implementation RED, not behavioural regression proofs.
- `invalid-signal-red.log`: behavioural RED for malformed navigation cancellation options; validation now rejects these before consuming a gesture or calling the adapter.
- `host-targeted-final.log`: 73 PASS across broker (5), RPC (7), sidecar (4), manifest (25), DOM manifest (32).
- `sdk-runtime-final.log`: 6 PASS; `sdk-checks-final.json`: SDK implementation/consumer types and application/SDK version checks pass.
- `typecheck-plugin-final.log`: plugin package types pass (empty successful log).
- `external/tests.log`: 10 PASS including list/detail separation, synchronous trusted navigation, denied capability, close/cancel, stale/late results and inert text rendering. External typecheck and build pass.
- Earlier `external-run.log` and `external-run-02.log` preserve development failures (optional command-host typing and an overly broad assertion matching button disabled metadata). Run 03 is the final success; there was no silent retry/replacement of failure logs.
- `compatibility-registry-first-install-red.log`: new install exposed non-boolean enabled state in concurrent registry work; manager owner fixed `sameScope` to a boolean. `compatibility-final.log` now passes all 4 tests: outline/footnotes/diagrams retain their existing compatibility ranges under SDK 0.3.7, and management requires 0.3.7 without automatic approval.

No registry publication, upload, root install, native UI execution, Cargo build or browser/runtime download was performed by this extension task. SDK additions are optional and incremental; old plugin manifests/ranges and the frozen diagrams SDK archive are not upgraded here. Root owns bundled staging and native acceptance. The independent package can be installed via the standard trusted local-package picker; successful external build is not an installation claim.

## Prepared native acceptance (not executed here)

`tests/native/tauri-p6-management.mjs` is a separate runnable production harness; `node --check` passed. It reuses production startup, GTK picker/native keyboard helpers and public lifecycle fixtures. It requires an owned fresh P6 profile, a frozen production binary and exact binary/package SHA environment variables. Set `MILKUP_P6_MANAGEMENT_ARCHIVE` to the artifact above and `MILKUP_P6_MANAGEMENT_EXPECTED_SHA256` to its SHA. It checks unapproved installation, exact fingerprint/revision approval, activation, minimal list cards, readonly schema and compatibility details, trusted details/settings navigation with no catalog mutation, permission/origin candidate changes, failed-candidate diagnostic display, and the independent host safety shell after disabling this extension. `--preflight` prepares evidence only; use another evidence directory for a subsequent real run because each output has an exclusive run lock. Root owns actual native execution/results.

Source review found a navigation race: closing the requesting extension modal aborts its pending call. Root owns the main-thread ordering fix; no main changes are included in this extension task. The native harness verifies actual destination selection and catalog immutability.

## Catalog boundary follow-up (supersedes the first SDK archive)

The native catalog allows 512 entries, while the initial public projection allowed only 128. `catalog-bounds-red.log` records the mismatch. The schema now permits 512 and the manager uses `projectPluginManagementMetadata` for summary/detail display labels: title and description have JSON-encoded UTF-8 budgets of 256 and 512 bytes, respectively; truncation is code-point-safe and marked `…`. This is presentation-only. Complete permission/origin/version/compatibility information is not truncated. The native list bound of 256 origins and up to 32 native plus 2 compatibility diagnostics are accepted. One detail exceeding the 512 KiB response budget reports unavailable, leaving all catalog entries discoverable and trusted host details available independently.

Four boundary tests pass (`catalog-bounds-green-final.log`): full 512 entries, long mixed Unicode labels with 128-byte IDs, benign metadata preservation/control sanitization, complete long semantic strings and 256 origins with over-budget rejection. `catalog-bounds-all-green-final.log` records all 20 related tests passing with the final stronger 128-byte ID/budget assertions. `typecheck-bounds-final.log` is a successful empty log. Manager owner separately tested the 512-entry projection.

SDK documentation now specifies these limits and accurately describes existing host file broker policy (`plugin-root` sealed/read-only; `plugin-data` separate mutable data scope), without adding a file API. This doc-only SDK repack supersedes the original tarball: `sdk-dist-bounds/milkup-plugin-sdk-0.3.7.tgz`, SHA256 `58973ba8b0db0dd062be5612d4c3058e339205275ebee45f2b31395e5ec965b0`. The original tar/evidence remains intact. Final independent external run: `external-bounds/`, 10 tests/type/build pass, SDK installed four files verified, independent bundle rebuild byte-identical. Plugin package and entry bytes/hashes are unchanged. Use the artifact under `external-bounds/dist/` for final staging.

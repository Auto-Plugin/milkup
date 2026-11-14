# P6 Scheme A cross-review (2026-10-19, 08:55 source snapshot)

Read-only review, no product mutation in this review pass. Source hashes are in `review-source-hashes.json`. Parent immediately assigned fixes; this file records findings at review time, not a claim that subsequent code still contains them. No Cargo or native UI was run by the reviewer.

## R1 — File-write/delete scope points into immutable package generation

`DesktopPluginManager.createFileBroker` passes `roots: [{id: "plugin-root", path: record.rootPath}]` without operation limits. Native catalog projection sets `record.rootPath` to `active.packageRoot`. `filesystem-broker.ts` permits all manifest-authorized operations whenever root.operations is absent. A committed file:write/file:delete plugin can therefore mutate its own sealed generation through the ordinary broker. Candidate activation gating only blocks pre-commit effects. Later SHA verification detects damage but cannot restore the promised immutable verified version. Restrict package scope to reads and bind writes/deletes to retained user data scope.

## R2 — First-install publication failure leaves durable enabled intent

`trialCandidate` commits the candidate, calls publish, and on failure unconditionally rolls back when current.active.id equals the candidate. Native Rollback rejects when there is no verified previous generation. The manager recovery catch only records a diagnostic, leaving the newly committed active generation enabled. On a subsequent startup it is automatically retried despite the known publication failure. Existing publication-failure test only covers an upgrade with a previous version; its fake catalog also permits null-previous rollback unlike native.

`first-install-publication-regression.test.ts` copied the shared fixture and added native-accurate no-previous rejection. `first-install-publication-red.log` is a real failure: expected durable enabled=false, received true. The temporary repository test was removed after capture; no product code was changed. Disable/markFailed the committed candidate when no safe rollback exists or rollback fails; do not leave a known failed activation enabled.

## R3 — Legacy manifest accepted by native can poison the entire strict wire snapshot

Native `manifest_fields` checks installation safety fields but not full TS manifest name/contribution/settings/engine schema. `migrate` originally imported each such matching raw/disk manifest before returning Snapshot. Adapter `generation` calls parsePluginManifest for every entry and rejects the whole response; manager initializeCatalog catches the top-level error and cannot project even valid neighbors. The prior inspector was diagnostic-only and not consumed by migration. A missing name or malformed contributes object is a concrete mismatch.

Parent authorized and assigned the SHA/raw/index/manifest-bound trusted validation hint protocol. Adapter fix/test proof is in `../catalog-adapter/migration-hints-*`; native/root own the independent native import validation and real regression execution.

## R4 — Restored activation drops compatibility errors

`applyCatalog` restores records through PluginRegistry, which adds app/SDK compatibility errors. But `enableCatalogInstance` constructs `generationRecord(entry, active)` with empty diagnostics rather than using that validated record; `enablePluginInstance` only reads the new record's errors. Startup therefore can bypass the compatibility errors after the app/SDK target changes. Candidate installation preflight does not protect an already persisted active generation against a newer/downgraded host target. Every active/pending activation should validate compatibility before loading code. This finding is code-path evidence, not a claimed native reproduction.

No additional blocker was found in generated native wire primitive fields: IDs, nullable fields, safe revisions, approved fingerprints and absolute native paths align with the adapter. Native currently validates pending trial invariants more strictly than the adapter; native remains the authority. Existing known platform/sidecar limits, Worker cleanup work, DOM await/lease work and management diagnostic-path work are intentionally excluded.

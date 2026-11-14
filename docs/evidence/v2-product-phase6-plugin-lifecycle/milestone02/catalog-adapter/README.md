# P6 native catalog adapter evidence

Baseline: `633a6d7910f9fa44b9fa89628967e6b7105071ec`. Shared native wire is documented in `docs/v2-product-phase6-native-catalog-wire.md`; there is no separate adapter protocol.

- `legacy-baseline-red.log`: 2 real failures against the exact baseline registry source preserved as `catalog-baseline-registry.ts`. The baseline accepts duplicate IDs and malformed approvals at parse time. `catalog-legacy-baseline-red.test.ts` records exact reproducer imports; the source was temporarily placed alongside the original manifest dependency then removed.
- `red.log`: initial new adapter suite failed because implementation did not yet exist (not a behavioral failure claim).
- `legacy-concurrent-parser-green.log`: an initial baseline attempt accidentally exercised the concurrently fixed current registry parser and passed; preserved rather than represented as baseline.
- `green-final.log`: 23 adapter/wire/migration tests pass. Tests cover malformed snapshots, duplicate IDs, hashes/approval consistency, tombstone/nonpublication, pending-vs-active separation, native-only authority/no fallback, exact corrupt raw backup input, and legacy structural quarantine.
- `typecheck.log`: desktop TypeScript check passed with no diagnostics at 08:30. `typecheck-final.log`: at 08:33, the parallel in-progress management broker produced six diagnostics outside adapter files; its owner was notified. This later whole-desktop check is not claimed as passing.

The adapter does not grant permissions, read installed package files, migrate storage itself, or claim complete native crash recovery. Native independently validates actual bytes and atomically persists migration before any localStorage mirror write. `inspectLegacyPluginRegistry` is diagnostic-only and deliberately strips all historical capability approvals; native migration always receives the entire exact original raw string even if corrupt. UI mirror records are disabled until the manager explicitly publishes a successfully started generation.

No Cargo, native UI, dependency install, artifact upload or commit was performed by this adapter task. Native failure injection and real Linux proof belong to the root integration pass.

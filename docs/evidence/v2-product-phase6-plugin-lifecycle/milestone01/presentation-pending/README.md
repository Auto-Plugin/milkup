# Explicit presentation pending: SDK 0.3.6

Baseline: `1388f646703ba19c4ed501b0450d123e70388f9a`. Date: 2026-10-19.

This evidence concerns only the core result contract and public SDK. Desktop readiness waiting and the footnotes producer are separate changes owned by the parent/content agents. No native, Windows, Runtime, upload, release, or complete P6 validation is claimed here.

## Red and green

| Evidence | Result |
| --- | --- |
| `core-red.log` | Old core: 2 failed / 11 passed. Pending copy and aggregate validation rejected the new field. |
| `sdk-red.log` | Old SDK: exit 2, TS2353 for pending on SdkDocumentPresentationResult. |
| `core-green-direct.log` | New core: 13 pending tests + 1 existing serializer test passed. |
| `sdk-contract-green-direct.log` | New public-contract TypeScript fixture: exit 0. |
| `core-typecheck-direct.log` | Core TypeScript: exit 0. |
| `sdk-tests-direct.log` | Existing SDK runtime tests: 6 passed. |
| `sdk-typecheck-direct.log` | SDK JS/declaration TypeScript: exit 0. |
| `version-check.log` | `node scripts/check-versions.mjs`: exit 0; SDK 0.3.6, outline 1.3.1. |
| `format-check.log` | Scoped Prettier check after formatting new core test: exit 0. |

The first attempted green commands via pnpm triggered pnpm's dependency-status automatic install after changing SDK package metadata. They failed before testing with ENOENT for `/home/agent/.local/share/pnpm`. The failure logs are retained as `core-green.log`, `sdk-typecheck-green.log`, `core-typecheck.log`, and `sdk-tests.log`; these names do not indicate a pass. No manual install or lock update was performed. Verification was repeated using installed executables directly:

```sh
# cwd: packages/core
node /workspace/milkup/node_modules/vitest/vitest.mjs run src/__tests__/document-presentation-pending.test.ts src/__tests__/document-presentation-serializer-prefix.test.ts
node /workspace/milkup/node_modules/typescript/bin/tsc -p tsconfig.json --noEmit
# cwd: packages/plugin-sdk
node /workspace/milkup/node_modules/typescript/bin/tsc -p tsconfig.contract.json
node /workspace/milkup/node_modules/typescript/bin/tsc -p tsconfig.json --noEmit
node /workspace/milkup/node_modules/vitest/vitest.mjs run
```

## Contract and compatibility

- `pending?: true` is a literal marker; a present marker must equal true and complete must be false. `false`, strings, numbers, null, explicit undefined, arrays/objects, unknown properties, and complete:true with pending:true are rejected. Normal fragment validation and output budgets still apply.
- Copies and aggregate validation retain the marker. JSON transport preserves it. Legacy payloads without pending retain exactly the previous shape and semantics.
- Aggregate construction outside core must propagate pending and force complete:false. Core's aggregate validator is not a merger; it validates the supplied aggregate.
- Existing plugins run on the new host without emitting the field. A plugin that emits pending must require SDK >=0.3.6; the old host rejects unknown fields. All current official plugin dependencies/locks were left unchanged by this work.
- Per-owner 2-second execution limits, cancellation, and isolation were not changed. Host waiting must use the original absolute preparation deadline and recheck document/version/renderer ownership. Permanent incomplete output must not be retried as pending.

## Independent consumer validation still to perform

Pack the public SDK 0.3.6 outside the checkout without dependency resolution; record tarball SHA, install/extract that exact tarball into an external consumer and compile a fixture importing only `@milkup/plugin-sdk`. Include both the new pending-producing renderer and a legacy renderer with no new fields. Build the emitting plugin from a copied input snapshot and require `engines.pluginSdk >=0.3.6`; check no private or workspace imports. Existing closure-frozen plugin profiles may pin an older SDK tarball: do not silently regenerate their locks or substitute a new tarball while claiming the original frozen proof.

JSON transport coverage here does not replace real Worker/Sidecar/DOM protocol tests. Parent integration should cover pending delivery, aggregate behavior, cancellation, version change, revoke, permanently incomplete results, absolute preparation expiry and late delivery. Native readiness and the prior renderer timeout incident are not declared resolved by these contract tests.

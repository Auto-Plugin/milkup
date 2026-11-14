# P6 milestone 02: runtime / Worker / DOM retirement evidence

This directory records implementation and unit/type verification, not a successful production UI rerun. Sources belong to the shared worktree; `source-index.json` freezes this agent's source files by SHA-256. Manager/catalog/CSP configuration/native ownership/SDK management schema changes belong to their respective owners.

## Final behavior

- `preparePlugin(id, { restrictedActivation?, isActivationCommitted?, onActivationViolation? })` activates without publishing actions or render contributions. `publishPlugin(id)` requires the prepared state, no sticky violation, and the trusted commit callback when supplied. The manager supplies this callback; plugin messages cannot commit it. Legacy `enablePlugin` retains ordinary startup behavior.
- Candidate document/settings/data reads and approved filesystem `readText` remain available. File roots and permissions are still checked by the existing broker; desktop catalog roots are read-only package and approved data. Writes/deletes, network, output, navigation and other external operations remain blocked before commit. A caught violation still prevents publication. No persistent write overlay is claimed.
- Root/nested capability gates preserve declared synchronous versus Promise contracts and standard revoked error classes. Late activation and late RPC results cannot restore a revoked epoch. Disable attempts activation disposal and module deactivation independently even if one rejects.
- Worker `error` and `messageerror` reliably enter isolation failure handling. Host cleanup attempts all independent steps and retains failure. `disposeIsolation` binds module retirement directly to trusted owner retirement rather than racing a remote dispose RPC against transport termination.
- Worker initial `dispose()` failure remains observable. `retryDispose()` retries only failed cleanup of the same retained owner and never reopens activation or RPC. Supervisor success requires its trusted child-termination acknowledgment; lost acknowledgment remains unconfirmed even after the parent is terminated. This is not relabeled successful cleanup.
- DOM close revokes immediately and awaits exact native instance stop, then attempts exact lease release even after stop failure. False stop confirmation is an error. Shared initial cleanup promises are idempotent. Explicit retry can confirm release of the same previously issued lease within the same native process, with failed ownership retained by native code; arbitrary unknown leases and cross-process restart are not treated as proof. Local listener/RPC cleanup failures remain visible and retryable.
- Worker bootstrap uses a trusted Blob module wrapper so the document CSP is inherited. Production worker/supervisor probes fail closed if actual eval/Function remain usable. Before importing plugin code, immutable global/prototype guards block unbrokered networking, persistent storage, child workers and code-generation entry points. Root additionally owns CSP configuration and closed-bundle parsing. These measures do not claim a complete hostile-code sandbox. DOM strict-profile eligibility is enforced by the manager/native owners.

## RED → GREEN evidence

Original failures are preserved. `.exit` files record the command exit code.

| Regression | Initial RED | Subsequent verification |
| --- | --- | --- |
| Prepared publication, late activation, independent cleanup | `runtime-red.log` | `targeted-frozen.log` |
| Worker transport errors, raw/persistent capabilities, candidate fetch | `worker-red.log` | `targeted-frozen.log` |
| Late isolated activation and RPC reply | `module-red.log`, `rpc-red.log` | `targeted-frozen.log` |
| Child cleanup attempts and trusted stop acknowledgment | `supervisor-red.log`, `supervisor-ack-red.log` | `targeted-frozen.log` |
| Swallowed forbidden initialization writes | `violation-red.log` | `targeted-frozen.log` |
| Awaited DOM stop and visible cleanup failure | `dom-red.log` | `targeted-frozen.log` |
| Remote module disposal RPC raced against owner transport retirement | `owner-retire-red.log` | `owner-retire-green.log`, `targeted-frozen.log` |
| Existing Promise API rejection and revoked-error contract | parent `../workspace-tests01.log` (3 failures) | `promise-contract-green-02.log`, `targeted-frozen.log`; original broker assertions unchanged |
| Approved candidate file reads over-rejected | `file-read-red.log` (2 failures / 48 passes) | `file-read-green.log` (61 passes: runtime, Worker, existing filesystem scope/permission/symlink tests) |

`targeted-frozen.log`: 14 suites / 172 tests passed before the final approved-read correction. `file-read-green.log` reruns changed runtime/Worker suites plus filesystem broker tests after that correction. `plugin-types-final03`, `desktop-types-final02`, `format-frozen02`, and `diff-frozen02` are the final type/format/diff checks. `file-read-final03.log` repeats the final 61 passing tests after correcting two test-only type annotations caught by `plugin-types-final02.log` (failure preserved). Earlier transient integration/type failures are retained in their original logs.

The production01 raw-upgrade failure is separately recorded under `../native-ui/runs/p6-catalog-raw-01`: its base activation passed, while abort cleanup incorrectly encountered the remote disposal RPC race. This directory proves the targeted correction through unit tests; root owns production02 rerun and its result. No native UI, Cargo build, or browser was run for this final verification.

## Replay

From `/workspace/milkup`, installed local CLIs avoid package-manager auto-install:

```sh
node_modules/.bin/vitest run packages/plugin/src/runtime.test.ts packages/plugin/src/isolation-worker.test.ts packages/plugin/src/filesystem-broker.test.ts
node_modules/.bin/tsc -p packages/plugin/tsconfig.json --noEmit
node_modules/.bin/tsc -p apps/desktop/tsconfig.json --noEmit
```

The larger targeted set in `targeted-frozen.log` covers runtime, Worker/module/RPC isolation, supervisor, editing/output/preferences isolation, settings/workspace/releases brokers, desktop DOM and CSP factory. Source changes after the source-index hash require a fresh freeze; do not infer a final binary hash from these source hashes.

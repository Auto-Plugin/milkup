# Generic virtual-list scheduler — frozen candidate

Only `apps/desktop/src/desktop-plugin-ui.ts` and its test file changed in this task. Product baseline was HEAD78e9329004d2ff244585d98dbe0d7cdd98ab9495. No plugin ID special cases, new public APIs, dependencies, source-document changes, budgets, native execution or GUI changes.

The scheduler now evaluates the latest user scroll at a non-postponed16ms task instead of resetting a160ms trailing debounce on every event. Existing margins/buffer and pointer protection remain. A mount/context-owned requested buffer survives old-slice responses; movements inside it are coalesced. There is at most one scheduler-originated render Promise in flight per scroll context and one latest pending demand. Distant new demand drains after the existing promise settles. No autonomous polling/retry loop was added; unrelated plugin requestUpdate remains able to publish prepared DOM. Neither an old echo nor promise settlement is treated as actual visible-range completion.

Context is bound to document/version/selectionRevision/list identity. Unified reset cancels timer/request/edge/user intent and restores the public viewport from actual mounted metadata. New context cancels the old timer before scheduling; old-context viewport equality is no longer a dedup criterion. Explicit followActive output supersedes old scrolling, and dispatch again consumes the user-intent window so programmatic follow scrolling is not treated as a fresh wheel. Local and cross-slice keyboard navigation cancel pending/in-flight scroll authority without clearing a newer keyboard intent. Existing mount/sequence/doc/version and focus checks remain.

## Actual first failures and final checks

- `red01`: unchanged original product, actual exit1,4FAIL/3PASS/41skipped. Sustained-scroll bounded dispatch, old-echo duplicate suppression, real in-flight serialization, and version invalidation failed. Runtime4.091s. This was a real failing run, not a predicted RED.
- `green01`: initial implementation,48PASS. `green02`: new-version timer and local Home in-flight coverage added,50PASS.
- `navigation-red01`: independent Root finding added against the then-current implementation, actual exit1,2FAIL/50skipped. Same-document selection and followActive navigation were overwritten by the retained old buffer.
- `epoch-red01`: independent catalog finding added against the then-current implementation, actual exit1,2FAIL/52skipped. Same-position new-version requests were suppressed by old public viewport equality, both after old echo and while old promise remained unresolved.
- `green03`: fixes above,54controllerPASS.
- `types01`: actual exit2, preserved. New test fixture recursive inference and exactOptionalPropertyTypes assignments failed; these were corrected. No runtime assertion failure was relabeled as an environment issue.
- `types02`: desktop typecheck actual exit0,10.899s.
- `format-write01`: targeted formatting0; `format-check01`: both changed files actual exit0.
- `green-final01`: final hashes,54controller+5controlled-tree=59PASS, actual exit0,8.507s. End2026-10-19T13:37:25.014147Z; CPU released to Root/content immediately afterward.

Each command has separate `.log` and `.json` with command arguments, start/end UTC, elapsed monotonic duration, actual command exit, and both source hashes before/after. The evidence runner itself exits after printing results; the JSON `exitCode` is the wrapped command's authority, not the shell transport exit. A brief typecheck/format-check overlap within this agent's exclusive slot is visible in timestamps; no native measurement ran concurrently.

Original test count41 grew to54 (13new cases), with5unchanged controlled-tree tests separately included in final verification. New tests use public generic fixture IDs, real controlled DOM creation and explicit synthetic viewport geometry. They check actual row counts/ranges, final focus and RPC counts. They do not simulate native layout timing or prove a200ms physical-paint bound.

No native p95 improvement claimed yet. The16ms delay is a scheduling target, not a hard realtime guarantee; main-thread load can delay timers. New requests beyond the requested buffer remain valid, so the limit is one in-flight plus latest pending per context, not a universal requests-per-second cap. Context changes may overlap a revoked old request until its response arrives; existing lifecycle guards discard stale output.

Frozen source SHA256:

- UI: `9b716cde1a1f1d8d0a700c4efc04c07e3dab3eac876a99efb088dc2dbfa6bafe`
- Tests: `3a4a3e42d4d1b749f8b2603e52300167e05c8d75bae1a9e951c7843b9a0fcee7`

Catalog independent read-only review and Root-controlled native remeasurement remain subsequent work. This file does not approve unmeasured performance or full P7 acceptance.

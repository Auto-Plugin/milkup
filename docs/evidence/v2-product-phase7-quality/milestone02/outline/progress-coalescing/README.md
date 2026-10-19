# P7 M02 outline scan-progress coalescing

Frozen source change: only `plugins/outline/src/plugin.ts` and its `plugin.test.ts`. No index/scan algorithm, queue ordering, cache/row/result limits, public API, permission, manifest or version change. Version remains 1.3.2 pending independent packaging coordination.

The diagnostic first-complete sample showed 8,775 headings / 40,001 lines; `updatePanel` 144 completed / 4,865 ms with one still in flight, `prepareRows` 145 / 58 ms, append queue wait 161 ms, and scan iterator wait 6,750 ms. These overlapping intervals are **not additive**. They support investigating frequent UI feedback, not a claim that append queuing dominates, nor exact host CPU attribution. Original native sample and post-snapshot selector failure remain unchanged.

## Change

Ordinary scan events use a separate 100 ms fixed-window timer. Subsequent events keep its original deadline. The first heading batch bypasses this delay. Completion, invalidation, cancellation, errors, active-heading navigation, folding and explicit scroll retain the original zero-delay refresh and shared queue, clearing pending passive progress. Session retirement clears both timers. Each timer checks the original session/status; old generations cannot publish new-document rows.

Passive scan progress does not advance `renderRequest` until its timer fires, preventing every incoming batch from invalidating existing row preparation. The original request-revision checks and serialized queue remain. Thus the interval is a notification coalescing rule, **not** a guaranteed 100 ms rendered/physical-frame latency bound when queue or host work is busy.

## Preserved validation

- `pre-red.json` / `plugin-before.ts`: before-product-change hashes and original source.
- `red-01.log/json`: **11 FAIL**, 21 unrelated plugin tests skipped, exit 1. Sustained batch test observed 20 public `requestUpdate` calls instead of the one initial update.
- `green-01.log/json`: same 11 regressions **PASS**, 21 skipped, exit 0.
- `outline-compatible-01.log/json`: **36 PASS / 4 SKIP**, exit 0. Includes all 32 plugin tests and four existing index tests. Four other-agent prepared index-prefetch regressions were explicitly excluded by name because their implementation/RED turn had not started. This is not a full current-worktree suite claim; the index owner will run the final full suite.
- `typecheck-01.log/json`: standalone plugin TypeScript exit 0.
- `format-write-01` and `format-check-01`: only the two owned files, exit 0. Formatter left product source unchanged and formatted the new tests.
- `final.patch` / `final-proof.json`: exact final diff, scope and hashes.

The 11 new cases use fake time and a controllable asynchronous public scanner, with actual plugin indexing/store/row logic. They cover fixed-deadline coalescing under 19 distinct batch timer turns, complete 21-title hierarchy, first-heading preemption after an empty progress event, completion and cancellation/error preemption with no later duplicate, immediate active/fold/scroll response, and cleanup on document/version replacement or disposal. These are deterministic semantic tests, not native latency measurements. Full native performance and packaged-plugin verification remain pending.

CPU released after the last format check; no browser/native GUI, dependency install, build or upload was run during this implementation slot.

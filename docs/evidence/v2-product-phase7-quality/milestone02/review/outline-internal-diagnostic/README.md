# Optional internal outline diagnostics — prepared only

Initial preparation status: **PREPARED_NOT_BUILT_OR_TYPECHECKED** (superseded only for `build-01` by the later build record below). This is a separate diagnostic copy, not a product release or evidence of performance. The original production package and Worker-proxy traces must run first. Root decides whether internal phases are needed. No install/build/test/browser/native process was started in preparing this directory. Repository source and M01 evidence were not edited.

## Files and use

- `prepare.py`: exact source-pin and unique-anchor guarded source-copy generator. Source pins come from `../outline-index-readonly-source-proof.json`. It refuses existing output and any output inside the product repository. It copies only six source/build/metadata files, adds `diagnostics.ts`, and writes an input/output SHA manifest.
- `prepared/`: materialized diagnostic source, including unchanged public-only `scripts/build.mjs`; package version `1.3.2-p7diag.1`. Same plugin ID requires a **separate fresh diagnostic profile**, not installation over the product measurement profile. Original permissions, renderer, SDK dependency and algorithm limits remain unchanged. The only added contribution is the diagnostic snapshot command.
- `diagnostics.ts`: bounded implementation; the original outline package uses only public SDK types/capabilities, and the copy adds no runtime dependency or private host import.
- `read-panel.js`: read-only WebDriver executeScript body. Returns `{ok:true,result}` from the single diagnostic `.plugin-list-panel` title; pending, duplicates, invalid JSON, schema/error and payload-budget failures are explicit. It does not read document text or initiate actions.
- `prepared/preparation.json`: SHA inventory and explicit unbuilt status. Future typecheck/build/archive hashes must be appended as new evidence, never inferred from preparation.

Regenerate to a **new** external destination after reviewing source pins:

```sh
python3 /workspace/milkup-p7-quality-evidence/milestone02/review/outline-internal-diagnostic/prepare.py --output /workspace/milkup-p7-quality-evidence/milestone02/review/outline-internal-diagnostic/prepared-next
```

No compilation command has been executed. After an explicit CPU/build GO, use an isolated public-SDK installation and the copied build script; preserve typecheck/build failures and the resulting bundle/archive hash. The existing build script rejects non-public imports and runtime imports. Do not use the root package install or silently change dependency versions. Before native use, independently verify row/output parity apart from the title, complete heading counts, cancellation/generation isolation, and diagnostic type correctness. These checks remain pending.

## Snapshot interface and measurement boundary

The existing panel root span receives a supported `title` attribute with prefix `P7_OUTLINE_DIAGNOSTICS_V1 `. Its value is constant `pending` throughout scanning, so counters do **not** force a different controlled-output signature on every progress render. The first render with status `complete` freezes JSON. No extra visible nodes, CSS, tree rows, controls or summary text are inserted. The title is a browser tooltip and one attribute still enters output validation/signature/transfer; this is instrumentation overhead, not zero perturbation.

A complete-render snapshot occurs while its own `queue.work.refresh` / `updatePanel` spans are still open. Their fourth tuple field explicitly reports in-flight count; do not treat these totals as final. If a fully settled snapshot is necessary, after all measured timings use the **declared public command** `outline.diagnosticSnapshot` (title `Diagnostic outline snapshot (after measurement)`) via the normal approved host command surface. It awaits the current session queue, checks current generation, freezes fresh data, then uses the existing public `host.ui.requestUpdate('outline-panel')`. It returns the same summary string. It does not invoke private host functions. That dump's own UI update is excluded from its snapshot and must not be included in timing results. Each explicit dump increments `serial` and changes title/signature once; do not repeatedly dump while measuring. No automatic extra render/requestUpdate was added at scan completion.

The JSON contains `schema`, `serial`, numeric `generation`/`version`, `status`, `headings`, `scannedLines`, `phases` and `counters`. It retains no document ID/path, title, source line, page key, command input, RPC payload, per-event trace or heading list. Each phase tuple is `[completedCount, totalMilliseconds, maxMilliseconds, inFlightCount]`. Completed includes rejected operations because timing is in finally; it is not a success count. Timings are rounded to 0.01 ms only at snapshot serialization. Generation owns its own diagnostics object; old asynchronous work cannot increment a new session's counters.

## Instrumented boundaries

- `queue.wait.{append,refresh,rangeFlush,finish,command}` and corresponding `queue.work.*`: original session queue dependency, split by literal call sites. Existing navigation/fold/cancel operations retain default command classification.
- `prepareRows`, `updatePanel`: distinguish local row preparation from public UI RPC/host-render acknowledgement. Nested totals overlap and **must not be summed** with queue work as independent time.
- `rows.atLine`, `rows.rank`, `rows.selectRange`, `rows.load`: bounded visibility lookup and row hydration. These preserve the same page and row algorithms.
- `rpc.get`, `rpc.getMany`, `rpc.set`, `rpc.setMany`: plugin-side elapsed waits only. Counts of keys/entries and transferred string **UTF-16 units** are distinct from byte metrics. They cannot separate native/IDB time from scheduling/transport; correlate with external Worker trace if needed.
- `pages.flush`, `flush.serializeEncode`, `flush.utf8`, dirty page counts by metadata/title/visibility, cache hit/miss/put/prefetch-missing and eviction-round counters. UTF-8 byte counts reuse the existing flush size calculation. No additional full serialization or byte encoding is done for these counters. Range flush/finish have queue phases; eviction has its own count. Totals do not identify individual page churn or store failure causes.
- `scan.next.wait`, range count, batch/progress/done event and item counts: scanner iterator await only. It preserves original iteration, cancellation and return behavior without buffering or prefetching. This phase includes start lazily performed by the public iterator, but excludes plugin append processing between next calls. It cannot by itself prove prefix rescanning; host read/checkpoint counters would still be necessary.

## Bounds and overhead

At most **64 phase slots and 32 counter slots per current session**, fixed call-site names and scalar aggregates; no growing samples or key set. Summary JSON is limited to **8,192 UTF-16 units** and otherwise emits an explicit summary-budget error rather than truncation. The host renderer allows `title`; the exact native transport's acceptance of this diagnostic summary remains to be verified after build GO. Its total is also subject to unchanged host output limits.

Cache hits/puts use integer increments, not timers. Timers are around queue tasks, scans, actual page RPCs, row operations and existing flush serialization. Instrumentation adds `performance.now()` calls, closures, a few Promise/await layers, and one final bounded JSON serialization. In particular the queue wrapper awaits its task to close the timer, and selectRange awaits its returned promise; these can affect microtask ordering/latency. Counts and attribution are diagnostic, **not directly comparable uninstrumented performance acceptance**. No claim of unchanged scheduling or measured overhead is made. Do not optimize based on an instrumented aggregate without validating the actual product path afterward.

No algorithm constants, full-title/result support, cache capacity, read budgets, native watchdogs, permissions, SDK interface or product manifest changed. The same rows are constructed by the original code. Source inspection alone does not prove runtime parity; the diagnostic package remains unused until the external trace warrants it and preparation is validated in a released CPU slot.


## Later authorized build — CPU released to native owner

After Root explicitly granted the CPU slot, `python3 build-local.py` reused `/tmp/milkup-p7-outline-external/node_modules`. No installation, dependency download, repository-private import, upload or publication occurred. Both commands exited 0; original preparation remains intact:

- `typecheck-01.log` / `.json`: standalone TypeScript 5.9.3, no emit.
- `build-01.log` / `.json`: copied public-only `scripts/build.mjs`, esbuild 0.25.12.
- `build-proof.json`: SDK 0.3.7 tar SHA `58973ba8b0db0dd062be5612d4c3058e339205275ebee45f2b31395e5ec965b0`; every installed tar file matched. Four bundle inputs are three local diagnostic sources and the public SDK entry; zero residual runtime imports.
- Local archive: `build-01/dist/milkup.outline-1.3.2-p7diag.1.milkup-plugin`, 48,765 bytes, SHA `504153854d2be3bf85d4e3a6f63ba70f098a2be6f11ce01fbdec3427e0183dfb`.
- Manifest SHA `8fbff049cf7b55479e01ca54d4f331dbf30456a5b403adaf167d860ca8b7b38c`.

The separate `build-01/package.json` records the actually reused SDK/TypeScript/esbuild versions, with no install or new lock claim. `prepared/` retains its original preparation metadata. No test suite or native GUI was run by this agent. Native parity and diagnostic summaries remain unverified by the build result.

Confirmed normal public command entry: plugin details renders declared commands as buttons (`desktop-plugin-manager.ts:2626`), and main handles actual `data-plugin-action="command"` click events through `runDesktopAction` (`main.ts:1604`). After the measured index interval, open the diagnostic outline plugin's details and click:

```css
.plugin-detail [data-plugin-action="command"][data-plugin-command="outline.diagnosticSnapshot"]
```

Then close the menu and run the read-only `read-panel.js` body. Keep first-complete and post-command snapshots separately, checking `serial`, generation/version/status and in-flight counters. There is **no added keymap** and no private runtime invocation. Opening/closing details can itself cause public UI refreshes; the later dump is diagnostic post-measurement state, not a retroactive pristine completion sample. If the actual button or title is unavailable, retain that failure instead of claiming a final snapshot.

## Native observation and preserved post-dump failure

The later `p7-candidate-m02-outline-large-internal-01` native run produced a first-complete diagnostic snapshot with 8,775 headings / 40,001 lines. Its `updatePanel` span still has `inFlight=1`; it is not a fully settled final snapshot. The post-measurement dump failed because the suggested `.plugin-detail ...` selector incorrectly restricted the command button to that ancestor: the actual command section is a sibling. The button was visible in the failure screenshot, according to the native owner. This agent had confirmed button generation/dispatch source but had **not** validated that DOM ancestry; the earlier selector recommendation was wrong. The original failed run remains unchanged and will not be rerun just to replace this failure. A future independently authorized run must inspect the actual command section and use the button's declared attributes without the incorrect ancestor restriction. No post-command final snapshot or native diagnostic workflow PASS is claimed here.

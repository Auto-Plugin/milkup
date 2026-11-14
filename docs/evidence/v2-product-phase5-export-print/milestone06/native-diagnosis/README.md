# Native diagrams timeout diagnosis — read-only checkpoint

Baseline inspected: `53f043e86bf162a18db67acef941811a867d1d20`. No product edit, native build, UI operation, replay or deadline change was made. Source hashes and parsed original timing records are in `timing-comparison.json`; the three original driver logs were copied byte-for-byte.

## What the old runs establish

| Run | First request | Observed native timing |
| --- | --- | --- |
| print-file-04 | `render_1` | Deadline observed **2000.312982 ms** after dispatch; guardian kill starts at 2000.557657 ms; cleanup complete 2139.641348 ms; owner confirms 2165.837953 ms; timeout control emitted 2165.953146 ms |
| pdf-05 | `render_1` | Next dispatch `render_3` occurs at **518.919428 ms**; the first active request must have settled before that point |
| html-10 | `render_1` | Next dispatch `render_2` occurs at **563.820868 ms**; the first active request must have settled before that point |

Success-run intervals are **upper bounds on settlement**, not measured renderer CPU time or proof that the first result itself was successful. The request-number gap does not identify a lost response: the RPC client assigns IDs when queued and can remove a queued cancelled job before native dispatch.

PDF05 and Print04 source files have the same SHA256 (`8b4f460fb664ce9b2ef92314dd284404eb4bdfeb28578a34d6dfa08a608454a7`). HTML10 is the shorter base fixture (`d42c908b9be785ed0a9e9ae9c22e91740b12b4cddb7ee48dac088f8415500957`). All use the same recorded frontend assets and approved independent diagrams 1.1.1. The inspected native scheduling/bootstrap/RPC files have no diff from the tested cb928c9e source baseline.

All three `fixture-opened` result snapshots still report document `loading: opening`. The harness waits for the selected path, not settled presentation. PDF runs then select format, paper and orientation; print selects format; HTML starts directly. These are differing interaction schedules, not evidence of a specific race. The first native render could be an editor presentation triggered by opening or an export capture; the old native trace does **not record target or payload**. Do not label `render_1` an export request without new correlation evidence.

Print04's final registry explicitly marks diagrams failed/disabled, and its panel states that unavailable rich fragments retain source. The actual print operation subsequently produces a PDF. This separates the diagrams failure from a PDF writer/GTK print timeout. Remote-inspector bind warnings and GTK widget warnings occur in the successful runs too and cannot distinguish the failure.

## Actual execution and deadline boundaries

1. `plugin_dom_process.rs` launches and arms a separate 10-second initialization deadline. `activate` awaits bootstrap module import and plugin activation. The diagrams plugin activation awaits `document.fonts.ready`. Native `receive` sets `initialized` only after the matching successful activation response. Native `send(render)` rejects an uninitialized instance or an overlapping lifecycle/render RPC. Thus the recorded Print04 render dispatch is **after activation completion**; moving module import/font readiness outside the render deadline is already implemented.
2. `document-render-rpc.ts` serializes work in a frontend queue. The trusted native endpoint supplies timeout authority, so this RPC client does not start its own render timer. Cancelling an active caller does not advance the queue until the remote result or terminal control arrives; this deliberately prevents overlapping execution.
3. `send_plugin_dom_message` runs native send in `spawn_blocking`. `Instance::send` serializes/validates the request, logs dispatch and records `Instant::now() + 2s`, then writes to the helper pipe. The budget includes subsequent pipe scheduling, WebKit execution, serialization and result transfer. It is not reset at helper receipt or cancellation. Time waiting in the frontend queue or the blocking executor before native dispatch is not in this native interval.
4. The helper input thread reads bounded frames into a capacity-two channel. GTK's 5 ms timer dequeues one message, or evaluates a private result-drain call when the channel is empty. `busy` allows at most one `evaluate_javascript` call in flight. Bootstrap dispatch is async and returns `null` immediately; the actual result is placed in a private single-slot mailbox. It is only forwarded on a subsequent drain evaluation and callback. The 5 ms period is a nominal scheduling interval, **not a worst-case latency guarantee**. WebKit/main-loop stalls, a long JS task, a delayed evaluation callback or result serialization can consume the budget. No old trace distinguishes them.
5. The owner reads and parses the result and checks its size before acquiring the control lock. It accepts only the matching validated response and checks monotonic time again immediately before clearing the active request. The watchdog independently checks that same deadline, without owning pipe/GUI locks. A response completing at/after the deadline must not be accepted. Print04 observed the intended deadline to within about 0.313 ms; the later 166 ms is cleanup/notification latency, not extra render allowance.

No proven early native deadline, stale-activation race, overlapping render admission, or result-settlement lock bug was found in this read-only review. The extra drain hop is a real cost but has not been measured as Print04's cause. A transport redesign or shifting the deadline would be unjustified on these logs.

## Separate export queue/cancellation edge

`output-presentations.ts` wraps `options.render` in another 2-second `Promise.race`, started **before** calling the queued renderer. That timeout includes waiting behind editor requests. On expiry it aborts the caller; it does not itself authorize a native plugin timeout or kill. Therefore an export can fall back while a queued request has not yet been dispatched, or while its native budget has only partly elapsed. This is a concrete distinction worth testing, but **does not alone explain the observed native render_1 deadline**.

Likewise, export capture precedes `output_print`. The print dialog/PDF renderer cannot provide additional time for a snapshot's already-failed diagrams. Waiting in a chooser is not a valid performance repair.

## Smallest discriminating next evidence

Root owns native UI/build execution. For one controlled cold print reproduction and an equivalent PDF run, add bounded opt-in diagnostics to the existing trace path, without source text, paths, HTML or tokens:

- Request correlation: native request ID, target (`editor`/`export`), from/to and source/block counts; frontend queue admission and actual pump time. This identifies whether editor first paint is the failed request and whether export waits behind it.
- Native phases: activation accepted; input write finished; helper frame dequeued; WebKit evaluate submitted and callback; result bytes forwarded; owner result frame parsed and accepted. Use the existing monotonic clock and nonblocking bounded diagnostic queue. Do not emit every empty poll.
- Trusted bootstrap local phase timings for renderer entry, renderer promise completion and serialized mailbox-ready, preferably held in a bounded private diagnostic side channel. They must not alter the public result schema or become timeout authority. If no completed result arrives, a separately bounded diagnostic channel is needed to distinguish renderer entry from completion; do not trust plugin-provided timestamps as proof.
- Existing request cancellation and export-capture boundaries, correlated to request ID, so an outer export cancellation is not mistaken for native timeout.

Then choose a fix from the measured expensive stage: remove avoidable duplicated renderer work if that dominates; address a demonstrated transport stall if forwarding dominates; resolve the queue contract separately if export spends its deadline waiting. Do not add sleeps, warm arbitrary document work during activation, alter the 2-second deadline, change sandbox/cancellation behavior, or treat a single warmer successful run as repaired.

A deterministic non-UI regression should also cover a queued export behind active editor work and verify its exact cancellation/settlement behavior. Existing native tests already cover cancelled/malformed results retaining the deadline and rejecting a matching late result; those invariants must remain intact.

**Status:** exact native failure timing and relevant queue boundary established; the Print04-specific slow stage remains unobserved. Additional bounded phase evidence is required before assigning a product-code cause or claiming a fix.

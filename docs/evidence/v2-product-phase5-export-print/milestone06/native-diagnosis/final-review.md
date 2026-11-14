# Final read-only review: queue budget correction and native diagnostics

**No new blocking correctness or isolation defect found in the inspected implementation.** The change corrects export queue/response waiting under the existing preparation deadline; it does not extend the two-second execution deadline or establish that historical Print04 is fixed. No cargo/test/UI command or product edit was performed in this review. Exact inspected source/log hashes are in `final-review-inputs.json`.

## Queue and deadline boundaries

- `document-presentation-service.ts` now passes the **computed absolute** deadline alongside the original signal to every `renderOne` callback. One `provide` invocation shares its deadline across providers/fences; it is not reset per queued job.
- `output-presentations.ts` rejects an exhausted remaining preparation window before enqueueing, uses the remaining duration for its bounded race, and checks the same monotonic deadline after receiving a result. The post-result guard covers a timer callback delayed by frontend work. The original source/version/identity and abort guards still execute around asynchronous work.
- The preparation timer rejects with timeout **before** aborting the child controller, preserving the intended preparation-timeout classification when abort rejection also becomes runnable. A normal user abort remains immediate; timer/listener cleanup remains in `finally`.
- `OutputPresentationOptions.render` still forwards only the ordinary signal to the production manager. `output-service.ts` now references that interface, so the internal preparation deadline is not accidentally required by, or serialized into, the plugin/native execution API.
- Active RPC cancellation retains its queue slot until owner settlement; queued cancellation removes a pending job without dispatch. The real RPC client remains unchanged. Native DOM and sidecar execution constants and Worker supervisor deadlines remain unchanged.

The new queue tests use the actual public isolation host/RPC client with a **simulated trusted owner**. They exercise 1500 ms editor + 1500 ms export, timeout-control propagation/revocation, queued cancellation, active late-result suppression, delayed frontend delivery, old/new version separation, and expired queue removal before late editor delivery. This is meaningful queue integration coverage, but it is not itself a physical native process termination test. The separate native suite covers native deadline/cleanup invariants.

Existing bare unresponsive-renderer coverage now tests the preparation window, and a separate post-result test covers monotonic expiry before the timer callback runs. The service test checks both supplied and fallback absolute deadlines shared by three fences.

## Remaining bounded limitations, not release-blocking findings

1. The internal service assumes deadlines come from trusted `performance.now()` callers. It does not explicitly reject NaN/Infinity. Current export computes its own finite fallback, and the production screen view supplies a finite computed deadline; no plugin or public SDK can supply this value. Finite-number validation remains inexpensive optional hardening if this internal API gains new callers. It is not a demonstrated current production bypass.
2. The ten-second bound is per existing presentation preparation/chunk, not a newly introduced whole-document timeout. The separate output-operation cap still applies. Queue congestion can cause legitimate preparation fallback; a 2100 ms admission reserve does not guarantee enough execution time after queuing.
3. The warning text still describes a “rich renderer timeout” even when preparation expiry was queue/delivery-related. It preserves source and reports failure rather than hiding it, but it should not be cited as proof of plugin CPU overrun or trigger native timeout revocation by itself.
4. The simulated owner test is explicit about its scope. Exact execution termination remains established by native/Worker supervisor suites and actual production runs, not by mock `stop()` assertions alone.

## Native trace review

The new traces reuse the capacity-64 nonblocking `try_send` logger. Request metadata is a fixed allowlist (screen/export, numeric version/from/to); source, document identity, paths, HTML, tokens and result payload are excluded. Extra request metadata is collected outside the watchdog lock. Diagnostic parsing only controls diagnostic emission, never dispatch, result validation or settlement. Empty polls produce no trace events. Optional tracing can add bounded measured overhead and can drop events when full; logs are not timeout authority.

`helper-eval-callback` is the callback for input evaluation, not renderer completion. `helper-result-drained` marks an actual returned result envelope. Cross-process timestamp ordering must account for the owner reading pipe bytes before the helper logs its post-flush event. The existing original deadline checks remain before active-slot clearance, and late/malformed/wrong-ID responses cannot acquire authority from their trace entries.

## Native test log: confirmed 16 passed, 2 ignored

Reviewed `milestone06/checks/native-dom-tests.log`: release-profile test build completed; result is **16 passed, 0 failed, 2 ignored, 136 filtered out**, 12.61 seconds. Both new diagnostic tests passed. Native late-result, blocked-pipe watchdog, cancelled/malformed result cleanup, lease ownership and confinement tests passed. The log has an unrelated existing unused `Arc` import warning in `piece_tree.rs`; it does not report a native test failure.

The two ignored entries have different meanings:

- `plugin_dom::guardian::tests::guardian_escape_worker`: a **private child-process fixture** intentionally ignored by ordinary enumeration. `guardian_adopts_unsampled_escaped_descendant_on_control_eof` explicitly launches the current test binary with that exact test name, `--ignored` and its private environment marker. That parent ownership test passed in this log, so the child fixture was exercised through its intended parent; it is not an unexplained skipped guardian regression.
- `plugin_dom::process::tests::real_webkit_default_module_bbox_resources_and_native_loop_deadline`: requires the freshly built desktop executable and a real display with the WebKit sandbox enabled. It **did not execute in this cargo suite**. Do not count the 16-pass summary as proof of this real-WebKit bbox/resources/infinite-loop fixture. Actual production UI runs remain separately attributable evidence and do not automatically execute every assertion in this ignored fixture.

## Validation/provenance note

At review time `checks/desktop-typecheck.log` still contains an earlier failing run (old optional-property shape, internal source imports and callback-type mismatches). The current reviewed source has the corresponding corrections, but this old log is not a final passing typecheck record. Root should preserve it as failed evidence and record the final rerun separately or identify its replacement explicitly. This reviewer did not rerun checks.

The observed old/new print traces all succeeded, and their small sample does not establish a speed improvement. Production queue-run timing remains to be analyzed when supplied. Historical Print04's genuine native 2000.313 ms deadline failure remains open.

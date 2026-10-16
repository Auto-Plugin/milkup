# Render deadline mechanism diagnosis

Status: diagnostic only. No product changes, browser launches, package changes or budget changes.

Update: the native owner subsequently ran the generated probe in a disposable, all-plugins-disabled production WebKit profile after the view owner released the UI reservation. This author did not launch a browser; that native execution is recorded separately below.

## Evidence and reproducible Node experiment

Run `node /workspace/milkup-markdown-extensions-phase4-evidence/native/deadline-mechanism/probe.mjs`.
The script bundles the original `createDocumentRenderRpcClient` in memory without changing its source and uses actual `node:worker_threads` Workers. Shared atomic timestamps establish completion independently of main-thread message delivery and survive Worker termination. `result.json` records the exact client source SHA256.

Four cases were actually run:

1. Fast renderer, no stall: result accepted.
2. Fast renderer, a main-thread busy wait of 2406 ms: Worker completed in the same millisecond as submission; Node delivered its result after 2411 ms, before dispatching the expired watchdog. Result accepted. **Natural Node scheduling did not reproduce the native failure.**
3. Fast renderer, controlled endpoint withholds result delivery until 2200 ms: completion was established immediately, but the original client terminated it at 2001 ms. **This proves a transport-dispatch deadline mechanism, not the cause or event ordering of the native WebKit failure.**
4. Actual infinite CPU loop, responsive main thread: original watchdog called `terminate` at 2000 ms; Worker never recorded completion. Termination was awaited.

The prior native worker02 observation likewise did not reproduce failure: its largest measured math execution was not the original failed invocation; math25 computed in 7 ms with 332 ms dispatch delay. The original candidate04 render57 still has no internal start/end timestamps. None of these experiments attributes the 2289 ms main-thread gap to a screenshot.

## Next browser experiment, awaiting the UI slot

Use the original client with a real Blob Worker on a blank test page, with no Milkup UI and no changed protocol scheduling. Prewarm the Worker before starting the clock. A separate observer Worker receives render-start, result-created and postMessage-returned timestamps over a transferred MessagePort; it stores these independently of the page event loop and survives termination of the renderer Worker. This avoids needing SharedArrayBuffer/COOP in native WebKit.

Cases, one short trial each initially:

- Fast result without a stall (baseline).
- Fast result with the page synchronously busy for 2400 ms immediately after the original client sends render. Compare internal completion against submission+2000, and client result/timeout. Do not gate, suppress or reorder the original result event in this case.
- Actual infinite renderer with no page stall: require owned Worker termination at the original 2-second deadline within normal scheduler tolerance.
- Optionally, finite 2100 ms renderer plus a 2400 ms page stall: identify whether a genuinely late result can win the event-task race. This diagnoses the opposite side of dispatch-order dependence; it is not necessary to claim the original failure reproduced.

Use absolute wall timestamps for cross-realm correlation and per-realm monotonic elapsed times for duration checks. Record starts, finishes, postMessage, page receipt, watchdog callback, termination and busy-wait interval. A natural false-timeout assertion requires **both** an original-client timeout/termination and independently recorded Worker completion before the original deadline. If the result wins the event race, report “not reproduced,” as in Node. Browser task-source ordering is not guaranteed, so a deterministic stimulus does not promise deterministic failure on every engine. The controlled delivery gate remains a separately labelled mechanism test.

The first target should be the native WebKit engine that failed; a Chromium success/failure only characterizes that engine. Use a disposable diagnostic profile with no active business render jobs, never the acceptance profile: the deliberate page stall could otherwise trip unrelated plugin watchdogs. No plugin archive or production package change is required. Do not overlap browser/UI work with the view owner's reservation.

`prepare-browser.mjs` has generated `browser-probe.js` from the original client; preparation launches no UI. Inject that script in the diagnostic WebKit page, then call `window.runDeadlineBrowserProbe()` through an asynchronous driver command. It returns the three initial cases and independent Worker observations. `browser-preparation.json` records the client SHA. The baseline and CPU-loop controls must pass before interpreting the stall result. This generated script uses the actual Worker as the endpoint without intercepting or deferring protocol delivery.

## Smallest repair choices if evidence establishes dispatch misclassification

| Choice                                                                                         | Scope                                               | Preserves the execution limit?                                                                                                    | Assessment                                                                                                                                        |
| ---------------------------------------------------------------------------------------------- | --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fix demonstrated host layout/request feedback or synchronous blocking; keep watchdog unchanged | Existing view/host code                             | Retains current behavior                                                                                                          | First choice for independently proven host bugs. It reduces triggering conditions, but does not prove the fundamental task-order race impossible. |
| Add time, subtract main-thread drift, retry the deadline, or defer timeout by a task           | Very small client diff                              | No: execution can continue past 2 seconds, and a task yield gives no guaranteed result ordering                                   | Reject as a deadline repair.                                                                                                                      |
| Trust a render-realm completion timestamp, or put its timer inside the render realm            | Small protocol change                               | No independent enforcement: a blocked renderer cannot run its own timer; a termination may occur before the timestamp arrives     | Useful observation only, not the enforcement boundary.                                                                                            |
| Independent supervisor owns the actual renderer Worker and arbitrates its result/deadline      | Generic Worker transport change; no plugin-ID logic | Keeps a fixed 2000 ms watchdog outside both the page and untrusted render event loop; supervisor can directly terminate its child | Conditional fallback if the natural race is proven and host fixes are insufficient. Not proposed for implementation yet.                          |

For a supervisor design, start its fixed deadline immediately before it forwards render, keep it armed after cancellation until remote settlement, and never restart it on progress/cancel. Deliver only a supervisor-settled result or timeout to the main thread. On timeout, terminate the owned child first; main receives a durable failure and revokes capabilities even if UI delivery is delayed. Disposal terminates both realms, clears every queued request, and cannot revive the activation. Confirm nested Worker support, module/Blob CSP rules, initialization and failure propagation in the actual WebKit build before adoption. Sidecar needs its own process-owner enforcement path rather than pretending a browser-worker change covers it.

No JavaScript timer can promise an exact wall-clock deadline during an OS/process-wide suspension. A supervisor separates a page stall from renderer execution; it must not be described as a hard real-time CPU budget or as proof about the unresolved native failure.

Any adopted change needs fast-result/page-stall success, true CPU-loop termination, cancellation-that-ignores-signal termination, stale-generation rejection, disable/dispose while queued, and same-budget sidecar regression coverage. Do not remove the existing true-termination tests.

## Actual production WebKit natural-stall result

Read `../run-candidate04-deadline-mechanism01/webkit-result.json` (the WebDriver result envelope contains `value`). Both controls passed, the original endpoint was unchanged, and there was no artificial delivery gate.

- Baseline: accepted the completed result.
- Natural stall: submitted at 1792074304807; renderer start, completion and successful postMessage return were all independently timestamped 1792074304808. Main busy wait ended at 1792074307208. The original watchdog terminated the renderer at 1792074307211, without any original result reaching its main listener. This proves a false-timeout mechanism on the actual WebKit engine.
- Infinite CPU loop: submitted at 1792074307331, started at 1792074307332, terminated at 1792074309332, with no completion event. The real 2-second termination control is intact.

This mechanism reproduction still does not reconstruct the original candidate04 render57: its internal completion time remains unknown.

Crucial supervisor-design caveat: the independent observer received its MessagePort events only at 1792074307216, after the page stall, despite their renderer-origin timestamps preceding it. Therefore the current evidence does **not** establish that a second WebKit Worker can keep arbitrating messages while this main thread is blocked. Before any supervisor implementation, test a supervisor's own timer and a nested renderer's completion path under the same natural stall. If message dispatch/timers are globally affected, a second Worker is not an established fix. Avoid promising an untested architecture or extending the budget to conceal this effect.

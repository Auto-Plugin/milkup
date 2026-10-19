# Review: reuse the absolute preparation deadline for export queue/IPC waiting

Read-only design review. No product edit, test execution or UI run was performed for this review.

**Recommendation: accept the proposed desktop-internal correction with the guards below.** It separates two already different budgets: a presentation's 10-second preparation/admission/settlement window, and the unchanged owner's two-second execution window for each dispatched renderer. It does not solve the historical Print04 native render_1 timeout; that request genuinely reached its native deadline and remains unresolved.

## Confirmed current behavior

`createDesktopDocumentPresentationService.provide` computes `deadline = operation.deadline ?? performance.now() + 10_000`. It uses that absolute value to stop admitting another fence unit when fewer than 2100 ms remain. The local deadline currently is **not passed explicitly** to `options.render`: `renderOne` passes the original `operation`, whose type exposes only `signal` in `DesktopDocumentPresentationOptions`. Export calls `provide` with only its signal, so the local fallback deadline never reaches its renderer adapter.

`collectOutputPresentations` currently wraps every `options.render` call in a fresh two-second race, starting before the shared renderer RPC queue. This counts editor work ahead of export against export's execution allowance. In contrast, `createDocumentRenderRpcClient` permits one active job, assigns IDs when enqueueing, and starts authority-controlled execution only when pumping to the endpoint. Cancelling a queued job removes it without dispatch; cancelling an active job rejects its caller but leaves the active slot occupied until remote settlement or terminal control.

Production `DesktopPluginManager.renderDocument` delegates to runtime-loaded isolated modules. Native DOM, native sidecar and supervised Worker paths independently enforce the two-second owner deadline. The native DOM deadline includes helper execution and serialized response return; sidecar has the fixed 2000 ms constant; Worker supervisor starts its own two-second timer on forwarded render and checks its monotonic deadline again on response. This authority must remain intact. The low-level generic runtime itself can be supplied test/custom direct functions, so its signature alone is not proof of owner enforcement; the production module-loading invariant matters.

## Minimal internal contract

- Add the absolute `deadline: number` only to the desktop presentation service's internal fourth callback argument. `renderOne` must pass `{ ...operation, deadline }`, using the computed value; passing `operation` unchanged loses the fallback deadline on export.
- The export callback receives this deadline and computes the remaining preparation time with the same realm's `performance.now()`. It must not transmit it as plugin request data, native IPC policy, SDK API, or a replacement execution limit.
- Validate a finite deadline. If it has already expired, return bounded fallback/error without calling or enqueueing `options.render`. Do not rely on `setTimeout(0)` to prevent work admission.
- Start the queue/IPC/caller cancellation race with the remaining time. Check the same monotonic deadline after the result arrives, before accepting it, so an overdue result cannot win merely because the timer task was delayed. Continue all existing source identity/version/theme/plugin-active and abort checks.
- Every renderer/fence unit inside one `provide` shares the same absolute deadline. Never recompute `now + 10_000` per renderer, queued retry or result. Existing per-chunk export `provide` calls already have separate local preparation windows; do not silently redefine this as a new whole-document timer or renew the deadline within a chunk. The output operation's separate overall bound remains unchanged.

The fence admission reserve is a conservative admission check, not a guarantee of completion: queue congestion may consume the remaining time. A job can still be cancelled by the preparation deadline after dispatch; that cancellation must not disarm or renew its owner's two-second watchdog.

## Why the 1.5 s + 1.5 s case is valid

With the same renderer endpoint, an editor job starts at t=0. Export is enqueued behind it at t≈0. The editor settles at t=1.5 s; export is then dispatched and settles at t=3 s. Both execution intervals are 1.5 s. The old export race expires at t=2 s, only 0.5 s into export execution, and falls back despite neither execution violating its two-second limit. Reusing the absolute preparation budget permits the result at t=3 s without increasing either executor deadline.

An export that actually runs longer than two seconds must still receive the native/supervisor terminal timeout, revoke its renderer and fall back around that executor deadline; it must not wait until the ten-second preparation timer. No caught timeout should be retried with a fresh execution budget.

## Required deterministic regressions

Use the real `createDocumentRenderRpcClient` and shared endpoint queue, not two unrelated mocked promises. Use fake monotonic time/timers consistently and flush microtasks at phase boundaries. Where asserting owner behavior, route through the real Worker supervisor test fixture or its existing trusted authority integration; a bare RPC client mock alone cannot prove process teardown.

1. **RED then GREEN:** occupy the endpoint with editor work for 1500 ms, enqueue export, settle export 1500 ms after its dispatch. Old collector falls back at 2000 ms; corrected collector succeeds at 3000 ms. Assert dispatch times and one active job, not merely successful returned fragments.
2. **Execution still hard-bounded:** owner receives export, renderer never settles or responds after 2000 ms. Assert owner revocation/termination, timeout propagation and source fallback. Queued jobs must not advance after terminal revocation. Preserve existing native late-response tests unchanged.
3. **Queued cancellation:** abort export while editor is active. Assert no export dispatch after editor settles, no leaked queue entry or abort listener, and no late fragment publication.
4. **Version/identity change:** mutate the current document/version or invalidate service while export is queued or active. Resolve an old result afterward; assert rejected capture/source fallback and no cross-version fragment acceptance. The callback deadline must not replace identity guards.
5. **Absolute preparation expiry:** a transport/queue does not settle; advance to the original 10-second deadline. Assert bounded rejection/fallback and controller abort. A subsequent provider must not receive a renewed ten seconds. Also supply an already-expired deadline and assert zero render calls.
6. **Timer task delayed:** advance monotonic time past preparation deadline, resolve a result before running its timer callback. Assert it is not accepted. Cover non-finite deadline handling rather than passing NaN/Infinity to `setTimeout`.
7. **Deadline propagation:** provide an explicit earlier deadline and omit a deadline in separate cases. Assert the callback receives respectively the unchanged explicit value and the one computed fallback, shared across renderers. Existing multiple-provider and fence admission tests should remain green.

The current test named “unresponsive renderer within the existing timeout” injects a bare never-resolving mock and expects two seconds. Under the corrected contract it must test **preparation expiry**, while a separate authority-backed test preserves the actual two-second execution assertion. Merely changing that assertion to ten seconds would be inadequate evidence.

## Risks and claim boundaries

- UI waiting can become longer under contention, intentionally up to the existing preparation budget. Cancellation must remain immediate and cleanup listeners/timers must be removed on every path.
- Preparation expiry is not proof of renderer CPU overrun. It should not itself disable a healthy plugin; the outer timeout currently originates outside runtime, while the forwarded abort should remain an abort. Only trusted owner timeout authorizes the existing timeout revocation behavior.
- Queue admission and runtime's maximum outstanding-job count remain bounded. A longer caller wait must not allow unlimited pending jobs or concurrent execution.
- A lost IPC response can still strand the RPC active slot until its endpoint is revoked; the preparation timer bounds this export caller, not a newly proven repair of every transport failure. Preserve the existing transport failure handling.
- Fake-time tests must advance `performance.now()` with timers; otherwise they can falsely validate relative-time renewal or fail the real absolute deadline guard.
- The three fresh native print runs did not reproduce the historical timeout. This correction addresses a demonstrated budget-contract mismatch, not a proven cause of Print04. It must be reported separately from first-render performance work and cannot close that historical failure.

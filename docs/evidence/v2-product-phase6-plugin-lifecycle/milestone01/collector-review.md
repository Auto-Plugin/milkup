# Read-only review of pending export preparation loop

Reviewed current `apps/desktop/src/output-presentations.ts`, `document-presentation-service.ts`, core result-copy contract, output-service caller and readiness/queue tests. No collector edits and no UI/Cargo run.

No new blocking defect found in cancellation, stable-version validation or deadline handling of the proposed pending-only retry loop:

- One frozen absolute request is reused; each dispatch and completed result passes the capture guard. The service separately validates document/source identity, version and provider activity after awaiting the collector.
- An explicit `pending: true` is validated by the core schema; it requires `complete: false`. Permanent incomplete output is returned once rather than retried. Other completed providers are retained by the service and not rerun by the pending provider's loop.
- The controller and cancellation promise span all attempts; caller abort cancels active/queued rendering and interrupts the 250 ms pause. The next attempt has a guard and cannot dispatch after the pause if capture changed or provider disappeared.
- The absolute preparation deadline is created by the existing service once per provide/window; the retry loop never renews it. Checks before dispatch and after result delivery also reject overdue results when a frontend stall delays the timer task. The owner still arbitrates its existing 2-second execution watchdog per actual request.
- Timer/listener cleanup is in finally, including retry sleep. `preparation.signal` currently equals `options.signal` at this service call site, so using the latter does not omit a second cancellation source.

Static test coverage: readiness tests cover pending→ready, permanent incomplete, original deadline, cancel between attempts, version change, provider disable and provider-local retry. Existing queue tests cover 1.5s+1.5s admission/execution, true executor timeout, queued cancel, active cancel drain, delayed delivery, old-version rejection and expired queue removal. This review does not report new runtime passes.

Limits to preserve in reporting: the 10-second preparation budget is per service provide/window, not a new global whole-document guarantee. Background provider indexing may persist as plugin-owned reusable work; cancelling export guarantees cancellation/nonpublication of this capture, not that every provider-owned cache/index computation has been killed. Disable/host-failure teardown remains the separate lifecycle responsibility. A rapid same-ID replacement is still subject to the existing manager install/lifecycle consistency gap (N3 in native-audit); the retry loop does not introduce or solve it. No claim that this change solves historical WebKit renderer cold timeout or other P5 fidelity issues.

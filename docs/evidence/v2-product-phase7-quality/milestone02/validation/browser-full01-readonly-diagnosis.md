# Full browser 01 failure: read-only diagnosis

- Baseline `78e9329004d2ff244585d98dbe0d7cdd98ab9495`, unchanged inputs, complete 197 cases: 196 passed / 1 failed / 0 skipped / 0 flaky. No retry.
- Failure: `formatting toolbar geometry 760x520 dark 125%`, but setup failed before `setViewportSize`. Actual retained screenshot is 1280×720, dark; no geometry assertion executed.
- `formattingFixture` reached its existing 5,000 ms toolbar-visible assertion after clicking enable and closing the manager. The button was absent. The body snapshot contains only the basic empty-document shell.
- The original failure has `failure.png`, `error-context.md`, embedded `page-state`, and the full JSON report. No registry snapshot or page-console/pageerror listeners existed. `trace: on-first-retry` with zero retries produced no trace archive. Empty result stdout/stderr does not establish that the browser had no console errors.
- Source route: seal package transport and disabled registry seed → page load → details → approval click → enable click → close menu → toolbar assertion. Click completion does not await asynchronous activation. However, approve/enable are serialized per plugin by the manager, so an approval race is not established.
- Worker initialization has its own existing 5,000 ms deadline. Manager enable catches failures, persists `markFailed`, and returns the failed record; therefore absent global command-error text cannot exclude a worker/activation failure. No retained evidence establishes such a failure occurred here.
- Formatting activation itself is synchronous; toolbar rendering returns controls while starting its optional editing-state read asynchronously. No evidence proves that this code, renderer sync, or worker initialization caused the failure.

Root cause remains unknown. Do not label the run flaky, repaired, or 197-pass. CPU was released immediately after the full process exited. No test was rerun.

## Prepared test-only diagnosis

Only `tests/helpers/formatting-plugin.ts` is changed. Original seed, awaited operations, assertions, and assertion deadlines remain. Existing await completions receive monotonic timestamps; up to 40 console/pageerror/worker-created events, 2,000 characters each, are retained. Listeners are removed in `finally`. On failure only, attachments include bounded formatting registry status/permissions/errors/runtimeFailure, actual viewport and visual viewport, CSS zoom, focus/visibility, toolbar/hidden manager DOM, and body accessibility snapshot. Diagnostic errors cannot replace the original thrown error. No successful-path DOM scanning is added.

Only this file was formatted and `git diff --check` passed. Tests/typecheck have not been run after this diagnostic change; await the next CPU slot. A subsequent single original test with retained trace can diagnose a recurrence without a deadline change or retry; a later complete 197-case run is still required for final-suite acceptance.

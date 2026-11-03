# Prepared exit-wait regression fix (not applied)

The shared candidate was left unchanged while Windows run 41646316340 was active.
All proposed code is under `candidate/`; `original/` preserves the copied baseline
and `baseline.json` records its commit and file hashes. `exit-budget.patch` is a
two-file patch for parent review, not permission to apply it during the frozen run.

The prior exit wait could await a 30-second WebDriver query even though its own
deadline was 15 seconds, then classify an earlier normal process exit as late.
The patch records the directly spawned child's exit-event time using the monotonic
clock, interrupts closing queries on that event or the existing wait deadline,
and uses the recorded exit time to decide whether exit was timely. Confirmation,
document identity checks, and any owned-fixture discard pointer action share the
same abort signal. A synchronous monotonic checkpoint also prevents another
discard/pointer/wheel action when timer delivery lags the deadline. An aborted
query alone is not proof of process exit. A recorded
late exit and unrelated validation errors remain failures.

The 15-second exit-wait start point is unchanged. No native teardown, process kill,
account/profile deletion, plugin boundary, or outer/inner cleanup acceptance
rules are changed. The timestamp is when Node observes the directly spawned
child's exit event; it is not an OS kernel exit timestamp.

Validation in the isolated copy:

- `node --check tests/windows/mermaid-product-e2e.mjs`: exit 0.
- `node --test tests/windows/mermaid-product-e2e.test.mjs`: 32/32 passed
  (25 existing cases plus 7 targeted cases); final output in `candidate-tests-final.log`.
  `candidate-tests.log` retains the preceding 31-case revision.
- The original helper with the new timely-exit/late-response case failed as
  expected with `false !== true`; actual output in `pre-fix-regression.log`.
- `git apply --check exit-budget.patch` against the shared baseline: exit 0;
  the patch was not applied.
- Formatting used the existing pinned Prettier 3.9.4 and repository config,
  writing only the two temporary candidate files.

The new cases cover timely recorded exit with a delayed response, immediate
interruption of a stalled request, expiry while the process remains alive, an
actual recorded late exit, unrelated confirmation errors, and an interruption
without any observed process exit. The seventh case advances the monotonic clock
without delivering the timer and confirms that no further discard is dispatched.
They use in-memory callbacks, mock clocks and
mock timers; they do not start a browser, product, Windows process or remote UI.
No claim of actual Windows validation is made by this patch.

Read-only review: native_engine found no blocking issue in the first revision.
The independent review_exit_patch agent identified the delayed-timer action edge;
after the checkpoint/test change, it reported no remaining concrete findings.

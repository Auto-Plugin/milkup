# Exact detached-frame close probe correction

The original run 41688389731 remains failed. This fix changes only the Windows
E2E harness and its tests; product/native/plugin/bootstrap sources remain exactly
the same as product candidate c377f56212353ed26eda82a4fc24a1bcfb4b2e27.

Only a genuine UI-close request followed by HTTP 404 with an own JSON
`value.error` exactly equal to `target frame detached` is treated as unavailable
closing context. It proves neither absence of a dialog nor process exit. The
held ChildProcess still must exit normally within the unchanged 15-second limit.
Actual visible-dialog true is sticky failure; unknown errors, malformed/bare
responses, wrong status and nonnormal exits remain failures.

Failure cleanup rechecks the held ChildProcess before/after identity observation
so a naturally exited process does not trigger a stale PID lookup/kill. PID
absence never proves normal exit, and a prior generic probe error remains failed.
An observation exception is no longer mislabeled as an expired UI-close deadline.

132 related Node regressions and three real local Node ChildProcess cases passed,
with exact source/log digests retained here. The real local process cases do not
start Milkup or Windows and do not replace a new full two-account Windows run.
Independent review found no remaining code blocker.

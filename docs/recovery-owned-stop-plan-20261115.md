# One installed recovery test, bounded and instance-owned

Reuses source `58c78973101acb0a22ca0cb5d24ef24bd9edc199`, Linux deb SHA-256
`9e71e2b6f6c5cd030f7307d35679ded1d4f5605127d77320db1d455d90c1ddde`,
from package artifact `14149947936`. No product changes or package build.
The workflow checks package/archive identity and the exact QA-only source diff.

Existing recovery controller contract attempts a checkpoint after 750 ms idle
or around five seconds of continuous committed changes. These are scheduling
intervals, not guaranteed durable-loss bounds. Ready/version follows native
completion. Native checkpoint code hashes complete bytes, syncs payload and
manifest publication, and retains the previous generation. Restoration creates
a new copy, verifies it, and only archives the record after successful opening.
Historical SIGKILL tests are not evidence for this exact package.

Scope: ordinary Ubuntu 26.04, default sandbox, fresh own XDG profile and one
synthetic Markdown with unique markers. Wait for two acknowledged checkpoints;
independently check manifest owner PID/birth, version, byte count/SHA, current
payload, previous payload and unchanged original. Record observed timings, not
an advertised maximum. Do not add uncheckpointed input just before termination.

The only planned abnormal termination uses `os.pidfd_open` and
`signal.pidfd_send_signal(SIGKILL)`. Before sending, verify twice the PID start
time, all four UIDs, executable path/hash and exact owned launch argument.
Validate the fixture under this run's evidence directory and temporary runner
root. The held pidfd prevents retargeting a recycled numeric PID. No `pkill`,
process group, executable-name or descendant signalling. Five local ownership
tests open descriptors but never signal; subprocesses exit normally on stdin EOF.
Wrong birth/owner/executable/hash/fixture, self/parent and exited PID reject.

After the pidfd reports exit and the original PID is reaped, release only its
WebDriver session. The test does not call the generic application cleanup path.
On failure, any explicit termination is again restricted to the exact held
identity/fixture and is marked failure cleanup, not a passing normal exit.
Startup failure without a validated owner must not guess or signal an app PID.
The wrapper owns and stops only the driver it created; ordinary CI teardown is
not application recovery evidence.

Restart original: prompt must offer the retained snapshot while original bytes
remain unchanged. Choose "暂不恢复", verify pending snapshot persists, normally
close and restart. Restore to a distinct copy, verify exact latest local bytes,
unchanged original and `restored` archival. Restart again: no automatic pending
prompt for that record; explicit history still exposes the archived record.
Finally reopen the recovered file, verify bytes and normally close. Normal
closes require clean state, real WM_DELETE_WINDOW and exact process disappearance;
OS exit codes are not asserted.

This is a controlled abrupt process-termination/restart test. It is not a
spontaneous application crash, OS crash, power loss, disk-fault test, proof of
hardware cache durability, unsent IME input recovery, or whole-document-format
matrix. No original/record deletion, real user data, system service, security,
notification or production channel changes. No release or main merge.

Limits: one job (25 minutes), native flow 340 seconds, checkpoint wait 15 seconds,
pidfd exit 10 seconds and each normal close 20 seconds. No identical automatic
rerun. Preserve original results and exact file bytes, including failures.

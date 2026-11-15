# Installed external-conflict scope and recovery review

Integration baseline: 8f7fefdf. Reused installed Linux input: exact source
383c0712, deb SHA-256
`8cd091ac83ffea06e2bac6c34ce3a9353047722fc0dbf7d64b1491341acfc860`.
File service, session/watch/save guards, recovery controller/UI and native
recovery/storage files are unchanged between those candidates. Main's intervening
changes concern Mermaid presentation and initialization; do not claim the whole
packages are equivalent.

Contract reviewed:
- External writes do not replace dirty in-memory edits. Ordinary save is blocked
  for every non-none external state, and native write checks also protect disk
  identity/content independently of watcher notification.
- Small dirty conflicts cannot directly reload (`conflict`); rescue Save As to
  a fresh path is available. Clean `modified-clean` changes may explicitly reload.
- Window close has save/discard/cancel protection. This test chooses cancel
  while dirty, then saves a rescue copy and closes cleanly.
- Watcher notice currently sets its text without `importantNotice`; default UI
  hides ordinary developer notices. Record actual visibility before Save rather
  than claiming a hidden DOM status is a visible conflict warning.

Existing evidence is older: July 7 Windows debug smoke checks watcher/blocked
save/clean reload, explicitly excluding full rescue/cancel resolution. Phase20
native quality checks the pre-watcher write race and rescue copy using test path
injection. Neither is exact 383c installed/native-dialog acceptance.

One bounded Ubuntu 26.04 installed flow is prepared: temporary synthetic file,
native local edit and completed checkpoint observation, genuine outside write,
save and dirty-reload refusal, close cancel, native Save As cancel, rescue Save
As, normal close, reopen original, clean external update/reload, close and reopen
rescue. Disk bytes and both unique markers are checked at each boundary. Inputs
use shipped UI/native keys; DOM is only observed. No private IPC, watcher
disable, test path injection, real user file or deliberate process crash.

Local prerequisite tests on integration: watcher/session regressions 11/11,
recovery/controller and large-conflict tests 10/10; syntax checks for the native
harness and wrapper pass. These are not native installation acceptance.

## Recovery semantics and evidence boundary

`recovery.ts` attempts a checkpoint after 750 ms idle or at most a 5 s scheduling
interval under continuous committed edits. A timer does not guarantee durability
or a loss bound: I/O, pending edits and failures can delay it. Only acknowledged
checkpoints expose ready/version. The native store verifies length/SHA, retains
current and previous generations, and restores to a new copy rather than
overwriting the original. Save/close archive records; archival is not deletion.

Historical phase20 JSON contains owned-process SIGKILL cases for untitled,
existing, large and UTF-16 documents, followed by matching recovered-copy hashes.
Those are genuine historical process-crash tests, distinct from controlled close,
but not this exact deb or current environment. No fresh crash is injected here.

Limits remain: 256 MiB per snapshot, 2 GiB recovery admission budget, 64 MiB
reserve, 20,000 entries/8 levels. These are not whole-disk quotas. Orphan work
buffers and archived history can accumulate; no automatic global cleanup is
promised. No guarantees for power loss, storage hardware faults, uncommitted IME,
cursor/undo reconstruction, or every platform's lock/atomic-write edge.

Any new crash test requires a separately stated plan with exact binary/path/PID
birth ownership, an acknowledged checkpoint, original file hashes, synthetic
profile only and bounded teardown. Normal close in this test must not be labelled
crash recovery.

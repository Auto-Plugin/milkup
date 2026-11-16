# Native identity follow-up to 43794564331

The original failure is retained in `evidence/43794564331/`, including the two
original ZIPs and hashes. No private runtime or compiler-object archive is
committed. These are synthetic document/CI evidence, not user files.

## What the failed run establishes

* All four actual TU results were inherited under exact comparisons. The
  cross-process cache transfer and first-call sample passed.
* The observation runtime built in **3860.250 s**, completing 3263 compiler
  objects, with 2878 hits and 385 misses. The bounded object snapshot completed
  in 23.213 s: 549,393,041 entry bytes. Artifact **14195679258** is 546,716,427
  ZIP bytes. It contains compiler cache entries, not a runtime.
* Native artifact **14196129198** wrote the first PDF, but acceptance failed
  on `actual web process identity required`. Its raw per-case report says
  830.00/830.01 ms for the two consumed result frames and 830.27 ms overall.
  Only guardian 53558 / birth 477605 and its private library maps were captured.
  No product renderer window or actual WebProcess was captured.
* The log contains 177 consecutive records ending on page 8. The parent's
  independent comparison found all 693 ordered word boxes equal to stock.
  These facts do **not** bind the log to a live, verified WebProcess and do
  not pass the identity or causal mechanism gate.

The old sampler snapshots the process table once, then synchronously hashes
large libraries and invokes X tools for each candidate before checking the
next table. Receipt of the terminal result ends collection. This is a concrete
blocking path consistent with missing both renderer and WebProcess, but the
old evidence does not identify exactly which call consumed the interval.
No definitive claim of timing versus ancestry versus wrong runtime is made.

## Minimal collection repair, unchanged engine and output

`observed_render.py` preserves the original render function's package, guard,
payload, FD3/FD4 protocol, PDF, timeout and normal cleanup statements. A test
compares its source with the original under only four observer wiring edits.
`support/calibrate.py`, the installed package and the engine patch are unchanged.

`process_capture.py` uses an inherited anonymous Unix datagram socket as
stderr. The receiving side asks Linux for both per-message SCM_CREDENTIALS
and SCM_PIDFD. A stable 64-bit pidfs inode binds messages to the same process
generation, including queued messages read after exit; a numeric PID alone is
insufficient. Linux 6.9+, working pidfd delivery and a live identity/map capture
are mandatory. There is no weaker fallback if unavailable.

* The fast receiver/scanner records exact birth, executable inode, lineage,
  UID, namespace PIDs, default sandbox status, effective capabilities, and
  WebKit/JSC maps with device/inode identities. Large file hashing is outside
  that hot path. A held pidfd connects the live snapshot with each message.
* Window queries run independently and only target the owned renderer child,
  not the guardian. They retain the original independent PID property,
  generation and actual 1024×768 geometry checks. They cannot block stderr
  identity capture. No arbitrary sleep is added to make a vanished process
  observable.
* Every diagnostic line has a hash and kernel sender identity. Exactly one
  mapped WebProcess must account for all lines. UI substitution, PID reuse,
  missing/truncated/interleaved records, mapping replacement, unknown
  collector state, wrong library paths/hashes or missing sandbox fail closed.
* After collection, the existing private manifest validator checks exact
  library bytes and permissions; stored mapped inode/size/timestamps must
  still match. The WebProcess executable's live inode must match the exact
  private executable hash. No UI-process maps can satisfy the WebProcess gate.

Reference interfaces: [Linux Unix sockets](https://man7.org/linux/man-pages/man7/unix.7.html)
and [systemd's pidfd inode identity documentation](https://www.freedesktop.org/software/systemd/man/261/sd_pidfd_get_inode_id.html).
No ptrace, signals, security policy, system library or application layout change
is used by this observer. The existing normal stop/cleanup protocol remains.

## Independent local checks

Seven collection tests pass, including real child/grandchild kernel sender
credentials, the same pidfd identity after exit, and an end-to-end synthetic
native executable loading two temporary DSOs. The synthetic names are test
fixtures, **not WebKit acceptance**. The separate production verifier still
requires the exact private manifest paths/bytes. Negative controls cover UI
substitution, wrong generation, wrong PID, missing sandbox, changed record
bytes and wrong mapped inode. A separate blocked-window thread does not stop
credential receipt. Existing PDF/cleanup/lineage contracts remain enabled.

## Cross-job object restore correction and one bounded follow-up

The 437899 and 437945 generated-header inventories contain the same **1813
path/hash entries**, but traversal order changed the JSON file bytes. Raw
inventory hashes differ; canonical map hash is
`f4eabf063b70f7266b221349d2bc243b63d70a472122e7c174154492d5abbf5b`.
Without correction, the old key would reject a valid cross-job restore.

Future keys use canonical sorted path/hash JSON. For **43794564331 only**, the
old key is accepted only after checking the preserved original inventory hash
`7d21511ce14465a4f88f16e1ee4a5c050a5a718d22839a526ead60cb719a9b4c`
and equality of every current path/hash. All other source/compiler/flags/path
fields and every cache entry hash still must match. Reordering is a positive
test; one changed header is a negative test. There is no generic hash bypass.

The intended single manual follow-up uses `pagination-segment` with
`pagination_restore_run=43794564331`. It must prove fresh restored first hits
before runtime reconstruction. With an incoming object bundle, build time is
capped at **20 minutes / 64 new misses**, retaining the existing 60-minute
save/acceptance reserve and resource/stagnation stops. No cold-build fallback,
automatic retry or new four-TU acceptance compiles are requested. The original
package, guard, 12 mm setting, 1024×768 allocation, four short/long controls and
all coordinate/content/failure thresholds remain unchanged.

Only the actual follow-up result can establish whether sampling was the cause,
whether the private WebProcess emitted these records, and whether the strict
geometry/call-chain diagnostic completed. No product behavior patch precedes
that evidence; other release requirements remain open.

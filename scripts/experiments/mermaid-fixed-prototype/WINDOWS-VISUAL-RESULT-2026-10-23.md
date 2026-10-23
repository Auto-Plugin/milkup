# Windows visual follow-up: cleanup failure remains a blocker

The latest bounded run, [39933416844](https://github.com/Auto-Plugin/milkup/actions/runs/39933416844),
tested source **`4ecbc3adb2f5dbf1aca7dcaae8dd15b81128bd9b`**. It failed after
the canary rendered, because native private-tree deletion returned Windows
error 5. **No positive matrix ran and no Windows PNG was exported or visually
reviewed.** It would be incorrect to claim that the requested Windows pixel
review or product integration is complete.

The earlier [standard-user result](WINDOWS-STANDARD-USER-RESULT-2026-10-23.md)
still establishes actual 50-case rendering in run `39918541123`. Its PNGs were
removed during cleanup and cannot be reconstructed from their hashes. That
earlier success does not erase the three subsequent cleanup failures below.

| Run / tested source                                                                                                        | Actual outcome                                                                                                                                                                             | PNG evidence                                                                    |
| -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| [39928634251](https://github.com/Auto-Plugin/milkup/actions/runs/39928634251) / `565ac02d80173a0f888a87357b7a30bcbcfe9ca9` | Canary rendered; native deletion immediately failed with OS5. Positive matrix not started.                                                                                                 | None; failed native output discarded.                                           |
| [39930363116](https://github.com/Auto-Plugin/milkup/actions/runs/39930363116) / `1e77a15693ca8076aa36b67f5cb69f569142491e` | Canary and 41 positives passed. `flow-wide` rendered, then native deletion failed with OS5; matrix stopped. Parent diagnostic rejected the extended-length path spelling before traversal. | None; the original all-50 export gate did not preserve the 41 successful files. |
| [39933416844](https://github.com/Auto-Plugin/milkup/actions/runs/39933416844) / `4ecbc3adb2f5dbf1aca7dcaae8dd15b81128bd9b` | Canary rendered 1280 × 74, 2216 bytes. Native deletion again failed on its first attempt with OS5. Corrected bounded parent diagnostic ran. Positive matrix not started.                   | None; the new partial mechanism cannot export a failed canary.                  |

All three runs have **zero Actions artifacts**. Each outer supervisor confirmed
its Job empty and removed its temporary account, actual Windows profile and
entire stage. These later cleanup results do not convert native cleanup into
success. No identical-condition retry followed the latest failure.

## What the latest diagnostic actually establishes

The exact private parent check accepted the observed extended-length spelling
of the already-owned directory. It did not generically strip Windows prefixes,
accept UNC/device paths, change permissions or follow reparse points.

The bounded sample contains **64 existing entries: 41 directories and 23 files
with Archive attributes**. It is explicitly truncated. In that sample there
are no ReadOnly/reparse attributes, metadata or ACL read errors, truncated SDDL
strings, or explicit deny ACEs. Each sampled entry includes a full-control ACE
for the temporary owner; the supervising runner appears with full control via
the observed `LA` SDDL alias. The root, code directory, copied executable and
state directory remain visible in the sample.

Those facts do **not** identify the operation or child path that failed inside
`std::fs::remove_dir_all`. They do not describe unenumerated descendants or
mandatory-label/SACL state, and they were observed later by a different token.
They neither establish a lock holder nor prove that the executable caused OS5.
The original native result still records Job zero, AppContainer profile deletion,
one nonretryable OS5 attempt, retained private tree and mandatory matrix stop.

The [sanitized failure summary](evidence/windows-visual-2026-10-23/run-39933416844-failure.json)
and [bounded diagnostic](evidence/windows-visual-2026-10-23/run-39933416844-cleanup-diagnostic.json)
retain these distinctions. Temporary identities are labeled; no residual file
contents or credentials are included. [SHA256SUMS](evidence/windows-visual-2026-10-23/SHA256SUMS)
covers the preserved visual-follow-up records. The normalized complete job log
hash is `9fd6bbb39dc1cbccd6e5129e5b955af4f3ddba3695a6a9cbd157b32d763d8cb7`.

## Changes and checks in this follow-up

Only evidence orchestration, diagnostics, reader/tests and documentation changed.
The native renderer/launcher, fixed official assets, fixture inputs, manifests,
C# supervisor and Cargo inputs remain byte-for-byte equal to rendering source
`82fb49e95caf99ea45654f552992eff81f72bee9`.

The collector now caches only individually successful PNGs and emits them only
after all outer Job/account/profile/stage cleanup gates pass. A stopped positive
matrix may export its exact successful prefix as `partial-failed`, `complete=false`,
with failed and unreached fixture lists. The failed native PNG is never exported;
the original exit code and stop behavior remain unchanged. The reader requires
explicit `--allow-partial-failed`, the matching original failure, intact ordered
chunks/PNG CRC/decode/hash and all exported-case and outer-cleanup facts.

Thirteen local synthetic reader tests passed. Windows cheap preflight passed
script parsing, C# compilation, exact normal/extended parent representations and
rejected out-of-scope paths. Synthetic PNG checks passed complete, terminal
partial and mid-matrix partial paths plus eight refusal checks. The eight
existing Windows Rust tests also passed. These are transport/path/native unit
checks; the real partial export path was not exercised because this run stopped
at the canary. The negative rendering corpus was not repeated in these visual
runs; its earlier four passing assertions remain attributed only to the earlier run.

## Smallest next diagnostic, proposed only

Keep the original `std::fs::remove_dir_all`, its OS5 immediate-failure rule and
all output/cleanup gates. After that call fails, on the same launcher thread,
observe the current process token and whether `OpenThreadToken(TOKEN_QUERY)`
reports a thread token. Record `ERROR_NO_TOKEN` separately from an observation
error; do not impersonate, revert or adjust privileges for the probe.

For only the exact owned root, code directory, copied executable and state
directory, validate existing ownership/reparse constraints and make at most four
`CreateFileW` access-open attempts: `DELETE`, all three sharing flags,
`OPEN_EXISTING`, `OPEN_REPARSE_POINT`, and `BACKUP_SEMANTICS` for directories.
Handles are noninheritable and immediately closed. No delete-on-close flag,
disposition change, actual deletion, ACL/attribute change, recursive traversal,
third-party inspection or OS5 retry is proposed. Record immediate Win32 error,
close result and bounded metadata, keeping the original failure unchanged.

This is an access observation, not an exact replay of the failed deletion.
Successful opening does not prove that setting deletion disposition would work;
failure does not by itself distinguish all token, sharing and filesystem causes.
The existing pin handles are already dropped before deletion and `RevertGuard`
aborts on failure; static review has not found a leak. Directly recording the
original standard-library child operation would require a separately reviewed
instrumentation approach, not a replacement deletion implementation disguised
as diagnosis. No proposed native change or new run has been executed here.
API distinctions follow [Microsoft CreateFileW documentation](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-createfilew)
and [Rust remove_dir_all documentation](https://doc.rust-lang.org/std/fs/fn.remove_dir_all.html).

## Concrete integration route and prerequisites

The recommended eventual route is a host-private service running the pinned
official engine, accepting only diagram data, returning a fully validated PNG
lease to the existing ordinary/windowed presentation paths. Bind requests to
document identity/version, block hash, theme and plugin epoch. Hide source only
after decoded output is accepted; cancel by stopping the owned Job and discard
late results; release image leases immediately on plugin disable or replacement.
This is a design recommendation, not implemented product behavior.

Before that route can be accepted:

- Resolve the repeated native cleanup failure with evidence. A different
  privileged cleanup supervisor is a CI arrangement, not a desktop deployment
  design. A product coordinator would need a short-lived same-login process and
  an audited lifecycle; the synchronous current launcher has no external cancel API.
- Address ordinary desktop account compatibility. Both current gates reject an
  Administrators SID even when deny-only, and reject a limited UAC token. Pure
  Users-only success does not demonstrate operation for a non-elevated administrator.
  Do not remove those gates without reviewing the changed boundary.
- Obtain actual pixel/readability evidence and a DPI/theme/width policy. Current
  output is fixed at 1280 pixels and the default theme. The sixteen-stage wide
  fixture's 1280 × 30 dimensions warn of small text; its pixels have not been
  reviewed. Do not call nonuniform pixels a readability acceptance.
- Decide the disclosed browser-vulnerability/UDP residual risk. Ordinary request
  controls and zero-capability observations do not establish OS-wide network denial.
- Complete fixed-version scope explicitly: the 50 cases cover 37 built-in
  registrations plus selected combinations, not every grammar combination;
  optional ZenUML/tidy-tree and external icon assets remain separate gaps.
- Migrate the existing worker plugin with a new version greater than 1.2.0 and
  reviewed bundled-receipt allowlist changes; do not reactivate old DOM 1.1.1.
  Verify existing documents, hot enable/disable, stale results and source fallback
  in the actual product after any approved integration.

The fixed official script is 5,494,801 bytes. This run's debug prototype is
7,706,112 bytes, SHA256 `0046e6c89e255ac8c49f572987127f318169c82c38c79aeb20cb62727c562919`.
Protected source equality is not a promise of identical build bytes across runner
toolchains. Neither number is a compressed installer increment. A future release
build must compare the same NSIS configuration against the beta.7 installer's
4,417,540-byte baseline. No new Runtime/dependency was installed or bundled here.

The prototype remains outside Milkup packages. No product merge, installation,
Release, expanded user permission or production trust decision is claimed.

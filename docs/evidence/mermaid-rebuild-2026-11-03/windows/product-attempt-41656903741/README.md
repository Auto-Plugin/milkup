# Windows product acceptance 41656903741

[GitHub run](https://github.com/Auto-Plugin/milkup/actions/runs/41656903741), attempt 1,
completed **success** on 2026-11-03. Tested candidate:
`44ef263e6cd3d66b3dc43d951c4b3fe0d18e69f0`. This record is not a test of later
Linux-only source changes.

The fresh hosted runner used its already installed Evergreen WebView2
156.0.4314.50. Its new standard account, Node, driver and product were independently
observed with the same SID and session, no Administrators group (including
deny-only membership), no SeDebugPrivilege, and an interactive WinSta0/Default
input desktop. No runtime installation, Fixed Runtime, UAC/ACL/policy change,
installer, release or original remote instance was involved.

## Actual result

All **10/10** recorded product steps passed: initially disabled source, enable
and exact bytes, real edit/save/replacement, undo, redo, disable/re-enable, wide
diagram, C4, unknown grammar with preserved source/diagnostic, and final disable.
The four self-authored fixture files' final saved bytes exactly match their
original fixtures; intermediate edit and undo/redo save hashes are retained in
the original report. This is four-fixture acceptance, not a full Mermaid corpus
or grammar claim.

The 17 archived PNGs comprise 7 native diagram images and 10 actual product window
screenshots. Each was independently fully decoded with Pillow; dimensions, PNG
SHA-256 and decoded RGBA SHA-256 match the browser report. All seven native PNGs
also match a successful native finished event by product PID/request ID, bytes
and SHA-256. Ordinary images are 448x102; wide is 3528x126; C4 is 564x118.
Representative original window captures:

- [Ordinary](artifact/02-enable-and-exact-bytes-window.png)
- [Wide](artifact/07-wide-window.png)
- [C4](artifact/07-c4-window.png)
- [Unknown grammar with complete source](artifact/07-invalid-window.png)

Direct inspection of ordinary/invalid/final-disable captures is recorded in
[ordinary/invalid review](visual-review-ordinary-invalid.json). A separate
[C4/wide review](bootstrap-visual-review.json) confirms readable complete nodes
and arrows, wide natural-size rendering, and approximately 15-pixel outer C4
margins. It also records a minor C4 defect: the white `Presents` label backing
touches and erases about one pixel of the `View` left outline at x=331,
y=40..54. No text or arrow is hidden. The wide screenshot shows the left end and
scrollbar; it does not prove pointer-driven traversal to the far-right end.
These are two light-theme fixtures at DPR 1, not a theme/DPI matrix.

The 35 native audit records exactly match the four raw product logs:
**12 admitted, 11 started, 12 finished**, comprising 9 successful renders,
1 cancellation before Job creation, and 2 expected `unknown-diagram` results.
Every admitted task has real finished evidence with no cleanup uncertainty,
empty typed failure kinds, IPC completion, profile deletion and private-tree
removal. All 11 created Jobs report zero remaining processes; the cancelled task
created no Job or child. The 11 started helper/browser observations show the
same standard-account SID, AppContainer, zero capabilities and owned-Job browser.
The audit explicitly does not claim OS-wide network denial.

All four product processes closed through real UI and exited normally with code
0, without fallback termination. Wide close exercises the previous race:
pre-close drain finished at `14:55:01.612Z`; a new native admission occurred at
`14:55:01.616Z`; it finished cancelled with confirmed cleanup at `14:55:02.313Z`;
product natural exit followed at `14:55:02.709Z`. The shutdown barrier retained
and settled this late task instead of losing its finished record.

Typed IPC observations show stdout joins of 5–10 ms and stdin/stderr joins of
0 ms; none requested `CancelSynchronousIo`, panicked, or produced a stdout/stderr
failure. Original 50/250 ms join policy and all failure gates were unchanged.
The previous run **41653312849 cleanup uncertainty was not reproduced, and its
exact cause remains unknown**; this pass does not retrospectively diagnose it.

The evidence collector is complete, with zero rejected/omitted files. The outer
Job was already empty before its cleanup (`activeBeforeOuterCleanup=0`). Exact
SID process enumeration was complete and empty. Profile deletion returned
success; profile path, ProfileList entry, HKU hive and CIM profile were absent
in the final observation, then the account and staging tree were deleted.
There are no cleanup errors. DeleteProfileW's first call lasted 4495 ms: the
3-second setting limits retry initiation, not a synchronous Windows API's hard
duration. The older **41642093459** runner's failed profile removal remains
uncertain and is not resolved by this separate successful runner.

## Provenance and verification

- Artifact ID `13240223664`; ZIP 730069 bytes.
- ZIP SHA-256 `c08f4fbd0ba6c1a9a98adb359488eb1a278878b09ee6b99e3ba0fe9d2767805f`, equal to GitHub's artifact digest.
- 41 manifest-listed files, plus the manifest itself; exact sizes and SHA-256 verified.
- Checkout, desktop-check and final source snapshots are strictly clean, with matching HEAD/index/worktree bytes and no index refresh.
- Private Windows crate: 31 tests passed. Selected desktop contract: 1 passed. Full desktop library: 228 passed, 3 ignored. Production-asset link succeeded.

Original [product report](artifact/mermaid-product-e2e.json),
[standard-account and outer cleanup audit](artifact/windows-standard-product-audit.json),
[GitHub log](raw.log), [run metadata](run-metadata.json), [original ZIP](artifact.zip)
and [independent verification](verification.json) are retained. The original
reports' `visuallyReviewed=false` fields were not rewritten: separate inspection
records state the images actually viewed and the review limits.

To repeat the byte/pixel/ledger assertions with Python and Pillow, run
`python verify-artifact.py .`, then `python verify-product-outcome.py` from this
directory. The first command recreates base `verification.json`; the second
adds the actual outcome checks. This archive contains no product binary,
installer, account password, browser profile, cookies or credentials.

Real system IME, alternate DPI/theme matrices, native file-picker, installer or
rollback behavior and OS-wide network denial were not accepted by this run.

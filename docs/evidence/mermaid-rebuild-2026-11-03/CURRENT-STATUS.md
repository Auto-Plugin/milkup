# Current acceptance and limits

This work is on `dot/mermaid-rebuild-20261103`, in an independent worktree. The
original offline instance was preserved. Product baseline
`5ea31846e0cd72d52ca6c9ae83a77a695861acaf` and prototype baseline
`ea5ebcc69d83a6c8eecf4edc73aabd6445b8dac4` were verified separately. Missing
original uncommitted files were not recovered: this is a new implementation
from accessible evidence. No plugin trust expansion, main merge, official
release or old Fixed Runtime run was performed. A subsequently authorized
Windows test installer was actually built, installed and accepted; see the
[beta.8 delivery record](../mermaid-windows-trial-2026-11-03/README.md). Its
source and installed executable identities are separate from the earlier runs.

## Product behavior and actual acceptance

The reviewed package now uses the fixed native Mermaid 12.2 engine in the editor
on Windows and X11 Linux. PNG resources remain private to the host, bound to
exact package/activation identity, decoded before hiding source, and released on
replacement, cancellation, disable and close. Invalid diagrams retain their
source. Export keeps the existing restricted renderer; macOS retains its
existing DOM package. Wide images preserve natural size and scroll.

| Execution | Tested source | Actual result |
| --- | --- | --- |
| [Windows installed release application, beta.8](../mermaid-windows-trial-2026-11-03/README.md) | `a5431693a4ea1e1a282c16b9cc9651e17b67f9ea` | **10/10** operations; 4 normal UI closes; exact installed EXE; actual current-user NSIS execution, profile/account/install-directory cleanup and delivered ZIP independently verified |
| [Windows standard-account product UI](windows/product-attempt-41656903741/README.md) | `44ef263e6cd3d66b3dc43d951c4b3fe0d18e69f0` | **10/10** operations; 17 decoded PNGs with browser pixel hashes; 7 diagram PNGs also bound to successful native completion; 4 natural UI closes |
| [Linux product and window regression](linux-x11-popup/README.md) | `ee305c4c8e8fc2e2a8fb7356170a6ec59b6674e4` | **11/11** editor operations; actual Xfwm4 window-placement/PNG/Alt-F4 regression passed |
| Linux direct native helper corpus, same production-assets ELF | Same `ee305c4c` source and binary | **50/50** generated, fully decoded and retained; 50 natural guardian exits and verified private-directory/process cleanups; sandbox enabled. This directly exercises the helper, not editor/Registry lease behavior. |
| Current list-input regression | Same list implementation inherited from `6e124b79` | **57/57** tests; bare `-` stays literal, `- ` presents a bullet, incremental task input remains possible in ordinary and windowed views |
| Desktop complete frontend tests after close fix | `b286014b` frontend implementation | **981 + 4** bootstrap tests passed; TypeScript passed |
| Earlier Windows native build/tests | Run `41656903741` | Private crate **31** passed; desktop **228** passed / **3** ignored; selected desktop contract **1** passed; production-assets link and strict clean-source gates passed |

The Linux binary SHA-256 is
`9bfce3146a9d6f5b44a2c769a3e55b72521fdb33beed8247980aaa412742347a`
(316547648 bytes). It is a custom-protocol debug binary with production frontend
assets, not an installer. Windows uses installed Evergreen 156.0.4314.50; Linux
uses installed WebKitGTK 2.52.6 with its sandbox retained.

The same Linux ELF rendered all 50 positive corpus fixtures. Compared with the
earlier native corpus, source bytes and dimensions match for all 50; PNG and
decoded-pixel hashes match for 48. Both remaining old/new pairs were directly
viewed: gitGraph's generated commit labels differ, while classDiagram retains
all three rows, including `+save()`, with 517 minor outline-pixel differences
(maximum channel difference 9/255, unchanged alpha and method-text pixels).
This comparison preserves the earlier visual warnings; it does not reclassify
every image as aesthetically flawless. See [root's actual-image review](final-root-review.json).

The Linux source differs from the Windows-tested source only in the
Linux-conditional helper's backend/window setup. A subsequent frontend change
only clarifies the cleanup-failure notice: document presentation is paused and
the retained window is for saving and retrying close. It does not reopen render
admission or change shutdown behavior. That final wording passed TypeScript;
the native UI records retain their exact earlier source/binary identities.

The original list correction was already part of the verified baseline, not
newly implemented here. Its fresh output is [list-input-current.log](logs/list-input-current.log).
The final wording check is [final-notice-typecheck.log](logs/final-notice-typecheck.log).

## Follow-up failures and their disposition

- **Source drift, run 41630133039:** exact-source replay and a controlled Windows
  experiment identified LF generation versus CRLF checkout in exactly the two
  Tauri schema files. Explicit LF attributes fix those two paths. Actual later
  builds pass the original dirty-source gate without resetting files or relaxing
  it. The original run omitted filenames; replay findings are not mislabeled as
  original captured filenames. Run 41630161068 was skipped.
- **Cancellation, 41637412776 attempt 1:** GitHub recorded cancellation by a
  higher-priority waiting request in the same concurrency group. Attempt 2 and
  subsequent runs are separately retained. Queue configuration now preserves
  pending runs. Cancellation was never treated as acceptance.
- **Card position, 41642093459:** enabling removed a 21-pixel pending-version row;
  following cards moved by that height, with unchanged IDs/order/widths. The
  assertion now accounts for measured preceding-height changes and checks the
  target position/order. This old run had no rendered image and remains failed.
- **Late request on window close, 41649755144:** the product exited after a new
  request was admitted but before completion. Frontend admission closure, owner
  retirement, native registry cancellation/wait, and audit flush now precede
  destruction. The passing Windows run directly exercises a late admission:
  it completes cancelled with verified cleanup before natural product exit.
- **Linux visible helper overlay:** actual Xfwm4 screenshots showed the managed
  Toplevel moved from the requested offscreen position onto the editor. The X11
  Popup fix is override-redirect, refuses focus on mapping and remains at
  `(-20000,-20000)` during both rendering sizes. Actual system screenshots,
  window properties, sampled input focus, decoded PNG and natural close verify
  the correction. Earlier failed test assertions and failed attempts are retained.

## Open issues and scope limits

- **Old profile cleanup remains uncertain.** `DeleteProfileW` for
  `C:\Users\mkme0b98d3013ee14f`, SID
  `S-1-5-21-3077485881-3661871218-4154919024-1003`, failed with Win32 32 in
  run 41642093459. That hosted runner ended and has no accessible execution
  channel here; the old residual could not be rechecked or removed. This action
  is **uncertain/unavailable**, not denied or pending approval. Account deletion
  did not prove profile deletion. See the [exact blocker record](windows/product-attempt-41642093459/profile-cleanup-blocker.json).
  New runs use bounded sharing-violation retries, exact-SID process checks, and
  separate path/registry/hive/CIM checks; the current run confirms its own profile,
  account and stage deletion only.
- **Run 41653312849's native cleanup uncertainty remains undiagnosed.** Its
  original audit omitted the failing stage. New closed, bounded IPC/cleanup
  diagnostics preserve direct error codes and original timing/failure rules.
  The earlier passing run `41656903741` has 12 admitted/12 finished, every cleanup
  confirmed, no IPC cancellation and no typed failures. Installed beta.8 run
  `41668620695` separately has 15 admitted/15 finished with all cleanup confirmed.
  This is non-reproduction, not proof that
  the old cause was fixed. Synchronous Windows API durations are not hard bounded.
- **Linux support is X11-only for this native path.** A non-X11 GDK backend is
  rejected and source fallback remains; native Wayland was not accepted and
  there is no automatic backend switch. The current generic rendering notice
  does not specifically explain this backend restriction.
- **Shutdown is irreversible within the current window.** On cleanup failure,
  all document-renderer admission remains closed. The window is retained for
  saving and another close attempt, not a return to normal rendered editing.
  The final notice makes this explicit. Enabling plugins again does not reset it.
- **Visual limits remain.** Current Windows C4 has a roughly one-pixel relation
  label backing overlap with a node outline, without hidden text/arrows. The
  earlier full native corpus review recorded 41 passes and 9 warnings, not a
  declaration that every aesthetic issue is solved. Current product acceptance
  uses four self-authored fixtures, light theme/DPR 1. It does not cover every
  grammar, dark/high-DPI, real IME, Windows native file picker, upgrade/rollback,
  macOS native output or OS-wide network-denial acceptance. Fresh current-user
  Windows installation is now covered by the separate beta.8 delivery run.

Original failures and raw evidence remain in [the chronological record](README.md).
No admission event, empty image list, forced cleanup, skipped job or cancelled job
is counted as successful diagram rendering or product acceptance.

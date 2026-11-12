# Release quality integration — 2026-11-12

This is candidate evidence, not a release approval. Integration branch:
`dot/release-quality-integration-20261112`, based on
`ef221deb1bde9b56b6bc5faf09105d5bcbd059d7`. No Release, tag or main merge.
Original worktrees are preserved. Commit author and committer are
LarryZhu-dev <larryzhu@foxmail.com>.

## Integrated work

- Editor quality: original `8f02ff66`, `8f07fc00`; integrated as `a0b152f4`, `aca9defe`.
- Distribution: `84d9e6a5` → `8d1431d3`; signed manual recovery preparation → `cad6b0cf`.
- Windows PDF/print: `742d0637` → `69fa85d3`, `8107bc5b` → `9c9eafd9`,
  `c49fe3fc` → `7f10b28d`; review fixes → `7afd13c2`; native fixtures → `66256214`.
- Mermaid retained image history and Outline 1.3.4: `7def1399`, `31c27aed`.
- Integration fixes preserve preview image ownership across focus/viewport changes
  (`fdcf3e6c`), and prevent already-observed scroll/resize events dismissing a
  freshly opened context menu (`18711cfd`). Real geometry changes still dismiss it.
- The original editor source/live control is retained. Mermaid's source/rendered/
  mixed policy is a separate plugin setting, not a global three-mode editor control.

## Windows PDF and print: exact tested candidate

[Run 43141132432](https://github.com/Auto-Plugin/milkup/actions/runs/43141132432)
passed at `0ccc4c4cafc7e69acfd2d551bec230075ab925d0`:

- 20 output contracts passed; four opt-in tests were ignored by that first invocation.
- A separate opt-in test actually rendered all four PDFs using installed WebView2.
- A separate real print-dialog test guarded Printer Properties and cancelled the
  controlled dialog without submitting a job. This is not positive queue or physical printing.
- Original artifact `13909458608`, ZIP SHA-256
  `48935663333ee88eb19bd8b608de52359be86eba39458b833897ac47c69ad94a`.
  Retained until 2026-11-19. Its `summary.json` records `releaseReady: false`.

Independent `pdfinfo` examination:

| PDF              | Dimensions (points) | Rotation |
| ---------------- | ------------------- | -------- |
| A4 portrait      | 594.96 × 841.92     | 0        |
| A4 landscape     | 841.92 × 594.96     | 0        |
| Letter portrait  | 612 × 792           | 0        |
| Letter landscape | 792 × 612           | 0        |

All samples are one page. Text extraction from A4 retained Chinese, emoji,
typographic quotes and the sample combining character. This is limited sample
evidence, not complete multilingual, multipage or visual fidelity acceptance.

### Failures retained and actual fixes

The earlier landscape fixture forced A4 portrait CSS while asking the API for
Letter landscape. The fixture now matches the real serializer's paper/direction
CSS; a deliberately contradictory portrait case remains a negative control.

Earlier real network tests detected an iframe TCP connection even with CSP and
awaited CDP offline setup. A reset connection is still a connection and was a
failure. `0247439d` adds an HTML-token validation boundary before launching the
output helper and inside it: browsing contexts, preconnect links, base changes,
refresh directives and malformed input are rejected. `0ccc4c4c` also rejects
comments to avoid raw-text parser ambiguity. This validator accepts the controlled
static serializer; it is not an arbitrary-HTML sanitizer. Escaped code samples remain accepted.

On the passing real run, all five image/script/frame/style/preconnect listeners
for all four paper cases reported `WouldBlock` with no connection. The disallowed
frame/preconnect/refresh samples are rejected before navigation; the allowed
static output still runs through the browser's network restrictions.

Run 43140477351 at `0247439d` passed three papers but failed the fourth while
removing the private profile: Win32 sharing violation 32. `0ccc4c4c` retries only
sharing/lock errors 32/33 within the existing two-second cleanup deadline;
other errors fail immediately and successful return requires actual removal.
Tests cover delayed release and a handle held beyond the deadline. The later
passing run did not bypass this cleanup requirement.

## Performance and public plugin packaging

All eleven public plugins were rebuilt and verified, including export-print 1.0.1
and Outline 1.3.4. Historical manual-trial gates pinned to Outline 1.3.3 are not
evidence for these packages.

A paired 18,000-heading CPU/index benchmark against `ef221deb` measured medians
94.014 ms before and 82.374 ms after, a 12.38% reduction. It excludes native scan,
storage, IPC, input and paint; it is not a native cold-start or UI p95 claim.
The Mermaid cache change retains the shared 64 MiB/128-image limits and bounded
prefetch; current Windows long-scroll acceptance is tracked separately below.

## Current platform gates

| Gate                        | Exact run/candidate                                      | Status at this checkpoint                                                                                                                               |
| --------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dual-account source         | 43141649677 / `bf8a2d50`                                 | Failed before product/GUI execution: wrapper exact-ref whitelist omitted the integration branch. Rust checks passed.                                    |
| Dual-account retry          | 43143354426 / `988a0f735a7e10b5cd66c1848eeb482cbfa8efe3` | Both product accounts passed initial preview and plugin strategy observations, then timed out at the stale global-preview assertion. GUI still running. |
| Earlier three-package build | 43139149455 / `66c6fe3c`                                 | Offline Windows and Linux deb built; standard NSIS built but failed the older network gate. Whole run failed; no installation acceptance.               |
| Three-package build         | 43141877202 / `bf8a2d50`                                 | In progress. This candidate does not contain `18711cfd`'s menu fix.                                                                                     |
| Latest three-package build  | 43143356894 / `988a0f735a7e10b5cd66c1848eeb482cbfa8efe3` | Pending behind the running build.                                                                                                                       |

The installation workflow downloads the original artifacts from a successful,
exact-SHA distribution run and checks receipt, size and SHA-256 before execution.
It does not rebuild the tested package. Windows smoke checks install, owned native
window, normal close, actual NSIS uninstall and unchanged fixture; Linux smoke
checks dpkg installation/removal. These are narrower than full installed GUI,
old-profile migration, absent-Runtime provisioning or recovery acceptance.

## Browser checkpoint

The first complete integrated Linux Chromium run finished with 293/294 passing.
The remaining context-menu failure was reproduced with actual Worker RPC traffic:
requests `editing-10`, `editing-11`, `editing-12`, `editing-18` were cancelled after
the host posted snapshot responses; cancellation no longer found an active RPC.
Those unaccepted snapshots remained allocated, and `editing-19` returned `busy`.

`5d79147a` retains the originating RPC identity until the captured snapshot is
consumed or released, so a cancellation during response transit releases it.
The new controlled-delivery test failed before the fix and passes twelve
consecutive cancellations after it, exceeding the unchanged eight-snapshot limit.
Unknown cancellation cannot release the current accepted snapshot. The plugin
package's 623 tests and TypeScript check passed; eight real Worker repetitions
passed without instrumentation. A subsequent complete browser run passed
**294/294 in 4.9 minutes**, including production-CSP controls. This is Linux
Chromium, not native Windows/WebKit or system IME evidence.

Windows product tests are being aligned with the user-requested plugin boundary:
the original document button switches source/live, while Mermaid has three
strategies. The old test incorrectly required a third global preview state. The
replacement keeps exact caret, decoded PNG, hot enable, source preservation and
trusted native copy checks, and requires the editor to remain editable.

## Historical issues and remaining verification

- [#255](https://github.com/Auto-Plugin/milkup/issues/255): current browser cases type
  English/digits inside parentheses, wait 2.5 seconds, verify the caret and type
  another character; another case checks single-space headings after an image.
  They passed in the integrated browser suite. They are not yet rerun in this
  exact installed Windows candidate.
- [#252](https://github.com/Auto-Plugin/milkup/issues/252): the current browser test
  reads actual clipboard HTML with editable table structure and exact plain-text
  Markdown; source mode offers plain text. It passed. No Word 2016 executable is
  available in this Linux environment, so actual Word paste/editability is open.
- The July Windows IME report is useful historical evidence, not acceptance for
  this candidate. Synthetic composition tests cannot replace a real candidate
  window, candidate selection, commit, cancel and undo through the system IME.
- Linux WebKit PDF text/fidelity remains open. No complete matching WebKit
  2.52.6/2.54.2 source or configured build tree exists in this environment.
- Fresh signed recovery preparation has contract tests, but actual installation,
  restart health and old-profile recovery remain unverified. Recovery is manual;
  automatic application rollback has not been implemented.
- Formal signing, release channels, physical printing, printer-job cancellation,
  native DPI and full current installed Windows/Linux GUI remain separate gates.

No package in this checkpoint is declared a completed formal release.

## Later installation/build checkpoint

`43141877202` at `bf8a2d50` completed successfully for all three variants. This
predates the menu and editing-RPC fixes. Original installer SHA-256 values:

| Variant          |     Bytes | SHA-256                                                            |
| ---------------- | --------: | ------------------------------------------------------------------ |
| Windows standard |   7247357 | `50d658b124376c9841bc9813bd6e066097c01afc72846d86ed641885db464b03` |
| Windows offline  | 225029557 | `8784d59e804991bffd65b0dc12126f9e917cd28226ff13f1d7c02c5809057642` |
| Linux deb        |   9830948 | `d51c3b28df336f43ce0881ee67fe4aa743833bb6f3f16d6a9323821104e7aee0` |

Installation run `43146097590` used these original artifacts. Its standard
Windows installer exited 0, but the test selected `Process.MainWindowHandle`
133.4793 ms after launch with an empty title, then normal close timed out at 15 s.
Forced cleanup is recorded; uninstall did not execute. Artifact `13910774883`
retains the original failure. The later test enumerates and validates the unique
visible, unowned `Tauri Window` titled `milkup` for the exact PID, process birth
and image before posting close. Both the 45 s startup bound and 15 s normal-close
bound remain unchanged. Real Windows outcome is still required.

That standard runner reported no Word executable and only `en-US` / `0409:00000409`.
This confirms missing environment for the requested Word 2016 and Chinese IME
cases on that runner; it is not a failed product behavior test.

Latest source acceptance `43145964546` and package build `43145985835` are bound
to `5d79147ac0c27be58f4e3697b127b6c2d98561df` and remain pending at this update.
The superseded `03ced613` source run was cancelled while pending with no job;
no running verification was cancelled.

## Verified original-package installation results (03:19 UTC)

All results below install the original `bf8a2d50` artifacts from successful build
`43141877202`; none substitutes a rebuilt package. They do not cover the later
`5d79147a` application change.

- Windows standard and offline passed in run `43146827839`, using installation
  harness `7f3e488a`. Four real native identity/target negative checks passed first.
  Both installers exited 0, the exact owned Tauri window was observed, normal
  application close exited 0, and the actual NSIS uninstaller exited 0. The
  application binary was removed and the fixture document SHA was unchanged.
  `forcedCleanup` is false in both original reports.
- The standard startup snapshots distinguish an empty-title `Tao Thread Event
Target` at 161.6981 ms from the later `Tauri Window` titled `milkup`. This confirms
  why selecting `Process.MainWindowHandle` at startup was insufficient. Measured
  launch-to-owned-native-window time: standard 5021.4523 ms, offline 4693.7097 ms.
  These are two separate samples, not first-paint or Mermaid-render latency.
- Standard artifact `13912640712`: ZIP SHA
  `2bb3f8173ad40843b896d626611ded2fdd0766dfb24f8198013da365ea7d4ea6`.
  Offline artifact `13911977772`: ZIP SHA
  `87de2e5d1943a3f49ab7b48495ab0909cda03020c5d215b8d515e6d09ab68a48`.
- The first Linux attempts failed resolving dependencies because the hosted
  runner's stale APT index referenced superseded packages (HTTP 404). `fb130427`
  refreshes signed repository metadata before installing the exact local deb;
  it does not skip dependency checks. Linux-only run `43147155565` passed native
  installation, installed executable verification, dpkg removal and unchanged
  fixture. Artifact `13911822643`: ZIP SHA
  `472dcbf00c6369d0564c212d5e7bcaaecbe2d0e2f5cf11744bdb81c917635f41`.
  This Linux run does not launch the GUI.

## Source GUI audit boundary

The original report from `43143354426` at `988a0f73` is retained in artifact
`13911354015` (ZIP SHA
`1ffa9b12738556e1334d655f4f7edc778cb47cd74629f6ac58be7a564595b667`).
Both accounts completed all eight GUI steps, including 12-diagram visits and
idle/busy normal close. Filtered-admin final contract passed. Pure-standard final
contract failed because one child SHOW lacked unique lifetime proof; there was
no overflow. Its compressed evidence was reassembled with every chunk length,
chunk SHA and restored raw SHA verified.

The unresolved pure-standard event is SHELLDLL_DefView `0x1028a`, SHOW sequence
389, native tick 783750 and processing tick 783765. The initial processing read
saw a live child, but both post-parent-destroy continuity reads found it gone.
`doubleReadMatched` is false. Held PID/thread identity is not sufficient to fill
this window-generation gap. The audit remains incomplete; a zero console count
is not evidence that no console appeared in that run.

Latest `5d79147a` source run `43145964546` is executing product acceptance; its
build `43145985835` is still pending behind the already-running `988a0f73` build.
The latest source/package conclusions remain open. No running verification was
cancelled, and no formal release has been published.

## Second product harness correction (03:26 UTC checkpoint)

Run [43145964546](https://github.com/Auto-Plugin/milkup/actions/runs/43145964546)
at application candidate `5d79147ac0c27be58f4e3697b127b6c2d98561df` passed product
steps 01 and 02 in both accounts, including the corrected independent Mermaid
policy, hot enable, original source/live toggle, real copy and cursor checks.
Both then failed step 03 with `Timed out: Rendered mode with undo history`:
a second obsolete assertion still expected the original toggle to enter global
`preview`. Product artifact `13912187105` was downloaded and verified (ZIP SHA-256
`885217ffa73708956b7dce799f32e94f11a4eb9cb71ba3a879a0892752861aa6`).
The independent GUI stage is still running; this is not a passing source run.

The correction removes that obsolete global-readonly assertion and instead
requires real Ctrl+Z in editable `live` mode while the Mermaid plugin policy is
`preview`: version increments exactly once, original file bytes and decoded
original pixels return, then redo must restore edited bytes/pixels. The installed
product verifier also requires the new proof; missing fields, readonly/global-mode
leakage, unchanged history and inexact source are rejected. All 259 relevant Node
contract tests pass locally. Actual Windows execution remains required.

No application bytes changed after `5d79147a` in this correction. Its exact
three-package build [43145985835](https://github.com/Auto-Plugin/milkup/actions/runs/43145985835)
is pending behind the earlier `988a0f73` build. Earlier `bf8a2d50` installation
successes above cannot establish acceptance of this newer application.

Correction commit `d9f627be2366e7b78f03e431a23f6b4dc03865c1` is pushed; its
[Windows run 43148218776](https://github.com/Auto-Plugin/milkup/actions/runs/43148218776)
is pending. This commit changes acceptance and its evidence only, not application
source. Both author and committer are the requested LarryZhu-dev identity.
